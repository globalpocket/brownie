use super::*;

pub(super) fn headless_continue_once_candidate_task_ids(
    progress_overview: &TaskListProgressOverview,
) -> Vec<String> {
    progress_overview
        .nodes
        .iter()
        .filter(|node| {
            matches!(node.status, TaskStatus::Created | TaskStatus::Queued)
                && node.next_action == ProgressNextAction::RunTaskExplicitly
        })
        .map(|node| node.task_id.clone())
        .collect()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct TaskListProgressClassification {
    lifecycle_phase: ProgressLifecyclePhase,
    current_stage: ProgressCurrentStage,
    next_action: ProgressNextAction,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum TaskListParentJoinProjection {
    Ready,
    NotReady,
    Unknown,
}

pub(super) fn task_list_progress_overview(
    store: &BrownieStore,
    tasks: &[TaskRecord],
) -> Result<TaskListProgressOverview, String> {
    let children_by_parent_run = task_list_children_by_parent_run(tasks);
    let parent_join_projection_by_task_id =
        task_list_parent_join_projection_by_task_id(store, tasks, &children_by_parent_run)?;
    let aggregate_sequence = task_list_aggregate_sequence(tasks);
    let mut status_counts = TaskStatusCounts {
        created: 0,
        queued: 0,
        running: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
    };
    let mut root_task_ids = Vec::new();
    let mut runnable_task_ids = Vec::new();
    let mut blocked_task_ids = Vec::new();
    let mut terminal_task_ids = Vec::new();
    let mut parent_join_ready_task_ids = Vec::new();
    let mut classifications = Vec::new();
    let mut nodes = Vec::new();

    for task in tasks {
        match task.status {
            TaskStatus::Created => status_counts.created += 1,
            TaskStatus::Queued => status_counts.queued += 1,
            TaskStatus::Running => status_counts.running += 1,
            TaskStatus::Completed => status_counts.completed += 1,
            TaskStatus::Failed => status_counts.failed += 1,
            TaskStatus::Cancelled => status_counts.cancelled += 1,
        }

        if task.parent_run_id.is_none() {
            root_task_ids.push(task.task_id.clone());
        }
        if matches!(task.status, TaskStatus::Created | TaskStatus::Queued) {
            runnable_task_ids.push(task.task_id.clone());
        }
        if matches!(
            task.status,
            TaskStatus::Completed | TaskStatus::Failed | TaskStatus::Cancelled
        ) {
            terminal_task_ids.push(task.task_id.clone());
        }

        let child_tasks: &[&TaskRecord] = children_by_parent_run
            .get(&task.run_id)
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        let classification = task_list_progress_classification(
            task,
            child_tasks,
            parent_join_projection_by_task_id
                .get(&task.task_id)
                .copied()
                .unwrap_or(TaskListParentJoinProjection::NotReady),
        );
        if classification.lifecycle_phase == ProgressLifecyclePhase::BlockedForExplicitAction {
            blocked_task_ids.push(task.task_id.clone());
        }
        if classification.current_stage == ProgressCurrentStage::ParentJoinReady {
            parent_join_ready_task_ids.push(task.task_id.clone());
        }

        nodes.push(TaskProgressGraphNode {
            task_id: task.task_id.clone(),
            run_id: task.run_id.clone(),
            status: task.status.clone(),
            lifecycle_phase: classification.lifecycle_phase.clone(),
            current_stage: classification.current_stage.clone(),
            next_action: classification.next_action.clone(),
            parent_task_id: task.parent_task_id.clone(),
            parent_run_id: task.parent_run_id.clone(),
            child_task_count: child_tasks.len(),
            created_at: task.created_at.clone(),
            updated_at: task.updated_at.clone(),
        });
        classifications.push((task.task_id.clone(), classification));
    }

    let edges = task_list_progress_edges(tasks);
    let stage_counts = task_list_progress_stage_counts(&classifications);
    let next_action_sets = task_list_progress_next_action_sets(&classifications);
    let blocked_sets = task_list_progress_blocked_sets(&classifications);
    let source_fingerprint = task_list_progress_overview_fingerprint(
        tasks,
        aggregate_sequence,
        &nodes,
        &edges,
        &root_task_ids,
        &runnable_task_ids,
        &blocked_task_ids,
        &terminal_task_ids,
        &parent_join_ready_task_ids,
    );
    let headless_route_candidates = task_list_headless_route_candidates(
        tasks,
        &classifications,
        &source_fingerprint,
        aggregate_sequence,
    );

    Ok(TaskListProgressOverview {
        source_fingerprint,
        aggregate_sequence,
        task_count: tasks.len(),
        root_task_ids,
        runnable_task_ids,
        blocked_task_ids,
        terminal_task_ids,
        parent_join_ready_task_ids,
        status_counts,
        stage_counts,
        next_action_sets,
        blocked_sets,
        headless_route_candidates,
        nodes,
        edges,
    })
}

pub(super) fn task_list_headless_route_candidates(
    tasks: &[TaskRecord],
    classifications: &[(String, TaskListProgressClassification)],
    progress_fingerprint: &str,
    aggregate_sequence: u64,
) -> Vec<TaskListHeadlessRouteCandidate> {
    let classification_by_task_id: std::collections::BTreeMap<
        &str,
        &TaskListProgressClassification,
    > = classifications
        .iter()
        .map(|(task_id, classification)| (task_id.as_str(), classification))
        .collect();
    let mut candidates = Vec::new();
    for task in tasks {
        let Some(classification) = classification_by_task_id.get(task.task_id.as_str()) else {
            continue;
        };
        if !matches!(
            task.status,
            TaskStatus::Created | TaskStatus::Queued | TaskStatus::Completed
        ) {
            continue;
        }
        if matches!(task.status, TaskStatus::Created | TaskStatus::Queued) {
            if let Some(provenance) = task.verification_recovery_retry_provenance.as_ref() {
                candidates.push(task_list_headless_route_candidate(
                    HeadlessContinueRouteKind::RunVerificationRetryTaskExplicitly,
                    "Approved recovery apply evidence has materialized a verification retry task; run it explicitly.",
                    Some(task.task_id.clone()),
                    Some(task.run_id.clone()),
                    Some(provenance.proposal_id.clone()),
                    Some(provenance.apply_id.clone()),
                    Some(provenance.failure_fingerprint.clone()),
                    Some(provenance.apply_fingerprint.clone()),
                    progress_fingerprint,
                    aggregate_sequence,
                    10,
                    "run_verification_retry_task_explicitly",
                ));
                continue;
            }
            if let Some(provenance) = task.verification_recovery_provenance.as_ref() {
                candidates.push(task_list_headless_route_candidate(
                    HeadlessContinueRouteKind::RunRecoveryTaskExplicitly,
                    "Verifier failure evidence has materialized a recovery task; run it explicitly.",
                    Some(task.task_id.clone()),
                    Some(task.run_id.clone()),
                    None,
                    None,
                    Some(provenance.failure_fingerprint.clone()),
                    None,
                    progress_fingerprint,
                    aggregate_sequence,
                    20,
                    "run_recovery_task_explicitly",
                ));
                continue;
            }
            if let Some(provenance) = task.patch_apply_recovery_provenance.as_ref() {
                candidates.push(task_list_headless_route_candidate(
                    HeadlessContinueRouteKind::RunRecoveryTaskExplicitly,
                    "Failed patch apply evidence has materialized a recovery task; run it explicitly.",
                    Some(task.task_id.clone()),
                    Some(task.run_id.clone()),
                    Some(provenance.source_proposal_id.clone()),
                    Some(provenance.source_apply_id.clone()),
                    Some(provenance.failure_fingerprint.clone()),
                    Some(provenance.source_apply_fingerprint.clone()),
                    progress_fingerprint,
                    aggregate_sequence,
                    30,
                    "run_recovery_task_explicitly",
                ));
                continue;
            }
            if let Some(provenance) = task.llm_provider_failure_retry_provenance.as_ref() {
                candidates.push(task_list_headless_route_candidate(
                    HeadlessContinueRouteKind::RunLlmProviderRetryTaskExplicitly,
                    "LLM provider failure evidence has materialized a provider retry task; run it explicitly.",
                    Some(task.task_id.clone()),
                    Some(task.run_id.clone()),
                    None,
                    None,
                    Some(provenance.failure_fingerprint.clone()),
                    None,
                    progress_fingerprint,
                    aggregate_sequence,
                    40,
                    "run_llm_provider_retry_task_explicitly",
                ));
                continue;
            }
            if classification.next_action == ProgressNextAction::RunTaskExplicitly {
                candidates.push(task_list_headless_route_candidate(
                    HeadlessContinueRouteKind::InspectProgressOverview,
                    "Task is runnable through the normal headless continuation selector.",
                    Some(task.task_id.clone()),
                    Some(task.run_id.clone()),
                    None,
                    None,
                    None,
                    None,
                    progress_fingerprint,
                    aggregate_sequence,
                    80,
                    "headless_continue_once",
                ));
            }
            continue;
        }
        if classification.current_stage == ProgressCurrentStage::ParentJoinReady {
            candidates.push(task_list_headless_route_candidate(
                HeadlessContinueRouteKind::RunParentTaskExplicitly,
                "All controlled children reached terminal state; run the parent continuation explicitly.",
                Some(task.task_id.clone()),
                Some(task.run_id.clone()),
                None,
                None,
                None,
                None,
                progress_fingerprint,
                aggregate_sequence,
                50,
                "run_parent_task_explicitly",
            ));
        }
    }
    candidates.sort_by(|left, right| {
        left.priority
            .cmp(&right.priority)
            .then(left.kind_string().cmp(&right.kind_string()))
            .then(left.task_id.cmp(&right.task_id))
            .then(left.run_id.cmp(&right.run_id))
    });
    candidates
}

pub(super) fn task_list_headless_route_candidate(
    kind: HeadlessContinueRouteKind,
    reason: &str,
    task_id: Option<String>,
    run_id: Option<String>,
    proposal_id: Option<String>,
    apply_id: Option<String>,
    failure_fingerprint: Option<String>,
    apply_fingerprint: Option<String>,
    progress_fingerprint: &str,
    aggregate_sequence: u64,
    priority: u8,
    next_action: &str,
) -> TaskListHeadlessRouteCandidate {
    let route_fingerprint = task_list_headless_route_candidate_fingerprint(
        &kind,
        task_id.as_deref(),
        run_id.as_deref(),
        proposal_id.as_deref(),
        apply_id.as_deref(),
        failure_fingerprint.as_deref(),
        apply_fingerprint.as_deref(),
        progress_fingerprint,
        aggregate_sequence,
        priority,
        next_action,
    );
    TaskListHeadlessRouteCandidate {
        kind,
        reason: reason.to_string(),
        task_id,
        run_id,
        proposal_id,
        apply_id,
        failure_fingerprint,
        apply_fingerprint,
        progress_fingerprint: progress_fingerprint.to_string(),
        aggregate_sequence,
        route_fingerprint,
        priority,
        next_action: next_action.to_string(),
    }
}

trait HeadlessRouteKindSortKey {
    fn kind_string(&self) -> String;
}

impl HeadlessRouteKindSortKey for TaskListHeadlessRouteCandidate {
    fn kind_string(&self) -> String {
        serde_json::to_string(&self.kind).unwrap_or_else(|_| "unknown".to_string())
    }
}

pub(super) fn task_list_headless_route_candidate_fingerprint(
    kind: &HeadlessContinueRouteKind,
    task_id: Option<&str>,
    run_id: Option<&str>,
    proposal_id: Option<&str>,
    apply_id: Option<&str>,
    failure_fingerprint: Option<&str>,
    apply_fingerprint: Option<&str>,
    progress_fingerprint: &str,
    aggregate_sequence: u64,
    priority: u8,
    next_action: &str,
) -> String {
    let entries = vec![
        (
            "version",
            "task_list_headless_route_candidate_v1".to_string(),
        ),
        (
            "kind",
            serde_json::to_string(kind).unwrap_or_else(|_| "unknown".to_string()),
        ),
        ("task_id", task_id.unwrap_or("").to_string()),
        ("run_id", run_id.unwrap_or("").to_string()),
        ("proposal_id", proposal_id.unwrap_or("").to_string()),
        ("apply_id", apply_id.unwrap_or("").to_string()),
        (
            "failure_fingerprint",
            failure_fingerprint.unwrap_or("").to_string(),
        ),
        (
            "apply_fingerprint",
            apply_fingerprint.unwrap_or("").to_string(),
        ),
        ("progress_fingerprint", progress_fingerprint.to_string()),
        ("aggregate_sequence", aggregate_sequence.to_string()),
        ("priority", priority.to_string()),
        ("next_action", next_action.to_string()),
    ];
    progress_snapshot_source_fingerprint(&entries)
}

pub(super) fn task_list_children_by_parent_run(
    tasks: &[TaskRecord],
) -> std::collections::BTreeMap<String, Vec<&TaskRecord>> {
    let mut children_by_parent_run: std::collections::BTreeMap<String, Vec<&TaskRecord>> =
        std::collections::BTreeMap::new();
    for task in tasks {
        if task_has_complete_controlled_child_provenance(task) {
            if let Some(parent_run_id) = task.parent_run_id.as_ref() {
                children_by_parent_run
                    .entry(parent_run_id.clone())
                    .or_default()
                    .push(task);
            }
        }
    }
    children_by_parent_run
}

pub(super) fn task_list_parent_join_projection_by_task_id(
    store: &BrownieStore,
    tasks: &[TaskRecord],
    children_by_parent_run: &std::collections::BTreeMap<String, Vec<&TaskRecord>>,
) -> Result<std::collections::BTreeMap<String, TaskListParentJoinProjection>, String> {
    let mut projections = std::collections::BTreeMap::new();
    for task in tasks {
        if task.status != TaskStatus::Completed {
            continue;
        }
        let child_tasks: &[&TaskRecord] = children_by_parent_run
            .get(&task.run_id)
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        if !task_list_has_terminal_join_candidate_children(child_tasks) {
            continue;
        }
        let projection = task_list_parent_join_projection(store, task, child_tasks)?;
        projections.insert(task.task_id.clone(), projection);
    }
    Ok(projections)
}

pub(super) fn task_list_has_terminal_join_candidate_children(child_tasks: &[&TaskRecord]) -> bool {
    let terminal_controlled_child_count = child_tasks
        .iter()
        .filter(|child| is_parent_join_terminal_child_status(&child.status))
        .count();
    terminal_controlled_child_count > 0
        && child_tasks
            .iter()
            .all(|child| is_parent_join_terminal_child_status(&child.status))
}

pub(super) fn task_list_parent_join_projection(
    store: &BrownieStore,
    parent: &TaskRecord,
    child_tasks: &[&TaskRecord],
) -> Result<TaskListParentJoinProjection, String> {
    let parent_events = store
        .tasks()
        .read_ledger_events(&parent.run_id)
        .map_err(|error| error.to_string())?;
    let mut child_evidence = Vec::new();
    let mut sorted_child_tasks = child_tasks.to_vec();
    sorted_child_tasks.sort_by(|left, right| {
        left.source_candidate_id
            .cmp(&right.source_candidate_id)
            .then(left.task_id.cmp(&right.task_id))
    });
    for child in sorted_child_tasks {
        if !task_list_child_controlled_provenance_is_valid(parent, &parent_events, child) {
            return Ok(TaskListParentJoinProjection::Unknown);
        }
        let child_events = store
            .tasks()
            .read_ledger_events(&child.run_id)
            .map_err(|error| error.to_string())?;
        if !task_list_child_has_terminal_parent_join_outcome_from_events(child, &child_events) {
            return Ok(TaskListParentJoinProjection::Unknown);
        }
        child_evidence.push(task_list_parent_join_child_completion_evidence_from_events(
            child,
            &child_events,
        ));
    }
    let (child_completion_fingerprint, _) =
        parent_join_child_completion_fingerprint(&child_evidence);
    let consumed = task_list_parent_join_child_completion_fingerprint_consumed_from_events(
        &parent_events,
        &child_completion_fingerprint,
    );
    if consumed {
        Ok(TaskListParentJoinProjection::NotReady)
    } else {
        Ok(TaskListParentJoinProjection::Ready)
    }
}

pub(super) fn task_list_child_controlled_provenance_is_valid(
    parent: &TaskRecord,
    parent_events: &[LedgerEvent],
    child: &TaskRecord,
) -> bool {
    if child.parent_task_id.as_deref() != Some(parent.task_id.as_str())
        || child.parent_run_id.as_deref() != Some(parent.run_id.as_str())
    {
        return false;
    }
    let Some(source_candidate_id) = non_empty_record_string(child.source_candidate_id.as_deref())
    else {
        return false;
    };
    let Some(source_handoff_envelope_id) =
        non_empty_record_string(child.source_handoff_envelope_id.as_deref())
    else {
        return false;
    };
    let Some(source_handoff_envelope_fingerprint) =
        non_empty_record_string(child.source_handoff_envelope_fingerprint.as_deref())
    else {
        return false;
    };

    let covered_by_handoff_envelope = parent_events.iter().any(|event| {
        if event.kind != LedgerEventKind::SubtaskDispatchHandoffEnvelopeRecorded {
            return false;
        }
        let Some(payload) = event.payload.as_ref() else {
            return false;
        };
        payload.get("handoff_envelope_id").and_then(Value::as_str)
            == Some(source_handoff_envelope_id.as_str())
            && payload
                .get("handoff_envelope_fingerprint")
                .and_then(Value::as_str)
                == Some(source_handoff_envelope_fingerprint.as_str())
            && (payload_string_array(payload, "candidate_ids")
                .iter()
                .any(|candidate| candidate == &source_candidate_id)
                || payload_string_array(payload, "blocked_candidate_ids")
                    .iter()
                    .any(|candidate| candidate == &source_candidate_id))
    });
    covered_by_handoff_envelope
        && validate_recovery_cycle_child_run_provenance(
            child,
            parent_events,
            &source_handoff_envelope_id,
            &source_handoff_envelope_fingerprint,
        )
        .is_ok()
}

pub(super) fn task_list_child_has_terminal_parent_join_outcome_from_events(
    child: &TaskRecord,
    events: &[LedgerEvent],
) -> bool {
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
            has_completed_agent_loop && has_task_completed
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
            has_task_failed && (has_failed_agent_loop || has_redacted_failure_event)
        }
        TaskStatus::Created | TaskStatus::Queued | TaskStatus::Running | TaskStatus::Cancelled => {
            false
        }
    }
}

pub(super) fn task_list_parent_join_child_completion_evidence_from_events(
    child: &TaskRecord,
    events: &[LedgerEvent],
) -> ParentJoinChildCompletionEvidence {
    let source_candidate_id = child.source_candidate_id.as_deref().unwrap_or("<none>");
    let source_handoff_envelope_id = child
        .source_handoff_envelope_id
        .as_deref()
        .unwrap_or("<none>");
    let source_handoff_envelope_fingerprint = child
        .source_handoff_envelope_fingerprint
        .as_deref()
        .unwrap_or("<none>");
    let parent_task_id = child.parent_task_id.as_deref().unwrap_or("<none>");
    let parent_run_id = child.parent_run_id.as_deref().unwrap_or("<none>");
    let status = format!("{:?}", child.status);
    let completion_event = events
        .iter()
        .rev()
        .find(|event| event.kind == LedgerEventKind::AgentLoopCompleted);
    let completion_final_state = completion_event
        .and_then(|event| event.payload.as_ref())
        .and_then(|payload| payload.get("final_state"))
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let completion_result_fingerprint =
        child_completion_result_fingerprint(events, completion_event);
    let terminal_outcome_kind = match child.status {
        TaskStatus::Completed => "completed_child",
        TaskStatus::Failed => "failed_child",
        TaskStatus::Created | TaskStatus::Queued | TaskStatus::Running | TaskStatus::Cancelled => {
            "nonterminal_child"
        }
    };
    let (terminal_final_state, terminal_result_fingerprint) = match child.status {
        TaskStatus::Completed => (
            completion_final_state.unwrap_or_else(|| "<none>".to_string()),
            completion_result_fingerprint.unwrap_or_else(|| "<none>".to_string()),
        ),
        TaskStatus::Failed => (
            completion_final_state
                .filter(|state| state == "Failed")
                .unwrap_or_else(|| "Failed".to_string()),
            child_failure_result_fingerprint(events, completion_result_fingerprint.as_deref()),
        ),
        TaskStatus::Created | TaskStatus::Queued | TaskStatus::Running | TaskStatus::Cancelled => {
            ("<none>".to_string(), "<none>".to_string())
        }
    };

    ParentJoinChildCompletionEvidence {
        summary: String::new(),
        fingerprint_inputs: vec![
            format!("task_id={}", child.task_id),
            format!("run_id={}", child.run_id),
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
    }
}

pub(super) fn task_list_parent_join_child_completion_fingerprint_consumed_from_events(
    events: &[LedgerEvent],
    child_completion_fingerprint: &str,
) -> bool {
    events.iter().any(|event| {
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
    })
}

pub(super) fn task_list_progress_classification(
    task: &TaskRecord,
    child_tasks: &[&TaskRecord],
    parent_join_projection: TaskListParentJoinProjection,
) -> TaskListProgressClassification {
    match task.status {
        TaskStatus::Created => TaskListProgressClassification {
            lifecycle_phase: ProgressLifecyclePhase::Created,
            current_stage: ProgressCurrentStage::Created,
            next_action: ProgressNextAction::RunTaskExplicitly,
        },
        TaskStatus::Queued => TaskListProgressClassification {
            lifecycle_phase: ProgressLifecyclePhase::Queued,
            current_stage: ProgressCurrentStage::Queued,
            next_action: ProgressNextAction::RunTaskExplicitly,
        },
        TaskStatus::Running => TaskListProgressClassification {
            lifecycle_phase: ProgressLifecyclePhase::Running,
            current_stage: ProgressCurrentStage::RunningAgentLoop,
            next_action: ProgressNextAction::InspectTask,
        },
        TaskStatus::Failed => TaskListProgressClassification {
            lifecycle_phase: ProgressLifecyclePhase::Terminal,
            current_stage: ProgressCurrentStage::Failed,
            next_action: ProgressNextAction::InspectTerminalResult,
        },
        TaskStatus::Cancelled => TaskListProgressClassification {
            lifecycle_phase: ProgressLifecyclePhase::Terminal,
            current_stage: ProgressCurrentStage::Cancelled,
            next_action: ProgressNextAction::InspectTerminalResult,
        },
        TaskStatus::Completed => {
            task_list_completed_progress_classification(child_tasks, parent_join_projection)
        }
    }
}

pub(super) fn task_list_completed_progress_classification(
    child_tasks: &[&TaskRecord],
    parent_join_projection: TaskListParentJoinProjection,
) -> TaskListProgressClassification {
    let pending_controlled_child_count = child_tasks
        .iter()
        .filter(|child| is_parent_join_runnable_pending_child_status(&child.status))
        .count();
    let terminal_controlled_child_count = child_tasks
        .iter()
        .filter(|child| is_parent_join_terminal_child_status(&child.status))
        .count();
    let non_runnable_controlled_child_count = child_tasks
        .iter()
        .filter(|child| is_parent_join_non_runnable_child_status(&child.status))
        .count();

    if non_runnable_controlled_child_count > 0 {
        return TaskListProgressClassification {
            lifecycle_phase: ProgressLifecyclePhase::BlockedForExplicitAction,
            current_stage: ProgressCurrentStage::InspectNonRunnableChildTasks,
            next_action: ProgressNextAction::InspectNonRunnableChildTasks,
        };
    }

    if pending_controlled_child_count > 0 {
        return TaskListProgressClassification {
            lifecycle_phase: ProgressLifecyclePhase::BlockedForExplicitAction,
            current_stage: ProgressCurrentStage::CompletedWithPendingChildren,
            next_action: ProgressNextAction::RunRemainingChildTasksExplicitly,
        };
    }

    if terminal_controlled_child_count > 0
        && parent_join_projection == TaskListParentJoinProjection::Unknown
    {
        return TaskListProgressClassification {
            lifecycle_phase: ProgressLifecyclePhase::BlockedForExplicitAction,
            current_stage: ProgressCurrentStage::Unknown,
            next_action: ProgressNextAction::InspectTask,
        };
    }

    if terminal_controlled_child_count > 0
        && parent_join_projection == TaskListParentJoinProjection::Ready
    {
        return TaskListProgressClassification {
            lifecycle_phase: ProgressLifecyclePhase::BlockedForExplicitAction,
            current_stage: ProgressCurrentStage::ParentJoinReady,
            next_action: ProgressNextAction::RunParentTaskExplicitly,
        };
    }

    TaskListProgressClassification {
        lifecycle_phase: ProgressLifecyclePhase::Terminal,
        current_stage: ProgressCurrentStage::Completed,
        next_action: ProgressNextAction::InspectTerminalResult,
    }
}

pub(super) fn task_list_progress_edges(tasks: &[TaskRecord]) -> Vec<TaskProgressGraphEdge> {
    tasks
        .iter()
        .filter(|task| task_has_complete_controlled_child_provenance(task))
        .filter_map(|task| {
            Some(TaskProgressGraphEdge {
                parent_task_id: task.parent_task_id.clone()?,
                parent_run_id: task.parent_run_id.clone()?,
                child_task_id: task.task_id.clone(),
                child_run_id: task.run_id.clone(),
                source_candidate_id: task.source_candidate_id.clone()?,
                source_handoff_envelope_fingerprint: task
                    .source_handoff_envelope_fingerprint
                    .clone()?,
            })
        })
        .collect()
}

pub(super) fn task_list_progress_stage_counts(
    classifications: &[(String, TaskListProgressClassification)],
) -> Vec<TaskListProgressStageCount> {
    vec![
        ProgressCurrentStage::Created,
        ProgressCurrentStage::Queued,
        ProgressCurrentStage::RunningAgentLoop,
        ProgressCurrentStage::InspectNonRunnableChildTasks,
        ProgressCurrentStage::CompletedWithPendingChildren,
        ProgressCurrentStage::ParentJoinReady,
        ProgressCurrentStage::Completed,
        ProgressCurrentStage::Failed,
        ProgressCurrentStage::Cancelled,
        ProgressCurrentStage::Unknown,
    ]
    .into_iter()
    .filter_map(|current_stage| {
        let task_count = classifications
            .iter()
            .filter(|(_, classification)| classification.current_stage == current_stage)
            .count();
        (task_count > 0).then_some(TaskListProgressStageCount {
            current_stage,
            task_count,
        })
    })
    .collect()
}

pub(super) fn task_list_progress_next_action_sets(
    classifications: &[(String, TaskListProgressClassification)],
) -> Vec<TaskListProgressNextActionSet> {
    vec![
        ProgressNextAction::RunTaskExplicitly,
        ProgressNextAction::RunParentTaskExplicitly,
        ProgressNextAction::RunRemainingChildTasksExplicitly,
        ProgressNextAction::InspectNonRunnableChildTasks,
        ProgressNextAction::StartVerificationRecoveryExplicitly,
        ProgressNextAction::InspectTerminalResult,
        ProgressNextAction::InspectTask,
    ]
    .into_iter()
    .filter_map(|next_action| {
        let task_ids: Vec<String> = classifications
            .iter()
            .filter(|(_, classification)| classification.next_action == next_action)
            .map(|(task_id, _)| task_id.clone())
            .collect();
        (!task_ids.is_empty()).then_some(TaskListProgressNextActionSet {
            next_action,
            task_count: task_ids.len(),
            task_ids,
        })
    })
    .collect()
}

pub(super) fn task_list_progress_blocked_sets(
    classifications: &[(String, TaskListProgressClassification)],
) -> Vec<TaskListProgressBlockedSet> {
    vec![
        (
            ProgressCurrentStage::InspectNonRunnableChildTasks,
            ProgressNextAction::InspectNonRunnableChildTasks,
        ),
        (
            ProgressCurrentStage::CompletedWithPendingChildren,
            ProgressNextAction::RunRemainingChildTasksExplicitly,
        ),
        (
            ProgressCurrentStage::ParentJoinReady,
            ProgressNextAction::RunParentTaskExplicitly,
        ),
        (
            ProgressCurrentStage::Unknown,
            ProgressNextAction::InspectTask,
        ),
    ]
    .into_iter()
    .filter_map(|(current_stage, next_action)| {
        let task_ids: Vec<String> = classifications
            .iter()
            .filter(|(_, classification)| {
                classification.lifecycle_phase == ProgressLifecyclePhase::BlockedForExplicitAction
                    && classification.current_stage == current_stage
                    && classification.next_action == next_action
            })
            .map(|(task_id, _)| task_id.clone())
            .collect();
        (!task_ids.is_empty()).then_some(TaskListProgressBlockedSet {
            current_stage,
            next_action,
            task_count: task_ids.len(),
            task_ids,
        })
    })
    .collect()
}

pub(super) fn task_list_progress_overview_fingerprint(
    tasks: &[TaskRecord],
    aggregate_sequence: u64,
    nodes: &[TaskProgressGraphNode],
    edges: &[TaskProgressGraphEdge],
    root_task_ids: &[String],
    runnable_task_ids: &[String],
    blocked_task_ids: &[String],
    terminal_task_ids: &[String],
    parent_join_ready_task_ids: &[String],
) -> String {
    let mut entries = vec![
        ("version", "task_list_progress_overview_v1".to_string()),
        ("aggregate_sequence", aggregate_sequence.to_string()),
        ("task_count", tasks.len().to_string()),
        ("root_task_ids", root_task_ids.join(",")),
        ("runnable_task_ids", runnable_task_ids.join(",")),
        ("blocked_task_ids", blocked_task_ids.join(",")),
        ("terminal_task_ids", terminal_task_ids.join(",")),
        (
            "parent_join_ready_task_ids",
            parent_join_ready_task_ids.join(","),
        ),
    ];

    for node in nodes {
        entries.push((
            "node",
            serde_json::to_string(node).unwrap_or_else(|_| "serialization_error".to_string()),
        ));
    }
    for edge in edges {
        entries.push((
            "edge",
            serde_json::to_string(edge).unwrap_or_else(|_| "serialization_error".to_string()),
        ));
    }

    progress_snapshot_source_fingerprint(&entries)
}

pub(super) fn task_list_aggregate_sequence(tasks: &[TaskRecord]) -> u64 {
    tasks
        .iter()
        .map(|task| task_list_timestamp_sequence(&task.updated_at))
        .max()
        .unwrap_or(0)
}

pub(super) fn task_list_timestamp_sequence(timestamp: &str) -> u64 {
    let digits = timestamp
        .chars()
        .filter(|character| character.is_ascii_digit())
        .take(17)
        .collect::<String>();
    digits.parse::<u64>().unwrap_or(0)
}
