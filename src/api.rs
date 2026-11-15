//! TSX 的入口：这里用到的类型会被 nsh 生成成 `native.d.ts` 里的声明，
//! 所以数据形状在这里定，界面只消费它。

use nsh_core::prelude::*;

use crate::store;

/// 今日清单里的一个动作。
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct Exercise {
    /// kebab-case，界面用它拼 testID（`exercise-{slug}`）。
    pub slug: String,
    /// 动作名，如「臀桥」。
    pub name: String,
    /// 为什么排这个动作：部位 + 轴的取值。
    pub basis: String,
    /// 组数。
    pub sets: u32,
    /// 每组次数。
    pub reps: u32,
}

/// 今天的训练日。
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct TodayPlan {
    /// 训练日的名字，如「臀腿日」。
    pub title: String,
    /// 本周已打卡次数。
    pub week_done: u32,
    /// 本周计划训练次数。
    pub week_total: u32,
    /// 动作，按清单顺序。
    pub exercises: Vec<Exercise>,
}

/// 今日页读的东西。
#[module]
pub struct Today;

#[module]
impl Today {

    /// 今日训练日；库打不开或还没有计划时为 `null`，今日页据此显示引导。
    ///
    /// `async`：读库要 app 私有目录（`data_dir()`），只有任务里拿得到，
    /// 在 JS 调用里同步跑会撞上「引擎线程没有响应式运行时」。
    pub async fn plan() -> Option<TodayPlan> {
        let plan = store::today_plan().ok()?;
        if plan.exercises.is_empty() {
            return None;
        }
        Some(TodayPlan {
            title: plan.title,
            week_done: plan.week_done,
            week_total: plan.week_total,
            exercises: plan
                .exercises
                .into_iter()
                .map(|row| Exercise {
                    slug: row.slug,
                    name: row.name,
                    basis: row.basis,
                    sets: row.sets,
                    reps: row.reps,
                })
                .collect(),
        })
    }
}
