//! 领域层：纯函数、零 IO。
//!
//! 规则都在这层：五轴取值、部位与侧别的约束、档案条目只追加、聚合与投影。
//! 存储（`store`）只负责把这层的数据搬进搬出，界面只负责显示。

pub mod axis;
pub mod basics;
pub mod conversation;
pub mod finding;
pub mod measurement;
pub mod projection;
pub mod training;

#[allow(unused_imports)]
pub use axis::{
    Axis, AxisValue, AxisValues, Mobility, Pain, Stability, Symmetry, Tension,
};
#[allow(unused_imports)]
pub use basics::{Basics, Sex};
pub use conversation::{
    Conversation, ConversationId, Message, MessageId, Role,
};
#[allow(unused_imports)]
pub use training::{Place, Readiness, TrainingContext, TrainingField};
pub use finding::{
    Event, Finding, FindingDraft, FindingId, Retract, Side, Timestamp,
};
pub use measurement::{
    trend, Measurement, MeasurementDraft, MeasurementId, MeasurementKind, Trend,
};
#[allow(unused_imports)]
pub use projection::{Aggregate, Projection, SiteState};

use std::fmt;

/// 领域规则拒绝时的原因。错误文案是给模型看的：它要能照着改。
#[derive(Debug, Clone, PartialEq)]
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
    /// 删除一条不存在的测量。
    UnknownMeasurement(u64),
    /// 消息正文是空白。
    EmptyMessage,
    /// 找不到这个会话。
    UnknownConversation(u64),
    /// 同一条目被撤回了两次。
    AlreadyRetracted(FindingId),
    /// 撤回一条已经被撤回的条目之后，投影无从恢复（用于提示调用方）。
    NothingToProject(String),
    /// 某个数值字段超出它的合理区间（含「该是整数却给了小数」）。
    OutOfRange {
        /// 显示用的字段名，如「年龄」「体重（千克）」。
        field: &'static str,
        min: f64,
        max: f64,
        value: f64,
    },
    /// 基础疾病条目是空白。
    EmptyCondition,
    /// 基础疾病清单里已经有这一条。
    DuplicateCondition(String),
    /// 「什么都没有」与其他器械不能同时存在。
    NoEquipmentExclusive,
    /// 器械标签是空白。
    EmptyEquipment,
    /// 器械清单里已经有这一项。
    DuplicateEquipment(String),
    /// 性别取值不认识。
    UnknownSex(String),
    /// 训练地点取值不认识。
    UnknownPlace(String),
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
            DomainError::UnknownMeasurement(id) => write!(f, "找不到编号 {id} 的测量。"),
            DomainError::EmptyMessage => write!(f, "消息不能是空白。"),
            DomainError::UnknownConversation(id) => write!(f, "找不到编号 {id} 的会话。"),
            DomainError::AlreadyRetracted(id) => {
                write!(f, "编号 {} 的判定已经被撤回过了。", id.0)
            }
            DomainError::NothingToProject(site) => {
                write!(f, "`{site}` 撤回后没有任何可用的判定，档案里这条会消失。")
            }
            DomainError::OutOfRange {
                field,
                min,
                max,
                value,
            } => write!(
                f,
                "{field}要在 {min}–{max} 之间，收到 {value}。不确定就留空。"
            ),
            DomainError::EmptyCondition => write!(f, "基础疾病那一条是空的。"),
            DomainError::DuplicateCondition(text) => {
                write!(f, "基础疾病里已经有「{text}」这一条了。")
            }
            DomainError::NoEquipmentExclusive => {
                write!(f, "选了「什么都没有」就不能再选别的器械。")
            }
            DomainError::EmptyEquipment => write!(f, "器械那一项是空的。"),
            DomainError::DuplicateEquipment(label) => {
                write!(f, "器械里已经有「{label}」了。")
            }
            DomainError::UnknownSex(value) => {
                write!(f, "性别只有 female / male 或不填，收到 `{value}`。")
            }
            DomainError::UnknownPlace(value) => write!(
                f,
                "训练地点只有 {}，收到 `{value}`。",
                Place::ALL
                    .iter()
                    .map(|place| place.key())
                    .collect::<Vec<_>>()
                    .join(" / ")
            ),
        }
    }
}

impl std::error::Error for DomainError {}
