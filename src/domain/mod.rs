//! 领域层：纯函数、零 IO。
//!
//! 规则都在这层：五轴取值、部位与侧别的约束、档案条目只追加、聚合与投影。
//! 存储（`store`）只负责把这层的数据搬进搬出，界面只负责显示。

pub mod axis;
pub mod finding;
pub mod projection;

#[allow(unused_imports)]
pub use axis::{
    Axis, AxisValue, AxisValues, Mobility, Pain, Stability, Symmetry, Tension,
};
pub use finding::{
    Event, Finding, FindingDraft, FindingId, Retract, Side, Timestamp,
};
#[allow(unused_imports)]
pub use projection::{Aggregate, Projection, SiteState};

use std::fmt;

/// 领域规则拒绝时的原因。错误文案是给模型看的：它要能照着改。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DomainError {
    /// 部位 id 不在词表里。
    UnknownSite(String),
    /// 左右成对的部位缺侧别。
    SideRequired(String),
    /// 中线结构带上了侧别。
    SideForbidden(String),
    /// 轴的取值不在枚举里。
    UnknownAxisValue { axis: Axis, value: String },
    /// 疼痛等级超出 0–10。
    LevelOutOfRange { axis: Axis, level: u8 },
    /// 一条判定一个轴都没给。
    NoAxes,
    /// 置信度超出 0–100。
    ConfidenceOutOfRange(u8),
    /// 撤回没写理由。
    EmptyReason,
    /// 撤回一个不存在的条目。
    UnknownFinding(FindingId),
    /// 同一条目被撤回了两次。
    AlreadyRetracted(FindingId),
    /// 撤回一条已经被撤回的条目之后，投影无从恢复（用于提示调用方）。
    NothingToProject(String),
}

impl fmt::Display for DomainError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DomainError::UnknownSite(id) => write!(
                f,
                "部位 `{id}` 不在词表内。档案只能记录词表里的肌肉或骨骼，\
                 （见 GLOSSARY「部位」）；想记录一组肌肉时请挑最具体的那一块。"
            ),
            DomainError::SideRequired(id) => write!(
                f,
                "部位 `{id}` 左右成对，落判定时必须给侧别（left / right）。"
            ),
            DomainError::SideForbidden(id) => write!(
                f,
                "部位 `{id}` 是中线结构，不能带侧别。"
            ),
            DomainError::UnknownAxisValue { axis, value } => write!(
                f,
                "`{axis}` 轴没有取值 `{value}`；{axis} 的可选值是 {}。",
                axis.values_hint(),
                axis = axis.key()
            ),
            DomainError::LevelOutOfRange { axis, level } => write!(
                f,
                "`{axis}` 的等级必须在 0–10 之间，收到 {level}。",
                axis = axis.key()
            ),
            DomainError::NoAxes => write!(
                f,
                "一条判定至少要给出一个轴（{}）的取值。",
                Axis::ALL
                    .iter()
                    .map(|axis| axis.key())
                    .collect::<Vec<_>>()
                    .join(" / ")
            ),
            DomainError::ConfidenceOutOfRange(value) => {
                write!(f, "置信度必须是 0–100 的整数，收到 {value}。")
            }
            DomainError::EmptyReason => write!(f, "撤回一条判定必须写理由。"),
            DomainError::UnknownFinding(id) => write!(f, "找不到编号 {} 的判定。", id.0),
            DomainError::AlreadyRetracted(id) => {
                write!(f, "编号 {} 的判定已经被撤回过了。", id.0)
            }
            DomainError::NothingToProject(site) => {
                write!(f, "`{site}` 撤回后没有任何可用的判定，档案里这条会消失。")
            }
        }
    }
}

impl std::error::Error for DomainError {}
