//! 依据日志（ADR-0005）：档案条目每次变动都留一条第一手记录，跨会话唯一的细节通道。
//!
//! 四段（用户说法要点 / 验证方案与反馈 / 推理 / 不确定之处）对写档案的三种变动
//! 都是必填——缺段不是「格式没对齐」，而是这条判定没有依据。用户拒绝一项提议不
//! 产生判定，但同样留下一段理由（用户没写理由时由调用方填 [`NO_REASON`]）。
//!
//! **照片不算依据**，日志里既不留图片本体也不留引用（`GLOSSARY.md`「证据」）。

use serde::{Deserialize, Serialize};

use crate::anatomy;

use super::{ConversationId, DomainError, FindingId, Side, Timestamp};

/// 依据日志的编号：存储层分配的单调递增整数。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct EvidenceId(pub u64);

/// 这条证据是为哪种变动写的。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EvidenceKind {
    /// 新写一条判定。
    Record,
    /// 「已解决」：追加一条正常判定。
    Resolve,
    /// 撤回一条判定。
    Retract,
    /// 用户拒绝一项提议：不产生判定，只留理由。
    Rejection,
}

impl EvidenceKind {
    /// 机器可读的取值。
    pub fn key(self) -> &'static str {
        match self {
            EvidenceKind::Record => "record",
            EvidenceKind::Resolve => "resolve",
            EvidenceKind::Retract => "retract",
            EvidenceKind::Rejection => "rejection",
        }
    }

    /// 显示用的中文名。
    pub fn zh(self) -> &'static str {
        match self {
            EvidenceKind::Record => "写入",
            EvidenceKind::Resolve => "解决",
            EvidenceKind::Retract => "撤回",
            EvidenceKind::Rejection => "拒绝",
        }
    }

    /// 这种变动是否要求四段齐全。
    pub fn needs_the_four_sections(self) -> bool {
        !matches!(self, EvidenceKind::Rejection)
    }
}

/// 四段必填的段落名，顺序就是显示顺序。
pub const SECTIONS: [&str; 4] = ["用户说法要点", "验证方案与反馈", "推理", "不确定之处"];

/// 用户拒绝又没说理由时写进「用户说法要点」的那句。
pub const NO_REASON: &str = "用户未采纳，未说明理由";

/// 一条待写入的依据日志。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EvidenceDraft {
    pub kind: EvidenceKind,
    /// 部位 id，必须在词表里（拒绝也记在它试图改的那个部位上）。
    pub site: String,
    /// 侧别：成对部位必填，中线结构不能有。
    pub side: Option<Side>,
    /// 这条证据服务的判定；拒绝与只查不写时是 `None`。
    pub finding: Option<FindingId>,
    /// 来自哪个会话（会话被删之后这条仍留着，见 ADR-0005）。
    pub conversation: Option<ConversationId>,
    pub at: Timestamp,
    pub user_said: String,
    pub test_and_feedback: String,
    pub reasoning: String,
    pub uncertainty: String,
}

impl EvidenceDraft {
    /// 校验并取出词表里的部位。
    pub fn validate(&self) -> Result<&'static anatomy::Site, DomainError> {
        let site =
            anatomy::site(&self.site).ok_or_else(|| DomainError::UnknownSite(self.site.clone()))?;
        match (site.paired, self.side) {
            (true, None) => return Err(DomainError::SideRequired(site.id.to_owned())),
            (false, Some(_)) => return Err(DomainError::SideForbidden(site.id.to_owned())),
            _ => {}
        }
        if self.kind.needs_the_four_sections() {
            for (section, text) in self.sections() {
                if text.trim().is_empty() {
                    return Err(DomainError::EmptyEvidenceSection(section));
                }
            }
        } else if self.user_said.trim().is_empty() {
            return Err(DomainError::EmptyEvidenceSection(SECTIONS[0]));
        }
        Ok(site)
    }

    /// 四段按显示顺序。
    pub fn sections(&self) -> [(&'static str, &str); 4] {
        [
            (SECTIONS[0], self.user_said.as_str()),
            (SECTIONS[1], self.test_and_feedback.as_str()),
            (SECTIONS[2], self.reasoning.as_str()),
            (SECTIONS[3], self.uncertainty.as_str()),
        ]
    }
}

/// 已经落库的一条依据日志。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Evidence {
    pub id: EvidenceId,
    pub kind: EvidenceKind,
    pub site: String,
    pub side: Option<Side>,
    pub finding: Option<FindingId>,
    pub conversation: Option<ConversationId>,
    pub at: Timestamp,
    pub user_said: String,
    pub test_and_feedback: String,
    pub reasoning: String,
    pub uncertainty: String,
}

impl Evidence {
    /// 校验草稿并分配编号。
    pub fn new(id: EvidenceId, draft: EvidenceDraft) -> Result<Evidence, DomainError> {
        draft.validate()?;
        Ok(Evidence {
            id,
            kind: draft.kind,
            site: draft.site,
            side: draft.side,
            finding: draft.finding,
            conversation: draft.conversation,
            at: draft.at,
            user_said: draft.user_said,
            test_and_feedback: draft.test_and_feedback,
            reasoning: draft.reasoning,
            uncertainty: draft.uncertainty,
        })
    }

    /// 四段按显示顺序。
    pub fn sections(&self) -> [(&'static str, &str); 4] {
        [
            (SECTIONS[0], self.user_said.as_str()),
            (SECTIONS[1], self.test_and_feedback.as_str()),
            (SECTIONS[2], self.reasoning.as_str()),
            (SECTIONS[3], self.uncertainty.as_str()),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn draft(kind: EvidenceKind, site: &str, side: Option<Side>) -> EvidenceDraft {
        EvidenceDraft {
            kind,
            site: site.to_owned(),
            side,
            finding: None,
            conversation: Some(ConversationId(3)),
            at: 1_000,
            user_said: "蹲到一半膝盖前面发紧".to_owned(),
            test_and_feedback: "靠墙踝背屈：右脚膝盖离墙还差 4 cm".to_owned(),
            reasoning: "踝背屈受限会让膝盖代偿前移".to_owned(),
            uncertainty: "没排除髋的影响".to_owned(),
        }
    }

    #[test]
    fn a_finding_change_needs_all_four_sections() {
        let mut empty = draft(EvidenceKind::Record, "gluteus-medius", Some(Side::Left));
        empty.uncertainty = "   ".to_owned();
        assert_eq!(
            empty.validate().unwrap_err(),
            DomainError::EmptyEvidenceSection("不确定之处")
        );

        assert!(
            draft(EvidenceKind::Record, "gluteus-medius", Some(Side::Left))
                .validate()
                .is_ok()
        );
        // 解决与撤回同样要四段。
        assert!(
            draft(EvidenceKind::Resolve, "gluteus-medius", Some(Side::Left))
                .validate()
                .is_ok()
        );
        assert!(
            draft(EvidenceKind::Retract, "gluteus-medius", Some(Side::Left))
                .validate()
                .is_ok()
        );
    }

    #[test]
    fn a_rejection_only_needs_the_reason() {
        let mut rejection = draft(EvidenceKind::Rejection, "soleus", Some(Side::Left));
        rejection.test_and_feedback = String::new();
        rejection.reasoning = String::new();
        rejection.uncertainty = String::new();
        assert!(rejection.validate().is_ok());

        // 完全没写理由 → 写库前会被填成那句固定的话，所以空着也算拒绝。
        rejection.user_said = "  ".to_owned();
        assert_eq!(
            rejection.validate().unwrap_err(),
            DomainError::EmptyEvidenceSection("用户说法要点")
        );
    }

    #[test]
    fn the_site_rules_are_the_same_as_a_finding() {
        let unknown = draft(EvidenceKind::Record, "gluteus", Some(Side::Left));
        assert_eq!(
            unknown.validate().unwrap_err(),
            DomainError::UnknownSite("gluteus".to_owned())
        );

        let missing_side = draft(EvidenceKind::Record, "gluteus-medius", None);
        assert_eq!(
            missing_side.validate().unwrap_err(),
            DomainError::SideRequired("gluteus-medius".to_owned())
        );

        let midline_with_side = draft(EvidenceKind::Record, "diaphragm", Some(Side::Left));
        assert_eq!(
            midline_with_side.validate().unwrap_err(),
            DomainError::SideForbidden("diaphragm".to_owned())
        );
    }

    #[test]
    fn the_machine_key_never_drifts_from_the_serialized_form() {
        for kind in [
            EvidenceKind::Record,
            EvidenceKind::Resolve,
            EvidenceKind::Retract,
            EvidenceKind::Rejection,
        ] {
            let serialized = serde_json::to_value(kind).expect("序列化");
            assert_eq!(
                serialized.as_str().expect("是个字符串"),
                kind.key(),
                "key() 与 serde 的编码必须一致"
            );
        }
    }

    #[test]
    fn evidence_round_trips_through_json_with_its_kind() {
        let evidence = Evidence::new(
            EvidenceId(4),
            draft(EvidenceKind::Retract, "soleus", Some(Side::Left)),
        )
        .expect("合法");
        let json = serde_json::to_string(&evidence).expect("序列化");
        assert!(json.contains("\"retract\""), "类型标签在：{json}");
        let back: Evidence = serde_json::from_str(&json).expect("反序列化");
        assert_eq!(back, evidence);
        assert_eq!(back.sections()[0].0, "用户说法要点");
    }
}
