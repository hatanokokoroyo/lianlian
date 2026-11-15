//! 档案条目（Finding）与更正事件（Retract）——只追加（ADR-0003）。
//!
//! 一条判定写下就永不修改、永不删除；修正靠追加事件。这里的构造函数负责所有
//! 落库前的约束：部位必须在词表里、侧别与成对性一致、取值是枚举、置信度合法。

use serde::{Deserialize, Serialize};

use crate::anatomy;

use super::{Axis, AxisValues, DomainError};

/// 判定编号：存储层分配的单调递增整数。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct FindingId(pub u64);

/// 侧别：只有左右成对的部位才带。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Side {
    Left,
    Right,
}

impl Side {
    /// 机器可读的取值。
    pub fn key(self) -> &'static str {
        match self {
            Side::Left => "left",
            Side::Right => "right",
        }
    }

    /// 显示用的中文名。
    pub fn zh(self) -> &'static str {
        match self {
            Side::Left => "左",
            Side::Right => "右",
        }
    }

    /// 从机器键解析。
    pub fn from_key(raw: &str) -> Option<Side> {
        match raw {
            "left" | "左" => Some(Side::Left),
            "right" | "右" => Some(Side::Right),
            _ => None,
        }
    }
}

/// 毫秒时间戳（Unix epoch）。时间由调用方给，领域层不读时钟。
pub type Timestamp = i64;

/// 一条待写入的判定：除了编号之外的字段。
///
/// 先 `validate()` 再交给存储层；存储层分配编号并交出 `Finding`。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FindingDraft {
    /// 部位 id，必须在词表里。
    pub site: String,
    /// 侧别：成对部位必填，中线结构不能有。
    pub side: Option<Side>,
    /// 至少一条轴的取值。
    pub values: AxisValues,
    /// 置信度 0–100。
    pub confidence: u8,
    /// 判定时间。
    pub at: Timestamp,
}

impl FindingDraft {
    /// 校验并取出词表里的部位。
    pub fn validate(&self) -> Result<&'static anatomy::Site, DomainError> {
        let site = anatomy::site(&self.site).ok_or_else(|| DomainError::UnknownSite(self.site.clone()))?;
        match (site.paired, self.side) {
            (true, None) => return Err(DomainError::SideRequired(site.id.to_owned())),
            (false, Some(_)) => return Err(DomainError::SideForbidden(site.id.to_owned())),
            _ => {}
        }
        if self.values.is_empty() {
            return Err(DomainError::NoAxes);
        }
        if self.confidence > 100 {
            return Err(DomainError::ConfidenceOutOfRange(self.confidence));
        }
        Ok(site)
    }

    /// 「已解决」：给同一个部位（同侧别）追加一条正常判定。
    ///
    /// 覆盖原来那条判定测过的轴，全部取正常值——这样投影出来「最新取值为正常」，
    /// 历史条目仍然留在时间线上。
    pub fn resolve(target: &Finding, at: Timestamp) -> FindingDraft {
        FindingDraft {
            site: target.site.clone(),
            side: target.side,
            values: AxisValues::normals_for(target.values.measured()),
            confidence: target.confidence,
            at,
        }
    }
}

/// 已经落库的一条判定。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Finding {
    pub id: FindingId,
    pub site: String,
    pub side: Option<Side>,
    pub values: AxisValues,
    pub confidence: u8,
    pub at: Timestamp,
}

impl Finding {
    /// 校验草稿并分配编号。
    pub fn new(id: FindingId, draft: FindingDraft) -> Result<Finding, DomainError> {
        draft.validate()?;
        Ok(Finding {
            id,
            site: draft.site,
            side: draft.side,
            values: draft.values,
            confidence: draft.confidence,
            at: draft.at,
        })
    }

    /// 同一条判定换算成草稿（用于复制到别处）。
    pub fn draft(&self) -> FindingDraft {
        FindingDraft {
            site: self.site.clone(),
            side: self.side,
            values: self.values,
            confidence: self.confidence,
            at: self.at,
        }
    }

    /// 这条判定落在哪条轴上？
    pub fn axes(&self) -> impl Iterator<Item = Axis> + '_ {
        self.values.measured()
    }
}

/// 撤回：标记某条判定无效，必须写理由（历史条目本身不删）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Retract {
    /// 被撤回的判定。
    pub finding: FindingId,
    /// 为什么撤：给用户与将来的 agent 看的那句话。
    pub reason: String,
    /// 撤回时间。
    pub at: Timestamp,
}

impl Retract {
    /// 校验：理由不能是空白。
    pub fn new(finding: FindingId, reason: impl Into<String>, at: Timestamp) -> Result<Retract, DomainError> {
        let reason = reason.into();
        if reason.trim().is_empty() {
            return Err(DomainError::EmptyReason);
        }
        Ok(Retract { finding, reason, at })
    }

    /// 校验一个已有的事件（存储层反序列化后复查用）。
    pub fn validate(&self) -> Result<(), DomainError> {
        if self.reason.trim().is_empty() {
            return Err(DomainError::EmptyReason);
        }
        Ok(())
    }
}

/// 时间线上的一条事件：判定或撤回。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Event {
    Finding(Finding),
    Retract(Retract),
}

impl Event {
    /// 事件时间。
    pub fn at(&self) -> Timestamp {
        match self {
            Event::Finding(finding) => finding.at,
            Event::Retract(retract) => retract.at,
        }
    }

    /// 排序用的键：先时间，再编号（同一毫秒内的顺序也要稳定）。
    pub fn order(&self) -> (Timestamp, FindingId) {
        match self {
            Event::Finding(finding) => (finding.at, finding.id),
            Event::Retract(retract) => (retract.at, retract.finding),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{AxisValue, Mobility, Tension};

    fn draft(site: &str, side: Option<Side>, values: AxisValues) -> FindingDraft {
        FindingDraft {
            site: site.to_owned(),
            side,
            values,
            confidence: 80,
            at: 1_000,
        }
    }

    fn weak() -> AxisValues {
        let mut values = AxisValues::new();
        values.set(AxisValue::Tension(Tension::Weak));
        values
    }

    #[test]
    fn refuses_sites_outside_the_vocabulary() {
        let error = draft("gluteus", Some(Side::Left), weak())
            .validate()
            .unwrap_err();
        assert_eq!(error, DomainError::UnknownSite("gluteus".to_owned()));
        assert!(error.to_string().contains("部位"));
    }

    #[test]
    fn side_must_match_the_vocabulary() {
        // 成对部位缺侧别。
        let error = draft("gluteus-medius", None, weak()).validate().unwrap_err();
        assert_eq!(error, DomainError::SideRequired("gluteus-medius".to_owned()));

        // 中线结构带了侧别。
        let error = draft("diaphragm", Some(Side::Left), weak())
            .validate()
            .unwrap_err();
        assert_eq!(error, DomainError::SideForbidden("diaphragm".to_owned()));

        // 正确写法两种都过。
        assert!(draft("gluteus-medius", Some(Side::Left), weak()).validate().is_ok());
        assert!(draft("diaphragm", None, weak()).validate().is_ok());
    }

    #[test]
    fn refuses_empty_axes_and_bad_confidence() {
        let empty = draft("gluteus-medius", Some(Side::Left), AxisValues::new());
        assert_eq!(empty.validate().unwrap_err(), DomainError::NoAxes);

        let mut too_sure = draft("gluteus-medius", Some(Side::Left), weak());
        too_sure.confidence = 101;
        assert_eq!(
            too_sure.validate().unwrap_err(),
            DomainError::ConfidenceOutOfRange(101)
        );
    }

    #[test]
    fn retract_needs_a_reason() {
        let error = Retract::new(FindingId(1), "   ", 2_000).unwrap_err();
        assert_eq!(error, DomainError::EmptyReason);
        assert!(Retract::new(FindingId(1), "部位记错了", 2_000).is_ok());
    }

    #[test]
    fn resolve_creates_a_normal_finding_over_the_same_axes() {
        let mut values = AxisValues::new();
        values.set(AxisValue::Tension(Tension::Weak));
        values.set(AxisValue::Mobility(Mobility::Limited));
        let original = Finding::new(
            FindingId(7),
            draft("gluteus-medius", Some(Side::Left), values),
        )
        .expect("合法判定");

        let resolved = FindingDraft::resolve(&original, 5_000);
        assert_eq!(resolved.site, original.site);
        assert_eq!(resolved.side, original.side);
        assert_eq!(resolved.at, 5_000);
        // 只补齐原来测过的轴，其余仍为未测。
        assert_eq!(resolved.values.get(Axis::Tension), Some(AxisValue::Tension(Tension::Normal)));
        assert_eq!(resolved.values.get(Axis::Mobility), Some(AxisValue::Mobility(Mobility::Normal)));
        assert_eq!(resolved.values.get(Axis::Pain), None);
        assert!(resolved.validate().is_ok());
    }

    #[test]
    fn findings_round_trip_through_json() {
        let original = Finding::new(FindingId(3), draft("atlas", None, weak())).expect("合法");
        let json = serde_json::to_string(&original).expect("序列化");
        let back: Finding = serde_json::from_str(&json).expect("反序列化");
        assert_eq!(back, original);

        let event = Event::Retract(Retract::new(FindingId(3), "记错了", 9_000).unwrap());
        let json = serde_json::to_string(&event).expect("序列化");
        assert!(json.contains("retract"), "事件带类型标签：{json}");
    }
}
