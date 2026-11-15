//! 依据日志的存储（ADR-0005）与「判定 + 日志一起落库」的事务边界。
//!
//! 一条判定和它的四段依据只能同生共死：判定进了库而依据没进，等于档案里多了一条
//! 查不到来源的结论；依据进了库而判定没进，等于日志在讲一条不存在的判定。所以
//! 写入走同一个 redb 写事务（`record_with_evidence` / `retract_with_evidence`），
//! 校验在事务之前全部做完。

use redb::{ReadableDatabase, ReadableTable, TableDefinition};

use super::{Store, StoreError, db_error};
use crate::domain::tool::EvidenceQuery;
use crate::domain::{
    DomainError, Evidence, EvidenceDraft, EvidenceId, EvidenceKind, Finding, FindingDraft,
    FindingId, Retract, Timestamp,
};

/// 依据日志：编号 → Evidence 的 JSON。
pub(crate) const EVIDENCE: TableDefinition<u64, &str> = TableDefinition::new("evidence");

impl Store {
    /// 写一条判定，连同它的依据日志（同一个事务）。
    ///
    /// 日志的 `finding` 一律指向这条新判定；调用方不用自己填。
    pub fn record_with_evidence(
        &self,
        draft: FindingDraft,
        mut evidence: EvidenceDraft,
    ) -> Result<(Finding, Evidence), StoreError> {
        draft.validate()?;
        evidence.finding = None;
        evidence.validate()?;

        let finding_id = FindingId(self.next_finding_id()?);
        let finding = Finding::new(finding_id, draft)?;
        evidence.finding = Some(finding_id);
        let evidence = Evidence::new(EvidenceId(self.next_evidence_id()?), evidence)?;

        let write = self.db().begin_write().map_err(db_error)?;
        {
            let mut findings = write
                .open_table(super::findings::FINDINGS)
                .map_err(db_error)?;
            findings
                .insert(finding.id.0, to_json(&finding)?.as_str())
                .map_err(db_error)?;
            drop(findings);
            let mut log = write.open_table(EVIDENCE).map_err(db_error)?;
            log.insert(evidence.id.0, to_json(&evidence)?.as_str())
                .map_err(db_error)?;
            drop(log);
            let mut meta = write.open_table(super::META).map_err(db_error)?;
            meta.insert("next_finding_id", (finding.id.0 + 1).to_string().as_str())
                .map_err(db_error)?;
            meta.insert("next_evidence_id", (evidence.id.0 + 1).to_string().as_str())
                .map_err(db_error)?;
        }
        write.commit().map_err(db_error)?;
        Ok((finding, evidence))
    }

    /// 撤回一条判定，连同依据日志（同一个事务）。
    pub fn retract_with_evidence(
        &self,
        finding: FindingId,
        reason: &str,
        at: Timestamp,
        mut evidence: EvidenceDraft,
    ) -> Result<(Retract, Evidence), StoreError> {
        let retract = Retract::new(finding, reason, at)?;
        if self.finding(finding)?.is_none() {
            return Err(StoreError::Domain(DomainError::UnknownFinding(finding)));
        }
        if self.retraction(finding)?.is_some() {
            return Err(StoreError::Domain(DomainError::AlreadyRetracted(finding)));
        }
        evidence.finding = Some(finding);
        evidence.kind = EvidenceKind::Retract;
        evidence.validate()?;
        let evidence = Evidence::new(EvidenceId(self.next_evidence_id()?), evidence)?;

        let write = self.db().begin_write().map_err(db_error)?;
        {
            let mut retracts = write
                .open_table(super::findings::RETRACTS)
                .map_err(db_error)?;
            retracts
                .insert(finding.0, to_json(&retract)?.as_str())
                .map_err(db_error)?;
            drop(retracts);
            let mut log = write.open_table(EVIDENCE).map_err(db_error)?;
            log.insert(evidence.id.0, to_json(&evidence)?.as_str())
                .map_err(db_error)?;
            drop(log);
            let mut meta = write.open_table(super::META).map_err(db_error)?;
            meta.insert("next_evidence_id", (evidence.id.0 + 1).to_string().as_str())
                .map_err(db_error)?;
        }
        write.commit().map_err(db_error)?;
        Ok((retract, evidence))
    }

    /// 全部依据日志，按（时间，编号）升序。
    pub fn evidence_log(&self) -> Result<Vec<Evidence>, StoreError> {
        let read = self.db().begin_read().map_err(db_error)?;
        let table = read.open_table(EVIDENCE).map_err(db_error)?;
        let mut all = Vec::new();
        for entry in table.iter().map_err(db_error)? {
            let (_, value) = entry.map_err(db_error)?;
            all.push(from_json::<Evidence>(value.value())?);
        }
        all.sort_by_key(|evidence| (evidence.at, evidence.id));
        Ok(all)
    }

    /// 按条件检索依据日志：命中的按（时间，编号）**倒序**，最近的在前。
    ///
    /// `axis` 过滤看的是这条日志所服务的那条判定测过哪些轴；没有判定可指的
    /// 日志（比如用户拒绝）在按轴检索时不会出现。
    pub fn search_evidence(&self, query: &EvidenceQuery) -> Result<Vec<Evidence>, StoreError> {
        let findings = self.findings()?;
        let by_id = |id: FindingId| findings.iter().find(|finding| finding.id == id);
        let mut hits: Vec<Evidence> = self
            .evidence_log()?
            .into_iter()
            .filter(|evidence| match &query.site {
                Some(site) => &evidence.site == site,
                None => true,
            })
            .filter(|evidence| match query.from {
                Some(from) => evidence.at >= from,
                None => true,
            })
            .filter(|evidence| match query.to {
                Some(to) => evidence.at <= to,
                None => true,
            })
            .filter(|evidence| match &query.contains {
                Some(needle) => evidence
                    .sections()
                    .iter()
                    .any(|(_, text)| text.contains(needle.as_str())),
                None => true,
            })
            .filter(|evidence| match query.axis {
                Some(axis) => evidence
                    .finding
                    .and_then(&by_id)
                    .is_some_and(|finding| finding.values.get(axis).is_some()),
                None => true,
            })
            .collect();
        hits.reverse();
        hits.truncate(query.clamped_limit());
        Ok(hits)
    }

    /// 一条判定的撤回（没有就是 `None`）。
    pub fn retraction(&self, finding: FindingId) -> Result<Option<Retract>, StoreError> {
        let read = self.db().begin_read().map_err(db_error)?;
        let table = read
            .open_table(super::findings::RETRACTS)
            .map_err(db_error)?;
        let json = table
            .get(finding.0)
            .map_err(db_error)?
            .map(|value| value.value().to_owned());
        json.map(|json| from_json(&json)).transpose()
    }

    fn next_evidence_id(&self) -> Result<u64, StoreError> {
        Ok(self
            .meta("next_evidence_id")?
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
    use crate::domain::{Axis, AxisValue, AxisValues, ConversationId, Side, Tension};
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

    fn evidence(
        kind: EvidenceKind,
        site: &str,
        side: Option<Side>,
        at: Timestamp,
    ) -> EvidenceDraft {
        EvidenceDraft {
            kind,
            site: site.to_owned(),
            side,
            finding: None,
            conversation: Some(ConversationId(1)),
            at,
            user_said: "蹲不下去，膝盖前面紧".to_owned(),
            test_and_feedback: "靠墙踝背屈：右脚离墙 4 cm".to_owned(),
            reasoning: "踝背屈受限".to_owned(),
            uncertainty: "没排除髋".to_owned(),
        }
    }

    #[test]
    fn a_finding_and_its_log_land_together_and_the_log_points_at_the_finding() {
        let mut temp = TempStore::new("evidence-record");
        let (finding, logged) = temp
            .store()
            .record_with_evidence(
                draft("gluteus-medius", Some(Side::Left), 100, Tension::Weak),
                evidence(
                    EvidenceKind::Record,
                    "gluteus-medius",
                    Some(Side::Left),
                    100,
                ),
            )
            .expect("写一条");

        assert_eq!(logged.finding, Some(finding.id));
        assert_eq!(logged.kind, EvidenceKind::Record);

        // 换一个 Store 实例读：日志与判定都在文件里。
        let reopened = temp.reopen();
        assert_eq!(reopened.evidence_log().expect("日志").len(), 1);
        assert_eq!(reopened.findings().expect("判定").len(), 1);
    }

    #[test]
    fn a_blank_section_writes_neither_the_finding_nor_the_log() {
        let temp = TempStore::new("evidence-blank");
        let store = temp.store();
        let mut blank = evidence(
            EvidenceKind::Record,
            "gluteus-medius",
            Some(Side::Left),
            100,
        );
        blank.uncertainty = "  ".to_owned();

        let error = store
            .record_with_evidence(
                draft("gluteus-medius", Some(Side::Left), 100, Tension::Weak),
                blank,
            )
            .unwrap_err();
        assert_eq!(
            error,
            StoreError::Domain(DomainError::EmptyEvidenceSection("不确定之处"))
        );
        assert!(store.findings().expect("判定").is_empty());
        assert!(store.evidence_log().expect("日志").is_empty());
    }

    #[test]
    fn retracting_writes_a_retraction_and_its_log_in_one_go() {
        let temp = TempStore::new("evidence-retract");
        let store = temp.store();
        let (finding, _) = store
            .record_with_evidence(
                draft("soleus", Some(Side::Left), 100, Tension::Weak),
                evidence(EvidenceKind::Record, "soleus", Some(Side::Left), 100),
            )
            .expect("写一条");

        let (retract, logged) = store
            .retract_with_evidence(
                finding.id,
                "把比目鱼肌看成腓肠肌了",
                200,
                evidence(EvidenceKind::Retract, "soleus", Some(Side::Left), 200),
            )
            .expect("撤回");
        assert_eq!(retract.finding, finding.id);
        assert_eq!(logged.kind, EvidenceKind::Retract);
        assert_eq!(logged.finding, Some(finding.id));
        assert_eq!(store.evidence_log().expect("日志").len(), 2);

        // 撤回失败时不写日志：再撤一次会被拒。
        let twice = store
            .retract_with_evidence(
                finding.id,
                "又反悔了",
                300,
                evidence(EvidenceKind::Retract, "soleus", Some(Side::Left), 300),
            )
            .unwrap_err();
        assert_eq!(
            twice,
            StoreError::Domain(DomainError::AlreadyRetracted(finding.id))
        );
        assert_eq!(store.evidence_log().expect("日志").len(), 2);
    }

    #[test]
    fn search_filters_by_site_date_keyword_and_axis_newest_first() {
        let temp = TempStore::new("evidence-search");
        let store = temp.store();
        let mut first = evidence(EvidenceKind::Record, "soleus", Some(Side::Left), 100);
        first.user_said = "早上小腿外侧紧".to_owned();
        store
            .record_with_evidence(
                draft("soleus", Some(Side::Left), 100, Tension::Tight),
                first,
            )
            .expect("第一条");
        let (second, _) = store
            .record_with_evidence(
                draft("gluteus-medius", Some(Side::Left), 200, Tension::Weak),
                evidence(
                    EvidenceKind::Record,
                    "gluteus-medius",
                    Some(Side::Left),
                    200,
                ),
            )
            .expect("第二条");

        let by_site = store
            .search_evidence(&EvidenceQuery {
                site: Some("gluteus-medius".to_owned()),
                ..EvidenceQuery::default()
            })
            .expect("检索");
        assert_eq!(by_site.len(), 1);
        assert_eq!(by_site[0].finding, Some(second.id));

        let both = store
            .search_evidence(&EvidenceQuery::default())
            .expect("检索");
        assert_eq!(
            both.iter().map(|row| row.at).collect::<Vec<_>>(),
            vec![200, 100],
            "最近的在前"
        );

        let in_range = store
            .search_evidence(&EvidenceQuery {
                from: Some(200),
                ..EvidenceQuery::default()
            })
            .expect("检索");
        assert_eq!(in_range.len(), 1);
        assert_eq!(in_range[0].site, "gluteus-medius");

        let keyword = store
            .search_evidence(&EvidenceQuery {
                contains: Some("小腿".to_owned()),
                ..EvidenceQuery::default()
            })
            .expect("检索");
        assert_eq!(keyword.len(), 1);
        assert_eq!(keyword[0].site, "soleus");

        // 轴过滤靠它服务的判定：两条都测了张力，收紧只看得到受限的那条。
        let axis = store
            .search_evidence(&EvidenceQuery {
                axis: Some(Axis::Tension),
                ..EvidenceQuery::default()
            })
            .expect("检索");
        assert_eq!(axis.len(), 2);
        let pain = store
            .search_evidence(&EvidenceQuery {
                axis: Some(Axis::Pain),
                ..EvidenceQuery::default()
            })
            .expect("检索");
        assert!(pain.is_empty(), "没测过疼痛轴的判定不该命中");
    }

    #[test]
    fn search_never_returns_more_than_the_hard_limit() {
        let temp = TempStore::new("evidence-limit");
        let store = temp.store();
        for step in 0..25 {
            store
                .record_with_evidence(
                    draft("soleus", Some(Side::Left), 100 + step, Tension::Weak),
                    evidence(EvidenceKind::Record, "soleus", Some(Side::Left), 100 + step),
                )
                .expect("写一条");
        }
        let rows = store
            .search_evidence(&EvidenceQuery {
                site: Some("soleus".to_owned()),
                limit: Some(500),
                ..EvidenceQuery::default()
            })
            .expect("检索");
        assert_eq!(rows.len(), crate::domain::tool::MAX_LIMIT);
    }
}
