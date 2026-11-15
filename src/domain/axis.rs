//! 五条状态轴与它们的取值（ADR-0004）。
//!
//! 取值全部是枚举，没有自由文本：2D/3D 着色、趋势比较、计划生成都要可机读。
//! 加一条轴意味着改数据结构、配色与计划生成，所以要走新 ADR，不随手加。

use serde::{Deserialize, Serialize};

use super::DomainError;

/// 五条轴。顺序就是档案页与工具参数里的顺序。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Axis {
    /// 张力。
    Tension,
    /// 对称。
    Symmetry,
    /// 活动度。
    Mobility,
    /// 疼痛。
    Pain,
    /// 稳定性。
    Stability,
}

impl Axis {
    /// 全部五条，按显示顺序。
    pub const ALL: [Axis; 5] = [
        Axis::Tension,
        Axis::Symmetry,
        Axis::Mobility,
        Axis::Pain,
        Axis::Stability,
    ];

    /// 机器可读的键（工具参数、存储、日志都用它）。
    pub fn key(self) -> &'static str {
        match self {
            Axis::Tension => "tension",
            Axis::Symmetry => "symmetry",
            Axis::Mobility => "mobility",
            Axis::Pain => "pain",
            Axis::Stability => "stability",
        }
    }

    /// 显示用的中文名。
    pub fn zh(self) -> &'static str {
        match self {
            Axis::Tension => "张力",
            Axis::Symmetry => "对称",
            Axis::Mobility => "活动度",
            Axis::Pain => "疼痛",
            Axis::Stability => "稳定性",
        }
    }

    /// 这条轴的可选值，写进错误文案。
    pub fn values_hint(self) -> &'static str {
        match self {
            Axis::Tension => "weak / normal / tight",
            Axis::Symmetry => "left-weak / right-weak / symmetric",
            Axis::Mobility => "limited / normal",
            Axis::Pain => "0–10（0 表示无痛）",
            Axis::Stability => "poor / normal",
        }
    }

    /// 这条轴「正常」的取值：解决一条判定时用它补齐。
    pub fn normal(self) -> AxisValue {
        match self {
            Axis::Tension => AxisValue::Tension(Tension::Normal),
            Axis::Symmetry => AxisValue::Symmetry(Symmetry::Symmetric),
            Axis::Mobility => AxisValue::Mobility(Mobility::Normal),
            Axis::Pain => AxisValue::Pain(Pain::NONE),
            Axis::Stability => AxisValue::Stability(Stability::Normal),
        }
    }

    /// 从机器键解析。
    pub fn from_key(raw: &str) -> Option<Axis> {
        Axis::ALL.into_iter().find(|axis| axis.key() == raw)
    }

    /// 这条轴的取值解析：接受机器键，也接受中文名（模型与用户都会说中文）。
    pub fn parse(self, raw: &str) -> Result<AxisValue, DomainError> {
        let value = raw.trim();
        let unknown = || DomainError::UnknownAxisValue {
            axis: self,
            value: raw.to_owned(),
        };
        match self {
            Axis::Tension => {
                let parsed = match value {
                    "weak" | "弱" => Tension::Weak,
                    "normal" | "正常" => Tension::Normal,
                    "tight" | "紧" => Tension::Tight,
                    _ => return Err(unknown()),
                };
                Ok(AxisValue::Tension(parsed))
            }
            Axis::Symmetry => {
                let parsed = match value {
                    "left-weak" | "left_weak" | "左弱" => Symmetry::LeftWeak,
                    "right-weak" | "right_weak" | "右弱" => Symmetry::RightWeak,
                    "symmetric" | "对称" => Symmetry::Symmetric,
                    _ => return Err(unknown()),
                };
                Ok(AxisValue::Symmetry(parsed))
            }
            Axis::Mobility => {
                let parsed = match value {
                    "limited" | "受限" => Mobility::Limited,
                    "normal" | "正常" => Mobility::Normal,
                    _ => return Err(unknown()),
                };
                Ok(AxisValue::Mobility(parsed))
            }
            Axis::Pain => Pain::parse(value).map(AxisValue::Pain),
            Axis::Stability => {
                let parsed = match value {
                    "poor" | "差" => Stability::Poor,
                    "normal" | "正常" => Stability::Normal,
                    _ => return Err(unknown()),
                };
                Ok(AxisValue::Stability(parsed))
            }
        }
    }
}

/// 张力：弱 / 正常 / 紧。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Tension {
    Weak,
    Normal,
    Tight,
}

impl Tension {
    pub fn key(self) -> &'static str {
        match self {
            Tension::Weak => "weak",
            Tension::Normal => "normal",
            Tension::Tight => "tight",
        }
    }

    pub fn zh(self) -> &'static str {
        match self {
            Tension::Weak => "弱",
            Tension::Normal => "正常",
            Tension::Tight => "紧",
        }
    }
}

/// 对称：左弱 / 右弱 / 对称。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Symmetry {
    LeftWeak,
    RightWeak,
    Symmetric,
}

impl Symmetry {
    pub fn key(self) -> &'static str {
        match self {
            Symmetry::LeftWeak => "left-weak",
            Symmetry::RightWeak => "right-weak",
            Symmetry::Symmetric => "symmetric",
        }
    }

    pub fn zh(self) -> &'static str {
        match self {
            Symmetry::LeftWeak => "左弱",
            Symmetry::RightWeak => "右弱",
            Symmetry::Symmetric => "对称",
        }
    }
}

/// 活动度：受限 / 正常。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Mobility {
    Limited,
    Normal,
}

impl Mobility {
    pub fn key(self) -> &'static str {
        match self {
            Mobility::Limited => "limited",
            Mobility::Normal => "normal",
        }
    }

    pub fn zh(self) -> &'static str {
        match self {
            Mobility::Limited => "受限",
            Mobility::Normal => "正常",
        }
    }
}

/// 稳定性：差 / 正常。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Stability {
    Poor,
    Normal,
}

impl Stability {
    pub fn key(self) -> &'static str {
        match self {
            Stability::Poor => "poor",
            Stability::Normal => "normal",
        }
    }

    pub fn zh(self) -> &'static str {
        match self {
            Stability::Poor => "差",
            Stability::Normal => "正常",
        }
    }
}

/// 疼痛：无，或 0–10 的等级（0 就是无）。
///
/// 存储与线上表示都是一个 0–10 的整数：`0` 是无痛，`1..=10` 有痛且带等级。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(try_from = "u8", into = "u8")]
pub struct Pain {
    level: u8,
}

impl Pain {
    /// 无痛。
    pub const NONE: Pain = Pain { level: 0 };

    /// 最高等级。
    pub const MAX: u8 = 10;

    /// 按等级构造；0 表示无痛。
    pub fn new(level: u8) -> Result<Pain, DomainError> {
        if level > Self::MAX {
            return Err(DomainError::LevelOutOfRange {
                axis: Axis::Pain,
                level,
            });
        }
        Ok(Pain { level })
    }

    /// 等级，0 表示无痛。
    pub fn level(self) -> u8 {
        self.level
    }

    /// 是否有痛。
    pub fn is_pain(self) -> bool {
        self.level > 0
    }

    /// 机器可读的取值：`"none"` 或 `"3"`。
    pub fn key(self) -> String {
        if self.is_pain() {
            self.level.to_string()
        } else {
            "none".to_owned()
        }
    }

    /// 显示用的中文名。
    pub fn zh(self) -> String {
        if self.is_pain() {
            format!("{} 分", self.level)
        } else {
            "无".to_owned()
        }
    }

    fn parse(raw: &str) -> Result<Pain, DomainError> {
        match raw.trim() {
            "none" | "无" | "0" => Ok(Pain::NONE),
            other => match other.parse::<u8>() {
                Ok(level) => Pain::new(level),
                Err(_) => Err(DomainError::UnknownAxisValue {
                    axis: Axis::Pain,
                    value: other.to_owned(),
                }),
            },
        }
    }
}

impl TryFrom<u8> for Pain {
    type Error = DomainError;

    fn try_from(level: u8) -> Result<Self, Self::Error> {
        Pain::new(level)
    }
}

impl From<Pain> for u8 {
    fn from(pain: Pain) -> u8 {
        pain.level
    }
}

/// 一条轴上的取值，用来在不关心具体轴时统一处理（聚合、展示、日志）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AxisValue {
    Tension(Tension),
    Symmetry(Symmetry),
    Mobility(Mobility),
    Pain(Pain),
    Stability(Stability),
}

impl AxisValue {
    /// 它属于哪条轴。
    pub fn axis(self) -> Axis {
        match self {
            AxisValue::Tension(_) => Axis::Tension,
            AxisValue::Symmetry(_) => Axis::Symmetry,
            AxisValue::Mobility(_) => Axis::Mobility,
            AxisValue::Pain(_) => Axis::Pain,
            AxisValue::Stability(_) => Axis::Stability,
        }
    }

    /// 机器可读的取值。
    pub fn key(self) -> String {
        match self {
            AxisValue::Tension(value) => value.key().to_owned(),
            AxisValue::Symmetry(value) => value.key().to_owned(),
            AxisValue::Mobility(value) => value.key().to_owned(),
            AxisValue::Pain(value) => value.key(),
            AxisValue::Stability(value) => value.key().to_owned(),
        }
    }

    /// 显示用的中文名。
    pub fn zh(self) -> String {
        match self {
            AxisValue::Tension(value) => value.zh().to_owned(),
            AxisValue::Symmetry(value) => value.zh().to_owned(),
            AxisValue::Mobility(value) => value.zh().to_owned(),
            AxisValue::Pain(value) => value.zh(),
            AxisValue::Stability(value) => value.zh().to_owned(),
        }
    }

    /// 偏离正常的程度：正常 0，异常 1；疼痛按等级。聚合时取最大值。
    ///
    /// 「弱」与「紧」同为 1——两者都是异常但方向相反，谁更糟没有共识，
    /// 所以取最差时平手保持先出现的那条（成员顺序、时间顺序），不做人为排序。
    pub fn severity(self) -> u8 {
        match self {
            AxisValue::Tension(Tension::Normal)
            | AxisValue::Symmetry(Symmetry::Symmetric)
            | AxisValue::Mobility(Mobility::Normal)
            | AxisValue::Stability(Stability::Normal) => 0,
            AxisValue::Tension(_) | AxisValue::Symmetry(_) | AxisValue::Mobility(_) | AxisValue::Stability(_) => 1,
            AxisValue::Pain(pain) => pain.level(),
        }
    }

    /// 是否落在正常取值上。
    pub fn is_normal(self) -> bool {
        self.severity() == 0
    }
}

/// 一条判定的五轴取值：可以只给其中几条轴（未给的轴是「未测」，不是「正常」）。
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AxisValues {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub tension: Option<Tension>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub symmetry: Option<Symmetry>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub mobility: Option<Mobility>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub pain: Option<Pain>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub stability: Option<Stability>,
}

impl AxisValues {
    /// 空取值。
    pub fn new() -> AxisValues {
        AxisValues::default()
    }

    /// 取一条轴的值。
    pub fn get(&self, axis: Axis) -> Option<AxisValue> {
        match axis {
            Axis::Tension => self.tension.map(AxisValue::Tension),
            Axis::Symmetry => self.symmetry.map(AxisValue::Symmetry),
            Axis::Mobility => self.mobility.map(AxisValue::Mobility),
            Axis::Pain => self.pain.map(AxisValue::Pain),
            Axis::Stability => self.stability.map(AxisValue::Stability),
        }
    }

    /// 写一条轴的值；轴与取值不匹配会被忽略（构造函数已经保证了类型对得上）。
    pub fn set(&mut self, value: AxisValue) {
        match value {
            AxisValue::Tension(value) => self.tension = Some(value),
            AxisValue::Symmetry(value) => self.symmetry = Some(value),
            AxisValue::Mobility(value) => self.mobility = Some(value),
            AxisValue::Pain(value) => self.pain = Some(value),
            AxisValue::Stability(value) => self.stability = Some(value),
        }
    }

    /// 一条轴都没给。
    pub fn is_empty(&self) -> bool {
        self.tension.is_none()
            && self.symmetry.is_none()
            && self.mobility.is_none()
            && self.pain.is_none()
            && self.stability.is_none()
    }

    /// 已测的轴，按显示顺序。
    pub fn measured(&self) -> impl Iterator<Item = Axis> + '_ {
        Axis::ALL.into_iter().filter(move |axis| self.get(*axis).is_some())
    }

    /// 逐轴取更差的一条：没测的轴不算数（未测 ≠ 正常）。
    pub fn worst(self, other: AxisValues) -> AxisValues {
        let mut merged = AxisValues::new();
        for axis in Axis::ALL {
            let value = match (self.get(axis), other.get(axis)) {
                (Some(mine), Some(theirs)) => {
                    if theirs.severity() > mine.severity() {
                        theirs
                    } else {
                        mine
                    }
                }
                (Some(mine), None) => mine,
                (None, Some(theirs)) => theirs,
                (None, None) => continue,
            };
            merged.set(value);
        }
        merged
    }

    /// 同样几条轴上的正常取值（解决一条判定时补齐用）。
    pub fn normals_for<'a>(axes: impl Iterator<Item = Axis> + 'a) -> AxisValues {
        let mut values = AxisValues::new();
        for axis in axes {
            values.set(axis.normal());
        }
        values
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn values(pairs: &[(Axis, &str)]) -> AxisValues {
        let mut values = AxisValues::new();
        for (axis, raw) in pairs {
            values.set(axis.parse(raw).expect("取值合法"));
        }
        values
    }

    #[test]
    fn every_axis_parses_its_documented_values() {
        // 表驱动：ADR-0004 里写死的取值空间，多一个少一个都要在这里体现。
        let cases: &[(Axis, &[&str])] = &[
            (Axis::Tension, &["weak", "normal", "tight", "弱", "正常", "紧"]),
            (
                Axis::Symmetry,
                &["left-weak", "right-weak", "symmetric", "左弱", "右弱", "对称"],
            ),
            (Axis::Mobility, &["limited", "normal", "受限", "正常"]),
            (Axis::Stability, &["poor", "normal", "差", "正常"]),
            (Axis::Pain, &["none", "0", "1", "10", "无", "无"]),
        ];
        for (axis, raws) in cases {
            for raw in *raws {
                let value = axis.parse(raw).unwrap_or_else(|error| {
                    panic!("{axis:?} 应该接受 {raw}：{error}", axis = axis.key())
                });
                assert_eq!(value.axis(), *axis);
            }
        }
    }

    #[test]
    fn illegal_values_are_refused() {
        let cases: &[(Axis, &str)] = &[
            (Axis::Tension, "tense"),
            (Axis::Symmetry, "asymmetric"),
            (Axis::Mobility, "stiff"),
            (Axis::Stability, "unstable"),
            (Axis::Pain, "-1"),
            (Axis::Pain, "11"),
            (Axis::Pain, "5.5"),
            (Axis::Tension, ""),
        ];
        for (axis, raw) in cases {
            let error = axis.parse(raw).expect_err("应当被拒");
            assert_eq!(error.to_string().is_empty(), false);
        }
        assert_eq!(
            Axis::Tension.parse("tense").unwrap_err(),
            DomainError::UnknownAxisValue {
                axis: Axis::Tension,
                value: "tense".to_owned()
            }
        );
        assert_eq!(
            Axis::Pain.parse("11").unwrap_err(),
            DomainError::LevelOutOfRange {
                axis: Axis::Pain,
                level: 11
            }
        );
    }

    #[test]
    fn pain_zero_is_no_pain_and_ten_is_the_cap() {
        assert!(!Pain::NONE.is_pain());
        assert!(!Pain::new(0).unwrap().is_pain());
        assert!(Pain::new(1).unwrap().is_pain());
        assert_eq!(Pain::new(10).unwrap().level(), 10);
        assert!(Pain::new(11).is_err());
        assert_eq!(Pain::new(3).unwrap().key(), "3");
        assert_eq!(Pain::NONE.key(), "none");
    }

    #[test]
    fn severity_orders_normals_below_abnormals_and_pain_by_level() {
        assert_eq!(Axis::Tension.normal().severity(), 0);
        assert_eq!(Axis::Symmetry.normal().severity(), 0);
        assert_eq!(Axis::Pain.normal().severity(), 0);
        assert_eq!(values(&[(Axis::Tension, "weak")]).get(Axis::Tension).unwrap().severity(), 1);
        assert_eq!(values(&[(Axis::Tension, "tight")]).get(Axis::Tension).unwrap().severity(), 1);
        assert_eq!(values(&[(Axis::Pain, "7")]).get(Axis::Pain).unwrap().severity(), 7);
    }

    #[test]
    fn worst_keeps_the_more_abnormal_value_per_axis() {
        let left = values(&[(Axis::Tension, "normal"), (Axis::Pain, "2")]);
        let right = values(&[(Axis::Tension, "tight"), (Axis::Stability, "poor")]);
        let merged = left.worst(right);
        assert_eq!(merged.get(Axis::Tension), Some(AxisValue::Tension(Tension::Tight)));
        assert_eq!(merged.get(Axis::Pain), Some(AxisValue::Pain(Pain::new(2).unwrap())));
        assert_eq!(merged.get(Axis::Stability), Some(AxisValue::Stability(Stability::Poor)));
        // 两边都没测的轴仍然是未测。
        assert_eq!(merged.get(Axis::Mobility), None);
        assert_eq!(merged.get(Axis::Symmetry), None);
    }

    #[test]
    fn worst_treats_unmeasured_as_unknown_not_normal() {
        let measured = values(&[(Axis::Mobility, "limited")]);
        let unmeasured = AxisValues::new();
        assert_eq!(measured.worst(unmeasured), measured);
        assert_eq!(unmeasured.worst(measured), measured);
        assert_eq!(unmeasured.worst(unmeasured), AxisValues::new());
    }

    #[test]
    fn normals_for_covers_exactly_the_requested_axes() {
        let normals = AxisValues::normals_for([Axis::Tension, Axis::Pain].into_iter());
        assert_eq!(normals.get(Axis::Tension), Some(AxisValue::Tension(Tension::Normal)));
        assert_eq!(normals.get(Axis::Pain), Some(AxisValue::Pain(Pain::NONE)));
        assert_eq!(normals.get(Axis::Mobility), None);
        assert!(normals.measured().all(|axis| normals.get(axis).unwrap().is_normal()));
        assert_eq!(normals.measured().count(), 2);
    }

    #[test]
    fn values_round_trip_through_json() {
        let original = values(&[
            (Axis::Tension, "weak"),
            (Axis::Pain, "4"),
            (Axis::Symmetry, "left-weak"),
        ]);
        let json = serde_json::to_string(&original).expect("序列化");
        assert!(!json.contains("mobility"), "未测的轴不该写进 JSON：{json}");
        let back: AxisValues = serde_json::from_str(&json).expect("反序列化");
        assert_eq!(back, original);
    }
}
