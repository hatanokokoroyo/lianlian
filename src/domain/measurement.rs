//! 测量（`GLOSSARY.md`「测量」）：用户手填的身高或体重，带时间戳。
//!
//! 每次记录都新增一条，不覆盖旧值——折线图要能看出变动。这是全库唯一允许
//! 单条删除的数据（ADR-0003 的例外），因为手误的 999 公斤不该污染趋势。
//! 时间由调用方给，这一层不读时钟。

use serde::{Deserialize, Serialize};

use super::{DomainError, Timestamp};

/// 测量编号：存储层分配的单调递增整数。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct MeasurementId(pub u64);

/// 身高的合理区间，厘米。
pub const HEIGHT_CM_RANGE: (f64, f64) = (50.0, 250.0);
/// 体重的合理区间，千克。
pub const WEIGHT_KG_RANGE: (f64, f64) = (20.0, 400.0);

/// 测量的是什么。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MeasurementKind {
    Height,
    Weight,
}

impl MeasurementKind {
    /// 机器可读的取值。
    pub fn key(self) -> &'static str {
        match self {
            MeasurementKind::Height => "height",
            MeasurementKind::Weight => "weight",
        }
    }

    /// 显示用的中文名。
    pub fn zh(self) -> &'static str {
        match self {
            MeasurementKind::Height => "身高",
            MeasurementKind::Weight => "体重",
        }
    }

    /// 单位。
    pub fn unit(self) -> &'static str {
        match self {
            MeasurementKind::Height => "cm",
            MeasurementKind::Weight => "kg",
        }
    }

    /// 合理区间：只拦手误，不是医学判断。
    pub fn range(self) -> (f64, f64) {
        match self {
            MeasurementKind::Height => HEIGHT_CM_RANGE,
            MeasurementKind::Weight => WEIGHT_KG_RANGE,
        }
    }

    /// 显示用的字段名，直接进错误文案。
    pub fn field(self) -> &'static str {
        match self {
            MeasurementKind::Height => "身高（厘米）",
            MeasurementKind::Weight => "体重（千克）",
        }
    }

    /// 从机器键或中文解析。
    pub fn from_key(raw: &str) -> Option<MeasurementKind> {
        match raw.trim() {
            "height" | "身高" => Some(MeasurementKind::Height),
            "weight" | "体重" => Some(MeasurementKind::Weight),
            _ => None,
        }
    }
}

/// 一条待写入的测量：除了编号之外的字段。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MeasurementDraft {
    pub kind: MeasurementKind,
    pub value: f64,
    pub at: Timestamp,
}

impl MeasurementDraft {
    /// 落库前的校验：有限数值且落在区间内。
    pub fn validate(&self) -> Result<(), DomainError> {
        let (min, max) = self.kind.range();
        if self.value.is_finite() && (min..=max).contains(&self.value) {
            Ok(())
        } else {
            Err(DomainError::OutOfRange {
                field: self.kind.field(),
                min,
                max,
                value: self.value,
            })
        }
    }
}

/// 已经落库的一条测量。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Measurement {
    pub id: MeasurementId,
    pub kind: MeasurementKind,
    pub value: f64,
    pub at: Timestamp,
}

impl Measurement {
    /// 校验草稿并分配编号。
    pub fn new(id: MeasurementId, draft: MeasurementDraft) -> Result<Measurement, DomainError> {
        draft.validate()?;
        Ok(Measurement {
            id,
            kind: draft.kind,
            value: draft.value,
            at: draft.at,
        })
    }
}

/// 一条序列的走势：最新值，以及最新与最早之间的差。
///
/// 只有一个点时差是 `None`——「看不出变化」不等于「没变化」。
#[derive(Debug, Clone, PartialEq)]
pub struct Trend {
    pub latest: Option<f64>,
    pub change: Option<f64>,
}

/// 全部测量（任意顺序）按「时间、编号」排序后算走势。
pub fn trend(mut measurements: Vec<Measurement>) -> Trend {
    measurements.sort_by_key(|measurement| (measurement.at, measurement.id));
    let latest = measurements.last().map(|measurement| measurement.value);
    let change = match (measurements.first(), measurements.last()) {
        (Some(first), Some(last)) if measurements.len() > 1 => Some(last.value - first.value),
        _ => None,
    };
    Trend { latest, change }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn measurement(id: u64, kind: MeasurementKind, value: f64, at: Timestamp) -> Measurement {
        Measurement {
            id: MeasurementId(id),
            kind,
            value,
            at,
        }
    }

    #[test]
    fn a_measurement_is_a_time_stamped_record_not_a_setting() {
        let draft = MeasurementDraft {
            kind: MeasurementKind::Weight,
            value: 62.4,
            at: 1,
        };
        let recorded = Measurement::new(MeasurementId(7), draft.clone()).expect("合法");
        assert_eq!(recorded.id, MeasurementId(7));
        assert_eq!(recorded.value, 62.4);
        assert_eq!(recorded.at, 1);
    }

    #[test]
    fn typos_are_refused_but_a_blank_is_not_a_measurement() {
        let cases = [
            (
                MeasurementKind::Weight,
                999.0,
                "体重（千克）",
                20.0,
                400.0,
            ),
            (MeasurementKind::Height, 9.0, "身高（厘米）", 50.0, 250.0),
        ];
        for (kind, value, field, min, max) in cases {
            let draft = MeasurementDraft { kind, value, at: 1 };
            assert_eq!(
                draft.validate().unwrap_err(),
                DomainError::OutOfRange {
                    field,
                    min,
                    max,
                    value,
                }
            );
        }
        let nan = MeasurementDraft {
            kind: MeasurementKind::Weight,
            value: f64::NAN,
            at: 1,
        };
        assert!(matches!(nan.validate(), Err(DomainError::OutOfRange { .. })));
    }

    #[test]
    fn kinds_carry_their_own_unit_and_parse_both_ways() {
        assert_eq!(MeasurementKind::Weight.unit(), "kg");
        assert_eq!(MeasurementKind::Height.unit(), "cm");
        assert_eq!(MeasurementKind::from_key("weight"), Some(MeasurementKind::Weight));
        assert_eq!(MeasurementKind::from_key("身高"), Some(MeasurementKind::Height));
        assert_eq!(MeasurementKind::from_key("胸围"), None);
        assert_eq!(MeasurementKind::Weight.key(), "weight");
        assert_eq!(MeasurementKind::Height.zh(), "身高");
    }

    #[test]
    fn the_latest_is_the_last_one_in_time_and_the_change_spans_the_series() {
        let series = vec![
            measurement(2, MeasurementKind::Weight, 74.6, 200),
            measurement(1, MeasurementKind::Weight, 74.2, 100),
            measurement(3, MeasurementKind::Weight, 73.2, 300),
        ];
        let trend = trend(series);
        assert_eq!(trend.latest, Some(73.2));
        assert!((trend.change.expect("两个点以上才有差") - -1.0).abs() < 1e-9);
    }

    #[test]
    fn one_point_has_a_value_but_no_change_to_show() {
        let one = trend(vec![measurement(1, MeasurementKind::Weight, 74.2, 100)]);
        assert_eq!(one.latest, Some(74.2));
        assert_eq!(one.change, None);
        assert_eq!(trend(vec![]), Trend { latest: None, change: None });
    }

    #[test]
    fn the_same_millisecond_breaks_ties_by_id() {
        let series = vec![
            measurement(1, MeasurementKind::Weight, 70.0, 100),
            measurement(2, MeasurementKind::Weight, 71.0, 100),
        ];
        assert_eq!(trend(series).latest, Some(71.0));
    }
}
