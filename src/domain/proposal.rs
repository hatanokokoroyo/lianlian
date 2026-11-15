//! 档案更新提议（`GLOSSARY.md`「档案更新提议」，#10）：一次想改多条时先交给用户审。
//!
//! 一张卡最多 8 项（再多就分轮），每项都带着自己的四段依据——展开就能看，不用
//! 相信一句「我觉得」。接受之后才落判定；拒绝只落一条 `rejection` 证据，不产生判定。
//!
//! 状态机跟着 `design/contract.md` §6.2：待确认 → 已应用（可撤销）；撤销回到待确认。

use serde::{Deserialize, Serialize};

use super::{ConversationId, DomainError, EvidenceDraft, FindingDraft, Timestamp};

/// 一张卡最多几项（`propose_findings` 超过就被拒，让模型分轮）。
pub const MAX_ITEMS: usize = 8;

/// 置信度低于这个值的项默认**不**勾选（阈值 60，见 `#10` 的决策）。
pub const LOW_CONFIDENCE: u8 = 60;

/// 提议编号：存储层分配的单调递增整数。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct ProposalId(pub u64);

/// 一整张卡的状态。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProposalStatus {
    /// 等用户审。
    Pending,
    /// 已应用：选中的项已经落成判定，可以撤销。
    Accepted,
    /// 已关闭：全部拒绝（或用户放弃），不会再被接受。
    Dismissed,
}

impl ProposalStatus {
    pub fn key(self) -> &'static str {
        match self {
            ProposalStatus::Pending => "pending",
            ProposalStatus::Accepted => "accepted",
            ProposalStatus::Dismissed => "dismissed",
        }
    }
}

/// 一项的状态。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ItemState {
    /// 还没决定（低置信度的项默认不勾，但仍算待定）。
    Pending,
    /// 已被接受，并落成了一条判定。
    Accepted,
    /// 被用户拒绝（理由进了证据）。
    Rejected,
}

/// 提议里的一项：一条待写的判定 + 它的依据。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProposalItem {
    /// 待写的判定。
    pub draft: FindingDraft,
    pub evidence: EvidenceDraft,
    pub state: ItemState,
    /// 接受之后落成的那条判定（撤销时要撤回它）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accepted: Option<super::FindingId>,
}

impl ProposalItem {
    /// 新建一项：状态从待定开始，证据指向这条判定的部位。
    pub fn new(finding: FindingDraft, mut evidence: EvidenceDraft) -> ProposalItem {
        evidence.site = finding.site.clone();
        evidence.side = finding.side;
        ProposalItem {
            draft: finding,
            evidence,
            state: ItemState::Pending,
            accepted: None,
        }
    }

    /// 默认勾选吗：置信度 ≥ 60 才勾（低置信度要用户自己点）。
    pub fn default_selected(&self) -> bool {
        self.draft.confidence >= LOW_CONFIDENCE
    }

    /// 校验：判定与依据各自合法（四段齐、部位在词表、侧别对得上）。
    pub fn validate(&self) -> Result<(), DomainError> {
        self.draft.validate()?;
        self.evidence.validate()?;
        Ok(())
    }
}

/// 一张提议卡。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Proposal {
    pub id: ProposalId,
    pub conversation: ConversationId,
    pub at: Timestamp,
    pub status: ProposalStatus,
    pub items: Vec<ProposalItem>,
    /// 接受或关闭的时间。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub decided_at: Option<Timestamp>,
}

impl Proposal {
    /// 新建一张待确认的卡：1–8 项，每项都要过校验。
    pub fn new(
        id: ProposalId,
        conversation: ConversationId,
        at: Timestamp,
        items: Vec<ProposalItem>,
    ) -> Result<Proposal, DomainError> {
        if items.is_empty() {
            return Err(DomainError::EmptyProposal);
        }
        if items.len() > MAX_ITEMS {
            return Err(DomainError::TooManyProposalItems(items.len()));
        }
        for item in &items {
            item.validate()?;
        }
        Ok(Proposal {
            id,
            conversation,
            at,
            status: ProposalStatus::Pending,
            items,
            decided_at: None,
        })
    }

    /// 还在等用户审吗（整张卡的状态）。
    pub fn is_pending(&self) -> bool {
        self.status == ProposalStatus::Pending
    }

    /// 还有没审的项吗——**界面据此决定要不要把卡摆出来**。
    ///
    /// 接受了一部分之后，剩下的项仍然要能勾，所以「有卡可审」看的是项，不是整张
    /// 卡的状态；被关闭的卡（全部拒绝）不再出现在这一列里。
    pub fn has_pending_items(&self) -> bool {
        self.status != ProposalStatus::Dismissed
            && self
                .items
                .iter()
                .any(|item| item.state == ItemState::Pending)
    }

    /// 已经落成判定的项数。
    pub fn accepted_count(&self) -> usize {
        self.items
            .iter()
            .filter(|item| item.state == ItemState::Accepted)
            .count()
    }

    /// 校验一次勾选：排序去重，每一项都必须是待定的（已接受/已拒绝的不能再勾）。
    pub fn selection(&self, selected: &[usize]) -> Result<Vec<usize>, DomainError> {
        if selected.is_empty() {
            return Err(DomainError::EmptyProposal);
        }
        let mut indices = selected.to_vec();
        indices.sort_unstable();
        indices.dedup();
        for index in &indices {
            match self.items.get(*index) {
                Some(item) if item.state == ItemState::Pending => {}
                _ => return Err(DomainError::UnknownProposalItem(*index)),
            }
        }
        Ok(indices)
    }

    /// 记下一项落成的那条判定。
    pub fn mark_accepted(&mut self, index: usize, finding: super::FindingId) {
        if let Some(item) = self.items.get_mut(index) {
            item.state = ItemState::Accepted;
            item.accepted = Some(finding);
        }
    }

    /// 收尾：这张卡已经应用（还有没审的项时也照样是「已应用」，界面按项渲染）。
    pub fn mark_applied(&mut self, at: Timestamp) {
        self.status = ProposalStatus::Accepted;
        self.decided_at = Some(at);
    }

    /// 拒绝一项；全部拒完之后卡关闭。
    pub fn reject(&mut self, index: usize, at: Timestamp) -> Result<(), DomainError> {
        match self.items.get_mut(index) {
            Some(item) if item.state == ItemState::Pending => item.state = ItemState::Rejected,
            _ => return Err(DomainError::UnknownProposalItem(index)),
        }
        if self
            .items
            .iter()
            .all(|item| item.state == ItemState::Rejected)
        {
            self.status = ProposalStatus::Dismissed;
            self.decided_at = Some(at);
        }
        Ok(())
    }

    /// 撤销：已接受的项清回待定，卡回到待确认（至少得有一项被接受过）。
    pub fn undo(&mut self) -> Result<(), DomainError> {
        if self.accepted_count() == 0 {
            return Err(DomainError::NothingAccepted(self.id));
        }
        for item in &mut self.items {
            if item.state == ItemState::Accepted {
                item.state = ItemState::Pending;
                item.accepted = None;
            }
        }
        self.status = ProposalStatus::Pending;
        self.decided_at = None;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{AxisValue, AxisValues, Side, Tension};

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
                kind: super::super::EvidenceKind::Record,
                site: site.to_owned(),
                side,
                finding: None,
                conversation: None,
                at,
                user_said: "蹲不下去".to_owned(),
                test_and_feedback: "靠墙踝背屈差 4 cm".to_owned(),
                reasoning: "背屈受限".to_owned(),
                uncertainty: "没排除髋".to_owned(),
            },
        )
    }

    #[test]
    fn a_card_holds_one_to_eight_items() {
        let one = Proposal::new(ProposalId(1), ConversationId(1), 100, vec![item("soleus", Some(Side::Left), 70, 100)]);
        assert!(one.is_ok());

        let empty = Proposal::new(ProposalId(1), ConversationId(1), 100, Vec::new());
        assert_eq!(empty, Err(DomainError::EmptyProposal));

        let nine: Vec<ProposalItem> = (0..9)
            .map(|step| item("soleus", Some(Side::Left), 70, 100 + step))
            .collect();
        assert_eq!(
            Proposal::new(ProposalId(1), ConversationId(1), 100, nine),
            Err(DomainError::TooManyProposalItems(9))
        );
    }

    #[test]
    fn low_confidence_items_start_unchecked_at_sixty() {
        assert!(!item("soleus", Some(Side::Left), 59, 100).default_selected());
        assert!(item("soleus", Some(Side::Left), LOW_CONFIDENCE, 100).default_selected());
        assert!(item("soleus", Some(Side::Left), 61, 100).default_selected());
    }

    #[test]
    fn an_item_carries_its_own_four_sections_and_points_at_its_site() {
        let mut broken = item("soleus", Some(Side::Left), 70, 100);
        broken.evidence.reasoning = " ".to_owned();
        assert_eq!(
            Proposal::new(ProposalId(1), ConversationId(1), 100, vec![broken]),
            Err(DomainError::EmptyEvidenceSection("推理"))
        );

        let unknown = item("gluteus", Some(Side::Left), 70, 100);
        assert_eq!(
            Proposal::new(ProposalId(1), ConversationId(1), 100, vec![unknown]),
            Err(DomainError::UnknownSite("gluteus".to_owned()))
        );
    }

    #[test]
    fn accepting_part_of_a_card_leaves_the_rest_auditable() {
        let mut proposal = Proposal::new(
            ProposalId(1),
            ConversationId(1),
            100,
            vec![
                item("soleus", Some(Side::Left), 70, 100),
                item("soleus", Some(Side::Right), 70, 100),
                item("gluteus-medius", Some(Side::Left), 70, 100),
            ],
        )
        .expect("合法");

        let chosen = proposal.selection(&[2, 0, 0]).expect("排序去重");
        assert_eq!(chosen, vec![0, 2]);
        for index in &chosen {
            proposal.mark_accepted(*index, crate::domain::FindingId(*index as u64 + 1));
        }
        proposal.mark_applied(200);

        assert_eq!(proposal.status, ProposalStatus::Accepted);
        assert_eq!(proposal.accepted_count(), 2);
        assert!(proposal.has_pending_items(), "第 2 项还等用户审");
        // 已接受的项不能再勾，越界也不行。
        assert_eq!(
            proposal.selection(&[0]),
            Err(DomainError::UnknownProposalItem(0))
        );
        assert_eq!(proposal.selection(&[9]), Err(DomainError::UnknownProposalItem(9)));
        assert_eq!(proposal.selection(&[]), Err(DomainError::EmptyProposal));
    }

    #[test]
    fn rejecting_every_item_closes_the_card_and_undo_needs_something_accepted() {
        let mut proposal = Proposal::new(
            ProposalId(1),
            ConversationId(1),
            100,
            vec![
                item("soleus", Some(Side::Left), 70, 100),
                item("soleus", Some(Side::Right), 70, 100),
            ],
        )
        .expect("合法");

        proposal.reject(0, 200).expect("拒绝第一项");
        assert!(proposal.has_pending_items());
        proposal.reject(1, 210).expect("拒绝第二项");
        assert_eq!(proposal.status, ProposalStatus::Dismissed);
        assert!(!proposal.has_pending_items(), "关闭的卡不再摆出来");
        assert_eq!(
            proposal.reject(0, 220),
            Err(DomainError::UnknownProposalItem(0))
        );

        assert_eq!(
            proposal.undo(),
            Err(DomainError::NothingAccepted(ProposalId(1)))
        );
    }

    #[test]
    fn undo_puts_accepted_items_back_to_pending() {
        let mut proposal = Proposal::new(
            ProposalId(1),
            ConversationId(1),
            100,
            vec![item("soleus", Some(Side::Left), 70, 100)],
        )
        .expect("合法");
        proposal.mark_accepted(0, crate::domain::FindingId(3));
        proposal.mark_applied(200);

        proposal.undo().expect("撤销");
        assert_eq!(proposal.status, ProposalStatus::Pending);
        assert_eq!(proposal.items[0].state, ItemState::Pending);
        assert_eq!(proposal.items[0].accepted, None);
        assert_eq!(proposal.decided_at, None);
    }

    #[test]
    fn a_new_card_is_pending_and_round_trips_through_json() {
        let proposal = Proposal::new(
            ProposalId(2),
            ConversationId(1),
            100,
            vec![item("soleus", Some(Side::Left), 70, 100)],
        )
        .expect("合法");
        assert!(proposal.is_pending());

        let json = serde_json::to_string(&proposal).expect("序列化");
        assert!(json.contains("\"pending\""), "{json}");
        let back: Proposal = serde_json::from_str(&json).expect("反序列化");
        assert_eq!(back, proposal);
    }
}
