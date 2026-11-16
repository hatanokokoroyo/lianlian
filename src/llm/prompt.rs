//! 提示词装配（ADR-0006）：顺序固定，稳定在前、易变在后。
//!
//! `[系统提示][本会话历史][档案投影 + 训练条件 + 未结提议][本轮消息]`
//!
//! 档案投影放在历史**之后**，因为接受一条提议就会改档案；放在后面，只有
//! 「档案 + 新消息」这一段重算，前缀缓存仍然命中。代价是模型先读到历史、最后
//! 才知道现状，所以系统提示里那句「当前状态在最后一条消息之前给出」不得删改。
//!
//! 这一层是纯函数：不读库、不读时钟、不联网。

use serde::Serialize;
use serde_json::Value;

use crate::domain::measurement::Measurement;
use crate::domain::{Basics, Entry, Plan, Projection, Side, StoredItem, TrainingContext};

/// 历史里的照片只有这一行占位：不重发原图（吃 token 且历史不需要），也不假装
/// 没有发生过（模型要知道用户当时发过图）。
pub const PHOTO_PLACEHOLDER: &str = "[用户发了一张照片]";

/// 不得不删改的一句：它是「状态放在历史之后」这套排列能成立的前提。
pub const STATUS_AFTER_HISTORY: &str = "当前状态在最后一条消息之前给出";

/// 系统提示。改它等于改模型的行为，别顺手改。
pub const SYSTEM_PROMPT: &str = concat!(
    "你是「练练」里的训练教练。用中文说话。\n",
    "工作顺序：先给用户 2–3 个在家能做的验证动作（做什么、看什么现象），拿到反馈之前不下结论；",
    "有了依据才在档案上落判定。\n",
    "写档案之前先调 search_evidence 查这个部位已有的记录，再调 record_finding 或 correct_finding；",
    "没查就写会被拒。写入必须带齐四段依据：用户说法要点 / 验证方案与反馈 / 推理 / 不确定之处。\n",
    "当前状态在最后一条消息之前给出：那是现在的事实。历史里的判断可能已经过期，不要当成现状。\n",
    "你只记得本会话的历史；别的会话只共享档案与依据日志，不共享对话原文。\n",
    "回答短、具体、可执行，不要一次给一整套通用课表。\n",
    "工具是唯一的写入通道：没调用工具就不要声称已经写入；部位只能用词表里的 id，拿不准就先问。\n",
    "照片只在这一轮可见：它是用户发来的图，不是已留存的依据——不要声称档案里存了照片。\n",
    "一次想改多条、或把握不大时用 propose_findings 开一张卡（最多 8 项），让用户逐项勾；卡没被接受就别说已经写进档案。\n",
    "用户拒绝某一项时，下一轮必须给出下一步（换方案 / 追问 / 撤回并说明），只回「好的」不算。\n",
    "排计划用 generate_plan：频次规则 + 动作清单 + 复查日（默认 4 周），每个动作都挂一条已有的判定；",
    "训练条件不齐时它会被拒，先追问补齐再排。"

);

/// 一条消息的内容：纯文本，或者文字 + 照片的若干块。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(untagged)]
pub enum Content {
    Text(String),
    Parts(Vec<ContentPart>),
}

/// 内容块：文字或一张照片（`#8`：只有当轮这一张，历史里不重发图片）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentPart {
    InputText { text: String },
    InputImage { image_url: String },
}

/// 一条输入消息（Responses 的 `input` 里的 message item）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct MessageItem {
    pub role: String,
    pub content: Content,
}

/// 模型要求调用工具（原样回放）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FunctionCallItem {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub call_id: String,
    pub name: String,
    pub arguments: String,
}

/// 工具的结果（原样回放）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FunctionCallOutputItem {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub call_id: String,
    pub output: String,
}

/// 请求 `input` 里的一项。
///
/// 消息与工具往返混在一起，顺序就是历史顺序（`domain::item::StoredItem` 的线上
/// 形状）。`Raw` 兜住认不出来的输出 item：重放时照发，不猜它的含义。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(untagged)]
pub enum Input {
    Message(MessageItem),
    FunctionCall(FunctionCallItem),
    FunctionCallOutput(FunctionCallOutputItem),
    Raw(Value),
}

impl Input {
    pub fn system(content: impl Into<String>) -> Input {
        Input::Message(MessageItem {
            role: "system".to_owned(),
            content: Content::Text(content.into()),
        })
    }

    pub fn user(content: impl Into<String>) -> Input {
        Input::Message(MessageItem {
            role: "user".to_owned(),
            content: Content::Text(content.into()),
        })
    }

    /// 这一轮的用户消息：文字（可能为空）+ 一张照片的 data URL。
    pub fn user_with_photo(text: &str, data_url: &str) -> Input {
        let mut parts = Vec::new();
        if !text.trim().is_empty() {
            parts.push(ContentPart::InputText {
                text: text.trim().to_owned(),
            });
        }
        parts.push(ContentPart::InputImage {
            image_url: data_url.to_owned(),
        });
        Input::Message(MessageItem {
            role: "user".to_owned(),
            content: Content::Parts(parts),
        })
    }

    /// 角色（只有消息有）。
    pub fn role(&self) -> Option<&str> {
        match self {
            Input::Message(message) => Some(message.role.as_str()),
            _ => None,
        }
    }

    /// 可见正文（只有纯文字的消息有）。
    pub fn content(&self) -> Option<&str> {
        match self {
            Input::Message(MessageItem {
                content: Content::Text(text),
                ..
            }) => Some(text.as_str()),
            _ => None,
        }
    }

    /// 库里的一条 → 请求里的一项。
    pub fn from_stored(item: &StoredItem) -> Input {
        match item {
            StoredItem::Message { role, text, photos } => Input::Message(MessageItem {
                role: role.key().to_owned(),
                // 历史里的照片不重发原图：一行占位，前缀仍然逐字节确定。
                content: if photos.is_empty() {
                    Content::Text(text.clone())
                } else if text.trim().is_empty() {
                    Content::Text(PHOTO_PLACEHOLDER.to_owned())
                } else {
                    Content::Text(format!("{text}\n{PHOTO_PLACEHOLDER}"))
                },
            }),
            StoredItem::FunctionCall {
                call_id,
                name,
                arguments,
            } => Input::FunctionCall(FunctionCallItem {
                kind: "function_call",
                call_id: call_id.clone(),
                name: name.clone(),
                arguments: arguments.clone(),
            }),
            StoredItem::FunctionCallOutput { call_id, output } => {
                Input::FunctionCallOutput(FunctionCallOutputItem {
                    kind: "function_call_output",
                    call_id: call_id.clone(),
                    output: output.clone(),
                })
            }
            StoredItem::Raw { item } => Input::Raw(item.clone()),
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
    /// 生效计划（#12）：模型要知道现在排到哪一版、频次与复查日。
    pub plan: Option<Plan>,
}

/// 装配结果。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Assembly {
    pub items: Vec<Input>,
    /// 为压回上下文上限丢掉的历史条数（正常装配是 0）。
    pub dropped: usize,
}

/// 正常装配：完整历史。
///
/// `photo` 是**这一轮**那张照片的 data URL（没有就是 `None`）。历史轮里的照片只
/// 留占位（[`PHOTO_PLACEHOLDER`]）。
pub fn assemble(
    snapshot: &Snapshot,
    history: &[Entry],
    turn: &str,
    photo: Option<&str>,
) -> Assembly {
    assemble_with_turns(snapshot, history, turn, turns(history), photo)
}

/// 只保留最近 `keep_turns` 轮历史的装配（超长请求重发时用）。
///
/// **一轮** = 一条用户消息到下一个用户消息之前的全部条目。按条裁会把
/// `function_call` 和它的 `function_call_output` 拆开，请求会被网关拒绝，所以
/// 裁剪点只能落在轮首。
pub fn assemble_with_turns(
    snapshot: &Snapshot,
    history: &[Entry],
    turn: &str,
    keep_turns: usize,
    photo: Option<&str>,
) -> Assembly {
    let total = turns(history);
    let keep = keep_turns.min(total);
    let start = if keep >= total {
        0
    } else {
        user_message_index(history, total - keep)
    };

    let mut items = Vec::with_capacity(history.len() - start + 4);
    items.push(Input::system(SYSTEM_PROMPT));
    for entry in &history[start..] {
        items.push(Input::from_stored(&entry.item));
    }
    items.push(Input::system(state_block(snapshot)));
    items.push(match photo {
        Some(data_url) => Input::user_with_photo(turn, data_url),
        None => Input::user(turn.trim()),
    });
    Assembly {
        items,
        dropped: start,
    }
}

/// 历史里有多少轮（多少条用户消息）。
pub fn turns(history: &[Entry]) -> usize {
    history
        .iter()
        .filter(|entry| entry.item.is_user_message())
        .count()
}

/// 第 `n` 条用户消息在历史里的下标（0 起）。
fn user_message_index(history: &[Entry], n: usize) -> usize {
    history
        .iter()
        .enumerate()
        .filter(|(_, entry)| entry.item.is_user_message())
        .nth(n)
        .map(|(index, _)| index)
        .unwrap_or(history.len())
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
        measurements.push(format!(
            "身高 {} cm（{}）",
            value(height.value),
            date(height.at)
        ));
    }
    if let Some(weight) = &snapshot.weight {
        measurements.push(format!(
            "体重 {} kg（{}）",
            value(weight.value),
            date(weight.at)
        ));
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

    match &snapshot.plan {
        None => lines.push("生效计划：暂无（还没排过计划）".to_owned()),
        Some(plan) => {
            lines.push(format!(
                "生效计划：第 {} 版 · {} · 复查 {}",
                plan.version,
                plan.frequency.zh(),
                date(plan.review_at)
            ));
            for exercise in &plan.exercises {
                lines.push(format!(
                    "- {} {}{}",
                    exercise.name,
                    exercise.prescription(),
                    plan_finding_ref(exercise.finding)
                ));
            }
        }
    }

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

/// 动作挂的那条判定：`（判定 #7）`，模型据此解释「为什么做这个」。
fn plan_finding_ref(finding: crate::domain::FindingId) -> String {
    format!("（判定 #{}）", finding.0)
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
    crate::domain::day::Date::from_ms(at_ms).iso()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::measurement::{Measurement, MeasurementId, MeasurementKind};
    use crate::domain::{AxisValues, ConversationId, Finding, FindingId, MessageId, Role, Tension};

    fn message(id: u64, role: Role, text: &str) -> Entry {
        Entry {
            id: MessageId(id),
            conversation: ConversationId(1),
            at: id as i64,
            item: crate::domain::StoredItem::Message {
                role,
                text: text.to_owned(),
                photos: Vec::new(),
            },
        }
    }

    fn tool_entry(id: u64, item: crate::domain::StoredItem) -> Entry {
        Entry {
            id: MessageId(id),
            conversation: ConversationId(1),
            at: id as i64,
            item,
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
            plan: None,
        }
    }

    #[test]
    fn the_order_is_system_history_state_turn() {
        let history = vec![
            message(1, Role::User, "蹲不下去"),
            message(2, Role::Assistant, "先做踝背屈测试"),
        ];
        let assembly = assemble(&snapshot(), &history, "做完了，脚跟会抬", None);
        let roles: Vec<&str> = assembly
            .items
            .iter()
            .map(|item| item.role().unwrap_or("-"))
            .collect();
        assert_eq!(roles, vec!["system", "user", "assistant", "system", "user"]);
        assert!(
            assembly.items[0]
                .content()
                .expect("系统提示")
                .contains(STATUS_AFTER_HISTORY)
        );
        assert!(
            assembly.items[3]
                .content()
                .expect("状态块")
                .starts_with("【当前状态】")
        );
        assert_eq!(assembly.items[4].content(), Some("做完了，脚跟会抬"));
        assert_eq!(assembly.dropped, 0);
    }

    #[test]
    fn the_state_block_is_byte_identical_for_the_same_state() {
        let state = snapshot();
        let history = vec![message(1, Role::User, "在吗")];
        let first = serde_json::to_string(&assemble(&state, &history, "嗯", None).items).expect("序列化");
        let second =
            serde_json::to_string(&assemble(&state, &history, "嗯", None).items).expect("序列化");
        assert_eq!(first, second);
    }

    #[test]
    fn a_changed_profile_only_moves_the_tail() {
        let history = vec![
            message(1, Role::User, "蹲不下去"),
            message(2, Role::Assistant, "先做测试"),
        ];
        let before = assemble(&snapshot(), &history, "继续", None).items;
        let mut changed = snapshot();
        changed.weight = None;
        let after = assemble(&changed, &history, "继续", None).items;

        // 系统提示与历史一个字都不变。
        assert_eq!(&before[..3], &after[..3]);
        // 状态块与这一轮消息变了。
        assert_ne!(before[3], after[3]);
        assert_eq!(before[4], after[4]);
    }

    #[test]
    fn a_trimmed_assembly_drops_whole_turns_not_single_items() {
        let history = vec![
            message(1, Role::User, "第一句"),
            message(2, Role::Assistant, "第一答"),
            message(3, Role::User, "第二句"),
            message(4, Role::Assistant, "第二答"),
        ];
        let assembly = assemble_with_turns(&snapshot(), &history, "第三句", 1, None);
        assert_eq!(assembly.dropped, 2, "丢掉的是第一轮的整条");
        let historical: Vec<&str> = assembly
            .items
            .iter()
            .filter_map(|item| item.content())
            .filter(|text| *text != crate::llm::prompt::SYSTEM_PROMPT)
            .filter(|text| !text.starts_with("【当前状态】"))
            .collect();
        assert_eq!(historical, vec!["第二句", "第二答", "第三句"]);
    }

    #[test]
    fn a_tool_round_trip_in_history_is_replayed_in_order() {
        let history = vec![
            message(1, Role::User, "蹲不下去"),
            tool_entry(
                2,
                crate::domain::StoredItem::FunctionCall {
                    call_id: "call_1".to_owned(),
                    name: "search_evidence".to_owned(),
                    arguments: r#"{"site":"soleus"}"#.to_owned(),
                },
            ),
            tool_entry(
                3,
                crate::domain::StoredItem::FunctionCallOutput {
                    call_id: "call_1".to_owned(),
                    output: r#"{"found":0,"items":[]}"#.to_owned(),
                },
            ),
            message(4, Role::Assistant, "先做踝背屈测试"),
        ];
        let assembly = assemble(&snapshot(), &history, "做完了", None);
        let body = serde_json::to_value(&assembly.items).expect("序列化");
        let kinds: Vec<&str> = body
            .as_array()
            .expect("数组")
            .iter()
            .map(|item| item["type"].as_str().unwrap_or("message"))
            .collect();
        assert_eq!(
            kinds,
            vec![
                "message",
                "message",
                "function_call",
                "function_call_output",
                "message",
                "message",
                "message"
            ],
            "工具往返夹在历史里，按原顺序"
        );
        assert_eq!(body[2]["call_id"], "call_1");
        assert_eq!(body[3]["output"], r#"{"found":0,"items":[]}"#);
    }

    #[test]
    fn only_this_turns_photo_is_sent_earlier_ones_become_a_placeholder() {
        let history = vec![
            Entry {
                id: MessageId(1),
                conversation: ConversationId(1),
                at: 1,
                item: crate::domain::StoredItem::user_with_photo("先看这张", crate::domain::PhotoId(5))
                    .expect("带照片"),
            },
            message(2, Role::Assistant, "看到了"),
        ];
        let assembly = assemble(
            &snapshot(),
            &history,
            "现在这张呢",
            Some("data:image/jpeg;base64,AAAA"),
        );
        let body = serde_json::to_value(&assembly.items).expect("序列化");

        // 历史里那张：一行占位，不重发原图。
        let historical = body[1]["content"].as_str().expect("历史是纯文本");
        assert!(historical.contains("先看这张"));
        assert!(historical.contains(PHOTO_PLACEHOLDER));
        assert!(!historical.contains("base64"));

        // 这一轮（0 系统 / 1-2 历史 / 3 状态 / 4 本轮）：文字 + 照片的块。
        let turn = body[4]["content"].as_array().expect("这一轮是块");
        assert_eq!(turn[0]["type"], "input_text");
        assert_eq!(turn[0]["text"], "现在这张呢");
        assert_eq!(turn[1]["type"], "input_image");
        assert_eq!(turn[1]["image_url"], "data:image/jpeg;base64,AAAA");
    }

    #[test]
    fn a_photo_without_words_is_still_a_message_and_placeholder_stays_readable() {
        let history = vec![Entry {
            id: MessageId(1),
            conversation: ConversationId(1),
            at: 1,
            item: crate::domain::StoredItem::user_with_photo("", crate::domain::PhotoId(5))
                .expect("只有照片"),
        }];
        let assembly = assemble(&snapshot(), &history, "", Some("data:image/jpeg;base64,AA"));
        let body = serde_json::to_value(&assembly.items).expect("序列化");
        assert_eq!(body[1]["content"], PHOTO_PLACEHOLDER, "历史占位不空着");
        // 这一轮只有照片一个块。
        let turn = body[3]["content"].as_array().expect("块");
        assert_eq!(turn.len(), 1);
        assert_eq!(turn[0]["type"], "input_image");
    }

    #[test]
    fn trimming_never_leaves_a_call_without_its_output() {
        let history = vec![
            message(1, Role::User, "第一句"),
            message(2, Role::Assistant, "第一答"),
            message(3, Role::User, "第二句"),
            tool_entry(
                4,
                crate::domain::StoredItem::FunctionCall {
                    call_id: "call_9".to_owned(),
                    name: "search_evidence".to_owned(),
                    arguments: "{}".to_owned(),
                },
            ),
            tool_entry(
                5,
                crate::domain::StoredItem::FunctionCallOutput {
                    call_id: "call_9".to_owned(),
                    output: "{}".to_owned(),
                },
            ),
            message(6, Role::Assistant, "第二答"),
        ];
        let assembly = assemble_with_turns(&snapshot(), &history, "第三句", 1, None);
        let cut: Vec<String> = assembly
            .items
            .iter()
            .filter_map(|item| serde_json::to_value(item).ok())
            .filter_map(|value| value["call_id"].as_str().map(str::to_owned))
            .collect();
        assert_eq!(cut, vec!["call_9".to_owned(), "call_9".to_owned()]);
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
        assert!(block.contains("生效计划：暂无"));
    }

    #[test]
    fn the_state_block_carries_the_active_plan_and_its_review_date() {
        let mut state = snapshot();
        state.plan = Some(crate::domain::Plan {
            id: crate::domain::PlanId(3),
            version: 2,
            conversation: None,
            at: NOW,
            frequency: crate::domain::Frequency::PerWeek(3),
            exercises: vec![crate::domain::Exercise {
                name: "臀桥".to_owned(),
                sets: 3,
                reps: 10,
                unit: crate::domain::RepsUnit::Times,
                finding: FindingId(7),
            }],
            review_at: crate::domain::tool::parse_date("2026-12-13").expect("日期"),
        });
        let block = state_block(&state);
        assert!(block.contains("生效计划：第 2 版 · 每周 3 次 · 复查 2026-12-13"));
        assert!(block.contains("- 臀桥 3×10（判定 #7）"));
    }

    #[test]
    fn a_new_conversation_still_gets_the_whole_state_block() {
        // 强制新开会话之后，第一轮也不许是空状态：档案投影得在里面。
        let assembly = assemble(&snapshot(), &[], "在吗", None);
        let state = assembly
            .items
            .iter()
            .find_map(|item| item.content().filter(|text| text.starts_with("【当前状态】")))
            .expect("状态块");
        assert!(state.contains("档案条目："));
        assert!(state.contains("臀中肌"));
        assert!(state.contains("生效计划：暂无"));
    }

    /// 录下来的那一轮：只用一条用户消息，历史为空。
    pub(super) const RECORDED_TURN: &str = "我蹲不下去，膝盖前面有点紧，先做什么测试？";

    pub(super) fn recorded_body() -> serde_json::Value {
        crate::llm::deepseek::request_body(&assemble(&snapshot(), &[], RECORDED_TURN, None).items)
    }

    #[test]
    #[ignore = "重录语料时手动跑：REGEN_CORPUS=1 cargo test regenerate"]
    fn regenerate_the_recorded_request() {
        if std::env::var("REGEN_CORPUS").is_err() {
            return;
        }
        let body = serde_json::to_string_pretty(&recorded_body()).expect("序列化");
        std::fs::write(
            concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/tests/corpus/deepseek-first-request.json"
            ),
            format!("{body}\n"),
        )
        .expect("写语料");
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
    fn tool_dates_parse_back_into_the_state_blocks_dates() {
        // 工具参数里的 YYYY-MM-DD 与状态块里的日期必须互逆。
        let day = crate::domain::tool::parse_date("2025-11-24").expect("解析");
        assert_eq!(date(day), "2025-11-24");
        assert_eq!(date(crate::domain::tool::parse_date("2026-11-15").expect("解析")), "2026-11-15");
    }

    #[test]
    fn dates_are_utc_and_deterministic() {
        assert_eq!(date(0), "1970-01-01");
        assert_eq!(date(1_764_000_000_000), "2025-11-24");
        assert_eq!(date(NOW), "2026-11-15");
        assert_eq!(date(1_763_000_000_000), "2025-11-13");
    }
}
