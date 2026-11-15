//! 基本属性：用户自己填的非解剖数据（`GLOSSARY.md`「基本属性」）。
//!
//! 四个字段都可以留空，留空就是「未填」——不是「正常」，也不是 0。基础疾病与旧伤
//! 是自由文本的清单，可增删。区间的唯一作用是挡住手误，不是医学判断。

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
/// 身高的合理区间，厘米。
pub const HEIGHT_CM_RANGE: (f64, f64) = (50.0, 250.0);
/// 体重的合理区间，千克。
pub const WEIGHT_KG_RANGE: (f64, f64) = (20.0, 400.0);

/// 基本属性：年龄、性别、身高体重、基础疾病。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Basics {
    pub sex: Option<Sex>,
    pub age: Option<u8>,
    /// 厘米。
    pub height_cm: Option<f64>,
    /// 千克。
    pub weight_kg: Option<f64>,
    /// 基础疾病或旧伤：自由文本，可增删。
    #[serde(default)]
    pub conditions: Vec<String>,
}

impl Basics {
    /// 全空：冷启动时用它判断要不要进引导。
    pub fn new() -> Basics {
        Basics::default()
    }

    /// 四个字段与疾病清单都空。
    pub fn is_empty(&self) -> bool {
        self.sex.is_none()
            && self.age.is_none()
            && self.height_cm.is_none()
            && self.weight_kg.is_none()
            && self.conditions.is_empty()
    }

    /// 身高体重都填了（#5 的测量用它判断有没有基线）。
    pub fn has_body_metrics(&self) -> bool {
        self.height_cm.is_some() && self.weight_kg.is_some()
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
        if let Some(height) = self.height_cm {
            if !height.is_finite() || !(HEIGHT_CM_RANGE.0..=HEIGHT_CM_RANGE.1).contains(&height) {
                return Err(DomainError::OutOfRange {
                    field: "身高（厘米）",
                    min: HEIGHT_CM_RANGE.0,
                    max: HEIGHT_CM_RANGE.1,
                    value: height,
                });
            }
        }
        if let Some(weight) = self.weight_kg {
            if !weight.is_finite() || !(WEIGHT_KG_RANGE.0..=WEIGHT_KG_RANGE.1).contains(&weight) {
                return Err(DomainError::OutOfRange {
                    field: "体重（千克）",
                    min: WEIGHT_KG_RANGE.0,
                    max: WEIGHT_KG_RANGE.1,
                    value: weight,
                });
            }
        }
        for condition in &self.conditions {
            if condition.trim().is_empty() {
                return Err(DomainError::EmptyCondition);
            }
        }
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
}

#[cfg(test)]
mod tests {
    use super::*;

    fn basics() -> Basics {
        Basics {
            sex: Some(Sex::Female),
            age: Some(32),
            height_cm: Some(168.0),
            weight_kg: Some(62.4),
            conditions: vec!["右侧踝关节扭伤过两次".to_owned()],
        }
    }

    #[test]
    fn a_fresh_basics_is_empty_and_that_is_not_zero() {
        let empty = Basics::new();
        assert!(empty.is_empty());
        assert!(!empty.has_body_metrics());
        assert_eq!(empty.sex, None);
        assert_eq!(empty.age, None);
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
            (
                Basics {
                    height_cm: Some(9.0),
                    ..Basics::new()
                },
                DomainError::OutOfRange {
                    field: "身高（厘米）",
                    min: 50.0,
                    max: 250.0,
                    value: 9.0,
                },
            ),
            (
                Basics {
                    weight_kg: Some(999.0),
                    ..Basics::new()
                },
                DomainError::OutOfRange {
                    field: "体重（千克）",
                    min: 20.0,
                    max: 400.0,
                    value: 999.0,
                },
            ),

        ];
        for (case, expected) in cases {
            let error = case.validate().expect_err("应当被拒");
            assert_eq!(&error, expected);
            assert!(!error.to_string().is_empty());
        }
        // NaN 与任何值都不相等，单独断言（它也是一种手误）。
        let nan = Basics {
            weight_kg: Some(f64::NAN),
            ..Basics::new()
        };
        assert!(matches!(
            nan.validate(),
            Err(DomainError::OutOfRange { field: "体重（千克）", .. })
        ));
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
    fn sex_parses_both_keys_and_chinese() {
        assert_eq!(Sex::from_key("female"), Some(Sex::Female));
        assert_eq!(Sex::from_key("女"), Some(Sex::Female));
        assert_eq!(Sex::from_key("男"), Some(Sex::Male));
        assert_eq!(Sex::from_key("不填"), None);
        assert_eq!(Sex::Female.key(), "female");
    }
}
