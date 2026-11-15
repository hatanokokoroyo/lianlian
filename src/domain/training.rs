//! 训练条件：每周几天、每次多久、在哪练、有什么器械。
//!
//! 它不是「计划」的一部分，而是计划的前提：齐全性由 `readiness()` 回答，缺项的
//! 时候下游（计划生成）必须拒绝排计划、agent 必须追问，而不是硬塞一套做不了的
//! 方案（spec User Story 6）。

use serde::{Deserialize, Serialize};

use super::DomainError;

/// 每周能练几天：1–7。
pub const DAYS_PER_WEEK_RANGE: (u8, u8) = (1, 7);
/// 每次多久：分钟，5–180。
pub const MINUTES_RANGE: (u16, u16) = (5, 180);
/// 「什么都没有」这一项的标签：它自己占一项，且与其他器械互斥。
pub const NO_EQUIPMENT: &str = "nothing";

/// 在哪练。可多选。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Place {
    Home,
    Gym,
    Office,
    Outdoor,
}

impl Place {
    /// 全部取值，按显示顺序。
    pub const ALL: [Place; 4] = [Place::Home, Place::Gym, Place::Office, Place::Outdoor];

    /// 机器可读的取值。
    pub fn key(self) -> &'static str {
        match self {
            Place::Home => "home",
            Place::Gym => "gym",
            Place::Office => "office",
            Place::Outdoor => "outdoor",
        }
    }

    /// 显示用的中文名。
    pub fn zh(self) -> &'static str {
        match self {
            Place::Home => "家",
            Place::Gym => "健身房",
            Place::Office => "办公室",
            Place::Outdoor => "户外",
        }
    }

    /// 从机器键或中文解析。
    pub fn from_key(raw: &str) -> Option<Place> {
        Place::ALL.into_iter().find(|place| {
            place.key() == raw.trim()
                || place.zh() == raw.trim()
                || matches!(
                    (place, raw.trim()),
                    (Place::Home, "家里") | (Place::Gym, "馆") | (Place::Outdoor, "室外")
                )
        })
    }
}

/// 训练条件里会缺的一项。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TrainingField {
    DaysPerWeek,
    MinutesPerSession,
    Places,
    Equipment,
}

impl TrainingField {
    /// 全部四项，按显示顺序。
    pub const ALL: [TrainingField; 4] = [
        TrainingField::DaysPerWeek,
        TrainingField::MinutesPerSession,
        TrainingField::Places,
        TrainingField::Equipment,
    ];

    /// 机器可读的键（下游判断、日志、工具参数都用它）。
    pub fn key(self) -> &'static str {
        match self {
            TrainingField::DaysPerWeek => "days-per-week",
            TrainingField::MinutesPerSession => "minutes-per-session",
            TrainingField::Places => "places",
            TrainingField::Equipment => "equipment",
        }
    }

    /// 显示用的中文名，直接进提示文案。
    pub fn zh(self) -> &'static str {
        match self {
            TrainingField::DaysPerWeek => "每周能练几天",
            TrainingField::MinutesPerSession => "每次多久",
            TrainingField::Places => "在哪练",
            TrainingField::Equipment => "手边有什么",
        }
    }
}

/// 训练条件是否齐全：齐全，还是缺哪几项。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Readiness {
    missing: Vec<TrainingField>,
}

impl Readiness {
    /// 四项都填了。
    pub fn is_ready(&self) -> bool {
        self.missing.is_empty()
    }

    /// 缺的项，按显示顺序。
    pub fn missing(&self) -> &[TrainingField] {
        &self.missing
    }

    /// 缺项的机器键，给下游与日志用。
    pub fn missing_keys(&self) -> Vec<&'static str> {
        self.missing.iter().map(|field| field.key()).collect()
    }

    /// 缺项的中文名，直接拼进提示。
    pub fn missing_zh(&self) -> Vec<&'static str> {
        self.missing.iter().map(|field| field.zh()).collect()
    }
}

/// 训练条件。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct TrainingContext {
    pub days_per_week: Option<u8>,
    /// 分钟。
    pub minutes_per_session: Option<u16>,
    /// 在哪练，可多选。
    #[serde(default)]
    pub places: Vec<Place>,
    /// 手边有什么：自由文本的清单；`NO_EQUIPMENT` 表示「什么都没有」。
    #[serde(default)]
    pub equipment: Vec<String>,
}

impl TrainingContext {
    /// 全空。
    pub fn new() -> TrainingContext {
        TrainingContext::default()
    }

    /// 落库前的校验：只拦明显的手误。
    pub fn validate(&self) -> Result<(), DomainError> {
        if let Some(days) = self.days_per_week {
            if !(DAYS_PER_WEEK_RANGE.0..=DAYS_PER_WEEK_RANGE.1).contains(&days) {
                return Err(DomainError::OutOfRange {
                    field: "每周能练几天",
                    min: f64::from(DAYS_PER_WEEK_RANGE.0),
                    max: f64::from(DAYS_PER_WEEK_RANGE.1),
                    value: f64::from(days),
                });
            }
        }
        if let Some(minutes) = self.minutes_per_session {
            if !(MINUTES_RANGE.0..=MINUTES_RANGE.1).contains(&minutes) {
                return Err(DomainError::OutOfRange {
                    field: "每次多久（分钟）",
                    min: f64::from(MINUTES_RANGE.0),
                    max: f64::from(MINUTES_RANGE.1),
                    value: f64::from(minutes),
                });
            }
        }
        let nothing = self
            .equipment
            .iter()
            .any(|label| label == NO_EQUIPMENT);
        if nothing && self.equipment.len() > 1 {
            return Err(DomainError::NoEquipmentExclusive);
        }
        for label in &self.equipment {
            if label.trim().is_empty() {
                return Err(DomainError::EmptyEquipment);
            }
        }
        Ok(())
    }

    /// 齐全性：缺哪几项。下游据此拒绝排计划。
    pub fn readiness(&self) -> Readiness {
        let mut missing = Vec::new();
        if self.days_per_week.is_none() {
            missing.push(TrainingField::DaysPerWeek);
        }
        if self.minutes_per_session.is_none() {
            missing.push(TrainingField::MinutesPerSession);
        }
        if self.places.is_empty() {
            missing.push(TrainingField::Places);
        }
        if self.equipment.is_empty() {
            missing.push(TrainingField::Equipment);
        }
        Readiness { missing }
    }

    /// 齐全。
    pub fn is_ready(&self) -> bool {
        self.readiness().is_ready()
    }

    /// 加一项器械。「什么都没有」与其他器械互斥：加它就清空别的，加别的就清掉它。
    pub fn add_equipment(&mut self, label: &str) -> Result<(), DomainError> {
        let label = label.trim();
        if label.is_empty() {
            return Err(DomainError::EmptyEquipment);
        }
        if self.equipment.iter().any(|existing| existing == label) {
            return Err(DomainError::DuplicateEquipment(label.to_owned()));
        }
        if label == NO_EQUIPMENT {
            self.equipment.clear();
        } else {
            self.equipment.retain(|existing| existing != NO_EQUIPMENT);
        }
        self.equipment.push(label.to_owned());
        Ok(())
    }

    /// 删一项器械；返回是否真的删到了。
    pub fn remove_equipment(&mut self, label: &str) -> bool {
        let before = self.equipment.len();
        self.equipment.retain(|existing| existing != label);
        self.equipment.len() != before
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ready() -> TrainingContext {
        TrainingContext {
            days_per_week: Some(3),
            minutes_per_session: Some(30),
            places: vec![Place::Home],
            equipment: vec!["band".to_owned(), "dumbbell-8kg".to_owned()],
        }
    }

    #[test]
    fn readiness_lists_exactly_what_is_missing() {
        // 表驱动：每一项单独缺，缺的清单都要对，且顺序固定。
        let cases: &[(TrainingContext, &[TrainingField])] = &[
            (TrainingContext::new(), &TrainingField::ALL),
            (
                TrainingContext {
                    days_per_week: Some(3),
                    ..TrainingContext::new()
                },
                &[
                    TrainingField::MinutesPerSession,
                    TrainingField::Places,
                    TrainingField::Equipment,
                ],
            ),
            (
                TrainingContext {
                    days_per_week: Some(2),
                    minutes_per_session: Some(15),
                    places: vec![Place::Gym],
                    ..TrainingContext::new()
                },
                &[TrainingField::Equipment],
            ),
            (
                TrainingContext {
                    minutes_per_session: Some(45),
                    ..TrainingContext::new()
                },
                &[
                    TrainingField::DaysPerWeek,
                    TrainingField::Places,
                    TrainingField::Equipment,
                ],
            ),
        ];
        for (context, expected) in cases {
            let readiness = context.readiness();
            assert_eq!(
                readiness.missing(),
                *expected,
                "缺项清单不对：{context:?}"
            );
            assert_eq!(readiness.is_ready(), expected.is_empty());
        }

        let ready = ready();
        assert!(ready.readiness().is_ready());
        assert!(ready.readiness().missing().is_empty());
        assert!(ready.readiness().missing_keys().is_empty());

        let empty = TrainingContext::new();
        assert_eq!(
            empty.readiness().missing_keys(),
            vec!["days-per-week", "minutes-per-session", "places", "equipment"]
        );
        assert_eq!(
            empty.readiness().missing_zh(),
            vec!["每周能练几天", "每次多久", "在哪练", "手边有什么"]
        );
    }

    #[test]
    fn ranges_are_checked() {
        let cases: &[(TrainingContext, DomainError)] = &[
            (
                TrainingContext {
                    days_per_week: Some(0),
                    ..TrainingContext::new()
                },
                DomainError::OutOfRange {
                    field: "每周能练几天",
                    min: 1.0,
                    max: 7.0,
                    value: 0.0,
                },
            ),
            (
                TrainingContext {
                    days_per_week: Some(8),
                    ..TrainingContext::new()
                },
                DomainError::OutOfRange {
                    field: "每周能练几天",
                    min: 1.0,
                    max: 7.0,
                    value: 8.0,
                },
            ),
            (
                TrainingContext {
                    minutes_per_session: Some(1),
                    ..TrainingContext::new()
                },
                DomainError::OutOfRange {
                    field: "每次多久（分钟）",
                    min: 5.0,
                    max: 180.0,
                    value: 1.0,
                },
            ),
        ];
        for (case, expected) in cases {
            assert_eq!(&case.validate().expect_err("应当被拒"), expected);
        }
        assert!(ready().validate().is_ok());
    }

    #[test]
    fn no_equipment_is_exclusive() {
        let mut context = TrainingContext::new();
        context.add_equipment("band").expect("加弹力带");
        context.add_equipment(NO_EQUIPMENT).expect("改成什么都没有");
        assert_eq!(context.equipment, vec![NO_EQUIPMENT.to_owned()]);

        context.add_equipment("mat").expect("再加瑜伽垫");
        assert_eq!(context.equipment, vec!["mat".to_owned()]);
        assert!(context.validate().is_ok());

        // 手工构造的冲突组合会被校验挡住。
        let conflict = TrainingContext {
            equipment: vec![NO_EQUIPMENT.to_owned(), "mat".to_owned()],
            ..TrainingContext::new()
        };
        assert_eq!(
            conflict.validate().expect_err("冲突"),
            DomainError::NoEquipmentExclusive
        );
    }

    #[test]
    fn equipment_is_a_list_you_can_add_and_remove() {
        let mut context = TrainingContext::new();
        context.add_equipment("band").expect("加");
        context.add_equipment("dumbbell-8kg").expect("加");
        assert_eq!(context.equipment.len(), 2);
        assert_eq!(
            context.add_equipment("band"),
            Err(DomainError::DuplicateEquipment("band".to_owned()))
        );
        assert!(context.remove_equipment("band"));
        assert!(!context.remove_equipment("band"));
        assert_eq!(context.equipment, vec!["dumbbell-8kg".to_owned()]);
    }

    #[test]
    fn places_parse_keys_and_chinese() {
        assert_eq!(Place::from_key("home"), Some(Place::Home));
        assert_eq!(Place::from_key("家"), Some(Place::Home));
        assert_eq!(Place::from_key("健身房"), Some(Place::Gym));
        assert_eq!(Place::from_key("火星"), None);
        assert_eq!(Place::Outdoor.key(), "outdoor");
        assert_eq!(Place::ALL.len(), 4);
    }

    #[test]
    fn round_trips_through_json() {
        let original = ready();
        let json = serde_json::to_string(&original).expect("序列化");
        let back: TrainingContext = serde_json::from_str(&json).expect("反序列化");
        assert_eq!(back, original);
        let empty: TrainingContext = serde_json::from_str("{}").expect("空对象");
        assert!(!empty.is_ready());
    }
}
