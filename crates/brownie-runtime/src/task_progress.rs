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
        store,
        tasks,
        &classifications,
        &source_fingerprint,
        aggregate_sequence,
    )?;
    let selected_headless_route = headless_route_candidates.first().cloned();

    Ok(TaskListProgressOverview {
        source_fingerprint,
        aggregate_sequence,
        task_count: tasks.len(),
        runnable_count: runnable_task_ids.len(),
        blocked_count: blocked_task_ids.len(),
        terminal_count: terminal_task_ids.len(),
        parent_join_ready_count: parent_join_ready_task_ids.len(),
        root_task_ids,
        runnable_task_ids,
        blocked_task_ids,
        terminal_task_ids,
        parent_join_ready_task_ids,
        status_counts,
        stage_counts,
        next_action_sets,
        blocked_sets,
        selected_headless_route,
        headless_route_candidates,
        nodes,
        edges,
    })
}

pub(super) fn task_list_headless_route_candidates(
    store: &BrownieStore,
    tasks: &[TaskRecord],
    classifications: &[(String, TaskListProgressClassification)],
    progress_fingerprint: &str,
    aggregate_sequence: u64,
) -> Result<Vec<TaskListHeadlessRouteCandidate>, String> {
    let journey_contexts = task_list_headless_journey_candidate_contexts(store, tasks)?;
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
        let journey_context = journey_contexts.get(&task.task_id);
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
                    journey_context,
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
                    journey_context,
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
                    journey_context,
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
                    journey_context,
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
                    journey_context,
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
                journey_context,
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
            .then(left.session_id.is_none().cmp(&right.session_id.is_none()))
            .then(left.session_id.cmp(&right.session_id))
            .then(left.journey_id.cmp(&right.journey_id))
            .then(left.task_id.cmp(&right.task_id))
            .then(left.run_id.cmp(&right.run_id))
    });
    Ok(candidates)
}

#[derive(Debug, Clone)]
pub(super) struct TaskListHeadlessJourneyCandidateContext {
    journey_id: String,
    session_id: String,
    journey_fingerprint: String,
    next_session_sequence: u64,
}

fn task_list_headless_journey_candidate_contexts(
    store: &BrownieStore,
    tasks: &[TaskRecord],
) -> Result<std::collections::BTreeMap<String, TaskListHeadlessJourneyCandidateContext>, String> {
    let task_by_root_identity: std::collections::BTreeMap<(&str, &str), &TaskRecord> = tasks
        .iter()
        .filter(|task| task.parent_run_id.is_none())
        .map(|task| ((task.task_id.as_str(), task.run_id.as_str()), task))
        .collect();
    let mut contexts = std::collections::BTreeMap::new();
    for checkpoint in store
        .tasks()
        .list_headless_journey_start_checkpoints()
        .map_err(|error| error.to_string())?
    {
        let Some(task) =
            task_by_root_identity.get(&(checkpoint.task_id.as_str(), checkpoint.run_id.as_str()))
        else {
            continue;
        };
        let session_checkpoint = store
            .tasks()
            .read_headless_run_session_checkpoint(&checkpoint.session_id)
            .map_err(|error| error.to_string())?;
        let next_session_sequence = session_checkpoint
            .as_ref()
            .map(|checkpoint| checkpoint.session_sequence + 1)
            .unwrap_or(1);
        if contexts
            .insert(
                task.task_id.clone(),
                TaskListHeadlessJourneyCandidateContext {
                    journey_id: checkpoint.journey_id,
                    session_id: checkpoint.session_id,
                    journey_fingerprint: checkpoint.journey_fingerprint,
                    next_session_sequence,
                },
            )
            .is_some()
        {
            return Err(
                "invalid params: multiple headless journeys resolve to the same root task"
                    .to_string(),
            );
        }
    }
    Ok(contexts)
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
    journey_context: Option<&TaskListHeadlessJourneyCandidateContext>,
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
        journey_context.map(|context| context.journey_id.as_str()),
        journey_context.map(|context| context.session_id.as_str()),
        journey_context.map(|context| context.journey_fingerprint.as_str()),
        journey_context.map(|context| context.next_session_sequence),
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
        journey_id: journey_context.map(|context| context.journey_id.clone()),
        session_id: journey_context.map(|context| context.session_id.clone()),
        journey_fingerprint: journey_context.map(|context| context.journey_fingerprint.clone()),
        next_session_sequence: journey_context.map(|context| context.next_session_sequence),
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
    journey_id: Option<&str>,
    session_id: Option<&str>,
    journey_fingerprint: Option<&str>,
    next_session_sequence: Option<u64>,
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
        ("journey_id", journey_id.unwrap_or("").to_string()),
        ("session_id", session_id.unwrap_or("").to_string()),
        (
            "journey_fingerprint",
            journey_fingerprint.unwrap_or("").to_string(),
        ),
        (
            "next_session_sequence",
            next_session_sequence
                .map(|sequence| sequence.to_string())
                .unwrap_or_default(),
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

// Run/task inspection progress helpers live here to keep read-only progress projection out of lib.rs.
pub(super) fn progress_snapshot_for_run(
    task: Option<&TaskRecord>,
    events: &[LedgerEvent],
    child_tasks: &[TaskRecord],
    parent_join_readiness_summary: Option<&RunInspectParentJoinReadinessSummary>,
) -> ProgressSnapshot {
    let created_controlled_child_count = child_tasks
        .iter()
        .filter(|child| child.status == TaskStatus::Created)
        .count();
    let queued_controlled_child_count = child_tasks
        .iter()
        .filter(|child| child.status == TaskStatus::Queued)
        .count();
    let running_controlled_child_count = child_tasks
        .iter()
        .filter(|child| child.status == TaskStatus::Running)
        .count();
    let completed_controlled_child_count = child_tasks
        .iter()
        .filter(|child| child.status == TaskStatus::Completed)
        .count();
    let failed_controlled_child_count = child_tasks
        .iter()
        .filter(|child| child.status == TaskStatus::Failed)
        .count();
    let cancelled_controlled_child_count = child_tasks
        .iter()
        .filter(|child| child.status == TaskStatus::Cancelled)
        .count();
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
    let agent_loop_terminal_evidence_present = events
        .iter()
        .any(|event| event.kind == LedgerEventKind::AgentLoopCompleted);
    let task_terminal_event_present = events.iter().any(|event| {
        matches!(
            event.kind,
            LedgerEventKind::TaskCompleted
                | LedgerEventKind::TaskFailed
                | LedgerEventKind::TaskCancelled
        )
    });
    let latest_task_terminal_event_kind = latest_task_terminal_event_kind(events);
    let verification_state = progress_verification_state(events);
    let verifier_required = progress_verifier_required(events)
        || matches!(
            verification_state,
            ProgressVerificationState::Pending
                | ProgressVerificationState::Passed
                | ProgressVerificationState::Failed
                | ProgressVerificationState::Unknown
        );
    let verifier_failed = verification_state == ProgressVerificationState::Failed;
    let verifier_passed = verification_state == ProgressVerificationState::Passed;
    let recovery_signal_present = task.is_some_and(|task| {
        task.recovery_cycle_provenance.is_some()
            || task.verification_recovery_provenance.is_some()
            || task.verification_recovery_retry_provenance.is_some()
            || task.llm_provider_failure_retry_provenance.is_some()
    }) || events.iter().any(|event| {
        event.payload.as_ref().is_some_and(|payload| {
            payload.get("verification_recovery").is_some()
                || payload.get("verification_recovery_retry").is_some()
                || payload.get("verification_recovery_repair").is_some()
                || payload.get("recovery_cycle_budget_outcome").is_some()
        })
    });
    let apply_signal_present = events
        .iter()
        .any(|event| event.kind == LedgerEventKind::WorkspacePatchApplyResultRecorded);
    let selected_index_context_count = events
        .iter()
        .filter(|event| event.kind == LedgerEventKind::CodebaseIndexPromptContextMaterialized)
        .count();
    let selected_index_context_present = selected_index_context_count > 0;
    let parent_join_ready = parent_join_readiness_summary.is_some_and(|summary| {
        summary.parent_join_ready && summary.next_action == "run_parent_task_explicitly"
    });
    let has_running_evidence = events.iter().any(|event| {
        matches!(
            event.kind,
            LedgerEventKind::TaskRunning | LedgerEventKind::AgentLoopStarted
        )
    });

    let task_status = task.map(|task| &task.status);
    let (lifecycle_phase, current_stage, next_action) = match task_status {
        Some(TaskStatus::Failed) => {
            let action = if verification_state == ProgressVerificationState::Failed {
                ProgressNextAction::StartVerificationRecoveryExplicitly
            } else {
                ProgressNextAction::InspectTerminalResult
            };
            (
                ProgressLifecyclePhase::Terminal,
                ProgressCurrentStage::Failed,
                action,
            )
        }
        Some(TaskStatus::Cancelled) => (
            ProgressLifecyclePhase::Terminal,
            ProgressCurrentStage::Cancelled,
            ProgressNextAction::InspectTerminalResult,
        ),
        Some(TaskStatus::Completed) if non_runnable_controlled_child_count > 0 => (
            ProgressLifecyclePhase::BlockedForExplicitAction,
            ProgressCurrentStage::InspectNonRunnableChildTasks,
            ProgressNextAction::InspectNonRunnableChildTasks,
        ),
        Some(TaskStatus::Completed) if pending_controlled_child_count > 0 => (
            ProgressLifecyclePhase::BlockedForExplicitAction,
            ProgressCurrentStage::CompletedWithPendingChildren,
            ProgressNextAction::RunRemainingChildTasksExplicitly,
        ),
        Some(TaskStatus::Completed) if parent_join_ready => (
            ProgressLifecyclePhase::BlockedForExplicitAction,
            ProgressCurrentStage::ParentJoinReady,
            ProgressNextAction::RunParentTaskExplicitly,
        ),
        Some(TaskStatus::Completed) => (
            ProgressLifecyclePhase::Terminal,
            ProgressCurrentStage::Completed,
            ProgressNextAction::InspectTerminalResult,
        ),
        Some(TaskStatus::Running) => (
            ProgressLifecyclePhase::Running,
            ProgressCurrentStage::RunningAgentLoop,
            ProgressNextAction::InspectTask,
        ),
        Some(TaskStatus::Queued) => (
            ProgressLifecyclePhase::Queued,
            ProgressCurrentStage::Queued,
            ProgressNextAction::RunTaskExplicitly,
        ),
        Some(TaskStatus::Created) => (
            ProgressLifecyclePhase::Created,
            ProgressCurrentStage::Created,
            ProgressNextAction::RunTaskExplicitly,
        ),
        None if has_running_evidence => (
            ProgressLifecyclePhase::Running,
            ProgressCurrentStage::RunningAgentLoop,
            ProgressNextAction::InspectTask,
        ),
        _ if non_runnable_controlled_child_count > 0 => (
            ProgressLifecyclePhase::BlockedForExplicitAction,
            ProgressCurrentStage::InspectNonRunnableChildTasks,
            ProgressNextAction::InspectNonRunnableChildTasks,
        ),
        _ if pending_controlled_child_count > 0 => (
            ProgressLifecyclePhase::BlockedForExplicitAction,
            ProgressCurrentStage::CompletedWithPendingChildren,
            ProgressNextAction::RunRemainingChildTasksExplicitly,
        ),
        _ if verification_state == ProgressVerificationState::Failed => (
            ProgressLifecyclePhase::BlockedForExplicitAction,
            ProgressCurrentStage::Failed,
            ProgressNextAction::StartVerificationRecoveryExplicitly,
        ),
        _ if recovery_signal_present => (
            ProgressLifecyclePhase::BlockedForExplicitAction,
            ProgressCurrentStage::Unknown,
            ProgressNextAction::RunTaskExplicitly,
        ),
        None if selected_index_context_present => (
            ProgressLifecyclePhase::Unknown,
            ProgressCurrentStage::Unknown,
            ProgressNextAction::InspectTask,
        ),
        None => (
            ProgressLifecyclePhase::Unknown,
            ProgressCurrentStage::Unknown,
            ProgressNextAction::InspectTask,
        ),
    };
    let source_fingerprint = progress_snapshot_source_fingerprint(&[
        ("version", "progress_snapshot_v3".to_string()),
        (
            "task_status",
            task_status
                .map(|status| format!("{status:?}"))
                .unwrap_or_else(|| "None".to_string()),
        ),
        ("lifecycle_phase", format!("{lifecycle_phase:?}")),
        ("current_stage", format!("{current_stage:?}")),
        ("next_action", format!("{next_action:?}")),
        ("event_count", events.len().to_string()),
        (
            "agent_loop_terminal_evidence_present",
            agent_loop_terminal_evidence_present.to_string(),
        ),
        (
            "task_terminal_event_present",
            task_terminal_event_present.to_string(),
        ),
        (
            "latest_task_terminal_event_kind",
            latest_task_terminal_event_kind
                .as_deref()
                .unwrap_or("none")
                .to_string(),
        ),
        ("controlled_child_count", child_tasks.len().to_string()),
        (
            "created_controlled_child_count",
            created_controlled_child_count.to_string(),
        ),
        (
            "queued_controlled_child_count",
            queued_controlled_child_count.to_string(),
        ),
        (
            "running_controlled_child_count",
            running_controlled_child_count.to_string(),
        ),
        (
            "completed_controlled_child_count",
            completed_controlled_child_count.to_string(),
        ),
        (
            "failed_controlled_child_count",
            failed_controlled_child_count.to_string(),
        ),
        (
            "cancelled_controlled_child_count",
            cancelled_controlled_child_count.to_string(),
        ),
        (
            "pending_controlled_child_count",
            pending_controlled_child_count.to_string(),
        ),
        (
            "terminal_controlled_child_count",
            terminal_controlled_child_count.to_string(),
        ),
        (
            "non_runnable_controlled_child_count",
            non_runnable_controlled_child_count.to_string(),
        ),
        ("verification_state", format!("{verification_state:?}")),
        ("verifier_required", verifier_required.to_string()),
        ("verifier_failed", verifier_failed.to_string()),
        ("verifier_passed", verifier_passed.to_string()),
        ("parent_join_ready", parent_join_ready.to_string()),
        (
            "recovery_signal_present",
            recovery_signal_present.to_string(),
        ),
        ("apply_signal_present", apply_signal_present.to_string()),
        (
            "selected_index_context_present",
            selected_index_context_present.to_string(),
        ),
        (
            "selected_index_context_count",
            selected_index_context_count.to_string(),
        ),
    ]);

    ProgressSnapshot {
        lifecycle_phase,
        current_stage,
        next_action,
        source_fingerprint,
        event_count: events.len(),
        agent_loop_terminal_evidence_present,
        task_terminal_event_present,
        controlled_child_count: child_tasks.len(),
        pending_controlled_child_count,
        terminal_controlled_child_count,
        non_runnable_controlled_child_count,
        verification_state,
        verifier_required,
        verifier_failed,
        verifier_passed,
        recovery_signal_present,
        apply_signal_present,
        selected_index_context_present,
        selected_index_context_count,
    }
}

pub(super) fn progress_snapshot_source_fingerprint(entries: &[(&str, String)]) -> String {
    let mut canonical = String::new();
    for (key, value) in entries {
        canonical.push_str(key);
        canonical.push('\0');
        canonical.push_str(&value.len().to_string());
        canonical.push('\0');
        canonical.push_str(value);
        canonical.push('\n');
    }
    format!("sha256:{}", hex_sha256(canonical.as_bytes()))
}

fn latest_task_terminal_event_kind(events: &[LedgerEvent]) -> Option<String> {
    events
        .iter()
        .rev()
        .find(|event| {
            matches!(
                event.kind,
                LedgerEventKind::TaskCompleted
                    | LedgerEventKind::TaskFailed
                    | LedgerEventKind::TaskCancelled
            )
        })
        .map(|event| format!("{:?}", event.kind))
}

enum ProgressVerificationGateStatus<'a> {
    Known(&'a str),
    Malformed,
}

fn latest_progress_verification_gate_status(
    events: &[LedgerEvent],
) -> Option<ProgressVerificationGateStatus<'_>> {
    events.iter().rev().find_map(|event| {
        if !is_progress_verification_gate_event_kind(&event.kind) {
            return None;
        }
        let payload = event.payload.as_ref()?;
        if payload.get("verification_completion_gate_status").is_some() {
            return Some(
                payload
                    .get("verification_completion_gate_status")
                    .and_then(Value::as_str)
                    .map(ProgressVerificationGateStatus::Known)
                    .unwrap_or(ProgressVerificationGateStatus::Malformed),
            );
        }
        if let Some(gate) = payload.get("verification_completion_gate") {
            return Some(
                gate.get("status")
                    .and_then(Value::as_str)
                    .map(ProgressVerificationGateStatus::Known)
                    .unwrap_or(ProgressVerificationGateStatus::Malformed),
            );
        }
        None
    })
}

fn is_progress_verification_gate_event_kind(kind: &LedgerEventKind) -> bool {
    matches!(
        kind,
        LedgerEventKind::TaskCompleted
            | LedgerEventKind::TaskFailed
            | LedgerEventKind::TaskCancelled
    )
}

fn progress_verifier_required(events: &[LedgerEvent]) -> bool {
    !required_verification_intents(events).is_empty()
        || events.iter().any(|event| {
            if !is_progress_verification_gate_event_kind(&event.kind) {
                return false;
            }
            event.payload.as_ref().is_some_and(|payload| {
                payload.get("verification_completion_gate_status").is_some()
                    || payload.get("verification_completion_gate").is_some()
                    || payload
                        .get("required_verifier_count")
                        .and_then(Value::as_u64)
                        .is_some_and(|count| count > 0)
            })
        })
}

pub(super) fn progress_verification_state(events: &[LedgerEvent]) -> ProgressVerificationState {
    match latest_progress_verification_gate_status(events) {
        Some(ProgressVerificationGateStatus::Known(VERIFICATION_COMPLETION_GATE_STATUS_PASSED)) => {
            ProgressVerificationState::Passed
        }
        Some(ProgressVerificationGateStatus::Known(VERIFICATION_COMPLETION_GATE_STATUS_FAILED)) => {
            ProgressVerificationState::Failed
        }
        Some(_) => ProgressVerificationState::Unknown,
        None if progress_verifier_required(events) => ProgressVerificationState::Pending,
        None => ProgressVerificationState::NotRequired,
    }
}

pub(super) fn parent_join_readiness_summary_for_parent_inspection(
    store: &BrownieStore,
    record: &TaskRecord,
) -> Result<Option<RunInspectParentJoinReadinessSummary>, String> {
    if record.parent_run_id.is_some() || record.status != TaskStatus::Completed {
        return Ok(None);
    }
    let Some(parent_task_id) = non_empty_record_string(Some(record.task_id.as_str())) else {
        return Ok(None);
    };
    let Some(parent_run_id) = non_empty_record_string(Some(record.run_id.as_str())) else {
        return Ok(None);
    };

    let controlled_children = controlled_child_records_for_parent_run(
        store,
        Some(&parent_task_id),
        &parent_run_id,
        None,
    )?;
    if controlled_children.is_empty() {
        return Ok(None);
    }

    let terminal_controlled_child_count = controlled_children
        .iter()
        .filter(|child| is_parent_join_terminal_child_status(&child.status))
        .count();
    let pending_controlled_child_task_ids = controlled_children
        .iter()
        .filter(|child| is_parent_join_runnable_pending_child_status(&child.status))
        .map(|child| child.task_id.clone())
        .collect::<Vec<_>>();
    let pending_controlled_child_count = pending_controlled_child_task_ids.len();
    let non_runnable_controlled_child_task_ids = controlled_children
        .iter()
        .filter(|child| is_parent_join_non_runnable_child_status(&child.status))
        .map(|child| child.task_id.clone())
        .collect::<Vec<_>>();
    let non_runnable_controlled_child_count = non_runnable_controlled_child_task_ids.len();
    let parent_join_ready =
        if pending_controlled_child_count == 0 && non_runnable_controlled_child_count == 0 {
            if terminal_controlled_child_count == 0 {
                return Ok(None);
            }
            for child in &controlled_children {
                if !child_has_terminal_parent_join_outcome(store, child)
                    .map_err(task_run_admission_rejection_message)?
                {
                    return Ok(None);
                }
            }
            let child_evidence = controlled_children
                .iter()
                .map(|child| {
                    parent_join_child_completion_evidence(store, child)
                        .map_err(task_run_admission_rejection_message)
                })
                .collect::<Result<Vec<_>, _>>()?;
            let (child_completion_fingerprint, _) =
                parent_join_child_completion_fingerprint(&child_evidence);
            !parent_join_child_completion_fingerprint_consumed(
                store,
                record,
                &child_completion_fingerprint,
            )
            .map_err(task_run_admission_rejection_message)?
        } else {
            false
        };
    if pending_controlled_child_count == 0
        && non_runnable_controlled_child_count == 0
        && !parent_join_ready
    {
        return Ok(None);
    }
    let next_action = if non_runnable_controlled_child_count > 0 {
        "inspect_non_runnable_child_tasks"
    } else if parent_join_ready {
        "run_parent_task_explicitly"
    } else {
        "run_remaining_child_tasks_explicitly"
    };

    Ok(Some(RunInspectParentJoinReadinessSummary {
        parent_task_id,
        parent_run_id,
        terminal_controlled_child_count,
        pending_controlled_child_count,
        pending_controlled_child_task_ids,
        non_runnable_controlled_child_count,
        non_runnable_controlled_child_task_ids,
        parent_join_ready,
        parent_running_enabled: false,
        next_action: next_action.to_string(),
    }))
}

pub(super) fn consumed_parent_join_recovery_summary_for_parent_inspection(
    store: &BrownieStore,
    record: &TaskRecord,
) -> Result<Option<RunInspectConsumedParentJoinRecoverySummary>, String> {
    if record.parent_run_id.is_some() || record.status != TaskStatus::Completed {
        return Ok(None);
    }
    let Some(parent_task_id) = non_empty_record_string(Some(record.task_id.as_str())) else {
        return Ok(None);
    };
    let Some(parent_run_id) = non_empty_record_string(Some(record.run_id.as_str())) else {
        return Ok(None);
    };

    let parent_events = store
        .tasks()
        .read_ledger_events(&parent_run_id)
        .map_err(|error| error.to_string())?;
    let controlled_children = controlled_child_records_for_parent_run(
        store,
        Some(&parent_task_id),
        &parent_run_id,
        None,
    )?;
    if controlled_children.is_empty() {
        return Ok(None);
    }

    for event in parent_events.iter().rev() {
        let Some(consumption) = consumed_parent_join_fingerprint_from_event(event) else {
            continue;
        };
        if !parent_join_consumption_has_terminal_result(&parent_events, &consumption) {
            continue;
        }
        if consumed_terminal_controlled_child_set_for_consumed_parent_join(
            store,
            &parent_events,
            &controlled_children,
            &consumption,
        )?
        .is_none()
        {
            continue;
        }

        let continuation_children = continuation_controlled_children_for_consumed_parent_join(
            &parent_events,
            &controlled_children,
            &consumption,
        );
        let continuation_runnable_child_task_ids = continuation_children
            .iter()
            .filter(|child| is_parent_join_runnable_pending_child_status(&child.status))
            .map(|child| child.task_id.clone())
            .collect::<Vec<_>>();
        let continuation_runnable_child_count = continuation_runnable_child_task_ids.len();
        let continuation_non_runnable_child_task_ids = continuation_children
            .iter()
            .filter(|child| is_parent_join_non_runnable_child_status(&child.status))
            .map(|child| child.task_id.clone())
            .collect::<Vec<_>>();
        let continuation_non_runnable_child_count = continuation_non_runnable_child_task_ids.len();
        let continuation_terminal_child_count = continuation_children
            .iter()
            .filter(|child| is_parent_join_terminal_child_status(&child.status))
            .count();
        let next_action = if continuation_non_runnable_child_count > 0 {
            "inspect_non_runnable_continuation_child_tasks"
        } else if continuation_runnable_child_count > 0 {
            "run_continuation_child_tasks_explicitly"
        } else {
            "inspect_parent_task"
        };

        return Ok(Some(RunInspectConsumedParentJoinRecoverySummary {
            parent_task_id,
            parent_run_id,
            parent_join_consumed: true,
            consumed_terminal_controlled_child_count: consumption.child_completion_child_count,
            continuation_controlled_child_count: continuation_children.len(),
            continuation_runnable_child_count,
            continuation_runnable_child_task_ids,
            continuation_non_runnable_child_count,
            continuation_non_runnable_child_task_ids,
            continuation_terminal_child_count,
            parent_running_enabled: false,
            next_action: next_action.to_string(),
        }));
    }

    Ok(None)
}

pub(super) fn parent_join_readiness_summary_for_child_inspection(
    store: &BrownieStore,
    record: &TaskRecord,
) -> Result<Option<ChildInspectParentJoinReadinessSummary>, String> {
    if !task_has_complete_controlled_child_provenance(record) {
        return Ok(None);
    }
    let Some(parent_task_id) = non_empty_record_string(record.parent_task_id.as_deref()) else {
        return Ok(None);
    };
    let Some(parent_run_id) = non_empty_record_string(record.parent_run_id.as_deref()) else {
        return Ok(None);
    };
    let Some(parent_record) = store
        .tasks()
        .get_task(&parent_task_id)
        .map_err(|error| format!("invalid params: {error}"))?
    else {
        return Ok(None);
    };
    if parent_record.run_id != parent_run_id
        || parent_record.parent_run_id.is_some()
        || parent_record.status != TaskStatus::Completed
    {
        return Ok(None);
    }

    let mut controlled_children = controlled_child_records_for_parent_run(
        store,
        Some(&parent_task_id),
        &parent_run_id,
        None,
    )?;
    if !controlled_children
        .iter()
        .any(|child| child.task_id == record.task_id)
    {
        controlled_children.push(record.clone());
        sort_controlled_child_records(&mut controlled_children);
    }
    if controlled_children.is_empty() {
        return Ok(None);
    }

    let terminal_controlled_child_count = controlled_children
        .iter()
        .filter(|child| is_parent_join_terminal_child_status(&child.status))
        .count();
    let pending_controlled_child_task_ids = controlled_children
        .iter()
        .filter(|child| is_parent_join_runnable_pending_child_status(&child.status))
        .map(|child| child.task_id.clone())
        .collect::<Vec<_>>();
    let pending_controlled_child_count = pending_controlled_child_task_ids.len();
    let non_runnable_controlled_child_task_ids = controlled_children
        .iter()
        .filter(|child| is_parent_join_non_runnable_child_status(&child.status))
        .map(|child| child.task_id.clone())
        .collect::<Vec<_>>();
    let non_runnable_controlled_child_count = non_runnable_controlled_child_task_ids.len();
    let parent_join_ready =
        if pending_controlled_child_count == 0 && non_runnable_controlled_child_count == 0 {
            if terminal_controlled_child_count == 0 {
                return Ok(None);
            }
            for child in &controlled_children {
                if !child_has_terminal_parent_join_outcome(store, child)
                    .map_err(task_run_admission_rejection_message)?
                {
                    return Ok(None);
                }
            }
            let child_evidence = controlled_children
                .iter()
                .map(|child| {
                    parent_join_child_completion_evidence(store, child)
                        .map_err(task_run_admission_rejection_message)
                })
                .collect::<Result<Vec<_>, _>>()?;
            let (child_completion_fingerprint, _) =
                parent_join_child_completion_fingerprint(&child_evidence);
            !parent_join_child_completion_fingerprint_consumed(
                store,
                &parent_record,
                &child_completion_fingerprint,
            )
            .map_err(task_run_admission_rejection_message)?
        } else {
            false
        };
    if pending_controlled_child_count == 0
        && non_runnable_controlled_child_count == 0
        && !parent_join_ready
    {
        return Ok(None);
    }
    let next_action = if non_runnable_controlled_child_count > 0 {
        "inspect_non_runnable_child_tasks"
    } else if parent_join_ready {
        "run_parent_task_explicitly"
    } else {
        "run_remaining_child_tasks_explicitly"
    };

    Ok(Some(ChildInspectParentJoinReadinessSummary {
        parent_task_id,
        parent_run_id,
        inspected_child_task_id: record.task_id.clone(),
        inspected_child_run_id: record.run_id.clone(),
        inspected_child_status: record.status.clone(),
        terminal_controlled_child_count,
        pending_controlled_child_count,
        pending_controlled_child_task_ids,
        non_runnable_controlled_child_count,
        non_runnable_controlled_child_task_ids,
        parent_join_ready,
        parent_running_enabled: false,
        next_action: next_action.to_string(),
    }))
}

#[derive(Clone)]
struct ConsumedParentJoinFingerprint {
    admission_id: String,
    child_completion_fingerprint: String,
    child_completion_child_count: usize,
    child_terminal_completed_count: usize,
    child_terminal_failed_count: usize,
    child_recovery_cycle_depth: usize,
}

pub(super) fn consumed_parent_join_recovery_summary_for_child_inspection(
    store: &BrownieStore,
    record: &TaskRecord,
) -> Result<Option<ChildInspectConsumedParentJoinRecoverySummary>, String> {
    if !task_has_complete_controlled_child_provenance(record) {
        return Ok(None);
    }
    let Some(parent_task_id) = non_empty_record_string(record.parent_task_id.as_deref()) else {
        return Ok(None);
    };
    let Some(parent_run_id) = non_empty_record_string(record.parent_run_id.as_deref()) else {
        return Ok(None);
    };
    let Some(parent_record) = store
        .tasks()
        .get_task(&parent_task_id)
        .map_err(|error| format!("invalid params: {error}"))?
    else {
        return Ok(None);
    };
    if parent_record.run_id != parent_run_id
        || parent_record.parent_run_id.is_some()
        || parent_record.status != TaskStatus::Completed
    {
        return Ok(None);
    }

    let parent_events = store
        .tasks()
        .read_ledger_events(&parent_run_id)
        .map_err(|error| error.to_string())?;
    let mut controlled_children = controlled_child_records_for_parent_run(
        store,
        Some(&parent_task_id),
        &parent_run_id,
        None,
    )?;
    if !controlled_children
        .iter()
        .any(|child| child.task_id == record.task_id)
    {
        controlled_children.push(record.clone());
        sort_controlled_child_records(&mut controlled_children);
    }

    for event in parent_events.iter().rev() {
        let Some(consumption) = consumed_parent_join_fingerprint_from_event(event) else {
            continue;
        };
        if !parent_join_consumption_has_terminal_result(&parent_events, &consumption) {
            continue;
        }
        let inspected_is_continuation_child =
            child_recovery_provenance_matches_consumed_parent_join(record, &consumption)
                || child_handoff_fingerprint_matches_consumed_parent_join(
                    &parent_events,
                    record,
                    &consumption,
                );
        let inspected_is_consumed_terminal_child =
            consumed_terminal_controlled_child_set_contains_inspected_child(
                store,
                &parent_events,
                &controlled_children,
                &consumption,
                &record.task_id,
            )?;
        if !inspected_is_continuation_child && !inspected_is_consumed_terminal_child {
            continue;
        }

        let continuation_children = continuation_controlled_children_for_consumed_parent_join(
            &parent_events,
            &controlled_children,
            &consumption,
        );
        let continuation_runnable_child_task_ids = continuation_children
            .iter()
            .filter(|child| is_parent_join_runnable_pending_child_status(&child.status))
            .map(|child| child.task_id.clone())
            .collect::<Vec<_>>();
        let continuation_runnable_child_count = continuation_runnable_child_task_ids.len();
        let continuation_non_runnable_child_task_ids = continuation_children
            .iter()
            .filter(|child| is_parent_join_non_runnable_child_status(&child.status))
            .map(|child| child.task_id.clone())
            .collect::<Vec<_>>();
        let continuation_non_runnable_child_count = continuation_non_runnable_child_task_ids.len();
        let continuation_terminal_child_count = continuation_children
            .iter()
            .filter(|child| is_parent_join_terminal_child_status(&child.status))
            .count();
        let next_action = if continuation_non_runnable_child_count > 0 {
            "inspect_non_runnable_continuation_child_tasks"
        } else if continuation_runnable_child_count > 0 {
            "run_continuation_child_tasks_explicitly"
        } else {
            "inspect_parent_task"
        };

        return Ok(Some(ChildInspectConsumedParentJoinRecoverySummary {
            parent_task_id,
            parent_run_id,
            inspected_child_task_id: record.task_id.clone(),
            inspected_child_run_id: record.run_id.clone(),
            inspected_child_status: record.status.clone(),
            parent_join_consumed: true,
            consumed_terminal_controlled_child_count: consumption.child_completion_child_count,
            continuation_controlled_child_count: continuation_children.len(),
            continuation_runnable_child_count,
            continuation_runnable_child_task_ids,
            continuation_non_runnable_child_count,
            continuation_non_runnable_child_task_ids,
            continuation_terminal_child_count,
            parent_running_enabled: false,
            next_action: next_action.to_string(),
        }));
    }

    Ok(None)
}

fn consumed_parent_join_fingerprint_from_event(
    event: &LedgerEvent,
) -> Option<ConsumedParentJoinFingerprint> {
    if event.kind != LedgerEventKind::ParentJoinContinuationFingerprintConsumed {
        return None;
    }
    let payload = event.payload.as_ref()?;
    let admission_id = non_empty_payload_string(payload, "admission_id")?;
    let child_completion_fingerprint =
        non_empty_payload_string(payload, "child_completion_fingerprint")?;
    if !is_sha256_fingerprint(&child_completion_fingerprint) {
        return None;
    }
    Some(ConsumedParentJoinFingerprint {
        admission_id,
        child_completion_fingerprint,
        child_completion_child_count: payload_usize(payload, "child_completion_child_count")?,
        child_terminal_completed_count: payload_usize(payload, "child_terminal_completed_count")?,
        child_terminal_failed_count: payload_usize(payload, "child_terminal_failed_count")?,
        child_recovery_cycle_depth: payload_usize(payload, "child_recovery_cycle_depth")?,
    })
}

fn parent_join_consumption_has_terminal_result(
    parent_events: &[LedgerEvent],
    consumption: &ConsumedParentJoinFingerprint,
) -> bool {
    let Some(running_index) = parent_events.iter().position(|candidate| {
        candidate.kind == LedgerEventKind::TaskRunning
            && candidate
                .payload
                .as_ref()
                .and_then(|payload| payload.get("admission_id"))
                .and_then(Value::as_str)
                == Some(consumption.admission_id.as_str())
    }) else {
        return false;
    };
    parent_events
        .iter()
        .skip(running_index + 1)
        .take_while(|candidate| {
            candidate.kind != LedgerEventKind::ParentJoinContinuationFingerprintConsumed
        })
        .any(|candidate| {
            matches!(
                candidate.kind,
                LedgerEventKind::TaskCompleted
                    | LedgerEventKind::TaskFailed
                    | LedgerEventKind::TaskCancelled
            )
        })
}

fn child_recovery_provenance_matches_consumed_parent_join(
    child: &TaskRecord,
    consumption: &ConsumedParentJoinFingerprint,
) -> bool {
    let Some(provenance) = child.recovery_cycle_provenance.as_ref() else {
        return false;
    };
    recovery_cycle_child_provenance_is_internally_valid(provenance)
        && provenance.parent_join_admission_id == consumption.admission_id
        && provenance.parent_join_child_completion_fingerprint
            == consumption.child_completion_fingerprint
        && provenance.parent_join_child_completion_child_count
            == consumption.child_completion_child_count
        && provenance.parent_join_terminal_completed_child_count
            == consumption.child_terminal_completed_count
        && provenance.parent_join_terminal_failed_child_count
            == consumption.child_terminal_failed_count
        && provenance.parent_join_recovery_cycle_depth == consumption.child_recovery_cycle_depth
}

fn child_handoff_fingerprint_matches_consumed_parent_join(
    parent_events: &[LedgerEvent],
    child: &TaskRecord,
    consumption: &ConsumedParentJoinFingerprint,
) -> bool {
    let Some(fingerprint) = child.source_handoff_envelope_fingerprint.as_ref() else {
        return false;
    };
    consumed_parent_join_continuation_handoff_fingerprints(parent_events, consumption)
        .contains(fingerprint)
}

fn consumed_terminal_controlled_child_set_contains_inspected_child(
    store: &BrownieStore,
    parent_events: &[LedgerEvent],
    controlled_children: &[TaskRecord],
    consumption: &ConsumedParentJoinFingerprint,
    inspected_child_task_id: &str,
) -> Result<bool, String> {
    Ok(
        consumed_terminal_controlled_child_set_for_consumed_parent_join(
            store,
            parent_events,
            controlled_children,
            consumption,
        )?
        .is_some_and(|consumed_children| {
            consumed_children
                .iter()
                .any(|child| child.task_id == inspected_child_task_id)
        }),
    )
}

fn consumed_terminal_controlled_child_set_for_consumed_parent_join(
    store: &BrownieStore,
    parent_events: &[LedgerEvent],
    controlled_children: &[TaskRecord],
    consumption: &ConsumedParentJoinFingerprint,
) -> Result<Option<Vec<TaskRecord>>, String> {
    let mut consumed_children = controlled_children
        .iter()
        .filter(|child| is_parent_join_terminal_child_status(&child.status))
        .filter(|child| match child.recovery_cycle_provenance.as_ref() {
            Some(provenance) => {
                recovery_cycle_child_provenance_is_internally_valid(provenance)
                    && provenance.parent_join_child_completion_child_count
                        < consumption.child_completion_child_count
                    && parent_events.iter().any(|event| {
                        recovery_cycle_provenance_matches_parent_join(event, provenance)
                    })
            }
            None => true,
        })
        .cloned()
        .collect::<Vec<_>>();
    sort_controlled_child_records(&mut consumed_children);
    if consumed_children.len() != consumption.child_completion_child_count {
        return Ok(None);
    }
    if consumed_children
        .iter()
        .filter(|child| child.status == TaskStatus::Completed)
        .count()
        != consumption.child_terminal_completed_count
        || consumed_children
            .iter()
            .filter(|child| child.status == TaskStatus::Failed)
            .count()
            != consumption.child_terminal_failed_count
    {
        return Ok(None);
    }
    for child in &consumed_children {
        if !child_has_terminal_parent_join_outcome(store, child)
            .map_err(task_run_admission_rejection_message)?
        {
            return Ok(None);
        }
    }
    let child_evidence = consumed_children
        .iter()
        .map(|child| {
            parent_join_child_completion_evidence(store, child)
                .map_err(task_run_admission_rejection_message)
        })
        .collect::<Result<Vec<_>, _>>()?;
    let (child_completion_fingerprint, _) =
        parent_join_child_completion_fingerprint(&child_evidence);
    if child_completion_fingerprint != consumption.child_completion_fingerprint {
        return Ok(None);
    }
    Ok(Some(consumed_children))
}

fn continuation_controlled_children_for_consumed_parent_join(
    parent_events: &[LedgerEvent],
    controlled_children: &[TaskRecord],
    consumption: &ConsumedParentJoinFingerprint,
) -> Vec<TaskRecord> {
    let continuation_handoff_fingerprints =
        consumed_parent_join_continuation_handoff_fingerprints(parent_events, consumption);
    let mut continuation_children = controlled_children
        .iter()
        .filter(|child| {
            child_recovery_provenance_matches_consumed_parent_join(child, consumption)
                || child
                    .source_handoff_envelope_fingerprint
                    .as_ref()
                    .is_some_and(|fingerprint| {
                        continuation_handoff_fingerprints.contains(fingerprint)
                    })
        })
        .cloned()
        .collect::<Vec<_>>();
    sort_controlled_child_records(&mut continuation_children);
    continuation_children
}

fn consumed_parent_join_continuation_handoff_fingerprints(
    parent_events: &[LedgerEvent],
    consumption: &ConsumedParentJoinFingerprint,
) -> Vec<String> {
    let mut fingerprints = parent_events
        .iter()
        .filter(|event| event.kind == LedgerEventKind::SubtaskDispatchHandoffEnvelopeRecorded)
        .filter_map(|event| event.payload.as_ref())
        .filter(|payload| {
            payload
                .get("continuation_materialization")
                .and_then(Value::as_bool)
                == Some(true)
                && payload
                    .get("handoff_envelope_status")
                    .and_then(Value::as_str)
                    == Some("Accepted")
                && payload
                    .get("parent_join_admission_id")
                    .and_then(Value::as_str)
                    == Some(consumption.admission_id.as_str())
                && payload
                    .get("parent_join_child_completion_fingerprint")
                    .and_then(Value::as_str)
                    == Some(consumption.child_completion_fingerprint.as_str())
                && payload_usize_eq(
                    payload,
                    "parent_join_child_completion_child_count",
                    consumption.child_completion_child_count,
                )
                && payload_usize_eq(
                    payload,
                    "parent_join_terminal_completed_child_count",
                    consumption.child_terminal_completed_count,
                )
                && payload_usize_eq(
                    payload,
                    "parent_join_terminal_failed_child_count",
                    consumption.child_terminal_failed_count,
                )
        })
        .filter_map(|payload| {
            payload
                .get("handoff_envelope_fingerprint")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|fingerprint| is_sha256_fingerprint(fingerprint))
                .map(ToString::to_string)
        })
        .collect::<Vec<_>>();
    fingerprints.sort();
    fingerprints.dedup();
    fingerprints
}
