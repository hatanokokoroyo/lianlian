//! 本地库：一个 redb 单文件，放在 app 私有目录里。
//!
//! 这一层只负责把领域层的值搬进搬出，不藏规则：校验在 `domain`，聚合在
//! `domain::projection`。库结构有版本号，对不上就重建（骨架期不做迁移）。

pub mod findings;
pub mod plan;

use std::fmt;
use std::path::Path;

use nsh_core::prelude::data_dir;
use redb::{Database, ReadableDatabase, TableDefinition};

use crate::domain::DomainError;

/// 库结构与值格式的版本；改表或改值的编码都要 +1。
pub const SCHEMA_VERSION: &str = "3";

/// 库自己的标量：`schema_version`、`next_finding_id`。
pub(crate) const META: TableDefinition<&str, &str> = TableDefinition::new("meta");

/// 库操作的失败：领域规则拒绝，或底层存储出错。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StoreError {
    /// 领域规则拒绝（部位不在词表、侧别不对、取值非法……）。
    Domain(DomainError),
    /// redb 或文件系统出错。
    Db(String),
}

impl fmt::Display for StoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            StoreError::Domain(error) => write!(f, "{error}"),
            StoreError::Db(message) => write!(f, "本地库出错：{message}"),
        }
    }
}

impl std::error::Error for StoreError {}

impl From<DomainError> for StoreError {
    fn from(error: DomainError) -> Self {
        StoreError::Domain(error)
    }
}

fn db_error(error: impl ToString) -> StoreError {
    StoreError::Db(error.to_string())
}

/// 打开着的本地库。
pub struct Store {
    db: Database,
}

impl Store {
    /// app 私有目录里的库（真机与桌面宿主）。
    ///
    /// 宿主不提供文件目录时（网页宿主、`nsh test` 的 headless 引擎）落到系统临时
    /// 目录，这样库的行为在测试里是真的；真机上永远走 app 私有目录。
    pub fn open_app() -> Result<Store, StoreError> {
        let dir = data_dir().unwrap_or_else(|| std::env::temp_dir().join("lianlian"));
        std::fs::create_dir_all(&dir).map_err(db_error)?;
        Store::open(&dir.join("lianlian.redb"))
    }

    /// 打开（必要时建库、播种、重建）一个库文件。
    pub fn open(path: &Path) -> Result<Store, StoreError> {
        let db = Database::create(path).map_err(db_error)?;
        prepare(&db)?;
        Ok(Store { db })
    }

    pub(crate) fn db(&self) -> &Database {
        &self.db
    }

    /// 读库自己的一个标量（`schema_version`、`next_finding_id`……）。
    pub fn meta(&self, key: &str) -> Result<Option<String>, StoreError> {
        read_meta(&self.db, key)
    }

    /// 写库自己的一个标量。
    pub fn set_meta(&self, key: &str, value: &str) -> Result<(), StoreError> {
        let write = self.db.begin_write().map_err(db_error)?;
        {
            let mut meta = write.open_table(META).map_err(db_error)?;
            meta.insert(key, value).map_err(db_error)?;
        }
        write.commit().map_err(db_error)
    }
}

fn read_meta(db: &Database, key: &str) -> Result<Option<String>, StoreError> {
    let read = db.begin_read().map_err(db_error)?;
    match read.open_table(META) {
        Ok(table) => Ok(table
            .get(key)
            .map_err(db_error)?
            .map(|value| value.value().to_owned())),
        Err(redb::TableError::TableDoesNotExist(_)) => Ok(None),
        Err(error) => Err(db_error(error)),
    }
}

fn prepare(db: &Database) -> Result<(), StoreError> {
    match read_meta(db, "schema_version")? {
        Some(version) if version == SCHEMA_VERSION => Ok(()),
        // 骨架期没有迁移：版本变过就整体重建。
        Some(_) => {
            reset(db)?;
            initialize(db)
        }
        None => initialize(db),
    }
}

fn initialize(db: &Database) -> Result<(), StoreError> {
    let write = db.begin_write().map_err(db_error)?;
    {
        let mut meta = write.open_table(META).map_err(db_error)?;
        meta.insert("schema_version", SCHEMA_VERSION)
            .map_err(db_error)?;
    }
    // 空表也要建出来：读的时候不必判断表在不在。
    write.open_table(findings::FINDINGS).map_err(db_error)?;
    write.open_table(findings::RETRACTS).map_err(db_error)?;
    write.commit().map_err(db_error)?;
    plan::seed(db)
}

fn reset(db: &Database) -> Result<(), StoreError> {
    let write = db.begin_write().map_err(db_error)?;
    drop_table(&write, META)?;
    drop_table(&write, plan::EXERCISES)?;
    drop_table(&write, findings::FINDINGS)?;
    drop_table(&write, findings::RETRACTS)?;
    write.commit().map_err(db_error)
}

/// 删表；表本来就不在也算成功。
fn drop_table<K: redb::Key, V: redb::Value>(
    write: &redb::WriteTransaction,
    table: TableDefinition<K, V>,
) -> Result<(), StoreError> {
    match write.delete_table(table) {
        Ok(_) | Err(redb::TableError::TableDoesNotExist(_)) => Ok(()),
        Err(error) => Err(db_error(error)),
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use std::path::PathBuf;

    use super::*;

    /// 一个用完就删的临时库文件。
    pub(crate) struct TempStore {
        store: Option<Store>,
        dir: PathBuf,
    }

    impl TempStore {
        pub(crate) fn new(name: &str) -> TempStore {
            let dir = std::env::temp_dir().join(format!(
                "lianlian-store-{}-{name}",
                std::process::id()
            ));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).expect("建临时目录");
            let store = Store::open(&dir.join("lianlian.redb")).expect("打开新库");
            TempStore {
                store: Some(store),
                dir,
            }
        }

        /// 当前打开着的库。
        pub(crate) fn store(&self) -> &Store {
            self.store.as_ref().expect("库还开着")
        }

        /// 关掉再打开同一个文件（验证数据真的落盘了）。
        pub(crate) fn reopen(&mut self) -> Store {
            self.store = None;
            Store::open(&self.dir.join("lianlian.redb")).expect("重新打开库")
        }
    }

    impl Drop for TempStore {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    #[test]
    fn a_fresh_store_has_the_current_schema() {
        let temp = TempStore::new("schema");
        assert_eq!(
            temp.store().meta("schema_version").expect("读 meta"),
            Some(SCHEMA_VERSION.to_owned())
        );
    }

    #[test]
    fn a_store_from_an_older_schema_is_rebuilt() {
        let mut temp = TempStore::new("old-schema");
        temp.store()
            .set_meta("schema_version", "1")
            .expect("写旧版本号");

        let reopened = temp.reopen();
        assert_eq!(
            reopened.meta("schema_version").expect("读 meta"),
            Some(SCHEMA_VERSION.to_owned())
        );
    }
}
