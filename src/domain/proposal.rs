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

    /// 还在等用户审吗。
    pub fn is_pending(&self) -> bool {
        self.status == ProposalStatus::Pending
    }

    /// 已经落成判定的项（撤销时要逐项撤回）。
    pub fn accepted_items(&self) -> impl Iterator<Item = (usize, &ProposalItem)> {
        self.items
            .iter()
            .enumerate()
            .filter(|(_, item)| item.state == ItemState::Accepted)
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
    fn a_new_card_is_pending_and_round_trips_through_json() {
        let proposal = Proposal::new(
            ProposalId(2),
            ConversationId(1),
            100,
            vec![item("soleus", Some(Side::Left), 70, 100)],
        )
        .expect("合法");
        assert!(proposal.is_pending());
        assert_eq!(proposal.accepted_items().count(), 0);

        let json = serde_json::to_string(&proposal).expect("序列化");
        assert!(json.contains("\"pending\""), "{json}");
        let back: Proposal = serde_json::from_str(&json).expect("反序列化");
        assert_eq!(back, proposal);
    }
}
