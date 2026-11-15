//! 提议卡的存储与三件事：接受、拒绝一项、撤销（#10）。
//!
//! 接受要把选中的项逐条落成判定 + 依据日志，拒绝要落一条 `rejection` 证据，
//! 撤销要逐条撤回并回到待确认。这三件事都必须**一个事务**：卡的状态与它写下的
//! 判定不能各说各话。

use redb::{ReadableDatabase, ReadableTable, TableDefinition};

use super::{db_error, Store, StoreError};
use crate::domain::{
    DomainError, Evidence, EvidenceDraft, EvidenceId, EvidenceKind, Finding, FindingId,
    ItemState, Proposal, ProposalId, ProposalStatus, Retract, Timestamp,
};

/// 提议：编号 → Proposal 的 JSON。
pub(crate) const PROPOSALS: TableDefinition<u64, &str> = TableDefinition::new("proposals");

impl Store {
    /// 开一张待确认的卡。
    pub fn create_proposal(&self, proposal: Proposal) -> Result<Proposal, StoreError> {
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

    /// 这个会话里还没审完的那张卡（一张会话同时最多一张）。
    pub fn pending_proposal(
        &self,
        conversation: crate::domain::ConversationId,
    ) -> Result<Option<Proposal>, StoreError> {
        Ok(self
            .proposals(conversation)?
            .into_iter()
            .find(|proposal| proposal.is_pending()))
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

    /// 接受选中的项：逐条落判定 + 依据日志，卡变成已应用（同一个事务）。
    pub fn accept_proposal(
        &self,
        id: ProposalId,
        selected: &[usize],
        at: Timestamp,
    ) -> Result<(Proposal, Vec<Finding>), StoreError> {
        let mut proposal = self.require_pending(id)?;
        if selected.is_empty() {
            return Err(StoreError::Domain(DomainError::EmptyProposal));
        }
        let mut indices = selected.to_vec();
        indices.sort_unstable();
        indices.dedup();
        for index in &indices {
            match proposal.items.get(*index) {
                Some(item) if item.state == ItemState::Pending => {}
                Some(_) => {
                    return Err(StoreError::Domain(DomainError::UnknownProposalItem(*index)))
                }
                None => {
                    return Err(StoreError::Domain(DomainError::UnknownProposalItem(*index)))
                }
            }
        }

        let mut findings = Vec::with_capacity(indices.len());
        let mut next_finding = self.next_finding_id()?;
        let mut next_evidence = self.next_evidence_id()?;

        let write = self.db().begin_write().map_err(db_error)?;
        {
            let mut finding_table = write.open_table(super::findings::FINDINGS).map_err(db_error)?;
            let mut evidence_table = write.open_table(super::evidence::EVIDENCE).map_err(db_error)?;
            for index in &indices {
                let item = &mut proposal.items[*index];
                let finding = Finding::new(FindingId(next_finding), item.draft.clone())?;
                let mut evidence = item.evidence.clone();
                evidence.kind = EvidenceKind::Record;
                evidence.finding = Some(finding.id);
                let evidence = Evidence::new(EvidenceId(next_evidence), evidence)?;

                finding_table
                    .insert(finding.id.0, to_json(&finding)?.as_str())
                    .map_err(db_error)?;
                evidence_table
                    .insert(evidence.id.0, to_json(&evidence)?.as_str())
                    .map_err(db_error)?;

                item.state = ItemState::Accepted;
                item.accepted = Some(finding.id);
                findings.push(finding);
                next_finding += 1;
                next_evidence += 1;
            }
            drop(finding_table);
            drop(evidence_table);

            proposal.status = ProposalStatus::Accepted;
            proposal.decided_at = Some(at);
            let mut table = write.open_table(PROPOSALS).map_err(db_error)?;
            table
                .insert(proposal.id.0, to_json(&proposal)?.as_str())
                .map_err(db_error)?;
            drop(table);
            let mut meta = write.open_table(super::META).map_err(db_error)?;
            meta.insert("next_finding_id", next_finding.to_string().as_str())
                .map_err(db_error)?;
            meta.insert("next_evidence_id", next_evidence.to_string().as_str())
                .map_err(db_error)?;
        }
        write.commit().map_err(db_error)?;
        Ok((proposal, findings))
    }

    /// 拒绝一项：落一条 `rejection` 证据，不产生判定；全部拒完就关闭卡。
    pub fn reject_item(
        &self,
        id: ProposalId,
        index: usize,
        reason: &str,
        at: Timestamp,
    ) -> Result<(Proposal, Evidence), StoreError> {
        let mut proposal = self.require_pending(id)?;
        let item = proposal
            .items
            .get_mut(index)
            .ok_or(StoreError::Domain(DomainError::UnknownProposalItem(index)))?;
        if item.state != ItemState::Pending {
            return Err(StoreError::Domain(DomainError::UnknownProposalItem(index)));
        }
        let reason = reason.trim();
        let evidence = Evidence::new(
            EvidenceId(self.next_evidence_id()?),
            EvidenceDraft {
                kind: EvidenceKind::Rejection,
                site: item.draft.site.clone(),
                side: item.draft.side,
                finding: None,
                conversation: Some(proposal.conversation),
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
        item.state = ItemState::Rejected;

        if proposal
            .items
            .iter()
            .all(|item| item.state == ItemState::Rejected)
        {
            proposal.status = ProposalStatus::Dismissed;
            proposal.decided_at = Some(at);
        }

        let write = self.db().begin_write().map_err(db_error)?;
        {
            let mut log = write.open_table(super::evidence::EVIDENCE).map_err(db_error)?;
            log.insert(evidence.id.0, to_json(&evidence)?.as_str())
                .map_err(db_error)?;
            drop(log);
            let mut table = write.open_table(PROPOSALS).map_err(db_error)?;
            table
                .insert(proposal.id.0, to_json(&proposal)?.as_str())
                .map_err(db_error)?;
            drop(table);
            let mut meta = write.open_table(super::META).map_err(db_error)?;
            meta.insert("next_evidence_id", (evidence.id.0 + 1).to_string().as_str())
                .map_err(db_error)?;
        }
        write.commit().map_err(db_error)?;
        Ok((proposal, evidence))
    }

    /// 撤销一次接受：逐项撤回（追加 Correction），卡回到待确认。
    pub fn undo_proposal(
        &self,
        id: ProposalId,
        reason: &str,
        at: Timestamp,
    ) -> Result<Proposal, StoreError> {
        let mut proposal = self
            .proposal(id)?
            .ok_or(StoreError::Domain(DomainError::ProposalNotPending(id)))?;
        if proposal.status != ProposalStatus::Accepted {
            return Err(StoreError::Domain(DomainError::ProposalNotPending(id)));
        }
        let mut next_evidence = self.next_evidence_id()?;

        let write = self.db().begin_write().map_err(db_error)?;
        {
            let mut retracts = write.open_table(super::findings::RETRACTS).map_err(db_error)?;
            let mut log = write.open_table(super::evidence::EVIDENCE).map_err(db_error)?;
            for item in &mut proposal.items {
                let Some(finding) = item.accepted else {
                    continue;
                };
                let retract = Retract::new(finding, reason, at)?;
                retracts
                    .insert(finding.0, to_json(&retract)?.as_str())
                    .map_err(db_error)?;

                let mut evidence = item.evidence.clone();
                evidence.kind = EvidenceKind::Retract;
                evidence.finding = Some(finding);
                evidence.at = at;
                let evidence = Evidence::new(EvidenceId(next_evidence), evidence)?;
                log.insert(evidence.id.0, to_json(&evidence)?.as_str())
                    .map_err(db_error)?;
                next_evidence += 1;

                item.accepted = None;
                item.state = ItemState::Pending;
            }
            drop(retracts);
            drop(log);

            proposal.status = ProposalStatus::Pending;
            proposal.decided_at = None;
            let mut table = write.open_table(PROPOSALS).map_err(db_error)?;
            table
                .insert(proposal.id.0, to_json(&proposal)?.as_str())
                .map_err(db_error)?;
            drop(table);
            let mut meta = write.open_table(super::META).map_err(db_error)?;
            meta.insert("next_evidence_id", next_evidence.to_string().as_str())
                .map_err(db_error)?;
        }
        write.commit().map_err(db_error)?;
        Ok(proposal)
    }

    fn require_pending(&self, id: ProposalId) -> Result<Proposal, StoreError> {
        let proposal = self
            .proposal(id)?
            .ok_or(StoreError::Domain(DomainError::ProposalNotPending(id)))?;
        if !proposal.is_pending() {
            return Err(StoreError::Domain(DomainError::ProposalNotPending(id)));
        }
        Ok(proposal)
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
        AxisValue, AxisValues, ConversationId, FindingDraft, ProposalItem, Side, Tension,
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

    #[test]
    fn a_new_card_lands_as_the_only_pending_one() {
        let temp = TempStore::new("proposals-create");
        let store = temp.store();
        let conversation = store.create_conversation(100).expect("会话");
        let saved = store.create_proposal(card(conversation.id, 110)).expect("开卡");
        assert_eq!(saved.id, ProposalId(1));
        assert_eq!(
            store.pending_proposal(conversation.id).expect("待审").expect("有").id,
            saved.id
        );
        // 一个会话同时只能有一张待审的卡（工具层靠这个拒绝第二次提议）。
        assert!(store.proposals(conversation.id).expect("列表").len() == 1);
    }

    #[test]
    fn accepting_a_subset_writes_those_findings_and_leaves_the_rest_pending() {
        let temp = TempStore::new("proposals-accept");
        let store = temp.store();
        let conversation = store.create_conversation(100).expect("会话");
        let saved = store.create_proposal(card(conversation.id, 110)).expect("开卡");

        // 只勾第 1 项（低置信度那项默认不勾）。
        let (proposal, findings) = store
            .accept_proposal(saved.id, &[0], 200)
            .expect("接受");
        assert_eq!(findings.len(), 1);
        assert_eq!(proposal.status, ProposalStatus::Accepted);
        assert_eq!(proposal.items[0].state, ItemState::Accepted);
        assert_eq!(proposal.items[1].state, ItemState::Pending);
        assert_eq!(store.findings().expect("判定").len(), 1);
        assert_eq!(store.evidence_log().expect("依据").len(), 1);
        assert_eq!(
            store.evidence_log().expect("依据")[0].finding,
            Some(findings[0].id)
        );
        // 卡不再待审。
        assert!(store.pending_proposal(conversation.id).expect("待审").is_none());

        // 处理过的卡不能再接受（幂等的落点是「已经是这个结果」，不是再写一遍）。
        let again = store.accept_proposal(saved.id, &[1], 210).unwrap_err();
        assert_eq!(
            again,
            StoreError::Domain(DomainError::ProposalNotPending(saved.id))
        );
        assert_eq!(store.findings().expect("判定").len(), 1);
    }

    #[test]
    fn rejecting_an_item_writes_only_evidence_and_all_rejected_closes_the_card() {
        let temp = TempStore::new("proposals-reject");
        let store = temp.store();
        let conversation = store.create_conversation(100).expect("会话");
        let saved = store.create_proposal(card(conversation.id, 110)).expect("开卡");

        let (proposal, evidence) = store
            .reject_item(saved.id, 1, "不是小腿，是膝盖", 200)
            .expect("拒绝一项");
        assert_eq!(proposal.items[1].state, ItemState::Rejected);
        assert_eq!(evidence.kind, EvidenceKind::Rejection);
        assert_eq!(evidence.site, "soleus");
        assert_eq!(evidence.user_said, "不是小腿，是膝盖");
        assert!(store.findings().expect("判定").is_empty());
        assert!(proposal.is_pending(), "还有两项没审");

        // 没写理由也行：那一段落成固定的一句话。
        let (_, another) = store.reject_item(saved.id, 0, "  ", 210).expect("拒绝第二项");
        assert_eq!(another.user_said, crate::domain::evidence::NO_REASON);

        let (proposal, _) = store.reject_item(saved.id, 2, "", 220).expect("拒绝第三项");
        assert_eq!(proposal.status, ProposalStatus::Dismissed);
        assert!(store.pending_proposal(conversation.id).expect("待审").is_none());
        assert!(store.findings().expect("判定").is_empty());
    }

    #[test]
    fn undo_retracts_what_was_accepted_and_puts_the_card_back_to_pending() {
        let temp = TempStore::new("proposals-undo");
        let store = temp.store();
        let conversation = store.create_conversation(100).expect("会话");
        let saved = store.create_proposal(card(conversation.id, 110)).expect("开卡");
        let (_, findings) = store.accept_proposal(saved.id, &[0, 2], 200).expect("接受");

        let proposal = store
            .undo_proposal(saved.id, "这两条记得不对", 300)
            .expect("撤销");
        assert_eq!(proposal.status, ProposalStatus::Pending);
        assert_eq!(proposal.items[0].state, ItemState::Pending);
        assert_eq!(proposal.items[0].accepted, None);

        // 撤回是追加：判定还在，投影里没了，卡可以重新接受。
        assert_eq!(store.findings().expect("判定").len(), 2);
        assert_eq!(store.retractions().expect("撤回").len(), 2);
        assert!(store.projection().expect("投影").is_empty());
        let redone = store.accept_proposal(saved.id, &[0], 400).expect("重新接受");
        assert_eq!(redone.1.len(), 1);
        assert!(redone.1[0].id > findings[1].id, "重新接受会写新的判定");
    }
}
