//! 计划（`GLOSSARY.md`「计划」「复查日」「动作」，#12）。
//!
//! 计划是**版本化**的：同一时刻只有一个生效计划，agent 调整 = 新增一个版本，
//! 旧版本留在库里只读可查（`spec`「计划与训练日」）。一份计划包含三样东西：
//! 频次规则（每周几次 / 每几天一次）、动作清单（每个动作挂一条判定）、复查日
//! （默认四周）。
//!
//! 这里全是纯函数：频次取值、动作的取值范围、复查日的默认值都在这层校验；
//! 「训练条件齐不齐」也在这层判——它是计划的前提（`training::readiness`），
//! 不齐的时候下游必须先追问，不许编一份做不了的方案（spec User Story 6）。

use serde::{Deserialize, Serialize};

use super::tool::DAY_MS;
use super::{ConversationId, DomainError, FindingId, Timestamp, TrainingContext};

/// 复查日默认几周后。
pub const DEFAULT_REVIEW_WEEKS: u8 = 4;
/// 复查日最多给到几周后（再长就等于没有复查）。
pub const MAX_REVIEW_WEEKS: u8 = 12;
/// 一份计划最多几个动作：今日页一屏要能勾完。
pub const MAX_EXERCISES: usize = 12;
/// 每个动作最多几组。
pub const MAX_SETS: u8 = 12;
/// 每个动作最多多少次 / 多少秒。
pub const MAX_REPS: u16 = 999;

/// 计划编号：存储层分配的单调递增整数。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct PlanId(pub u64);

/// 频次规则：由 app 展开成日历上的具体训练日（`#13` 的 `day::expand`）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case", tag = "unit", content = "count")]
pub enum Frequency {
    /// 每周 N 次（1–7）。
    PerWeek(u8),
    /// 每 N 天一次（2–7）。「每 2 天一次」就是隔一天练一次。
    EveryNDays(u8),
}

impl Frequency {
    /// 合法区间：每周 1–7 次；每 2–7 天一次（每 1 天一次就是每天，用 `PerWeek(7)` 表达）。
    pub fn validate(self) -> Result<(), DomainError> {
        match self {
            Frequency::PerWeek(count) => {
                if (1..=7).contains(&count) {
                    Ok(())
                } else {
                    Err(DomainError::OutOfRange {
                        field: "每周训练天数",
                        min: 1.0,
                        max: 7.0,
                        value: count as f64,
                    })
                }
            }
            Frequency::EveryNDays(count) => {
                if (2..=7).contains(&count) {
                    Ok(())
                } else {
                    Err(DomainError::OutOfRange {
                        field: "每几天训练一次",
                        min: 2.0,
                        max: 7.0,
                        value: count as f64,
                    })
                }
            }
        }
    }

    /// 从工具参数的两段（`unit` / `count`）解析。
    pub fn from_parts(unit: &str, count: u64) -> Result<Frequency, DomainError> {
        let count = u8::try_from(count).map_err(|_| DomainError::OutOfRange {
            field: "频次",
            min: 1.0,
            max: 7.0,
            value: count as f64,
        })?;
        let frequency = match unit.trim() {
            "per-week" | "每周" => Frequency::PerWeek(count),
            "every-n-days" | "每几天" => Frequency::EveryNDays(count),
            other => return Err(DomainError::UnknownFrequency(other.to_owned())),
        };
        frequency.validate()?;
        Ok(frequency)
    }

    /// 机器可读的键，进工具结果与状态块。
    pub fn key(self) -> &'static str {
        match self {
            Frequency::PerWeek(_) => "per-week",
            Frequency::EveryNDays(_) => "every-n-days",
        }
    }

    /// 给用户与模型看的说法：「每周 3 次」/「每 2 天一次」。
    pub fn zh(self) -> String {
        match self {
            Frequency::PerWeek(count) => format!("每周 {count} 次"),
            Frequency::EveryNDays(count) => format!("每 {count} 天一次"),
        }
    }
}

/// 一个动作按次数做还是按时间做。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RepsUnit {
    /// 次。
    Times,
    /// 秒。
    Seconds,
}

impl RepsUnit {
    pub fn key(self) -> &'static str {
        match self {
            RepsUnit::Times => "times",
            RepsUnit::Seconds => "seconds",
        }
    }

    pub fn from_key(raw: &str) -> Option<RepsUnit> {
        match raw.trim() {
            "times" | "次" => Some(RepsUnit::Times),
            "seconds" | "秒" => Some(RepsUnit::Seconds),
            _ => None,
        }
    }
}

/// 动作：计划里最小的可勾选单元（「臀桥 3×10」）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Exercise {
    /// 名字，用户看得懂的中文。
    pub name: String,
    /// 几组。
    pub sets: u8,
    /// 每组多少次 / 多少秒。
    pub reps: u16,
    /// 次还是秒。
    pub unit: RepsUnit,
    /// 这个动作对应的档案条目：动作后面要能点回它的理由。
    pub finding: FindingId,
}

impl Exercise {
    /// 取值范围校验（频次与条数在 `PlanDraft::validate` 里）。
    pub fn validate(&self) -> Result<(), DomainError> {
        if self.name.trim().is_empty() {
            return Err(DomainError::EmptyExercise);
        }
        if !(1..=MAX_SETS).contains(&self.sets) {
            return Err(DomainError::OutOfRange {
                field: "组数",
                min: 1.0,
                max: MAX_SETS as f64,
                value: self.sets as f64,
            });
        }
        if !(1..=MAX_REPS).contains(&self.reps) {
            return Err(DomainError::OutOfRange {
                field: "每组次数",
                min: 1.0,
                max: MAX_REPS as f64,
                value: self.reps as f64,
            });
        }
        Ok(())
    }

    /// 显示用的处方：「3×10」/「3×30 秒」。
    pub fn prescription(&self) -> String {
        match self.unit {
            RepsUnit::Times => format!("{}×{}", self.sets, self.reps),
            RepsUnit::Seconds => format!("{}×{} 秒", self.sets, self.reps),
        }
    }
}

/// 待落库的计划：编号与版本由存储层分配。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlanDraft {
    pub frequency: Frequency,
    pub exercises: Vec<Exercise>,
    /// 复查日；`None` 时用默认四周。
    pub review_at: Option<Timestamp>,
}

impl PlanDraft {
    /// 落库前校验：频次、动作条数与每个动作的取值范围。
    pub fn validate(&self) -> Result<(), DomainError> {
        self.frequency.validate()?;
        if self.exercises.is_empty() {
            return Err(DomainError::EmptyPlan);
        }
        if self.exercises.len() > MAX_EXERCISES {
            return Err(DomainError::TooManyExercises {
                count: self.exercises.len(),
                max: MAX_EXERCISES,
            });
        }
        for exercise in &self.exercises {
            exercise.validate()?;
        }
        Ok(())
    }

    /// 复查日：给了就用给的，没给就是四周后。
    pub fn review_at(&self, at: Timestamp) -> Timestamp {
        self.review_at
            .unwrap_or(at + DEFAULT_REVIEW_WEEKS as i64 * 7 * DAY_MS)
    }
}

/// 一份生效过的计划。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Plan {
    pub id: PlanId,
    /// 从 1 起；重新生成就是 +1。
    pub version: u32,
    /// 哪次会话里生成的（会话删了计划仍在）。
    pub conversation: Option<ConversationId>,
    /// Unix 毫秒。
    pub at: Timestamp,
    pub frequency: Frequency,
    pub exercises: Vec<Exercise>,
    /// 复查日，Unix 毫秒。
    pub review_at: Timestamp,
}

impl Plan {
    /// 造一份计划：校验交给 [`PlanDraft::validate`]，复查日按默认值补齐。
    pub fn new(
        id: PlanId,
        version: u32,
        conversation: Option<ConversationId>,
        at: Timestamp,
        draft: PlanDraft,
    ) -> Result<Plan, DomainError> {
        draft.validate()?;
        let review_at = draft.review_at(at);
        if review_at <= at {
            return Err(DomainError::OutOfRange {
                field: "复查日（天）",
                min: 1.0,
                max: MAX_REVIEW_WEEKS as f64 * 7.0,
                value: (review_at - at) as f64 / DAY_MS as f64,
            });
        }
        Ok(Plan {
            id,
            version,
            conversation,
            at,
            frequency: draft.frequency,
            exercises: draft.exercises,
            review_at,
        })
    }

    /// 到了复查日吗（含当天）。
    pub fn review_due(&self, today_end: Timestamp) -> bool {
        today_end >= self.review_at
    }
}

/// 训练条件齐了没有：不齐就拒绝排计划，并把缺的项说全。
pub fn ready_to_plan(training: &TrainingContext) -> Result<(), DomainError> {
    let readiness = training.readiness();
    if readiness.is_ready() {
        Ok(())
    } else {
        Err(DomainError::TrainingIncomplete(readiness.missing().to_vec()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{Place, TrainingField};

    fn exercise(finding: u64) -> Exercise {
        Exercise {
            name: "臀桥".to_owned(),
            sets: 3,
            reps: 10,
            unit: RepsUnit::Times,
            finding: FindingId(finding),
        }
    }

    fn draft(exercises: Vec<Exercise>) -> PlanDraft {
        PlanDraft {
            frequency: Frequency::PerWeek(3),
            exercises,
            review_at: None,
        }
    }

    const NOW: Timestamp = 1_794_700_800_000;

    #[test]
    fn a_review_date_defaults_to_four_weeks_and_stays_where_it_was_put() {
        let plan = Plan::new(PlanId(1), 1, None, NOW, draft(vec![exercise(7)])).expect("造计划");
        assert_eq!(plan.review_at, NOW + 4 * 7 * DAY_MS);
        assert!(!plan.review_due(NOW + 7 * DAY_MS));
        assert!(plan.review_due(plan.review_at));

        let later = PlanDraft {
            review_at: Some(NOW + 7 * DAY_MS),
            ..draft(vec![exercise(7)])
        };
        let plan = Plan::new(PlanId(2), 1, None, NOW, later).expect("造计划");
        assert_eq!(plan.review_at, NOW + 7 * DAY_MS);
    }

    #[test]
    fn an_exercise_shows_its_prescription_with_or_without_seconds() {
        let mut seconds = exercise(7);
        seconds.reps = 30;
        seconds.unit = RepsUnit::Seconds;
        assert_eq!(seconds.prescription(), "3×30 秒");
        assert_eq!(exercise(7).prescription(), "3×10");
    }

    #[test]
    fn frequencies_are_bounded_and_read_back_in_two_forms() {
        assert_eq!(Frequency::PerWeek(3).zh(), "每周 3 次");
        assert_eq!(Frequency::EveryNDays(2).zh(), "每 2 天一次");
        assert!(Frequency::PerWeek(0).validate().is_err());
        assert!(Frequency::PerWeek(8).validate().is_err());
        assert!(Frequency::EveryNDays(1).validate().is_err());
        assert!(Frequency::from_parts("per-week", 3).is_ok());
        assert_eq!(
            Frequency::from_parts("every-n-days", 2).expect("解析"),
            Frequency::EveryNDays(2)
        );
        assert!(matches!(
            Frequency::from_parts("per-month", 3),
            Err(DomainError::UnknownFrequency(_))
        ));
    }

    #[test]
    fn a_plan_needs_at_least_one_exercise_and_at_most_twelve() {
        let empty = Plan::new(PlanId(1), 1, None, NOW, draft(Vec::new())).unwrap_err();
        assert_eq!(empty, DomainError::EmptyPlan);

        let too_many = Plan::new(
            PlanId(1),
            1,
            None,
            NOW,
            draft((0..=MAX_EXERCISES as u64).map(exercise).collect()),
        )
        .unwrap_err();
        assert_eq!(
            too_many,
            DomainError::TooManyExercises {
                count: MAX_EXERCISES + 1,
                max: MAX_EXERCISES
            }
        );
    }

    #[test]
    fn sets_reps_and_names_are_range_checked() {
        let mut blank = exercise(7);
        blank.name = "  ".to_owned();
        assert_eq!(blank.validate(), Err(DomainError::EmptyExercise));

        let mut no_sets = exercise(7);
        no_sets.sets = 0;
        assert!(matches!(
            no_sets.validate(),
            Err(DomainError::OutOfRange { field: "组数", .. })
        ));

        let mut zero_reps = exercise(7);
        zero_reps.reps = 0;
        assert!(matches!(
            zero_reps.validate(),
            Err(DomainError::OutOfRange {
                field: "每组次数",
                ..
            })
        ));
    }

    #[test]
    fn planning_is_refused_while_the_training_context_is_incomplete() {
        let empty = TrainingContext::new();
        let error = ready_to_plan(&empty).unwrap_err();
        let DomainError::TrainingIncomplete(missing) = &error else {
            panic!("缺项要成套报出来，收到 {error:?}");
        };
        assert_eq!(missing.len(), 4);

        let partial = TrainingContext {
            days_per_week: Some(3),
            minutes_per_session: None,
            places: vec![Place::Home],
            equipment: Vec::new(),
        };
        let DomainError::TrainingIncomplete(missing) = ready_to_plan(&partial).unwrap_err() else {
            panic!("缺项要成套报出来");
        };
        assert_eq!(
            missing,
            vec![
                TrainingField::MinutesPerSession,
                TrainingField::Equipment
            ]
        );

        let ready = TrainingContext {
            days_per_week: Some(3),
            minutes_per_session: Some(30),
            places: vec![Place::Home],
            equipment: vec!["band".to_owned()],
        };
        assert!(ready_to_plan(&ready).is_ok());
    }
}
