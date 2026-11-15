//! 骨架期的「今日训练日」。
//!
//! 这一块是 #2 的竖切留下的替身：好让今日页有一份真数据（从 redb 读回来）。
//! 计划（含版本、频次规则、复查日）由 #12 生成、由 #13 展开成训练日，届时这张表
//! 会被换掉；在那之前它只是「一份能跑的示范计划」。

use redb::{Database, ReadableDatabase, ReadableTable, TableDefinition};

use super::{db_error, StoreError, META};

/// 动作：slug → `序号|动作名|依据|组数|次数`。计划本身的标量放在 `meta` 表里。
pub(crate) const EXERCISES: TableDefinition<&str, &str> = TableDefinition::new("exercises");

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

/// 今日训练日。
pub fn today_plan(store: &super::Store) -> Result<PlanRow, StoreError> {
    read_plan(store.db())
}

/// 一份能直接跑起来的示范计划。顺序有意义：蚌式开合在单腿臀桥之前。
const SEED: &[(&str, &str, &str, u32, u32)] = &[
    ("glute-bridge", "臀桥", "臀大肌 张力弱 · 左", 3, 10),
    ("clamshell", "蚌式开合", "臀中肌 左弱 · 还剩 1 组", 3, 10),
    ("dead-bug", "死虫式", "腹横肌 稳定性差", 3, 10),
    ("single-leg-glute-bridge", "单腿臀桥", "臀中肌 左弱 · 膝不要内扣", 2, 8),
];

pub(crate) fn seed(db: &Database) -> Result<(), StoreError> {
    let write = db.begin_write().map_err(db_error)?;
    {
        let mut meta = write.open_table(META).map_err(db_error)?;
        meta.insert("plan_title", "臀腿日").map_err(db_error)?;
        meta.insert("week_done", "0").map_err(db_error)?;
        meta.insert("week_total", "3").map_err(db_error)?;
        drop(meta);

        let mut exercises = write.open_table(EXERCISES).map_err(db_error)?;
        for (index, (slug, name, basis, sets, reps)) in SEED.iter().enumerate() {
            let value = format!("{}|{name}|{basis}|{sets}|{reps}", index + 1);
            exercises
                .insert(*slug, value.as_str())
                .map_err(db_error)?;
        }
    }
    write.commit().map_err(db_error)
}

fn read_plan(db: &Database) -> Result<PlanRow, StoreError> {
    let read = db.begin_read().map_err(db_error)?;
    let meta = read.open_table(META).map_err(db_error)?;
    let number = |key: &str| -> Result<u32, StoreError> {
        meta.get(key)
            .map_err(db_error)?
            .and_then(|value| value.value().parse().ok())
            .ok_or_else(|| StoreError::Db(format!("meta 缺 {key}")))
    };
    let title = meta
        .get("plan_title")
        .map_err(db_error)?
        .map(|value| value.value().to_owned())
        .unwrap_or_default();
    let plan = PlanRow {
        title,
        week_done: number("week_done")?,
        week_total: number("week_total")?,
        exercises: Vec::new(),
    };
    drop(meta);

    let table = read.open_table(EXERCISES).map_err(db_error)?;
    let mut exercises = Vec::new();
    for entry in table.iter().map_err(db_error)? {
        let (slug, value) = entry.map_err(db_error)?;
        let slug = slug.value().to_owned();
        let value = value.value().to_owned();
        let mut parts = value.split('|');
        let order = parts
            .next()
            .and_then(|order| order.parse().ok())
            .ok_or_else(|| StoreError::Db(format!("{slug} 缺序号，值格式对不上")))?;
        let name = parts.next().unwrap_or_default().to_owned();
        let basis = parts.next().unwrap_or_default().to_owned();
        let sets = parts.next().and_then(|sets| sets.parse().ok()).unwrap_or(0);
        let reps = parts.next().and_then(|reps| reps.parse().ok()).unwrap_or(0);
        exercises.push(ExerciseRow {
            slug,
            order,
            name,
            basis,
            sets,
            reps,
        });
    }
    // redb 按键给出行，清单的顺序在值里。
    exercises.sort_by_key(|row| row.order);

    Ok(PlanRow {
        exercises,
        ..plan
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::tests::TempStore;

    #[test]
    fn seeds_the_demo_day_in_plan_order() {
        let mut temp = TempStore::new("plan");
        let first = today_plan(temp.store()).expect("读第一次");
        assert_eq!(first.title, "臀腿日");
        let names: Vec<_> = first.exercises.iter().map(|row| row.name.as_str()).collect();
        assert_eq!(
            names,
            ["臀桥", "蚌式开合", "死虫式", "单腿臀桥"],
            "顺序按清单（蚌式开合在单腿臀桥之前）"
        );
        assert_eq!(first.exercises[0].sets, 3);
        assert_eq!(first.exercises[0].reps, 10);

        // 再打开一次：播种只发生一次，数据还在。
        let second = today_plan(&temp.reopen()).expect("读第二次");
        assert_eq!(first, second);
    }
}
