use super::*;

#[derive(Debug)]
pub(super) enum TaskRunAdmissionRejection {
    InvalidParams(&'static str),
    Internal(String),
}

pub(super) enum TaskRunAdmission {
    Standard,
    ParentJoinContinuation(ParentJoinContinuationAdmission),
}

pub(super) fn task_run_admission_rejection_message(error: TaskRunAdmissionRejection) -> String {
    match error {
        TaskRunAdmissionRejection::InvalidParams(message) => message.to_string(),
        TaskRunAdmissionRejection::Internal(message) => message,
    }
}

pub(super) struct ParentJoinContinuationAdmission {
    child_completion_summaries: Vec<String>,
    pub(super) child_completion_fingerprint: String,
    pub(super) child_completion_fingerprint_input_count: usize,
    pub(super) child_completion_child_count: usize,
    pub(super) child_terminal_completed_count: usize,
    pub(super) child_terminal_failed_count: usize,
    pub(super) child_recovery_cycle_depth: usize,
}

impl TaskRunAdmission {
    pub(super) fn child_completion_summaries(&self) -> Vec<String> {
        match self {
            Self::Standard => Vec::new(),
            Self::ParentJoinContinuation(admission) => admission.child_completion_summaries.clone(),
        }
    }

    pub(super) fn parent_join_continuation_consumption(
        &self,
    ) -> Option<ParentJoinContinuationConsumption> {
        match self {
            Self::Standard => None,
            Self::ParentJoinContinuation(admission) => Some(ParentJoinContinuationConsumption {
                child_completion_fingerprint: admission.child_completion_fingerprint.clone(),
                child_completion_fingerprint_input_count: admission
                    .child_completion_fingerprint_input_count,
                child_completion_child_count: admission.child_completion_child_count,
                child_terminal_completed_count: admission.child_terminal_completed_count,
                child_terminal_failed_count: admission.child_terminal_failed_count,
                child_recovery_cycle_depth: admission.child_recovery_cycle_depth,
            }),
        }
    }

    pub(super) fn parent_join_continuation_materialization(
        &self,
    ) -> Option<ParentJoinContinuationMaterialization> {
        match self {
            Self::Standard => None,
            Self::ParentJoinContinuation(admission) => {
                Some(ParentJoinContinuationMaterialization {
                    admission_id: String::new(),
                    child_completion_fingerprint: admission.child_completion_fingerprint.clone(),
                    child_completion_fingerprint_input_count: admission
                        .child_completion_fingerprint_input_count,
                    child_completion_child_count: admission.child_completion_child_count,
                    child_terminal_completed_count: admission.child_terminal_completed_count,
                    child_terminal_failed_count: admission.child_terminal_failed_count,
                    child_recovery_cycle_depth: admission.child_recovery_cycle_depth,
                })
            }
        }
    }
}

pub(super) struct ParentJoinContinuationConsumption {
    pub(super) child_completion_fingerprint: String,
    pub(super) child_completion_fingerprint_input_count: usize,
    pub(super) child_completion_child_count: usize,
    pub(super) child_terminal_completed_count: usize,
    pub(super) child_terminal_failed_count: usize,
    pub(super) child_recovery_cycle_depth: usize,
}

#[derive(Clone)]
pub(super) struct ParentJoinContinuationMaterialization {
    pub(super) admission_id: String,
    pub(super) child_completion_fingerprint: String,
    pub(super) child_completion_fingerprint_input_count: usize,
    pub(super) child_completion_child_count: usize,
    pub(super) child_terminal_completed_count: usize,
    pub(super) child_terminal_failed_count: usize,
    pub(super) child_recovery_cycle_depth: usize,
}

pub(super) fn validate_task_run_admission(
    record: &TaskRecord,
    store: &BrownieStore,
) -> Result<TaskRunAdmission, TaskRunAdmissionRejection> {
    match record.status {
        TaskStatus::Created => Ok(TaskRunAdmission::Standard),
        TaskStatus::Queued => {
            validate_controlled_queued_child_task_provenance(record, store)?;
            Ok(TaskRunAdmission::Standard)
        }
        TaskStatus::Completed => Ok(TaskRunAdmission::ParentJoinContinuation(
            validate_completed_parent_join_continuation_admission(record, store)?,
        )),
        TaskStatus::Running | TaskStatus::Failed | TaskStatus::Cancelled => {
            Err(TaskRunAdmissionRejection::InvalidParams(
                "invalid params: task must be Created, a controlled Queued child task, or a completed parent with completed controlled child tasks or failed controlled child tasks",
            ))
        }
    }
}

pub(super) fn validate_completed_parent_join_continuation_admission(
    record: &TaskRecord,
    store: &BrownieStore,
) -> Result<ParentJoinContinuationAdmission, TaskRunAdmissionRejection> {
    if record.parent_run_id.is_some() {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: completed child task cannot be rerun",
        ));
    }

    let mut child_tasks = store
        .tasks()
        .list_tasks()
        .map_err(|error| TaskRunAdmissionRejection::Internal(error.to_string()))?
        .into_iter()
        .filter(|task| task.parent_run_id.as_deref() == Some(record.run_id.as_str()))
        .collect::<Vec<_>>();
    child_tasks.sort_by(|a, b| {
        a.source_candidate_id
            .cmp(&b.source_candidate_id)
            .then(a.task_id.cmp(&b.task_id))
    });

    if child_tasks.is_empty() {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: parent join continuation requires completed controlled child tasks or failed controlled child tasks",
        ));
    }

    for child in &child_tasks {
        validate_controlled_queued_child_task_provenance(child, store)?;
        if !matches!(child.status, TaskStatus::Completed | TaskStatus::Failed) {
            return Err(TaskRunAdmissionRejection::InvalidParams(
                "invalid params: parent join continuation requires completed controlled child tasks or failed controlled child tasks",
            ));
        }
        if !child_has_terminal_parent_join_outcome(store, child)? {
            return Err(TaskRunAdmissionRejection::InvalidParams(
                "invalid params: parent join continuation requires completed controlled child tasks or failed controlled child tasks",
            ));
        }
    }

    let child_evidence = child_tasks
        .iter()
        .map(|child| parent_join_child_completion_evidence(store, child))
        .collect::<Result<Vec<_>, _>>()?;
    let child_terminal_completed_count = child_tasks
        .iter()
        .filter(|child| child.status == TaskStatus::Completed)
        .count();
    let child_terminal_failed_count = child_tasks
        .iter()
        .filter(|child| child.status == TaskStatus::Failed)
        .count();
    let child_recovery_cycle_depth = if child_terminal_failed_count > 0 {
        child_terminal_completed_count
    } else {
        0
    };
    let (child_completion_fingerprint, child_completion_fingerprint_input_count) =
        parent_join_child_completion_fingerprint(&child_evidence);
    if parent_join_child_completion_fingerprint_consumed(
        store,
        record,
        &child_completion_fingerprint,
    )? {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: parent join continuation for this completed child result set has already been consumed",
        ));
    }

    let mut summaries = child_evidence
        .iter()
        .take(MAX_PARENT_JOIN_CHILD_CONTEXT_SUMMARIES)
        .map(|evidence| evidence.summary.clone())
        .collect::<Vec<_>>();
    if child_tasks.len() > MAX_PARENT_JOIN_CHILD_CONTEXT_SUMMARIES {
        summaries.push(format!(
            "terminal_child_summary_omitted count={}",
            child_tasks.len() - MAX_PARENT_JOIN_CHILD_CONTEXT_SUMMARIES
        ));
    }
    Ok(ParentJoinContinuationAdmission {
        child_completion_summaries: summaries,
        child_completion_fingerprint,
        child_completion_fingerprint_input_count,
        child_completion_child_count: child_tasks.len(),
        child_terminal_completed_count,
        child_terminal_failed_count,
        child_recovery_cycle_depth,
    })
}

pub(super) fn child_has_terminal_parent_join_outcome(
    store: &BrownieStore,
    child: &TaskRecord,
) -> Result<bool, TaskRunAdmissionRejection> {
    let events = store
        .tasks()
        .read_ledger_events(&child.run_id)
        .map_err(|error| TaskRunAdmissionRejection::Internal(error.to_string()))?;
    match child.status {
        TaskStatus::Completed => {
            let has_completed_agent_loop = events.iter().rev().any(|event| {
                event.kind == LedgerEventKind::AgentLoopCompleted
                    && event
                        .payload
                        .as_ref()
                        .and_then(|payload| payload.get("final_state"))
                        .and_then(Value::as_str)
                        == Some("Completed")
            });
            let has_task_completed = events
                .iter()
                .any(|event| event.kind == LedgerEventKind::TaskCompleted);
            Ok(has_completed_agent_loop && has_task_completed)
        }
        TaskStatus::Failed => {
            let has_task_failed = events
                .iter()
                .any(|event| event.kind == LedgerEventKind::TaskFailed);
            let has_failed_agent_loop = events.iter().rev().any(|event| {
                event.kind == LedgerEventKind::AgentLoopCompleted
                    && event
                        .payload
                        .as_ref()
                        .and_then(|payload| payload.get("final_state"))
                        .and_then(Value::as_str)
                        == Some("Failed")
            });
            let has_redacted_failure_event = events.iter().any(|event| {
                matches!(
                    event.kind,
                    LedgerEventKind::LlmRequestFailed | LedgerEventKind::SecondPassLlmRequestFailed
                )
            });
            Ok(has_task_failed && (has_failed_agent_loop || has_redacted_failure_event))
        }
        TaskStatus::Created | TaskStatus::Queued | TaskStatus::Running | TaskStatus::Cancelled => {
            Ok(false)
        }
    }
}

pub(super) struct ParentJoinChildCompletionEvidence {
    pub(super) summary: String,
    pub(super) fingerprint_inputs: Vec<String>,
}

pub(super) fn parent_join_child_completion_evidence(
    store: &BrownieStore,
    child: &TaskRecord,
) -> Result<ParentJoinChildCompletionEvidence, TaskRunAdmissionRejection> {
    let events = store
        .tasks()
        .read_ledger_events(&child.run_id)
        .map_err(|error| TaskRunAdmissionRejection::Internal(error.to_string()))?;
    let summary =
        child_task_inspect_summary(store, child).map_err(TaskRunAdmissionRejection::Internal)?;
    let source_candidate_id = summary.source_candidate_id.as_deref().unwrap_or("<none>");
    let source_handoff_envelope_id = summary
        .source_handoff_envelope_id
        .as_deref()
        .unwrap_or("<none>");
    let source_handoff_envelope_fingerprint = summary
        .source_handoff_envelope_fingerprint
        .as_deref()
        .unwrap_or("<none>");
    let parent_task_id = summary.parent_task_id.as_deref().unwrap_or("<none>");
    let parent_run_id = summary.parent_run_id.as_deref().unwrap_or("<none>");
    let status = format!("{:?}", summary.status);
    let terminal_outcome_kind = match summary.status {
        TaskStatus::Completed => "completed_child",
        TaskStatus::Failed => "failed_child",
        TaskStatus::Created | TaskStatus::Queued | TaskStatus::Running | TaskStatus::Cancelled => {
            "nonterminal_child"
        }
    };
    let (terminal_final_state, terminal_result_fingerprint, summary_text) = match summary.status {
        TaskStatus::Completed => {
            let completion_final_state = summary
                .completion_final_state
                .as_deref()
                .unwrap_or("<none>")
                .to_string();
            let completion_result_fingerprint = summary
                .completion_result_fingerprint
                .as_deref()
                .unwrap_or("<none>")
                .to_string();
            let summary_text = format!(
                "completed_child task_id={} run_id={} status={:?} source_candidate_id={} source_handoff_envelope_fingerprint={} completion_final_state={} completion_result_fingerprint={} completion_summary_preview={} final_response_preview={}",
                summary.task_id,
                summary.run_id,
                summary.status,
                summary
                    .source_candidate_id
                    .as_deref()
                    .unwrap_or("<none>"),
                summary
                    .source_handoff_envelope_fingerprint
                    .as_deref()
                    .unwrap_or("<none>"),
                completion_final_state,
                completion_result_fingerprint,
                summary
                    .completion_summary_preview
                    .as_deref()
                    .unwrap_or("<none>"),
                summary
                    .final_response_preview
                    .as_deref()
                    .unwrap_or("<none>")
            );
            (
                completion_final_state,
                completion_result_fingerprint,
                summary_text,
            )
        }
        TaskStatus::Failed => {
            let failure_final_state = summary
                .completion_final_state
                .as_deref()
                .filter(|state| *state == "Failed")
                .unwrap_or("Failed")
                .to_string();
            let failure_result_fingerprint = child_failure_result_fingerprint(
                &events,
                summary.completion_result_fingerprint.as_deref(),
            );
            let failure_summary_preview = child_failure_summary_preview(&events)
                .unwrap_or_else(|| "failed_child_summary_unavailable".to_string());
            let summary_text = format!(
                "failed_child task_id={} run_id={} status={:?} source_candidate_id={} source_handoff_envelope_fingerprint={} failure_final_state={} failure_result_fingerprint={} failure_summary_preview={} final_response_preview={}",
                summary.task_id,
                summary.run_id,
                summary.status,
                summary
                    .source_candidate_id
                    .as_deref()
                    .unwrap_or("<none>"),
                summary
                    .source_handoff_envelope_fingerprint
                    .as_deref()
                    .unwrap_or("<none>"),
                failure_final_state,
                failure_result_fingerprint,
                failure_summary_preview,
                summary
                    .final_response_preview
                    .as_deref()
                    .unwrap_or("<none>")
            );
            (
                failure_final_state,
                failure_result_fingerprint,
                summary_text,
            )
        }
        TaskStatus::Created | TaskStatus::Queued | TaskStatus::Running | TaskStatus::Cancelled => (
            "<none>".to_string(),
            "<none>".to_string(),
            format!(
                "nonterminal_child task_id={} run_id={} status={:?}",
                summary.task_id, summary.run_id, summary.status
            ),
        ),
    };
    Ok(ParentJoinChildCompletionEvidence {
        summary: summary_text,
        fingerprint_inputs: vec![
            format!("task_id={}", summary.task_id),
            format!("run_id={}", summary.run_id),
            format!("status={status}"),
            format!("terminal_outcome_kind={terminal_outcome_kind}"),
            format!("parent_task_id={parent_task_id}"),
            format!("parent_run_id={parent_run_id}"),
            format!("source_candidate_id={source_candidate_id}"),
            format!("source_handoff_envelope_id={source_handoff_envelope_id}"),
            format!("source_handoff_envelope_fingerprint={source_handoff_envelope_fingerprint}"),
            format!("terminal_final_state={terminal_final_state}"),
            format!("terminal_result_fingerprint={terminal_result_fingerprint}"),
        ],
    })
}

fn child_failure_summary_preview(events: &[LedgerEvent]) -> Option<String> {
    events
        .iter()
        .rev()
        .find(|event| {
            matches!(
                event.kind,
                LedgerEventKind::LlmRequestFailed | LedgerEventKind::SecondPassLlmRequestFailed
            )
        })
        .and_then(|event| event.payload.as_ref())
        .and_then(|payload| payload.get("reason"))
        .and_then(Value::as_str)
        .map(redact_secret)
        .map(|reason| preview_with_limit(&reason, CHILD_FAILURE_SUMMARY_PREVIEW_CHARS))
}

pub(super) fn child_failure_result_fingerprint(
    events: &[LedgerEvent],
    completion_result_fingerprint: Option<&str>,
) -> String {
    if let Some(fingerprint) =
        completion_result_fingerprint.filter(|fingerprint| fingerprint.starts_with("sha256:"))
    {
        return fingerprint.to_string();
    }

    let failure_event = events.iter().rev().find(|event| {
        matches!(
            event.kind,
            LedgerEventKind::LlmRequestFailed | LedgerEventKind::SecondPassLlmRequestFailed
        )
    });
    let payload = failure_event.and_then(|event| event.payload.as_ref());
    let reason = payload
        .and_then(|payload| payload.get("reason"))
        .and_then(Value::as_str)
        .map(redact_secret)
        .unwrap_or_else(|| "failed_child_reason_unavailable".to_string());
    let reason_sha256 = payload
        .and_then(|payload| payload.get("reason_sha256"))
        .and_then(Value::as_str)
        .filter(|fingerprint| fingerprint.starts_with("sha256:"))
        .map(ToString::to_string)
        .unwrap_or_else(|| format!("sha256:{}", hex_sha256(reason.as_bytes())));
    let reason_chars = payload
        .and_then(|payload| payload.get("reason_chars"))
        .and_then(Value::as_u64)
        .unwrap_or_else(|| reason.chars().count() as u64);
    let provider = payload
        .and_then(|payload| payload.get("provider"))
        .and_then(Value::as_str)
        .unwrap_or("<none>");
    let model = payload
        .and_then(|payload| payload.get("model"))
        .and_then(Value::as_str)
        .unwrap_or("<none>");
    let failure_event_kind = failure_event
        .map(|event| format!("{:?}", event.kind))
        .unwrap_or_else(|| "TaskFailed".to_string());
    let canonical = json!({
        "version": "child_failure_result_fingerprint_v1",
        "terminal_status": "Failed",
        "failure_event_kind": failure_event_kind,
        "provider": provider,
        "model": model,
        "reason_chars": reason_chars,
        "reason_sha256": reason_sha256,
    });
    format!("sha256:{}", hex_sha256(canonical.to_string().as_bytes()))
}

pub(super) fn parent_join_child_completion_fingerprint(
    child_evidence: &[ParentJoinChildCompletionEvidence],
) -> (String, usize) {
    let mut inputs = vec![
        "parent_join_child_completion_fingerprint_v3_terminal_outcome".to_string(),
        format!("child_count={}", child_evidence.len()),
    ];
    for evidence in child_evidence {
        inputs.extend(evidence.fingerprint_inputs.iter().cloned());
    }
    let input_count = inputs.len();
    (
        format!("sha256:{}", hex_sha256(inputs.join("\n").as_bytes())),
        input_count,
    )
}

pub(super) fn parent_join_child_completion_fingerprint_consumed(
    store: &BrownieStore,
    record: &TaskRecord,
    child_completion_fingerprint: &str,
) -> Result<bool, TaskRunAdmissionRejection> {
    let events = store
        .tasks()
        .read_ledger_events(&record.run_id)
        .map_err(|error| TaskRunAdmissionRejection::Internal(error.to_string()))?;
    Ok(events.iter().any(|event| {
        if event.kind != LedgerEventKind::ParentJoinContinuationFingerprintConsumed {
            return false;
        }
        let Some(payload) = event.payload.as_ref() else {
            return false;
        };
        if payload
            .get("child_completion_fingerprint")
            .and_then(Value::as_str)
            != Some(child_completion_fingerprint)
        {
            return false;
        }
        let Some(admission_id) = payload.get("admission_id").and_then(Value::as_str) else {
            return true;
        };
        let Some(running_index) = events.iter().position(|candidate| {
            candidate.kind == LedgerEventKind::TaskRunning
                && candidate
                    .payload
                    .as_ref()
                    .and_then(|payload| payload.get("admission_id"))
                    .and_then(Value::as_str)
                    == Some(admission_id)
        }) else {
            return false;
        };
        for candidate in events.iter().skip(running_index + 1) {
            if candidate.kind == LedgerEventKind::ParentJoinContinuationFingerprintConsumed {
                return false;
            }
            if matches!(
                candidate.kind,
                LedgerEventKind::TaskCompleted
                    | LedgerEventKind::TaskFailed
                    | LedgerEventKind::TaskCancelled
            ) {
                return true;
            }
        }
        false
    }))
}

pub(super) fn validate_controlled_queued_child_task_provenance(
    record: &TaskRecord,
    store: &BrownieStore,
) -> Result<(), TaskRunAdmissionRejection> {
    let parent_task_id = required_task_run_provenance(record.parent_task_id.as_deref())?;
    let parent_run_id = required_task_run_provenance(record.parent_run_id.as_deref())?;
    let source_candidate_id = required_task_run_provenance(record.source_candidate_id.as_deref())?;
    let source_handoff_envelope_id =
        required_task_run_provenance(record.source_handoff_envelope_id.as_deref())?;
    let source_handoff_envelope_fingerprint =
        required_task_run_provenance(record.source_handoff_envelope_fingerprint.as_deref())?;

    let parent = store
        .tasks()
        .get_task(parent_task_id)
        .map_err(|error| TaskRunAdmissionRejection::Internal(error.to_string()))?
        .ok_or(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: queued child task parent provenance is invalid",
        ))?;
    if parent.run_id != parent_run_id {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: queued child task parent provenance is invalid",
        ));
    }

    let parent_events = store
        .tasks()
        .read_ledger_events(parent_run_id)
        .map_err(|error| TaskRunAdmissionRejection::Internal(error.to_string()))?;
    let covered_by_handoff_envelope = parent_events.iter().any(|event| {
        if event.kind != LedgerEventKind::SubtaskDispatchHandoffEnvelopeRecorded {
            return false;
        }
        let Some(payload) = event.payload.as_ref() else {
            return false;
        };
        payload.get("handoff_envelope_id").and_then(Value::as_str)
            == Some(source_handoff_envelope_id)
            && payload
                .get("handoff_envelope_fingerprint")
                .and_then(Value::as_str)
                == Some(source_handoff_envelope_fingerprint)
            && (payload_string_array(payload, "candidate_ids")
                .iter()
                .any(|candidate| candidate == source_candidate_id)
                || payload_string_array(payload, "blocked_candidate_ids")
                    .iter()
                    .any(|candidate| candidate == source_candidate_id))
    });
    if !covered_by_handoff_envelope {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: queued child task source provenance is invalid",
        ));
    }
    validate_recovery_cycle_child_run_provenance(
        record,
        &parent_events,
        source_handoff_envelope_id,
        source_handoff_envelope_fingerprint,
    )?;
    validate_external_modepack_child_run_provenance(record, store, &parent, &parent_events)?;

    Ok(())
}

fn validate_external_modepack_child_run_provenance(
    record: &TaskRecord,
    store: &BrownieStore,
    parent: &TaskRecord,
    parent_events: &[LedgerEvent],
) -> Result<(), TaskRunAdmissionRejection> {
    let task_started_payload = controlled_child_task_started_payload(record, store)?;
    let has_child_provenance = task_started_payload
        .as_ref()
        .and_then(|payload| payload.get("external_modepack_child_provenance"))
        .is_some_and(|value| !value.is_null());
    let requires_child_provenance = has_child_provenance
        || parent_external_handoff_policy_requires_child_provenance(parent, parent_events, store);
    if !requires_child_provenance {
        return Ok(());
    }

    let Some(provenance) = task_started_payload
        .as_ref()
        .and_then(|payload| payload.get("external_modepack_child_provenance"))
    else {
        return external_modepack_child_provenance_denied(
            record,
            store,
            "missing_external_modepack_child_provenance",
            "invalid params: external Mode Pack child provenance is missing",
        );
    };

    let Some(mode_id) = record.mode_id.as_deref() else {
        return external_modepack_child_provenance_denied(
            record,
            store,
            "missing_child_mode_id",
            "invalid params: external Mode Pack child provenance is invalid",
        );
    };
    if provenance.get("version").and_then(Value::as_str)
        != Some(EXTERNAL_MODEPACK_CHILD_PROVENANCE_VERSION)
        || provenance.get("source_kind").and_then(Value::as_str) != Some("workspace_modepack")
        || provenance.get("source_path").and_then(Value::as_str) != Some(WORKSPACE_MODEPACK_PATH)
        || provenance.get("mode_id").and_then(Value::as_str) != Some(mode_id)
        || provenance
            .get("captured_parent_run_id")
            .and_then(Value::as_str)
            != record.parent_run_id.as_deref()
        || provenance
            .get("captured_handoff_envelope_id")
            .and_then(Value::as_str)
            != record.source_handoff_envelope_id.as_deref()
        || provenance
            .get("captured_handoff_envelope_fingerprint")
            .and_then(Value::as_str)
            != record.source_handoff_envelope_fingerprint.as_deref()
    {
        return external_modepack_child_provenance_denied(
            record,
            store,
            "malformed_external_modepack_child_provenance",
            "invalid params: external Mode Pack child provenance is invalid",
        );
    }
    let Some(policy_fingerprint) = provenance.get("policy_fingerprint").and_then(Value::as_str)
    else {
        return external_modepack_child_provenance_denied(
            record,
            store,
            "missing_external_modepack_policy_fingerprint",
            "invalid params: external Mode Pack child provenance is invalid",
        );
    };
    if !is_sha256_fingerprint(policy_fingerprint) {
        return external_modepack_child_provenance_denied(
            record,
            store,
            "malformed_external_modepack_policy_fingerprint",
            "invalid params: external Mode Pack child provenance is invalid",
        );
    }

    let current = external_modepack_child_provenance_payload(
        store,
        mode_id,
        record.parent_run_id.as_deref().unwrap_or_default(),
        record
            .source_handoff_envelope_id
            .as_deref()
            .unwrap_or_default(),
        record
            .source_handoff_envelope_fingerprint
            .as_deref()
            .unwrap_or_default(),
    )
    .map_err(TaskRunAdmissionRejection::Internal)?;
    let Some(current) = current else {
        return external_modepack_child_provenance_denied(
            record,
            store,
            "stale_external_modepack_child_policy_missing",
            "invalid params: external Mode Pack child provenance is stale",
        );
    };
    for key in [
        "modepack_name",
        "schema_version",
        "source_path",
        "mode_id",
        "policy_fingerprint",
    ] {
        if provenance.get(key) != current.get(key) {
            return external_modepack_child_provenance_denied(
                record,
                store,
                "stale_external_modepack_child_policy_mismatch",
                "invalid params: external Mode Pack child provenance is stale",
            );
        }
    }

    Ok(())
}

fn controlled_child_task_started_payload(
    record: &TaskRecord,
    store: &BrownieStore,
) -> Result<Option<Value>, TaskRunAdmissionRejection> {
    Ok(store
        .tasks()
        .read_ledger_events(&record.run_id)
        .map_err(|error| TaskRunAdmissionRejection::Internal(error.to_string()))?
        .into_iter()
        .rev()
        .find(|event| event.kind == LedgerEventKind::TaskStarted)
        .and_then(|event| event.payload))
}

fn parent_external_handoff_policy_requires_child_provenance(
    parent: &TaskRecord,
    parent_events: &[LedgerEvent],
    store: &BrownieStore,
) -> bool {
    if parent_events
        .iter()
        .rev()
        .find(|event| event.kind == LedgerEventKind::ModeResolved)
        .and_then(|event| event.payload.as_ref())
        .and_then(|payload| payload.get("allowed_handoff_targets"))
        .and_then(Value::as_array)
        .is_some_and(|targets| !targets.is_empty())
    {
        return true;
    }
    resolve_policy_for_task_run(parent, store)
        .ok()
        .and_then(|policy| policy.allowed_handoff_targets)
        .is_some_and(|targets| !targets.is_empty())
}

fn external_modepack_child_provenance_denied(
    record: &TaskRecord,
    store: &BrownieStore,
    reason: &'static str,
    message: &'static str,
) -> Result<(), TaskRunAdmissionRejection> {
    store
        .tasks()
        .append_task_event_with_payload(
            record,
            LedgerEventKind::ExternalModePackChildProvenanceDenied,
            Some(json!({
                "status": "Denied",
                "reason": reason,
                "task_id": record.task_id,
                "run_id": record.run_id,
                "parent_run_id": record.parent_run_id,
                "source_candidate_id": record.source_candidate_id,
                "source_handoff_envelope_id": record.source_handoff_envelope_id,
                "source_handoff_envelope_fingerprint": record.source_handoff_envelope_fingerprint,
                "mode_id": record.mode_id,
            })),
        )
        .map_err(|error| TaskRunAdmissionRejection::Internal(error.to_string()))?;
    Err(TaskRunAdmissionRejection::InvalidParams(message))
}

pub(super) fn validate_recovery_cycle_child_run_provenance(
    record: &TaskRecord,
    parent_events: &[LedgerEvent],
    source_handoff_envelope_id: &str,
    source_handoff_envelope_fingerprint: &str,
) -> Result<(), TaskRunAdmissionRejection> {
    let Some(provenance) = record.recovery_cycle_provenance.as_ref() else {
        if source_handoff_envelope_requires_recovery_cycle_provenance(
            parent_events,
            source_handoff_envelope_id,
            source_handoff_envelope_fingerprint,
        ) {
            return Err(TaskRunAdmissionRejection::InvalidParams(
                "invalid params: recovery-cycle child task provenance is missing",
            ));
        }
        return Ok(());
    };
    if !recovery_cycle_child_provenance_is_internally_valid(provenance) {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: recovery-cycle child task provenance is invalid",
        ));
    }
    if recovery_cycle_depth_exceeds_budget(provenance.parent_join_recovery_cycle_depth) {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: recovery-cycle child task provenance exceeds runtime budget",
        ));
    }

    if !parent_events
        .iter()
        .any(|event| recovery_cycle_provenance_matches_parent_join(event, provenance))
    {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: recovery-cycle child task provenance does not match parent join admission",
        ));
    }

    if !parent_events.iter().any(|event| {
        recovery_cycle_provenance_matches_handoff_envelope(
            event,
            provenance,
            source_handoff_envelope_id,
            source_handoff_envelope_fingerprint,
        )
    }) {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: recovery-cycle child task provenance does not match parent handoff envelope",
        ));
    }

    Ok(())
}

pub(super) fn recovery_cycle_depth_exceeds_budget(depth: usize) -> bool {
    depth > MAX_RECOVERY_CYCLE_DEPTH
}

fn source_handoff_envelope_requires_recovery_cycle_provenance(
    parent_events: &[LedgerEvent],
    source_handoff_envelope_id: &str,
    source_handoff_envelope_fingerprint: &str,
) -> bool {
    parent_events.iter().any(|event| {
        if event.kind != LedgerEventKind::SubtaskDispatchHandoffEnvelopeRecorded {
            return false;
        }
        let Some(payload) = event.payload.as_ref() else {
            return false;
        };
        payload
            .get("handoff_envelope_status")
            .and_then(Value::as_str)
            == Some("Accepted")
            && payload.get("handoff_envelope_id").and_then(Value::as_str)
                == Some(source_handoff_envelope_id)
            && payload
                .get("handoff_envelope_fingerprint")
                .and_then(Value::as_str)
                == Some(source_handoff_envelope_fingerprint)
            && payload
                .get("parent_join_recovery_cycle")
                .and_then(Value::as_bool)
                == Some(true)
    })
}

pub(super) fn recovery_cycle_child_provenance_is_internally_valid(
    provenance: &RecoveryCycleChildProvenance,
) -> bool {
    !provenance.parent_join_admission_id.trim().is_empty()
        && is_sha256_fingerprint(&provenance.parent_join_child_completion_fingerprint)
        && provenance
            .parent_join_terminal_failed_child_count
            .checked_add(provenance.parent_join_terminal_completed_child_count)
            == Some(provenance.parent_join_child_completion_child_count)
        && provenance.parent_join_recovery_cycle
        && provenance.parent_join_recovery_cycle_depth >= 1
}

pub(super) fn recovery_cycle_provenance_matches_parent_join(
    event: &LedgerEvent,
    provenance: &RecoveryCycleChildProvenance,
) -> bool {
    if event.kind != LedgerEventKind::ParentJoinContinuationFingerprintConsumed {
        return false;
    }
    let Some(payload) = event.payload.as_ref() else {
        return false;
    };
    payload.get("admission_id").and_then(Value::as_str)
        == Some(provenance.parent_join_admission_id.as_str())
        && payload
            .get("child_completion_fingerprint")
            .and_then(Value::as_str)
            == Some(provenance.parent_join_child_completion_fingerprint.as_str())
        && payload_usize_eq(
            payload,
            "child_completion_child_count",
            provenance.parent_join_child_completion_child_count,
        )
        && payload_usize_eq(
            payload,
            "child_terminal_failed_count",
            provenance.parent_join_terminal_failed_child_count,
        )
        && payload_usize_eq(
            payload,
            "child_terminal_completed_count",
            provenance.parent_join_terminal_completed_child_count,
        )
        && payload_usize_eq(
            payload,
            "child_recovery_cycle_depth",
            provenance.parent_join_recovery_cycle_depth,
        )
}

fn recovery_cycle_provenance_matches_handoff_envelope(
    event: &LedgerEvent,
    provenance: &RecoveryCycleChildProvenance,
    source_handoff_envelope_id: &str,
    source_handoff_envelope_fingerprint: &str,
) -> bool {
    if event.kind != LedgerEventKind::SubtaskDispatchHandoffEnvelopeRecorded {
        return false;
    }
    let Some(payload) = event.payload.as_ref() else {
        return false;
    };
    payload
        .get("handoff_envelope_status")
        .and_then(Value::as_str)
        == Some("Accepted")
        && payload.get("handoff_envelope_id").and_then(Value::as_str)
            == Some(source_handoff_envelope_id)
        && payload
            .get("handoff_envelope_fingerprint")
            .and_then(Value::as_str)
            == Some(source_handoff_envelope_fingerprint)
        && payload
            .get("parent_join_admission_id")
            .and_then(Value::as_str)
            == Some(provenance.parent_join_admission_id.as_str())
        && payload
            .get("parent_join_child_completion_fingerprint")
            .and_then(Value::as_str)
            == Some(provenance.parent_join_child_completion_fingerprint.as_str())
        && payload_usize_eq(
            payload,
            "parent_join_child_completion_child_count",
            provenance.parent_join_child_completion_child_count,
        )
        && payload_usize_eq(
            payload,
            "parent_join_terminal_failed_child_count",
            provenance.parent_join_terminal_failed_child_count,
        )
        && payload_usize_eq(
            payload,
            "parent_join_terminal_completed_child_count",
            provenance.parent_join_terminal_completed_child_count,
        )
        && payload
            .get("parent_join_recovery_cycle")
            .and_then(Value::as_bool)
            == Some(provenance.parent_join_recovery_cycle)
        && payload_usize_eq(
            payload,
            "parent_join_recovery_cycle_depth",
            provenance.parent_join_recovery_cycle_depth,
        )
}

pub(super) fn payload_usize_eq(payload: &Value, key: &str, expected: usize) -> bool {
    payload
        .get(key)
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
        == Some(expected)
}

fn required_task_run_provenance(value: Option<&str>) -> Result<&str, TaskRunAdmissionRejection> {
    value
        .filter(|value| !value.trim().is_empty())
        .ok_or(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: queued child task must include complete parent/source provenance",
        ))
}
