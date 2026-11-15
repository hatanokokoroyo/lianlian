//! 会话与消息的存储。
//!
//! 两张表：`conversations`（编号 → Conversation 的 JSON）、`messages`（编号 →
//! Message 的 JSON）。消息只追加，不修改；删除会话时删它和它的消息正文——依据
//! 日志与照片不在这两张表里，所以不会被带走（ADR-0005）。

use redb::{ReadableDatabase, ReadableTable, TableDefinition};

use super::{db_error, Store, StoreError};
use crate::domain::conversation::UNTITLED;
use crate::domain::{Conversation, ConversationId, DomainError, Message, MessageId, Role};

/// 会话：编号 → Conversation 的 JSON。
pub(crate) const CONVERSATIONS: TableDefinition<u64, &str> =
    TableDefinition::new("conversations");
/// 消息：编号 → Message 的 JSON。
pub(crate) const MESSAGES: TableDefinition<u64, &str> = TableDefinition::new("messages");

impl Store {
    /// 新开一个会话（还没起名字）。
    pub fn create_conversation(&self, at: i64) -> Result<Conversation, StoreError> {
        let id = ConversationId(self.next_conversation_id()?);
        let conversation = Conversation::new(id, at);
        self.write_conversation(&conversation)?;
        Ok(conversation)
    }

    /// 全部会话：未归档的在前，按「最近更新、编号」倒序。
    pub fn conversations(&self) -> Result<Vec<Conversation>, StoreError> {
        let read = self.db().begin_read().map_err(db_error)?;
        let table = read.open_table(CONVERSATIONS).map_err(db_error)?;
        let mut all = Vec::new();
        for entry in table.iter().map_err(db_error)? {
            let (_, value) = entry.map_err(db_error)?;
            all.push(from_json::<Conversation>(value.value())?);
        }
        all.sort_by(|a, b| (b.updated_at, b.id).cmp(&(a.updated_at, a.id)));
        Ok(all)
    }

    /// 一个会话；没有就是 `None`。
    pub fn conversation(
        &self,
        id: ConversationId,
    ) -> Result<Option<Conversation>, StoreError> {
        let read = self.db().begin_read().map_err(db_error)?;
        let table = read.open_table(CONVERSATIONS).map_err(db_error)?;
        let json = table
            .get(id.0)
            .map_err(db_error)?
            .map(|value| value.value().to_owned());
        json.map(|json| from_json(&json)).transpose()
    }

    /// 归档 / 取消归档。归档的会话从默认列表消失，但仍在库里可被找回。
    pub fn set_conversation_archived(
        &self,
        id: ConversationId,
        archived: bool,
    ) -> Result<(), StoreError> {
        let mut conversation = self.require_conversation(id)?;
        conversation.archived = archived;
        self.write_conversation(&conversation)
    }

    /// 删除一个会话与它的全部消息。
    ///
    /// 只删消息正文：依据日志、照片不在这两张表里，保留语义由 #8/#9 接上。
    pub fn delete_conversation(&self, id: ConversationId) -> Result<(), StoreError> {
        self.require_conversation(id)?;
        let doomed: Vec<u64> = self
            .messages(id)?
            .into_iter()
            .map(|message| message.id.0)
            .collect();

        let write = self.db().begin_write().map_err(db_error)?;
        {
            let mut messages = write.open_table(MESSAGES).map_err(db_error)?;
            for message in doomed {
                messages.remove(message).map_err(db_error)?;
            }
            drop(messages);
            let mut conversations = write.open_table(CONVERSATIONS).map_err(db_error)?;
            conversations.remove(id.0).map_err(db_error)?;
        }
        write.commit().map_err(db_error)
    }

    /// 追加一条消息；会话的标题（若是占位）与更新时间一并推进。
    pub fn append_message(
        &self,
        conversation: ConversationId,
        role: Role,
        text: &str,
        at: i64,
    ) -> Result<Message, StoreError> {
        let mut record = self.require_conversation(conversation)?;
        let id = MessageId(self.next_message_id()?);
        let message = Message::new(id, conversation, role, text, at)?;
        let json = to_json(&message)?;

        if role == Role::User && record.title == UNTITLED {
            record.title = Conversation::title_from(&message.text);
        }
        record.updated_at = record.updated_at.max(at);

        let write = self.db().begin_write().map_err(db_error)?;
        {
            let mut messages = write.open_table(MESSAGES).map_err(db_error)?;
            messages
                .insert(id.0, json.as_str())
                .map_err(db_error)?;
            drop(messages);
            let mut conversations = write.open_table(CONVERSATIONS).map_err(db_error)?;
            conversations
                .insert(conversation.0, to_json(&record)?.as_str())
                .map_err(db_error)?;
            drop(conversations);
            let mut meta = write.open_table(super::META).map_err(db_error)?;
            meta.insert("next_message_id", (id.0 + 1).to_string().as_str())
                .map_err(db_error)?;
        }
        write.commit().map_err(db_error)?;
        Ok(message)
    }

    /// 一个会话的全部消息，按「时间、编号」升序。
    pub fn messages(&self, conversation: ConversationId) -> Result<Vec<Message>, StoreError> {
        let read = self.db().begin_read().map_err(db_error)?;
        let table = read.open_table(MESSAGES).map_err(db_error)?;
        let mut all = Vec::new();
        for entry in table.iter().map_err(db_error)? {
            let (_, value) = entry.map_err(db_error)?;
            let message: Message = from_json(value.value())?;
            if message.conversation == conversation {
                all.push(message);
            }
        }
        all.sort_by_key(|message| (message.at, message.id));
        Ok(all)
    }

    fn require_conversation(
        &self,
        id: ConversationId,
    ) -> Result<Conversation, StoreError> {
        self.conversation(id)?
            .ok_or(StoreError::Domain(DomainError::UnknownConversation(id.0)))
    }

    fn write_conversation(&self, conversation: &Conversation) -> Result<(), StoreError> {
        let json = to_json(conversation)?;
        let next = (conversation.id.0 + 1).to_string();
        let write = self.db().begin_write().map_err(db_error)?;
        {
            let mut table = write.open_table(CONVERSATIONS).map_err(db_error)?;
            table
                .insert(conversation.id.0, json.as_str())
                .map_err(db_error)?;
            drop(table);
            let mut meta = write.open_table(super::META).map_err(db_error)?;
            let current: u64 = meta
                .get("next_conversation_id")
                .map_err(db_error)?
                .map(|value| value.value().parse().unwrap_or(1))
                .unwrap_or(1);
            if current <= conversation.id.0 {
                meta.insert("next_conversation_id", next.as_str())
                    .map_err(db_error)?;
            }
        }
        write.commit().map_err(db_error)
    }

    fn next_conversation_id(&self) -> Result<u64, StoreError> {
        Ok(self
            .meta("next_conversation_id")?
            .and_then(|value| value.parse().ok())
            .unwrap_or(1))
    }

    fn next_message_id(&self) -> Result<u64, StoreError> {
        Ok(self
            .meta("next_message_id")?
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

    #[test]
    fn a_new_conversation_is_untitled_and_lists_first() {
        let temp = TempStore::new("conversations-create");
        let store = temp.store();
        let first = store.create_conversation(100).expect("新会话");
        let second = store.create_conversation(200).expect("另一个");
        assert_eq!(first.title, UNTITLED);
        let all = store.conversations().expect("列表");
        assert_eq!(
            all.iter().map(|conversation| conversation.id).collect::<Vec<_>>(),
            vec![second.id, first.id]
        );
    }

    #[test]
    fn messages_are_ordered_and_survive_reopening() {
        let mut temp = TempStore::new("conversations-messages");
        let store = temp.store();
        let conversation = store.create_conversation(100).expect("新会话");
        store
            .append_message(conversation.id, Role::User, "  右膝为什么响  ", 110)
            .expect("用户消息");
        store
            .append_message(conversation.id, Role::Assistant, "先做一个测试", 120)
            .expect("回复");

        let reopened = temp.reopen();
        let messages = reopened.messages(conversation.id).expect("读消息");
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].role, Role::User);
        assert_eq!(messages[0].text, "右膝为什么响");
        assert_eq!(messages[1].text, "先做一个测试");
        // 标题取自第一条用户消息。
        assert_eq!(
            reopened
                .conversation(conversation.id)
                .expect("读会话")
                .expect("存在")
                .title,
            "右膝为什么响"
        );
    }

    #[test]
    fn blank_messages_are_refused_and_nothing_is_written() {
        let temp = TempStore::new("conversations-blank");
        let store = temp.store();
        let conversation = store.create_conversation(100).expect("新会话");
        assert_eq!(
            store.append_message(conversation.id, Role::User, "  ", 110),
            Err(StoreError::Domain(DomainError::EmptyMessage))
        );
        assert!(store.messages(conversation.id).expect("读").is_empty());
        assert_eq!(
            store.conversation(ConversationId(99)).expect("读"),
            None
        );
    }

    #[test]
    fn archiving_hides_a_conversation_without_deleting_it() {
        let temp = TempStore::new("conversations-archive");
        let store = temp.store();
        let conversation = store.create_conversation(100).expect("新会话");
        store
            .append_message(conversation.id, Role::User, "训练条件改一下", 110)
            .expect("消息");
        store
            .set_conversation_archived(conversation.id, true)
            .expect("归档");

        let all = store.conversations().expect("列表");
        assert!(all[0].archived);
        assert_eq!(all.len(), 1);
        assert_eq!(store.messages(conversation.id).expect("消息").len(), 1);

        store
            .set_conversation_archived(conversation.id, false)
            .expect("取消归档");
        assert!(!store.conversations().expect("列表")[0].archived);
    }

    #[test]
    fn deleting_a_conversation_takes_its_messages_and_leaves_the_others() {
        let temp = TempStore::new("conversations-delete");
        let store = temp.store();
        let keep = store.create_conversation(100).expect("留下的");
        let doomed = store.create_conversation(200).expect("要删的");
        store
            .append_message(doomed.id, Role::User, "删掉我", 210)
            .expect("消息");
        store
            .append_message(keep.id, Role::User, "留着我", 220)
            .expect("消息");

        store.delete_conversation(doomed.id).expect("删除");
        assert_eq!(store.conversation(doomed.id).expect("读"), None);
        assert!(store.messages(doomed.id).expect("读").is_empty());
        assert_eq!(store.messages(keep.id).expect("读").len(), 1);

        assert_eq!(
            store.delete_conversation(doomed.id),
            Err(StoreError::Domain(DomainError::UnknownConversation(doomed.id.0)))
        );
    }

    #[test]
    fn a_later_message_moves_the_conversation_up_the_list() {
        let temp = TempStore::new("conversations-order");
        let store = temp.store();
        let old = store.create_conversation(100).expect("旧的");
        let new = store.create_conversation(200).expect("新的");
        store
            .append_message(old.id, Role::User, "又聊了一句", 300)
            .expect("消息");
        let all = store.conversations().expect("列表");
        assert_eq!(all[0].id, old.id);
        assert_eq!(all[1].id, new.id);
    }
}
