//! 基本属性：用户自己填的非解剖数据（`GLOSSARY.md`「基本属性」）。
//!
//! 四个字段都可以留空，留空就是「未填」——不是「正常」，也不是 0。基础疾病与旧伤、
//! 个人情况都是自由文本的清单，可增删。区间的唯一作用是挡住手误，不是医学判断。

use serde::{Deserialize, Serialize};

use super::DomainError;

/// 性别。「不填」是 `None`，不是第三种取值。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Sex {
    Female,
    Male,
}

impl Sex {
    /// 机器可读的取值。
    pub fn key(self) -> &'static str {
        match self {
            Sex::Female => "female",
            Sex::Male => "male",
        }
    }

    /// 显示用的中文名。
    pub fn zh(self) -> &'static str {
        match self {
            Sex::Female => "女",
            Sex::Male => "男",
        }
    }

    /// 从机器键或中文解析。
    pub fn from_key(raw: &str) -> Option<Sex> {
        match raw.trim() {
            "female" | "女" => Some(Sex::Female),
            "male" | "男" => Some(Sex::Male),
            _ => None,
        }
    }
}

/// 年龄的合理区间。
pub const AGE_RANGE: (u8, u8) = (1, 120);

/// 基本属性：年龄、性别、基础疾病或旧伤、个人情况。
///
/// 身高与体重不在这里：它们是**测量**（`domain::measurement`），每次记录都
/// 追加一条带时间的值。界面上的「当前身高/体重」是那条序列里最新的一条。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[non_exhaustive]
pub struct Basics {
    pub sex: Option<Sex>,
    pub age: Option<u8>,
    /// 基础疾病或旧伤：自由文本，可增删。
    #[serde(default)]
    pub conditions: Vec<String>,
    /// 个人情况：用户自述的补充背景，自由文本，可增删。
    #[serde(default)]
    pub personal_context: Vec<String>,
}

impl Basics {
    /// 全空：冷启动时用它判断要不要进引导。
    pub fn new() -> Basics {
        Basics::default()
    }

    /// 所有字段与两个清单都空。
    pub fn is_empty(&self) -> bool {
        self.sex.is_none()
            && self.age.is_none()
            && self.conditions.is_empty()
            && self.personal_context.is_empty()
    }

    /// 落库前的校验：只拦明显的手误。
    pub fn validate(&self) -> Result<(), DomainError> {
        if let Some(age) = self.age {
            let age = f64::from(age);
            if !(f64::from(AGE_RANGE.0)..=f64::from(AGE_RANGE.1)).contains(&age) {
                return Err(DomainError::OutOfRange {
                    field: "年龄",
                    min: f64::from(AGE_RANGE.0),
                    max: f64::from(AGE_RANGE.1),
                    value: age,
                });
            }
        }
        validate_text_list(
            &self.conditions,
            DomainError::EmptyCondition,
            DomainError::DuplicateCondition,
        )?;
        validate_text_list(
            &self.personal_context,
            DomainError::EmptyPersonalContext,
            DomainError::DuplicatePersonalContext,
        )?;
        Ok(())
    }

    /// 加一条基础疾病；空白与重复被拒。
    pub fn add_condition(&mut self, text: &str) -> Result<(), DomainError> {
        let text = text.trim();
        if text.is_empty() {
            return Err(DomainError::EmptyCondition);
        }
        if self.conditions.iter().any(|existing| existing == text) {
            return Err(DomainError::DuplicateCondition(text.to_owned()));
        }
        self.conditions.push(text.to_owned());
        Ok(())
    }

    /// 删一条；返回是否真的删到了。
    pub fn remove_condition(&mut self, text: &str) -> bool {
        let before = self.conditions.len();
        self.conditions.retain(|condition| condition != text);
        self.conditions.len() != before
    }

    /// 加一条个人情况；空白与重复被拒。
    pub fn add_personal_context(&mut self, text: &str) -> Result<(), DomainError> {
        let text = text.trim();
        if text.is_empty() {
            return Err(DomainError::EmptyPersonalContext);
        }
        if self
            .personal_context
            .iter()
            .any(|existing| existing == text)
        {
            return Err(DomainError::DuplicatePersonalContext(text.to_owned()));
        }
        self.personal_context.push(text.to_owned());
        Ok(())
    }

    /// 删一条个人情况；返回是否真的删到了。
    pub fn remove_personal_context(&mut self, text: &str) -> bool {
        let before = self.personal_context.len();
        self.personal_context.retain(|entry| entry != text);
        self.personal_context.len() != before
    }
}

fn validate_text_list(
    list: &[String],
    empty: DomainError,
    duplicate: impl Fn(String) -> DomainError,
) -> Result<(), DomainError> {
    for (index, item) in list.iter().enumerate() {
        let text = item.trim();
        if text.is_empty() {
            return Err(empty);
        }
        if list[..index].iter().any(|previous| previous.trim() == text) {
            return Err(duplicate(text.to_owned()));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn basics() -> Basics {
        Basics {
            sex: Some(Sex::Female),
            age: Some(32),
            conditions: vec!["右侧踝关节扭伤过两次".to_owned()],
            personal_context: vec!["有健身房训练经历，肌肉量较大".to_owned()],
        }
    }

    #[test]
    fn a_fresh_basics_is_empty_and_that_is_not_zero() {
        let empty = Basics::new();
        assert!(empty.is_empty());
        assert_eq!(empty.sex, None);
        assert_eq!(empty.age, None);
        assert!(empty.personal_context.is_empty());
    }

    #[test]
    fn ranges_are_checked_because_typos_are_the_common_case() {
        let cases: &[(Basics, DomainError)] = &[
            (
                Basics {
                    age: Some(0),
                    ..Basics::new()
                },
                DomainError::OutOfRange {
                    field: "年龄",
                    min: 1.0,
                    max: 120.0,
                    value: 0.0,
                },
            ),
            (
                Basics {
                    age: Some(121),
                    ..Basics::new()
                },
                DomainError::OutOfRange {
                    field: "年龄",
                    min: 1.0,
                    max: 120.0,
                    value: 121.0,
                },
            ),

        ];
        for (case, expected) in cases {
            let error = case.validate().expect_err("应当被拒");
            assert_eq!(&error, expected);
            assert!(!error.to_string().is_empty());
        }
        assert!(basics().validate().is_ok());
    }

    #[test]
    fn conditions_are_a_list_you_can_add_and_remove() {
        let mut basics = Basics::new();
        basics.add_condition("  腰椎间盘突出 ").expect("加一条");
        basics.add_condition("右侧踝关节扭伤过两次").expect("加第二条");
        assert_eq!(
            basics.conditions,
            vec!["腰椎间盘突出".to_owned(), "右侧踝关节扭伤过两次".to_owned()]
        );

        // 空白与重复被拒，清单不受影响。
        assert_eq!(basics.add_condition("   "), Err(DomainError::EmptyCondition));
        assert_eq!(
            basics.add_condition("腰椎间盘突出"),
            Err(DomainError::DuplicateCondition("腰椎间盘突出".to_owned()))
        );
        assert_eq!(basics.conditions.len(), 2);

        assert!(basics.remove_condition("腰椎间盘突出"));
        assert!(!basics.remove_condition("腰椎间盘突出"));
        assert_eq!(basics.conditions, vec!["右侧踝关节扭伤过两次".to_owned()]);
    }

    #[test]
    fn personal_context_is_a_list_you_can_add_and_remove() {
        let mut basics = Basics::new();
        basics
            .add_personal_context("  有健身房训练经历 ")
            .expect("加一条");
        basics.add_personal_context("肌肉量较大").expect("加第二条");
        assert_eq!(
            basics.personal_context,
            vec!["有健身房训练经历".to_owned(), "肌肉量较大".to_owned()]
        );

        // 空白与重复被拒，清单不受影响。
        assert_eq!(
            basics.add_personal_context("   "),
            Err(DomainError::EmptyPersonalContext)
        );
        assert_eq!(
            basics.add_personal_context("有健身房训练经历"),
            Err(DomainError::DuplicatePersonalContext(
                "有健身房训练经历".to_owned()
            ))
        );
        assert_eq!(basics.personal_context.len(), 2);

        assert!(basics.remove_personal_context("有健身房训练经历"));
        assert!(!basics.remove_personal_context("有健身房训练经历"));
        assert_eq!(basics.personal_context, vec!["肌肉量较大".to_owned()]);
    }

    #[test]
    fn blank_personal_context_is_refused_before_saving() {
        let basics = Basics {
            personal_context: vec!["  ".to_owned()],
            ..Basics::new()
        };
        assert_eq!(basics.validate(), Err(DomainError::EmptyPersonalContext));
    }

    #[test]
    fn duplicates_are_refused_before_saving() {
        let duplicate_conditions = Basics {
            conditions: vec!["腰椎间盘突出".to_owned(), " 腰椎间盘突出 ".to_owned()],
            ..Basics::new()
        };
        assert_eq!(
            duplicate_conditions.validate(),
            Err(DomainError::DuplicateCondition("腰椎间盘突出".to_owned()))
        );

        let duplicate_personal = Basics {
            personal_context: vec![
                "有健身房训练经历".to_owned(),
                " 有健身房训练经历 ".to_owned(),
            ],
            ..Basics::new()
        };
        assert_eq!(
            duplicate_personal.validate(),
            Err(DomainError::DuplicatePersonalContext(
                "有健身房训练经历".to_owned()
            ))
        );
    }

    #[test]
    fn round_trips_through_json() {
        let original = basics();
        let json = serde_json::to_string(&original).expect("序列化");
        let back: Basics = serde_json::from_str(&json).expect("反序列化");
        assert_eq!(back, original);
        // 未填的字段不出现在 JSON 里，读回来仍是 None。
        let empty: Basics = serde_json::from_str("{}").expect("空对象");
        assert!(empty.is_empty());
    }

    #[test]
    fn old_basics_json_without_personal_context_still_reads() {
        let old = r#"{"sex":"female","age":32,"conditions":["右侧踝关节扭伤过两次"]}"#;
        let basics: Basics = serde_json::from_str(old).expect("旧库");
        assert_eq!(basics.sex, Some(Sex::Female));
        assert_eq!(basics.age, Some(32));
        assert_eq!(basics.conditions, vec!["右侧踝关节扭伤过两次".to_owned()]);
        assert!(basics.personal_context.is_empty());
    }

    #[test]
    fn sex_parses_both_keys_and_chinese() {
        assert_eq!(Sex::from_key("female"), Some(Sex::Female));
        assert_eq!(Sex::from_key("女"), Some(Sex::Female));
        assert_eq!(Sex::from_key("男"), Some(Sex::Male));
        assert_eq!(Sex::from_key("不填"), None);
        assert_eq!(Sex::Female.key(), "female");
    }
}
