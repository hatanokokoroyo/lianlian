//! 工具层的规则（#9）：参数怎么解析、检索怎么钳、硬规则怎么判。
//!
//! 这里全是纯函数：给定参数 JSON 与「本轮已经搜过哪些部位」，算出该做什么、
//! 或者该回哪种错误。真正读库写库在 `store`，跑工具循环在 `llm::agent`。
//!
//! 三条硬规则（spec「工具集」）：
//! 1. 写入之前必须先对该部位 `search_evidence`（本轮内，见 #9 的决策）；
//! 2. `search_evidence` 的 `limit` 上限 20，改不小也绕不过；
//! 3. 写判定必须带齐四段依据（校验在 `evidence`，这里只负责翻译成工具错误）。

use std::collections::BTreeSet;

use serde_json::Value;

use super::evidence::{EvidenceDraft, EvidenceKind};
use super::{Axis, AxisValues, FindingDraft, Side, Timestamp};

/// 一次检索最多回多少条。
pub const MAX_LIMIT: usize = 20;

/// 四段里每一段回给模型的最多字数（超了截断并标 `truncated`）。
pub const SECTION_PREVIEW_CHARS: usize = 200;

/// 三个工具的名字。工具集宁少不多，加一个要走 spec。
pub const SEARCH_EVIDENCE: &str = "search_evidence";
pub const RECORD_FINDING: &str = "record_finding";
pub const CORRECT_FINDING: &str = "correct_finding";
pub const PROPOSE_FINDINGS: &str = "propose_findings";

/// 一次检索的条件。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct EvidenceQuery {
    /// 部位 id（必须在词表里）。
    pub site: Option<String>,
    /// 只看测过这条轴的判定。
    pub axis: Option<Axis>,
    /// 起（含），Unix 毫秒。
    pub from: Option<Timestamp>,
    /// 止（含当天最后一毫秒），Unix 毫秒。
    pub to: Option<Timestamp>,
    /// 四段与理由里的关键词（不区分大小写由调用方定；这里是原样子串）。
    pub contains: Option<String>,
    /// 要多少条；`None` 就是上限。
    pub limit: Option<usize>,
}

impl EvidenceQuery {
    /// 真正生效的条数：夹在 1..=[`MAX_LIMIT`]，`limit` 再大也没用。
    pub fn clamped_limit(&self) -> usize {
        self.limit.unwrap_or(MAX_LIMIT).clamp(1, MAX_LIMIT)
    }

    /// 从工具参数解析。
    pub fn parse(args: &Value) -> Result<EvidenceQuery, ToolError> {
        let object = args
            .as_object()
            .ok_or_else(|| ToolError::invalid_arguments("参数必须是一个对象。"))?;
        let site = optional_string(object.get("site"))?;
        if let Some(site) = &site {
            if crate::anatomy::site(site).is_none() {
                return Err(ToolError::invalid_arguments(format!(
                    "部位 `{site}` 不在词表内；先用词表里的 id，或干脆不传 site 查全部。"
                )));
            }
        }
        let axis = match optional_string(object.get("axis"))? {
            Some(raw) => Some(Axis::from_key(&raw).ok_or_else(|| {
                ToolError::invalid_arguments(format!(
                    "没有 `{raw}` 这条轴；可选值是 {}。",
                    Axis::ALL
                        .iter()
                        .map(|axis| axis.key())
                        .collect::<Vec<_>>()
                        .join(" / ")
                ))
            })?),
            None => None,
        };
        let from = match optional_string(object.get("from"))? {
            Some(raw) => Some(parse_date(&raw).ok_or_else(|| {
                ToolError::invalid_arguments(format!("起始日期 `{raw}` 认不出来，用 YYYY-MM-DD。"))
            })?),
            None => None,
        };
        // 止是「那一整天」：模型给 to=2026-11-15 时要含当天。
        let to = match optional_string(object.get("to"))? {
            Some(raw) => Some(
                parse_date(&raw)
                    .map(|start| start + DAY_MS - 1)
                    .ok_or_else(|| {
                        ToolError::invalid_arguments(format!(
                            "结束日期 `{raw}` 认不出来，用 YYYY-MM-DD。"
                        ))
                    })?,
            ),
            None => None,
        };
        Ok(EvidenceQuery {
            site,
            axis,
            from,
            to,
            contains: optional_string(object.get("contains"))?,
            limit: match object.get("limit") {
                None | Some(Value::Null) => None,
                Some(value) => {
                    let raw = value.as_u64().ok_or_else(|| {
                        ToolError::invalid_arguments("limit 必须是正整数。".to_owned())
                    })?;
                    Some(raw as usize)
                }
            },
        })
    }

}

/// `record_finding` 的参数。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecordArgs {
    pub draft: FindingDraft,
    pub evidence: EvidenceDraft,
}

impl RecordArgs {
    /// 从工具参数解析；四段与部位规则都要过。
    pub fn parse(
        args: &Value,
        conversation: Option<super::ConversationId>,
        at: Timestamp,
    ) -> Result<RecordArgs, ToolError> {
        let object = args
            .as_object()
            .ok_or_else(|| ToolError::invalid_arguments("参数必须是一个对象。".to_owned()))?;
        let site = required_string(object.get("site"), "site")?;
        let side = match optional_string(object.get("side"))? {
            Some(raw) => Some(Side::from_key(&raw).ok_or_else(|| {
                ToolError::invalid_arguments(format!("侧别只有 left / right，收到 `{raw}`。"))
            })?),
            None => None,
        };
        let confidence = object
            .get("confidence")
            .and_then(Value::as_u64)
            .ok_or_else(|| {
                ToolError::invalid_arguments("缺少 confidence（0–100 的整数）。".to_owned())
            })?;
        // 先判范围再转换：`as u8` 会把 300 悄悄变成 44，那是把「没听懂」当成了
        // 「很确定」。
        let confidence = u8::try_from(confidence)
            .ok()
            .filter(|value| *value <= 100)
            .ok_or_else(|| {
                ToolError::invalid_arguments(format!(
                    "confidence 必须是 0–100 的整数，收到 {confidence}。"
                ))
            })?;
        let values = parse_values(object.get("values"))?;
        let evidence = parse_evidence(
            object.get("evidence"),
            EvidenceKind::Record,
            &site,
            side,
            None,
            conversation,
            at,
        )?;
        Ok(RecordArgs {
            draft: FindingDraft {
                site,
                side,
                values,
                confidence,
                at,
            },
            evidence,
        })
    }
}

/// `propose_findings` 的参数：一次想改的多条（1–8）。
#[derive(Debug, Clone, PartialEq)]
pub struct ProposeArgs {
    pub items: Vec<super::ProposalItem>,
}

impl ProposeArgs {
    /// 从工具参数解析：每项都按 `record_finding` 的规则解析，再装进卡里。
    pub fn parse(
        args: &Value,
        conversation: Option<super::ConversationId>,
        at: Timestamp,
    ) -> Result<ProposeArgs, ToolError> {
        let items = args
            .get("items")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                ToolError::invalid_arguments(
                    "缺少 items（要改的那几条，1–8 项，每项和 record_finding 一样）。".to_owned(),
                )
            })?;
        if items.len() > super::proposal::MAX_ITEMS {
            return Err(ToolError::TooManyItems {
                count: items.len(),
                max: super::proposal::MAX_ITEMS,
            });
        }
        let mut parsed = Vec::with_capacity(items.len());
        for item in items {
            let args = RecordArgs::parse(item, conversation, at)?;
            parsed.push(super::ProposalItem::new(args.draft, args.evidence));
        }
        Ok(ProposeArgs { items: parsed })
    }
}

/// `correct_finding` 的参数：解决或撤回。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CorrectArgs {
    pub finding: super::FindingId,
    pub kind: EvidenceKind,
    /// 撤回的理由（解决时为空）。
    pub reason: String,
    pub evidence: EvidenceDraft,
}

impl CorrectArgs {
    /// 从工具参数解析。
    pub fn parse(
        args: &Value,
        target: &super::Finding,
        conversation: Option<super::ConversationId>,
        at: Timestamp,
    ) -> Result<CorrectArgs, ToolError> {
        let object = args
            .as_object()
            .ok_or_else(|| ToolError::invalid_arguments("参数必须是一个对象。".to_owned()))?;
        let action = required_string(object.get("action"), "action")?;
        let kind = match action.as_str() {
            "resolve" | "解决" => EvidenceKind::Resolve,
            "retract" | "撤回" => EvidenceKind::Retract,
            other => {
                return Err(ToolError::invalid_arguments(format!(
                    "action 只有 resolve（解决）/ retract（撤回），收到 `{other}`。"
                )));
            }
        };
        let reason = optional_string(object.get("reason"))?.unwrap_or_default();
        if kind == EvidenceKind::Retract && reason.trim().is_empty() {
            return Err(ToolError::invalid_arguments(
                "撤回必须写 reason：错在哪一句话，给用户和将来的 agent 看。".to_owned(),
            ));
        }
        let evidence = parse_evidence(
            object.get("evidence"),
            kind,
            &target.site,
            target.side,
            Some(target.id),
            conversation,
            at,
        )?;
        Ok(CorrectArgs {
            finding: target.id,
            kind,
            reason,
            evidence,
        })
    }
}

fn parse_values(raw: Option<&Value>) -> Result<AxisValues, ToolError> {
    let object = raw.and_then(Value::as_object).ok_or_else(|| {
        ToolError::invalid_arguments("缺少 values（至少一条轴的取值）。".to_owned())
    })?;
    let mut values = AxisValues::new();
    for (key, value) in object {
        let axis = Axis::from_key(key).ok_or_else(|| {
            ToolError::invalid_arguments(format!(
                "没有 `{key}` 这条轴；可选值是 {}。",
                Axis::ALL
                    .iter()
                    .map(|axis| axis.key())
                    .collect::<Vec<_>>()
                    .join(" / ")
            ))
        })?;
        let text = match value {
            Value::String(text) => text.clone(),
            Value::Number(number) => number.to_string(),
            other => {
                return Err(ToolError::invalid_arguments(format!(
                    "轴 `{key}` 的取值必须是字符串或数字，收到 {other}。"
                )));
            }
        };
        let parsed = axis
            .parse(&text)
            .map_err(|error| ToolError::invalid_arguments(error.to_string()))?;
        values.set(parsed);
    }
    Ok(values)
}

fn parse_evidence(
    raw: Option<&Value>,
    kind: EvidenceKind,
    site: &str,
    side: Option<Side>,
    finding: Option<super::FindingId>,
    conversation: Option<super::ConversationId>,
    at: Timestamp,
) -> Result<EvidenceDraft, ToolError> {
    let object = raw
        .and_then(Value::as_object)
        .ok_or(ToolError::MissingEvidence)?;
    let section = |name: &str| {
        object
            .get(name)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_owned()
    };
    Ok(EvidenceDraft {
        kind,
        site: site.to_owned(),
        side,
        finding,
        conversation,
        at,
        user_said: section("user_said"),
        test_and_feedback: section("test_and_feedback"),
        reasoning: section("reasoning"),
        uncertainty: section("uncertainty"),
    })
}

impl EvidenceQuery {
    /// 这条日志符不符合条件（`axis` 看它服务的那条判定测过哪些轴）。
    ///
    /// 规则放这里而不是 store：store 只负责遍历与截断，判断是领域的事。
    pub fn matches(&self, evidence: &super::Evidence, findings: &[super::Finding]) -> bool {
        if let Some(site) = &self.site {
            if &evidence.site != site {
                return false;
            }
        }
        if let Some(from) = self.from {
            if evidence.at < from {
                return false;
            }
        }
        if let Some(to) = self.to {
            if evidence.at > to {
                return false;
            }
        }
        if let Some(needle) = &self.contains {
            if !evidence
                .sections()
                .iter()
                .any(|(_, text)| text.contains(needle.as_str()))
            {
                return false;
            }
        }
        if let Some(axis) = self.axis {
            let measured = evidence.finding.is_some_and(|id| {
                findings
                    .iter()
                    .find(|finding| finding.id == id)
                    .is_some_and(|finding| finding.values.get(axis).is_some())
            });
            if !measured {
                return false;
            }
        }
        true
    }
}

/// 本轮已经检索过的部位（Q4：只在当前这一轮里记账）。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TurnSearches {
    sites: BTreeSet<String>,
}

impl TurnSearches {
    /// 记下一次检索：指名了哪个部位就算查过哪个部位。
    pub fn note(&mut self, query: &EvidenceQuery) {
        if let Some(site) = &query.site {
            self.sites.insert(site.clone());
        }
    }

    /// 这个部位在该轮里查过了吗。
    pub fn covers(&self, site: &str) -> bool {
        self.sites.contains(site)
    }

    /// 硬规则：没查过就不许写。
    pub fn require(&self, site: &str) -> Result<(), ToolError> {
        if self.covers(site) {
            Ok(())
        } else {
            Err(ToolError::NotSearched {
                site: site.to_owned(),
            })
        }
    }
}

/// 工具失败：模型能照着改的一句话 + 一句下一步。
#[derive(Debug, Clone, PartialEq)]
pub enum ToolError {
    /// 没先对这个部位 `search_evidence`。
    NotSearched { site: String },
    /// 参数里压根没有 evidence。
    MissingEvidence,
    /// 参数本身坏了（不是 JSON 形状、缺字段、取值不认识）。
    InvalidArguments(String),
    /// 调了一个不存在的工具。
    UnknownTool(String),
    /// 目标判定不存在。
    UnknownFinding(u64),
    /// 一张卡超过 8 项。
    TooManyItems { count: usize, max: usize },
    /// 上一张卡还没审完，不能再开一张。
    PendingProposal { items: usize },
    /// 本地库出错（不是模型的错，但要让它知道这次没写成）。
    Storage(String),
    /// 域规则拒绝（部位、侧别、四段缺段……）。
    Domain(super::DomainError),
}

impl ToolError {
    /// 造一个参数错误。
    pub fn invalid_arguments(message: impl Into<String>) -> ToolError {
        ToolError::InvalidArguments(message.into())
    }

    /// 机器可读的错误码（测试与模型都认它）。
    pub fn code(&self) -> &'static str {
        match self {
            ToolError::NotSearched { .. } => "not_searched",
            ToolError::MissingEvidence => "missing_evidence",
            ToolError::InvalidArguments(_) => "invalid_arguments",
            ToolError::UnknownTool(_) => "unknown_tool",
            ToolError::UnknownFinding(_) => "unknown_finding",
            ToolError::TooManyItems { .. } => "too_many_items",
            ToolError::PendingProposal { .. } => "pending_proposal",
            ToolError::Storage(_) => "storage_error",
            ToolError::Domain(super::DomainError::EmptyEvidenceSection(_)) => "missing_evidence",
            ToolError::Domain(_) => "invalid_finding",
        }
    }

    /// 给模型看的那句话。
    pub fn message(&self) -> String {
        match self {
            ToolError::NotSearched { site } => format!(
                "写 `{site}` 之前没有先检索它的依据。先调 search_evidence（site 填 `{site}`），再重试这次写入。"
            ),
            ToolError::MissingEvidence => format!(
                "缺少 evidence：写判定必须带上四段依据（{}）；用户没说到的段写「未涉及」而不是留空。",
                super::evidence::SECTIONS.join(" / ")
            ),
            ToolError::InvalidArguments(message) => message.clone(),
            ToolError::UnknownTool(name) => format!(
                "没有叫 `{name}` 的工具；可用的是 {SEARCH_EVIDENCE} / {RECORD_FINDING} / {CORRECT_FINDING} / {PROPOSE_FINDINGS}。"
            ),
            ToolError::UnknownFinding(id) => format!("找不到编号 {id} 的判定；先查档案再改。"),
            ToolError::TooManyItems { count, max } => format!(
                "一张卡最多 {max} 项，收到 {count} 项；分几轮提。"
            ),
            ToolError::PendingProposal { items } => format!(
                "上一张卡还有 {items} 项等用户审；先等用户处理完，别再开新卡。"
            ),
            ToolError::Storage(message) => format!("本地库出错，这次没写成：{message}"),
            ToolError::Domain(error) => error.to_string(),
        }
    }

    /// 下一步怎么做（错了之后模型要能自己纠正）。
    pub fn hint(&self) -> String {
        match self {
            ToolError::NotSearched { site } => {
                format!("search_evidence({{\"site\":\"{site}\"}}) 之后再调一次同样的写入。")
            }
            ToolError::MissingEvidence => {
                "把 evidence 的四段补上再重试；缺一段就说明这条判定还没依据。".to_owned()
            }
            ToolError::InvalidArguments(_) => {
                "修正参数后重试；拿不准的字段先不做，不要编造部位或取值。".to_owned()
            }
            ToolError::UnknownTool(_) => "只能用工具列表里有的工具。".to_owned(),
            ToolError::UnknownFinding(_) => "先用 search_evidence 查到那条判定的编号。".to_owned(),
            ToolError::TooManyItems { .. } => {
                "先提最要紧的 8 项（或更少）；剩下的等这一轮审完再说。".to_owned()
            }
            ToolError::PendingProposal { .. } => {
                "用一句话告诉用户卡在哪，等他勾；不要重新提一遍。".to_owned()
            }
            ToolError::Storage(_) => "把错误说给用户听，别假装写成功了；用户可以重试。".to_owned(),
            ToolError::Domain(super::DomainError::EmptyEvidenceSection(section)) => {
                format!("把「{section}」写出来；这条依据没写清就不该落库。")
            }
            ToolError::Domain(_) => "按错误里说的改；改不了就先问用户，不要猜。".to_owned(),
        }
    }

    /// 回给模型的那段 `function_call_output`（JSON 字符串）。
    pub fn to_json(&self) -> String {
        serde_json::json!({
            "error": {
                "code": self.code(),
                "message": self.message(),
                "hint": self.hint(),
            }
        })
        .to_string()
    }
}

impl From<super::DomainError> for ToolError {
    fn from(error: super::DomainError) -> ToolError {
        ToolError::Domain(error)
    }
}

/// 一段文本按字数截断，标出是否截过。
pub fn preview(text: &str) -> (String, bool) {
    let mut out: String = text.chars().take(SECTION_PREVIEW_CHARS).collect();
    let truncated = text.chars().count() > SECTION_PREVIEW_CHARS;
    if truncated {
        out.push('…');
    }
    (out, truncated)
}

/// 一天多少毫秒。
pub const DAY_MS: i64 = 86_400_000;

/// `YYYY-MM-DD` → 当天 00:00 的 Unix 毫秒（UTC）。工具参数与状态块用同一套日期。
pub fn parse_date(raw: &str) -> Option<Timestamp> {
    let mut parts = raw.trim().split('-');
    let year: i64 = parts.next()?.parse().ok()?;
    let month: i64 = parts.next()?.parse().ok()?;
    let day: i64 = parts.next()?.parse().ok()?;
    if parts.next().is_some() || !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    days_from_civil(year, month as u32, day as u32).checked_mul(DAY_MS)
}

/// Howard Hinnant 的 `days_from_civil`（`prompt::civil_from_days` 的逆）。
fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let m = month as i64;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + day as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn required_string(raw: Option<&Value>, field: &str) -> Result<String, ToolError> {
    optional_string(raw)?.ok_or_else(|| ToolError::invalid_arguments(format!("缺少 `{field}`。")))
}

fn optional_string(raw: Option<&Value>) -> Result<Option<String>, ToolError> {
    match raw {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(text)) if text.trim().is_empty() => Ok(None),
        Some(Value::String(text)) => Ok(Some(text.trim().to_owned())),
        Some(other) => Err(ToolError::invalid_arguments(format!(
            "这里应该是一个字符串，收到 {other}。"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn draft_values() -> Value {
        json!({ "tension": "weak" })
    }

    fn evidence_json() -> Value {
        json!({
            "user_said": "蹲到一半膝盖前面紧",
            "test_and_feedback": "靠墙踝背屈：右脚离墙 4 cm",
            "reasoning": "踝背屈受限让膝盖代偿",
            "uncertainty": "没排除髋"
        })
    }

    #[test]
    fn the_limit_is_capped_at_twenty_whatever_the_model_asks() {
        let query = EvidenceQuery::parse(&json!({ "limit": 500 })).expect("解析");
        assert_eq!(query.clamped_limit(), MAX_LIMIT);
        let query = EvidenceQuery::parse(&json!({ "limit": 0 })).expect("解析");
        assert_eq!(query.clamped_limit(), 1);
        let query = EvidenceQuery::parse(&json!({})).expect("解析");
        assert_eq!(query.clamped_limit(), MAX_LIMIT);
        let query = EvidenceQuery::parse(&json!({ "limit": 7 })).expect("解析");
        assert_eq!(query.clamped_limit(), 7);
    }

    #[test]
    fn a_query_reads_its_filters_and_dates() {
        let query = EvidenceQuery::parse(&json!({
            "site": "gluteus-medius",
            "axis": "tension",
            "from": "2026-11-01",
            "to": "2026-11-15",
            "contains": "膝"
        }))
        .expect("解析");
        assert_eq!(query.site.as_deref(), Some("gluteus-medius"));
        assert_eq!(query.axis, Some(Axis::Tension));
        assert_eq!(query.from, parse_date("2026-11-01"));
        // 止含那一天：结束日当天 23:59:59.999。
        assert_eq!(
            query.to,
            parse_date("2026-11-15").map(|start| start + DAY_MS - 1)
        );
        assert_eq!(query.contains.as_deref(), Some("膝"));
    }

    #[test]
    fn a_query_refuses_sites_and_axes_it_does_not_know() {
        let unknown_site = EvidenceQuery::parse(&json!({ "site": "gluteus" })).unwrap_err();
        assert_eq!(unknown_site.code(), "invalid_arguments");
        assert!(unknown_site.message().contains("词表"));

        let unknown_axis = EvidenceQuery::parse(&json!({ "axis": "strength" })).unwrap_err();
        assert!(unknown_axis.message().contains("tension"));

        let bad_date = EvidenceQuery::parse(&json!({ "from": "11/01" })).unwrap_err();
        assert!(bad_date.message().contains("YYYY-MM-DD"));
    }

    #[test]
    fn writing_without_searching_this_site_is_refused_with_a_way_out() {
        let mut searches = TurnSearches::default();
        let error = searches.require("gluteus-medius").unwrap_err();
        assert_eq!(error.code(), "not_searched");
        assert!(error.message().contains("search_evidence"));
        assert!(error.hint().contains("gluteus-medius"));

        // 指名搜过之后（哪怕一条记录都没有）就放行。
        let query = EvidenceQuery::parse(&json!({ "site": "gluteus-medius" })).expect("解析");
        searches.note(&query);
        assert!(searches.require("gluteus-medius").is_ok());
        // 别的部位不受影响。
        assert!(searches.require("soleus").is_err());
    }

    #[test]
    fn a_vague_search_does_not_count_as_having_looked() {
        let mut searches = TurnSearches::default();
        searches.note(&EvidenceQuery::parse(&json!({ "contains": "膝" })).expect("解析"));
        assert!(searches.require("gluteus-medius").is_err());
    }

    #[test]
    fn record_arguments_become_a_draft_with_its_evidence() {
        let args = RecordArgs::parse(
            &json!({
                "site": "gluteus-medius",
                "side": "left",
                "confidence": 70,
                "values": draft_values(),
                "evidence": evidence_json()
            }),
            Some(super::super::ConversationId(3)),
            1_000,
        )
        .expect("解析");
        assert_eq!(args.draft.site, "gluteus-medius");
        assert_eq!(args.draft.side, Some(Side::Left));
        assert_eq!(args.evidence.kind, EvidenceKind::Record);
        assert_eq!(args.evidence.user_said, "蹲到一半膝盖前面紧");
        assert_eq!(args.evidence.finding, None);
    }

    #[test]
    fn missing_sections_are_refused_before_anything_is_written() {
        let mut evidence = evidence_json();
        evidence["uncertainty"] = json!("");
        let args = RecordArgs::parse(
            &json!({
                "site": "gluteus-medius",
                "side": "left",
                "confidence": 70,
                "values": draft_values(),
                "evidence": evidence
            }),
            None,
            1_000,
        )
        .expect("形状是对的");
        // 解析只认形状；四段缺哪段由域校验拒绝，翻译成 missing_evidence。
        let error = args.evidence.validate().unwrap_err();
        assert_eq!(
            error,
            super::super::DomainError::EmptyEvidenceSection("不确定之处")
        );
    }

    #[test]
    fn pain_is_accepted_as_a_number_and_values_are_enum_checked() {
        let args = RecordArgs::parse(
            &json!({
                "site": "soleus",
                "side": "right",
                "confidence": 60,
                "values": { "pain": 4, "mobility": "limited" },
                "evidence": evidence_json()
            }),
            None,
            1_000,
        )
        .expect("解析");
        assert_eq!(
            args.draft.values.get(Axis::Pain),
            Some(super::super::AxisValue::Pain(
                super::super::Pain::new(4).unwrap()
            ))
        );

        let bad = RecordArgs::parse(
            &json!({
                "site": "soleus",
                "side": "right",
                "confidence": 60,
                "values": { "tension": "loose" },
                "evidence": evidence_json()
            }),
            None,
            1_000,
        )
        .unwrap_err();
        assert!(bad.message().contains("weak"));
    }

    #[test]
    fn retracting_needs_a_reason_and_resolving_does_not() {
        let target = super::super::Finding {
            id: super::super::FindingId(5),
            site: "soleus".to_owned(),
            side: Some(Side::Left),
            values: {
                let mut values = AxisValues::new();
                values.set(super::super::AxisValue::Tension(
                    super::super::Tension::Weak,
                ));
                values
            },
            confidence: 60,
            at: 100,
        };
        let retract = CorrectArgs::parse(
            &json!({ "action": "retract", "reason": "把比目鱼肌看成腓肠肌了", "evidence": evidence_json() }),
            &target,
            None,
            2_000,
        )
        .expect("解析");
        assert_eq!(retract.kind, EvidenceKind::Retract);
        assert_eq!(retract.evidence.finding, Some(target.id));
        assert_eq!(retract.evidence.side, Some(Side::Left));

        let no_reason = CorrectArgs::parse(
            &json!({ "action": "retract", "evidence": evidence_json() }),
            &target,
            None,
            2_000,
        )
        .unwrap_err();
        assert!(no_reason.message().contains("reason"));

        let resolve = CorrectArgs::parse(
            &json!({ "action": "resolve", "evidence": evidence_json() }),
            &target,
            None,
            2_000,
        )
        .expect("解析");
        assert_eq!(resolve.kind, EvidenceKind::Resolve);
    }

    #[test]
    fn dates_round_trip_with_the_state_block() {
        assert_eq!(parse_date("1970-01-01"), Some(0));
        assert_eq!(parse_date("2026-11-15"), Some(1_794_700_800_000));
        assert_eq!(parse_date("2025-11-24"), Some(1_763_942_400_000));
        assert_eq!(parse_date("2026-13-01"), None);
        assert_eq!(parse_date("2026-11-15T00:00"), None);
    }

    #[test]
    fn long_sections_are_previewed_and_flagged() {
        let long = "髋".repeat(SECTION_PREVIEW_CHARS + 10);
        let (text, truncated) = preview(&long);
        assert!(truncated);
        assert_eq!(text.chars().count(), SECTION_PREVIEW_CHARS + 1);
        let (short, truncated) = preview("短");
        assert!(!truncated);
        assert_eq!(short, "短");
    }
}
