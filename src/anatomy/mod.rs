//! 解剖学部位词表：随包编译的静态数据，加上查询与约束规则。
//!
//! 词表**内容**在 `sites.rs`（由 `scripts/gen-anatomy.py` 从
//! `.scratch/body-profile/anatomy-sites.md` 生成，人工真源是那份 markdown）。
//! 这里放类型与规则：档案只能落在词表里的肌肉或骨骼上，肌群是查询时聚合出来的
//! 视图而不是可记录的部位（ADR-0003）。

mod sites;

#[allow(unused_imports)] // 词表内容的版本号由 `store` 与测试使用，先在这里露出。
pub use sites::{GROUPS, SCHEMA_VERSION, SITES};

use std::collections::HashMap;
use std::sync::OnceLock;

/// 部位的两种粒度：肌肉与骨骼。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SiteKind {
    Muscle,
    Bone,
}

/// 单块结构与可记录的集合区域（颈/胸/腰椎、肋骨、腕骨、跖骨）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Granularity {
    Single,
    Group,
}

/// 骨骼的区域分组，只用来在档案页按区域分块显示。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Region {
    SkullFace,
    Spine,
    Thorax,
    ShoulderGirdle,
    UpperLimb,
    Pelvis,
    LowerLimb,
    Foot,
}

impl Region {
    /// 显示用的中文名。
    pub fn zh(self) -> &'static str {
        match self {
            Region::SkullFace => "颅面",
            Region::Spine => "脊柱",
            Region::Thorax => "胸廓",
            Region::ShoulderGirdle => "肩带",
            Region::UpperLimb => "上肢",
            Region::Pelvis => "骨盆",
            Region::LowerLimb => "下肢",
            Region::Foot => "足",
        }
    }
}

/// 词表里的一条部位。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Site {
    /// 全小写 kebab-case，是 Finding 引用的唯一凭据。
    pub id: &'static str,
    /// 中文名（显示用字，见词表头的说明）。
    pub zh: &'static str,
    /// 英文名。
    pub en: &'static str,
    /// 拉丁名，FIPAT 现行版（TAH）首选形。
    pub latin: &'static str,
    /// 拉丁别名：旧形、规范字形、常见写法。
    pub latin_aliases: &'static [&'static str],
    pub kind: SiteKind,
    /// 所属肌群（可多值）；骨骼为空。
    pub groups: &'static [&'static str],
    /// 骨骼的区域；肌肉为 `None`。
    pub region: Option<Region>,
    /// 是否左右成对：成对部位落判定时必须带侧别，中线结构（如膈）不能带。
    pub paired: bool,
    /// 父级部位（骨骼的组成部分指向整体）；没有则为 `None`。
    pub parent: Option<&'static str>,
    /// 单体，还是可记录的集合区域。
    pub granularity: Granularity,
}

impl Site {
    /// 是否可记录（目前所有词表条目都可记录；留着这个判断位给将来的折叠项）。
    pub fn recordable(self) -> bool {
        true
    }

    /// 是否是一个可记录的集合区域（颈椎、肋骨……）。
    pub fn is_collection(self) -> bool {
        self.granularity == Granularity::Group
    }
}

/// 一个肌群：成员肌肉的聚合视图，不是可记录的部位。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MuscleGroup {
    pub id: &'static str,
    pub zh: &'static str,
    pub en: &'static str,
    /// 成员肌肉的 id。
    pub members: &'static [&'static str],
}

fn site_index() -> &'static HashMap<&'static str, usize> {
    static INDEX: OnceLock<HashMap<&'static str, usize>> = OnceLock::new();
    INDEX.get_or_init(|| {
        SITES
            .iter()
            .enumerate()
            .map(|(position, site)| (site.id, position))
            .collect()
    })
}

fn group_index() -> &'static HashMap<&'static str, usize> {
    static INDEX: OnceLock<HashMap<&'static str, usize>> = OnceLock::new();
    INDEX.get_or_init(|| {
        GROUPS
            .iter()
            .enumerate()
            .map(|(position, group)| (group.id, position))
            .collect()
    })
}

/// 按 id 取部位。
pub fn site(id: &str) -> Option<&'static Site> {
    site_index().get(id).map(|position| &SITES[*position])
}

/// 全部部位，词表顺序。
pub fn all() -> &'static [Site] {
    SITES
}

/// 按 id 取肌群。
pub fn group(id: &str) -> Option<&'static MuscleGroup> {
    group_index().get(id).map(|position| &GROUPS[*position])
}

/// 全部肌群。
pub fn all_groups() -> &'static [MuscleGroup] {
    GROUPS
}

/// 肌群的成员肌肉；词表里没登记的单块会被忽略（生成期已校验，正常不会发生）。
pub fn members(group_id: &str) -> impl Iterator<Item = &'static Site> {
    let ids = group(group_id).map(|group| group.members).unwrap_or(&[]);
    ids.iter().filter_map(|id| site(id))
}

/// 某个部位的直接子项（例如 `cervical-vertebrae` 的 `atlas`、`axis`）。
pub fn children(parent_id: &str) -> impl Iterator<Item = &'static Site> {
    SITES
        .iter()
        .filter(move |site| site.parent == Some(parent_id))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn vocabulary_has_the_audited_shape() {
        let muscles = SITES.iter().filter(|s| s.kind == SiteKind::Muscle).count();
        let bones = SITES.iter().filter(|s| s.kind == SiteKind::Bone).count();
        assert_eq!(muscles, 79, "词表审计后的肌肉数");
        assert_eq!(bones, 40, "词表审计后的骨骼数（含集合区域）");
        assert_eq!(GROUPS.len(), 23, "词表审计后的肌群数");
        assert!(SCHEMA_VERSION >= 1);
    }

    #[test]
    fn ids_are_unique_across_sites_and_groups() {
        let mut seen = HashSet::new();
        for id in SITES
            .iter()
            .map(|site| site.id)
            .chain(GROUPS.iter().map(|group| group.id))
        {
            assert!(seen.insert(id), "id 重复：{id}");
        }
    }

    #[test]
    fn names_are_unique_inside_each_table() {
        let mut zh = HashSet::new();
        assert!(
            SITES.iter().all(|site| zh.insert(site.zh)),
            "部位的中文名必须互异（否则选词会歧义）"
        );
        let mut group_zh = HashSet::new();
        assert!(GROUPS.iter().all(|group| group_zh.insert(group.zh)));
    }

    #[test]
    fn every_reference_resolves() {
        for entry in SITES {
            for group_id in entry.groups {
                let group = group(group_id)
                    .unwrap_or_else(|| panic!("{site_id} 的肌群不存在", site_id = entry.id));
                assert!(
                    group.members.contains(&entry.id),
                    "{id} 声明属于 {group_id}，但那个群没有回指它",
                    id = entry.id
                );
            }
            if let Some(parent) = entry.parent {
                assert!(super::site(parent).is_some(), "{} 的父级 {parent} 不存在", entry.id);
            }
        }
        for group in GROUPS {
            for member_id in group.members {
                let member = site(member_id)
                    .unwrap_or_else(|| panic!("{} 的成员 {member_id} 不存在", group.id));
                assert_eq!(member.kind, SiteKind::Muscle, "肌群成员只能是肌肉");
                assert!(
                    member.groups.contains(&group.id),
                    "{member_id} 被 {} 收录，但它没有声明属于这个群",
                    group.id
                );
            }
        }
    }

    #[test]
    fn every_muscle_belongs_to_a_group() {
        // 审计后「无归属肌肉」应为 0，否则聚合视图会漏掉它。
        let orphans: Vec<_> = SITES
            .iter()
            .filter(|entry| entry.kind == SiteKind::Muscle && entry.groups.is_empty())
            .map(|entry| entry.id)
            .collect();
        assert!(orphans.is_empty(), "无归属肌肉：{orphans:?}");
    }

    #[test]
    fn side_column_matches_midline_structures() {
        // 肌肉里只有膈是中线结构；其余都是左右成对。
        let midline_muscles: Vec<_> = SITES
            .iter()
            .filter(|entry| entry.kind == SiteKind::Muscle && !entry.paired)
            .map(|entry| entry.id)
            .collect();
        assert_eq!(midline_muscles, vec!["diaphragm"]);

        // 骨骼里中线结构不止一块（颅面、脊柱、胸骨），它们同样不带侧别。
        let midline_bones: Vec<_> = SITES
            .iter()
            .filter(|entry| entry.kind == SiteKind::Bone && !entry.paired)
            .map(|entry| entry.id)
            .collect();
        assert!(midline_bones.contains(&"sternum"));
        assert!(midline_bones.contains(&"lumbar-vertebrae"));
        assert!(!midline_bones.contains(&"femur"));

        for entry in SITES.iter().filter(|entry| entry.kind == SiteKind::Bone) {
            assert!(entry.region.is_some(), "{} 缺区域", entry.id);
            assert!(entry.groups.is_empty(), "骨骼不该有肌群归属");
        }
        for entry in SITES.iter().filter(|entry| entry.kind == SiteKind::Muscle) {
            assert!(entry.region.is_none(), "{} 不该有骨骼区域", entry.id);
            assert!(!entry.is_collection(), "肌肉里没有集合区域");
        }
    }

    #[test]
    fn collection_regions_are_the_six_audited_rows() {
        let mut collections: Vec<_> = SITES
            .iter()
            .filter(|entry| entry.is_collection())
            .map(|entry| entry.id)
            .collect();
        collections.sort_unstable();
        assert_eq!(
            collections,
            vec![
                "carpal-bones",
                "cervical-vertebrae",
                "lumbar-vertebrae",
                "metatarsals",
                "ribs",
                "thoracic-vertebrae",
            ]
        );
    }

    #[test]
    fn children_of_collections_are_recordable() {
        let vertebrae: Vec<_> = children("cervical-vertebrae").map(|s| s.id).collect();
        assert_eq!(vertebrae, vec!["atlas", "axis"]);
        let scapula: Vec<_> = children("scapula").map(|s| s.id).collect();
        assert_eq!(
            scapula,
            vec!["acromion", "coracoid-process", "glenoid-cavity"]
        );
    }

    #[test]
    fn lookups_answer_both_ways() {
        let medius = site("gluteus-medius").expect("臀中肌在词表里");
        assert_eq!(medius.zh, "臀中肌");
        assert!(medius.paired);
        assert!(medius.groups.contains(&"gluteal-group"));
        assert!(site("not-a-site").is_none());
        assert_eq!(
            members("gluteal-group").map(|m| m.id).collect::<Vec<_>>(),
            vec!["gluteus-maximus", "gluteus-medius", "gluteus-minimus"]
        );
        assert!(group("not-a-group").is_none());
    }
}
