use super::*;

impl TaskStore {
    /// Admit the exact Created/Queued snapshot once, under the same lock as
    /// cancellation and terminal transitions. A stale caller must not start work.
    pub fn admit_standard_task_run(
        &self,
        expected: &TaskRecord,
        runtime_deadline: Option<RuntimeDeadline>,
    ) -> Result<Option<TaskRecord>> {
        if !matches!(expected.status, TaskStatus::Created | TaskStatus::Queued) {
            bail!("standard task.run admission requires Created or Queued status");
        }
        let Some(initial) = self.get_task(&expected.task_id)? else {
            bail!("task not found: {}", expected.task_id);
        };
        if initial.run_id != expected.run_id {
            return Ok(None);
        }
        let _lock = self.acquire_run_terminal_mutation_lock(&initial.run_id)?;
        self.recover_terminal_transition_marker_for_run_locked(&initial.run_id)?;
        let Some(mut record) = self.read_task_state_by_run_id_raw(&initial.run_id)? else {
            bail!("task not found after admission lock: {}", expected.task_id);
        };
        if record.task_id != expected.task_id
            || record.run_id != expected.run_id
            || record.status != expected.status
            || record.updated_at != expected.updated_at
            || record.execution_constraints != expected.execution_constraints
        {
            return Ok(None);
        }
        let deadline =
            reconcile_runtime_deadline(record.runtime_deadline.as_ref(), runtime_deadline)?;
        record.runtime_deadline = deadline.clone();
        record.status = TaskStatus::Running;
        record.updated_at = timestamp()?;
        self.write_task_state(&record)?;
        let payload = deadline.map(|deadline| {
            serde_json::json!({
                "runtime_deadline": deadline,
                "deadline_scope": "task_run",
                "deadline_persisted": true
            })
        });
        self.append_task_event_with_payload(&record, LedgerEventKind::TaskRunning, payload)?;
        Ok(Some(record))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};

    fn created(store: &TaskStore) -> TaskRecord {
        store
            .start_task(TaskStartParams {
                execution_constraints: None,
                goal: "atomic standard admission".into(),
                mode_id: None,
                verification_recovery_source: None,
                patch_apply_recovery_source: None,
                verification_recovery_retry_source: None,
                llm_provider_failure_retry_source: None,
                product_continuation_source: None,
            })
            .expect("start task")
    }

    fn constrained(store: &TaskStore) -> TaskRecord {
        store
            .start_task(TaskStartParams {
                execution_constraints: Some(brownie_protocol::TaskExecutionConstraints {
                    write_paths: Some(vec!["notes.txt".into()]),
                    max_workspace_reads: Some(2),
                    ..Default::default()
                }),
                goal: "update notes".into(),
                mode_id: None,
                verification_recovery_source: None,
                patch_apply_recovery_source: None,
                verification_recovery_retry_source: None,
                llm_provider_failure_retry_source: None,
                product_continuation_source: None,
            })
            .expect("constrained task")
    }

    #[test]
    fn execution_constraints_are_inherited_by_child_and_provider_recovery() {
        let temp = tempfile::tempdir().unwrap();
        let store = TaskStore::new(temp.path());
        let parent = constrained(&store);
        let child = store
            .start_child_task(ChildTaskStartParams {
                goal: "child notes".into(),
                mode_id: None,
                parent_task_id: parent.task_id.clone(),
                parent_run_id: parent.run_id.clone(),
                source_candidate_id: "candidate".into(),
                source_handoff_envelope_id: "handoff".into(),
                source_handoff_envelope_fingerprint: "fixture-fingerprint".into(),
                source_intent_summary: None,
                recovery_cycle_provenance: None,
                external_modepack_child_provenance: None,
            })
            .unwrap();
        assert_eq!(child.execution_constraints, parent.execution_constraints);
        let params = LlmProviderFailureRetryTaskStartParams {
            goal: "retry notes".into(),
            mode_id: None,
            provenance: LlmProviderFailureRetryProvenance {
                source_task_id: parent.task_id.clone(),
                source_run_id: parent.run_id.clone(),
                failure_fingerprint:
                    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into(),
                failure_class: "transport".into(),
                provider: "fixture".into(),
                model: "fixture".into(),
                request_phase: "initial".into(),
                retryable: true,
            },
        };
        let recovery = store
            .start_llm_provider_failure_retry_task(params.clone())
            .unwrap();
        assert_eq!(
            recovery.record.execution_constraints,
            parent.execution_constraints
        );
        let replay = TaskStore::new(temp.path())
            .start_llm_provider_failure_retry_task(params)
            .unwrap();
        assert!(replay.replayed);
        assert_eq!(replay.record, recovery.record);
    }

    #[test]
    fn execution_constraints_missing_recovery_source_cannot_create_unrestricted_child() {
        let temp = tempfile::tempdir().unwrap();
        let store = TaskStore::new(temp.path());
        let result = store.start_child_task(ChildTaskStartParams {
            goal: "child notes".into(),
            mode_id: None,
            parent_task_id: "missing".into(),
            parent_run_id: "missing".into(),
            source_candidate_id: "candidate".into(),
            source_handoff_envelope_id: "handoff".into(),
            source_handoff_envelope_fingerprint: "fixture-fingerprint".into(),
            source_intent_summary: None,
            recovery_cycle_provenance: None,
            external_modepack_child_provenance: None,
        });
        assert!(result.is_err());
        assert!(store.list_tasks().unwrap().is_empty());
    }

    #[test]
    fn execution_constraints_survive_reopen_and_running_transition() {
        let temp = tempfile::tempdir().unwrap();
        let record = constrained(&TaskStore::new(temp.path()));
        let reopened = TaskStore::new(temp.path());
        let loaded = reopened.get_task(&record.task_id).unwrap().unwrap();
        assert_eq!(loaded.execution_constraints, record.execution_constraints);
        let running = reopened
            .admit_standard_task_run(&loaded, None)
            .unwrap()
            .unwrap();
        assert_eq!(running.execution_constraints, record.execution_constraints);
        let events = reopened.read_ledger_events(&record.run_id).unwrap();
        let started = events
            .iter()
            .find(|event| event.kind == LedgerEventKind::TaskStarted)
            .unwrap();
        assert_eq!(
            started.payload.as_ref().unwrap()["execution_constraints"],
            serde_json::to_value(record.execution_constraints.unwrap()).unwrap()
        );
    }

    #[test]
    fn execution_constraints_reject_removed_changed_and_unbound_state() {
        for replacement in [
            serde_json::Value::Null,
            serde_json::json!({"write_paths": ["other.txt"]}),
            serde_json::json!({"write_paths": ["../escape"]}),
        ] {
            let temp = tempfile::tempdir().unwrap();
            let store = TaskStore::new(temp.path());
            let record = constrained(&store);
            let state_path = store.run_dir(&record.run_id).join("state.json");
            let mut state: serde_json::Value =
                serde_json::from_slice(&fs::read(&state_path).unwrap()).unwrap();
            state["execution_constraints"] = replacement;
            fs::write(&state_path, serde_json::to_vec(&state).unwrap()).unwrap();
            assert!(TaskStore::new(temp.path())
                .get_task(&record.task_id)
                .is_err());
        }
        let temp = tempfile::tempdir().unwrap();
        let store = TaskStore::new(temp.path());
        let record = constrained(&store);
        fs::remove_file(store.run_dir(&record.run_id).join("ledger.jsonl")).unwrap();
        assert!(store.get_task(&record.task_id).is_err());
    }

    #[test]
    fn execution_constraints_reject_stale_admission_without_running_event() {
        let temp = tempfile::tempdir().unwrap();
        let store = TaskStore::new(temp.path());
        let record = constrained(&store);
        let mut stale = record.clone();
        stale.execution_constraints = None;
        assert!(store
            .admit_standard_task_run(&stale, None)
            .unwrap()
            .is_none());
        assert!(!store
            .read_ledger_events(&record.run_id)
            .unwrap()
            .iter()
            .any(|event| event.kind == LedgerEventKind::TaskRunning));
        assert_eq!(store.get_task(&record.task_id).unwrap().unwrap(), record);
    }

    #[test]
    fn execution_constraints_invalid_start_has_no_persisted_task() {
        let temp = tempfile::tempdir().unwrap();
        let store = TaskStore::new(temp.path());
        let result = store.start_task(TaskStartParams {
            execution_constraints: Some(brownie_protocol::TaskExecutionConstraints {
                write_paths: Some(vec!["../escape".into()]),
                ..Default::default()
            }),
            goal: "invalid scope".into(),
            mode_id: None,
            verification_recovery_source: None,
            patch_apply_recovery_source: None,
            verification_recovery_retry_source: None,
            llm_provider_failure_retry_source: None,
            product_continuation_source: None,
        });
        assert!(result.is_err());
        assert!(!store.runs_dir().exists());
    }

    #[test]
    fn standard_task_run_concurrent_admission_persists_one_running_transition() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = Arc::new(TaskStore::new(temp.path()));
        let record = created(&store);
        let barrier = Arc::new(Barrier::new(9));
        let threads = (0..8)
            .map(|_| {
                let store = Arc::clone(&store);
                let barrier = Arc::clone(&barrier);
                let expected = record.clone();
                thread::spawn(move || {
                    barrier.wait();
                    store.admit_standard_task_run(&expected, None)
                })
            })
            .collect::<Vec<_>>();
        barrier.wait();
        let results = threads
            .into_iter()
            .map(|thread| thread.join().expect("admission thread").expect("admission"))
            .collect::<Vec<_>>();
        assert_eq!(results.iter().filter(|result| result.is_some()).count(), 1);
        let events = store.read_ledger_events(&record.run_id).expect("ledger");
        assert_eq!(
            events
                .iter()
                .filter(|event| event.kind == LedgerEventKind::TaskRunning)
                .count(),
            1
        );
        assert_eq!(
            store
                .get_task(&record.task_id)
                .expect("lookup")
                .expect("task")
                .status,
            TaskStatus::Running
        );
    }

    #[test]
    fn standard_task_run_rejects_stale_snapshot_without_mutation() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = TaskStore::new(temp.path());
        let record = created(&store);
        let mut stale = record.clone();
        stale.updated_at = "2000-01-01T00:00:00Z".into();
        assert!(store
            .admit_standard_task_run(&stale, None)
            .expect("stale")
            .is_none());
        assert_eq!(
            store.get_task(&record.task_id).expect("lookup"),
            Some(record.clone())
        );
        let cancelled = store
            .update_task_status(
                &record.task_id,
                TaskStatus::Cancelled,
                LedgerEventKind::TaskCancelled,
            )
            .expect("cancel wins");
        assert!(store
            .admit_standard_task_run(&record, None)
            .expect("stale")
            .is_none());
        assert_eq!(
            store.get_task(&record.task_id).expect("lookup"),
            Some(cancelled)
        );
        assert!(!store
            .read_ledger_events(&record.run_id)
            .expect("ledger")
            .iter()
            .any(|event| event.kind == LedgerEventKind::TaskRunning));
    }

    #[test]
    fn standard_task_run_preserves_runtime_deadline_and_queued_admission() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = TaskStore::new(temp.path());
        let record = created(&store);
        let queued = store
            .start_child_task(ChildTaskStartParams {
                goal: "queued admission fixture".into(),
                mode_id: None,
                parent_task_id: record.task_id.clone(),
                parent_run_id: record.run_id.clone(),
                source_candidate_id: "candidate_admission_fixture".into(),
                source_handoff_envelope_id: "handoff_admission_fixture".into(),
                source_handoff_envelope_fingerprint: "fixture-fingerprint".into(),
                source_intent_summary: None,
                recovery_cycle_provenance: None,
                external_modepack_child_provenance: None,
            })
            .expect("queued fixture");
        let deadline = RuntimeDeadline {
            deadline_id: "standard_admission_deadline".into(),
            expires_at: "2099-01-01T00:00:00Z".into(),
        };
        let running = store
            .admit_standard_task_run(&queued, Some(deadline.clone()))
            .expect("admit queued")
            .expect("winner");
        assert_eq!(running.runtime_deadline, Some(deadline.clone()));
        let events = store.read_ledger_events(&queued.run_id).expect("ledger");
        let event = events.last().expect("running event");
        assert_eq!(event.kind, LedgerEventKind::TaskRunning);
        assert_eq!(
            event.payload.as_ref().expect("deadline payload")["runtime_deadline"],
            serde_json::to_value(deadline).expect("deadline")
        );
        assert!(store
            .admit_standard_task_run(&queued, None)
            .expect("replay")
            .is_none());
    }
}
