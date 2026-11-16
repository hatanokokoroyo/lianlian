//! 训练日（`GLOSSARY.md`「训练日」「日状态」，#13 / #14）。
//!
//! 计划里只有**频次规则**；具体哪几天练是展开出来的：`expand` 是纯函数，给定
//! 频次、锚点与区间，算出落在哪些日期。展开出来的 day 存的是动作**快照**
//! （名字、处方、来自哪条判定、部位），不是指向计划版本的引用——否则改计划会
//! 篡改历史（spec「计划与训练日」）。
//!
//! `Date` 是 1970-01-01 起的天数：自然日断界只看日历，不看时区。库里存
//! `YYYY-MM-DD` 字符串，界面把设备本地的今天传进来。

use serde::{Deserialize, Serialize};

use super::{DomainError, Exercise, FindingId, Frequency, Plan, PlanId, Side, Timestamp};

/// 一天多少毫秒（`Date` 与库里毫秒时间戳之间的换算）。
pub const DAY_MS: i64 = 86_400_000;

/// 一次展开往未来排多少天：一个复查周期（4 周）。
pub const HORIZON_DAYS: i64 = 28;

/// 一个日历日（1970-01-01 起的天数）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct Date(pub i64);

impl Date {
    /// `YYYY-MM-DD` → 日期；不存在的日子（2 月 31 日）也拒绝。
    pub fn from_iso(raw: &str) -> Option<Date> {
        let mut parts = raw.trim().split('-');
        let year: i64 = parts.next()?.parse().ok()?;
        let month: u32 = parts.next()?.parse().ok()?;
        let day: u32 = parts.next()?.parse().ok()?;
        if parts.next().is_some() || !(1..=12).contains(&month) || !(1..=31).contains(&day) {
            return None;
        }
        let date = Date(days_from_civil(year, month, day));
        // 回写一遍再比：`2026-02-31` 会被算成 3 月 3 日，这种输入不是日期。
        (date.iso() == raw.trim()).then_some(date)
    }

    /// 日期 → `YYYY-MM-DD`。
    pub fn iso(self) -> String {
        let (year, month, day) = civil_from_days(self.0);
        format!("{year:04}-{month:02}-{day:02}")
    }

    /// Unix 毫秒 → 那一天的日期（UTC 断界；界面传本地的今天进来）。
    pub fn from_ms(ms: i64) -> Date {
        Date(ms.div_euclid(DAY_MS))
    }

    /// 往后（负数是往前）n 天。
    pub fn add(self, days: i64) -> Date {
        Date(self.0 + days)
    }

    /// 周一 = 0 … 周日 = 6。1970-01-01 是周四。
    pub fn weekday(self) -> u8 {
        (self.0 + 3).rem_euclid(7) as u8
    }
}

/// 每周 N 次排在一周里的哪几天（周一 = 0）。
///
/// 1–4 次保证不连排；5–7 次时七天里塞不下 5 个互不相邻的日子（互不相邻的上限是
/// 4 个），只能连排——这是「每周 5 练」的算术事实，不是偷懒。
const WEEK_PATTERNS: [&[u8]; 7] = [
    &[0],
    &[0, 3],
    &[0, 2, 4],
    &[0, 2, 4, 6],
    &[0, 1, 3, 4, 6],
    &[0, 1, 2, 4, 5, 6],
    &[0, 1, 2, 3, 4, 5, 6],
];

/// 这一天要不要练。
///
/// `anchor` 是计划生效的那一天：它之前的日期不算训练日（计划不可能排到过去）。
pub fn is_training_day(frequency: Frequency, anchor: Date, date: Date) -> bool {
    if date < anchor {
        return false;
    }
    match frequency {
        Frequency::PerWeek(count) => WEEK_PATTERNS[usize::from(count - 1)].contains(&date.weekday()),
        Frequency::EveryNDays(count) => (date.0 - anchor.0).rem_euclid(i64::from(count)) == 0,
    }
}

/// 区间里（含两端）的训练日，按日期升序。
pub fn expand(frequency: Frequency, anchor: Date, from: Date, to: Date) -> Vec<Date> {
    let mut days = Vec::new();
    let mut date = from.max(anchor);
    while date <= to {
        if is_training_day(frequency, anchor, date) {
            days.push(date);
        }
        date = date.add(1);
    }
    days
}

/// 日状态：四种取值（`GLOSSARY.md`「日状态」）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DayState {
    /// 计划中：还没打卡，也还没过这一天。
    Planned,
    /// 已完成：全部动作勾完（打卡）。
    Completed,
    /// 已推迟：整天顺延到别的日期。
    Postponed,
    /// 未完成：过了自然日 00:00 还没打卡。
    Missed,
}

impl DayState {
    pub fn key(self) -> &'static str {
        match self {
            DayState::Planned => "planned",
            DayState::Completed => "completed",
            DayState::Postponed => "postponed",
            DayState::Missed => "missed",
        }
    }

    pub fn zh(self) -> &'static str {
        match self {
            DayState::Planned => "计划中",
            DayState::Completed => "已完成",
            DayState::Postponed => "已推迟",
            DayState::Missed => "未完成",
        }
    }

    /// 状态迁移（`design/contract.md` §6.4）。
    ///
    /// - 计划中 → 已完成（全部勾完）/ 已推迟（整天推迟）/ 未完成（跨天结算）；
    /// - 已完成 → 计划中（当天内取消勾选）；
    /// - 已推迟 → 未完成（顺延之后又过了那一天，由 #15 的跨天结算触发）。
    pub fn advance(self, event: DayEvent) -> DayState {
        match (self, event) {
            (DayState::Planned, DayEvent::CheckIn) => DayState::Completed,
            (DayState::Completed, DayEvent::Uncheck) => DayState::Planned,
            (DayState::Planned, DayEvent::Postpone) => DayState::Postponed,
            (DayState::Planned | DayState::Postponed, DayEvent::Settle) => DayState::Missed,
            (state, _) => state,
        }
    }
}

/// 会让日状态变一下的事件。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DayEvent {
    /// 全部动作勾完（打卡）。
    CheckIn,
    /// 取消勾选。
    Uncheck,
    /// 整天推迟。
    Postpone,
    /// 跨天结算。
    Settle,
}

/// 训练日里的一个动作：展开那一刻的样子（快照，不是计划版本的引用）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExerciseSnapshot {
    /// 动作名。
    pub name: String,
    /// 处方，展开时就已渲染好（「3×10」/「3×30 秒」）。
    pub prescription: String,
    /// 这个动作对应哪条判定。
    pub finding: FindingId,
    /// 部位 id。
    pub site: String,
    /// 侧别；中线结构是 `None`。
    pub side: Option<Side>,
}

impl ExerciseSnapshot {
    /// 从计划里的动作做快照；部位来自它挂的那条判定。
    pub fn of(exercise: &Exercise, site: String, side: Option<Side>) -> ExerciseSnapshot {
        ExerciseSnapshot {
            name: exercise.name.clone(),
            prescription: exercise.prescription(),
            finding: exercise.finding,
            site,
            side,
        }
    }
}

/// 一个训练日。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Day {
    /// 日期。
    pub date: Date,
    /// 日状态。
    pub state: DayState,
    /// 动作快照；改计划不会动它。
    pub exercises: Vec<ExerciseSnapshot>,
    /// 每个动作勾了没有（与 `exercises` 等长）。
    pub done: Vec<bool>,
    /// 这份快照来自哪一版计划。
    pub plan_id: PlanId,
    pub plan_version: u32,
    /// 展开时间，Unix 毫秒。
    pub at: Timestamp,
    /// 从哪一天改期过来的。原日期据此保持「休息日」，不会被重新展开出来。
    #[serde(default)]
    pub moved_from: Option<Date>,
}

impl Day {
    /// 按计划的动作快照造一天。
    pub fn from_plan(
        plan: &Plan,
        date: Date,
        exercises: Vec<ExerciseSnapshot>,
        at: Timestamp,
    ) -> Day {
        let done = vec![false; exercises.len()];
        Day {
            date,
            state: DayState::Planned,
            exercises,
            done,
            plan_id: plan.id,
            plan_version: plan.version,
            at,
            moved_from: None,
        }
    }

    /// 勾了几个。
    pub fn done_count(&self) -> usize {
        self.done.iter().filter(|done| **done).count()
    }

    /// 一共几个动作。
    pub fn total(&self) -> usize {
        self.exercises.len()
    }

    /// 全部勾完了吗（空的一天不算勾完）。
    pub fn all_done(&self) -> bool {
        !self.exercises.is_empty() && self.done.iter().all(|done| *done)
    }

    /// 勾 / 取消勾一个动作；日状态跟着走（全部勾完就是打卡）。
    pub fn toggle(&mut self, index: usize) -> Result<(), DomainError> {
        let Some(done) = self.done.get_mut(index) else {
            return Err(DomainError::UnknownExercise(index));
        };
        *done = !*done;
        let event = if self.all_done() {
            DayEvent::CheckIn
        } else {
            DayEvent::Uncheck
        };
        self.state = self.state.advance(event);
        Ok(())
    }

    /// 改到另一天；记住原来那天，免得它被重新展开成一个新的训练日。
    pub fn move_to(&mut self, date: Date) {
        self.moved_from = Some(self.moved_from.unwrap_or(self.date));
        self.date = date;
    }
}

/// Howard Hinnant 的 `civil_from_days`：1970-01-01 起的天数 → 年月日。
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };
    (year, m as u32, d as u32)
}

/// `civil_from_days` 的逆。
fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let m = month as i64;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + day as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{Plan, PlanDraft, RepsUnit};

    fn date(iso: &str) -> Date {
        Date::from_iso(iso).expect("日期")
    }

    /// 2026-11-16 是周一，方便读「每周 N 次」的排法。
    const MONDAY: &str = "2026-11-16";

    fn plan(frequency: Frequency, start: &str) -> Plan {
        Plan::new(
            PlanId(1),
            1,
            None,
            date(start).0 * DAY_MS,
            PlanDraft {
                frequency,
                exercises: vec![Exercise {
                    name: "臀桥".to_owned(),
                    sets: 3,
                    reps: 10,
                    unit: RepsUnit::Times,
                    finding: FindingId(7),
                }],
                review_at: None,
            },
        )
        .expect("造计划")
    }

    #[test]
    fn dates_round_trip_and_impossible_days_are_refused() {
        assert_eq!(date("1970-01-01").0, 0);
        assert_eq!(date("2026-11-16").iso(), "2026-11-16");
        assert_eq!(Date::from_iso("2026-11-16").expect("解析").weekday(), 0, "周一");
        assert_eq!(Date::from_iso("2026-11-22").expect("解析").weekday(), 6, "周日");
        assert_eq!(Date::from_iso("2026-02-31"), None, "2 月没有 31 号");
        assert_eq!(Date::from_iso("2026-13-01"), None);
        assert_eq!(Date::from_iso("2026-11-16T00:00"), None);
        assert_eq!(Date::from_ms(1_794_700_800_000).iso(), "2026-11-15");
    }

    #[test]
    fn three_times_a_week_lands_on_three_separated_days_each_week() {
        let anchor = date(MONDAY);
        let days = expand(Frequency::PerWeek(3), anchor, anchor, anchor.add(13));
        let dates: Vec<String> = days.iter().map(|day| day.iso()).collect();
        assert_eq!(
            dates,
            vec![
                "2026-11-16", // 一
                "2026-11-18", // 三
                "2026-11-20", // 五
                "2026-11-23",
                "2026-11-25",
                "2026-11-27",
            ]
        );
        // 相邻两天不连排。
        for pair in days.windows(2) {
            assert!(pair[1].0 - pair[0].0 > 1, "连排了：{}", pair[0].iso());
        }
    }

    #[test]
    fn weekly_patterns_are_table_driven_and_never_adjacent_up_to_four() {
        let anchor = date(MONDAY);
        for count in 1..=4u8 {
            let week: Vec<u8> = expand(
                Frequency::PerWeek(count),
                anchor,
                anchor,
                anchor.add(6),
            )
            .iter()
            .map(|day| day.weekday())
            .collect();
            assert_eq!(week.len(), usize::from(count));
            for pair in week.windows(2) {
                assert!(
                    pair[1] - pair[0] > 1,
                    "每周 {count} 次连排了：{week:?}"
                );
            }
        }
        // 每周 7 次就是每天。
        assert_eq!(
            expand(Frequency::PerWeek(7), anchor, anchor, anchor.add(6)).len(),
            7
        );
    }

    #[test]
    fn every_n_days_walks_from_the_anchor() {
        let anchor = date(MONDAY);
        let days = expand(Frequency::EveryNDays(3), anchor, anchor, anchor.add(9));
        assert_eq!(
            days.iter().map(|day| day.iso()).collect::<Vec<_>>(),
            vec!["2026-11-16", "2026-11-19", "2026-11-22", "2026-11-25"]
        );
        // 从区间中间开始时，仍然落在锚点算出来的节奏上。
        let later = expand(Frequency::EveryNDays(3), anchor, anchor.add(4), anchor.add(9));
        assert_eq!(
            later.iter().map(|day| day.iso()).collect::<Vec<_>>(),
            vec!["2026-11-22", "2026-11-25"]
        );
        // 计划生效之前的日期不是训练日。
        assert!(expand(Frequency::EveryNDays(2), anchor, anchor.add(-3), anchor.add(-1)).is_empty());
    }

    #[test]
    fn checking_every_exercise_is_a_checkin_and_unchecking_goes_back_to_planned() {
        let planned = plan(Frequency::PerWeek(3), "2026-11-16");
        let mut day = Day::from_plan(&planned, date("2026-11-16"), Vec::new(), 0);
        assert_eq!(day.state, DayState::Planned);

        // 空的一天不算勾完：拿它验状态机（勾选入口只在有动作时可用）。
        day.exercises = vec![
            ExerciseSnapshot {
                name: "臀桥".to_owned(),
                prescription: "3×10".to_owned(),
                finding: FindingId(7),
                site: "gluteus-medius".to_owned(),
                side: Some(Side::Left),
            },
            ExerciseSnapshot {
                name: "死虫式".to_owned(),
                prescription: "3×10".to_owned(),
                finding: FindingId(7),
                site: "rectus-abdominis".to_owned(),
                side: None,
            },
        ];
        day.done = vec![false, false];
        assert!(!day.all_done());

        day.toggle(0).expect("勾第一个");
        assert_eq!(day.state, DayState::Planned, "部分完成仍是计划中");
        assert_eq!(day.done_count(), 1);

        day.toggle(1).expect("勾第二个");
        assert_eq!(day.state, DayState::Completed, "全部勾完就是打卡");
        assert_eq!(day.done_count(), 2);

        day.toggle(1).expect("取消勾选");
        assert_eq!(day.state, DayState::Planned, "当天内可以退回计划中");

        assert_eq!(
            day.toggle(9),
            Err(DomainError::UnknownExercise(9)),
            "越界的动作编号要说清楚"
        );
    }

    #[test]
    fn a_moved_day_remembers_where_it_came_from() {
        let planned = plan(Frequency::PerWeek(3), "2026-11-16");
        let mut day = Day::from_plan(&planned, date("2026-11-16"), Vec::new(), 0);
        day.move_to(date("2026-11-17"));
        assert_eq!(day.date.iso(), "2026-11-17");
        assert_eq!(day.moved_from.map(Date::iso), Some("2026-11-16".to_owned()));
        // 连改两次仍然记着最早那天。
        day.move_to(date("2026-11-18"));
        assert_eq!(day.moved_from.map(Date::iso), Some("2026-11-16".to_owned()));
    }

    #[test]
    fn the_day_states_advance_as_the_contract_says() {
        assert_eq!(
            DayState::Planned.advance(DayEvent::CheckIn),
            DayState::Completed
        );
        assert_eq!(
            DayState::Completed.advance(DayEvent::Uncheck),
            DayState::Planned
        );
        assert_eq!(
            DayState::Planned.advance(DayEvent::Postpone),
            DayState::Postponed
        );
        assert_eq!(
            DayState::Planned.advance(DayEvent::Settle),
            DayState::Missed
        );
        assert_eq!(
            DayState::Postponed.advance(DayEvent::Settle),
            DayState::Missed
        );
        // 已完成之后跨天不再改判：账已经结过了。
        assert_eq!(
            DayState::Completed.advance(DayEvent::Settle),
            DayState::Completed
        );
    }
}
