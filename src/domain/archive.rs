//! 档案页的读模型：部位卡片（按肌群 / 骨骼区域分组、左右分开）、四段依据、
//! 时间线与肌群聚合。
//!
//! 这里只读事件流（[`Event`]）与依据日志，不改任何东西：卡片上的「已解决 / 撤回」
//! 是 `api` 往库里追加事件，再重新算一遍投影。词表外的部位一律不出现——档案只能
//! 落在词表里（ADR-0003），旧库里漏出来的 id 不该在界面上冒充一条判定。

use crate::anatomy::{self, SiteKind};

use super::evidence::{Evidence, EvidenceKind};
use super::finding::{Event, Finding, FindingId, Side, Timestamp};
use super::projection::Projection;
use super::AxisValues;

/// 时间线上的一条：一条判定，或一次撤回。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HistoryEntry {
    /// 事件时间。
    pub at: Timestamp,
    /// 判定 id；撤回事件指向被撤回的那条。
    pub finding: FindingId,
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

impl HistoryEntry {
    /// 是不是一次撤回。
    pub fn is_retract(&self) -> bool {
        self.reason.is_some()
    }
}

/// 档案页上的一行：一个「部位 + 侧别」的当前状态。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SiteCard {
    /// 部位 id。
    pub site: String,
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
    /// 当前生效的取值是否全为正常（「已解决」）。
    pub fn resolved(&self) -> bool {
        self.values.measured().all(|axis| {
            self.values
                .get(axis)
                .is_some_and(|value| value.is_normal())
        })
    }
}

/// 按区域（肌肉看首要肌群，骨骼看区域）分出来的一块。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Section {
    /// 肌肉是肌群 id，骨骼是区域 id。
    pub id: String,
    /// 显示用的中文名。
    pub label: String,
    /// 这一块里的卡片，按词表顺序、左侧在前。
    pub cards: Vec<SiteCard>,
}

/// 一个肌群在一侧上的聚合：成员逐轴取最差值。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GroupWorst {
    /// 肌群 id。
    pub id: String,
    /// 聚合的侧别（`None` 是中线成员）。
    pub side: Option<Side>,
    /// 逐轴取最差之后的取值。
    pub values: AxisValues,
    /// 最差那条判定。
    pub from: FindingId,
    /// 最差那条判定的时间。
    pub at: Timestamp,
    /// 最差那条判定的取值。
    pub source_values: AxisValues,
    /// 最差那条判定落在哪个部位。
    pub source_site: String,
    /// 参与聚合、且有判定的成员部位（词表顺序）。
    pub sites: Vec<String>,
}

/// 档案页要的全部读模型。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Archive {
    /// 已经按区域分好的卡片。
    pub sections: Vec<Section>,
    /// 有判定的肌群聚合（没判定的肌群不出现：未测不是正常）。
    pub groups: Vec<GroupWorst>,
}

impl Archive {
    /// 从事件流与依据日志算出档案页的读模型。
    pub fn build(events: &[Event], evidence: &[Evidence]) -> Archive {
        let projection = Projection::from_events(events);
        let mut sections: Vec<Section> = Vec::new();

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
                    side,
                    values: state.values,
                    from: state.from,
                    at: state.at,
                    confidence: confidence_of(events, state.from),
                    evidence: evidence_of(evidence, state.from, false),
                    history: history_of(events, evidence, site.id, side, state.from),
                };
                match sections.iter_mut().find(|section| section.id == id) {
                    Some(section) => section.cards.push(card),
                    None => sections.push(Section {
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
                groups.push(GroupWorst {
                    id: group.id.to_owned(),
                    side,
                    values: aggregate.values,
                    from: aggregate.from,
                    at: aggregate.at,
                    source_values: values_of_finding(events, aggregate.from),
                    source_site: site_of_finding(events, aggregate.from),
                    sites: aggregate.sites,
                });
            }
        }

        Archive { sections, groups }
    }

    /// 一条判定都没有。
    pub fn is_empty(&self) -> bool {
        self.sections.is_empty()
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

/// 某条判定的置信度；找不到（不该发生）按 0 处理。
fn confidence_of(events: &[Event], id: FindingId) -> u8 {
    finding_of(events, id).map(|finding| finding.confidence).unwrap_or(0)
}

fn finding_of(events: &[Event], id: FindingId) -> Option<&Finding> {
    events.iter().find_map(|event| match event {
        Event::Finding(finding) if finding.id == id => Some(finding),
        _ => None,
    })
}

fn values_of_finding(events: &[Event], id: FindingId) -> AxisValues {
    finding_of(events, id)
        .map(|finding| finding.values)
        .unwrap_or_default()
}

fn site_of_finding(events: &[Event], id: FindingId) -> String {
    finding_of(events, id)
        .map(|finding| finding.site.clone())
        .unwrap_or_default()
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

/// 一个「部位 + 侧别」的事件，时间倒序。
fn history_of(
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
                Some(HistoryEntry {
                    at: finding.at,
                    finding: finding.id,
                    values: finding.values,
                    confidence: finding.confidence,
                    reason: None,
                    evidence: evidence_of(evidence, finding.id, false),
                    current: finding.id == current,
                })
            }
            Event::Retract(retract) => {
                let target = finding_of(events, retract.finding);
                match target {
                    Some(target) if target.site == site && target.side == side => {
                        Some(HistoryEntry {
                            at: retract.at,
                            finding: retract.finding,
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
        let archive = Archive::build(&events, &[]);

        let labels: Vec<&str> = archive.sections.iter().map(|s| s.label.as_str()).collect();
        // 分块顺序跟词表走（小腿 → 髋 → 脊柱），不跟事件时间走。
        assert_eq!(labels, vec!["小腿后群浅层（小腿三头肌）", "臀肌群", "脊柱"]);
        assert_eq!(archive.cards(), 4);

        let glutes = &archive.sections[1];
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
        assert_eq!(archive.sections[2].cards[0].side, None);
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
        let archive = Archive::build(&events, &logs);
        let card = &archive.sections[0].cards[0];

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
        let archive = Archive::build(&events, &[]);
        let card = &archive.sections[0].cards[0];

        assert_eq!(
            card.history
                .iter()
                .map(|entry| (entry.at, entry.is_retract()))
                .collect::<Vec<_>>(),
            vec![(300, true), (200, false), (100, false)],
            "最近的在最上面，撤回也在时间线上"
        );
        assert_eq!(card.history[0].reason.as_deref(), Some("当时看错了"));
        // 当前生效的是剩下那条没被撤回的。
        assert_eq!(card.from, FindingId(1));
        assert!(card.history[2].current);
        assert!(!card.history[1].current);
    }

    #[test]
    fn a_resolved_site_reads_as_normal_and_keeps_history() {
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
        let events = vec![
            Event::Finding(original.clone()),
            Event::Finding(
                Finding::new(FindingId(2), FindingDraft::resolve(&original, 200)).expect("合法"),
            ),
        ];
        let archive = Archive::build(&events, &[]);
        let card = &archive.sections[0].cards[0];
        assert!(card.resolved());
        assert_eq!(card.from, FindingId(2));
        assert_eq!(card.history.len(), 2, "原判定仍在时间线里");
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
        let archive = Archive::build(&events, &[]);

        let left = archive
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
        assert_eq!(left.source_site, "gluteus-minimus");
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
        let archive = Archive::build(&[Event::Finding(stray)], &[]);
        assert!(archive.is_empty());
        assert_eq!(archive.cards(), 0);
        assert!(archive.groups.is_empty());
    }

    fn event(id: u64, site: &str, side: Option<Side>, at: Timestamp, extra: AxisValue) -> Event {
        with_axes(id, site, side, at, extra)
    }
}
