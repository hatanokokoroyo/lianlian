//! 投影与聚合：当前状态永远是从事件流算出来的（ADR-0003）。
//!
//! - 投影：每个「部位 + 侧别」取最近一条未被撤回的判定；
//! - 肌群：成员肌肉逐轴取最差值（肌群不是可记录部位）；
//! - 骨骼集合区域（颈/胸/腰椎、肋骨、腕骨、跖骨）：子项优先于父项。

use std::collections::{BTreeMap, BTreeSet};

use crate::anatomy;

use super::axis::Axis;
use super::{AxisValues, Event, Finding, FindingId, Side, Timestamp};

/// 某个「部位 + 侧别」的当前状态。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SiteState {
    /// 部位 id。
    pub site: String,
    /// 侧别；中线结构为 `None`。
    pub side: Option<Side>,
    /// 当前生效的取值。
    pub values: AxisValues,
    /// 这条状态来自哪条判定。
    pub from: FindingId,
    /// 那条判定的时间。
    pub at: Timestamp,
}

/// 聚合出来的状态（肌群视图，或骨骼集合区域的有效状态）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Aggregate {
    /// 逐轴取最差之后的取值。
    pub values: AxisValues,
    /// 最差那条来自哪条判定。
    pub from: FindingId,
    /// 最差那条判定的时间。
    pub at: Timestamp,
    /// 参与聚合、且有判定的部位（按词表顺序）。
    pub sites: Vec<String>,
}

/// 事件流投影出来的档案。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Projection {
    states: BTreeMap<(String, Option<Side>), SiteState>,
    retracted: BTreeSet<FindingId>,
}

impl Projection {
    /// 从事件流算出当前状态。
    ///
    /// 撤回的判定完全不参与（不论撤回事件写在前面还是后面）；剩下的按
    /// 「时间、编号」排序，同一「部位 + 侧别」取最后一条。
    pub fn from_events(events: &[Event]) -> Projection {
        let mut retracted = BTreeSet::new();
        for event in events {
            if let Event::Retract(retract) = event {
                retracted.insert(retract.finding);
            }
        }

        let mut live: Vec<&Finding> = events
            .iter()
            .filter_map(|event| match event {
                Event::Finding(finding) if !retracted.contains(&finding.id) => Some(finding),
                _ => None,
            })
            .collect();
        live.sort_by_key(|finding| (finding.at, finding.id));

        let mut states = BTreeMap::new();
        for finding in live {
            states.insert(
                (finding.site.clone(), finding.side),
                SiteState {
                    site: finding.site.clone(),
                    side: finding.side,
                    values: finding.values,
                    from: finding.id,
                    at: finding.at,
                },
            );
        }
        Projection { states, retracted }
    }

    /// 某个「部位 + 侧别」的当前状态。
    pub fn state(&self, site: &str, side: Option<Side>) -> Option<&SiteState> {
        self.states.get(&(site.to_owned(), side))
    }

    /// 全部当前状态，按（部位 id，侧别）排序。
    pub fn states(&self) -> impl Iterator<Item = &SiteState> {
        self.states.values()
    }

    /// 已撤回的判定编号。
    pub fn retracted(&self) -> &BTreeSet<FindingId> {
        &self.retracted
    }

    /// 是否有任何判定。
    pub fn is_empty(&self) -> bool {
        self.states.is_empty()
    }

    /// 肌群的整体状态：成员肌肉逐轴取最差值。
    ///
    /// `side` 是查询的侧别：成对成员用它，中线成员（膈）没有侧别。
    /// 成员里一条判定都没有时返回 `None`——「未测」不是「正常」。
    pub fn group_worst(&self, group_id: &str, side: Option<Side>) -> Option<Aggregate> {
        let mut states = Vec::new();
        for member in anatomy::members(group_id) {
            let key = if member.paired { side } else { None };
            if let Some(state) = self.state(member.id, key) {
                states.push(state);
            }
        }
        aggregate(states)
    }

    /// 某个部位的有效状态：有子项判定时子项优先于父项（ADR-0003 修订）。
    ///
    /// 没有子项判定就退回这条部位自己的判定；子项没测的轴仍看父项。
    pub fn effective(&self, site_id: &str, side: Option<Side>) -> Option<Aggregate> {
        let own = self.state(site_id, side);

        let mut children = Vec::new();
        for child in anatomy::children(site_id) {
            let key = if child.paired { side } else { None };
            if let Some(state) = self.state(child.id, key) {
                children.push(state);
            }
        }
        let children = match aggregate(children) {
            Some(children) => children,
            None => {
                return own.map(|state| Aggregate {
                    values: state.values,
                    from: state.from,
                    at: state.at,
                    sites: vec![state.site.clone()],
                })
            }
        };

        // 子项逐轴覆盖父项：子项测过的轴用子项的（最差），没测的轴留父项的。
        let mut values = own.map(|state| state.values).unwrap_or_default();
        for axis in children.values.measured() {
            if let Some(value) = children.values.get(axis) {
                values.set(value);
            }
        }
        Some(Aggregate {
            values,
            from: children.from,
            at: children.at,
            sites: children.sites,
        })
    }
}

/// 一组状态逐轴取最差，并记下最差那条来自哪里。
fn aggregate(states: Vec<&SiteState>) -> Option<Aggregate> {
    let mut merged = AxisValues::new();
    let mut source: Option<&SiteState> = None;
    let mut source_severity = 0;
    let mut sites = Vec::new();

    for state in states {
        merged = merged.worst(state.values);
        sites.push(state.site.clone());
        // 「最差那条」：整条判定里最异常的轴，pain 等级最高者胜；
        // 平手保持先出现的那条（成员顺序固定，结果可复现）。
        let severity = Axis::ALL
            .into_iter()
            .filter_map(|axis| state.values.get(axis))
            .map(|value| value.severity())
            .max()
            .unwrap_or(0);
        if source.is_none() || severity > source_severity {
            source = Some(state);
            source_severity = severity;
        }
    }

    let source = source?;
    Some(Aggregate {
        values: merged,
        from: source.from,
        at: source.at,
        sites,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{Axis, AxisValue, FindingDraft, Mobility, Pain, Retract, Stability, Symmetry, Tension};

    fn finding(id: u64, site: &str, side: Option<Side>, at: Timestamp, values: AxisValues) -> Event {
        let draft = FindingDraft {
            site: site.to_owned(),
            side,
            values,
            confidence: 80,
            at,
        };
        Event::Finding(Finding::new(FindingId(id), draft).expect("合法判定"))
    }

    fn at(ms: i64) -> Timestamp {
        ms
    }

    fn tension(value: Tension) -> AxisValues {
        let mut values = AxisValues::new();
        values.set(AxisValue::Tension(value));
        values
    }

    #[test]
    fn projection_keeps_the_latest_judgement_per_site_and_side() {
        let events = vec![
            finding(1, "gluteus-medius", Some(Side::Left), at(100), tension(Tension::Weak)),
            finding(2, "gluteus-medius", Some(Side::Left), at(300), tension(Tension::Normal)),
            finding(3, "gluteus-medius", Some(Side::Right), at(200), tension(Tension::Tight)),
        ];
        let projection = Projection::from_events(&events);

        let left = projection.state("gluteus-medius", Some(Side::Left)).expect("左侧有判定");
        assert_eq!(left.values.get(Axis::Tension), Some(AxisValue::Tension(Tension::Normal)));
        assert_eq!(left.from, FindingId(2));

        let right = projection.state("gluteus-medius", Some(Side::Right)).expect("右侧有判定");
        assert_eq!(right.values.get(Axis::Tension), Some(AxisValue::Tension(Tension::Tight)));
        assert_eq!(projection.states().count(), 2);
    }

    #[test]
    fn order_of_events_does_not_matter_only_their_time() {
        let early = finding(1, "soleus", Some(Side::Left), at(100), tension(Tension::Weak));
        let later = finding(2, "soleus", Some(Side::Left), at(900), tension(Tension::Normal));
        let forwards = Projection::from_events(&[early.clone(), later.clone()]);
        let backwards = Projection::from_events(&[later, early]);
        assert_eq!(forwards, backwards);
    }

    #[test]
    fn retracting_the_latest_falls_back_to_the_previous_judgement() {
        let events = vec![
            finding(1, "soleus", Some(Side::Left), at(100), tension(Tension::Weak)),
            finding(2, "soleus", Some(Side::Left), at(200), tension(Tension::Normal)),
        ];
        let before = Projection::from_events(&events);
        assert_eq!(
            before.state("soleus", Some(Side::Left)).unwrap().from,
            FindingId(2)
        );

        let mut retracted = events.clone();
        retracted.push(Event::Retract(
            Retract::new(FindingId(2), "当时看错了", at(300)).unwrap(),
        ));
        let after = Projection::from_events(&retracted);
        let state = after.state("soleus", Some(Side::Left)).expect("还剩一条");
        assert_eq!(state.from, FindingId(1));
        assert_eq!(state.values.get(Axis::Tension), Some(AxisValue::Tension(Tension::Weak)));
        assert_eq!(after.retracted().len(), 1);
    }

    #[test]
    fn retracting_the_only_judgement_removes_the_site() {
        let events = vec![
            finding(1, "soleus", Some(Side::Left), at(100), tension(Tension::Weak)),
            Event::Retract(Retract::new(FindingId(1), "部位记错了", at(200)).unwrap()),
        ];
        let projection = Projection::from_events(&events);
        assert!(projection.state("soleus", Some(Side::Left)).is_none());
        assert!(projection.is_empty());
    }

    #[test]
    fn resolving_shows_up_as_normal_values_with_history_kept() {
        let original = finding(1, "gluteus-medius", Some(Side::Left), at(100), tension(Tension::Weak));
        let stored = match &original {
            Event::Finding(finding) => finding.clone(),
            _ => unreachable!("第一条是判定"),
        };
        let resolve = FindingDraft::resolve(&stored, at(400));
        let events = vec![
            original,
            Event::Finding(Finding::new(FindingId(2), resolve).expect("合法")),
        ];
        let projection = Projection::from_events(&events);
        let state = projection.state("gluteus-medius", Some(Side::Left)).unwrap();
        assert_eq!(state.values.get(Axis::Tension), Some(AxisValue::Tension(Tension::Normal)));
        assert_eq!(state.from, FindingId(2));
        // 历史条目还在事件流里。
        assert_eq!(events.len(), 2);
    }

    #[test]
    fn group_worst_takes_the_worst_member_per_axis() {
        let mut right_values = AxisValues::new();
        right_values.set(AxisValue::Tension(Tension::Tight));
        right_values.set(AxisValue::Stability(Stability::Poor));

        let events = vec![
            finding(1, "gluteus-maximus", Some(Side::Left), at(100), tension(Tension::Normal)),
            finding(2, "gluteus-medius", Some(Side::Left), at(200), tension(Tension::Weak)),
            finding(3, "gluteus-minimus", Some(Side::Left), at(300), right_values),
            // 右侧不同轴，不该混进左侧的聚合。
            finding(4, "gluteus-medius", Some(Side::Right), at(400), {
                let mut values = AxisValues::new();
                values.set(AxisValue::Pain(Pain::new(6).unwrap()));
                values
            }),
        ];
        let projection = Projection::from_events(&events);

        let left = projection.group_worst("gluteal-group", Some(Side::Left)).expect("左侧有判定");
        // 「弱」与「紧」同为异常（严重度都是 1），平手时保持成员顺序 → 先出现的「弱」。
        // 这条规则是刻意的：谁更糟没有共识，聚合结果必须可复现。
        assert_eq!(left.values.get(Axis::Tension), Some(AxisValue::Tension(Tension::Weak)));
        assert_eq!(
            left.values.get(Axis::Stability),
            Some(AxisValue::Stability(Stability::Poor))
        );
        // 疼痛只在右侧测过。
        assert_eq!(left.values.get(Axis::Pain), None);
        assert_eq!(left.sites.len(), 3);

        let right = projection.group_worst("gluteal-group", Some(Side::Right)).expect("右侧有判定");
        assert!(right.values.get(Axis::Pain).unwrap().severity() == 6);
    }

    #[test]
    fn group_without_any_judgement_stays_unmeasured() {
        let projection = Projection::from_events(&[]);
        assert!(projection.group_worst("gluteal-group", Some(Side::Left)).is_none());
        assert!(projection.group_worst("not-a-group", Some(Side::Left)).is_none());
    }

    #[test]
    fn bone_collections_let_children_win_over_the_parent() {
        let mut parent_values = AxisValues::new();
        parent_values.set(AxisValue::Mobility(Mobility::Limited));
        parent_values.set(AxisValue::Symmetry(Symmetry::Symmetric));

        let mut child_values = AxisValues::new();
        child_values.set(AxisValue::Mobility(Mobility::Normal));

        let events = vec![
            // 父级（颈椎）与子级（寰椎）都有判定。
            finding(1, "cervical-vertebrae", None, at(100), parent_values),
            finding(2, "atlas", None, at(200), child_values),
        ];
        let projection = Projection::from_events(&events);

        // 子项优先：活动度取子项的正常，而不是父级的受限。
        let effective = projection.effective("cervical-vertebrae", None).expect("有判定");
        assert_eq!(
            effective.values.get(Axis::Mobility),
            Some(AxisValue::Mobility(Mobility::Normal))
        );
        // 子项没测的轴仍看父级。
        assert_eq!(
            effective.values.get(Axis::Symmetry),
            Some(AxisValue::Symmetry(Symmetry::Symmetric))
        );
        assert_eq!(effective.from, FindingId(2), "覆盖来自寰椎那条判定");
    }

    #[test]
    fn bone_collections_fall_back_to_the_parent_alone() {
        let mut values = AxisValues::new();
        values.set(AxisValue::Mobility(Mobility::Limited));
        let events = vec![finding(1, "cervical-vertebrae", None, at(100), values)];
        let projection = Projection::from_events(&events);
        let effective = projection.effective("cervical-vertebrae", None).expect("有判定");
        assert_eq!(effective.from, FindingId(1));
        assert_eq!(effective.sites, vec!["cervical-vertebrae"]);
    }
}
