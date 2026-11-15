#!/usr/bin/env python3
"""把 `.scratch/body-profile/anatomy-sites.md` 的三张表生成成 Rust 静态数据。

    python3 scripts/gen-anatomy.py           # 写 src/anatomy/sites.rs
    python3 scripts/gen-anatomy.py --check    # 只检查生成结果是否与文件一致（CI/提交前用）

词表的人工真源是那份 markdown（含审计报告）；生成物入库，二者必须一致，所以改完
markdown 要重跑本脚本，`--check` 会在不一致时报错。
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / ".scratch/body-profile/anatomy-sites.md"
TARGET = ROOT / "src/anatomy/sites.rs"

# 骨骼表的「所属区域」→ Region 枚举。
REGIONS = {
    "颅面": "SkullFace",
    "脊柱": "Spine",
    "胸廓": "Thorax",
    "肩带": "ShoulderGirdle",
    "上肢": "UpperLimb",
    "骨盆": "Pelvis",
    "下肢": "LowerLimb",
    "足": "Foot",
}


def rows(markdown: str, heading: str) -> list[list[str]]:
    """取某个二级标题下第一张表的正文行（去掉表头与分隔行）。"""
    start = markdown.index(heading)
    body = markdown[start:]
    # 到下一个二级标题为止。
    end = body.find("\n## ", 1)
    if end != -1:
        body = body[:end]
    lines = [line for line in body.splitlines() if line.startswith("|")]
    # 前两行是表头与 |---| 分隔行。
    return [[cell.strip() for cell in line.strip("|").split("|")] for line in lines[2:]]


def clean(value: str) -> str:
    """`-` 是空；括注（如「规范字形」）只是备注，不进可搜索的名字。"""
    value = re.sub(r"（[^）]*）$", "", value).strip()
    return "" if value in {"", "-"} else value


def rust_str(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def aliases(value: str) -> str:
    items = [item for item in (clean(part) for part in value.split("/")) if item]
    return "&[" + ", ".join(rust_str(item) for item in items) + "]"


def groups(value: str) -> str:
    items = [part.strip() for part in value.split(",") if clean(part.strip())]
    return "&[" + ", ".join(rust_str(item) for item in items) + "]"


def region(value: str) -> str:
    return REGIONS[value]


def granularity(value: str) -> str:
    return "Granularity::Group" if value.startswith("group") else "Granularity::Single"


def site_line(kind: str, cells: list[str]) -> str:
    if kind == "muscle":
        site_id, zh, en, latin, latin_aliases, group_ids, paired = cells
        fields = [
            f"id: {rust_str(site_id)}",
            f"zh: {rust_str(zh)}",
            f"en: {rust_str(en)}",
            f"latin: {rust_str(latin)}",
            f"latin_aliases: {aliases(latin_aliases)}",
            "kind: SiteKind::Muscle",
            f"groups: {groups(group_ids)}",
            "region: None",
            f"paired: {'true' if paired == 'yes' else 'false'}",
            "parent: None",
            "granularity: Granularity::Single",
        ]
    else:
        (
            site_id,
            zh,
            en,
            latin,
            latin_aliases,
            bone_region,
            paired,
            parent,
            grain,
        ) = cells
        parent_value = clean(parent)
        fields = [
            f"id: {rust_str(site_id)}",
            f"zh: {rust_str(zh)}",
            f"en: {rust_str(en)}",
            f"latin: {rust_str(latin)}",
            f"latin_aliases: {aliases(latin_aliases)}",
            "kind: SiteKind::Bone",
            "groups: &[]",
            f"region: Some(Region::{region(bone_region)})",
            f"paired: {'true' if paired == 'yes' else 'false'}",
            f"parent: {('Some(' + rust_str(parent_value) + ')') if parent_value else 'None'}",
            f"granularity: {granularity(grain)}",
        ]
    return "    Site {\n        " + ",\n        ".join(fields) + ",\n    },"


def group_line(cells: list[str]) -> str:
    group_id, zh, en, members = cells
    return (
        "    MuscleGroup {\n"
        f"        id: {rust_str(group_id)},\n"
        f"        zh: {rust_str(zh)},\n"
        f"        en: {rust_str(en)},\n"
        f"        members: {groups(members)},\n"
        "    },"
    )


def generate() -> str:
    markdown = SOURCE.read_text(encoding="utf-8")
    muscles = rows(markdown, "## 一、肌肉表")
    bones = rows(markdown, "## 二、骨骼表")
    group_rows = rows(markdown, "## 三、肌群表")

    sites = [site_line("muscle", cells) for cells in muscles]
    sites += [site_line("bone", cells) for cells in bones]
    groups = [group_line(cells) for cells in group_rows]

    return f'''//! 由 `scripts/gen-anatomy.py` 从 `.scratch/body-profile/anatomy-sites.md` 生成。
//!
//! 不要手改这个文件：改那份 markdown（人工真源，含审计报告），再重跑脚本；
//! `python3 scripts/gen-anatomy.py --check` 会在两边不一致时报错。
//!
//! 本文件是词表的内容；类型与规则在 `src/anatomy/mod.rs`。

use super::{{Granularity, MuscleGroup, Region, Site, SiteKind}};

/// 词表内容的版本：加一条、改一个名字都要 +1（Finding 引用部位 id，只加不删）。
pub const SCHEMA_VERSION: u32 = 1;

/// {len(sites)} 个可记录的部位：{len(muscles)} 块肌肉 + {len(bones)} 块（或集合）骨骼。
pub static SITES: &[Site] = &[
{chr(10).join(sites)}
];

/// {len(groups)} 个肌群：查询时聚合的视图，不是可记录的部位。
pub static GROUPS: &[MuscleGroup] = &[
{chr(10).join(groups)}
];
'''


def main() -> int:
    generated = generate()
    if "--check" in sys.argv[1:]:
        current = TARGET.read_text(encoding="utf-8") if TARGET.exists() else ""
        if current != generated:
            print(
                f"{TARGET.relative_to(ROOT)} 与 {SOURCE.relative_to(ROOT)} 不一致："
                "重跑 python3 scripts/gen-anatomy.py",
                file=sys.stderr,
            )
            return 1
        print("词表与 markdown 一致")
        return 0
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(generated, encoding="utf-8")
    print(f"写入 {TARGET.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
