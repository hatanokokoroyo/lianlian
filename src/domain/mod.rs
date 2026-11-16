//! 领域层：纯函数、零 IO。
//!
//! 规则都在这层：五轴取值、部位与侧别的约束、档案条目只追加、聚合与投影。
//! 存储（`store`）只负责把这层的数据搬进搬出，界面只负责显示。

pub mod profile_page;
pub mod axis;
pub mod basics;
pub mod conversation;
pub mod day;
pub mod evidence;
pub mod finding;
pub mod item;
pub mod measurement;
pub mod photo;
pub mod plan;
pub mod projection;
pub mod proposal;
pub mod tool;
pub mod training;

#[allow(unused_imports)]
pub use profile_page::{
    Correction, GroupWorst, HistoryEntry, ProfilePage, SiteCard, SiteSection, WorstSource,
};
#[allow(unused_imports)]
pub use axis::{Axis, AxisValue, AxisValues, Mobility, Pain, Stability, Symmetry, Tension};
#[allow(unused_imports)]
pub use basics::{Basics, Sex};
pub use conversation::{Conversation, ConversationId, Message, MessageId, Role};
pub use day::{Date, Day, DayEvent, DayState, ExerciseSnapshot};
pub use evidence::{Evidence, EvidenceDraft, EvidenceId, EvidenceKind};
pub use finding::{Event, Finding, FindingDraft, FindingId, Retract, Side, Timestamp};
pub use item::{Entry, StoredItem};
pub use measurement::{
    Measurement, MeasurementDraft, MeasurementId, MeasurementKind, Trend, trend,
};
#[allow(unused_imports)]
pub use photo::{Photo, PhotoId};
pub use plan::{
    Exercise, Frequency, Plan, PlanDraft, PlanId, RepsUnit, ready_to_plan,
};
pub use proposal::{
    ItemState, Proposal, ProposalId, ProposalItem, ProposalStatus,
};
pub use projection::{Aggregate, Projection, SiteState};
#[allow(unused_imports)]
pub use training::{Place, Readiness, TrainingContext, TrainingField};

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
    /// 依据日志的某一段是空白。
    EmptyEvidenceSection(&'static str),
    /// 工具条目缺了必需字段（call_id / name / output）。
    EmptyToolItem,
    /// 照片没有文件或尺寸（落盘前的约束）。
    EmptyPhotoFile,
    /// 照片的媒体类型不是图片。
    NotAnImage(String),
    /// 一条消息只能带一张照片。
    TooManyPhotos(usize),
    /// agent 的回复不能带照片（只有用户消息能带）。
    PhotoOnlyFromUser,
    /// 一张提议卡一项都没有。
    EmptyProposal,
    /// 一张提议卡超过 8 项（要分轮）。
    TooManyProposalItems(usize),
    /// 这张提议已经处理过了。
    ProposalNotPending(ProposalId),
    /// 这个会话已经有一张待审的卡（一次一张）。
    PendingProposalExists(ProposalId),
    /// 这张卡没有已接受的项，没得撤销。
    NothingAccepted(ProposalId),
    /// 勾选的项里没有这个编号。
    UnknownProposalItem(usize),
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
    /// 训练条件不齐，不能排计划（要先把缺的项问出来）。
    TrainingIncomplete(Vec<TrainingField>),
    /// 一份计划一个动作都没有。
    EmptyPlan,
    /// 一份计划超过上限的动作数。
    TooManyExercises { count: usize, max: usize },
    /// 动作名字是空白。
    EmptyExercise,
    /// 频次规则的取值不认识。
    UnknownFrequency(String),
    /// 找不到这份计划。
    UnknownPlan(u64),
    /// 训练日里没有这个动作（编号越界）。
    UnknownExercise(usize),
    /// 这一天本来就没有训练，没有可推迟 / 可勾的东西。
    UnknownDay(String),
    /// 要改到的那天已经有训练了。
    DayTaken(String),
    /// 推迟目标不晚于原训练日。
    DayNotAfter(String),
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
            DomainError::SideForbidden(id) => write!(f, "部位 `{id}` 是中线结构，不能带侧别。"),
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
            DomainError::EmptyToolItem => write!(
                f,
                "工具条目缺少 call_id、name 或 output；工具往返要原样重放，缺一不可。"
            ),
            DomainError::EmptyPhotoFile => {
                write!(f, "照片缺了文件或尺寸；没有字节的东西不能当照片存。")
            }
            DomainError::TooManyPhotos(count) => write!(
                f,
                "一条消息只能带一张照片，收到 {count} 张；分两条发。"
            ),
            DomainError::PhotoOnlyFromUser => {
                write!(f, "只有用户消息能带照片；agent 的回复是文字。")
            }
            DomainError::EmptyProposal => write!(
                f,
                "一张提议卡至少要有一项；没东西要改就直接说话，不用开卡。"
            ),
            DomainError::TooManyProposalItems(count) => write!(
                f,
                "一张卡最多 8 项，收到 {count} 项；分成几轮提，别让用户面对一张审不完的清单。"
            ),
            DomainError::NothingAccepted(id) => write!(
                f,
                "编号 {} 的提议还没有被接受的项，没有可撤销的东西。",
                id.0
            ),
            DomainError::PendingProposalExists(id) => write!(
                f,
                "这个会话还有一张待审的卡（编号 {}）；先等用户把那张处理完。",
                id.0
            ),
            DomainError::ProposalNotPending(id) => write!(
                f,
                "编号 {} 的提议已经处理过了，不能再改；等用户把它们看完。",
                id.0
            ),
            DomainError::UnknownProposalItem(index) => write!(
                f,
                "这张卡没有第 {index} 项；看一遍卡的项数再勾。"
            ),
            DomainError::NotAnImage(mime) => write!(
                f,
                "`{mime}` 不是图片；照片只收选择器给的 image/* 文件。"
            ),
            DomainError::EmptyEvidenceSection(section) => write!(
                f,
                "依据日志的「{section}」是空的；四段都要写，用户没提到的段写「未涉及」。"
            ),
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
            DomainError::TrainingIncomplete(missing) => write!(
                f,
                "训练条件还差：{}。先把这几项问清楚再排计划，不要编一套做不了的方案。",
                missing
                    .iter()
                    .map(|field| field.zh())
                    .collect::<Vec<_>>()
                    .join("、")
            ),
            DomainError::EmptyPlan => write!(
                f,
                "一份计划至少要有一个动作；没有要练的直接说，不用开计划。"
            ),
            DomainError::TooManyExercises { count, max } => write!(
                f,
                "一份计划最多 {max} 个动作，收到 {count} 个；挑最要紧的，剩下的下一版再加。"
            ),
            DomainError::EmptyExercise => write!(f, "动作的名字不能是空白。"),
            DomainError::UnknownFrequency(value) => write!(
                f,
                "频次规则只有 per-week（每周几次）/ every-n-days（每几天一次），收到 `{value}`。"
            ),
            DomainError::UnknownPlan(id) => write!(f, "找不到编号 {id} 的计划。"),
            DomainError::UnknownExercise(index) => {
                write!(f, "这一天的训练里没有第 {index} 个动作。")
            }
            DomainError::UnknownDay(date) => {
                write!(f, "{date} 没有训练安排，没有可推迟的对象。")
            }
            DomainError::DayTaken(date) => {
                write!(f, "{date} 已经有训练了；一天只排一次。")
            }
            DomainError::DayNotAfter(date) => {
                write!(f, "{date} 不晚于原训练日；推迟只能往后挪。")
            }
        }
    }
}

impl std::error::Error for DomainError {}
