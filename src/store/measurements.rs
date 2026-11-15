//! 测量的存储：只追加，唯一允许单条删除的表（ADR-0003 的例外）。
//!
//! 每条测量一行，键是编号，值是 `Measurement` 的 JSON。读的时候整表取出来按
//! 「时间、编号」排序——序列很短（一个人一辈子也记不了几万条），不值得建索引。

use redb::{ReadableDatabase, ReadableTable, TableDefinition};

use super::{db_error, Store, StoreError};
use crate::domain::measurement::Trend;
use crate::domain::{
    DomainError, Measurement, MeasurementDraft, MeasurementId, MeasurementKind, trend,
};

/// 测量：编号 → Measurement 的 JSON。
pub(crate) const MEASUREMENTS: TableDefinition<u64, &str> = TableDefinition::new("measurements");

impl Store {
    /// 追加一条测量：校验由领域层负责，这里分配编号并落库。
    pub fn record_measurement(&self, draft: MeasurementDraft) -> Result<Measurement, StoreError> {
        draft.validate()?;
        let id = MeasurementId(self.next_measurement_id()?);
        let measurement = Measurement::new(id, draft)?;
        let json = to_json(&measurement)?;

        let write = self.db().begin_write().map_err(db_error)?;
        {
            let mut measurements = write.open_table(MEASUREMENTS).map_err(db_error)?;
            measurements
                .insert(id.0, json.as_str())
                .map_err(db_error)?;
            drop(measurements);
            let mut meta = write.open_table(super::META).map_err(db_error)?;
            meta.insert("next_measurement_id", (id.0 + 1).to_string().as_str())
                .map_err(db_error)?;
        }
        write.commit().map_err(db_error)?;
        Ok(measurement)
    }

    /// 删掉一条测量（手误的 999 公斤不该留在趋势里）。
    pub fn delete_measurement(&self, id: MeasurementId) -> Result<(), StoreError> {
        let write = self.db().begin_write().map_err(db_error)?;
        {
            let mut measurements = write.open_table(MEASUREMENTS).map_err(db_error)?;
            let removed = measurements.remove(id.0).map_err(db_error)?;
            if removed.is_none() {
                return Err(StoreError::Domain(DomainError::UnknownMeasurement(id.0)));
            }
        }
        write.commit().map_err(db_error)
    }

    /// 某一种测量的全部记录，按「时间、编号」升序（折线图从左到右）。
    pub fn measurements(
        &self,
        kind: MeasurementKind,
    ) -> Result<Vec<Measurement>, StoreError> {
        let mut all: Vec<Measurement> = self
            .all_measurements()?
            .into_iter()
            .filter(|measurement| measurement.kind == kind)
            .collect();
        all.sort_by_key(|measurement| (measurement.at, measurement.id));
        Ok(all)
    }

    /// 某一种测量的最新一条；没有就是 `None`（「未填」不是 0）。
    pub fn latest_measurement(
        &self,
        kind: MeasurementKind,
    ) -> Result<Option<Measurement>, StoreError> {
        Ok(self.measurements(kind)?.pop())
    }

    /// 某一种测量的走势：最新值与首尾差。
    pub fn measurement_trend(&self, kind: MeasurementKind) -> Result<Trend, StoreError> {
        Ok(trend(self.measurements(kind)?))
    }

    fn all_measurements(&self) -> Result<Vec<Measurement>, StoreError> {
        let read = self.db().begin_read().map_err(db_error)?;
        let table = read.open_table(MEASUREMENTS).map_err(db_error)?;
        let mut all = Vec::new();
        for entry in table.iter().map_err(db_error)? {
            let (_, value) = entry.map_err(db_error)?;
            all.push(from_json(value.value())?);
        }
        Ok(all)
    }

    fn next_measurement_id(&self) -> Result<u64, StoreError> {
        Ok(self
            .meta("next_measurement_id")?
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
    use crate::domain::DomainError;
    use crate::store::tests::TempStore;

    fn draft(kind: MeasurementKind, value: f64, at: i64) -> MeasurementDraft {
        MeasurementDraft { kind, value, at }
    }

    #[test]
    fn recording_appends_instead_of_overwriting() {
        let temp = TempStore::new("measurements-append");
        let store = temp.store();
        store
            .record_measurement(draft(MeasurementKind::Weight, 62.4, 100))
            .expect("第一条");
        store
            .record_measurement(draft(MeasurementKind::Weight, 63.1, 200))
            .expect("第二条");

        let series = store.measurements(MeasurementKind::Weight).expect("读测量");
        assert_eq!(series.len(), 2);
        assert_eq!(series[0].value, 62.4);
        assert_eq!(series[1].value, 63.1);
        assert_eq!(
            store
                .latest_measurement(MeasurementKind::Weight)
                .expect("最新")
                .map(|measurement| measurement.value),
            Some(63.1)
        );
    }

    #[test]
    fn a_recorded_measurement_survives_reopening_the_file() {
        let mut temp = TempStore::new("measurements-persist");
        temp.store()
            .record_measurement(draft(MeasurementKind::Weight, 62.4, 100))
            .expect("记录");
        let reopened = temp.reopen();
        assert_eq!(reopened.measurements(MeasurementKind::Weight).expect("读").len(), 1);
    }

    #[test]
    fn deleting_one_measurement_leaves_the_rest_and_moves_the_latest_back() {
        let temp = TempStore::new("measurements-delete");
        let store = temp.store();
        let first = store
            .record_measurement(draft(MeasurementKind::Weight, 62.4, 100))
            .expect("第一条");
        store
            .record_measurement(draft(MeasurementKind::Weight, 63.1, 200))
            .expect("第二条");

        store.delete_measurement(first.id).expect("删第一条");
        let series = store.measurements(MeasurementKind::Weight).expect("读测量");
        assert_eq!(series.len(), 1);
        assert_eq!(series[0].value, 63.1);

        assert_eq!(
            store.delete_measurement(first.id),
            Err(StoreError::Domain(DomainError::UnknownMeasurement(1)))
        );
    }

    #[test]
    fn height_and_weight_are_separate_series() {
        let temp = TempStore::new("measurements-kinds");
        let store = temp.store();
        store
            .record_measurement(draft(MeasurementKind::Height, 168.0, 100))
            .expect("身高");
        store
            .record_measurement(draft(MeasurementKind::Weight, 62.4, 200))
            .expect("体重");
        assert_eq!(
            store
                .measurements(MeasurementKind::Height)
                .expect("读身高")
                .len(),
            1
        );
        assert_eq!(
            store
                .latest_measurement(MeasurementKind::Weight)
                .expect("读体重")
                .map(|measurement| measurement.value),
            Some(62.4)
        );
    }

    #[test]
    fn values_outside_the_range_are_not_written() {
        let temp = TempStore::new("measurements-invalid");
        let store = temp.store();
        assert_eq!(
            store.record_measurement(draft(MeasurementKind::Weight, 999.0, 100)),
            Err(StoreError::Domain(DomainError::OutOfRange {
                field: "体重（千克）",
                min: 20.0,
                max: 400.0,
                value: 999.0,
            }))
        );
        assert!(store.measurements(MeasurementKind::Weight).expect("读").is_empty());
    }
}
