use super::*;

#[derive(Debug, Clone)]
pub(super) struct HeadlessProductContinuationAdmissionReplay {
    decision_id: String,
    continuation_id: String,
    request_fingerprint: String,
    admission: ProductContinuationAdmission,
    post_progress_fingerprint: String,
    post_aggregate_sequence: u64,
}

#[derive(Debug, Clone)]
pub(super) struct HeadlessProductLoopStopRecoveryReplay {
    decision_id: String,
    continuation_id: String,
    request_fingerprint: String,
    selected_task_id: String,
    selected_run_id: String,
    stop_reason: String,
    drive_fingerprint: String,
    post_progress_fingerprint: String,
    post_aggregate_sequence: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ProductLoopStopRecoveryClass {
    RecoverableFault,
    TerminalProductComplete,
    BudgetExhausted,
}

impl ProductLoopStopRecoveryClass {
    fn as_str(self) -> &'static str {
        match self {
            Self::RecoverableFault => "recoverable_fault",
            Self::TerminalProductComplete => "terminal_product_complete",
            Self::BudgetExhausted => "budget_exhausted",
        }
    }
}

pub(super) fn handle_headless_continue_product_loop_stop_recovery(
    id: Value,
    store: &BrownieStore,
    progress_overview: &TaskListProgressOverview,
    params: HeadlessContinueOnceParams,
) -> JsonRpcResponse<Value> {
    let result =
        match headless_continue_product_loop_stop_recovery(store, progress_overview, &params) {
            Ok(result) => result,
            Err(VerificationRecoveryAdmissionError::InvalidParams(message)) => {
                return error_response(id, -32602, &message)
            }
            Err(VerificationRecoveryAdmissionError::Internal(message)) => {
                return error_response(id, -32603, &format!("internal error: {message}"))
            }
        };
    result_response(id, json!(result))
}

pub(super) fn validate_product_loop_stop_recovery_target(
    target: &ProductLoopStopRecoveryTarget,
) -> Result<(), VerificationRecoveryAdmissionError> {
    if !target.authorize_product_loop_stop_recovery {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: product_loop_stop_recovery_target.authorize_product_loop_stop_recovery must be true".into(),
        ));
    }
    if target.session_id.trim().is_empty() || target.drive_id.trim().is_empty() {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: product_loop_stop_recovery_target session_id and drive_id must not be empty".into(),
        ));
    }
    if !is_valid_headless_continuation_id(&target.session_id)
        || !is_valid_headless_continuation_id(&target.drive_id)
    {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: product_loop_stop_recovery_target session_id and drive_id must be bounded ids".into(),
        ));
    }
    if !is_sha256_fingerprint(&target.expected_drive_fingerprint) {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: product_loop_stop_recovery_target.expected_drive_fingerprint must be a sha256 fingerprint".into(),
        ));
    }
    if !is_bounded_product_loop_stop_label(&target.expected_stop_reason) {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: product_loop_stop_recovery_target.expected_stop_reason must be bounded".into(),
        ));
    }
    if let Some(expected) = target.expected_post_progress_fingerprint.as_deref() {
        if !is_sha256_fingerprint(expected) {
            return Err(VerificationRecoveryAdmissionError::InvalidParams(
                "invalid params: product_loop_stop_recovery_target.expected_post_progress_fingerprint must be a sha256 fingerprint".into(),
            ));
        }
    }
    if let Some(expected) = target.expected_next_route_fingerprint.as_deref() {
        if !is_sha256_fingerprint(expected) {
            return Err(VerificationRecoveryAdmissionError::InvalidParams(
                "invalid params: product_loop_stop_recovery_target.expected_next_route_fingerprint must be a sha256 fingerprint".into(),
            ));
        }
    }
    if target.recovery_goal.trim().is_empty() || target.recovery_goal.len() > 500 {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: product_loop_stop_recovery_target.recovery_goal must be bounded"
                .into(),
        ));
    }
    if let Some(mode_id) = target.recovery_mode_id.as_deref() {
        if mode_id.trim().is_empty() || mode_id.len() > 96 {
            return Err(VerificationRecoveryAdmissionError::InvalidParams(
                "invalid params: product_loop_stop_recovery_target.recovery_mode_id must be bounded"
                    .into(),
            ));
        }
    }
    Ok(())
}

pub(super) fn is_bounded_product_loop_stop_label(value: &str) -> bool {
    !value.trim().is_empty()
        && value.len() <= 96
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':' | b'.'))
}

pub(super) fn headless_product_loop_stop_recovery_request_fingerprint(
    params: &HeadlessContinueOnceParams,
) -> Result<String, VerificationRecoveryAdmissionError> {
    let target = params
        .product_loop_stop_recovery_target
        .as_ref()
        .ok_or_else(|| {
            VerificationRecoveryAdmissionError::InvalidParams(
                "invalid params: product_loop_stop_recovery_target is required".into(),
            )
        })?;
    let continuation_id = params.continuation_id.as_deref().ok_or_else(|| {
        VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: product_loop_stop_recovery_target requires continuation_id".into(),
        )
    })?;
    let seed = json!({
        "route_kind": "product_loop_stop_recovery_admission",
        "continuation_id": continuation_id,
        "authorize": params.authorize,
        "expected_progress_fingerprint": params.expected_progress_fingerprint,
        "expected_aggregate_sequence": params.expected_aggregate_sequence,
        "authorize_product_loop_stop_recovery": target.authorize_product_loop_stop_recovery,
        "session_id": target.session_id,
        "drive_id": target.drive_id,
        "expected_drive_fingerprint": target.expected_drive_fingerprint,
        "expected_stop_reason": target.expected_stop_reason,
        "expected_end_session_sequence": target.expected_end_session_sequence,
        "expected_post_progress_fingerprint": target.expected_post_progress_fingerprint,
        "expected_next_route_fingerprint": target.expected_next_route_fingerprint,
        "recovery_goal": target.recovery_goal,
        "recovery_mode_id": target.recovery_mode_id,
    });
    Ok(format!(
        "sha256:{}",
        hex_sha256(seed.to_string().as_bytes())
    ))
}

pub(super) fn headless_product_loop_stop_recovery_route_fingerprint(
    route: &HeadlessContinueRoute,
) -> String {
    format!(
        "sha256:{}",
        hex_sha256(serde_json::to_string(route).unwrap_or_default().as_bytes())
    )
}

pub(super) fn classify_product_loop_stop_recovery_result(
    result: &HeadlessRunDriveResult,
) -> ProductLoopStopRecoveryClass {
    let decision_is_terminal =
        result
            .product_completion_decision
            .as_ref()
            .is_some_and(|decision| {
                decision.status == "product_complete"
                    || decision.next_action == "stop_autonomous_development"
            });
    if result.next_action == "stop_autonomous_development"
        || result.completion_closure.next_action == "stop_autonomous_development"
        || result.completion_closure.status == HeadlessRunCompletionClosureStatus::Complete
        || result.completion_finalization.is_some()
        || result.accepted_completion.is_some()
        || result.terminal_completion_evidence.is_some()
        || decision_is_terminal
    {
        return ProductLoopStopRecoveryClass::TerminalProductComplete;
    }
    if result.stop_reason == "product_continuation_checkpoint_missing" {
        return ProductLoopStopRecoveryClass::RecoverableFault;
    }
    if result.stop_reason == "drive_budget_exhausted" {
        return ProductLoopStopRecoveryClass::BudgetExhausted;
    }
    ProductLoopStopRecoveryClass::TerminalProductComplete
}

pub(super) fn product_loop_stop_recovery_source_progress_fingerprint(
    result: &HeadlessRunDriveResult,
) -> String {
    result
        .post_progress
        .as_ref()
        .unwrap_or(&result.start_progress)
        .progress_fingerprint
        .clone()
}

pub(super) fn product_loop_stop_recovery_next_route_fingerprint(
    result: &HeadlessRunDriveResult,
) -> Option<String> {
    result
        .next_route
        .as_ref()
        .map(headless_product_loop_stop_recovery_route_fingerprint)
}

pub(super) fn product_loop_stop_recovery_boundary_fingerprint(
    result: &HeadlessRunDriveResult,
) -> String {
    let seed = json!({
        "boundary": "product_loop_stop_recovery",
        "source_session_id": result.session_id,
        "source_drive_id": result.drive_id,
        "drive_fingerprint": result.drive_fingerprint,
        "stop_reason": result.stop_reason,
        "source_progress_fingerprint": product_loop_stop_recovery_source_progress_fingerprint(result),
        "end_session_sequence": result.end_session_sequence,
        "next_route_fingerprint": product_loop_stop_recovery_next_route_fingerprint(result),
    });
    format!("sha256:{}", hex_sha256(seed.to_string().as_bytes()))
}

pub(super) fn product_loop_stop_recovery_provenance_for_target(
    store: &BrownieStore,
    target: &ProductLoopStopRecoveryTarget,
) -> Result<ProductLoopStopRecoveryProvenance, VerificationRecoveryAdmissionError> {
    let checkpoint = store
        .tasks()
        .read_headless_run_session_drive_checkpoint(&target.session_id, &target.drive_id)
        .map_err(|error| VerificationRecoveryAdmissionError::Internal(error.to_string()))?
        .ok_or_else(|| {
            VerificationRecoveryAdmissionError::InvalidParams(
                "invalid params: product_loop_stop_recovery_target drive checkpoint is missing"
                    .into(),
            )
        })?;
    let result = &checkpoint.result;
    if result.drive_fingerprint != target.expected_drive_fingerprint {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: product_loop_stop_recovery_target drive fingerprint mismatch".into(),
        ));
    }
    if result.stop_reason != target.expected_stop_reason {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: product_loop_stop_recovery_target stop reason mismatch".into(),
        ));
    }
    if result.end_session_sequence != target.expected_end_session_sequence {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: product_loop_stop_recovery_target end session sequence mismatch"
                .into(),
        ));
    }
    if let Some(expected) = target.expected_post_progress_fingerprint.as_deref() {
        let actual = result
            .post_progress
            .as_ref()
            .map(|progress| progress.progress_fingerprint.as_str());
        if actual != Some(expected) {
            return Err(VerificationRecoveryAdmissionError::InvalidParams(
                "invalid params: product_loop_stop_recovery_target post progress fingerprint mismatch"
                    .into(),
            ));
        }
    }
    if let Some(expected) = target.expected_next_route_fingerprint.as_deref() {
        let actual = result
            .next_route
            .as_ref()
            .map(headless_product_loop_stop_recovery_route_fingerprint);
        if actual.as_deref() != Some(expected) {
            return Err(VerificationRecoveryAdmissionError::InvalidParams(
                "invalid params: product_loop_stop_recovery_target next route fingerprint mismatch"
                    .into(),
            ));
        }
    }
    let stop_class = classify_product_loop_stop_recovery_result(result);
    match stop_class {
        ProductLoopStopRecoveryClass::RecoverableFault => {}
        ProductLoopStopRecoveryClass::TerminalProductComplete => {
            return Err(VerificationRecoveryAdmissionError::InvalidParams(
                "invalid params: product_loop_stop_recovery_target stop evidence is terminal product complete".into(),
            ));
        }
        ProductLoopStopRecoveryClass::BudgetExhausted => {
            return Err(VerificationRecoveryAdmissionError::InvalidParams(
                "invalid params: product_loop_stop_recovery_target stop evidence exhausted product loop budget".into(),
            ));
        }
    }
    Ok(ProductLoopStopRecoveryProvenance {
        source_session_id: target.session_id.clone(),
        source_drive_id: target.drive_id.clone(),
        drive_fingerprint: result.drive_fingerprint.clone(),
        stop_reason: result.stop_reason.clone(),
        stop_class: stop_class.as_str().to_string(),
        source_progress_fingerprint: product_loop_stop_recovery_source_progress_fingerprint(result),
        end_session_sequence: result.end_session_sequence,
        next_route_fingerprint: product_loop_stop_recovery_next_route_fingerprint(result),
        recovery_boundary_fingerprint: product_loop_stop_recovery_boundary_fingerprint(result),
    })
}

pub(super) fn headless_continue_product_loop_stop_recovery(
    store: &BrownieStore,
    progress_overview: &TaskListProgressOverview,
    params: &HeadlessContinueOnceParams,
) -> Result<HeadlessContinueOnceResult, VerificationRecoveryAdmissionError> {
    let target = params
        .product_loop_stop_recovery_target
        .as_ref()
        .ok_or_else(|| {
            VerificationRecoveryAdmissionError::InvalidParams(
                "invalid params: product_loop_stop_recovery_target is required".into(),
            )
        })?;
    validate_product_loop_stop_recovery_target(target)?;
    let provenance = product_loop_stop_recovery_provenance_for_target(store, target)?;
    let continuation_id = params.continuation_id.clone().ok_or_else(|| {
        VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: product_loop_stop_recovery_target requires continuation_id".into(),
        )
    })?;
    let tasks = store
        .tasks()
        .list_tasks()
        .map_err(|error| VerificationRecoveryAdmissionError::Internal(error.to_string()))?;
    if headless_product_loop_stop_recovery_existing_boundary_admission(store, &tasks, target)?
        .is_some()
    {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: conflicting product loop stop recovery admission for drive stop evidence"
                .into(),
        ));
    }
    let request_fingerprint = headless_product_loop_stop_recovery_request_fingerprint(params)?;
    let policy = resolve_task_start_policy(target.recovery_mode_id.as_deref(), store)
        .map_err(VerificationRecoveryAdmissionError::InvalidParams)?;
    let admission = store
        .tasks()
        .start_product_loop_stop_recovery_task(ProductLoopStopRecoveryTaskStartParams {
            goal: target.recovery_goal.clone(),
            mode_id: Some(policy.mode_id.clone()),
            provenance: provenance.clone(),
        })
        .map_err(|error| VerificationRecoveryAdmissionError::Internal(error.to_string()))?;
    let record = admission.record;
    if !admission.replayed {
        append_mode_resolved_event(store, &record, &policy)
            .map_err(|error| VerificationRecoveryAdmissionError::Internal(error.to_string()))?;
    }
    let decision_id = format!("headless_decision_{}", uuid::Uuid::new_v4().simple());
    store
        .tasks()
        .append_task_event_with_payload(
            &record,
            LedgerEventKind::HeadlessContinuationDecisionRecorded,
            Some(json!({
                "decision_id": decision_id,
                "continuation_id": continuation_id,
                "route_kind": "product_loop_stop_recovery_admission",
                "request_fingerprint": request_fingerprint,
                "selected_task_id": record.task_id,
                "selected_run_id": record.run_id,
                "source_session_id": provenance.source_session_id,
                "source_drive_id": provenance.source_drive_id,
                "drive_fingerprint": provenance.drive_fingerprint,
                "stop_reason": provenance.stop_reason,
                "stop_class": provenance.stop_class,
                "source_progress_fingerprint": provenance.source_progress_fingerprint,
                "end_session_sequence": provenance.end_session_sequence,
                "next_route_fingerprint": provenance.next_route_fingerprint,
                "recovery_boundary_fingerprint": provenance.recovery_boundary_fingerprint,
                "execution_enabled": false,
                "scheduler_handoff_enabled": false,
                "next_action": "run_recovery_task_explicitly",
                "reason": "Product loop stop recovery task admitted from recoverable persisted drive stop evidence; execution remains explicit."
            })),
        )
        .map_err(|error| VerificationRecoveryAdmissionError::Internal(error.to_string()))?;
    let post_tasks = store
        .tasks()
        .list_tasks()
        .map_err(|error| VerificationRecoveryAdmissionError::Internal(error.to_string()))?;
    let post_progress = task_list_progress_overview(store, &post_tasks)
        .map_err(VerificationRecoveryAdmissionError::Internal)?;
    let next_route = HeadlessContinueRoute {
        kind: HeadlessContinueRouteKind::RunProductContinuationTaskExplicitly,
        reason:
            "Product-loop stop recovery task was admitted; running it remains an explicit next step."
                .to_string(),
        task_id: Some(record.task_id.clone()),
        run_id: Some(record.run_id.clone()),
        proposal_id: None,
        apply_id: None,
        failure_fingerprint: Some(target.expected_drive_fingerprint.clone()),
        apply_fingerprint: None,
        progress_fingerprint: Some(post_progress.source_fingerprint.clone()),
        aggregate_sequence: Some(post_progress.aggregate_sequence),
        next_action: "run_recovery_task_explicitly".to_string(),
    };
    Ok(HeadlessContinueOnceResult {
        status: HeadlessContinueOnceStatus::TaskExecuted,
        decision_id: Some(decision_id),
        continuation_id: Some(continuation_id),
        selected_task_id: Some(record.task_id.clone()),
        selected_run_id: Some(record.run_id.clone()),
        candidate_count: 1,
        expected_progress_fingerprint: params.expected_progress_fingerprint.clone(),
        expected_aggregate_sequence: params.expected_aggregate_sequence,
        current_progress_fingerprint: progress_overview.source_fingerprint.clone(),
        current_aggregate_sequence: progress_overview.aggregate_sequence,
        post_progress_fingerprint: Some(post_progress.source_fingerprint),
        post_aggregate_sequence: Some(post_progress.aggregate_sequence),
        stale: false,
        replayed: false,
        task_run_result: None,
        proposal_apply_result: None,
        objective_proposal_authorization_preflight_result: None,
        objective_apply_verification_result: None,
        objective_completion_acceptance_result: None,
        llm_provider_failure_retry_admission: None,
        product_continuation_admission: None,
        modepack_select_registry_update_result: None,
        modepack_fetch_candidate_result: None,
        modepack_verify_candidate_provenance_result: None,
        modepack_approve_candidate_result: None,
        modepack_replace_active_result: None,
        modepack_rollback_active_result: None,
        next_route: Some(next_route),
        max_steps: None,
        step_count: None,
        executed_count: None,
        replayed_count: None,
        stop_reason: None,
        steps: Vec::new(),
        next_action: "run_recovery_task_explicitly".to_string(),
    })
}

pub(super) fn headless_product_loop_stop_recovery_existing_boundary_admission(
    store: &BrownieStore,
    tasks: &[TaskRecord],
    target: &ProductLoopStopRecoveryTarget,
) -> Result<Option<HeadlessProductLoopStopRecoveryReplay>, VerificationRecoveryAdmissionError> {
    for task in tasks {
        let events = store
            .tasks()
            .read_ledger_events(&task.run_id)
            .map_err(|error| VerificationRecoveryAdmissionError::Internal(error.to_string()))?;
        for payload in events
            .iter()
            .filter(|event| event.kind == LedgerEventKind::HeadlessContinuationDecisionRecorded)
            .filter_map(|event| event.payload.as_ref())
        {
            if payload.get("route_kind").and_then(Value::as_str)
                != Some("product_loop_stop_recovery_admission")
                || payload.get("source_session_id").and_then(Value::as_str)
                    != Some(target.session_id.as_str())
                || payload.get("source_drive_id").and_then(Value::as_str)
                    != Some(target.drive_id.as_str())
                || payload.get("drive_fingerprint").and_then(Value::as_str)
                    != Some(target.expected_drive_fingerprint.as_str())
                || payload.get("stop_reason").and_then(Value::as_str)
                    != Some(target.expected_stop_reason.as_str())
                || payload.get("end_session_sequence").and_then(Value::as_u64)
                    != Some(target.expected_end_session_sequence)
            {
                continue;
            }
            let replay = HeadlessProductLoopStopRecoveryReplay {
                decision_id: payload_string(payload, "decision_id")
                    .map_err(VerificationRecoveryAdmissionError::Internal)?,
                continuation_id: payload_string(payload, "continuation_id")
                    .map_err(VerificationRecoveryAdmissionError::Internal)?,
                request_fingerprint: payload_string(payload, "request_fingerprint")
                    .map_err(VerificationRecoveryAdmissionError::Internal)?,
                selected_task_id: payload_string(payload, "selected_task_id")
                    .map_err(VerificationRecoveryAdmissionError::Internal)?,
                selected_run_id: payload_string(payload, "selected_run_id")
                    .map_err(VerificationRecoveryAdmissionError::Internal)?,
                stop_reason: payload_string(payload, "stop_reason")
                    .map_err(VerificationRecoveryAdmissionError::Internal)?,
                drive_fingerprint: payload_string(payload, "drive_fingerprint")
                    .map_err(VerificationRecoveryAdmissionError::Internal)?,
                post_progress_fingerprint: payload
                    .get("post_result_progress_fingerprint")
                    .or_else(|| payload.get("post_progress_fingerprint"))
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                post_aggregate_sequence: payload
                    .get("post_aggregate_sequence")
                    .and_then(Value::as_u64)
                    .unwrap_or_default(),
            };
            return Ok(Some(replay));
        }
    }
    Ok(None)
}

pub(super) fn headless_product_loop_stop_recovery_decision_for_replay(
    store: &BrownieStore,
    tasks: &[TaskRecord],
    continuation_id: &str,
) -> Result<Option<HeadlessProductLoopStopRecoveryReplay>, String> {
    for task in tasks {
        let events = store
            .tasks()
            .read_ledger_events(&task.run_id)
            .map_err(|error| error.to_string())?;
        for payload in events
            .iter()
            .filter(|event| event.kind == LedgerEventKind::HeadlessContinuationDecisionRecorded)
            .filter_map(|event| event.payload.as_ref())
        {
            if payload.get("route_kind").and_then(Value::as_str)
                != Some("product_loop_stop_recovery_admission")
                || payload.get("continuation_id").and_then(Value::as_str) != Some(continuation_id)
            {
                continue;
            }
            return Ok(Some(HeadlessProductLoopStopRecoveryReplay {
                decision_id: payload_string(payload, "decision_id")?,
                continuation_id: continuation_id.to_string(),
                request_fingerprint: payload_string(payload, "request_fingerprint")?,
                selected_task_id: payload_string(payload, "selected_task_id")?,
                selected_run_id: payload_string(payload, "selected_run_id")?,
                stop_reason: payload_string(payload, "stop_reason")?,
                drive_fingerprint: payload_string(payload, "drive_fingerprint")?,
                post_progress_fingerprint: payload
                    .get("post_result_progress_fingerprint")
                    .or_else(|| payload.get("post_progress_fingerprint"))
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                post_aggregate_sequence: payload
                    .get("post_aggregate_sequence")
                    .and_then(Value::as_u64)
                    .unwrap_or_default(),
            }));
        }
    }
    Ok(None)
}

pub(super) fn headless_product_loop_stop_recovery_replay_result(
    id: Value,
    progress_overview: &TaskListProgressOverview,
    params: HeadlessContinueOnceParams,
    replay: HeadlessProductLoopStopRecoveryReplay,
) -> JsonRpcResponse<Value> {
    let current = match headless_product_loop_stop_recovery_request_fingerprint(&params) {
        Ok(fingerprint) => fingerprint,
        Err(VerificationRecoveryAdmissionError::InvalidParams(message)) => {
            return error_response(id, -32602, &message)
        }
        Err(VerificationRecoveryAdmissionError::Internal(message)) => {
            return error_response(id, -32603, &format!("internal error: {message}"))
        }
    };
    if replay.request_fingerprint != current {
        return error_response(
            id,
            -32602,
            "invalid params: product_loop_stop_recovery_target continuation request identity mismatch",
        );
    }
    let post_progress_fingerprint = if replay.post_progress_fingerprint.is_empty() {
        progress_overview.source_fingerprint.clone()
    } else {
        replay.post_progress_fingerprint.clone()
    };
    let post_aggregate_sequence = if replay.post_aggregate_sequence == 0 {
        progress_overview.aggregate_sequence
    } else {
        replay.post_aggregate_sequence
    };
    let next_route = HeadlessContinueRoute {
        kind: HeadlessContinueRouteKind::RunProductContinuationTaskExplicitly,
        reason:
            "Product-loop stop recovery task was already admitted; replaying bounded admission result."
                .to_string(),
        task_id: Some(replay.selected_task_id.clone()),
        run_id: Some(replay.selected_run_id.clone()),
        proposal_id: None,
        apply_id: None,
        failure_fingerprint: Some(replay.drive_fingerprint.clone()),
        apply_fingerprint: None,
        progress_fingerprint: Some(progress_overview.source_fingerprint.clone()),
        aggregate_sequence: Some(progress_overview.aggregate_sequence),
        next_action: "run_recovery_task_explicitly".to_string(),
    };
    result_response(
        id,
        json!(HeadlessContinueOnceResult {
            status: HeadlessContinueOnceStatus::TaskExecuted,
            decision_id: Some(replay.decision_id),
            continuation_id: Some(replay.continuation_id),
            selected_task_id: Some(replay.selected_task_id),
            selected_run_id: Some(replay.selected_run_id),
            candidate_count: 1,
            expected_progress_fingerprint: params.expected_progress_fingerprint,
            expected_aggregate_sequence: params.expected_aggregate_sequence,
            current_progress_fingerprint: progress_overview.source_fingerprint.clone(),
            current_aggregate_sequence: progress_overview.aggregate_sequence,
            post_progress_fingerprint: Some(post_progress_fingerprint),
            post_aggregate_sequence: Some(post_aggregate_sequence),
            stale: false,
            replayed: true,
            task_run_result: None,
            proposal_apply_result: None,
            objective_proposal_authorization_preflight_result: None,
            objective_apply_verification_result: None,
            objective_completion_acceptance_result: None,
            llm_provider_failure_retry_admission: None,
            product_continuation_admission: None,
            modepack_select_registry_update_result: None,
            modepack_fetch_candidate_result: None,
            modepack_verify_candidate_provenance_result: None,
            modepack_approve_candidate_result: None,
            modepack_replace_active_result: None,
            modepack_rollback_active_result: None,
            next_route: Some(next_route),
            max_steps: None,
            step_count: None,
            executed_count: None,
            replayed_count: None,
            stop_reason: Some(replay.stop_reason),
            steps: Vec::new(),
            next_action: "run_recovery_task_explicitly".to_string(),
        }),
    )
}

pub(super) fn handle_headless_continue_product_continuation_admission(
    id: Value,
    store: &BrownieStore,
    progress_overview: &TaskListProgressOverview,
    params: HeadlessContinueOnceParams,
) -> JsonRpcResponse<Value> {
    let result =
        match headless_continue_product_continuation_admission(store, progress_overview, &params) {
            Ok(result) => result,
            Err(VerificationRecoveryAdmissionError::InvalidParams(message)) => {
                return error_response(id, -32602, &message)
            }
            Err(VerificationRecoveryAdmissionError::Internal(message)) => {
                return error_response(id, -32603, &format!("internal error: {message}"))
            }
        };
    result_response(id, json!(result))
}

pub(super) fn headless_product_continuation_admission_request_fingerprint(
    params: &HeadlessContinueOnceParams,
) -> Result<String, VerificationRecoveryAdmissionError> {
    let target = params
        .product_continuation_admission_target
        .as_ref()
        .ok_or_else(|| {
            VerificationRecoveryAdmissionError::InvalidParams(
                "invalid params: product_continuation_admission_target is required".into(),
            )
        })?;
    let continuation_id = params.continuation_id.as_deref().ok_or_else(|| {
        VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: product_continuation_admission_target requires continuation_id".into(),
        )
    })?;
    let source = &target.product_continuation_source;
    let seed = json!({
        "route_kind": "product_continuation_admission",
        "continuation_id": continuation_id,
        "authorize": params.authorize,
        "expected_progress_fingerprint": params.expected_progress_fingerprint,
        "expected_aggregate_sequence": params.expected_aggregate_sequence,
        "authorize_product_continuation_admission": target.authorize_product_continuation_admission,
        "runtime_derived_objective": target.runtime_derived_objective,
        "continuation_goal": target.continuation_goal,
        "continuation_mode_id": target.continuation_mode_id,
        "source_task_id": source.source_task_id,
        "source_run_id": source.source_run_id,
        "source_decision_id": source.source_decision_id,
        "expected_decision_fingerprint": source.expected_decision_fingerprint,
        "expected_accepted_completion_fingerprint": source.expected_accepted_completion_fingerprint,
        "expected_terminal_completion_fingerprint": source.expected_terminal_completion_fingerprint,
        "expected_completion_closure_fingerprint": source.expected_completion_closure_fingerprint,
        "expected_product_evidence_fingerprint": source.expected_product_evidence_fingerprint,
        "authorize_product_continuation": source.authorize_product_continuation,
    });
    Ok(format!(
        "sha256:{}",
        hex_sha256(seed.to_string().as_bytes())
    ))
}

pub(super) fn validate_product_continuation_admission_target(
    target: &ProductContinuationAdmissionTarget,
) -> Result<(), VerificationRecoveryAdmissionError> {
    if !target.authorize_product_continuation_admission {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: product_continuation_admission_target.authorize_product_continuation_admission must be true".into(),
        ));
    }
    if target.continuation_goal.trim().is_empty() {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: product_continuation_admission_target.continuation_goal must not be empty"
                .into(),
        ));
    }
    if target.continuation_goal.len() > 500 {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: product_continuation_admission_target.continuation_goal is too long"
                .into(),
        ));
    }
    if let Some(mode_id) = target.continuation_mode_id.as_deref() {
        if mode_id.trim().is_empty() || mode_id.len() > 96 {
            return Err(VerificationRecoveryAdmissionError::InvalidParams(
                "invalid params: product_continuation_admission_target.continuation_mode_id must be bounded"
                    .into(),
            ));
        }
    }
    validate_product_continuation_source_shape(&target.product_continuation_source)
}

pub(super) fn headless_continue_product_continuation_admission(
    store: &BrownieStore,
    progress_overview: &TaskListProgressOverview,
    params: &HeadlessContinueOnceParams,
) -> Result<HeadlessContinueOnceResult, VerificationRecoveryAdmissionError> {
    let target = params
        .product_continuation_admission_target
        .as_ref()
        .ok_or_else(|| {
            VerificationRecoveryAdmissionError::InvalidParams(
                "invalid params: product_continuation_admission_target is required".into(),
            )
        })?;
    validate_product_continuation_admission_target(target)?;
    let continuation_id = params.continuation_id.clone().ok_or_else(|| {
        VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: product_continuation_admission_target requires continuation_id".into(),
        )
    })?;
    let request_fingerprint = headless_product_continuation_admission_request_fingerprint(params)?;
    let policy = resolve_task_start_policy(target.continuation_mode_id.as_deref(), store)
        .map_err(VerificationRecoveryAdmissionError::InvalidParams)?;
    let provenance =
        product_continuation_provenance_for_source(store, &target.product_continuation_source)?;
    let expected_runtime_goal = if target.runtime_derived_objective {
        Some(runtime_derived_product_objective_goal(&provenance)?)
    } else {
        None
    };
    if let Some(expected_runtime_goal) = expected_runtime_goal.as_ref() {
        if target.continuation_goal != *expected_runtime_goal {
            return Err(VerificationRecoveryAdmissionError::InvalidParams(
                "invalid params: product_continuation_admission_target.runtime_derived_objective goal does not match runtime derivation"
                    .into(),
            ));
        }
    }
    let objective_continuation_provenance = if target.runtime_derived_objective {
        Some(product_objective_continuation_provenance_for(
            &provenance,
            &target.continuation_goal,
        )?)
    } else {
        None
    };
    let decision_fingerprint = provenance.decision_fingerprint.clone();
    let product_evidence_fingerprint = provenance.product_evidence_fingerprint.clone();
    let selected_remaining_gap_fingerprint = provenance
        .selected_remaining_gap
        .as_ref()
        .map(|gap| gap.selection_fingerprint.clone());
    let admission = store
        .tasks()
        .start_product_continuation_task(ProductContinuationTaskStartParams {
            goal: target.continuation_goal.clone(),
            mode_id: Some(policy.mode_id.clone()),
            provenance,
            objective_continuation_provenance,
        })
        .map_err(|error| VerificationRecoveryAdmissionError::Internal(error.to_string()))?;
    if !admission.replayed {
        append_mode_resolved_event(store, &admission.record, &policy)
            .map_err(|error| VerificationRecoveryAdmissionError::Internal(error.to_string()))?;
    }

    let result_admission = ProductContinuationAdmission {
        source_task_id: target.product_continuation_source.source_task_id.clone(),
        source_run_id: target.product_continuation_source.source_run_id.clone(),
        source_decision_id: target
            .product_continuation_source
            .source_decision_id
            .clone(),
        continuation_task_id: admission.record.task_id.clone(),
        continuation_run_id: admission.record.run_id.clone(),
        decision_fingerprint,
        product_evidence_fingerprint,
        continuation_running_enabled: false,
        next_action: "run_product_continuation_task_explicitly".to_string(),
        replayed: admission.replayed,
    };
    let decision_id = format!("headless_decision_{}", uuid::Uuid::new_v4().simple());
    store
        .tasks()
        .append_task_event_with_payload(
            &admission.record,
            LedgerEventKind::HeadlessContinuationDecisionRecorded,
            Some(json!({
                "decision_id": decision_id,
                "continuation_id": continuation_id,
                "route_kind": "product_continuation_admission",
                "request_fingerprint": request_fingerprint,
                "selected_task_id": result_admission.continuation_task_id.clone(),
                "selected_run_id": result_admission.continuation_run_id.clone(),
                "source_task_id": result_admission.source_task_id.clone(),
                "source_run_id": result_admission.source_run_id.clone(),
                "source_decision_id": result_admission.source_decision_id.clone(),
                "decision_fingerprint": result_admission.decision_fingerprint.clone(),
                "product_evidence_fingerprint": result_admission.product_evidence_fingerprint.clone(),
                "selected_remaining_gap_fingerprint": selected_remaining_gap_fingerprint,
                "continuation_running_enabled": false,
                "expected_progress_fingerprint": params.expected_progress_fingerprint,
                "expected_aggregate_sequence": params.expected_aggregate_sequence,
                "candidate_count": 1,
                "policy_version": "headless_continue_once_v1",
                "authorize": true,
                "next_action": "run_product_continuation_task_explicitly",
                "reason": "Headless continue-once admitted one product-continuation task from runtime product completion evidence."
            })),
        )
        .map_err(|error| VerificationRecoveryAdmissionError::Internal(error.to_string()))?;

    let post_tasks = store
        .tasks()
        .list_tasks()
        .map_err(|error| VerificationRecoveryAdmissionError::Internal(error.to_string()))?;
    let post_progress = task_list_progress_overview(store, &post_tasks)
        .map_err(VerificationRecoveryAdmissionError::Internal)?;
    let next_route = HeadlessContinueRoute {
        kind: HeadlessContinueRouteKind::RunProductContinuationTaskExplicitly,
        reason: "Product-continuation task was admitted; running it remains an explicit next step."
            .to_string(),
        task_id: Some(result_admission.continuation_task_id.clone()),
        run_id: Some(result_admission.continuation_run_id.clone()),
        proposal_id: None,
        apply_id: None,
        failure_fingerprint: None,
        apply_fingerprint: None,
        progress_fingerprint: Some(post_progress.source_fingerprint.clone()),
        aggregate_sequence: Some(post_progress.aggregate_sequence),
        next_action: "run_product_continuation_task_explicitly".to_string(),
    };
    Ok(HeadlessContinueOnceResult {
        status: HeadlessContinueOnceStatus::TaskExecuted,
        decision_id: Some(decision_id),
        continuation_id: Some(continuation_id),
        selected_task_id: Some(result_admission.continuation_task_id.clone()),
        selected_run_id: Some(result_admission.continuation_run_id.clone()),
        candidate_count: 1,
        expected_progress_fingerprint: params.expected_progress_fingerprint.clone(),
        expected_aggregate_sequence: params.expected_aggregate_sequence,
        current_progress_fingerprint: progress_overview.source_fingerprint.clone(),
        current_aggregate_sequence: progress_overview.aggregate_sequence,
        post_progress_fingerprint: Some(post_progress.source_fingerprint),
        post_aggregate_sequence: Some(post_progress.aggregate_sequence),
        stale: false,
        replayed: admission.replayed,
        task_run_result: None,
        proposal_apply_result: None,
        objective_proposal_authorization_preflight_result: None,
        objective_apply_verification_result: None,
        objective_completion_acceptance_result: None,
        llm_provider_failure_retry_admission: None,
        product_continuation_admission: Some(result_admission),
        modepack_select_registry_update_result: None,
        modepack_fetch_candidate_result: None,
        modepack_verify_candidate_provenance_result: None,
        modepack_approve_candidate_result: None,
        modepack_replace_active_result: None,
        modepack_rollback_active_result: None,
        next_route: Some(next_route),
        max_steps: None,
        step_count: None,
        executed_count: None,
        replayed_count: None,
        stop_reason: None,
        steps: Vec::new(),
        next_action: "run_product_continuation_task_explicitly".to_string(),
    })
}

pub(super) fn headless_product_continuation_admission_decision_for_replay(
    store: &BrownieStore,
    tasks: &[TaskRecord],
    continuation_id: &str,
) -> Result<Option<HeadlessProductContinuationAdmissionReplay>, String> {
    for task in tasks {
        let events = store
            .tasks()
            .read_ledger_events(&task.run_id)
            .map_err(|error| error.to_string())?;
        for payload in events
            .iter()
            .filter(|event| event.kind == LedgerEventKind::HeadlessContinuationDecisionRecorded)
            .filter_map(|event| event.payload.as_ref())
        {
            if payload.get("route_kind").and_then(Value::as_str)
                != Some("product_continuation_admission")
                || payload.get("continuation_id").and_then(Value::as_str) != Some(continuation_id)
            {
                continue;
            }
            let decision_id = payload
                .get("decision_id")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    "product continuation admission replay missing decision_id".to_string()
                })?
                .to_string();
            let request_fingerprint = payload
                .get("request_fingerprint")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    "product continuation admission replay missing request_fingerprint".to_string()
                })?
                .to_string();
            let post_progress_fingerprint = payload
                .get("post_progress_fingerprint")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let post_aggregate_sequence = payload
                .get("post_aggregate_sequence")
                .and_then(Value::as_u64)
                .unwrap_or_default();
            let admission = ProductContinuationAdmission {
                source_task_id: payload_string(payload, "source_task_id")?,
                source_run_id: payload_string(payload, "source_run_id")?,
                source_decision_id: payload_string(payload, "source_decision_id")?,
                continuation_task_id: payload_string(payload, "selected_task_id")?,
                continuation_run_id: payload_string(payload, "selected_run_id")?,
                decision_fingerprint: payload_string(payload, "decision_fingerprint")?,
                product_evidence_fingerprint: payload_string(
                    payload,
                    "product_evidence_fingerprint",
                )?,
                continuation_running_enabled: false,
                next_action: "run_product_continuation_task_explicitly".to_string(),
                replayed: true,
            };
            return Ok(Some(HeadlessProductContinuationAdmissionReplay {
                decision_id,
                continuation_id: continuation_id.to_string(),
                request_fingerprint,
                admission,
                post_progress_fingerprint,
                post_aggregate_sequence,
            }));
        }
    }
    Ok(None)
}

pub(super) fn payload_string(payload: &Value, field: &str) -> Result<String, String> {
    payload
        .get(field)
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .ok_or_else(|| format!("product continuation admission replay missing {field}"))
}

pub(super) fn headless_continue_product_continuation_admission_replay_result(
    id: Value,
    progress_overview: &TaskListProgressOverview,
    params: HeadlessContinueOnceParams,
    replay: HeadlessProductContinuationAdmissionReplay,
) -> JsonRpcResponse<Value> {
    let current = match headless_product_continuation_admission_request_fingerprint(&params) {
        Ok(fingerprint) => fingerprint,
        Err(VerificationRecoveryAdmissionError::InvalidParams(message)) => {
            return error_response(id, -32602, &message)
        }
        Err(VerificationRecoveryAdmissionError::Internal(message)) => {
            return error_response(id, -32603, &format!("internal error: {message}"))
        }
    };
    if replay.request_fingerprint != current {
        return error_response(
            id,
            -32602,
            "invalid params: product_continuation_admission_target continuation request identity mismatch",
        );
    }
    let post_progress_fingerprint = if replay.post_progress_fingerprint.is_empty() {
        progress_overview.source_fingerprint.clone()
    } else {
        replay.post_progress_fingerprint.clone()
    };
    let post_aggregate_sequence = if replay.post_aggregate_sequence == 0 {
        progress_overview.aggregate_sequence
    } else {
        replay.post_aggregate_sequence
    };
    let next_route = HeadlessContinueRoute {
        kind: HeadlessContinueRouteKind::RunProductContinuationTaskExplicitly,
        reason: "Product-continuation task was already admitted by this continuation; replaying bounded admission result.".to_string(),
        task_id: Some(replay.admission.continuation_task_id.clone()),
        run_id: Some(replay.admission.continuation_run_id.clone()),
        proposal_id: None,
        apply_id: None,
        failure_fingerprint: None,
        apply_fingerprint: None,
        progress_fingerprint: Some(progress_overview.source_fingerprint.clone()),
        aggregate_sequence: Some(progress_overview.aggregate_sequence),
        next_action: "run_product_continuation_task_explicitly".to_string(),
    };
    result_response(
        id,
        json!(HeadlessContinueOnceResult {
            status: HeadlessContinueOnceStatus::TaskExecuted,
            decision_id: Some(replay.decision_id),
            continuation_id: Some(replay.continuation_id),
            selected_task_id: Some(replay.admission.continuation_task_id.clone()),
            selected_run_id: Some(replay.admission.continuation_run_id.clone()),
            candidate_count: 1,
            expected_progress_fingerprint: params.expected_progress_fingerprint,
            expected_aggregate_sequence: params.expected_aggregate_sequence,
            current_progress_fingerprint: progress_overview.source_fingerprint.clone(),
            current_aggregate_sequence: progress_overview.aggregate_sequence,
            post_progress_fingerprint: Some(post_progress_fingerprint),
            post_aggregate_sequence: Some(post_aggregate_sequence),
            stale: false,
            replayed: true,
            task_run_result: None,
            proposal_apply_result: None,
            objective_proposal_authorization_preflight_result: None,
            objective_apply_verification_result: None,
            objective_completion_acceptance_result: None,
            llm_provider_failure_retry_admission: None,
            product_continuation_admission: Some(replay.admission),
            modepack_select_registry_update_result: None,
            modepack_fetch_candidate_result: None,
            modepack_verify_candidate_provenance_result: None,
            modepack_approve_candidate_result: None,
            modepack_replace_active_result: None,
            modepack_rollback_active_result: None,
            next_route: Some(next_route),
            max_steps: None,
            step_count: None,
            executed_count: None,
            replayed_count: None,
            stop_reason: None,
            steps: Vec::new(),
            next_action: "run_product_continuation_task_explicitly".to_string(),
        }),
    )
}

pub(super) fn headless_product_continuation_run_request_fingerprint(
    params: &HeadlessContinueOnceParams,
) -> Result<String, String> {
    let target = params
        .product_continuation_run_target
        .as_ref()
        .ok_or_else(|| "invalid params: product_continuation_run_target is required".to_string())?;
    let continuation_id = params.continuation_id.as_deref().ok_or_else(|| {
        "invalid params: product_continuation_run_target requires continuation_id".to_string()
    })?;
    let seed = json!({
        "route_kind": "product_continuation_run",
        "continuation_id": continuation_id,
        "authorize": params.authorize,
        "expected_progress_fingerprint": params.expected_progress_fingerprint,
        "expected_aggregate_sequence": params.expected_aggregate_sequence,
        "authorize_product_continuation_run": target.authorize_product_continuation_run,
        "continuation_task_id": target.continuation_task_id,
        "continuation_run_id": target.continuation_run_id,
        "source_task_id": target.source_task_id,
        "source_run_id": target.source_run_id,
        "source_decision_id": target.source_decision_id,
        "expected_decision_fingerprint": target.expected_decision_fingerprint,
        "expected_product_evidence_fingerprint": target.expected_product_evidence_fingerprint,
        "expected_admission_route_kind": target.expected_admission_route_kind,
        "expected_admission_request_fingerprint": target.expected_admission_request_fingerprint,
    });
    Ok(format!(
        "sha256:{}",
        hex_sha256(seed.to_string().as_bytes())
    ))
}

pub(super) fn headless_product_continuation_run_decision_for_replay(
    store: &BrownieStore,
    tasks: &[TaskRecord],
    continuation_id: &str,
) -> Result<Option<(HeadlessContinuationDecisionLookup, String)>, String> {
    for task in tasks {
        let events = store
            .tasks()
            .read_ledger_events(&task.run_id)
            .map_err(|error| error.to_string())?;
        for payload in events
            .iter()
            .filter(|event| event.kind == LedgerEventKind::HeadlessContinuationDecisionRecorded)
            .filter_map(|event| event.payload.as_ref())
        {
            if payload.get("route_kind").and_then(Value::as_str) != Some("product_continuation_run")
                || payload.get("continuation_id").and_then(Value::as_str) != Some(continuation_id)
            {
                continue;
            }
            let decision =
                headless_continuation_decision_from_payload(payload).ok_or_else(|| {
                    format!(
                        "invalid product continuation run decision evidence for {continuation_id}"
                    )
                })?;
            let request_fingerprint = payload_string(payload, "request_fingerprint")?;
            return Ok(Some((decision, request_fingerprint)));
        }
    }
    Ok(None)
}

pub(super) fn headless_continue_product_continuation_run_replay_result(
    id: Value,
    store: &BrownieStore,
    progress_overview: &TaskListProgressOverview,
    params: HeadlessContinueOnceParams,
    decision: HeadlessContinuationDecisionLookup,
    request_fingerprint: String,
) -> JsonRpcResponse<Value> {
    let current = match headless_product_continuation_run_request_fingerprint(&params) {
        Ok(fingerprint) => fingerprint,
        Err(message) => return error_response(id, -32602, &message),
    };
    if request_fingerprint != current {
        return error_response(
            id,
            -32602,
            "invalid params: product_continuation_run_target continuation request identity mismatch",
        );
    }
    let selected_record = match store.tasks().get_task(&decision.selected_task_id) {
        Ok(Some(record)) if record.run_id == decision.selected_run_id => record,
        Ok(Some(_)) => {
            return error_response(
                id,
                -32603,
                "internal error: product continuation run task/run mismatch",
            );
        }
        Ok(None) => {
            return error_response(
                id,
                -32603,
                "internal error: product continuation run task not found",
            );
        }
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    let task_run_result = match task_run_result_for_headless_replay(store, &selected_record) {
        Ok(result) => result,
        Err(message) => return error_response(id, -32603, &format!("internal error: {message}")),
    };
    let post_tasks = match store.tasks().list_tasks() {
        Ok(tasks) => tasks,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    let post_progress_overview = match task_list_progress_overview(store, &post_tasks) {
        Ok(progress_overview) => progress_overview,
        Err(message) => return error_response(id, -32603, &format!("internal error: {message}")),
    };
    let next_route = headless_continue_next_route(
        &selected_record,
        task_run_result.as_ref(),
        &post_progress_overview,
    );
    let next_action = next_route.next_action.clone();
    let status = if task_run_result.is_some() {
        HeadlessContinueOnceStatus::TaskExecuted
    } else {
        HeadlessContinueOnceStatus::TaskInProgress
    };
    result_response(
        id,
        json!(HeadlessContinueOnceResult {
            status,
            decision_id: Some(decision.decision_id),
            continuation_id: Some(decision.continuation_id),
            selected_task_id: Some(selected_record.task_id),
            selected_run_id: Some(selected_record.run_id),
            candidate_count: decision.candidate_count,
            expected_progress_fingerprint: params.expected_progress_fingerprint,
            expected_aggregate_sequence: params.expected_aggregate_sequence,
            current_progress_fingerprint: progress_overview.source_fingerprint.clone(),
            current_aggregate_sequence: progress_overview.aggregate_sequence,
            post_progress_fingerprint: Some(post_progress_overview.source_fingerprint),
            post_aggregate_sequence: Some(post_progress_overview.aggregate_sequence),
            stale: false,
            replayed: true,
            task_run_result,
            proposal_apply_result: None,
            objective_proposal_authorization_preflight_result: None,
            objective_apply_verification_result: None,
            objective_completion_acceptance_result: None,
            llm_provider_failure_retry_admission: None,
            product_continuation_admission: None,
            modepack_select_registry_update_result: None,
            modepack_fetch_candidate_result: None,
            modepack_verify_candidate_provenance_result: None,
            modepack_approve_candidate_result: None,
            modepack_replace_active_result: None,
            modepack_rollback_active_result: None,
            next_route: Some(next_route),
            max_steps: None,
            step_count: None,
            executed_count: None,
            replayed_count: None,
            stop_reason: None,
            steps: Vec::new(),
            next_action,
        }),
    )
}

pub(super) fn handle_headless_continue_product_continuation_run(
    id: Value,
    store: &BrownieStore,
    progress_overview: &TaskListProgressOverview,
    params: HeadlessContinueOnceParams,
) -> JsonRpcResponse<Value> {
    let Some(target) = params.product_continuation_run_target.as_ref() else {
        return error_response(
            id,
            -32603,
            "internal error: missing product continuation run target",
        );
    };
    let request_fingerprint = match headless_product_continuation_run_request_fingerprint(&params) {
        Ok(fingerprint) => fingerprint,
        Err(message) => return error_response(id, -32602, &message),
    };
    let selected_record = match product_continuation_record_for_headless_run_target(store, target) {
        Ok(record) => record,
        Err(rejection) => {
            return match rejection {
                TaskRunAdmissionRejection::InvalidParams(message) => {
                    error_response(id, -32602, message)
                }
                TaskRunAdmissionRejection::Internal(message) => {
                    error_response(id, -32603, &format!("internal error: {message}"))
                }
            }
        }
    };
    if let Err(message) = validate_product_continuation_admission_evidence(store, target) {
        return error_response(id, -32602, &message);
    }
    let decision_id = format!("headless_decision_{}", uuid::Uuid::new_v4().simple());
    let policy_version = "headless_continue_once_v1";
    let task_run_response = handle_task_run(
        id.clone(),
        Some(json!({
            "task_id": selected_record.task_id.clone(),
        })),
    );
    let Some(task_run_value) = task_run_response.result else {
        return JsonRpcResponse {
            jsonrpc: JSONRPC_VERSION.to_string(),
            id,
            result: None,
            error: task_run_response.error,
        };
    };
    let task_run_result: TaskRunResult = match serde_json::from_value(task_run_value) {
        Ok(result) => result,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    let post_run_record = match store.tasks().get_task(&selected_record.task_id) {
        Ok(Some(record)) if record.run_id == selected_record.run_id => record,
        Ok(Some(_)) => {
            return error_response(
                id,
                -32603,
                "internal error: product continuation run task/run mismatch after execution",
            );
        }
        Ok(None) => {
            return error_response(
                id,
                -32603,
                "internal error: product continuation run task not found after execution",
            );
        }
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    if let Err(error) = store.tasks().append_task_event_with_payload(
        &post_run_record,
        LedgerEventKind::HeadlessContinuationDecisionRecorded,
        Some(json!({
            "decision_id": decision_id.clone(),
            "continuation_id": params.continuation_id.clone(),
            "route_kind": "product_continuation_run",
            "request_fingerprint": request_fingerprint,
            "selected_task_id": post_run_record.task_id.clone(),
            "selected_run_id": post_run_record.run_id.clone(),
            "expected_progress_fingerprint": params.expected_progress_fingerprint.clone(),
            "expected_aggregate_sequence": params.expected_aggregate_sequence,
            "candidate_count": 1,
            "policy_version": policy_version,
            "authorize": true,
            "authorize_product_continuation_run": true,
            "source_task_id": target.source_task_id.clone(),
            "source_run_id": target.source_run_id.clone(),
            "source_decision_id": target.source_decision_id.clone(),
            "decision_fingerprint": target.expected_decision_fingerprint.clone(),
            "product_evidence_fingerprint": target.expected_product_evidence_fingerprint.clone(),
            "admission_route_kind": "run_product_continuation_task_explicitly",
            "next_action": "inspect_progress_overview",
            "reason": "Headless continue-once explicitly ran one admitted product-continuation task through existing task.run authority."
        })),
    ) {
        return error_response(id, -32603, &format!("internal error: {error}"));
    }
    if let Some(continuation_id) = params.continuation_id.as_ref() {
        if let Err(error) = store.tasks().write_headless_continuation_decision(
            &HeadlessContinuationDecisionLookup {
                decision_id: decision_id.clone(),
                continuation_id: continuation_id.clone(),
                selected_task_id: post_run_record.task_id.clone(),
                selected_run_id: post_run_record.run_id.clone(),
                expected_progress_fingerprint: params.expected_progress_fingerprint.clone(),
                expected_aggregate_sequence: params.expected_aggregate_sequence,
                candidate_count: 1,
                policy_version: policy_version.to_string(),
            },
        ) {
            return error_response(id, -32603, &format!("internal error: {error}"));
        }
    }

    let post_tasks = match store.tasks().list_tasks() {
        Ok(tasks) => tasks,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    let post_progress_overview = match task_list_progress_overview(store, &post_tasks) {
        Ok(progress_overview) => progress_overview,
        Err(message) => return error_response(id, -32603, &format!("internal error: {message}")),
    };
    let next_route = headless_continue_next_route(
        &post_run_record,
        Some(&task_run_result),
        &post_progress_overview,
    );
    let next_action = next_route.next_action.clone();
    result_response(
        id,
        json!(HeadlessContinueOnceResult {
            status: HeadlessContinueOnceStatus::TaskExecuted,
            decision_id: Some(decision_id),
            continuation_id: params.continuation_id,
            selected_task_id: Some(task_run_result.task_id.clone()),
            selected_run_id: Some(task_run_result.run_id.clone()),
            candidate_count: 1,
            expected_progress_fingerprint: params.expected_progress_fingerprint,
            expected_aggregate_sequence: params.expected_aggregate_sequence,
            current_progress_fingerprint: progress_overview.source_fingerprint.clone(),
            current_aggregate_sequence: progress_overview.aggregate_sequence,
            post_progress_fingerprint: Some(post_progress_overview.source_fingerprint),
            post_aggregate_sequence: Some(post_progress_overview.aggregate_sequence),
            stale: false,
            replayed: false,
            task_run_result: Some(task_run_result),
            proposal_apply_result: None,
            objective_proposal_authorization_preflight_result: None,
            objective_apply_verification_result: None,
            objective_completion_acceptance_result: None,
            llm_provider_failure_retry_admission: None,
            product_continuation_admission: None,
            modepack_select_registry_update_result: None,
            modepack_fetch_candidate_result: None,
            modepack_verify_candidate_provenance_result: None,
            modepack_approve_candidate_result: None,
            modepack_replace_active_result: None,
            modepack_rollback_active_result: None,
            next_route: Some(next_route),
            max_steps: None,
            step_count: None,
            executed_count: None,
            replayed_count: None,
            stop_reason: None,
            steps: Vec::new(),
            next_action,
        }),
    )
}

pub(super) fn validate_headless_run_product_continuation_replay_target(
    store: &BrownieStore,
    checkpoint: &HeadlessRunSessionCheckpoint,
    admission_target: Option<&ProductContinuationAdmissionTarget>,
    run_target: Option<&ProductContinuationRunTarget>,
) -> Result<(), String> {
    if admission_target.is_none() && run_target.is_none() {
        return Ok(());
    }
    if admission_target.is_some() && run_target.is_some() {
        return Err(
            "invalid params: only one explicit product-continuation replay target may be supplied"
                .to_string(),
        );
    }
    let continuation_id = checkpoint
        .result
        .steps
        .iter()
        .find_map(|step| step.continuation_id.as_deref());
    let Some(continuation_id) = continuation_id else {
        return Err(
            "invalid params: product-continuation replay checkpoint is missing continuation_id"
                .to_string(),
        );
    };
    let tasks = store
        .tasks()
        .list_tasks()
        .map_err(|error| error.to_string())?;
    let mut replay_params = headless_run_replay_continue_once_params(checkpoint, continuation_id);
    if let Some(target) = admission_target.cloned() {
        replay_params.product_continuation_admission_target = Some(target);
        let Some(replay) = headless_product_continuation_admission_decision_for_replay(
            store,
            &tasks,
            continuation_id,
        )?
        else {
            return Err(
                "invalid params: product-continuation admission replay evidence is missing"
                    .to_string(),
            );
        };
        let current = headless_product_continuation_admission_request_fingerprint(&replay_params)
            .map_err(|error| match error {
            VerificationRecoveryAdmissionError::InvalidParams(message) => message,
            VerificationRecoveryAdmissionError::Internal(message) => message,
        })?;
        if replay.request_fingerprint != current {
            return Err(
                "invalid params: product_continuation_admission_target continuation request identity mismatch"
                    .to_string(),
            );
        }
    }
    if let Some(target) = run_target.cloned() {
        replay_params.product_continuation_run_target = Some(target);
        let Some((_decision, request_fingerprint)) =
            headless_product_continuation_run_decision_for_replay(store, &tasks, continuation_id)?
        else {
            return Err(
                "invalid params: product-continuation run replay evidence is missing".to_string(),
            );
        };
        let current = headless_product_continuation_run_request_fingerprint(&replay_params)?;
        if request_fingerprint != current {
            return Err(
                "invalid params: product_continuation_run_target continuation request identity mismatch"
                    .to_string(),
            );
        }
    }
    Ok(())
}

pub(super) fn validate_headless_run_product_continuation_derived_replay_target(
    store: &BrownieStore,
    checkpoint: &HeadlessRunSessionCheckpoint,
    target: Option<&ProductContinuationDerivedTarget>,
) -> Result<(), String> {
    let Some(target) = target else {
        return Ok(());
    };
    validate_product_continuation_derived_target(target)?;
    let continuation_id = checkpoint
        .result
        .steps
        .iter()
        .find_map(|step| step.continuation_id.as_deref())
        .ok_or_else(|| {
            "invalid params: product-continuation derived replay checkpoint is missing continuation_id"
                .to_string()
        })?;
    let tasks = store
        .tasks()
        .list_tasks()
        .map_err(|error| error.to_string())?;
    if let Some(replay) =
        headless_product_continuation_admission_decision_for_replay(store, &tasks, continuation_id)?
    {
        let source_route = HeadlessContinueRoute {
            kind: HeadlessContinueRouteKind::AdmitProductContinuationTaskExplicitly,
            reason: "Replay-derived product continuation admission source.".to_string(),
            task_id: Some(replay.admission.source_task_id),
            run_id: Some(replay.admission.source_run_id),
            proposal_id: None,
            apply_id: None,
            failure_fingerprint: None,
            apply_fingerprint: None,
            progress_fingerprint: None,
            aggregate_sequence: None,
            next_action: "admit_product_continuation_task_explicitly".to_string(),
        };
        let source = product_continuation_source_from_route(store, &source_route)?;
        let provenance = product_continuation_provenance_for_source(store, &source).map_err(
            |error| match error {
                VerificationRecoveryAdmissionError::InvalidParams(message) => message,
                VerificationRecoveryAdmissionError::Internal(message) => message,
            },
        )?;
        let (continuation_goal, runtime_derived_objective) =
            if let Some(goal) = target.continuation_goal.clone() {
                (goal, false)
            } else {
                (
                    runtime_derived_product_objective_goal(&provenance).map_err(
                        |error| match error {
                            VerificationRecoveryAdmissionError::InvalidParams(message) => message,
                            VerificationRecoveryAdmissionError::Internal(message) => message,
                        },
                    )?,
                    true,
                )
            };
        let mut replay_params =
            headless_run_replay_continue_once_params(checkpoint, continuation_id);
        replay_params.product_continuation_admission_target =
            Some(ProductContinuationAdmissionTarget {
                authorize_product_continuation_admission: true,
                product_continuation_source: source,
                continuation_goal,
                continuation_mode_id: target.continuation_mode_id.clone(),
                runtime_derived_objective,
            });
        let current = headless_product_continuation_admission_request_fingerprint(&replay_params)
            .map_err(|error| match error {
            VerificationRecoveryAdmissionError::InvalidParams(message) => message,
            VerificationRecoveryAdmissionError::Internal(message) => message,
        })?;
        if replay.request_fingerprint != current {
            return Err(
                "invalid params: product_continuation_derived_target continuation request identity mismatch"
                    .to_string(),
            );
        }
        return Ok(());
    }
    if let Some((decision, request_fingerprint)) =
        headless_product_continuation_run_decision_for_replay(store, &tasks, continuation_id)?
    {
        let record = store
            .tasks()
            .get_task(&decision.selected_task_id)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| {
                "invalid params: product-continuation derived run replay task is missing"
                    .to_string()
            })?;
        let provenance = record
            .product_continuation_provenance
            .as_ref()
            .ok_or_else(|| {
                "invalid params: product-continuation derived run replay provenance is missing"
                    .to_string()
            })?;
        let mut replay_params =
            headless_run_replay_continue_once_params(checkpoint, continuation_id);
        replay_params.product_continuation_run_target = Some(ProductContinuationRunTarget {
            authorize_product_continuation_run: true,
            continuation_task_id: record.task_id,
            continuation_run_id: record.run_id,
            source_task_id: provenance.source_task_id.clone(),
            source_run_id: provenance.source_run_id.clone(),
            source_decision_id: provenance.source_decision_id.clone(),
            expected_decision_fingerprint: provenance.decision_fingerprint.clone(),
            expected_product_evidence_fingerprint: provenance.product_evidence_fingerprint.clone(),
            expected_admission_route_kind:
                HeadlessContinueRouteKind::RunProductContinuationTaskExplicitly,
            expected_admission_request_fingerprint: None,
        });
        let current = headless_product_continuation_run_request_fingerprint(&replay_params)?;
        if request_fingerprint != current {
            return Err(
                "invalid params: product_continuation_derived_target continuation request identity mismatch"
                    .to_string(),
            );
        }
        return Ok(());
    }
    Err("invalid params: product-continuation derived replay evidence is missing".to_string())
}

pub(super) fn validate_product_objective_continuation_journey_source_shape(
    source: &ProductObjectiveContinuationJourneySource,
) -> Result<(), String> {
    for (field, value) in [
        ("continuation_task_id", source.continuation_task_id.as_str()),
        ("continuation_run_id", source.continuation_run_id.as_str()),
        ("source_task_id", source.source_task_id.as_str()),
        ("source_run_id", source.source_run_id.as_str()),
        ("source_decision_id", source.source_decision_id.as_str()),
    ] {
        if !is_valid_headless_run_id(value) {
            return Err(format!(
                "invalid params: product_objective_continuation_source.{field} must be a bounded id"
            ));
        }
    }
    if !source.authorize_product_objective_journey_admission {
        return Err("invalid params: product_objective_continuation_source.authorize_product_objective_journey_admission must be true".to_string());
    }
    for (field, value) in [
        (
            "expected_decision_fingerprint",
            source.expected_decision_fingerprint.as_str(),
        ),
        (
            "expected_accepted_completion_fingerprint",
            source.expected_accepted_completion_fingerprint.as_str(),
        ),
        (
            "expected_terminal_completion_fingerprint",
            source.expected_terminal_completion_fingerprint.as_str(),
        ),
        (
            "expected_completion_closure_fingerprint",
            source.expected_completion_closure_fingerprint.as_str(),
        ),
        (
            "expected_product_evidence_fingerprint",
            source.expected_product_evidence_fingerprint.as_str(),
        ),
        (
            "expected_remaining_capability_fingerprint",
            source.expected_remaining_capability_fingerprint.as_str(),
        ),
        (
            "expected_derived_objective_fingerprint",
            source.expected_derived_objective_fingerprint.as_str(),
        ),
        (
            "expected_derived_goal_fingerprint",
            source.expected_derived_goal_fingerprint.as_str(),
        ),
    ] {
        if !is_sha256_fingerprint(value) {
            return Err(format!(
                "invalid params: product_objective_continuation_source.{field} must be a sha256 fingerprint"
            ));
        }
    }
    if let Some(value) = source
        .expected_selected_remaining_gap_fingerprint
        .as_deref()
    {
        if !is_sha256_fingerprint(value) {
            return Err(
                "invalid params: product_objective_continuation_source.expected_selected_remaining_gap_fingerprint must be a sha256 fingerprint"
                    .to_string(),
            );
        }
    }
    Ok(())
}

pub(super) fn product_objective_continuation_for_journey_source(
    store: &BrownieStore,
    source: &ProductObjectiveContinuationJourneySource,
    require_created: bool,
) -> Result<(TaskRecord, ProductObjectiveContinuationProvenance), VerificationRecoveryAdmissionError>
{
    validate_product_objective_continuation_journey_source_shape(source)
        .map_err(VerificationRecoveryAdmissionError::InvalidParams)?;
    let record = store
        .tasks()
        .get_task(&source.continuation_task_id)
        .map_err(|error| VerificationRecoveryAdmissionError::Internal(error.to_string()))?
        .ok_or_else(|| {
            VerificationRecoveryAdmissionError::InvalidParams(
                "invalid params: product_objective_continuation_source.continuation_task_id was not found"
                    .into(),
            )
        })?;
    if record.run_id != source.continuation_run_id {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: product_objective_continuation_source.continuation_run_id does not match continuation task"
                .into(),
        ));
    }
    if require_created && record.status != TaskStatus::Created {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: product objective continuation journey source task must be Created"
                .into(),
        ));
    }
    let Some(provenance) = record.product_objective_continuation_provenance.clone() else {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: product objective continuation journey source has no objective provenance"
                .into(),
        ));
    };
    for (field, actual, expected) in [
        (
            "source_task_id",
            provenance.source_task_id.as_str(),
            source.source_task_id.as_str(),
        ),
        (
            "source_run_id",
            provenance.source_run_id.as_str(),
            source.source_run_id.as_str(),
        ),
        (
            "source_decision_id",
            provenance.source_decision_id.as_str(),
            source.source_decision_id.as_str(),
        ),
        (
            "expected_decision_fingerprint",
            provenance.decision_fingerprint.as_str(),
            source.expected_decision_fingerprint.as_str(),
        ),
        (
            "expected_accepted_completion_fingerprint",
            provenance.accepted_completion_fingerprint.as_str(),
            source.expected_accepted_completion_fingerprint.as_str(),
        ),
        (
            "expected_terminal_completion_fingerprint",
            provenance.terminal_completion_fingerprint.as_str(),
            source.expected_terminal_completion_fingerprint.as_str(),
        ),
        (
            "expected_completion_closure_fingerprint",
            provenance.completion_closure_fingerprint.as_str(),
            source.expected_completion_closure_fingerprint.as_str(),
        ),
        (
            "expected_product_evidence_fingerprint",
            provenance.product_evidence_fingerprint.as_str(),
            source.expected_product_evidence_fingerprint.as_str(),
        ),
        (
            "expected_remaining_capability_fingerprint",
            provenance.remaining_capability_fingerprint.as_str(),
            source.expected_remaining_capability_fingerprint.as_str(),
        ),
        (
            "expected_derived_objective_fingerprint",
            provenance.derived_objective_fingerprint.as_str(),
            source.expected_derived_objective_fingerprint.as_str(),
        ),
        (
            "expected_derived_goal_fingerprint",
            provenance.derived_goal_fingerprint.as_str(),
            source.expected_derived_goal_fingerprint.as_str(),
        ),
    ] {
        if actual != expected {
            return Err(VerificationRecoveryAdmissionError::InvalidParams(format!(
                "invalid params: product_objective_continuation_source.{field} is stale"
            )));
        }
    }
    match (
        provenance.selected_remaining_gap.as_ref(),
        source
            .expected_selected_remaining_gap_fingerprint
            .as_deref(),
    ) {
        (Some(gap), Some(expected)) if gap.selection_fingerprint == expected => {}
        (Some(_), Some(_)) => {
            return Err(VerificationRecoveryAdmissionError::InvalidParams(
                "invalid params: product_objective_continuation_source.expected_selected_remaining_gap_fingerprint is stale"
                    .into(),
            ));
        }
        (Some(_), None) => {
            return Err(VerificationRecoveryAdmissionError::InvalidParams(
                "invalid params: product_objective_continuation_source.expected_selected_remaining_gap_fingerprint is required"
                    .into(),
            ));
        }
        (None, Some(_)) => {
            return Err(VerificationRecoveryAdmissionError::InvalidParams(
                "invalid params: product_objective_continuation_source.expected_selected_remaining_gap_fingerprint has no source gap"
                    .into(),
            ));
        }
        (None, None) => {}
    }
    let latest_product_source = ProductContinuationSource {
        source_task_id: provenance.source_task_id.clone(),
        source_run_id: provenance.source_run_id.clone(),
        source_decision_id: provenance.source_decision_id.clone(),
        expected_decision_fingerprint: provenance.decision_fingerprint.clone(),
        expected_accepted_completion_fingerprint: provenance
            .accepted_completion_fingerprint
            .clone(),
        expected_terminal_completion_fingerprint: provenance
            .terminal_completion_fingerprint
            .clone(),
        expected_completion_closure_fingerprint: provenance.completion_closure_fingerprint.clone(),
        expected_product_evidence_fingerprint: provenance.product_evidence_fingerprint.clone(),
        authorize_product_continuation: true,
    };
    let latest_product_provenance =
        product_continuation_provenance_for_source(store, &latest_product_source)?;
    let expected_goal = runtime_derived_product_objective_goal(&latest_product_provenance)?;
    if record.goal != expected_goal {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: product objective continuation journey source goal is stale".into(),
        ));
    }
    let latest_objective_provenance =
        product_objective_continuation_provenance_for(&latest_product_provenance, &record.goal)?;
    if latest_objective_provenance != provenance {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: product objective continuation journey source provenance is stale"
                .into(),
        ));
    }
    Ok((record, provenance))
}

pub(super) fn product_continuation_provenance_for_source(
    store: &BrownieStore,
    source: &ProductContinuationSource,
) -> Result<ProductContinuationProvenance, VerificationRecoveryAdmissionError> {
    validate_product_continuation_source_shape(source)?;

    let source_task = store
        .tasks()
        .get_task(&source.source_task_id)
        .map_err(|error| VerificationRecoveryAdmissionError::Internal(error.to_string()))?
        .ok_or_else(|| {
            VerificationRecoveryAdmissionError::InvalidParams(
                "invalid params: product_continuation_source.source_task_id was not found".into(),
            )
        })?;

    if source_task.run_id != source.source_run_id {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: product_continuation_source.source_run_id does not match source task"
                .into(),
        ));
    }
    if source_task.status != TaskStatus::Completed {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: product continuation source task must be terminal Completed".into(),
        ));
    }

    let events = store
        .tasks()
        .read_ledger_events(&source.source_run_id)
        .map_err(|error| VerificationRecoveryAdmissionError::Internal(error.to_string()))?;
    let latest_payload = latest_product_completion_decision_payload(
        &events,
        &source.source_task_id,
        &source.source_run_id,
    )
    .ok_or_else(|| {
        VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: product_continuation_source has no product completion decision".into(),
        )
    })?;

    let source_decision_id = product_continuation_payload_string(latest_payload, "decision_id")?;
    if source_decision_id != source.source_decision_id {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: product_continuation_source.source_decision_id is not current".into(),
        ));
    }
    let status = product_continuation_payload_string(latest_payload, "status")?;
    match status.as_str() {
        "continue_development" => {}
        "product_complete" => {
            return Err(VerificationRecoveryAdmissionError::InvalidParams(
                "invalid params: product continuation source decision is product_complete".into(),
            ))
        }
        "blocked_by_product_evidence" => {
            return Err(VerificationRecoveryAdmissionError::InvalidParams(
                "invalid params: product continuation source decision is blocked_by_product_evidence"
                    .into(),
            ))
        }
        _ => {
            return Err(VerificationRecoveryAdmissionError::InvalidParams(
                "invalid params: product continuation source decision status is not continue_development"
                    .into(),
            ))
        }
    }

    let next_action = product_continuation_payload_string(latest_payload, "next_action")?;
    if next_action != "plan_next_phase" {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: product continuation source decision next_action is not plan_next_phase"
                .into(),
        ));
    }

    let decision_fingerprint =
        product_continuation_payload_sha256(latest_payload, "decision_fingerprint")?;
    let accepted_completion_fingerprint =
        product_continuation_payload_sha256(latest_payload, "accepted_completion_fingerprint")?;
    let terminal_completion_fingerprint =
        product_continuation_payload_sha256(latest_payload, "terminal_completion_fingerprint")?;
    let completion_closure_fingerprint =
        product_continuation_payload_sha256(latest_payload, "completion_closure_fingerprint")?;
    let product_evidence_fingerprint =
        product_continuation_payload_sha256(latest_payload, "product_evidence_fingerprint")?;

    for (field, actual, expected) in [
        (
            "expected_decision_fingerprint",
            decision_fingerprint.as_str(),
            source.expected_decision_fingerprint.as_str(),
        ),
        (
            "expected_accepted_completion_fingerprint",
            accepted_completion_fingerprint.as_str(),
            source.expected_accepted_completion_fingerprint.as_str(),
        ),
        (
            "expected_terminal_completion_fingerprint",
            terminal_completion_fingerprint.as_str(),
            source.expected_terminal_completion_fingerprint.as_str(),
        ),
        (
            "expected_completion_closure_fingerprint",
            completion_closure_fingerprint.as_str(),
            source.expected_completion_closure_fingerprint.as_str(),
        ),
        (
            "expected_product_evidence_fingerprint",
            product_evidence_fingerprint.as_str(),
            source.expected_product_evidence_fingerprint.as_str(),
        ),
    ] {
        if actual != expected {
            return Err(VerificationRecoveryAdmissionError::InvalidParams(format!(
                "invalid params: product_continuation_source.{field} is stale"
            )));
        }
    }

    let target_capability =
        product_continuation_payload_string(latest_payload, "target_capability")?;
    let concrete_capability_transition =
        product_continuation_payload_string(latest_payload, "concrete_capability_transition")?;
    let remaining_capability =
        product_continuation_payload_optional_string(latest_payload, "remaining_capability")?;
    let selected_remaining_gap =
        product_continuation_payload_selected_remaining_gap(latest_payload)?;
    if let Some(gap) = selected_remaining_gap.as_ref() {
        if remaining_capability.as_deref() != Some(gap.capability.as_str()) {
            return Err(VerificationRecoveryAdmissionError::InvalidParams(
                "invalid params: product continuation selected_remaining_gap conflicts with remaining_capability"
                    .into(),
            ));
        }
        if gap.status != "open" || !gap.required {
            return Err(VerificationRecoveryAdmissionError::InvalidParams(
                "invalid params: product continuation selected_remaining_gap is not an open required gap"
                    .into(),
            ));
        }
    }
    let technical_debt_carry_forward =
        product_continuation_payload_technical_debt_carry_forward(latest_payload)?;
    if !is_bounded_product_completion_text(&target_capability, 96)
        || !is_bounded_product_completion_text(&concrete_capability_transition, 120)
    {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: product continuation decision metadata is not bounded".into(),
        ));
    }

    Ok(ProductContinuationProvenance {
        source_task_id: source_task.task_id,
        source_run_id: source_task.run_id,
        source_decision_id,
        decision_fingerprint,
        accepted_completion_fingerprint,
        terminal_completion_fingerprint,
        completion_closure_fingerprint,
        product_evidence_fingerprint,
        target_capability,
        concrete_capability_transition,
        decision_status: status,
        decision_next_action: next_action,
        remaining_capability,
        selected_remaining_gap,
        technical_debt_carry_forward,
    })
}

pub(super) fn validate_product_continuation_source_shape(
    source: &ProductContinuationSource,
) -> Result<(), VerificationRecoveryAdmissionError> {
    for (field, value) in [
        ("source_task_id", source.source_task_id.as_str()),
        ("source_run_id", source.source_run_id.as_str()),
        ("source_decision_id", source.source_decision_id.as_str()),
    ] {
        if !is_valid_headless_run_id(value) {
            return Err(VerificationRecoveryAdmissionError::InvalidParams(format!(
                "invalid params: product_continuation_source.{field} must be a bounded id"
            )));
        }
    }
    if !source.authorize_product_continuation {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: product_continuation_source.authorize_product_continuation must be true"
                .into(),
        ));
    }
    for (field, value) in [
        (
            "expected_decision_fingerprint",
            source.expected_decision_fingerprint.as_str(),
        ),
        (
            "expected_accepted_completion_fingerprint",
            source.expected_accepted_completion_fingerprint.as_str(),
        ),
        (
            "expected_terminal_completion_fingerprint",
            source.expected_terminal_completion_fingerprint.as_str(),
        ),
        (
            "expected_completion_closure_fingerprint",
            source.expected_completion_closure_fingerprint.as_str(),
        ),
        (
            "expected_product_evidence_fingerprint",
            source.expected_product_evidence_fingerprint.as_str(),
        ),
    ] {
        if !is_sha256_fingerprint(value) {
            return Err(VerificationRecoveryAdmissionError::InvalidParams(format!(
                "invalid params: product_continuation_source.{field} must be a sha256 fingerprint"
            )));
        }
    }
    Ok(())
}

pub(super) fn validate_product_continuation_derived_target(
    target: &ProductContinuationDerivedTarget,
) -> Result<(), String> {
    if !target.authorize_product_continuation_target_derivation {
        return Err(
            "invalid params: product_continuation_derived_target.authorize_product_continuation_target_derivation must be true"
                .to_string(),
        );
    }
    if let Some(goal) = target.continuation_goal.as_deref() {
        if goal.trim().is_empty() || goal.len() > 500 {
            return Err(
                "invalid params: product_continuation_derived_target.continuation_goal must be bounded and non-empty"
                    .to_string(),
            );
        }
    }
    if let Some(mode_id) = target.continuation_mode_id.as_deref() {
        if mode_id.trim().is_empty() || mode_id.len() > 96 {
            return Err(
                "invalid params: product_continuation_derived_target.continuation_mode_id must be bounded"
                    .to_string(),
            );
        }
    }
    Ok(())
}

pub(super) fn product_continuation_remaining_capability(
    provenance: &ProductContinuationProvenance,
) -> Result<&str, VerificationRecoveryAdmissionError> {
    let remaining_capability = provenance
        .remaining_capability
        .as_deref()
        .unwrap_or("")
        .trim();
    if !is_bounded_product_completion_text(remaining_capability, 120) {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: product continuation remaining_capability is required for runtime-derived objective"
                .into(),
        ));
    }
    Ok(remaining_capability)
}

pub(super) fn runtime_derived_product_objective_goal(
    provenance: &ProductContinuationProvenance,
) -> Result<String, VerificationRecoveryAdmissionError> {
    let remaining_capability = product_continuation_remaining_capability(provenance)?;
    Ok(format!(
        "Continue development for remaining capability: {remaining_capability}"
    ))
}

pub(super) fn product_objective_continuation_fingerprint_seed(
    provenance: &ProductContinuationProvenance,
    goal: &str,
) -> Result<Value, VerificationRecoveryAdmissionError> {
    let remaining_capability = product_continuation_remaining_capability(provenance)?;
    let remaining_capability_fingerprint =
        format!("sha256:{}", hex_sha256(remaining_capability.as_bytes()));
    Ok(json!({
        "version": "product_objective_continuation_v1",
        "source_task_id": provenance.source_task_id,
        "source_run_id": provenance.source_run_id,
        "source_decision_id": provenance.source_decision_id,
        "decision_fingerprint": provenance.decision_fingerprint,
        "accepted_completion_fingerprint": provenance.accepted_completion_fingerprint,
        "terminal_completion_fingerprint": provenance.terminal_completion_fingerprint,
        "completion_closure_fingerprint": provenance.completion_closure_fingerprint,
        "product_evidence_fingerprint": provenance.product_evidence_fingerprint,
        "target_capability": provenance.target_capability,
        "concrete_capability_transition": provenance.concrete_capability_transition,
        "remaining_capability": remaining_capability,
        "remaining_capability_fingerprint": remaining_capability_fingerprint,
        "selected_remaining_gap": provenance.selected_remaining_gap,
        "selected_remaining_gap_fingerprint": provenance
            .selected_remaining_gap
            .as_ref()
            .map(|gap| gap.selection_fingerprint.as_str()),
        "technical_debt_carry_forward_fingerprint": provenance
            .technical_debt_carry_forward
            .as_ref()
            .map(|carry_forward| carry_forward.fingerprint.as_str()),
        "derived_goal_sha256": format!("sha256:{}", hex_sha256(goal.as_bytes())),
    }))
}

pub(super) fn product_objective_continuation_provenance_for(
    provenance: &ProductContinuationProvenance,
    goal: &str,
) -> Result<ProductObjectiveContinuationProvenance, VerificationRecoveryAdmissionError> {
    let remaining_capability = product_continuation_remaining_capability(provenance)?;
    let remaining_capability_fingerprint =
        format!("sha256:{}", hex_sha256(remaining_capability.as_bytes()));
    let seed = product_objective_continuation_fingerprint_seed(provenance, goal)?;
    Ok(ProductObjectiveContinuationProvenance {
        source_task_id: provenance.source_task_id.clone(),
        source_run_id: provenance.source_run_id.clone(),
        source_decision_id: provenance.source_decision_id.clone(),
        decision_fingerprint: provenance.decision_fingerprint.clone(),
        accepted_completion_fingerprint: provenance.accepted_completion_fingerprint.clone(),
        terminal_completion_fingerprint: provenance.terminal_completion_fingerprint.clone(),
        completion_closure_fingerprint: provenance.completion_closure_fingerprint.clone(),
        product_evidence_fingerprint: provenance.product_evidence_fingerprint.clone(),
        target_capability: provenance.target_capability.clone(),
        concrete_capability_transition: provenance.concrete_capability_transition.clone(),
        remaining_capability: remaining_capability.to_string(),
        remaining_capability_fingerprint,
        selected_remaining_gap: provenance.selected_remaining_gap.clone(),
        technical_debt_carry_forward_fingerprint: provenance
            .technical_debt_carry_forward
            .as_ref()
            .map(|carry_forward| carry_forward.fingerprint.clone()),
        derived_objective_fingerprint: format!(
            "sha256:{}",
            hex_sha256(seed.to_string().as_bytes())
        ),
        derived_goal_fingerprint: format!("sha256:{}", hex_sha256(goal.as_bytes())),
        derivation_version: "product_objective_continuation_v1".to_string(),
    })
}

pub(super) fn product_continuation_source_from_route(
    store: &BrownieStore,
    route: &HeadlessContinueRoute,
) -> Result<ProductContinuationSource, String> {
    let source_task_id = route.task_id.clone().ok_or_else(|| {
        "invalid params: product_continuation_derived_target route missing source task_id"
            .to_string()
    })?;
    let source_run_id = route.run_id.clone().ok_or_else(|| {
        "invalid params: product_continuation_derived_target route missing source run_id"
            .to_string()
    })?;
    let events = store
        .tasks()
        .read_ledger_events(&source_run_id)
        .map_err(|error| error.to_string())?;
    let payload = latest_product_completion_decision_payload(
        &events,
        &source_task_id,
        &source_run_id,
    )
    .ok_or_else(|| {
        "invalid params: product_continuation_derived_target source decision evidence is missing"
            .to_string()
    })?;
    let source = ProductContinuationSource {
        source_task_id,
        source_run_id,
        source_decision_id: product_continuation_payload_string(payload, "decision_id")
            .map_err(|error| error.to_string())?,
        expected_decision_fingerprint: product_continuation_payload_sha256(
            payload,
            "decision_fingerprint",
        )
        .map_err(|error| error.to_string())?,
        expected_accepted_completion_fingerprint: product_continuation_payload_sha256(
            payload,
            "accepted_completion_fingerprint",
        )
        .map_err(|error| error.to_string())?,
        expected_terminal_completion_fingerprint: product_continuation_payload_sha256(
            payload,
            "terminal_completion_fingerprint",
        )
        .map_err(|error| error.to_string())?,
        expected_completion_closure_fingerprint: product_continuation_payload_sha256(
            payload,
            "completion_closure_fingerprint",
        )
        .map_err(|error| error.to_string())?,
        expected_product_evidence_fingerprint: product_continuation_payload_sha256(
            payload,
            "product_evidence_fingerprint",
        )
        .map_err(|error| error.to_string())?,
        authorize_product_continuation: true,
    };
    product_continuation_provenance_for_source(store, &source).map_err(|error| match error {
        VerificationRecoveryAdmissionError::InvalidParams(message) => message,
        VerificationRecoveryAdmissionError::Internal(message) => message,
    })?;
    Ok(source)
}

pub(super) fn product_continuation_derived_targets_from_checkpoint(
    store: &BrownieStore,
    checkpoint: &HeadlessRunSessionCheckpoint,
    target: &ProductContinuationDerivedTarget,
) -> Result<
    (
        Option<ProductContinuationAdmissionTarget>,
        Option<ProductContinuationRunTarget>,
    ),
    String,
> {
    validate_product_continuation_derived_target(target)?;
    let route = checkpoint.result.next_route.as_ref().ok_or_else(|| {
        "invalid params: product_continuation_derived_target requires a persisted product-continuation route"
            .to_string()
    })?;
    match route.kind {
        HeadlessContinueRouteKind::AdmitProductContinuationTaskExplicitly => {
            let source = product_continuation_source_from_route(store, route)?;
            let provenance =
                product_continuation_provenance_for_source(store, &source).map_err(|error| {
                    match error {
                        VerificationRecoveryAdmissionError::InvalidParams(message) => message,
                        VerificationRecoveryAdmissionError::Internal(message) => message,
                    }
                })?;
            let (continuation_goal, runtime_derived_objective) =
                if let Some(goal) = target.continuation_goal.clone() {
                    (goal, false)
                } else {
                    (
                        runtime_derived_product_objective_goal(&provenance).map_err(
                            |error| match error {
                                VerificationRecoveryAdmissionError::InvalidParams(message) => {
                                    message
                                }
                                VerificationRecoveryAdmissionError::Internal(message) => message,
                            },
                        )?,
                        true,
                    )
                };
            let admission = ProductContinuationAdmissionTarget {
                authorize_product_continuation_admission: true,
                product_continuation_source: source,
                continuation_goal,
                continuation_mode_id: target.continuation_mode_id.clone(),
                runtime_derived_objective,
            };
            validate_product_continuation_admission_target(&admission)
                .map_err(|error| error.to_string())?;
            Ok((Some(admission), None))
        }
        HeadlessContinueRouteKind::RunProductContinuationTaskExplicitly => {
            let continuation_task_id = route.task_id.clone().ok_or_else(|| {
                "invalid params: product_continuation_derived_target route missing continuation task_id"
                    .to_string()
            })?;
            let continuation_run_id = route.run_id.clone().ok_or_else(|| {
                "invalid params: product_continuation_derived_target route missing continuation run_id"
                    .to_string()
            })?;
            let record = store
                .tasks()
                .get_task(&continuation_task_id)
                .map_err(|error| error.to_string())?
                .ok_or_else(|| {
                    "invalid params: product_continuation_derived_target continuation task was not found"
                        .to_string()
                })?;
            if record.run_id != continuation_run_id {
                return Err(
                    "invalid params: product_continuation_derived_target route task/run mismatch"
                        .to_string(),
                );
            }
            let provenance = record.product_continuation_provenance.as_ref().ok_or_else(|| {
                "invalid params: product_continuation_derived_target continuation provenance is missing"
                    .to_string()
            })?;
            let run = ProductContinuationRunTarget {
                authorize_product_continuation_run: true,
                continuation_task_id,
                continuation_run_id,
                source_task_id: provenance.source_task_id.clone(),
                source_run_id: provenance.source_run_id.clone(),
                source_decision_id: provenance.source_decision_id.clone(),
                expected_decision_fingerprint: provenance.decision_fingerprint.clone(),
                expected_product_evidence_fingerprint: provenance.product_evidence_fingerprint.clone(),
                expected_admission_route_kind:
                    HeadlessContinueRouteKind::RunProductContinuationTaskExplicitly,
                expected_admission_request_fingerprint: None,
            };
            product_continuation_record_for_headless_run_target(store, &run)
                .map_err(task_run_admission_rejection_message)?;
            validate_product_continuation_admission_evidence(store, &run)?;
            Ok((None, Some(run)))
        }
        _ => Err(
            "invalid params: product_continuation_derived_target requires persisted route admit_product_continuation_task_explicitly or run_product_continuation_task_explicitly"
                .to_string(),
        ),
    }
}

pub(super) fn product_continuation_payload_string(
    payload: &Value,
    field: &str,
) -> Result<String, VerificationRecoveryAdmissionError> {
    payload
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| is_bounded_product_completion_text(value, 120))
        .map(ToString::to_string)
        .ok_or_else(|| {
            VerificationRecoveryAdmissionError::InvalidParams(format!(
                "invalid params: product continuation decision {field} is missing or malformed"
            ))
        })
}

pub(super) fn product_continuation_payload_optional_string(
    payload: &Value,
    field: &str,
) -> Result<Option<String>, VerificationRecoveryAdmissionError> {
    match payload.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) if is_bounded_product_completion_text(value, 120) => {
            Ok(Some(value.clone()))
        }
        _ => Err(VerificationRecoveryAdmissionError::InvalidParams(format!(
            "invalid params: product continuation decision {field} is malformed"
        ))),
    }
}

pub(super) fn product_continuation_payload_selected_remaining_gap(
    payload: &Value,
) -> Result<Option<HeadlessRunProductRemainingGapSelection>, VerificationRecoveryAdmissionError> {
    let Some(value) = payload.get("selected_remaining_gap") else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    let gap: HeadlessRunProductRemainingGapSelection = serde_json::from_value(value.clone())
        .map_err(|_| {
            VerificationRecoveryAdmissionError::InvalidParams(
                "invalid params: product continuation decision selected_remaining_gap is malformed"
                    .into(),
            )
        })?;
    if !is_valid_headless_run_id(&gap.gap_id)
        || !is_bounded_product_completion_text(&gap.capability, 120)
        || !is_bounded_product_completion_text(&gap.transition, 120)
        || !matches!(gap.status.as_str(), "open" | "deferred" | "closed")
        || !is_bounded_product_completion_text(&gap.responsibility_domain, 48)
        || !matches!(
            gap.responsibility_domain.as_str(),
            "runtime" | "external_control_plane" | "external_adapter" | "commercial_solution"
        )
        || (gap.required && gap.responsibility_domain != "runtime")
        || !is_bounded_product_completion_text(&gap.next_action, 120)
        || !is_sha256_fingerprint(&gap.selection_fingerprint)
    {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: product continuation decision selected_remaining_gap is malformed"
                .into(),
        ));
    }
    let expected = headless_product_remaining_gap_selection_fingerprint(&gap);
    if gap.selection_fingerprint != expected {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: product continuation decision selected_remaining_gap fingerprint is stale"
                .into(),
        ));
    }
    Ok(Some(gap))
}

pub(super) fn product_continuation_payload_technical_debt_carry_forward(
    payload: &Value,
) -> Result<Option<TechnicalDebtCarryForward>, VerificationRecoveryAdmissionError> {
    let Some(value) = payload.get("technical_debt_carry_forward") else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    let carry_forward: TechnicalDebtCarryForward =
        serde_json::from_value(value.clone()).map_err(|_| {
            VerificationRecoveryAdmissionError::InvalidParams(
                "invalid params: product continuation decision technical_debt_carry_forward is malformed"
                    .into(),
            )
        })?;
    let expected = technical_debt_carry_forward_from_items(&carry_forward.items).map_err(|_| {
        VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: product continuation decision technical_debt_carry_forward is malformed"
                .into(),
        )
    })?;
    let legacy_v1_fingerprint =
        technical_debt_carry_forward_v1_fingerprint(&carry_forward.items).map_err(|_| {
            VerificationRecoveryAdmissionError::InvalidParams(
                "invalid params: product continuation decision technical_debt_carry_forward is malformed"
                    .into(),
            )
        })?;
    let legacy_runtime_only = carry_forward
        .items
        .iter()
        .all(|item| item.responsibility_domain == "runtime");
    let fingerprint_matches = carry_forward.fingerprint == expected.fingerprint
        || (legacy_runtime_only && carry_forward.fingerprint == legacy_v1_fingerprint);
    if !fingerprint_matches || carry_forward.items != expected.items {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: product continuation decision technical_debt_carry_forward fingerprint is stale"
                .into(),
        ));
    }
    Ok(Some(carry_forward))
}

pub(super) fn product_continuation_payload_sha256(
    payload: &Value,
    field: &str,
) -> Result<String, VerificationRecoveryAdmissionError> {
    payload
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| is_sha256_fingerprint(value))
        .map(ToString::to_string)
        .ok_or_else(|| {
            VerificationRecoveryAdmissionError::InvalidParams(format!(
                "invalid params: product continuation decision {field} is missing or malformed"
            ))
        })
}

pub(super) fn product_continuation_record_for_headless_run_target(
    store: &BrownieStore,
    target: &ProductContinuationRunTarget,
) -> Result<TaskRecord, TaskRunAdmissionRejection> {
    for value in [
        target.continuation_task_id.as_str(),
        target.continuation_run_id.as_str(),
        target.source_task_id.as_str(),
        target.source_run_id.as_str(),
        target.source_decision_id.as_str(),
    ] {
        if value.trim().is_empty() || value.len() > 128 {
            return Err(TaskRunAdmissionRejection::InvalidParams(
                "invalid params: product_continuation_run_target fields must be bounded and non-empty",
            ));
        }
    }
    if !target.authorize_product_continuation_run {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: product_continuation_run_target.authorize_product_continuation_run must be true",
        ));
    }
    if target.expected_admission_route_kind
        != HeadlessContinueRouteKind::RunProductContinuationTaskExplicitly
    {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: product_continuation_run_target.expected_admission_route_kind must be run_product_continuation_task_explicitly",
        ));
    }
    for value in [
        (target.expected_decision_fingerprint.as_str()),
        (target.expected_product_evidence_fingerprint.as_str()),
    ] {
        if !is_sha256_fingerprint(value) {
            return Err(TaskRunAdmissionRejection::InvalidParams(
                "invalid params: product_continuation_run_target fingerprint fields must be sha256 fingerprints",
            ));
        }
    }
    if let Some(fingerprint) = target.expected_admission_request_fingerprint.as_deref() {
        if !is_sha256_fingerprint(fingerprint) {
            return Err(TaskRunAdmissionRejection::InvalidParams(
                "invalid params: product_continuation_run_target.expected_admission_request_fingerprint must be a sha256 fingerprint",
            ));
        }
    }

    let record = store
        .tasks()
        .get_task(&target.continuation_task_id)
        .map_err(|error| TaskRunAdmissionRejection::Internal(error.to_string()))?
        .ok_or(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: product_continuation_run_target.continuation_task_id was not found",
        ))?;
    if record.run_id != target.continuation_run_id {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: product_continuation_run_target.continuation_run_id does not match continuation task",
        ));
    }
    if record.status != TaskStatus::Created {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: product continuation run target task must be Created before execution",
        ));
    }
    let Some(provenance) = record.product_continuation_provenance.as_ref() else {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: product continuation run target task has no product-continuation provenance",
        ));
    };
    if provenance.source_task_id != target.source_task_id {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: product_continuation_run_target.source_task_id is stale",
        ));
    }
    if provenance.source_run_id != target.source_run_id {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: product_continuation_run_target.source_run_id is stale",
        ));
    }
    if provenance.source_decision_id != target.source_decision_id {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: product_continuation_run_target.source_decision_id is stale",
        ));
    }
    if provenance.decision_fingerprint != target.expected_decision_fingerprint {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: product_continuation_run_target.expected_decision_fingerprint is stale",
        ));
    }
    if provenance.product_evidence_fingerprint != target.expected_product_evidence_fingerprint {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: product_continuation_run_target.expected_product_evidence_fingerprint is stale",
        ));
    }
    revalidate_product_continuation_task_for_run(store, &record)?;
    Ok(record)
}

pub(super) fn validate_product_continuation_admission_evidence(
    store: &BrownieStore,
    target: &ProductContinuationRunTarget,
) -> Result<(), String> {
    let events = store
        .tasks()
        .read_ledger_events(&target.continuation_run_id)
        .map_err(|error| error.to_string())?;
    let Some(payload) = events.iter().rev().find_map(|event| {
        if event.kind != LedgerEventKind::HeadlessContinuationDecisionRecorded {
            return None;
        }
        let payload = event.payload.as_ref()?;
        if payload.get("route_kind").and_then(Value::as_str)
            == Some("product_continuation_admission")
            && payload.get("selected_task_id").and_then(Value::as_str)
                == Some(target.continuation_task_id.as_str())
            && payload.get("selected_run_id").and_then(Value::as_str)
                == Some(target.continuation_run_id.as_str())
        {
            Some(payload)
        } else {
            None
        }
    }) else {
        return Err(
            "invalid params: product_continuation_run_target missing admission evidence"
                .to_string(),
        );
    };
    for (field, expected) in [
        ("source_task_id", target.source_task_id.as_str()),
        ("source_run_id", target.source_run_id.as_str()),
        ("source_decision_id", target.source_decision_id.as_str()),
        (
            "decision_fingerprint",
            target.expected_decision_fingerprint.as_str(),
        ),
        (
            "product_evidence_fingerprint",
            target.expected_product_evidence_fingerprint.as_str(),
        ),
    ] {
        if payload.get(field).and_then(Value::as_str) != Some(expected) {
            return Err(format!(
                "invalid params: product_continuation_run_target admission {field} is stale"
            ));
        }
    }
    if payload.get("next_action").and_then(Value::as_str)
        != Some("run_product_continuation_task_explicitly")
    {
        return Err(
            "invalid params: product_continuation_run_target admission route is stale".to_string(),
        );
    }
    if let Some(expected) = target.expected_admission_request_fingerprint.as_deref() {
        if payload.get("request_fingerprint").and_then(Value::as_str) != Some(expected) {
            return Err(
                "invalid params: product_continuation_run_target admission request fingerprint is stale"
                    .to_string(),
            );
        }
    }
    Ok(())
}

pub(super) fn revalidate_product_continuation_task_for_run(
    store: &BrownieStore,
    record: &TaskRecord,
) -> Result<bool, TaskRunAdmissionRejection> {
    let Some(provenance) = record.product_continuation_provenance.as_ref() else {
        return Ok(false);
    };
    if record.status != TaskStatus::Created {
        return Ok(true);
    }
    let source = ProductContinuationSource {
        source_task_id: provenance.source_task_id.clone(),
        source_run_id: provenance.source_run_id.clone(),
        source_decision_id: provenance.source_decision_id.clone(),
        expected_decision_fingerprint: provenance.decision_fingerprint.clone(),
        expected_accepted_completion_fingerprint: provenance
            .accepted_completion_fingerprint
            .clone(),
        expected_terminal_completion_fingerprint: provenance
            .terminal_completion_fingerprint
            .clone(),
        expected_completion_closure_fingerprint: provenance.completion_closure_fingerprint.clone(),
        expected_product_evidence_fingerprint: provenance.product_evidence_fingerprint.clone(),
        authorize_product_continuation: true,
    };
    let latest =
        product_continuation_provenance_for_source(store, &source).map_err(
            |error| match error {
                VerificationRecoveryAdmissionError::InvalidParams(_) => {
                    TaskRunAdmissionRejection::InvalidParams(
                        "invalid params: product continuation provenance is stale",
                    )
                }
                VerificationRecoveryAdmissionError::Internal(message) => {
                    TaskRunAdmissionRejection::Internal(message)
                }
            },
        )?;
    if latest != *provenance {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: product continuation provenance is stale",
        ));
    }
    Ok(true)
}

pub(super) fn revalidate_product_loop_stop_recovery_task_for_run(
    store: &BrownieStore,
    record: &TaskRecord,
) -> Result<bool, TaskRunAdmissionRejection> {
    let Some(provenance) = record.product_loop_stop_recovery_provenance.as_ref() else {
        return Ok(false);
    };
    if record.status != TaskStatus::Created {
        return Ok(true);
    }
    let checkpoint = store
        .tasks()
        .read_headless_run_session_drive_checkpoint(
            &provenance.source_session_id,
            &provenance.source_drive_id,
        )
        .map_err(|error| TaskRunAdmissionRejection::Internal(error.to_string()))?
        .ok_or(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: product loop stop recovery provenance is stale",
        ))?;
    let result = &checkpoint.result;
    let stop_class = classify_product_loop_stop_recovery_result(result);
    if stop_class != ProductLoopStopRecoveryClass::RecoverableFault {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: product loop stop recovery provenance is no longer recoverable",
        ));
    }
    let latest = ProductLoopStopRecoveryProvenance {
        source_session_id: result.session_id.clone(),
        source_drive_id: result.drive_id.clone(),
        drive_fingerprint: result.drive_fingerprint.clone(),
        stop_reason: result.stop_reason.clone(),
        stop_class: stop_class.as_str().to_string(),
        source_progress_fingerprint: product_loop_stop_recovery_source_progress_fingerprint(result),
        end_session_sequence: result.end_session_sequence,
        next_route_fingerprint: product_loop_stop_recovery_next_route_fingerprint(result),
        recovery_boundary_fingerprint: product_loop_stop_recovery_boundary_fingerprint(result),
    };
    if latest != *provenance {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: product loop stop recovery provenance is stale",
        ));
    }
    Ok(true)
}
