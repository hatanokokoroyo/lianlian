//! 档案页（`GLOSSARY.md`「档案页」）的读模型：部位卡片（按肌群 / 骨骼区域分组、
//! 左右分开）、四段依据、时间线与肌群聚合。
//!
//! 这里只读事件流（[`Event`]）与依据日志，不改任何东西：卡片上的「已解决 / 撤回」
//! 是 `api` 往库里追加事件，再重新算一遍投影。词表外的部位一律不出现——档案只能
//! 落在词表里（ADR-0003），旧库里漏出来的 id 不该在界面上冒充一条判定。

use std::collections::BTreeMap;

use crate::anatomy::{self, SiteKind};

use super::evidence::{Evidence, EvidenceKind};
use super::finding::{Event, Finding, FindingId, Side, Timestamp};
use super::projection::Projection;
use super::AxisValues;

/// 时间线上这条事件属于哪种更正。
///
/// 「已解决」是追加一条正常判定，但它在界面上与 agent 的普通写入分开展示
/// （spec：解决与撤回是两种不同的 Correction）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Correction {
    /// agent（或提议卡）写下的判定。
    Record,
    /// 用户点了「标记已解决」追加的正常判定。
    Resolve,
    /// 撤回。
    Retract,
}

impl Correction {
    /// 机器可读的键。
    pub fn key(self) -> &'static str {
        match self {
            Correction::Record => "record",
            Correction::Resolve => "resolve",
            Correction::Retract => "retract",
        }
    }

    /// 显示用的中文动作名。
    pub fn zh(self) -> &'static str {
        match self {
            Correction::Record => "写入",
            Correction::Resolve => "解决",
            Correction::Retract => "撤回",
        }
    }
}

/// 时间线上的一条：一条判定，或一次撤回。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HistoryEntry {
    /// 事件时间。
    pub at: Timestamp,
    /// 判定 id；撤回事件指向被撤回的那条。
    pub finding: FindingId,
    /// 这条事件是写入、解决还是撤回。
    pub correction: Correction,
    /// 判定测过的轴；撤回事件是空的。
    pub values: AxisValues,
    /// 判定置信度；撤回事件不关心。
    pub confidence: u8,
    /// 撤回理由；判定是 `None`。
    pub reason: Option<String>,
    /// 这条事件落库时写的依据日志（撤回事件是撤回那条日志）。
    pub evidence: Option<Evidence>,
    /// 这条判定就是当前生效的那条（撤回事件恒为 `false`）。
    pub current: bool,
}

/// 档案页上的一行：一个「部位 + 侧别」的当前状态。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SiteCard {
    /// 部位 id。
    pub site: String,
    /// 部位中文名。
    pub site_zh: String,
    /// 侧别；中线结构为 `None`。
    pub side: Option<Side>,
    /// 当前生效的取值。
    pub values: AxisValues,
    /// 当前状态来自哪条判定。
    pub from: FindingId,
    /// 那条判定的时间。
    pub at: Timestamp,
    /// 那条判定的置信度。
    pub confidence: u8,
    /// 那条判定的四段依据；旧数据可能没有。
    pub evidence: Option<Evidence>,
    /// 这个「部位 + 侧别」的全部事件，**时间倒序**（最近的在前）。
    pub history: Vec<HistoryEntry>,
}

impl SiteCard {
    /// 当前生效的那条是不是用户点的「标记已解决」。
    ///
    /// 按**动作**判断，不按取值判断：一条一开始就判正常的判定不该冒充「已解决」。
    pub fn resolved(&self) -> bool {
        self.history
            .iter()
            .find(|entry| entry.current)
            .is_some_and(|entry| entry.correction == Correction::Resolve)
    }
}

/// 按区域（肌肉看首要肌群，骨骼看区域）分出来的一块。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SiteSection {
    /// 肌肉是肌群 id，骨骼是区域 id。
    pub id: String,
    /// 显示用的中文名。
    pub label: String,
    /// 这一块里的卡片，按词表顺序、左侧在前。
    pub cards: Vec<SiteCard>,
}

/// 聚合里「最差的那一条判定」来自哪里。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorstSource {
    /// 那条判定。
    pub finding: FindingId,
    /// 部位 id。
    pub site: String,
    /// 部位中文名。
    pub site_zh: String,
    /// 那条判定的取值。
    pub values: AxisValues,
    /// 那条判定的时间。
    pub at: Timestamp,
}

/// 一个肌群在一侧上的聚合：成员逐轴取最差值。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GroupWorst {
    /// 肌群 id。
    pub id: String,
    /// 肌群中文名。
    pub zh: String,
    /// 聚合的侧别（`None` 是中线成员）。
    pub side: Option<Side>,
    /// 逐轴取最差之后的取值。
    pub values: AxisValues,
    /// 最差的那一条判定。
    pub source: WorstSource,
    /// 参与聚合、且有判定的成员部位（词表顺序）。
    pub sites: Vec<String>,
}

/// 档案页要的全部读模型。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProfilePage {
    /// 已经按区域分好的卡片。
    pub sections: Vec<SiteSection>,
    /// 有判定的肌群聚合（没判定的肌群不出现：未测不是正常）。
    pub groups: Vec<GroupWorst>,
}

impl ProfilePage {
    /// 从事件流与依据日志算出档案页的读模型。
    pub fn build(events: &[Event], evidence: &[Evidence]) -> ProfilePage {
        let projection = Projection::from_events(events);
        // 判定按编号索引一次：卡片、时间线、聚合来源都要按编号回看，别各扫一遍。
        let by_id: BTreeMap<FindingId, &Finding> = events
            .iter()
            .filter_map(|event| match event {
                Event::Finding(finding) => Some((finding.id, finding)),
                _ => None,
            })
            .collect();
        let mut sections: Vec<SiteSection> = Vec::new();

        // 按词表顺序走：区域的出现顺序、部位在一个区域里的顺序、左右顺序都由词表定，
        // 不按事件时间定——这样同一个库读两次，界面不会跳来跳去。
        for site in anatomy::all() {
            for side in sides_of(site.paired) {
                let Some(state) = projection.state(site.id, side) else {
                    continue;
                };
                let (id, label) = section_of(site);
                let card = SiteCard {
                    site: site.id.to_owned(),
                    site_zh: site.zh.to_owned(),
                    side,
                    values: state.values,
                    from: state.from,
                    at: state.at,
                    confidence: by_id
                        .get(&state.from)
                        .map(|finding| finding.confidence)
                        .unwrap_or(0),
                    evidence: evidence_of(evidence, state.from, false),
                    history: history_of(&by_id, events, evidence, site.id, side, state.from),
                };
                match sections.iter_mut().find(|section| section.id == id) {
                    Some(section) => section.cards.push(card),
                    None => sections.push(SiteSection {
                        id: id.to_owned(),
                        label: label.to_owned(),
                        cards: vec![card],
                    }),
                }
            }
        }

        let mut groups = Vec::new();
        for group in anatomy::all_groups() {
            for side in sides_of(true).into_iter().chain(std::iter::once(None)) {
                let Some(aggregate) = projection.group_worst(group.id, side) else {
                    continue;
                };
                let source = by_id.get(&aggregate.from);
                groups.push(GroupWorst {
                    id: group.id.to_owned(),
                    zh: group.zh.to_owned(),
                    side,
                    values: aggregate.values,
                    source: WorstSource {
                        finding: aggregate.from,
                        site: source
                            .map(|finding| finding.site.clone())
                            .unwrap_or_default(),
                        site_zh: source
                            .and_then(|finding| anatomy::site(&finding.site))
                            .map(|site| site.zh.to_owned())
                            .unwrap_or_default(),
                        values: source.map(|finding| finding.values).unwrap_or_default(),
                        at: aggregate.at,
                    },
                    sites: aggregate.sites,
                });
            }
        }

        ProfilePage { sections, groups }
    }

    /// 一共有多少张卡片（一个「部位 + 侧别」一张）。
    pub fn cards(&self) -> usize {
        self.sections.iter().map(|section| section.cards.len()).sum()
    }
}

/// 成对部位左右各一张卡，中线结构一张。
fn sides_of(paired: bool) -> Vec<Option<Side>> {
    if paired {
        vec![Some(Side::Left), Some(Side::Right)]
    } else {
        vec![None]
    }
}

/// 卡片归到哪一块：肌肉跟着首要肌群，骨骼跟着区域。
fn section_of(site: &anatomy::Site) -> (&'static str, &'static str) {
    match site.kind {
        SiteKind::Muscle => match site.groups.first().and_then(|id| anatomy::group(id)) {
            Some(group) => (group.id, group.zh),
            None => ("other-muscles", "其他肌肉"),
        },
        SiteKind::Bone => match site.region {
            Some(region) => (region.key(), region.zh()),
            None => ("other-bones", "其他骨骼"),
        },
    }
}

/// 某条判定（`want_retract == false`）或某次撤回（`want_retract == true`）的依据日志，
/// 取最新一条。
fn evidence_of(evidence: &[Evidence], id: FindingId, want_retract: bool) -> Option<Evidence> {
    evidence
        .iter()
        .filter(|row| row.finding == Some(id))
        .filter(|row| (row.kind == EvidenceKind::Retract) == want_retract)
        .max_by_key(|row| (row.at, row.id))
        .cloned()
}

/// 一条判定是普通写入还是「标记已解决」：看它落库时那条依据日志。
fn correction_of(evidence: Option<&Evidence>) -> Correction {
    match evidence.map(|row| row.kind) {
        Some(EvidenceKind::Resolve) => Correction::Resolve,
        _ => Correction::Record,
    }
}

/// 一个「部位 + 侧别」的事件，时间倒序。
fn history_of(
    by_id: &BTreeMap<FindingId, &Finding>,
    events: &[Event],
    evidence: &[Evidence],
    site: &str,
    side: Option<Side>,
    current: FindingId,
) -> Vec<HistoryEntry> {
    let mut entries: Vec<HistoryEntry> = events
        .iter()
        .filter_map(|event| match event {
            Event::Finding(finding)
                if finding.site == site && finding.side == side =>
            {
                let log = evidence_of(evidence, finding.id, false);
                Some(HistoryEntry {
                    at: finding.at,
                    finding: finding.id,
                    correction: correction_of(log.as_ref()),
                    values: finding.values,
                    confidence: finding.confidence,
                    reason: None,
                    evidence: log,
                    current: finding.id == current,
                })
            }
            Event::Retract(retract) => {
                let target = by_id.get(&retract.finding).copied();
                match target {
                    Some(target) if target.site == site && target.side == side => {
                        Some(HistoryEntry {
                            at: retract.at,
                            finding: retract.finding,
                            correction: Correction::Retract,
                            values: AxisValues::new(),
                            confidence: 0,
                            reason: Some(retract.reason.clone()),
                            evidence: evidence_of(evidence, retract.finding, true),
                            current: false,
                        })
                    }
                    _ => None,
                }
            }
            _ => None,
        })
        .collect();
    // 最近的在前；同一毫秒内按编号倒序（时间线里「后发生的」也在上面）。
    entries.sort_by_key(|entry| (entry.at, entry.finding));
    entries.reverse();
    entries
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{
        Axis, AxisValue, ConversationId, EvidenceDraft, EvidenceId, FindingDraft, Pain, Tension,
    };

    fn finding(id: u64, site: &str, side: Option<Side>, at: Timestamp) -> Event {
        Event::Finding(
            Finding::new(
                FindingId(id),
                FindingDraft {
                    site: site.to_owned(),
                    side,
                    values: tension(AxisValue::Tension(Tension::Weak)),
                    confidence: 78,
                    at,
                },
            )
            .expect("合法判定"),
        )
    }

    fn with_axes(id: u64, site: &str, side: Option<Side>, at: Timestamp, extra: AxisValue) -> Event {
        let mut values = tension(AxisValue::Tension(Tension::Weak));
        values.set(extra);
        Event::Finding(
            Finding::new(
                FindingId(id),
                FindingDraft {
                    site: site.to_owned(),
                    side,
                    values,
                    confidence: 60,
                    at,
                },
            )
            .expect("合法判定"),
        )
    }

    fn tension(value: AxisValue) -> AxisValues {
        let mut values = AxisValues::new();
        values.set(value);
        values
    }

    fn evidence(id: u64, finding: u64, kind: EvidenceKind, at: Timestamp) -> Evidence {
        Evidence::new(
            EvidenceId(id),
            EvidenceDraft {
                kind,
                site: "gluteus-medius".to_owned(),
                side: Some(Side::Left),
                finding: Some(FindingId(finding)),
                conversation: Some(ConversationId(1)),
                at,
                user_said: format!("用户说法要点 {id}"),
                test_and_feedback: format!("验证方案与反馈 {id}"),
                reasoning: format!("推理 {id}"),
                uncertainty: format!("不确定之处 {id}"),
            },
        )
        .expect("合法依据")
    }

    #[test]
    fn cards_are_grouped_by_muscle_group_and_bone_region_with_sides_apart() {
        let events = vec![
            finding(1, "gluteus-medius", Some(Side::Left), 100),
            finding(2, "gluteus-medius", Some(Side::Right), 200),
            finding(3, "soleus", Some(Side::Left), 300),
            finding(4, "lumbar-vertebrae", None, 400),
        ];
        let page = ProfilePage::build(&events, &[]);

        let labels: Vec<&str> = page.sections.iter().map(|s| s.label.as_str()).collect();
        // 分块顺序跟词表走（小腿 → 髋 → 脊柱），不跟事件时间走。
        assert_eq!(labels, vec!["小腿后群浅层（小腿三头肌）", "臀肌群", "脊柱"]);
        assert_eq!(page.cards(), 4);

        let glutes = &page.sections[1];
        assert_eq!(
            glutes
                .cards
                .iter()
                .map(|card| (card.site.as_str(), card.side))
                .collect::<Vec<_>>(),
            vec![
                ("gluteus-medius", Some(Side::Left)),
                ("gluteus-medius", Some(Side::Right)),
            ],
            "左右分开、左侧在前"
        );
        // 中线结构不带侧别。
        assert_eq!(page.sections[2].cards[0].side, None);
    }

    #[test]
    fn the_card_carries_the_four_sections_of_its_current_finding() {
        let events = vec![
            finding(1, "gluteus-medius", Some(Side::Left), 100),
            finding(2, "gluteus-medius", Some(Side::Left), 200),
        ];
        let logs = vec![
            evidence(10, 1, EvidenceKind::Record, 100),
            evidence(20, 2, EvidenceKind::Record, 200),
        ];
        let page = ProfilePage::build(&events, &logs);
        let card = &page.sections[0].cards[0];

        assert_eq!(card.from, FindingId(2));
        let current = card.evidence.as_ref().expect("当前判定有依据");
        assert_eq!(current.id, EvidenceId(20));
        assert_eq!(
            current
                .sections()
                .iter()
                .map(|(name, _)| *name)
                .collect::<Vec<_>>(),
            vec!["用户说法要点", "验证方案与反馈", "推理", "不确定之处"]
        );
        assert!(!card.resolved(), "张力弱不是已解决");
    }

    #[test]
    fn history_is_newest_first_keeps_retractions_and_marks_the_live_one() {
        let events = vec![
            finding(1, "gluteus-medius", Some(Side::Left), 100),
            finding(2, "gluteus-medius", Some(Side::Left), 200),
            Event::Retract(
                crate::domain::Retract::new(FindingId(2), "当时看错了", 300).expect("合法"),
            ),
        ];
        let page = ProfilePage::build(&events, &[]);
        let card = &page.sections[0].cards[0];

        assert_eq!(
            card.history
                .iter()
                .map(|entry| (entry.at, entry.correction))
                .collect::<Vec<_>>(),
            vec![
                (300, Correction::Retract),
                (200, Correction::Record),
                (100, Correction::Record)
            ],
            "最近的在最上面，撤回也在时间线上"
        );
        assert_eq!(card.history[0].reason.as_deref(), Some("当时看错了"));
        // 当前生效的是剩下那条没被撤回的。
        assert_eq!(card.from, FindingId(1));
        assert!(card.history[2].current);
        assert!(!card.history[1].current);
    }

    #[test]
    fn a_resolved_site_is_the_one_a_resolve_appended_not_any_normal_one() {
        let original = Finding::new(
            FindingId(1),
            FindingDraft {
                site: "gluteus-medius".to_owned(),
                side: Some(Side::Left),
                values: tension(AxisValue::Tension(Tension::Weak)),
                confidence: 78,
                at: 100,
            },
        )
        .expect("合法判定");
        let resolved = Finding::new(
            FindingId(2),
            FindingDraft::resolve(&original, 200),
        )
        .expect("合法");
        let events = vec![
            Event::Finding(original.clone()),
            Event::Finding(resolved.clone()),
        ];
        let logs = vec![
            evidence(10, 1, EvidenceKind::Record, 100),
            evidence(20, 2, EvidenceKind::Resolve, 200),
        ];

        let page = ProfilePage::build(&events, &logs);
        let card = &page.sections[0].cards[0];
        assert!(card.resolved(), "最新那条来自「标记已解决」");
        assert_eq!(card.from, FindingId(2));
        assert_eq!(card.history.len(), 2, "原判定仍在时间线里");
        assert_eq!(card.history[0].correction, Correction::Resolve);
        assert_eq!(card.history[1].correction, Correction::Record);

        // 一条一开始就判正常的判定不许冒充「已解决」：那是取值，不是动作。
        let normal = Finding::new(
            FindingId(3),
            FindingDraft {
                site: "soleus".to_owned(),
                side: Some(Side::Left),
                values: tension(AxisValue::Tension(Tension::Normal)),
                confidence: 70,
                at: 300,
            },
        )
        .expect("合法");
        let page = ProfilePage::build(
            &[Event::Finding(normal.clone())],
            &[evidence(30, 3, EvidenceKind::Record, 300)],
        );
        assert!(!page.sections[0].cards[0].resolved());
    }

    #[test]
    fn the_group_shows_the_worst_member_per_axis_and_says_which_one() {
        let events = vec![
            event(
                1,
                "gluteus-maximus",
                Some(Side::Left),
                100,
                AxisValue::Tension(Tension::Normal),
            ),
            event(
                2,
                "gluteus-medius",
                Some(Side::Left),
                200,
                AxisValue::Tension(Tension::Tight),
            ),
            event(
                3,
                "gluteus-minimus",
                Some(Side::Left),
                300,
                AxisValue::Pain(Pain::new(6).expect("等级合法")),
            ),
        ];
        let page = ProfilePage::build(&events, &[]);

        let left = page
            .groups
            .iter()
            .find(|group| group.id == "gluteal-group" && group.side == Some(Side::Left))
            .expect("左侧有判定");
        // 张力取「紧」（比正常差），疼痛取 6。
        assert_eq!(
            left.values.get(Axis::Tension),
            Some(AxisValue::Tension(Tension::Tight))
        );
        assert_eq!(
            left.values.get(Axis::Pain),
            Some(AxisValue::Pain(Pain::new(6).expect("等级合法")))
        );
        // 最差来自疼痛那条（6 分比异常的 1 更糟）。
        assert_eq!(left.source.site, "gluteus-minimus");
        assert_eq!(left.source.site_zh, "臀小肌");
        assert_eq!(left.zh, "臀肌群");
        assert_eq!(left.sites.len(), 3);
    }

    #[test]
    fn sites_outside_the_vocabulary_never_show_up() {
        // 旧库 / 手改过的 JSON 里可能留着词表已经删掉的 id：直接反序列化绕过校验，
        // 模拟那条路。档案页不该把它当一条判定显示出来。
        let stray: Finding = serde_json::from_str(
            r#"{"id":9,"site":"gluteus","side":"left",
                "values":{"tension":"weak"},"confidence":80,"at":100}"#,
        )
        .expect("旧数据能读出来");
        let page = ProfilePage::build(&[Event::Finding(stray)], &[]);
        assert_eq!(page.cards(), 0);
        assert!(page.groups.is_empty());
    }

    fn event(id: u64, site: &str, side: Option<Side>, at: Timestamp, extra: AxisValue) -> Event {
        with_axes(id, site, side, at, extra)
    }
}
