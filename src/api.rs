//! TSX 的入口：这里用到的类型会被 nsh 生成成 `native.d.ts` 里的声明，
//! 所以数据形状在这里定，界面只消费它。
//!
//! 写法约定：读用 `async fn`（要在任务里拿 app 私有目录），写回的失败用
//! `Option<String>` 表达——`None` 是成功，`Some(文案)` 是失败原因，界面直接显示。

use nsh_core::prelude::*;

use crate::domain::basics::{Basics, Sex, AGE_RANGE};
use crate::domain::measurement::{
    MeasurementDraft, MeasurementKind, HEIGHT_CM_RANGE, WEIGHT_KG_RANGE,
};
use crate::domain::training::{
    Place, Readiness, TrainingContext, DAYS_PER_WEEK_RANGE, MINUTES_RANGE,
};
use crate::domain::DomainError;
use crate::store::Store;

/// 基本属性。
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct BasicsView {
    /// `female` / `male`；`null` 是「不填」。
    pub sex: Option<String>,
    /// 年龄。
    pub age: Option<f64>,
    /// 身高，厘米：最新一条身高测量，不是可编辑的字段。
    pub height_cm: Option<f64>,
    /// 体重，千克：最新一条体重测量，不是可编辑的字段。
    pub weight_kg: Option<f64>,
    /// 基础疾病或旧伤，自由文本的清单。
    pub conditions: Vec<String>,
}

/// 训练条件。
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct TrainingView {
    /// 每周能练几天。
    pub days_per_week: Option<f64>,
    /// 每次多久，分钟。
    pub minutes_per_session: Option<f64>,
    /// 在哪练：`home` / `gym` / `office` / `outdoor`。
    pub places: Vec<String>,
    /// 手边有什么：自由文本；`nothing` 表示「什么都没有」。
    pub equipment: Vec<String>,
}

/// 训练条件齐不齐。
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct ReadinessView {
    /// 四项都填了。
    pub ready: bool,
    /// 缺的项：`days-per-week` / `minutes-per-session` / `places` / `equipment`。
    pub missing: Vec<String>,
    /// 缺的项的中文名，直接进提示文案。
    pub missing_zh: Vec<String>,
}

/// 冷启动要读的全部状态。
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct ProfileView {
    /// 引导是否走完（没走完就显示引导，而不是空白页）。
    pub onboarded: bool,
    pub basics: BasicsView,
    pub training: TrainingView,
    pub readiness: ReadinessView,
    /// 本地库打不开时的原因；有值时界面应当提示而不是装作空档案。
    pub error: Option<String>,
}

/// 一条测量在界面上的样子。
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct MeasurementView {
    /// 编号：删除时用它。
    pub id: f64,
    /// `height` / `weight`。
    pub kind: String,
    /// 数值，单位见同一序列的 `unit`。
    pub value: f64,
    /// Unix 毫秒；界面按本地时区显示日期。
    pub at: f64,
}

/// 一种测量（身高或体重）的序列。
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct SeriesView {
    /// `height` / `weight`。
    pub kind: String,
    /// 显示名：身高 / 体重。
    pub label: String,
    /// 单位：cm / kg。
    pub unit: String,
    /// 最新一条的值；没有测量时是 `null`。
    pub current: Option<f64>,
    /// 最新与最早的差；少于两条时是 `null`（看不出变化不等于没变化）。
    pub change: Option<f64>,
    /// 按时间升序，折线图从左到右画它。
    pub points: Vec<MeasurementView>,
}

/// 测量页要读的全部状态。
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct MeasurementsView {
    pub weight: SeriesView,
    pub height: SeriesView,
    /// 读库失败的原因；有值时界面要提示而不是装作没有测量。
    pub error: Option<String>,
}

/// 测量的读写：追加一条、删掉一条、读两种序列。
#[module]
pub struct Measurements;

#[module]
impl Measurements {
    /// 读身高与体重的完整序列。
    pub async fn load() -> MeasurementsView {
        match Store::open_app() {
            Ok(store) => measurements_view(&store, None),
            Err(error) => empty_measurements_view(Some(error.to_string())),
        }
    }

    /// 显式记一条测量；返回失败原因，成功是 `null`。
    ///
    /// 与保存基本属性不同，这里即使数值和上一条相同也照样追加——用户是
    /// 主动「记一次」，不是改一个字段。
    pub async fn record(kind: String, value: f64) -> Option<String> {
        let Some(kind) = MeasurementKind::from_key(&kind) else {
            return Some(format!("不认识的测量种类：{kind}"));
        };
        let draft = MeasurementDraft {
            kind,
            value,
            at: nsh_core::time::unix_ms() as i64,
        };
        save(&Store::open_app(), |store| {
            store.record_measurement(draft.clone()).map(|_| ())
        })
    }

    /// 删掉一条测量；返回失败原因，成功是 `null`。
    pub async fn delete(id: f64) -> Option<String> {
        if !id.is_finite() || id < 0.0 {
            return Some(format!("测量编号不合法：{id}"));
        }
        save(&Store::open_app(), |store| {
            store.delete_measurement(crate::domain::measurement::MeasurementId(id as u64))
        })
    }
}

fn measurements_view(store: &Store, error: Option<String>) -> MeasurementsView {
    let series = |kind: MeasurementKind| -> SeriesView {
        let measurements = store.measurements(kind).unwrap_or_default();
        let trend = crate::domain::trend(measurements.clone());
        SeriesView {
            kind: kind.key().to_owned(),
            label: kind.zh().to_owned(),
            unit: kind.unit().to_owned(),
            current: trend.latest,
            change: trend.change,
            points: measurements
                .iter()
                .map(|measurement| MeasurementView {
                    id: measurement.id.0 as f64,
                    kind: kind.key().to_owned(),
                    value: measurement.value,
                    at: measurement.at as f64,
                })
                .collect(),
        }
    };
    MeasurementsView {
        weight: series(MeasurementKind::Weight),
        height: series(MeasurementKind::Height),
        error,
    }
}

fn empty_measurements_view(error: Option<String>) -> MeasurementsView {
    let empty = |kind: MeasurementKind| SeriesView {
        kind: kind.key().to_owned(),
        label: kind.zh().to_owned(),
        unit: kind.unit().to_owned(),
        current: None,
        change: None,
        points: Vec::new(),
    };
    MeasurementsView {
        weight: empty(MeasurementKind::Weight),
        height: empty(MeasurementKind::Height),
        error,
    }
}

/// 档案的读写：基本属性、训练条件、引导标记。
#[module]
pub struct Profile;

#[module]
impl Profile {
    /// 冷启动读一遍全部状态；库打不开时返回空档案并把原因放在 `error` 里。
    pub async fn load() -> ProfileView {
        match Store::open_app() {
            Ok(store) => match (store.basics(), store.training(), store.onboarded()) {
                (Ok(basics), Ok(training), Ok(onboarded)) => ProfileView {
                    onboarded,
                    readiness: readiness_view(&training.readiness()),
                    basics: measured_basics_view(&store, &basics),
                    training: training_view(&training),
                    error: None,
                },
                (basics, training, onboarded) => ProfileView {
                    onboarded: false,
                    basics: basics_view(&Basics::new(), None, None),
                    training: training_view(&TrainingContext::new()),
                    readiness: readiness_view(&TrainingContext::new().readiness()),
                    error: Some(
                        [basics.err(), training.err(), onboarded.err()]
                            .into_iter()
                            .flatten()
                            .map(|error| error.to_string())
                            .collect::<Vec<_>>()
                            .join("；"),
                    ),
                },
            },
            Err(error) => ProfileView {
                onboarded: false,
                basics: basics_view(&Basics::new(), None, None),
                training: training_view(&TrainingContext::new()),
                readiness: readiness_view(&TrainingContext::new().readiness()),
                error: Some(error.to_string()),
            },
        }
    }

    /// 保存基本属性；返回失败原因，成功是 `null`。
    pub async fn save_basics(
        sex: Option<String>,
        age: Option<f64>,
        height_cm: Option<f64>,
        weight_kg: Option<f64>,
        conditions: Vec<String>,
    ) -> Option<String> {
        let basics = match build_basics(sex, age, conditions) {
            Ok(basics) => basics,
            Err(message) => return Some(message),
        };
        // 身高体重是测量：填了且与最新一条不同，就追加一条；清空不删历史。
        let drafts = match body_measurements(height_cm, weight_kg) {
            Ok(drafts) => drafts,
            Err(message) => return Some(message),
        };
        let store = match Store::open_app() {
            Ok(store) => store,
            Err(error) => return Some(error.to_string()),
        };
        if let Err(error) = store.save_basics(&basics) {
            return Some(error.to_string());
        }
        for draft in drafts {
            let unchanged = store
                .latest_measurement(draft.kind)
                .ok()
                .flatten()
                .is_some_and(|latest| latest.value == draft.value);
            if unchanged {
                continue;
            }
            if let Err(error) = store.record_measurement(draft) {
                return Some(error.to_string());
            }
        }
        None
    }

    /// 保存训练条件；返回失败原因，成功是 `null`。
    pub async fn save_training(
        days_per_week: Option<f64>,
        minutes_per_session: Option<f64>,
        places: Vec<String>,
        equipment: Vec<String>,
    ) -> Option<String> {
        let training = match build_training(days_per_week, minutes_per_session, places, equipment) {
            Ok(training) => training,
            Err(message) => return Some(message),
        };
        save(&Store::open_app(), |store| store.save_training(&training))
    }

    /// 引导走完。
    pub async fn finish_onboarding() -> Option<String> {
        save(&Store::open_app(), |store| store.set_onboarded(true))
    }

    /// 训练条件齐不齐（下游判断用：不齐全就不该排计划）。
    pub async fn readiness() -> ReadinessView {
        match Store::open_app() {
            Ok(store) => match store.training() {
                Ok(training) => readiness_view(&training.readiness()),
                Err(_) => readiness_view(&TrainingContext::new().readiness()),
            },
            Err(_) => readiness_view(&TrainingContext::new().readiness()),
        }
    }
}

fn build_basics(
    sex: Option<String>,
    age: Option<f64>,
    conditions: Vec<String>,
) -> Result<Basics, String> {
    Ok(Basics {
        sex: parse_sex(sex.as_deref()),
        age: parse_age(age).map_err(|error| error.to_string())?,
        conditions: conditions
            .into_iter()
            .map(|condition| condition.trim().to_owned())
            .filter(|condition| !condition.is_empty())
            .collect(),
    })
}

fn build_training(
    days_per_week: Option<f64>,
    minutes_per_session: Option<f64>,
    places: Vec<String>,
    equipment: Vec<String>,
) -> Result<TrainingContext, String> {
    Ok(TrainingContext {
        days_per_week: parse_whole(days_per_week, "每周能练几天", DAYS_PER_WEEK_RANGE)
            .map_err(|error| error.to_string())?,
        minutes_per_session: parse_whole(
            minutes_per_session,
            "每次多久（分钟）",
            MINUTES_RANGE,
        )
        .map_err(|error| error.to_string())?,
        places: places
            .iter()
            .filter_map(|place| Place::from_key(place))
            .collect(),
        equipment: equipment
            .into_iter()
            .map(|label| label.trim().to_owned())
            .filter(|label| !label.is_empty())
            .collect(),
    })
}

fn save(
    store: &Result<Store, crate::store::StoreError>,
    write: impl Fn(&Store) -> Result<(), crate::store::StoreError>,
) -> Option<String> {
    match store {
        Ok(store) => write(store).err().map(|error| error.to_string()),
        Err(error) => Some(error.to_string()),
    }
}

fn basics_view(basics: &Basics, height_cm: Option<f64>, weight_kg: Option<f64>) -> BasicsView {
    BasicsView {
        sex: basics.sex.map(|sex| sex.key().to_owned()),
        age: basics.age.map(f64::from),
        height_cm,
        weight_kg,
        conditions: basics.conditions.clone(),
    }
}

/// 基本属性里的「当前身高/体重」始终来自最新一条测量。
fn measured_basics_view(store: &Store, basics: &Basics) -> BasicsView {
    let height = store
        .latest_measurement(MeasurementKind::Height)
        .ok()
        .flatten()
        .map(|measurement| measurement.value);
    let weight = store
        .latest_measurement(MeasurementKind::Weight)
        .ok()
        .flatten()
        .map(|measurement| measurement.value);
    basics_view(basics, height, weight)
}

/// 表单里的身高体重 → 待追加的测量；留空就是「这次不记」。
fn body_measurements(
    height_cm: Option<f64>,
    weight_kg: Option<f64>,
) -> Result<Vec<MeasurementDraft>, String> {
    let at = nsh_core::time::unix_ms() as i64;
    let mut drafts = Vec::new();
    if let Some(value) = parse_metric(height_cm, "身高（厘米）", HEIGHT_CM_RANGE)
        .map_err(|error| error.to_string())?
    {
        drafts.push(MeasurementDraft {
            kind: MeasurementKind::Height,
            value,
            at,
        });
    }
    if let Some(value) = parse_metric(weight_kg, "体重（千克）", WEIGHT_KG_RANGE)
        .map_err(|error| error.to_string())?
    {
        drafts.push(MeasurementDraft {
            kind: MeasurementKind::Weight,
            value,
            at,
        });
    }
    Ok(drafts)
}

fn training_view(training: &TrainingContext) -> TrainingView {
    TrainingView {
        days_per_week: training.days_per_week.map(f64::from),
        minutes_per_session: training.minutes_per_session.map(f64::from),
        places: training
            .places
            .iter()
            .map(|place| place.key().to_owned())
            .collect(),
        equipment: training.equipment.clone(),
    }
}

fn readiness_view(readiness: &Readiness) -> ReadinessView {
    ReadinessView {
        ready: readiness.is_ready(),
        missing: readiness
            .missing()
            .iter()
            .map(|field| field.key().to_owned())
            .collect(),
        missing_zh: readiness
            .missing()
            .iter()
            .map(|field| field.zh().to_owned())
            .collect(),
    }
}

/// 性别：`None` 与空串都是「不填」，认不出来的键当作不填（界面只传合法键）。
fn parse_sex(raw: Option<&str>) -> Option<Sex> {
    raw.and_then(Sex::from_key)
}

/// 年龄：必须是 1–120 的整数。
fn parse_age(raw: Option<f64>) -> Result<Option<u8>, DomainError> {
    parse_whole(raw, "年龄", AGE_RANGE)
}

/// 身高/体重：有限数值且落在区间内。
fn parse_metric(
    raw: Option<f64>,
    field: &'static str,
    (min, max): (f64, f64),
) -> Result<Option<f64>, DomainError> {
    match raw {
        None => Ok(None),
        Some(value) if value.is_finite() && (min..=max).contains(&value) => Ok(Some(value)),
        Some(value) => Err(DomainError::OutOfRange {
            field,
            min,
            max,
            value,
        }),
    }
}

/// 整数型字段：小数与越界都拒。
fn parse_whole<T>(
    raw: Option<f64>,
    field: &'static str,
    (min, max): (T, T),
) -> Result<Option<T>, DomainError>
where
    T: Copy + PartialOrd + Into<f64> + TryFrom<u32>,
{
    let (min, max) = (min.into(), max.into());
    match raw {
        None => Ok(None),
        Some(value)
            if value.is_finite()
                && value.fract() == 0.0
                && (min..=max).contains(&value) =>
        {
            T::try_from(value as u32).map_or_else(
                |_| {
                    Err(DomainError::OutOfRange {
                        field,
                        min,
                        max,
                        value,
                    })
                },
                |whole| Ok(Some(whole)),
            )
        }
        Some(value) => Err(DomainError::OutOfRange {
            field,
            min,
            max,
            value,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn views_carry_unfilled_fields_as_null_not_zero() {
        let view = basics_view(&Basics::new(), None, None);
        assert_eq!(view.sex, None);
        assert_eq!(view.age, None);
        assert_eq!(view.height_cm, None);
        assert!(view.conditions.is_empty());
    }

    #[test]
    fn readiness_view_lists_missing_fields_in_both_forms() {
        let view = readiness_view(&TrainingContext::new().readiness());
        assert!(!view.ready);
        assert_eq!(
            view.missing,
            vec!["days-per-week", "minutes-per-session", "places", "equipment"]
        );
        assert_eq!(
            view.missing_zh,
            vec!["每周能练几天", "每次多久", "在哪练", "手边有什么"]
        );
    }

    #[test]
    fn integers_are_required_for_counting_fields() {
        assert_eq!(parse_whole(Some(3.0), "x", (1u8, 7u8)).unwrap(), Some(3));
        assert!(parse_whole(Some(3.5), "x", (1u8, 7u8)).is_err());
        assert!(parse_whole(Some(0.0), "x", (1u8, 7u8)).is_err());
        assert!(parse_whole(Some(f64::NAN), "x", (1u8, 7u8)).is_err());
        assert_eq!(parse_whole(None, "x", (1u8, 7u8)).unwrap(), None);
    }

    #[test]
    fn metrics_reject_nonsense_but_allow_blank() {
        assert_eq!(
            parse_metric(Some(168.0), "身高（厘米）", HEIGHT_CM_RANGE).unwrap(),
            Some(168.0)
        );
        assert_eq!(
            parse_metric(None, "体重（千克）", WEIGHT_KG_RANGE).unwrap(),
            None
        );
        assert!(parse_metric(Some(9.0), "身高（厘米）", HEIGHT_CM_RANGE).is_err());
    }

    #[test]
    fn sex_ignores_unknown_and_blank_values() {
        assert_eq!(parse_sex(Some("female")), Some(Sex::Female));
        assert_eq!(parse_sex(Some("")), None);
        assert_eq!(parse_sex(None), None);
    }
}

#[cfg(test)]
mod measurement_tests {
    use super::*;
    use crate::domain::{MeasurementDraft, MeasurementKind};
    use crate::store::tests::TempStore;

    fn record(store: &Store, kind: MeasurementKind, value: f64, at: i64) {
        store
            .record_measurement(MeasurementDraft { kind, value, at })
            .expect("记一条");
    }

    #[test]
    fn an_empty_series_is_empty_not_zero_and_has_no_change() {
        let temp = TempStore::new("api-measurements-empty");
        let view = measurements_view(temp.store(), None);
        assert_eq!(view.weight.current, None);
        assert_eq!(view.height.current, None);
        assert!(view.weight.points.is_empty());
        assert_eq!(view.error, None);
    }

    #[test]
    fn the_series_carries_points_in_time_order_and_the_change_between_ends() {
        let temp = TempStore::new("api-measurements-series");
        let store = temp.store();
        record(store, MeasurementKind::Weight, 74.6, 200);
        record(store, MeasurementKind::Weight, 74.2, 300);
        record(store, MeasurementKind::Weight, 75.0, 100);

        let view = measurements_view(store, None);
        assert_eq!(view.weight.current, Some(74.2));
        assert!((view.weight.change.expect("首尾的差") - -0.8).abs() < 1e-9);
        assert_eq!(
            view.weight
                .points
                .iter()
                .map(|point| point.at)
                .collect::<Vec<_>>(),
            vec![100.0, 200.0, 300.0]
        );
        assert!(view.height.points.is_empty());
    }

    #[test]
    fn basics_show_the_latest_measurement_as_the_current_value() {
        let temp = TempStore::new("api-measurements-basics");
        let store = temp.store();
        record(store, MeasurementKind::Weight, 62.4, 100);
        record(store, MeasurementKind::Weight, 63.1, 200);
        record(store, MeasurementKind::Height, 168.0, 150);

        let view = measured_basics_view(store, &Basics::new());
        assert_eq!(view.weight_kg, Some(63.1));
        assert_eq!(view.height_cm, Some(168.0));
    }

    #[test]
    fn a_blank_body_field_records_nothing_and_a_value_records_one_measurement() {
        let drafts = body_measurements(None, Some(62.4)).expect("合法");
        assert_eq!(drafts.len(), 1);
        assert_eq!(drafts[0].kind, MeasurementKind::Weight);
        assert!(body_measurements(None, None).expect("空").is_empty());
        assert!(body_measurements(Some(9.0), None).is_err());
    }
}
