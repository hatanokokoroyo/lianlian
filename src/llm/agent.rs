//! 一轮对话的工具循环（#9）。
//!
//! 模型可能先要检索再写入：一次请求出去，回来可能是 `function_call`，本地执行
//! 之后把结果作为 `function_call_output` 回传，再请求一次，直到它不再调工具。
//! 循环住在 Rust 侧，因为工具要读写本地库，也因为界面不该知道工具是什么。
//!
//! 轮次上限来自设置（默认 6，夹在 1–128：没有「无限制」，那是让模型烧钱的开关）。
//! 到上限就停，不静默截断，也不留半对 `function_call`（缺 `output` 的调用没法
//! 重放，下一轮请求会被网关拒）。

use crate::domain::tool::{
    CORRECT_FINDING, CorrectArgs, EvidenceQuery, GENERATE_PLAN, GenerateArgs, PROPOSE_FINDINGS,
    ProposeArgs, RECORD_FINDING, RecordArgs, SEARCH_EVIDENCE, ToolError, TurnSearches,
};
use crate::domain::{
    EvidenceKind, FindingDraft, FindingId, Proposal, ProposalId, StoredItem,
};
use crate::store::{Store, StoreError};

use super::deepseek::{self, GatewayError, OutputItem};
use super::prompt::{Input, date};

/// 工具轮次上限的默认值与范围（Q15：可配，最大 128，不允许无限）。
pub const DEFAULT_MAX_ROUNDS: usize = 6;
pub const MAX_ROUNDS_LIMIT: usize = 128;

/// 把设置里的数字夹进合法区间。
pub fn clamp_rounds(raw: usize) -> usize {
    raw.clamp(1, MAX_ROUNDS_LIMIT)
}

/// 模型的一次调用。
pub trait Model {
    /// 发一次请求，拿到这一轮的输出项。
    fn turn(
        &self,
        items: &[Input],
    ) -> impl std::future::Future<Output = Result<Vec<OutputItem>, GatewayError>>;
}

/// DeepSeek 网关的实现。
pub struct DeepSeekModel {
    pub key: String,
}

impl Model for DeepSeekModel {
    async fn turn(&self, items: &[Input]) -> Result<Vec<OutputItem>, GatewayError> {
        deepseek::send_turn(&self.key, items).await
    }
}

/// 本地执行工具：返回给模型的 `function_call_output` 内容（JSON 字符串）。
pub trait ToolHost {
    fn call(&mut self, name: &str, arguments: &str) -> String;
}

/// 一轮跑完的结果：要落库的条目、可见正文、用了几轮。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TurnOutcome {
    /// 按发生顺序排列，可以直接交给 `store.append_turn`（用户消息另算）。
    pub items: Vec<StoredItem>,
    /// 可见正文（界面上显示的那段）。
    pub visible: String,
    /// 用了几次模型调用。
    pub rounds: usize,
    /// 撞上轮次上限时的说明；正常跑完是 `None`。
    pub notice: Option<String>,
}

/// 跑完一轮：反复请求，执行工具，直到模型不再调工具或撞上轮次上限。
pub async fn run_turn<M: Model, H: ToolHost>(
    model: &M,
    host: &mut H,
    mut items: Vec<Input>,
    max_rounds: usize,
) -> Result<TurnOutcome, GatewayError> {
    let limit = clamp_rounds(max_rounds);
    let mut stored: Vec<StoredItem> = Vec::new();
    let mut visible = String::new();

    for round in 0..limit {
        let output = model.turn(&items).await?;
        let mut calls = 0usize;
        for item in output {
            match item {
                OutputItem::Message(text) => {
                    if text.trim().is_empty() {
                        continue;
                    }
                    let message = StoredItem::assistant(&text)
                        .map_err(|error| GatewayError::Request(error.to_string()))?;
                    items.push(Input::from_stored(&message));
                    stored.push(message);
                    visible.push_str(&text);
                }
                OutputItem::FunctionCall {
                    call_id,
                    name,
                    arguments,
                } => {
                    calls += 1;
                    let call = StoredItem::FunctionCall {
                        call_id: call_id.clone(),
                        name: name.clone(),
                        arguments: arguments.clone(),
                    };
                    items.push(Input::from_stored(&call));
                    stored.push(call);

                    let output = host.call(&name, &arguments);
                    let result = StoredItem::FunctionCallOutput { call_id, output };
                    items.push(Input::from_stored(&result));
                    stored.push(result);
                }
                OutputItem::Raw(value) => {
                    items.push(Input::Raw(value.clone()));
                    stored.push(StoredItem::Raw { item: value });
                }
            }
        }

        let rounds = round + 1;
        if calls == 0 {
            return Ok(TurnOutcome {
                items: stored,
                visible,
                rounds,
                notice: None,
            });
        }
        if rounds == limit {
            return Ok(TurnOutcome {
                items: stored,
                visible,
                rounds,
                notice: Some(format!(
                    "这次工具调用到了 {limit} 轮上限，我先停在这里；接着说一句就继续。"
                )),
            });
        }
    }

    // limit >= 1，循环至少跑一次，上面两条出口必中其一。
    unreachable!("工具循环没有出口")
}

/// 真工具：读写本地库，并把硬规则压在这里。
pub struct StoreHost<'a> {
    store: &'a Store,
    conversation: crate::domain::ConversationId,
    at: i64,
    searches: TurnSearches,
    /// 这一轮里真的往档案写过几次（超长重发前的判断依据）。
    writes: usize,
}

impl<'a> StoreHost<'a> {
    pub fn new(store: &'a Store, conversation: crate::domain::ConversationId, at: i64) -> Self {
        StoreHost {
            store,
            conversation,
            at,
            searches: TurnSearches::default(),
            writes: 0,
        }
    }

    /// 这一轮写过档案吗？写过就不能整轮重发了（会把判定写两遍）。
    pub fn wrote(&self) -> bool {
        self.writes > 0
    }

    fn arguments(&self, raw: &str) -> Result<serde_json::Value, ToolError> {
        serde_json::from_str(raw).map_err(|error| {
            ToolError::invalid_arguments(format!(
                "参数不是合法 JSON：{error}。按 schema 重新生成，不要带注释或多层字符串。"
            ))
        })
    }

    fn storage(error: StoreError) -> ToolError {
        match error {
            StoreError::Domain(error) => ToolError::Domain(error),
            other => ToolError::Storage(other.to_string()),
        }
    }

    fn search(&mut self, args: &serde_json::Value) -> Result<String, ToolError> {
        let query = EvidenceQuery::parse(args)?;
        self.searches.note(&query);
        let rows = self.store.search_evidence(&query).map_err(Self::storage)?;
        let truncated = rows.len() == query.clamped_limit();
        let items: Vec<serde_json::Value> = rows
            .iter()
            .map(|evidence| {
                let sections: Vec<serde_json::Value> = evidence
                    .sections()
                    .iter()
                    .map(|(name, text)| {
                        let (preview, cut) = crate::domain::tool::preview(text);
                        serde_json::json!({ "name": name, "text": preview, "truncated": cut })
                    })
                    .collect();
                // 「来源已删除」：会话不在了，日志还在（ADR-0005）。
                let source = evidence
                    .conversation
                    .map(|conversation| {
                        if self
                            .store
                            .conversation(conversation)
                            .ok()
                            .flatten()
                            .is_some()
                        {
                            "conversation"
                        } else {
                            "deleted"
                        }
                    })
                    .unwrap_or("unknown");
                serde_json::json!({
                    "id": evidence.id.0,
                    "kind": evidence.kind.key(),
                    "site": evidence.site,
                    "side": evidence.side.map(|side| side.key()),
                    "finding": evidence.finding.map(|finding| finding.0),
                    "at": date(evidence.at),
                    "source": source,
                    "sections": sections,
                })
            })
            .collect();
        Ok(serde_json::json!({
            "found": rows.len(),
            "limit": query.clamped_limit(),
            "truncated": truncated,
            "items": items,
        })
        .to_string())
    }

    fn record(&mut self, args: &serde_json::Value) -> Result<String, ToolError> {
        let parsed = RecordArgs::parse(args, Some(self.conversation), self.at)?;
        self.searches.require(&parsed.draft.site)?;
        let (finding, evidence) = self
            .store
            .record_with_evidence(parsed.draft, parsed.evidence)
            .map_err(Self::storage)?;
        self.writes += 1;
        Ok(written("record", &finding, evidence.id.0))
    }

    /// 一次想改多条：先攒成一张卡，等用户勾。已有待审的卡就拒绝（一次一张）。
    fn propose(&mut self, args: &serde_json::Value) -> Result<String, ToolError> {
        if let Some(pending) = self
            .store
            .pending_proposal(self.conversation)
            .map_err(Self::storage)?
        {
            return Err(ToolError::PendingProposal {
                items: pending.items.len(),
            });
        }
        let parsed = ProposeArgs::parse(args, Some(self.conversation), self.at)?;
        let proposal = self
            .store
            .create_proposal(Proposal::new(
                ProposalId(0),
                self.conversation,
                self.at,
                parsed.items,
            )?)
            .map_err(Self::storage)?;
        let items: Vec<serde_json::Value> = proposal
            .items
            .iter()
            .enumerate()
            .map(|(index, item)| {
                serde_json::json!({
                    "index": index,
                    "site": item.draft.site,
                    "side": item.draft.side.map(|side| side.key()),
                    "confidence": item.draft.confidence,
                    "default_selected": item.default_selected(),
                })
            })
            .collect();
        Ok(serde_json::json!({
            "ok": true,
            "proposal": proposal.id.0,
            "items": items,
            "notice": "卡已经生成，等用户勾选；不要声称已经写进档案。",
        })
        .to_string())
    }

    /// 排计划：频次 + 动作清单 + 复查日。写进去就是一个新版本（旧版本还在）。
    fn plan(&mut self, args: &serde_json::Value) -> Result<String, ToolError> {
        let parsed = GenerateArgs::parse(args, self.at)?;
        let plan = self
            .store
            .create_plan(Some(self.conversation), self.at, parsed.draft)
            .map_err(Self::storage)?;
        self.writes += 1;
        let exercises: Vec<serde_json::Value> = plan
            .exercises
            .iter()
            .map(|exercise| {
                serde_json::json!({
                    "name": exercise.name,
                    "prescription": exercise.prescription(),
                    "finding": exercise.finding.0,
                })
            })
            .collect();
        Ok(serde_json::json!({
            "ok": true,
            "plan": plan.id.0,
            "version": plan.version,
            "frequency": plan.frequency.zh(),
            "exercises": exercises,
            "review_at": date(plan.review_at),
            "notice": "计划已生效；旧版本仍在，改计划会再生成一个版本。",
        })
        .to_string())
    }

    fn correct(&mut self, args: &serde_json::Value) -> Result<String, ToolError> {
        let id = args
            .get("finding")
            .and_then(serde_json::Value::as_u64)
            .ok_or_else(|| {
                ToolError::invalid_arguments("缺少 finding（要更正的判定编号，整数）。".to_owned())
            })?;
        let target = self
            .store
            .finding(FindingId(id))
            .map_err(Self::storage)?
            .ok_or(ToolError::UnknownFinding(id))?;
        let parsed = CorrectArgs::parse(args, &target, Some(self.conversation), self.at)?;
        self.searches.require(&target.site)?;

        match parsed.kind {
            EvidenceKind::Resolve => {
                let draft = FindingDraft::resolve(&target, self.at);
                let (finding, evidence) = self
                    .store
                    .record_with_evidence(draft, parsed.evidence)
                    .map_err(Self::storage)?;
                self.writes += 1;
                Ok(written("resolve", &finding, evidence.id.0))
            }
            EvidenceKind::Retract => {
                let (retract, evidence) = self
                    .store
                    .retract_with_evidence(target.id, &parsed.reason, self.at, parsed.evidence)
                    .map_err(Self::storage)?;
                self.writes += 1;
                Ok(serde_json::json!({
                    "ok": true,
                    "action": "retract",
                    "finding": retract.finding.0,
                    "site": target.site,
                    "reason": retract.reason,
                    "evidence": evidence.id.0,
                })
                .to_string())
            }
            EvidenceKind::Record | EvidenceKind::Rejection => Err(ToolError::invalid_arguments(
                "correct_finding 只接受 resolve / retract。".to_owned(),
            )),
        }
    }
}

fn written(action: &str, finding: &crate::domain::Finding, evidence: u64) -> String {
    serde_json::json!({
        "ok": true,
        "action": action,
        "finding": finding.id.0,
        "site": finding.site,
        "side": finding.side.map(|side| side.key()),
        "at": date(finding.at),
        "evidence": evidence,
    })
    .to_string()
}

impl ToolHost for StoreHost<'_> {
    fn call(&mut self, name: &str, arguments: &str) -> String {
        let known = [
            SEARCH_EVIDENCE,
            RECORD_FINDING,
            CORRECT_FINDING,
            PROPOSE_FINDINGS,
            GENERATE_PLAN,
        ]
        .contains(&name);
        if !known {
            return ToolError::UnknownTool(name.to_owned()).to_json();
        }
        let args = match self.arguments(arguments) {
            Ok(args) => args,
            Err(error) => return error.to_json(),
        };
        let result = match name {
            SEARCH_EVIDENCE => self.search(&args),
            RECORD_FINDING => self.record(&args),
            CORRECT_FINDING => self.correct(&args),
            GENERATE_PLAN => self.plan(&args),
            _ => self.propose(&args),
        };
        match result {
            Ok(output) => output,
            Err(error) => error.to_json(),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;
    use std::sync::Mutex;

    use serde_json::json;

    use super::*;
    use crate::store::tests::TempStore;

    /// 脚本化的假模型：每次调用按顺序吐一段输出，并把看到的输入记下来。
    struct Scripted {
        script: Mutex<VecDeque<Result<Vec<OutputItem>, GatewayError>>>,
        seen: Mutex<Vec<Vec<Input>>>,
    }

    impl Scripted {
        fn new(script: Vec<Vec<OutputItem>>) -> Scripted {
            Scripted {
                script: Mutex::new(script.into_iter().map(Ok).collect()),
                seen: Mutex::new(Vec::new()),
            }
        }

        fn calls(&self) -> usize {
            self.seen.lock().expect("锁").len()
        }
    }

    impl Model for Scripted {
        async fn turn(&self, items: &[Input]) -> Result<Vec<OutputItem>, GatewayError> {
            self.seen.lock().expect("锁").push(items.to_vec());
            self.script
                .lock()
                .expect("锁")
                .pop_front()
                .expect("脚本里还有一次响应")
        }
    }

    fn call(name: &str, arguments: serde_json::Value) -> OutputItem {
        OutputItem::FunctionCall {
            call_id: format!("call_{name}"),
            name: name.to_owned(),
            arguments: arguments.to_string(),
        }
    }

    /// 四段依据，测试里复用。
    fn evidence() -> serde_json::Value {
        json!({
            "user_said": "蹲到一半膝盖前面紧",
            "test_and_feedback": "靠墙踝背屈：右脚离墙 4 cm",
            "reasoning": "踝背屈受限让膝盖代偿",
            "uncertainty": "没排除髋"
        })
    }

    fn search_args(site: &str) -> serde_json::Value {
        json!({ "site": site })
    }

    fn record_args(site: &str) -> serde_json::Value {
        json!({
            "site": site,
            "side": "left",
            "confidence": 70,
            "values": { "tension": "weak" },
            "evidence": evidence()
        })
    }

    #[test]
    fn a_turn_without_tool_calls_is_one_model_call() {
        let model = Scripted::new(vec![vec![OutputItem::Message(
            "先做踝背屈测试。".to_owned(),
        )]]);
        let temp = TempStore::new("agent-plain");
        let conversation = temp.store().create_conversation(1).expect("会话");
        let mut host = StoreHost::new(temp.store(), conversation.id, 100);
        let outcome = futures_join(|| run_turn(&model, &mut host, vec![Input::user("在吗")], 6))
            .expect("跑完");
        assert_eq!(outcome.visible, "先做踝背屈测试。");
        assert_eq!(outcome.rounds, 1);
        assert_eq!(outcome.notice, None);
        assert_eq!(outcome.items.len(), 1);
        assert!(matches!(outcome.items[0], StoredItem::Message { .. }));
    }

    #[test]
    fn search_then_write_lands_a_finding_and_its_four_sections() {
        let model = Scripted::new(vec![
            vec![call(SEARCH_EVIDENCE, search_args("gluteus-medius"))],
            vec![call(RECORD_FINDING, record_args("gluteus-medius"))],
            vec![OutputItem::Message("记下了：左侧臀中肌张力弱。".to_owned())],
        ]);
        let temp = TempStore::new("agent-round-trip");
        let store = temp.store();
        let conversation = store.create_conversation(1).expect("会话");
        let mut host = StoreHost::new(store, conversation.id, 100);
        let outcome =
            futures_join(|| run_turn(&model, &mut host, vec![Input::user("蹲不下去")], 6))
                .expect("跑完");

        assert_eq!(outcome.rounds, 3);
        assert!(outcome.visible.contains("臀中肌"));

        // 判定与依据都落了库，日志指向这条判定。
        let findings = store.findings().expect("判定");
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].site, "gluteus-medius");
        let log = store.evidence_log().expect("依据");
        assert_eq!(log.len(), 1);
        assert_eq!(log[0].finding, Some(findings[0].id));
        assert_eq!(log[0].uncertainty, "没排除髋");

        // 工具往返按顺序进了这一轮的条目。
        let kinds: Vec<&str> = outcome
            .items
            .iter()
            .map(|item| match item {
                StoredItem::Message { .. } => "message",
                StoredItem::FunctionCall { .. } => "call",
                StoredItem::FunctionCallOutput { .. } => "output",
                StoredItem::Raw { .. } => "raw",
            })
            .collect();
        assert_eq!(kinds, vec!["call", "output", "call", "output", "message"]);

        // 第二次请求里带上了第一次的工具往返：关掉 app 再打开也能重放。
        let seen = model.seen.lock().expect("锁");
        assert_eq!(seen.len(), 3);
        let second = serde_json::to_value(&seen[1]).expect("序列化");
        assert_eq!(second[1]["type"], "function_call");
        assert_eq!(second[1]["name"], SEARCH_EVIDENCE);
        assert_eq!(second[2]["type"], "function_call_output");
        assert_eq!(second[2]["call_id"], second[1]["call_id"]);
    }

    #[test]
    fn writing_before_searching_is_refused_and_the_model_can_recover() {
        let model = Scripted::new(vec![
            // 第一轮就想写：被拒，错误里说明先去查。
            vec![call(RECORD_FINDING, record_args("soleus"))],
            // 第二轮先查同一条，再写。
            vec![call(SEARCH_EVIDENCE, search_args("soleus"))],
            vec![call(RECORD_FINDING, record_args("soleus"))],
            vec![OutputItem::Message("这次记下了。".to_owned())],
        ]);
        let temp = TempStore::new("agent-hard-rule");
        let store = temp.store();
        let conversation = store.create_conversation(1).expect("会话");
        let mut host = StoreHost::new(store, conversation.id, 100);
        let outcome = futures_join(|| run_turn(&model, &mut host, vec![Input::user("小腿紧")], 6))
            .expect("跑完");

        let refused = match &outcome.items[1] {
            StoredItem::FunctionCallOutput { output, .. } => output.clone(),
            other => panic!("第二项应该是工具结果，收到 {other:?}"),
        };
        assert!(
            refused.contains("not_searched"),
            "错误码给模型看：{refused}"
        );
        assert!(refused.contains("search_evidence"));
        assert!(refused.contains("soleus"), "告诉它查哪个部位");

        // 被拒的那次没写库；纠正之后只写了一条。
        assert_eq!(store.findings().expect("判定").len(), 1);
        assert_eq!(store.evidence_log().expect("依据").len(), 1);
    }

    #[test]
    fn the_round_limit_stops_the_loop_and_says_so() {
        let model = Scripted::new(vec![
            vec![call(SEARCH_EVIDENCE, search_args("soleus"))],
            vec![call(SEARCH_EVIDENCE, search_args("soleus"))],
            vec![call(SEARCH_EVIDENCE, search_args("soleus"))],
        ]);
        let temp = TempStore::new("agent-limit");
        let conversation = temp.store().create_conversation(1).expect("会话");
        let mut host = StoreHost::new(temp.store(), conversation.id, 100);
        let outcome = futures_join(|| run_turn(&model, &mut host, vec![Input::user("在吗")], 2))
            .expect("跑完");

        assert_eq!(outcome.rounds, 2);
        assert_eq!(model.calls(), 2, "撞上上限就不再请求了");
        let notice = outcome.notice.expect("要说清楚为什么停下");
        assert!(notice.contains("2 轮上限"), "{notice}");
        // 停下时也不留半对调用：每条 call 后面都跟着它的 output。
        assert_eq!(
            outcome
                .items
                .iter()
                .filter(|item| matches!(item, StoredItem::FunctionCall { .. }))
                .count(),
            outcome
                .items
                .iter()
                .filter(|item| matches!(item, StoredItem::FunctionCallOutput { .. }))
                .count()
        );
    }

    #[test]
    fn resolving_and_retracting_go_through_the_same_hard_rule() {
        let temp = TempStore::new("agent-correct");
        let store = temp.store();
        let conversation = store.create_conversation(1).expect("会话");
        // 先直接落一条判定（绕过工具，模拟上一轮写的）。
        let (finding, _) = store
            .record_with_evidence(
                crate::domain::FindingDraft {
                    site: "soleus".to_owned(),
                    side: Some(crate::domain::Side::Left),
                    values: {
                        let mut values = crate::domain::AxisValues::new();
                        values.set(crate::domain::AxisValue::Tension(
                            crate::domain::Tension::Weak,
                        ));
                        values
                    },
                    confidence: 60,
                    at: 10,
                },
                crate::domain::EvidenceDraft {
                    kind: EvidenceKind::Record,
                    site: "soleus".to_owned(),
                    side: Some(crate::domain::Side::Left),
                    finding: None,
                    conversation: Some(conversation.id),
                    at: 10,
                    user_said: "小腿外侧紧".to_owned(),
                    test_and_feedback: "单腿提踵 10 次".to_owned(),
                    reasoning: "比目鱼肌张力弱".to_owned(),
                    uncertainty: "未涉及".to_owned(),
                },
            )
            .expect("落一条");

        let model = Scripted::new(vec![
            vec![call(SEARCH_EVIDENCE, search_args("soleus"))],
            vec![call(
                CORRECT_FINDING,
                json!({ "finding": finding.id.0, "action": "retract", "reason": "看错了", "evidence": evidence() }),
            )],
            vec![OutputItem::Message("撤掉了。".to_owned())],
        ]);
        let mut host = StoreHost::new(store, conversation.id, 100);
        let outcome =
            futures_join(|| run_turn(&model, &mut host, vec![Input::user("其实不是小腿")], 6))
                .expect("跑完");
        assert!(outcome.visible.contains("撤掉"));

        // 撤回是追加事件：判定还在，投影里已经没有了，日志里多一条 retract。
        assert_eq!(store.findings().expect("判定").len(), 1);
        assert_eq!(store.retractions().expect("撤回").len(), 1);
        assert!(store.projection().expect("投影").is_empty());
        let log = store.evidence_log().expect("依据");
        assert_eq!(log.len(), 2);
        assert_eq!(log[1].kind, EvidenceKind::Retract);
    }

    #[test]
    fn searching_in_an_earlier_turn_does_not_count_for_this_one() {
        let temp = TempStore::new("agent-cross-turn");
        let store = temp.store();
        let conversation = store.create_conversation(1).expect("会话");

        // 上一轮查过 soleus。
        let first = Scripted::new(vec![
            vec![call(SEARCH_EVIDENCE, search_args("soleus"))],
            vec![OutputItem::Message("查过了。".to_owned())],
        ]);
        let mut host = StoreHost::new(store, conversation.id, 100);
        futures_join(|| run_turn(&first, &mut host, vec![Input::user("先看看")], 6)).expect("上一轮");

        // 这一轮直接写：不认上一轮的账，必须被拒。
        let second = Scripted::new(vec![
            vec![call(RECORD_FINDING, record_args("soleus"))],
            vec![OutputItem::Message("记下了。".to_owned())],
        ]);
        let mut host = StoreHost::new(store, conversation.id, 200);
        let outcome =
            futures_join(|| run_turn(&second, &mut host, vec![Input::user("现在写")], 6)).expect("这一轮");
        let refused = match &outcome.items[1] {
            StoredItem::FunctionCallOutput { output, .. } => output.clone(),
            other => panic!("应该是工具结果，收到 {other:?}"),
        };
        assert!(refused.contains("not_searched"), "{refused}");
        assert!(store.findings().expect("判定").is_empty());
    }

    #[test]
    fn a_log_whose_conversation_was_deleted_says_so_in_the_search_result() {
        let temp = TempStore::new("agent-source-deleted");
        let store = temp.store();
        let doomed = store.create_conversation(1).expect("会话");
        store
            .record_with_evidence(
                crate::domain::FindingDraft {
                    site: "soleus".to_owned(),
                    side: Some(crate::domain::Side::Left),
                    values: {
                        let mut values = crate::domain::AxisValues::new();
                        values.set(crate::domain::AxisValue::Tension(
                            crate::domain::Tension::Weak,
                        ));
                        values
                    },
                    confidence: 60,
                    at: 10,
                },
                crate::domain::EvidenceDraft {
                    kind: EvidenceKind::Record,
                    site: "soleus".to_owned(),
                    side: Some(crate::domain::Side::Left),
                    finding: None,
                    conversation: Some(doomed.id),
                    at: 10,
                    user_said: "小腿紧".to_owned(),
                    test_and_feedback: "提踵".to_owned(),
                    reasoning: "张力弱".to_owned(),
                    uncertainty: "未涉及".to_owned(),
                },
            )
            .expect("落一条");
        store.delete_conversation(doomed.id).expect("删会话");

        let mut host = StoreHost::new(store, doomed.id, 20);
        let output = host.call(SEARCH_EVIDENCE, r#"{"site":"soleus"}"#);
        assert!(output.contains("\"source\":\"deleted\""), "{output}");
        // 日志还在（ADR-0005）。
        assert_eq!(store.evidence_log().expect("日志").len(), 1);
    }

    fn proposal_item(site: &str, side: &str, confidence: u8) -> serde_json::Value {
        json!({
            "site": site,
            "side": side,
            "confidence": confidence,
            "values": { "tension": "weak" },
            "evidence": evidence()
        })
    }

    #[test]
    fn proposing_three_items_makes_one_card_and_writes_nothing_yet() {
        let model = Scripted::new(vec![
            vec![call(
                PROPOSE_FINDINGS,
                json!({ "items": [
                    proposal_item("gluteus-medius", "left", 78),
                    proposal_item("soleus", "left", 52),
                    proposal_item("soleus", "right", 64),
                ]}),
            )],
            vec![OutputItem::Message("先看看我这几条判断。".to_owned())],
        ]);
        let temp = TempStore::new("agent-propose");
        let store = temp.store();
        let conversation = store.create_conversation(1).expect("会话");
        let mut host = StoreHost::new(store, conversation.id, 100);
        let outcome =
            futures_join(|| run_turn(&model, &mut host, vec![Input::user("蹲不下去")], 6)).expect("跑完");

        // 结果里告诉模型：卡生成了，等用户勾。
        let output = match &outcome.items[1] {
            StoredItem::FunctionCallOutput { output, .. } => output.clone(),
            other => panic!("应该是工具结果，收到 {other:?}"),
        };
        assert!(output.contains("\"proposal\":1"), "{output}");
        assert!(output.contains("\"default_selected\":false"), "低置信度默认不勾：{output}");

        // 一张卡、三项、一条判定都没写。
        let pending = store
            .pending_proposal(conversation.id)
            .expect("读")
            .expect("有一张");
        assert_eq!(pending.items.len(), 3);
        assert!(store.findings().expect("判定").is_empty());
        assert!(store.evidence_log().expect("依据").is_empty());
    }

    #[test]
    fn proposing_again_while_a_card_is_pending_is_refused() {
        let temp = TempStore::new("agent-propose-pending");
        let store = temp.store();
        let conversation = store.create_conversation(1).expect("会话");
        let mut host = StoreHost::new(store, conversation.id, 100);
        let first = host.call(
            PROPOSE_FINDINGS,
            &json!({ "items": [proposal_item("soleus", "left", 70)] }).to_string(),
        );
        assert!(first.contains("\"ok\":true"), "{first}");

        let second = host.call(
            PROPOSE_FINDINGS,
            &json!({ "items": [proposal_item("soleus", "right", 70)] }).to_string(),
        );
        assert!(second.contains("pending_proposal"), "{second}");
        assert!(second.contains("还有 1 项"), "告诉它卡在哪：{second}");
    }

    #[test]
    fn more_than_eight_items_is_refused_with_an_instruction_to_split() {
        let temp = TempStore::new("agent-propose-too-many");
        let store = temp.store();
        let conversation = store.create_conversation(1).expect("会话");
        let mut host = StoreHost::new(store, conversation.id, 100);
        let items: Vec<serde_json::Value> = (0..9)
            .map(|_| proposal_item("soleus", "left", 70))
            .collect();
        let output = host.call(PROPOSE_FINDINGS, &json!({ "items": items }).to_string());
        assert!(output.contains("too_many_items"), "{output}");
        assert!(output.contains("分几轮"), "给出下一步：{output}");
        assert!(store.proposals(conversation.id).expect("列表").is_empty());
    }

    #[test]
    fn the_round_limit_is_clamped_to_a_working_range() {
        assert_eq!(clamp_rounds(0), 1);
        assert_eq!(clamp_rounds(6), 6);
        assert_eq!(clamp_rounds(1000), MAX_ROUNDS_LIMIT);
    }

    #[test]
    fn a_broken_argument_string_is_reported_as_an_argument_error() {
        let temp = TempStore::new("agent-broken-json");
        let conversation = temp.store().create_conversation(1).expect("会话");
        let mut host = StoreHost::new(temp.store(), conversation.id, 100);
        let output = host.call(SEARCH_EVIDENCE, "{site: soleus}");
        assert!(output.contains("invalid_arguments"), "{output}");
        assert!(output.contains("JSON"));
    }

    #[test]
    fn an_unknown_tool_is_named_back_to_the_model() {
        let temp = TempStore::new("agent-unknown-tool");
        let conversation = temp.store().create_conversation(1).expect("会话");
        let mut host = StoreHost::new(temp.store(), conversation.id, 100);
        let output = host.call("delete_everything", "{}");
        assert!(output.contains("unknown_tool"));
        assert!(output.contains(SEARCH_EVIDENCE));
    }

    /// 一条挂在计划动作上的判定。
    fn seed_finding(store: &Store, site: &str) -> crate::domain::Finding {
        store
            .record(crate::domain::FindingDraft {
                site: site.to_owned(),
                side: Some(crate::domain::Side::Left),
                values: {
                    let mut values = crate::domain::AxisValues::new();
                    values.set(crate::domain::AxisValue::Tension(crate::domain::Tension::Weak));
                    values
                },
                confidence: 70,
                at: 10,
            })
            .expect("写一条判定")
    }

    fn plan_args(finding: u64) -> serde_json::Value {
        json!({
            "frequency": { "unit": "per-week", "count": 3 },
            "exercises": [
                { "name": "臀桥", "sets": 3, "reps": 10, "finding": finding }
            ]
        })
    }

    fn ready_training() -> crate::domain::TrainingContext {
        crate::domain::TrainingContext {
            days_per_week: Some(3),
            minutes_per_session: Some(30),
            places: vec![crate::domain::Place::Home],
            equipment: vec!["band".to_owned()],
        }
    }

    #[test]
    fn generating_a_plan_writes_a_new_version_and_refuses_before_training_conditions() {
        let temp = TempStore::new("agent-plan");
        let store = temp.store();
        let conversation = store.create_conversation(1).expect("会话");
        let finding = seed_finding(store, "gluteus-medius");
        let mut host = StoreHost::new(store, conversation.id, 100);

        // 训练条件还没填：拒绝，并说清缺什么（模型该去追问，不是编）。
        let refused = host.call(GENERATE_PLAN, &plan_args(finding.id.0).to_string());
        assert!(refused.contains("training_incomplete"), "{refused}");
        assert!(refused.contains("每周能练几天"), "{refused}");
        assert!(store.active_plan().expect("读").is_none());

        store.save_training(&ready_training()).expect("填训练条件");
        let written = host.call(GENERATE_PLAN, &plan_args(finding.id.0).to_string());
        assert!(written.contains("\"version\":1"), "{written}");
        assert!(written.contains("每周 3 次"), "{written}");
        let first = store.active_plan().expect("读").expect("有");
        assert_eq!(first.exercises[0].finding, finding.id);

        // 再调一次 = 新版本，旧版本留着。
        let again = host.call(GENERATE_PLAN, &plan_args(finding.id.0).to_string());
        assert!(again.contains("\"version\":2"), "{again}");
        assert_eq!(store.plans().expect("版本").len(), 2);
        assert_eq!(store.active_plan().expect("读").expect("有").version, 2);
    }

    /// 同步地跑一个 async 函数：测试里不需要真的调度器。
    fn futures_join<F: std::future::Future>(make: impl FnOnce() -> F) -> F::Output {
        block_on(make())
    }

    fn block_on<F: std::future::Future>(future: F) -> F::Output {
        use std::task::{Context, Poll, Waker};
        let mut future = std::pin::pin!(future);
        let mut context = Context::from_waker(Waker::noop());
        loop {
            if let Poll::Ready(value) = future.as_mut().poll(&mut context) {
                return value;
            }
        }
    }
}
