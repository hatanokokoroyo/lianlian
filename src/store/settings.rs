//! 本机设置：目前只有 DeepSeek 的 API key（ADR-0001：key 明文留在设备上）。
//!
//! 单独一张 `settings` 表，键是字符串。别把 key 放进 `profile`：那是档案，
//! 会进模型装配；key 不该出现在提示词里。

use redb::{ReadableDatabase, TableDefinition};

use super::{db_error, Store, StoreError};

/// 设置：键 → 值。
pub(crate) const SETTINGS: TableDefinition<&str, &str> = TableDefinition::new("settings");

/// DeepSeek API key 的键。
pub const API_KEY: &str = "deepseek_api_key";
/// 一轮对话里允许的工具往返轮数（默认 6，夹在 1–128）。
pub const TOOL_ROUNDS: &str = "tool_rounds";

impl Store {
    /// 读一个设置；没设过就是 `None`。
    pub fn setting(&self, key: &str) -> Result<Option<String>, StoreError> {
        let read = self.db().begin_read().map_err(db_error)?;
        let table = read.open_table(SETTINGS).map_err(db_error)?;
        Ok(table
            .get(key)
            .map_err(db_error)?
            .map(|value| value.value().to_owned()))
    }

    /// 写一个设置。
    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), StoreError> {
        let write = self.db().begin_write().map_err(db_error)?;
        {
            let mut table = write.open_table(SETTINGS).map_err(db_error)?;
            table.insert(key, value).map_err(db_error)?;
        }
        write.commit().map_err(db_error)
    }

    /// 删一个设置；本来就没有也算成功。
    pub fn delete_setting(&self, key: &str) -> Result<(), StoreError> {
        let write = self.db().begin_write().map_err(db_error)?;
        {
            let mut table = write.open_table(SETTINGS).map_err(db_error)?;
            table.remove(key).map_err(db_error)?;
        }
        write.commit().map_err(db_error)
    }
}

#[cfg(test)]
mod tests {
    use crate::store::tests::TempStore;

    use super::*;

    #[test]
    fn a_setting_is_absent_until_written_and_survives_reopening() {
        let mut temp = TempStore::new("settings");
        assert_eq!(temp.store().setting(API_KEY).expect("读"), None);
        temp.store().set_setting(API_KEY, "sk-test").expect("写");
        assert_eq!(
            temp.reopen().setting(API_KEY).expect("读"),
            Some("sk-test".to_owned())
        );
    }

    #[test]
    fn deleting_a_setting_takes_it_back_to_absent() {
        let temp = TempStore::new("settings-delete");
        temp.store().set_setting(API_KEY, "sk-test").expect("写");
        temp.store().delete_setting(API_KEY).expect("删");
        assert_eq!(temp.store().setting(API_KEY).expect("读"), None);
        temp.store().delete_setting(API_KEY).expect("再删也成功");
    }
}
