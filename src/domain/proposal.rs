//! 档案更新提议（`GLOSSARY.md`「档案更新提议」，#10）：一次想改多条时先交给用户审。
//!
//! 一张卡最多 8 项（再多就分轮），每项都带着自己的四段依据——展开就能看，不用
//! 相信一句「我觉得」。用户一次处理整张卡：勾选=采纳，落判定与依据；不勾=不要，
//! 只落一条 `rejection` 证据。状态机是待审 → 已处理（Accepted / Dismissed），
//! 没有部分接受，也没有撤销：提交即定案，要改就接着说，由对话追加「更正」。

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
    /// 已处理：至少一项落成判定。
    Accepted,
    /// 已处理：一项都没采纳，不会再被接受。
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
    /// 模型给的建议：勾选 / 不勾；没给就按置信度阈值。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recommend: Option<bool>,
    /// 接受之后落成的那条判定（回看时指向档案里的那条记录）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accepted: Option<super::FindingId>,
    /// 不要这一项时用户写的理由；空表示没写（旧数据也没有这个字段）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rejection_reason: Option<String>,
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
            recommend: None,
            accepted: None,
            rejection_reason: None,
        }
    }

    /// 默认勾选吗：模型给了建议就照它；没给才看置信度 ≥ 60。
    pub fn default_selected(&self) -> bool {
        self.recommend
            .unwrap_or(self.draft.confidence >= LOW_CONFIDENCE)
    }

    /// 校验：判定与依据各自合法（四段齐、部位在词表、侧别对得上）。
    pub fn validate(&self) -> Result<(), DomainError> {
        self.draft.validate()?;
        self.evidence.validate()?;
        Ok(())
    }
}

/// 用户对一项的决定：采纳（可选写理由吗？采纳不需要）或不要（可选理由）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProposalDecision {
    /// 第几项（0 起，与卡片编号一致）。
    pub index: usize,
    pub accept: bool,
    /// 不要时的理由；空串表示没写。
    pub reason: String,
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

    /// 已经落成判定的项数。
    pub fn accepted_count(&self) -> usize {
        self.items
            .iter()
            .filter(|item| item.state == ItemState::Accepted)
            .count()
    }

    /// 记下一项落成的那条判定。
    pub fn mark_accepted(&mut self, index: usize, finding: super::FindingId) {
        if let Some(item) = self.items.get_mut(index) {
            item.state = ItemState::Accepted;
            item.accepted = Some(finding);
        }
    }

    /// 记下一项被用户划掉（不采纳），理由留着给已处理的卡回看。
    pub fn mark_rejected(&mut self, index: usize, reason: &str) {
        if let Some(item) = self.items.get_mut(index) {
            item.state = ItemState::Rejected;
            let reason = reason.trim();
            item.rejection_reason = (!reason.is_empty()).then(|| reason.to_owned());
        }
    }

    /// 收尾：至少采纳一项是 Accepted，一项都没采纳是 Dismissed。
    pub fn mark_reviewed(&mut self, at: Timestamp) {
        self.status = if self.accepted_count() > 0 {
            ProposalStatus::Accepted
        } else {
            ProposalStatus::Dismissed
        };
        self.decided_at = Some(at);
    }

    /// 提交给模型的那条决策消息。
    ///
    /// 例子：「我审完了第 12 号卡：采纳第 1、3、5 项（左臀中肌、左比目鱼肌、右比目鱼肌）；
    /// 不要第 2 项（右臀中肌，理由：…）；不要第 4 项（左腓肠肌，没写理由）。」
    pub fn review_text(&self, decisions: &[ProposalDecision]) -> String {
        let mut sorted = decisions.to_vec();
        sorted.sort_by_key(|decision| decision.index);
        let accepted: Vec<&ProposalDecision> =
            sorted.iter().filter(|decision| decision.accept).collect();
        let rejected: Vec<&ProposalDecision> =
            sorted.iter().filter(|decision| !decision.accept).collect();

        let mut parts = Vec::new();
        if !accepted.is_empty() {
            let indices = accepted
                .iter()
                .map(|decision| (decision.index + 1).to_string())
                .collect::<Vec<_>>()
                .join("、");
            let labels = accepted
                .iter()
                .filter_map(|decision| self.items.get(decision.index))
                .map(item_label)
                .collect::<Vec<_>>()
                .join("、");
            parts.push(format!("采纳第 {indices} 项（{labels}）"));
        }
        for decision in rejected {
            let label = self
                .items
                .get(decision.index)
                .map(item_label)
                .unwrap_or_else(|| format!("第 {} 项", decision.index + 1));
            let reason = decision.reason.trim();
            parts.push(if reason.is_empty() {
                format!("不要第 {} 项（{label}，没写理由）", decision.index + 1)
            } else {
                format!(
                    "不要第 {} 项（{label}，理由：{reason}）",
                    decision.index + 1
                )
            });
        }

        format!("我审完了第 {} 号卡：{}。", self.id.0, parts.join("；"))
    }
}

fn item_label(item: &ProposalItem) -> String {
    let site = crate::anatomy::site(&item.draft.site)
        .map(|site| site.zh.to_owned())
        .unwrap_or_else(|| item.draft.site.clone());
    match item.draft.side {
        Some(side) => format!("{}{}", side.zh(), site),
        None => site,
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
        let one = Proposal::new(
            ProposalId(1),
            ConversationId(1),
            100,
            vec![item("soleus", Some(Side::Left), 70, 100)],
        );
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
    fn a_models_recommendation_overrides_the_confidence_default() {
        let mut low = item("soleus", Some(Side::Left), 20, 100);
        low.recommend = Some(true);
        assert!(low.default_selected(), "低置信度也可以被建议勾上");

        let mut high = item("soleus", Some(Side::Left), 90, 100);
        high.recommend = Some(false);
        assert!(!high.default_selected(), "高置信度也可以被建议不勾");
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
    fn a_reviewed_card_is_accepted_when_something_was_accepted() {
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

        proposal.mark_accepted(0, crate::domain::FindingId(1));
        proposal.mark_rejected(1, "");
        proposal.mark_accepted(2, crate::domain::FindingId(2));
        proposal.mark_reviewed(200);

        assert_eq!(proposal.status, ProposalStatus::Accepted);
        assert_eq!(proposal.accepted_count(), 2);
        assert_eq!(proposal.items[1].state, ItemState::Rejected);
        assert_eq!(proposal.decided_at, Some(200));
        assert!(!proposal.is_pending());
    }

    #[test]
    fn rejecting_every_item_dismisses_the_card() {
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

        proposal.mark_rejected(0, "不是这里");
        proposal.mark_rejected(1, "");
        proposal.mark_reviewed(200);
        assert_eq!(proposal.status, ProposalStatus::Dismissed);
        assert_eq!(proposal.accepted_count(), 0);
        assert_eq!(
            proposal.items[0].rejection_reason.as_deref(),
            Some("不是这里")
        );
        assert_eq!(proposal.items[1].rejection_reason, None);
    }

    #[test]
    fn the_review_message_spells_out_every_item_and_its_reason() {
        let proposal = Proposal::new(
            ProposalId(12),
            ConversationId(1),
            100,
            vec![
                item("gluteus-medius", Some(Side::Left), 70, 100),
                item("soleus", Some(Side::Right), 70, 100),
                item("soleus", Some(Side::Left), 70, 100),
            ],
        )
        .expect("合法");
        let decisions = vec![
            ProposalDecision {
                index: 0,
                accept: true,
                reason: String::new(),
            },
            ProposalDecision {
                index: 1,
                accept: false,
                reason: "不是小腿，是膝盖".to_owned(),
            },
            ProposalDecision {
                index: 2,
                accept: true,
                reason: String::new(),
            },
        ];
        assert_eq!(
            proposal.review_text(&decisions),
            "我审完了第 12 号卡：采纳第 1、3 项（左臀中肌、左比目鱼肌）；\
             不要第 2 项（右比目鱼肌，理由：不是小腿，是膝盖）。"
        );
    }

    #[test]
    fn an_all_rejected_review_message_says_so() {
        let proposal = Proposal::new(
            ProposalId(3),
            ConversationId(1),
            100,
            vec![item("soleus", Some(Side::Left), 70, 100)],
        )
        .expect("合法");
        let decisions = vec![ProposalDecision {
            index: 0,
            accept: false,
            reason: String::new(),
        }];
        assert_eq!(
            proposal.review_text(&decisions),
            "我审完了第 3 号卡：不要第 1 项（左比目鱼肌，没写理由）。"
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

        let json = serde_json::to_string(&proposal).expect("序列化");
        assert!(json.contains("\"pending\""), "{json}");
        let back: Proposal = serde_json::from_str(&json).expect("反序列化");
        assert_eq!(back, proposal);
    }
}
