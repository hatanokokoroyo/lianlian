//! 提示词装配（ADR-0006）：顺序固定，稳定在前、易变在后。
//!
//! `[系统提示][本会话历史][档案投影 + 训练条件 + 未结提议][本轮消息]`
//!
//! 档案投影放在历史**之后**，因为接受一条提议就会改档案；放在后面，只有
//! 「档案 + 新消息」这一段重算，前缀缓存仍然命中。代价是模型先读到历史、最后
//! 才知道现状，所以系统提示里那句「当前状态在最后一条消息之前给出」不得删改。
//!
//! 这一层是纯函数：不读库、不读时钟、不联网。

use serde::{Deserialize, Serialize};

use crate::domain::measurement::Measurement;
use crate::domain::{Basics, Message, Projection, Side, TrainingContext};

/// 不得不删改的一句：它是「状态放在历史之后」这套排列能成立的前提。
pub const STATUS_AFTER_HISTORY: &str = "当前状态在最后一条消息之前给出";

/// 系统提示。改它等于改模型的行为，别顺手改。
pub const SYSTEM_PROMPT: &str = concat!(
    "你是「练练」里的训练教练。用中文说话。\n",
    "工作顺序：先给用户 2–3 个在家能做的验证动作（做什么、看什么现象），拿到反馈之前不下结论；",
    "有了依据才在档案上落判定。\n",
    "当前状态在最后一条消息之前给出：那是现在的事实。历史里的判断可能已经过期，不要当成现状。\n",
    "你只记得本会话的历史；别的会话只共享档案与依据日志，不共享对话原文。\n",
    "回答短、具体、可执行，不要一次给一整套通用课表。\n",
    "现在还没有工具可调用：不要声称查过档案之外的记录，也不要假装已经写入了档案。"
);

/// 一条输入消息（OpenAI Responses 的 `input` 里的 message item）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Item {
    pub role: String,
    pub content: String,
}

impl Item {
    pub fn system(content: impl Into<String>) -> Item {
        Item {
            role: "system".to_owned(),
            content: content.into(),
        }
    }

    pub fn user(content: impl Into<String>) -> Item {
        Item {
            role: "user".to_owned(),
            content: content.into(),
        }
    }
}

/// 装配时要用到的全部状态。`api` 从库里取，`llm` 只消费。
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Snapshot {
    pub basics: Basics,
    /// 最新一条身高 / 体重测量（没有就是 `None`）。
    pub height: Option<Measurement>,
    pub weight: Option<Measurement>,
    pub projection: Projection,
    pub training: TrainingContext,
    /// 未结提议（#10 之前恒为空）。
    pub proposals: Vec<String>,
}

/// 装配结果。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Assembly {
    pub items: Vec<Item>,
    /// 为压回上下文上限丢掉的历史条数（正常装配是 0）。
    pub dropped: usize,
}

/// 正常装配：完整历史。
pub fn assemble(snapshot: &Snapshot, history: &[Message], turn: &str) -> Assembly {
    assemble_with_history(snapshot, history, turn, history.len())
}

/// 只保留最近 `keep_last` 条历史的装配（超长请求重发时用）。
///
/// 丢掉的是最旧的几条；剩下的是「仍然成对的最近几轮」，因为截断点可能落在
/// 一轮中间，这里不做配对修复——模型看到半轮也比看不到现状好。
pub fn assemble_with_history(
    snapshot: &Snapshot,
    history: &[Message],
    turn: &str,
    keep_last: usize,
) -> Assembly {
    let keep = keep_last.min(history.len());
    let dropped = history.len() - keep;

    let mut items = Vec::with_capacity(history.len() + 4);
    items.push(Item::system(SYSTEM_PROMPT));
    for message in &history[dropped..] {
        items.push(Item {
            role: message.role.key().to_owned(),
            content: message.text.clone(),
        });
    }
    items.push(Item::system(state_block(snapshot)));
    items.push(Item::user(turn.trim()));
    Assembly { items, dropped }
}

/// 状态块：档案投影 + 训练条件 + 未结提议。
///
/// 全部按确定顺序生成（投影本身按「部位、侧别」排序），同样的状态两次装配
/// 必须逐字节一致——这是前缀缓存与「档案变化只影响尾部」的前提。
pub fn state_block(snapshot: &Snapshot) -> String {
    let mut lines = Vec::new();
    lines.push("【当前状态】".to_owned());

    let mut basics = Vec::new();
    if let Some(sex) = snapshot.basics.sex {
        basics.push(sex.zh().to_owned());
    }
    if let Some(age) = snapshot.basics.age {
        basics.push(format!("{age} 岁"));
    }
    if !snapshot.basics.conditions.is_empty() {
        basics.push(format!(
            "基础疾病/旧伤：{}",
            snapshot.basics.conditions.join("；")
        ));
    }
    lines.push(format!(
        "基本属性：{}",
        if basics.is_empty() {
            "未填".to_owned()
        } else {
            basics.join("，")
        }
    ));

    let mut measurements = Vec::new();
    if let Some(height) = &snapshot.height {
        measurements.push(format!("身高 {} cm（{}）", value(height.value), date(height.at)));
    }
    if let Some(weight) = &snapshot.weight {
        measurements.push(format!("体重 {} kg（{}）", value(weight.value), date(weight.at)));
    }
    lines.push(format!(
        "测量：{}",
        if measurements.is_empty() {
            "暂无".to_owned()
        } else {
            measurements.join("；")
        }
    ));

    if snapshot.projection.is_empty() {
        lines.push("档案条目：暂无（还没做过评估）".to_owned());
    } else {
        lines.push("档案条目：".to_owned());
        for state in snapshot.projection.states() {
            let site = crate::anatomy::site(&state.site)
                .map(|site| site.zh)
                .unwrap_or(state.site.as_str());
            let side = match state.side {
                Some(Side::Left) => " · 左",
                Some(Side::Right) => " · 右",
                None => "",
            };
            let values = state
                .values
                .measured()
                .map(|axis| {
                    let value = state.values.get(axis).expect("measured 说有值").zh();
                    format!("{} {}", axis.zh(), value)
                })
                .collect::<Vec<_>>()
                .join("；");
            // 置信度不在 SiteState 上（它属于那条判定，投影只留当前值）；
            // 要给模型看置信度得先把投影扩成带来源细节，属于 #11 的事。
            lines.push(format!("- {site}{side}：{values}（{}）", date(state.at)));
        }
    }

    let mut training = Vec::new();
    if let Some(days) = snapshot.training.days_per_week {
        training.push(format!("每周 {days} 天"));
    }
    if let Some(minutes) = snapshot.training.minutes_per_session {
        training.push(format!("每次 {minutes} 分钟"));
    }
    if !snapshot.training.places.is_empty() {
        training.push(format!(
            "在哪练：{}",
            snapshot
                .training
                .places
                .iter()
                .map(|place| place.zh())
                .collect::<Vec<_>>()
                .join("、")
        ));
    }
    if !snapshot.training.equipment.is_empty() {
        training.push(format!(
            "手边有：{}",
            snapshot
                .training
                .equipment
                .iter()
                .map(|label| equipment_zh(label))
                .collect::<Vec<_>>()
                .join("、")
        ));
    }
    lines.push(format!(
        "训练条件：{}",
        if training.is_empty() {
            "未填齐".to_owned()
        } else {
            training.join("；")
        }
    ));

    lines.push(format!(
        "未结提议：{}",
        if snapshot.proposals.is_empty() {
            "无".to_owned()
        } else {
            snapshot.proposals.join("；")
        }
    ));

    lines.join("\n")
}

/// 器械清单里的键换成中文；自由文本原样保留。
fn equipment_zh(key: &str) -> &str {
    match key {
        "band" => "弹力带",
        "dumbbell-8kg" => "哑铃 8kg",
        "mat" => "瑜伽垫",
        "foam-roller" => "泡沫轴",
        "nothing" => "什么都没有",
        other => other,
    }
}

/// 一位小数，但整数不带 `.0`：`62.4` / `168`。
fn value(value: f64) -> String {
    if value.fract() == 0.0 {
        format!("{value:.0}")
    } else {
        format!("{value:.1}")
    }
}

/// Unix 毫秒 → `YYYY-MM-DD`（UTC）。
///
/// 状态块要求确定：同一份档案不能因为设备时区不同而装配出不同字节，所以这里
/// 用 UTC；给人看的日期在界面上按本地时区显示。
pub fn date(at_ms: i64) -> String {
    let days = at_ms.div_euclid(86_400_000);
    let (year, month, day) = civil_from_days(days);
    format!("{year:04}-{month:02}-{day:02}")
}

/// Howard Hinnant 的 `civil_from_days`：1970-01-01 起的天数 → 年月日。
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };
    (year, m as u32, d as u32)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::measurement::{Measurement, MeasurementId, MeasurementKind};
    use crate::domain::{AxisValues, ConversationId, Finding, FindingId, MessageId, Role, Tension};

    fn message(id: u64, role: Role, text: &str) -> Message {
        Message {
            id: MessageId(id),
            conversation: ConversationId(1),
            role,
            text: text.to_owned(),
            at: id as i64,
        }
    }

    /// 语料用的固定时刻：2026-11-15（UTC），让状态块里的日期可读。
    const NOW: i64 = 1_794_700_800_000;

    /// 语料与装配测试共用的那一份状态。
    fn snapshot() -> Snapshot {
        let finding = Finding {
            id: FindingId(7),
            site: "gluteus-medius".to_owned(),
            side: Some(Side::Left),
            values: AxisValues {
                tension: Some(Tension::Weak),
                ..AxisValues::new()
            },
            confidence: 70,
            at: NOW,
        };
        Snapshot {
            basics: Basics {
                sex: Some(crate::domain::Sex::Female),
                age: Some(32),
                conditions: vec!["右侧踝关节扭伤过两次".to_owned()],
            },
            height: Some(Measurement {
                id: MeasurementId(1),
                kind: MeasurementKind::Height,
                value: 168.0,
                at: NOW,
            }),
            weight: Some(Measurement {
                id: MeasurementId(2),
                kind: MeasurementKind::Weight,
                value: 62.4,
                at: NOW,
            }),
            projection: Projection::from_events(&[crate::domain::Event::Finding(finding)]),
            training: TrainingContext {
                days_per_week: Some(3),
                minutes_per_session: Some(30),
                places: vec![crate::domain::Place::Home],
                equipment: vec!["band".to_owned()],
            },
            proposals: Vec::new(),
        }
    }

    #[test]
    fn the_order_is_system_history_state_turn() {
        let history = vec![
            message(1, Role::User, "蹲不下去"),
            message(2, Role::Assistant, "先做踝背屈测试"),
        ];
        let assembly = assemble(&snapshot(), &history, "做完了，脚跟会抬");
        let roles: Vec<&str> = assembly
            .items
            .iter()
            .map(|item| item.role.as_str())
            .collect();
        assert_eq!(
            roles,
            vec!["system", "user", "assistant", "system", "user"]
        );
        assert!(assembly.items[0].content.contains(STATUS_AFTER_HISTORY));
        assert!(assembly.items[3].content.starts_with("【当前状态】"));
        assert_eq!(assembly.items[4].content, "做完了，脚跟会抬");
        assert_eq!(assembly.dropped, 0);
    }

    #[test]
    fn the_state_block_is_byte_identical_for_the_same_state() {
        let state = snapshot();
        let history = vec![message(1, Role::User, "在吗")];
        let first = serde_json::to_string(&assemble(&state, &history, "嗯").items).expect("序列化");
        let second = serde_json::to_string(&assemble(&state, &history, "嗯").items).expect("序列化");
        assert_eq!(first, second);
    }

    #[test]
    fn a_changed_profile_only_moves_the_tail() {
        let history = vec![
            message(1, Role::User, "蹲不下去"),
            message(2, Role::Assistant, "先做测试"),
        ];
        let before = assemble(&snapshot(), &history, "继续").items;
        let mut changed = snapshot();
        changed.weight = None;
        let after = assemble(&changed, &history, "继续").items;

        // 系统提示与历史一个字都不变。
        assert_eq!(&before[..3], &after[..3]);
        // 状态块与这一轮消息变了。
        assert_ne!(before[3], after[3]);
        assert_eq!(before[4], after[4]);
    }

    #[test]
    fn a_trimmed_assembly_drops_the_oldest_messages_and_says_how_many() {
        let history = vec![
            message(1, Role::User, "第一句"),
            message(2, Role::Assistant, "第一答"),
            message(3, Role::User, "第二句"),
            message(4, Role::Assistant, "第二答"),
        ];
        let assembly = assemble_with_history(&snapshot(), &history, "第三句", 2);
        assert_eq!(assembly.dropped, 2);
        let historical: Vec<&str> = assembly
            .items
            .iter()
            .filter(|item| item.role != "system")
            .map(|item| item.content.as_str())
            .collect();
        assert_eq!(historical, vec!["第二句", "第二答", "第三句"]);
    }

    #[test]
    fn the_state_block_reads_like_the_glossary() {
        let block = state_block(&snapshot());
        assert!(block.contains("基本属性：女，32 岁，基础疾病/旧伤：右侧踝关节扭伤过两次"));
        assert!(block.contains("测量：身高 168 cm（2026-11-15）；体重 62.4 kg（2026-11-15）"));
        assert!(block.contains("臀中肌 · 左：张力 弱（2026-11-15）"));
        assert!(block.contains("训练条件：每周 3 天；每次 30 分钟；在哪练：家；手边有：弹力带"));
        assert!(block.contains("未结提议：无"));
    }

    #[test]
    fn an_empty_profile_says_it_is_empty_instead_of_inventing_values() {
        let block = state_block(&Snapshot::default());
        assert!(block.contains("基本属性：未填"));
        assert!(block.contains("测量：暂无"));
        assert!(block.contains("档案条目：暂无"));
        assert!(block.contains("训练条件：未填齐"));
    }

    /// 录下来的那一轮：只用一条用户消息，历史为空。
    pub(super) const RECORDED_TURN: &str = "我蹲不下去，膝盖前面有点紧，先做什么测试？";

    pub(super) fn recorded_body() -> serde_json::Value {
        crate::llm::deepseek::request_body(&assemble(&snapshot(), &[], RECORDED_TURN).items)
    }

    #[test]
    fn the_recorded_request_is_exactly_what_we_assemble_today() {
        let recorded: serde_json::Value = serde_json::from_str(include_str!(
            "../../tests/corpus/deepseek-first-request.json"
        ))
        .expect("语料请求");
        assert_eq!(recorded_body(), recorded);
    }

    #[test]
    fn the_recorded_reply_still_parses_into_text() {
        let body = include_str!("../../tests/corpus/deepseek-first-reply.json");
        let text = crate::llm::deepseek::parse_response(200, body).expect("录制的响应仍能解析");
        assert!(text.contains("踝背屈") || text.contains("深蹲"));
    }

    #[test]
    fn dates_are_utc_and_deterministic() {
        assert_eq!(date(0), "1970-01-01");
        assert_eq!(date(1_764_000_000_000), "2025-11-24");
        assert_eq!(date(NOW), "2026-11-15");
        assert_eq!(date(1_763_000_000_000), "2025-11-13");
    }
}

