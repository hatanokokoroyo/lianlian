//! 档案条目与撤回事件的存储：只追加（ADR-0003）。
//!
//! 每条判定、每次撤回各占一行，值是该结构的 JSON。时间线永远是整张表读出来再排
//! 序——这一层不做「就地更新」，因为没有更新这回事。
//!
//! 写入口只有一条：`store::evidence` 里的 `record_with_evidence` /
//! `retract_with_evidence`（判定与依据日志必须同一个事务）。这里只有读。

use redb::{ReadableDatabase, ReadableTable, TableDefinition};

use super::{db_error, Store, StoreError};
#[cfg(test)]
use crate::domain::DomainError;
use crate::domain::{Event, Finding, FindingId, Projection, Retract};

/// 判定：编号 → Finding 的 JSON。
pub(crate) const FINDINGS: TableDefinition<u64, &str> = TableDefinition::new("findings");
/// 撤回：被撤回的判定编号 → Retract 的 JSON。
pub(crate) const RETRACTS: TableDefinition<u64, &str> = TableDefinition::new("retracts");

impl Store {
    /// **只为存储层自测保留的窄入口**：不写依据日志。
    ///
    /// 产品代码一律走 `store::evidence` 的 `record_with_evidence`（判定与日志必须
    /// 同一个事务）；给 `#[cfg(test)]` 意味着 #10 之类的新代码想「顺手」用它时会
    /// 直接编译不过，而不是悄悄多出一条没有依据的判定。
    #[cfg(test)]
    pub fn record(
        &self,
        draft: crate::domain::FindingDraft,
    ) -> Result<Finding, StoreError> {
        draft.validate()?;
        let id = FindingId(self.next_finding_id()?);
        let finding = Finding::new(id, draft)?;
        let json = to_json(&finding)?;

        let write = self.db().begin_write().map_err(db_error)?;
        {
            let mut findings = write.open_table(FINDINGS).map_err(db_error)?;
            findings.insert(id.0, json.as_str()).map_err(db_error)?;
            drop(findings);
            let mut meta = write.open_table(super::META).map_err(db_error)?;
            meta.insert("next_finding_id", (id.0 + 1).to_string().as_str())
                .map_err(db_error)?;
        }
        write.commit().map_err(db_error)?;
        Ok(finding)
    }

    /// **只为存储层自测保留的窄入口**：不写依据日志（同上）。
    #[cfg(test)]
    pub fn retract(
        &self,
        finding: FindingId,
        reason: &str,
        at: crate::domain::Timestamp,
    ) -> Result<Retract, StoreError> {
        let retract = Retract::new(finding, reason, at)?;
        if self.finding(finding)?.is_none() {
            return Err(StoreError::Domain(DomainError::UnknownFinding(finding)));
        }
        if self.retraction(finding)?.is_some() {
            return Err(StoreError::Domain(DomainError::AlreadyRetracted(finding)));
        }
        let json = to_json(&retract)?;

        let write = self.db().begin_write().map_err(db_error)?;
        {
            let mut retracts = write.open_table(RETRACTS).map_err(db_error)?;
            retracts
                .insert(finding.0, json.as_str())
                .map_err(db_error)?;
        }
        write.commit().map_err(db_error)?;
        Ok(retract)
    }

    /// 按编号取一条判定。
    pub fn finding(&self, id: FindingId) -> Result<Option<Finding>, StoreError> {
        let read = self.db().begin_read().map_err(db_error)?;
        let table = read.open_table(FINDINGS).map_err(db_error)?;
        let json = table
            .get(id.0)
            .map_err(db_error)?
            .map(|value| value.value().to_owned());
        json.map(|json| from_json(&json)).transpose()
    }

    /// 全部判定，按（时间，编号）排序。
    pub fn findings(&self) -> Result<Vec<Finding>, StoreError> {
        let read = self.db().begin_read().map_err(db_error)?;
        let table = read.open_table(FINDINGS).map_err(db_error)?;
        let mut findings: Vec<Finding> = Vec::new();
        for entry in table.iter().map_err(db_error)? {
            let (_, value) = entry.map_err(db_error)?;
            findings.push(from_json(value.value())?);
        }
        findings.sort_by_key(|finding| (finding.at, finding.id));
        Ok(findings)
    }

    /// 全部撤回，按（时间，编号）排序。
    pub fn retractions(&self) -> Result<Vec<Retract>, StoreError> {
        let read = self.db().begin_read().map_err(db_error)?;
        let table = read.open_table(RETRACTS).map_err(db_error)?;
        let mut retracts: Vec<Retract> = Vec::new();
        for entry in table.iter().map_err(db_error)? {
            let (_, value) = entry.map_err(db_error)?;
            retracts.push(from_json::<Retract>(value.value())?);
        }
        retracts.sort_by_key(|retract| (retract.at, retract.finding));
        Ok(retracts)
    }

    /// 整条时间线：判定与撤回混在一起，按（时间，编号）排序。
    pub fn events(&self) -> Result<Vec<Event>, StoreError> {
        let mut events: Vec<Event> = self
            .findings()?
            .into_iter()
            .map(Event::Finding)
            .chain(self.retractions()?.into_iter().map(Event::Retract))
            .collect();
        events.sort_by_key(Event::order);
        Ok(events)
    }

    /// 当前的档案：从事件流算出来的投影。
    pub fn projection(&self) -> Result<Projection, StoreError> {
        Ok(Projection::from_events(&self.events()?))
    }

    pub(crate) fn next_finding_id(&self) -> Result<u64, StoreError> {
        Ok(self
            .meta("next_finding_id")?
            .and_then(|value| value.parse().ok())
            .unwrap_or(1))
    }
}

#[cfg(test)]
fn to_json<T: serde::Serialize>(value: &T) -> Result<String, StoreError> {
    serde_json::to_string(value).map_err(|error| StoreError::Db(format!("写库序列化失败：{error}")))
}

fn from_json<T: serde::de::DeserializeOwned>(json: &str) -> Result<T, StoreError> {
    serde_json::from_str(json).map_err(|error| StoreError::Db(format!("读库反序列化失败：{error}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{Axis, AxisValue, AxisValues, FindingDraft, Side, Tension, Timestamp};
    use crate::store::tests::TempStore;

    fn draft(site: &str, side: Option<Side>, at: Timestamp, tension: Tension) -> FindingDraft {
        let mut values = AxisValues::new();
        values.set(AxisValue::Tension(tension));
        FindingDraft {
            site: site.to_owned(),
            side,
            values,
            confidence: 70,
            at,
        }
    }

    #[test]
    fn records_a_finding_and_reads_it_back_in_time_order() {
        let mut temp = TempStore::new("record");
        let first = temp
            .store()
            .record(draft("gluteus-medius", Some(Side::Left), 300, Tension::Weak))
            .expect("写第一条");
        let second = temp
            .store()
            .record(draft("gluteus-medius", Some(Side::Left), 100, Tension::Tight))
            .expect("写第二条");
        assert!(second.id > first.id, "编号单调递增");

        // 换一个 Store 实例（同一个文件）读，验证真的落盘了，不是内存里的。
        let reopened = temp.reopen();
        let findings = reopened.findings().expect("读时间线");
        assert_eq!(findings.len(), 2);
        assert_eq!(
            findings.iter().map(|f| f.at).collect::<Vec<_>>(),
            vec![100, 300],
            "按时间排序，不按写入顺序"
        );
        assert_eq!(findings[1].id, first.id);
    }

    #[test]
    fn refuses_what_the_domain_refuses() {
        let temp = TempStore::new("refuse");
        let unknown = temp
            .store()
            .record(draft("gluteus", Some(Side::Left), 100, Tension::Weak))
            .unwrap_err();
        assert_eq!(
            unknown,
            StoreError::Domain(DomainError::UnknownSite("gluteus".to_owned()))
        );

        let missing_side = temp
            .store()
            .record(draft("gluteus-medius", None, 100, Tension::Weak))
            .unwrap_err();
        assert_eq!(
            missing_side,
            StoreError::Domain(DomainError::SideRequired("gluteus-medius".to_owned()))
        );
        assert!(temp.store().findings().expect("读时间线").is_empty());
    }

    #[test]
    fn retraction_removes_the_finding_from_the_projection_but_keeps_history() {
        let temp = TempStore::new("retract");
        let wrong = temp
            .store()
            .record(draft("soleus", Some(Side::Left), 100, Tension::Weak))
            .expect("写一条");
        let fixed = temp
            .store()
            .record(draft("soleus", Some(Side::Left), 200, Tension::Normal))
            .expect("再写一条");

        temp.store()
            .retract(wrong.id, "当时把比目鱼肌看成腓肠肌了", 300)
            .expect("撤回");

        let projection = temp.store().projection().expect("投影");
        let state = projection
            .state("soleus", Some(Side::Left))
            .expect("还有一条");
        assert_eq!(state.from, fixed.id);
        assert_eq!(
            state.values.get(Axis::Tension),
            Some(AxisValue::Tension(Tension::Normal))
        );

        // 历史还在：两条判定 + 一条撤回。
        assert_eq!(temp.store().findings().expect("判定").len(), 2);
        assert_eq!(temp.store().events().expect("事件").len(), 3);
        assert_eq!(temp.store().retractions().expect("撤回").len(), 1);
    }

    #[test]
    fn retraction_needs_a_reason_and_happens_once() {
        let temp = TempStore::new("retract-twice");
        let finding = temp
            .store()
            .record(draft("soleus", Some(Side::Left), 100, Tension::Weak))
            .expect("写一条");

        let empty = temp.store().retract(finding.id, "  ", 200).unwrap_err();
        assert_eq!(empty, StoreError::Domain(DomainError::EmptyReason));

        temp.store().retract(finding.id, "看错了", 200).expect("第一次");
        let twice = temp.store().retract(finding.id, "又反悔了", 300).unwrap_err();
        assert_eq!(
            twice,
            StoreError::Domain(DomainError::AlreadyRetracted(finding.id))
        );

        let unknown = temp.store().retract(FindingId(999), "不存在", 400).unwrap_err();
        assert_eq!(
            unknown,
            StoreError::Domain(DomainError::UnknownFinding(FindingId(999)))
        );
    }

    #[test]
    fn finding_ids_survive_reopening_the_file() {
        let mut temp = TempStore::new("ids");
        let first = temp
            .store()
            .record(draft("soleus", Some(Side::Left), 100, Tension::Weak))
            .expect("写一条");
        let reopened = temp.reopen();
        let second = reopened
            .record(draft("soleus", Some(Side::Left), 200, Tension::Normal))
            .expect("再写一条");
        assert!(second.id.0 > first.id.0, "编号不会因为重开库而重来");
    }
}
