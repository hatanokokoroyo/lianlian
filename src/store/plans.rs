//! 计划与它的版本（#12）。
//!
//! 表里存**全部**版本（旧版本只读可查），`meta.active_plan_id` 指向生效的那一个。
//! 生成一份新计划 = 写一个新版本 + 挪动指针，两件事在同一个事务里——否则会出现
//! 「指针指着不存在的版本」或「有两个生效计划」。
//!
//! 落库前要过两道领域规则：训练条件必须齐全（不齐就拒绝，让 agent 去追问），
//! 每个动作挂的那条判定必须真的存在（动作的理由不能指向空气）。

use redb::{ReadableDatabase, ReadableTable, TableDefinition};

use super::{db_error, Store, StoreError};
use crate::domain::plan::ready_to_plan;
use crate::domain::{DomainError, Plan, PlanDraft, PlanId, Timestamp};

/// 计划：编号 → Plan 的 JSON。
pub(crate) const PLANS: TableDefinition<u64, &str> = TableDefinition::new("plans");

/// 生效计划在 `meta` 里的键。
const ACTIVE_PLAN: &str = "active_plan_id";

impl Store {
    /// 生成一份计划：版本号 = 现生效版本 + 1（没有就是 1）。
    pub fn create_plan(
        &self,
        conversation: Option<crate::domain::ConversationId>,
        at: Timestamp,
        draft: PlanDraft,
    ) -> Result<Plan, StoreError> {
        ready_to_plan(&self.training()?)?;
        draft.validate()?;
        for exercise in &draft.exercises {
            if self.finding(exercise.finding)?.is_none() {
                return Err(StoreError::Domain(DomainError::UnknownFinding(
                    exercise.finding,
                )));
            }
        }

        let version = self
            .active_plan()?
            .map(|plan| plan.version + 1)
            .unwrap_or(1);
        let id = PlanId(self.next_plan_id()?);
        let plan = Plan::new(id, version, conversation, at, draft)?;
        let json = to_json(&plan)?;

        let write = self.db().begin_write().map_err(db_error)?;
        {
            let mut plans = write.open_table(PLANS).map_err(db_error)?;
            plans
                .insert(plan.id.0, json.as_str())
                .map_err(db_error)?;
            drop(plans);
            let mut meta = write.open_table(super::META).map_err(db_error)?;
            meta.insert("next_plan_id", (plan.id.0 + 1).to_string().as_str())
                .map_err(db_error)?;
            meta.insert(ACTIVE_PLAN, plan.id.0.to_string().as_str())
                .map_err(db_error)?;
        }
        write.commit().map_err(db_error)?;
        Ok(plan)
    }

    /// 当前生效的计划；还没排过计划是 `None`。
    pub fn active_plan(&self) -> Result<Option<Plan>, StoreError> {
        let Some(raw) = self.meta(ACTIVE_PLAN)? else {
            return Ok(None);
        };
        let id: u64 = raw
            .parse()
            .map_err(|_| StoreError::Db(format!("生效计划的编号坏了：{raw}")))?;
        self.plan(PlanId(id))
    }

    /// 按编号取一份计划（旧版本也读得到）。
    pub fn plan(&self, id: PlanId) -> Result<Option<Plan>, StoreError> {
        let read = self.db().begin_read().map_err(db_error)?;
        let table = read.open_table(PLANS).map_err(db_error)?;
        let json = table
            .get(id.0)
            .map_err(db_error)?
            .map(|value| value.value().to_owned());
        json.map(|json| from_json(&json)).transpose()
    }

    /// 全部版本，按版本号升序（旧版本在前）。
    pub fn plans(&self) -> Result<Vec<Plan>, StoreError> {
        let read = self.db().begin_read().map_err(db_error)?;
        let table = read.open_table(PLANS).map_err(db_error)?;
        let mut plans: Vec<Plan> = Vec::new();
        for entry in table.iter().map_err(db_error)? {
            let (_, value) = entry.map_err(db_error)?;
            plans.push(from_json(value.value())?);
        }
        plans.sort_by_key(|plan| (plan.version, plan.id));
        Ok(plans)
    }

    /// 把生效计划的复查日挪到 `at`。
    ///
    /// **只给 `api::Testing` 用**：界面测试要造出「复查日到了」这个状态，而复查日
    /// 正常只能靠时间流逝到达。产品代码里没有任何地方调它。
    pub fn set_active_plan_review_at(&self, at: Timestamp) -> Result<(), StoreError> {
        let Some(mut plan) = self.active_plan()? else {
            return Ok(());
        };
        plan.review_at = at;
        let json = to_json(&plan)?;
        let write = self.db().begin_write().map_err(db_error)?;
        {
            let mut plans = write.open_table(PLANS).map_err(db_error)?;
            plans
                .insert(plan.id.0, json.as_str())
                .map_err(db_error)?;
        }
        write.commit().map_err(db_error)
    }

    fn next_plan_id(&self) -> Result<u64, StoreError> {
        Ok(self
            .meta("next_plan_id")?
            .and_then(|value| value.parse().ok())
            .unwrap_or(1))
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
        Exercise, FindingDraft, Frequency, Place, RepsUnit, Side, TrainingContext, Tension,
        TrainingField,
    };
    use crate::store::tests::TempStore;

    const NOW: Timestamp = 1_794_700_800_000;

    fn ready_store(name: &str) -> TempStore {
        let temp = TempStore::new(name);
        temp.store()
            .save_training(&TrainingContext {
                days_per_week: Some(3),
                minutes_per_session: Some(30),
                places: vec![Place::Home],
                equipment: vec!["band".to_owned()],
            })
            .expect("训练条件");
        temp
    }

    fn a_finding(store: &Store, site: &str) -> crate::domain::Finding {
        store
            .record(FindingDraft {
                site: site.to_owned(),
                side: Some(Side::Left),
                values: {
                    let mut values = crate::domain::AxisValues::new();
                    values.set(crate::domain::AxisValue::Tension(Tension::Weak));
                    values
                },
                confidence: 70,
                at: NOW,
            })
            .expect("写一条判定")
    }

    fn draft(finding: crate::domain::FindingId) -> PlanDraft {
        PlanDraft {
            frequency: Frequency::PerWeek(3),
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
    fn a_plan_lands_with_version_one_and_becomes_the_only_active_one() {
        let mut temp = ready_store("plan-first");
        let finding = a_finding(temp.store(), "gluteus-medius");
        let plan = temp
            .store()
            .create_plan(None, NOW, draft(finding.id))
            .expect("生成计划");
        assert_eq!(plan.version, 1);
        assert_eq!(plan.frequency, Frequency::PerWeek(3));
        assert_eq!(plan.review_at, NOW + 4 * 7 * crate::domain::tool::DAY_MS);

        let reopened = temp.reopen();
        let active = reopened.active_plan().expect("读生效计划").expect("有");
        assert_eq!(active, plan);
        assert_eq!(active.exercises[0].finding, finding.id);
    }

    #[test]
    fn regenerating_is_a_new_version_and_the_old_one_stays_readable() {
        let temp = ready_store("plan-version");
        let finding = a_finding(temp.store(), "gluteus-medius");
        let first = temp
            .store()
            .create_plan(None, NOW, draft(finding.id))
            .expect("生成第一版");

        let mut second_draft = draft(finding.id);
        second_draft.exercises.push(Exercise {
            name: "蚌式开合".to_owned(),
            sets: 3,
            reps: 12,
            unit: RepsUnit::Times,
            finding: finding.id,
        });
        let second = temp
            .store()
            .create_plan(None, NOW + 1, second_draft)
            .expect("生成第二版");

        assert_eq!(second.version, 2);
        assert_eq!(
            temp.store().active_plan().expect("读").expect("有").id,
            second.id
        );
        let versions = temp.store().plans().expect("读全部版本");
        assert_eq!(versions.len(), 2);
        assert_eq!(versions[0], first, "旧版本仍在，且内容不变");
        assert_eq!(versions[1].exercises.len(), 2);
    }

    #[test]
    fn a_plan_is_refused_while_the_training_context_is_incomplete() {
        let temp = TempStore::new("plan-no-training");
        let finding = a_finding(temp.store(), "gluteus-medius");
        let error = temp
            .store()
            .create_plan(None, NOW, draft(finding.id))
            .unwrap_err();
        let StoreError::Domain(DomainError::TrainingIncomplete(missing)) = error else {
            panic!("缺训练条件要成套拒绝，收到 {error:?}");
        };
        assert_eq!(missing.len(), 4);
        assert_eq!(missing[0], TrainingField::DaysPerWeek);
        assert!(temp.store().active_plan().expect("读").is_none());
    }

    #[test]
    fn an_exercise_pointing_at_a_missing_finding_is_refused() {
        let temp = ready_store("plan-bad-finding");
        let error = temp
            .store()
            .create_plan(None, NOW, draft(crate::domain::FindingId(999)))
            .unwrap_err();
        assert_eq!(
            error,
            StoreError::Domain(DomainError::UnknownFinding(crate::domain::FindingId(999)))
        );
        assert!(temp.store().plans().expect("读").is_empty());
    }
}
