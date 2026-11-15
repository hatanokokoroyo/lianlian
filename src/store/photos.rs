//! 照片的元数据表（#8）：文件在 app 私有目录，这里只存行。
//!
//! 删除会话时把它的照片行一起删掉，文件由 `api` 侧按返回的行去删（ADR-0005 修订：
//! 照片不是依据，没有留下来的理由）。

use redb::{ReadableDatabase, ReadableTable, TableDefinition};

use super::{db_error, Store, StoreError};
#[cfg(test)]
use crate::domain::DomainError;
use crate::domain::{ConversationId, Photo, PhotoId};

/// 照片：编号 → Photo 的 JSON。
pub(crate) const PHOTOS: TableDefinition<u64, &str> = TableDefinition::new("photos");

impl Store {
    /// 预定一个照片编号（文件要按编号命名，所以先拿号再落盘）。
    pub fn reserve_photo_id(&self) -> Result<PhotoId, StoreError> {
        let id = PhotoId(self.next_photo_id()?);
        self.set_meta("next_photo_id", &(id.0 + 1).to_string())?;
        Ok(id)
    }

    /// 插一条照片元数据（文件已经落盘之后才调，编号来自 `reserve_photo_id`）。
    pub fn insert_photo(&self, photo: Photo) -> Result<Photo, StoreError> {
        if photo.id.0 == 0 {
            return Err(StoreError::Db("照片编号还没分配".to_owned()));
        }
        let photo = Photo::new(photo.id, photo)?;

        let write = self.db().begin_write().map_err(db_error)?;
        {
            let mut photos = write.open_table(PHOTOS).map_err(db_error)?;
            photos
                .insert(photo.id.0, to_json(&photo)?.as_str())
                .map_err(db_error)?;
        }
        write.commit().map_err(db_error)?;
        Ok(photo)
    }

    /// 按编号取一张。
    pub fn photo(&self, id: PhotoId) -> Result<Option<Photo>, StoreError> {
        let read = self.db().begin_read().map_err(db_error)?;
        let table = read.open_table(PHOTOS).map_err(db_error)?;
        let json = table
            .get(id.0)
            .map_err(db_error)?
            .map(|value| value.value().to_owned());
        json.map(|json| from_json(&json)).transpose()
    }

    /// 一个会话的全部照片，按（时间、编号）升序。
    pub fn photos_of(&self, conversation: ConversationId) -> Result<Vec<Photo>, StoreError> {
        let read = self.db().begin_read().map_err(db_error)?;
        let table = read.open_table(PHOTOS).map_err(db_error)?;
        let mut all = Vec::new();
        for entry in table.iter().map_err(db_error)? {
            let (_, value) = entry.map_err(db_error)?;
            let photo: Photo = from_json(value.value())?;
            if photo.conversation == conversation {
                all.push(photo);
            }
        }
        all.sort_by_key(|photo| (photo.at, photo.id));
        Ok(all)
    }

    /// 删掉一个会话的全部照片行，返回被删的行（调用方据此删文件）。
    pub fn delete_photos_of(
        &self,
        conversation: ConversationId,
    ) -> Result<Vec<Photo>, StoreError> {
        let doomed = self.photos_of(conversation)?;
        if doomed.is_empty() {
            return Ok(doomed);
        }
        let write = self.db().begin_write().map_err(db_error)?;
        {
            let mut photos = write.open_table(PHOTOS).map_err(db_error)?;
            for photo in &doomed {
                photos.remove(photo.id.0).map_err(db_error)?;
            }
        }
        write.commit().map_err(db_error)?;
        Ok(doomed)
    }

    fn next_photo_id(&self) -> Result<u64, StoreError> {
        Ok(self
            .meta("next_photo_id")?
            .and_then(|value| value.parse().ok())
            .unwrap_or(1))
    }
}

fn to_json<T: serde::Serialize>(value: &T) -> Result<String, StoreError> {
    serde_json::to_string(value).map_err(|error| StoreError::Db(format!("写库序列化失败：{error}")))
}

fn from_json<T: serde::de::DeserializeOwned>(json: &str) -> Result<T, StoreError> {
    serde_json::from_str(json).map_err(|error| StoreError::Db(format!("读库反序列化失败：{error}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::tests::TempStore;

    fn photo(id: u64, conversation: ConversationId, at: i64) -> Photo {
        Photo {
            id: PhotoId(id),
            conversation,
            file: "0.jpg".to_owned(),
            mime: "image/jpeg".to_owned(),
            width: 2048,
            height: 1536,
            bytes: 240_000,
            at,
        }
    }

    #[test]
    fn a_photo_is_stored_with_its_metadata_and_survives_reopening() {
        let mut temp = TempStore::new("photos-insert");
        let store = temp.store();
        let conversation = store.create_conversation(100).expect("会话");
        let id = store.reserve_photo_id().expect("拿号");
        assert_eq!(id, PhotoId(1), "编号由库分配");
        let saved = store
            .insert_photo(photo(id.0, conversation.id, 110))
            .expect("插一条");
        assert_eq!(saved.id, id);

        let reopened = temp.reopen();
        let read = reopened.photo(saved.id).expect("读").expect("存在");
        assert_eq!(read, saved);
        assert!(read.was_scaled());
        assert_eq!(reopened.photos_of(conversation.id).expect("列表").len(), 1);
    }

    #[test]
    fn it_refuses_what_the_domain_refuses() {
        let temp = TempStore::new("photos-refuse");
        let store = temp.store();
        let conversation = store.create_conversation(100).expect("会话");
        let error = store
            .insert_photo(Photo {
                mime: "text/plain".to_owned(),
                ..photo(store.reserve_photo_id().expect("拿号").0, conversation.id, 110)
            })
            .unwrap_err();
        assert_eq!(
            error,
            StoreError::Domain(DomainError::NotAnImage("text/plain".to_owned()))
        );
        assert!(store.photos_of(conversation.id).expect("列表").is_empty());
    }

    #[test]
    fn deleting_a_conversations_photos_hands_back_the_rows_to_unlink() {
        let temp = TempStore::new("photos-delete");
        let store = temp.store();
        let keep = store.create_conversation(100).expect("留下的");
        let doomed = store.create_conversation(200).expect("要删的");
        store
            .insert_photo(photo(store.reserve_photo_id().expect("号").0, doomed.id, 210))
            .expect("插");
        store
            .insert_photo(photo(store.reserve_photo_id().expect("号").0, keep.id, 220))
            .expect("插");

        let removed = store.delete_photos_of(doomed.id).expect("删");
        assert_eq!(removed.len(), 1);
        assert_eq!(removed[0].conversation, doomed.id);
        assert!(store.photos_of(doomed.id).expect("列表").is_empty());
        assert_eq!(store.photos_of(keep.id).expect("列表").len(), 1);
        // 幂等：再删没有东西，也没有错误。
        assert!(store.delete_photos_of(doomed.id).expect("再删").is_empty());
    }
}
