//! 提议卡的存储：一次审完整张卡（#45）。
//!
//! 审核是一个事务：采纳项逐条落成判定 + 依据日志，不要项落一条 `rejection`
//! 证据，卡置为 Accepted / Dismissed，并把「审完了」那条不渲染的用户消息
//! （`StoredItem::ReviewDecision`）一起追加到会话末尾。任一步失败全回滚，卡仍是
//! 待审、那条决策消息也不存在；卡的状态与它写下的判定不能各说各话。提交即定案，
//! 没有把卡放回待审的路径。

use redb::{ReadableDatabase, ReadableTable, TableDefinition};

use super::{Store, StoreError, db_error};
use crate::domain::{
    Conversation, ConversationId, DomainError, Entry, Evidence, EvidenceDraft, EvidenceId,
    EvidenceKind, Finding, FindingId, MessageId, Proposal, ProposalDecision, ProposalId,
    StoredItem, Timestamp,
};

/// 提议：编号 → Proposal 的 JSON。
pub(crate) const PROPOSALS: TableDefinition<u64, &str> = TableDefinition::new("proposals");

/// 一次审核落库的结果：卡、写下的判定与依据、交给模型的那条决策消息。
#[derive(Debug)]
pub struct ReviewOutcome {
    pub proposal: Proposal,
    pub findings: Vec<Finding>,
    pub evidence: Vec<Evidence>,
    pub decision_text: String,
    /// 与审核同一事务落库的那条决策消息；api 不渲染它，只拿它当这一轮的用户消息。
    pub decision: Entry,
}

impl Store {
    /// 开一张待确认的卡（一个会话同时只能有一张）。
    pub fn create_proposal(&self, proposal: Proposal) -> Result<Proposal, StoreError> {
        if let Some(pending) = self.pending_proposal(proposal.conversation)? {
            return Err(StoreError::Domain(DomainError::PendingProposalExists(
                pending.id,
            )));
        }
        let id = ProposalId(self.next_proposal_id()?);
        let proposal = Proposal::new(id, proposal.conversation, proposal.at, proposal.items)?;
        let write = self.db().begin_write().map_err(db_error)?;
        {
            let mut table = write.open_table(PROPOSALS).map_err(db_error)?;
            table
                .insert(proposal.id.0, to_json(&proposal)?.as_str())
                .map_err(db_error)?;
            drop(table);
            let mut meta = write.open_table(super::META).map_err(db_error)?;
            meta.insert("next_proposal_id", (proposal.id.0 + 1).to_string().as_str())
                .map_err(db_error)?;
        }
        write.commit().map_err(db_error)?;
        Ok(proposal)
    }

    /// 一张卡。
    pub fn proposal(&self, id: ProposalId) -> Result<Option<Proposal>, StoreError> {
        let read = self.db().begin_read().map_err(db_error)?;
        let table = read.open_table(PROPOSALS).map_err(db_error)?;
        let json = table
            .get(id.0)
            .map_err(db_error)?
            .map(|value| value.value().to_owned());
        json.map(|json| from_json(&json)).transpose()
    }

    /// 这个会话里待审的卡（一张会话同时最多一张）。
    ///
    /// 只有会话里有指向它的卡片行、且状态仍是 Pending 的卡才算待审。没有卡片行
    /// 的旧卡静默关闭：不显示、不挡新提议。
    pub fn pending_proposal(
        &self,
        conversation: crate::domain::ConversationId,
    ) -> Result<Option<Proposal>, StoreError> {
        let mut shown = std::collections::HashSet::new();
        for entry in self.items(conversation)? {
            if let StoredItem::ProposalCard { proposal } = entry.item {
                shown.insert(proposal);
            }
        }
        Ok(self
            .proposals(conversation)?
            .into_iter()
            .find(|proposal| shown.contains(&proposal.id) && proposal.is_pending()))
    }

    /// 这个会话的全部提议，按（时间、编号）升序。
    pub fn proposals(
        &self,
        conversation: crate::domain::ConversationId,
    ) -> Result<Vec<Proposal>, StoreError> {
        let read = self.db().begin_read().map_err(db_error)?;
        let table = read.open_table(PROPOSALS).map_err(db_error)?;
        let mut all = Vec::new();
        for entry in table.iter().map_err(db_error)? {
            let (_, value) = entry.map_err(db_error)?;
            let proposal: Proposal = from_json(value.value())?;
            if proposal.conversation == conversation {
                all.push(proposal);
            }
        }
        all.sort_by_key(|proposal| (proposal.at, proposal.id));
        Ok(all)
    }

    /// 一次审完整张卡：采纳项落判定 + 依据，不要项落 rejection 证据，
    /// 卡置 Accepted / Dismissed，决策消息追加到会话末尾。**一个事务**；任何一项
    /// 失败都不写。
    ///
    /// 卡、会话、卡片行与 next_* 编号都在事务里重读：提交前别处改了库，这里看到
    /// 的是同一份状态，不会拿事务外的旧值写出半张卡。
    pub fn review_proposal(
        &self,
        conversation: ConversationId,
        id: ProposalId,
        decisions: &[ProposalDecision],
        at: Timestamp,
    ) -> Result<ReviewOutcome, StoreError> {
        let write = self.db().begin_write().map_err(db_error)?;

        // 卡：事务内重读，后面的校验都基于这份状态。
        let mut proposal: Proposal = {
            let table = write.open_table(PROPOSALS).map_err(db_error)?;
            let json = table
                .get(id.0)
                .map_err(db_error)?
                .map(|value| value.value().to_owned());
            match json {
                Some(json) => from_json(&json)?,
                None => return Err(StoreError::Domain(DomainError::UnknownProposal(id))),
            }
        };
        if proposal.conversation != conversation {
            return Err(StoreError::Domain(DomainError::ProposalNotInConversation(
                id,
            )));
        }
        if !proposal.is_pending() {
            return Err(StoreError::Domain(DomainError::ProposalAlreadyReviewed(id)));
        }
        if decisions.is_empty() {
            return Err(StoreError::Domain(DomainError::EmptyProposalDecisions));
        }

        // 会话要还在；它的更新时间跟这一批条目一起推进。
        let mut record: Conversation = {
            let table = write
                .open_table(super::conversations::CONVERSATIONS)
                .map_err(db_error)?;
            let json = table
                .get(conversation.0)
                .map_err(db_error)?
                .map(|value| value.value().to_owned());
            match json {
                Some(json) => from_json(&json)?,
                None => {
                    return Err(StoreError::Domain(DomainError::UnknownConversation(
                        conversation.0,
                    )));
                }
            }
        };

        // 与 pending_proposal 同一个「待审」定义：会话里得有指向它的卡片行。
        // 没有卡片行的旧卡静默关闭，审它只会得到「已经审过了」。
        let mut shown = false;
        {
            let table = write
                .open_table(super::conversations::MESSAGES)
                .map_err(db_error)?;
            for entry in table.iter().map_err(db_error)? {
                let (_, value) = entry.map_err(db_error)?;
                let entry: Entry = from_json(value.value())?;
                if entry.conversation == conversation
                    && matches!(entry.item, StoredItem::ProposalCard { proposal } if proposal == id)
                {
                    shown = true;
                    break;
                }
            }
        }
        if !shown {
            return Err(StoreError::Domain(DomainError::ProposalAlreadyReviewed(id)));
        }

        // 索引唯一、在范围内，且每一项都要有决定（勾/不勾天然二值）。
        let mut seen = vec![false; proposal.items.len()];
        for decision in decisions {
            if decision.index >= proposal.items.len() {
                return Err(StoreError::Domain(DomainError::UnknownProposalItem(
                    decision.index,
                )));
            }
            if seen[decision.index] {
                return Err(StoreError::Domain(DomainError::DuplicateProposalItem(
                    decision.index,
                )));
            }
            seen[decision.index] = true;
        }
        let missing = seen
            .iter()
            .enumerate()
            .filter_map(|(index, seen)| (!seen).then_some(index))
            .collect::<Vec<_>>();
        if !missing.is_empty() {
            return Err(StoreError::Domain(
                DomainError::IncompleteProposalDecisions(missing),
            ));
        }

        let mut sorted = decisions.to_vec();
        sorted.sort_by_key(|decision| decision.index);
        let decision_text = proposal.review_text(&sorted);

        let accepted_count = sorted.iter().filter(|decision| decision.accept).count();
        let mut findings = Vec::with_capacity(accepted_count);
        let mut evidence = Vec::with_capacity(sorted.len());
        // 编号也在事务里读：别处同时写过档案时，不能拿事务外的旧号覆盖它。
        let (mut next_finding, mut next_evidence, next_message) = {
            let meta = write.open_table(super::META).map_err(db_error)?;
            let read = |key: &str| -> Result<u64, StoreError> {
                Ok(meta
                    .get(key)
                    .map_err(db_error)?
                    .map(|value| value.value().parse().unwrap_or(1))
                    .unwrap_or(1))
            };
            (
                read("next_finding_id")?,
                read("next_evidence_id")?,
                read("next_message_id")?,
            )
        };

        {
            let mut finding_table = write
                .open_table(super::findings::FINDINGS)
                .map_err(db_error)?;
            for decision in &sorted {
                let item = &proposal.items[decision.index];
                if decision.accept {
                    let finding = Finding::new(FindingId(next_finding), item.draft.clone())?;
                    let mut draft = item.evidence.clone();
                    draft.kind = EvidenceKind::Record;
                    draft.finding = Some(finding.id);
                    let record = Evidence::new(EvidenceId(next_evidence), draft)?;

                    finding_table
                        .insert(finding.id.0, to_json(&finding)?.as_str())
                        .map_err(db_error)?;
                    super::insert_evidence(&write, &record)?;

                    proposal.mark_accepted(decision.index, finding.id);
                    findings.push(finding);
                    evidence.push(record);
                    next_finding += 1;
                    next_evidence += 1;
                } else {
                    let reason = decision.reason.trim();
                    let rejection = Evidence::new(
                        EvidenceId(next_evidence),
                        EvidenceDraft {
                            kind: EvidenceKind::Rejection,
                            site: item.draft.site.clone(),
                            side: item.draft.side,
                            finding: None,
                            conversation: Some(conversation),
                            at,
                            user_said: if reason.is_empty() {
                                crate::domain::evidence::NO_REASON.to_owned()
                            } else {
                                reason.to_owned()
                            },
                            test_and_feedback: String::new(),
                            reasoning: String::new(),
                            uncertainty: String::new(),
                        },
                    )?;
                    super::insert_evidence(&write, &rejection)?;
                    proposal.mark_rejected(decision.index, reason);
                    evidence.push(rejection);
                    next_evidence += 1;
                }
            }
            drop(finding_table);

            proposal.mark_reviewed(at);
            let mut table = write.open_table(PROPOSALS).map_err(db_error)?;
            table
                .insert(proposal.id.0, to_json(&proposal)?.as_str())
                .map_err(db_error)?;
            drop(table);
            super::bump(&write, "next_finding_id", next_finding)?;
            super::bump(&write, "next_evidence_id", next_evidence)?;
        }

        // 决策消息跟审核同一个事务：提交成功就一定有一轮可重试的用户消息，
        // 提交失败就一条都不留。
        let decision = Entry {
            id: MessageId(next_message),
            conversation,
            at,
            item: StoredItem::ReviewDecision {
                text: decision_text.clone(),
            },
        };
        {
            let mut messages = write
                .open_table(super::conversations::MESSAGES)
                .map_err(db_error)?;
            messages
                .insert(decision.id.0, to_json(&decision)?.as_str())
                .map_err(db_error)?;
        }
        super::bump(&write, "next_message_id", next_message + 1)?;

        record.updated_at = record.updated_at.max(at);
        {
            let mut conversations = write
                .open_table(super::conversations::CONVERSATIONS)
                .map_err(db_error)?;
            conversations
                .insert(conversation.0, to_json(&record)?.as_str())
                .map_err(db_error)?;
        }
        write.commit().map_err(db_error)?;
        Ok(ReviewOutcome {
            proposal,
            findings,
            evidence,
            decision_text,
            decision,
        })
    }

    fn next_proposal_id(&self) -> Result<u64, StoreError> {
        Ok(self
            .meta("next_proposal_id")?
            .and_then(|value| value.parse().ok())
            .unwrap_or(1))
    }
}

fn to_json<T: serde::Serialize>(value: &T) -> Result<String, StoreError> {
    serde_json::to_string(value).map_err(|error| StoreError::Db(format!("写库序列化失败：{error}")))
}

fn from_json<T: serde::de::DeserializeOwned>(json: &str) -> Result<T, StoreError> {
    serde_json::from_str(json).map_err(|error| StoreError::Db(format!("读库反序列化失败：{error}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{
        AxisValue, AxisValues, ConversationId, FindingDraft, ItemState, ProposalItem,
        ProposalStatus, Side, Tension,
    };
    use crate::store::tests::TempStore;

    fn item(site: &str, side: Option<Side>, confidence: u8, at: Timestamp) -> ProposalItem {
        let mut values = AxisValues::new();
        values.set(AxisValue::Tension(Tension::Weak));
        ProposalItem::new(
            FindingDraft {
                site: site.to_owned(),
                side,
                values,
                confidence,
                at,
            },
            EvidenceDraft {
                kind: EvidenceKind::Record,
                site: site.to_owned(),
                side,
                finding: None,
                conversation: Some(ConversationId(1)),
                at,
                user_said: "蹲不下去".to_owned(),
                test_and_feedback: "靠墙踝背屈差 4 cm".to_owned(),
                reasoning: "背屈受限".to_owned(),
                uncertainty: "没排除髋".to_owned(),
            },
        )
    }

    fn card(conversation: ConversationId, at: Timestamp) -> Proposal {
        Proposal::new(
            ProposalId(0),
            conversation,
            at,
            vec![
                item("gluteus-medius", Some(Side::Left), 78, at),
                item("soleus", Some(Side::Left), 52, at),
                item("soleus", Some(Side::Right), 64, at),
            ],
        )
        .expect("合法")
    }

    /// 把卡放进时间线；正常流程里 `api::reply` 在这一轮末尾做这件事。
    fn link_card(store: &Store, conversation: ConversationId, proposal: ProposalId) {
        store
            .append_turn(
                conversation,
                vec![StoredItem::ProposalCard { proposal }],
                120,
            )
            .expect("卡片行");
    }

    fn decision(index: usize, accept: bool, reason: &str) -> ProposalDecision {
        ProposalDecision {
            index,
            accept,
            reason: reason.to_owned(),
        }
    }

    #[test]
    fn a_new_card_lands_as_the_only_pending_one() {
        let temp = TempStore::new("proposals-create");
        let store = temp.store();
        let conversation = store.create_conversation(100).expect("会话");
        let saved = store
            .create_proposal(card(conversation.id, 110))
            .expect("开卡");
        assert_eq!(saved.id, ProposalId(1));
        link_card(store, conversation.id, saved.id);
        assert_eq!(
            store
                .pending_proposal(conversation.id)
                .expect("待审")
                .expect("有")
                .id,
            saved.id
        );
        // 一个会话同时只能有一张待审的卡（工具层靠这个拒绝第二次提议）。
        assert!(store.proposals(conversation.id).expect("列表").len() == 1);
    }

    #[test]
    fn a_card_without_a_timeline_row_is_closed() {
        let mut temp = TempStore::new("proposals-no-row");
        let row_id;
        let saved_id;
        {
            let store = temp.store();
            let conversation = store.create_conversation(100).expect("会话");
            let old = store
                .create_proposal(card(conversation.id, 110))
                .expect("旧卡");
            assert!(
                store
                    .pending_proposal(conversation.id)
                    .expect("读")
                    .is_none(),
                "没有卡片行的旧卡静默关闭"
            );

            // 旧卡不挡新的提议。
            let saved = store
                .create_proposal(card(conversation.id, 120))
                .expect("新卡");
            saved_id = saved.id;
            assert!(saved.id > old.id);
            let entries = store
                .append_turn(
                    conversation.id,
                    vec![crate::domain::StoredItem::ProposalCard { proposal: saved.id }],
                    130,
                )
                .expect("卡片行");
            row_id = entries[0].id;
            assert_eq!(
                store
                    .pending_proposal(conversation.id)
                    .expect("读")
                    .expect("有")
                    .id,
                saved.id
            );
        }

        let store = temp.reopen();
        let rows: Vec<_> = store
            .items(crate::domain::ConversationId(1))
            .expect("条目")
            .into_iter()
            .filter(|entry| matches!(entry.item, crate::domain::StoredItem::ProposalCard { .. }))
            .collect();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, row_id, "重开库后卡片行的 MessageId 不变");
        assert_eq!(
            store
                .pending_proposal(crate::domain::ConversationId(1))
                .expect("读")
                .expect("有")
                .id,
            saved_id
        );
    }

    #[test]
    fn one_review_writes_accepted_items_and_rejections_in_one_go() {
        let temp = TempStore::new("proposals-review");
        let store = temp.store();
        let conversation = store.create_conversation(100).expect("会话");
        let saved = store
            .create_proposal(card(conversation.id, 110))
            .expect("开卡");
        link_card(store, conversation.id, saved.id);

        let outcome = store
            .review_proposal(
                conversation.id,
                saved.id,
                &[
                    decision(0, true, ""),
                    decision(1, false, "不是小腿，是膝盖"),
                    decision(2, true, ""),
                ],
                200,
            )
            .expect("审完");

        assert_eq!(outcome.findings.len(), 2);
        assert_eq!(outcome.evidence.len(), 3);
        assert_eq!(outcome.proposal.status, ProposalStatus::Accepted);
        assert_eq!(outcome.proposal.items[0].state, ItemState::Accepted);
        assert_eq!(outcome.proposal.items[1].state, ItemState::Rejected);
        assert_eq!(outcome.proposal.items[2].state, ItemState::Accepted);
        assert_eq!(outcome.proposal.items[0].rejection_reason, None);
        assert_eq!(
            outcome.proposal.items[1].rejection_reason.as_deref(),
            Some("不是小腿，是膝盖"),
            "拒绝理由留着给已处理的卡回看"
        );
        let stored = store.proposal(saved.id).expect("读").expect("在");
        assert_eq!(
            stored.items[1].rejection_reason.as_deref(),
            Some("不是小腿，是膝盖")
        );

        let findings = store.findings().expect("判定");
        assert_eq!(findings.len(), 2);
        let log = store.evidence_log().expect("依据");
        assert_eq!(log.len(), 3);
        assert_eq!(
            log.iter()
                .filter(|evidence| evidence.kind == EvidenceKind::Record)
                .count(),
            2,
            "采纳项各写一条 record 证据"
        );
        let rejection = log
            .iter()
            .find(|evidence| evidence.kind == EvidenceKind::Rejection)
            .expect("拒绝证据");
        assert_eq!(rejection.user_said, "不是小腿，是膝盖");
        assert_eq!(rejection.site, "soleus");
        assert!(
            store
                .pending_proposal(conversation.id)
                .expect("读")
                .is_none()
        );
        assert!(outcome.decision_text.contains("采纳第 1、3 项"));
        assert!(
            outcome
                .decision_text
                .contains("不要第 2 项（左比目鱼肌，理由：不是小腿，是膝盖）")
        );
    }

    #[test]
    fn rejecting_every_item_dismisses_the_card_and_writes_only_rejections() {
        let temp = TempStore::new("proposals-all-rejected");
        let store = temp.store();
        let conversation = store.create_conversation(100).expect("会话");
        let saved = store
            .create_proposal(card(conversation.id, 110))
            .expect("开卡");
        link_card(store, conversation.id, saved.id);

        let outcome = store
            .review_proposal(
                conversation.id,
                saved.id,
                &[
                    decision(0, false, ""),
                    decision(1, false, "不是小腿，是膝盖"),
                    decision(2, false, ""),
                ],
                200,
            )
            .expect("全不要");

        assert_eq!(outcome.proposal.status, ProposalStatus::Dismissed);
        assert_eq!(outcome.proposal.accepted_count(), 0);
        assert!(store.findings().expect("判定").is_empty());
        let log = store.evidence_log().expect("依据");
        assert_eq!(log.len(), 3);
        assert!(
            log.iter()
                .all(|evidence| evidence.kind == EvidenceKind::Rejection)
        );
        assert_eq!(log[0].user_said, crate::domain::evidence::NO_REASON);
        assert_eq!(log[1].user_said, "不是小腿，是膝盖");
        assert!(
            store
                .pending_proposal(conversation.id)
                .expect("待审")
                .is_none()
        );
        assert!(
            outcome
                .decision_text
                .contains("不要第 1 项（左臀中肌，没写理由）")
        );
    }

    #[test]
    fn a_review_refuses_bad_decisions_and_a_second_submit() {
        let temp = TempStore::new("proposals-review-errors");
        let store = temp.store();
        let conversation = store.create_conversation(100).expect("会话");
        let saved = store
            .create_proposal(card(conversation.id, 110))
            .expect("开卡");
        link_card(store, conversation.id, saved.id);
        let other = store.create_conversation(200).expect("另一个会话");

        assert_eq!(
            store
                .review_proposal(conversation.id, saved.id, &[], 200)
                .unwrap_err(),
            StoreError::Domain(DomainError::EmptyProposalDecisions)
        );
        assert_eq!(
            store
                .review_proposal(conversation.id, saved.id, &[decision(9, true, "")], 200)
                .unwrap_err(),
            StoreError::Domain(DomainError::UnknownProposalItem(9))
        );
        assert_eq!(
            store
                .review_proposal(
                    conversation.id,
                    saved.id,
                    &[decision(0, true, ""), decision(0, false, "")],
                    200
                )
                .unwrap_err(),
            StoreError::Domain(DomainError::DuplicateProposalItem(0))
        );
        assert_eq!(
            store
                .review_proposal(conversation.id, saved.id, &[decision(0, true, "")], 200)
                .unwrap_err(),
            StoreError::Domain(DomainError::IncompleteProposalDecisions(vec![1, 2]))
        );
        assert_eq!(
            store
                .review_proposal(
                    other.id,
                    saved.id,
                    &[
                        decision(0, true, ""),
                        decision(1, true, ""),
                        decision(2, true, ""),
                    ],
                    200,
                )
                .unwrap_err(),
            StoreError::Domain(DomainError::ProposalNotInConversation(saved.id))
        );
        assert!(
            store
                .proposal(saved.id)
                .expect("读")
                .expect("在")
                .is_pending()
        );

        store
            .review_proposal(
                conversation.id,
                saved.id,
                &[
                    decision(0, true, ""),
                    decision(1, true, ""),
                    decision(2, true, ""),
                ],
                210,
            )
            .expect("第一次提交");
        assert_eq!(
            store
                .review_proposal(
                    conversation.id,
                    saved.id,
                    &[
                        decision(0, false, ""),
                        decision(1, false, ""),
                        decision(2, false, ""),
                    ],
                    220,
                )
                .unwrap_err(),
            StoreError::Domain(DomainError::ProposalAlreadyReviewed(saved.id))
        );
        assert_eq!(
            store.findings().expect("判定").len(),
            3,
            "重复提交不会再写一遍"
        );
    }

    #[test]
    fn a_failure_halfway_rolls_back_the_whole_card() {
        let temp = TempStore::new("proposals-review-rollback");
        let store = temp.store();
        let conversation = store.create_conversation(100).expect("会话");
        let saved = store
            .create_proposal(card(conversation.id, 110))
            .expect("开卡");
        link_card(store, conversation.id, saved.id);

        // 绕过开卡校验，把第二项改成词表外的部位：第一项写完、第二项会失败。
        let mut broken = store.proposal(saved.id).expect("读").expect("在");
        broken.items[1].draft.site = "gluteus".to_owned();
        broken.items[1].evidence.site = "gluteus".to_owned();
        let write = store.db().begin_write().expect("写事务");
        {
            let mut table = write.open_table(PROPOSALS).expect("表");
            table
                .insert(saved.id.0, to_json(&broken).expect("序列化").as_str())
                .expect("写");
        }
        write.commit().expect("提交");

        let error = store
            .review_proposal(
                conversation.id,
                saved.id,
                &[
                    decision(0, true, ""),
                    decision(1, true, ""),
                    decision(2, true, ""),
                ],
                200,
            )
            .unwrap_err();
        assert_eq!(
            error,
            StoreError::Domain(DomainError::UnknownSite("gluteus".to_owned()))
        );
        assert!(store.findings().expect("判定").is_empty(), "第一项也回滚了");
        assert!(store.evidence_log().expect("依据").is_empty());
        let card = store.proposal(saved.id).expect("读").expect("在");
        assert!(card.is_pending(), "卡仍是待审");
        assert!(
            card.items
                .iter()
                .all(|item| item.state == ItemState::Pending)
        );
        assert!(
            store
                .pending_proposal(conversation.id)
                .expect("读")
                .is_some()
        );
        assert_eq!(
            store.items(conversation.id).expect("条目").len(),
            1,
            "决策消息也跟整张卡一起回滚，只剩卡片行"
        );
    }

    #[test]
    fn the_review_decision_lands_in_context_without_becoming_a_visible_message() {
        let mut temp = TempStore::new("proposals-decision-message");
        let store = temp.store();
        let conversation = store.create_conversation(100).expect("会话");
        let saved = store
            .create_proposal(card(conversation.id, 110))
            .expect("开卡");
        link_card(store, conversation.id, saved.id);
        let before = store.messages(conversation.id).expect("消息").len();
        let row_id = store
            .items(conversation.id)
            .expect("条目")
            .last()
            .expect("卡片行")
            .id;

        let outcome = store
            .review_proposal(
                conversation.id,
                saved.id,
                &[
                    decision(0, true, ""),
                    decision(1, true, ""),
                    decision(2, true, ""),
                ],
                200,
            )
            .expect("审完");
        // 决策消息跟审核同一个事务落库：编号紧接着卡片行。
        assert!(outcome.decision.id > row_id);
        assert_eq!(
            outcome.decision.item,
            StoredItem::ReviewDecision {
                text: outcome.decision_text.clone(),
            }
        );
        assert_eq!(
            store
                .items(conversation.id)
                .expect("条目")
                .last()
                .expect("决策")
                .id,
            outcome.decision.id
        );
        assert_eq!(store.messages(conversation.id).expect("消息").len(), before);
        let input =
            crate::llm::prompt::Input::from_stored(&outcome.decision.item).expect("进上下文");
        assert_eq!(
            input,
            crate::llm::prompt::Input::user(outcome.decision_text.clone())
        );
        assert!(
            store
                .conversation(conversation.id)
                .expect("读")
                .expect("在")
                .updated_at
                >= 200,
            "审核提交推进会话更新时间"
        );

        // 重开库以后那条决策仍在，装配时仍然是同一条用户消息。
        drop(store);
        let reopened = temp.reopen();
        let last = reopened
            .items(crate::domain::ConversationId(1))
            .expect("条目")
            .pop()
            .expect("最后一条");
        assert_eq!(
            crate::llm::prompt::Input::from_stored(&last.item),
            Some(crate::llm::prompt::Input::user(
                outcome.decision_text.as_str()
            ))
        );
        assert!(
            reopened
                .messages(crate::domain::ConversationId(1))
                .expect("消息")
                .is_empty()
        );
    }

    #[test]
    fn a_card_without_a_timeline_row_cannot_be_reviewed() {
        let temp = TempStore::new("proposals-review-rowless");
        let store = temp.store();
        let conversation = store.create_conversation(100).expect("会话");
        let saved = store
            .create_proposal(card(conversation.id, 110))
            .expect("旧卡");
        // 没有卡片行：pending_proposal 不认它，review 也不认（同一个「待审」定义）。
        assert!(
            store
                .pending_proposal(conversation.id)
                .expect("读")
                .is_none()
        );
        assert_eq!(
            store
                .review_proposal(
                    conversation.id,
                    saved.id,
                    &[
                        decision(0, true, ""),
                        decision(1, true, ""),
                        decision(2, true, ""),
                    ],
                    200,
                )
                .unwrap_err(),
            StoreError::Domain(DomainError::ProposalAlreadyReviewed(saved.id))
        );
        assert!(store.findings().expect("判定").is_empty());
        assert!(store.items(conversation.id).expect("条目").is_empty());
        assert!(
            store
                .proposal(saved.id)
                .expect("读")
                .expect("在")
                .is_pending()
        );
    }

    #[test]
    fn deleting_a_conversation_removes_its_card_row_and_decision_but_keeps_the_log() {
        let temp = TempStore::new("proposals-delete-conversation");
        let store = temp.store();
        let conversation = store.create_conversation(100).expect("会话");
        let saved = store
            .create_proposal(card(conversation.id, 110))
            .expect("开卡");
        link_card(store, conversation.id, saved.id);
        store
            .review_proposal(
                conversation.id,
                saved.id,
                &[
                    decision(0, true, ""),
                    decision(1, false, "不是小腿，是膝盖"),
                    decision(2, false, ""),
                ],
                200,
            )
            .expect("审完");
        assert_eq!(store.items(conversation.id).expect("条目").len(), 2);
        assert_eq!(store.evidence_log().expect("依据").len(), 3);

        store.delete_conversation(conversation.id).expect("删除");
        assert!(store.items(conversation.id).expect("条目").is_empty());
        assert!(store.messages(conversation.id).expect("消息").is_empty());
        assert!(store.proposals(conversation.id).expect("提议").is_empty());
        assert_eq!(store.conversation(conversation.id).expect("读"), None);
        // 依据日志保留：拒绝理由仍查得到，来源会话已删除（ADR-0005）。
        let log = store.evidence_log().expect("依据");
        assert_eq!(log.len(), 3);
        assert!(
            log.iter()
                .any(|evidence| evidence.user_said == "不是小腿，是膝盖")
        );
    }
}
