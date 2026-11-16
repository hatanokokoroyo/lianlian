//! 训练日的存储（#13）：按日期一行，值是 `Day` 的 JSON（含动作**快照**）。
//!
//! 展开只补缺失的日期，已有的一律不动——这是「改计划不得篡改历史」的落点：
//! 已展开的日子留着当时的快照，新版本只影响之后新展开的天。改期是把那一行
//! 挪到新日期，并记住原来的日期（`moved_from`），否则下一次展开会把它又排回来。

use std::collections::BTreeSet;

use redb::{ReadableDatabase, ReadableTable, TableDefinition};

use super::{db_error, Store, StoreError};
use crate::domain::day::{expand, Date, Day, ExerciseSnapshot};
use crate::domain::{DomainError, Timestamp};

/// 训练日：`YYYY-MM-DD` → Day 的 JSON。
pub(crate) const DAYS: TableDefinition<&str, &str> = TableDefinition::new("days");

impl Store {
    /// 某一天的训练；休息日是 `None`。
    pub fn day(&self, date: Date) -> Result<Option<Day>, StoreError> {
        let read = self.db().begin_read().map_err(db_error)?;
        let table = read.open_table(DAYS).map_err(db_error)?;
        let json = table
            .get(date.iso().as_str())
            .map_err(db_error)?
            .map(|value| value.value().to_owned());
        json.map(|json| from_json(&json)).transpose()
    }

    /// 全部训练日，按日期升序。
    pub fn days(&self) -> Result<Vec<Day>, StoreError> {
        let read = self.db().begin_read().map_err(db_error)?;
        let table = read.open_table(DAYS).map_err(db_error)?;
        let mut days: Vec<Day> = Vec::new();
        for entry in table.iter().map_err(db_error)? {
            let (_, value) = entry.map_err(db_error)?;
            days.push(from_json(value.value())?);
        }
        days.sort_by_key(|day| day.date);
        Ok(days)
    }

    /// 区间里（含两端）的训练日；休息日不出现。
    pub fn days_between(&self, from: Date, to: Date) -> Result<Vec<Day>, StoreError> {
        Ok(self
            .days()?
            .into_iter()
            .filter(|day| day.date >= from && day.date <= to)
            .collect())
    }

    /// 从 `today` 起把生效计划展开到 `horizon` 天。
    ///
    /// 只插缺失的日期：已经有的一律不动（快照留在展开那一刻）；被改期搬走的
    /// 原日期也不再补回来。没有生效计划时什么都不做。
    pub fn ensure_days(
        &self,
        today: Date,
        horizon: i64,
        at: Timestamp,
    ) -> Result<Vec<Day>, StoreError> {
        let Some(plan) = self.active_plan()? else {
            return Ok(Vec::new());
        };
        let to = today.add(horizon - 1);
        let existing = self.days()?;
        let taken: BTreeSet<Date> = existing.iter().map(|day| day.date).collect();
        let moved_away: BTreeSet<Date> = existing
            .iter()
            .filter_map(|day| day.moved_from)
            .collect();

        // 快照要带部位：计划的动作只挂判定编号，部位在判定上。
        let mut snapshots = Vec::with_capacity(plan.exercises.len());
        for exercise in &plan.exercises {
            let finding = self
                .finding(exercise.finding)?
                .ok_or(DomainError::UnknownFinding(exercise.finding))?;
            snapshots.push(ExerciseSnapshot::of(exercise, finding.site, finding.side));
        }

        let anchor = Date::from_ms(plan.at);
        let missing: Vec<Day> = expand(plan.frequency, anchor, today, to)
            .into_iter()
            .filter(|date| !taken.contains(date) && !moved_away.contains(date))
            .map(|date| Day::from_plan(&plan, date, snapshots.clone(), at))
            .collect();
        if missing.is_empty() {
            return Ok(Vec::new());
        }

        let write = self.db().begin_write().map_err(db_error)?;
        {
            let mut table = write.open_table(DAYS).map_err(db_error)?;
            for day in &missing {
                table
                    .insert(day.date.iso().as_str(), to_json(day)?.as_str())
                    .map_err(db_error)?;
            }
        }
        write.commit().map_err(db_error)?;
        Ok(missing)
    }

    /// 勾 / 取消勾某一天的一个动作；返回勾完之后的这一天。
    pub fn toggle_exercise(&self, date: Date, index: usize) -> Result<Day, StoreError> {
        let mut day = self
            .day(date)?
            .ok_or_else(|| DomainError::UnknownDay(date.iso()))?;
        day.toggle(index)?;
        self.save_day(&day)?;
        Ok(day)
    }

    /// 把某一天整体改到另一天；原来那天回到休息日。
    pub fn reschedule(&self, from: Date, to: Date) -> Result<Day, StoreError> {
        let mut day = self
            .day(from)?
            .ok_or_else(|| DomainError::UnknownDay(from.iso()))?;
        if from == to {
            return Ok(day);
        }
        if self.day(to)?.is_some() {
            return Err(StoreError::Domain(DomainError::DayTaken(to.iso())));
        }
        day.move_to(to);

        let write = self.db().begin_write().map_err(db_error)?;
        {
            let mut table = write.open_table(DAYS).map_err(db_error)?;
            table
                .remove(from.iso().as_str())
                .map_err(db_error)?;
            table
                .insert(to.iso().as_str(), to_json(&day)?.as_str())
                .map_err(db_error)?;
        }
        write.commit().map_err(db_error)?;
        Ok(day)
    }

    /// 往后（不含 `after`）最近的一个训练日。
    pub fn next_day(&self, after: Date) -> Result<Option<Day>, StoreError> {
        Ok(self.days()?.into_iter().find(|day| day.date > after))
    }

    fn save_day(&self, day: &Day) -> Result<(), StoreError> {
        let write = self.db().begin_write().map_err(db_error)?;
        {
            let mut table = write.open_table(DAYS).map_err(db_error)?;
            table
                .insert(day.date.iso().as_str(), to_json(day)?.as_str())
                .map_err(db_error)?;
        }
        write.commit().map_err(db_error)
    }
}

fn to_json<T: serde::Serialize>(value: &T) -> Result<String, StoreError> {
    serde_json::to_string(value).map_err(|error| StoreError::Db(format!("写库序列化失败：{error}")))
}

fn from_json<T: serde::de::DeserializeOwned>(json: &str) -> Result<T, StoreError> {
    serde_json::from_str(json).map_err(|error| StoreError::Db(format!("读库反序列化失败：{error}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{
        AxisValue, Exercise, FindingDraft, Frequency, PlanDraft, Place, RepsUnit, Side,
        Tension, TrainingContext,
    };
    use crate::store::tests::TempStore;

    const AT: Timestamp = 1_794_700_800_000;

    fn date(iso: &str) -> Date {
        Date::from_iso(iso).expect("日期")
    }

    /// 训练条件齐、库里有一条判定；返回（临时库，判定）。
    fn ready_store(name: &str) -> (TempStore, crate::domain::Finding) {
        let temp = TempStore::new(name);
        temp.store()
            .save_training(&TrainingContext {
                days_per_week: Some(3),
                minutes_per_session: Some(30),
                places: vec![Place::Home],
                equipment: vec!["band".to_owned()],
            })
            .expect("训练条件");
        let finding = temp
            .store()
            .record(FindingDraft {
                site: "gluteus-medius".to_owned(),
                side: Some(Side::Left),
                values: {
                    let mut values = crate::domain::AxisValues::new();
                    values.set(AxisValue::Tension(Tension::Weak));
                    values
                },
                confidence: 70,
                at: AT,
            })
            .expect("写一条判定");
        (temp, finding)
    }

    fn draft(frequency: Frequency, finding: crate::domain::FindingId) -> PlanDraft {
        PlanDraft {
            frequency,
            exercises: vec![Exercise {
                name: "臀桥".to_owned(),
                sets: 3,
                reps: 10,
                unit: RepsUnit::Times,
                finding,
            }],
            review_at: None,
        }
    }

    #[test]
    fn expansion_fills_only_the_planned_days_and_keeps_them_after_reopening() {
        let (mut temp, finding) = ready_store("days-expand");
        temp.store()
            .create_plan(
                None,
                date("2026-11-16").0 * crate::domain::day::DAY_MS,
                draft(Frequency::PerWeek(2), finding.id),
            )
            .expect("排计划");

        let created = temp
            .store()
            .ensure_days(date("2026-11-16"), 14, AT)
            .expect("展开");
        assert_eq!(
            created.iter().map(|day| day.date.iso()).collect::<Vec<_>>(),
            vec![
                "2026-11-16",
                "2026-11-19",
                "2026-11-23",
                "2026-11-26"
            ],
            "每周两次：周一、周四"
        );
        // 再展开一次：不重复插。
        assert!(temp
            .store()
            .ensure_days(date("2026-11-16"), 14, AT)
            .expect("再展开")
            .is_empty());

        let reopened = temp.reopen();
        let days = reopened.days().expect("读训练日");
        assert_eq!(days.len(), 4);
        assert_eq!(days[0].exercises[0].name, "臀桥");
        assert_eq!(days[0].exercises[0].site, "gluteus-medius");
        assert_eq!(days[0].state, crate::domain::DayState::Planned);
    }

    #[test]
    fn a_new_plan_version_does_not_rewrite_days_that_already_exist() {
        let (temp, finding) = ready_store("days-snapshot");
        let start = date("2026-11-16").0 * crate::domain::day::DAY_MS;
        temp.store()
            .create_plan(None, start, draft(Frequency::PerWeek(2), finding.id))
            .expect("第一版");
        temp.store()
            .ensure_days(date("2026-11-16"), 7, AT)
            .expect("展开第一版");

        let old = temp.store().day(date("2026-11-16")).expect("读").expect("有");
        assert_eq!(old.plan_version, 1);
        assert_eq!(old.exercises[0].name, "臀桥");

        // 第二版换动作与频次：已存在的快照不动，新展开的日子用第二版。
        let mut second = draft(Frequency::PerWeek(2), finding.id);
        second.exercises[0].name = "单腿臀桥".to_owned();
        temp.store()
            .create_plan(None, start, second)
            .expect("第二版");

        let newly = temp
            .store()
            .ensure_days(date("2026-11-23"), 7, AT)
            .expect("展开第二版");
        assert!(!newly.is_empty());
        assert_eq!(newly[0].exercises[0].name, "单腿臀桥");
        assert_eq!(newly[0].plan_version, 2);

        let unchanged = temp.store().day(date("2026-11-16")).expect("读").expect("有");
        assert_eq!(unchanged, old, "旧快照一个字都不变");
    }

    #[test]
    fn rescheduling_moves_the_day_and_frees_the_old_date_for_good() {
        let (temp, finding) = ready_store("days-reschedule");
        temp.store()
            .create_plan(
                None,
                date("2026-11-16").0 * crate::domain::day::DAY_MS,
                draft(Frequency::PerWeek(3), finding.id),
            )
            .expect("排计划");
        temp.store()
            .ensure_days(date("2026-11-16"), 7, AT)
            .expect("展开");

        let moved = temp
            .store()
            .reschedule(date("2026-11-16"), date("2026-11-17"))
            .expect("改期");
        assert_eq!(moved.date.iso(), "2026-11-17");
        assert!(temp.store().day(date("2026-11-16")).expect("读").is_none(), "原日成了休息日");
        assert!(temp.store().day(date("2026-11-17")).expect("读").is_some());

        // 再展开也不会把周一补回来（它被搬走了，不是漏了）。
        temp.store()
            .ensure_days(date("2026-11-16"), 7, AT)
            .expect("再展开");
        assert!(temp.store().day(date("2026-11-16")).expect("读").is_none());

        // 目标日已经有训练时拒绝。
        let taken = temp
            .store()
            .reschedule(date("2026-11-18"), date("2026-11-17"))
            .unwrap_err();
        assert_eq!(
            taken,
            StoreError::Domain(DomainError::DayTaken("2026-11-17".to_owned()))
        );
    }

    #[test]
    fn checking_an_exercise_survives_reopening_and_unknown_days_are_refused() {
        let (mut temp, finding) = ready_store("days-check");
        temp.store()
            .create_plan(
                None,
                date("2026-11-16").0 * crate::domain::day::DAY_MS,
                draft(Frequency::PerWeek(3), finding.id),
            )
            .expect("排计划");
        temp.store()
            .ensure_days(date("2026-11-16"), 7, AT)
            .expect("展开");

        let day = temp
            .store()
            .toggle_exercise(date("2026-11-16"), 0)
            .expect("勾上");
        assert_eq!(day.done_count(), 1);
        assert_eq!(day.state, crate::domain::DayState::Completed);

        let reopened = temp.reopen();
        let again = reopened.day(date("2026-11-16")).expect("读").expect("有");
        assert!(again.done[0], "勾选落盘了");

        // 2026-11-17 是周二：休息日，没有可勾的。
        let missing = reopened
            .toggle_exercise(date("2026-11-17"), 0)
            .unwrap_err();
        assert_eq!(
            missing,
            StoreError::Domain(DomainError::UnknownDay("2026-11-17".to_owned()))
        );
    }

    #[test]
    fn the_next_training_day_skips_rest_days() {
        let (temp, finding) = ready_store("days-next");
        temp.store()
            .create_plan(
                None,
                date("2026-11-16").0 * crate::domain::day::DAY_MS,
                draft(Frequency::PerWeek(3), finding.id),
            )
            .expect("排计划");
        temp.store()
            .ensure_days(date("2026-11-16"), 14, AT)
            .expect("展开");

        let next = temp
            .store()
            .next_day(date("2026-11-16"))
            .expect("读")
            .expect("有");
        assert_eq!(next.date.iso(), "2026-11-18");
        assert!(temp
            .store()
            .next_day(date("2026-11-30"))
            .expect("读")
            .is_none());
    }
}
