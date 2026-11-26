//! 基本属性与训练条件的存储。
//!
//! 两者各自是一条单例记录，键分别是 `basics` 与 `training`；引导是否走完是 `onboarded`。
//! 读的时候缺键就是「还没填」——返回空结构而不是报错。

use redb::{ReadableDatabase, TableDefinition};

use super::{db_error, Store, StoreError};
use crate::domain::{Basics, TrainingContext};

/// 档案里的单例记录：`basics`、`training`、`onboarded`。
pub(crate) const PROFILE: TableDefinition<&str, &str> = TableDefinition::new("profile");

const BASICS: &str = "basics";
const TRAINING: &str = "training";
const ONBOARDED: &str = "onboarded";

impl Store {
    /// 基本属性；没填过就是空的那一份。
    pub fn basics(&self) -> Result<Basics, StoreError> {
        match self.read_profile(BASICS)? {
            Some(json) => from_json(&json),
            None => Ok(Basics::new()),
        }
    }

    /// 保存基本属性（先校验）。
    pub fn save_basics(&self, basics: &Basics) -> Result<(), StoreError> {
        basics.validate()?;
        self.write_profile(BASICS, &to_json(basics)?)
    }

    /// 训练条件；没填过就是空的那一份（`readiness()` 会说缺四项）。
    pub fn training(&self) -> Result<TrainingContext, StoreError> {
        match self.read_profile(TRAINING)? {
            Some(json) => from_json(&json),
            None => Ok(TrainingContext::new()),
        }
    }

    /// 保存训练条件（先校验）。
    pub fn save_training(&self, training: &TrainingContext) -> Result<(), StoreError> {
        training.validate()?;
        self.write_profile(TRAINING, &to_json(training)?)
    }

    /// 引导是否已走完。
    pub fn onboarded(&self) -> Result<bool, StoreError> {
        Ok(self.read_profile(ONBOARDED)?.as_deref() == Some("true"))
    }

    /// 标记引导走完（或撤回这个标记）。
    pub fn set_onboarded(&self, onboarded: bool) -> Result<(), StoreError> {
        self.write_profile(ONBOARDED, if onboarded { "true" } else { "false" })
    }

    fn read_profile(&self, key: &str) -> Result<Option<String>, StoreError> {
        let read = self.db().begin_read().map_err(db_error)?;
        let table = read.open_table(PROFILE).map_err(db_error)?;
        Ok(table
            .get(key)
            .map_err(db_error)?
            .map(|value| value.value().to_owned()))
    }

    fn write_profile(&self, key: &str, value: &str) -> Result<(), StoreError> {
        let write = self.db().begin_write().map_err(db_error)?;
        {
            let mut table = write.open_table(PROFILE).map_err(db_error)?;
            table.insert(key, value).map_err(db_error)?;
        }
        write.commit().map_err(db_error)
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
    use crate::domain::{DomainError, Place, Sex, TrainingField};
    use crate::store::tests::TempStore;

    fn basics() -> Basics {
        Basics {
            sex: Some(Sex::Female),
            age: Some(32),
            conditions: vec!["右侧踝关节扭伤过两次".to_owned()],
            personal_context: vec!["有健身房训练经历，肌肉量较大".to_owned()],
        }
    }

    fn training() -> TrainingContext {
        TrainingContext {
            days_per_week: Some(3),
            minutes_per_session: Some(30),
            places: vec![Place::Home],
            equipment: vec!["band".to_owned()],
        }
    }

    #[test]
    fn an_empty_store_reads_as_unfilled_not_as_zero() {
        let temp = TempStore::new("profile-empty");
        let store = temp.store();
        assert!(store.basics().expect("读基本属性").is_empty());
        assert!(!store.training().expect("读训练条件").is_ready());
        assert!(!store.onboarded().expect("读引导标记"));
    }

    #[test]
    fn basics_and_training_survive_reopening_the_file() {
        let mut temp = TempStore::new("profile-persist");
        temp.store().save_basics(&basics()).expect("存基本属性");
        temp.store().save_training(&training()).expect("存训练条件");
        temp.store().set_onboarded(true).expect("标记引导");

        let reopened = temp.reopen();
        assert_eq!(reopened.basics().expect("读基本属性"), basics());
        assert_eq!(reopened.training().expect("读训练条件"), training());
        assert!(reopened.onboarded().expect("读引导标记"));
        assert!(reopened.training().expect("读训练条件").readiness().is_ready());
    }

    #[test]
    fn an_old_basics_record_without_personal_context_reads_as_empty() {
        let temp = TempStore::new("profile-old-basics");
        temp.store()
            .write_profile(
                BASICS,
                r#"{"sex":"female","age":32,"conditions":["右侧踝关节扭伤过两次"]}"#,
            )
            .expect("写旧记录");
        let basics = temp.store().basics().expect("读旧记录");
        assert_eq!(basics.conditions, vec!["右侧踝关节扭伤过两次".to_owned()]);
        assert!(basics.personal_context.is_empty());
    }

    #[test]
    fn saving_refuses_what_the_domain_refuses() {
        let temp = TempStore::new("profile-invalid");
        let bad = Basics {
            age: Some(200),
            ..Basics::new()
        };
        assert_eq!(
            temp.store().save_basics(&bad).unwrap_err(),
            StoreError::Domain(DomainError::OutOfRange {
                field: "年龄",
                min: 1.0,
                max: 120.0,
                value: 200.0,
            })
        );
        assert!(temp.store().basics().expect("读基本属性").is_empty());

        let bad_training = TrainingContext {
            days_per_week: Some(9),
            ..TrainingContext::new()
        };
        assert_eq!(
            temp.store().save_training(&bad_training).unwrap_err(),
            StoreError::Domain(DomainError::OutOfRange {
                field: "每周能练几天",
                min: 1.0,
                max: 7.0,
                value: 9.0,
            })
        );
    }

    #[test]
    fn duplicate_personal_context_is_refused_on_save() {
        let temp = TempStore::new("profile-duplicate-personal-context");
        let bad = Basics {
            personal_context: vec![
                "有健身房训练经历".to_owned(),
                " 有健身房训练经历 ".to_owned(),
            ],
            ..Basics::new()
        };
        assert_eq!(
            temp.store().save_basics(&bad).unwrap_err(),
            StoreError::Domain(DomainError::DuplicatePersonalContext(
                "有健身房训练经历".to_owned()
            ))
        );
    }

    #[test]
    fn readiness_reports_what_is_missing_after_a_partial_save() {
        let temp = TempStore::new("profile-partial");
        temp.store()
            .save_training(&TrainingContext {
                days_per_week: Some(2),
                ..TrainingContext::new()
            })
            .expect("存部分训练条件");
        let readiness = temp.store().training().expect("读训练条件").readiness();
        assert_eq!(
            readiness.missing(),
            &[
                TrainingField::MinutesPerSession,
                TrainingField::Places,
                TrainingField::Equipment
            ]
        );
    }
}
