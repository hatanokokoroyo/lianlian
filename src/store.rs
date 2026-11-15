//! 本地库：一个 redb 单文件，放在 app 私有目录里。
//!
//! 这一层只认字节和表，不认识界面；`api` 把它读出来的东西整理成 TSX 看得懂的形状。
//! 建表与 schema 版本（`meta` 里的 `schema_version`）在后面的工单里扩，这里先只有
//! 今天就够把「第三方纯 Rust 依赖能在手机上编译并读写」这件事钉死。

use std::path::{Path, PathBuf};

use nsh_core::prelude::data_dir;
use redb::{Database, ReadableDatabase, ReadableTable, TableDefinition};

/// 值格式的版本：`序号|动作名|依据|组数|次数` 是 `"2"`。
const SCHEMA_VERSION: &str = "2";

/// 计划本身的几个标量：`schema_version`、`plan_title`、`week_done`、`week_total`。
const META: TableDefinition<&str, &str> = TableDefinition::new("meta");
/// 动作：slug → `序号|动作名|依据|组数|次数`（序号定清单顺序，键只用来查）。
const EXERCISES: TableDefinition<&str, &str> = TableDefinition::new("exercises");

/// 库里的一条动作。
#[derive(Debug, Clone, PartialEq)]
pub struct ExerciseRow {
    pub slug: String,
    /// 在清单里的位置，从 1 开始。
    pub order: u32,
    pub name: String,
    pub basis: String,
    pub sets: u32,
    pub reps: u32,
}

/// 库里的一个训练日（`exercises` 按清单顺序给出）。
#[derive(Debug, Clone, PartialEq)]
pub struct PlanRow {
    pub title: String,
    pub week_done: u32,
    pub week_total: u32,
    pub exercises: Vec<ExerciseRow>,
}

/// 今日训练日，`exercises` 为空时说明库里没有计划。
pub fn today_plan() -> Result<PlanRow, String> {
    read_plan(&open_app_db()?)
}

/// 库文件路径：app 私有目录里的 `lianlian.redb`。
///
/// 宿主不提供文件目录时（网页宿主、`nsh test` 的 headless 引擎）落到系统临时目录，
/// 这样库的行为在测试里是真的；真机上永远走 app 私有目录。
fn app_db_path() -> Result<PathBuf, String> {
    let dir = data_dir().unwrap_or_else(|| std::env::temp_dir().join("lianlian"));
    std::fs::create_dir_all(&dir).map_err(|e| format!("建库目录失败：{e}"))?;
    Ok(dir.join("lianlian.redb"))
}

fn open_app_db() -> Result<Database, String> {
    open(&app_db_path()?)
}

/// 打开一个库文件：全新的播种，格式对不上的重建。
fn open(path: &Path) -> Result<Database, String> {
    let db = Database::create(path).map_err(|e| format!("打开库失败：{e}"))?;
    match read_schema_version(&db)?.as_deref() {
        Some(version) if version == SCHEMA_VERSION => Ok(db),
        // 骨架期没有迁移：值格式变过就重建（真数据迁移随 #3 的词表一起来）。
        Some(_) => {
            reset(&db)?;
            seed(&db)?;
            Ok(db)
        }
        None => {
            seed(&db)?;
            Ok(db)
        }
    }
}

fn read_schema_version(db: &Database) -> Result<Option<String>, String> {
    let read = db.begin_read().map_err(|e| e.to_string())?;
    match read.open_table(META) {
        Ok(table) => Ok(table
            .get("schema_version")
            .map_err(|e| e.to_string())?
            .map(|value| value.value().to_owned())),
        Err(redb::TableError::TableDoesNotExist(_)) => Ok(None),
        Err(e) => Err(format!("读 meta 失败：{e}")),
    }
}

/// 丢掉两张表，让下一次播种从头来。
fn reset(db: &Database) -> Result<(), String> {
    let write = db.begin_write().map_err(|e| e.to_string())?;
    match write.delete_table(EXERCISES) {
        Ok(_) => {}
        Err(redb::TableError::TableDoesNotExist(_)) => {}
        Err(e) => return Err(format!("删动作表失败：{e}")),
    }
    match write.delete_table(META) {
        Ok(_) => {}
        Err(redb::TableError::TableDoesNotExist(_)) => {}
        Err(e) => return Err(format!("删 meta 失败：{e}")),
    }
    write.commit().map_err(|e| e.to_string())
}

/// 一份能直接跑起来的示范计划（骨架期用；计划生成在 #12 之后接管）。
/// 顺序有意义：蚌式开合在单腿臀桥之前。
const SEED: &[(&str, &str, &str, u32, u32)] = &[
    ("glute-bridge", "臀桥", "臀大肌 张力弱 · 左", 3, 10),
    ("clamshell", "蚌式开合", "臀中肌 左弱 · 还剩 1 组", 3, 10),
    ("dead-bug", "死虫式", "腹横肌 稳定性差", 3, 10),
    ("single-leg-glute-bridge", "单腿臀桥", "臀中肌 左弱 · 膝不要内扣", 2, 8),
];

fn seed(db: &Database) -> Result<(), String> {
    let write = db.begin_write().map_err(|e| e.to_string())?;
    {
        let mut meta = write.open_table(META).map_err(|e| e.to_string())?;
        meta.insert("schema_version", SCHEMA_VERSION)
            .map_err(|e| e.to_string())?;
        meta.insert("plan_title", "臀腿日").map_err(|e| e.to_string())?;
        meta.insert("week_done", "0").map_err(|e| e.to_string())?;
        meta.insert("week_total", "3").map_err(|e| e.to_string())?;
        drop(meta);

        let mut exercises = write.open_table(EXERCISES).map_err(|e| e.to_string())?;
        for (index, (slug, name, basis, sets, reps)) in SEED.iter().enumerate() {
            let order = index + 1;
            let value = format!("{order}|{name}|{basis}|{sets}|{reps}");
            exercises
                .insert(*slug, value.as_str())
                .map_err(|e| e.to_string())?;
        }
    }
    write.commit().map_err(|e| e.to_string())?;
    Ok(())
}

fn read_plan(db: &Database) -> Result<PlanRow, String> {
    let read = db.begin_read().map_err(|e| e.to_string())?;
    let meta = read
        .open_table(META)
        .map_err(|e| format!("读 meta 失败：{e}"))?;
    let number = |key: &str| -> Result<u32, String> {
        meta.get(key)
            .map_err(|e| e.to_string())?
            .and_then(|v| v.value().parse().ok())
            .ok_or_else(|| format!("meta 缺 {key}"))
    };
    let title = meta
        .get("plan_title")
        .map_err(|e| e.to_string())?
        .map(|v| v.value().to_owned())
        .unwrap_or_default();
    let plan = PlanRow {
        title,
        week_done: number("week_done")?,
        week_total: number("week_total")?,
        exercises: vec![],
    };
    drop(meta);

    let table = read
        .open_table(EXERCISES)
        .map_err(|e| format!("读动作表失败：{e}"))?;
    let mut exercises = Vec::new();
    for entry in table.iter().map_err(|e| e.to_string())? {
        let (slug, value) = entry.map_err(|e| e.to_string())?;
        let slug = slug.value().to_owned();
        let value = value.value().to_owned();
        let mut parts = value.split('|');
        let order = parts
            .next()
            .and_then(|n| n.parse().ok())
            .ok_or_else(|| format!("{slug} 缺序号，值格式对不上"))?;
        let name = parts.next().unwrap_or_default().to_owned();
        let basis = parts.next().unwrap_or_default().to_owned();
        let sets = parts.next().and_then(|n| n.parse().ok()).unwrap_or(0);
        let reps = parts.next().and_then(|n| n.parse().ok()).unwrap_or(0);
        exercises.push(ExerciseRow {
            slug,
            order,
            name,
            basis,
            sets,
            reps,
        });
    }
    // redb 按键给，清单的顺序在值里。
    exercises.sort_by_key(|row| row.order);
    Ok(PlanRow {
        exercises,
        ..plan
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 写进一个临时库文件再读回来：动作不丢、顺序按 slug。
    #[test]
    fn seeds_and_reads_back() {
        let dir = std::env::temp_dir().join(format!("lianlian-store-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("建临时目录");
        let path = dir.join("lianlian.redb");

        let mut first = read_plan(&open(&path).expect("打开新库")).expect("读第一次");
        assert_eq!(first.title, "臀腿日");
        let names: Vec<_> = first.exercises.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(
            names,
            ["臀桥", "蚌式开合", "死虫式", "单腿臀桥"],
            "四条动作都在，顺序按清单（蚌式开合在单腿臀桥之前）"
        );
        assert_eq!(first.exercises[0].sets, 3);
        assert_eq!(first.exercises[0].reps, 10);

        // 再打开一次：播种只发生一次，数据还在（顺序也一样）。
        let second = read_plan(&open(&path).expect("再打开")).expect("读第二次");
        assert_eq!(first, second);

        std::fs::remove_dir_all(&dir).ok();
    }
}
