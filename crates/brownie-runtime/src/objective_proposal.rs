use super::*;

pub(super) fn objective_proposal_candidate_route(
    candidate: &HeadlessRunObjectiveProposalCandidate,
    progress_overview: &TaskListProgressOverview,
) -> HeadlessContinueRoute {
    HeadlessContinueRoute {
        kind: HeadlessContinueRouteKind::ReviewAndAuthorizeObjectiveProposal,
        reason:
            "Objective-context journey produced one bounded proposal candidate; review and authorize it explicitly."
                .to_string(),
        task_id: Some(candidate.task_id.clone()),
        run_id: Some(candidate.run_id.clone()),
        proposal_id: candidate.proposal_id.clone(),
        apply_id: None,
        failure_fingerprint: None,
        apply_fingerprint: None,
        progress_fingerprint: Some(progress_overview.source_fingerprint.clone()),
        aggregate_sequence: Some(progress_overview.aggregate_sequence),
        next_action: "review_and_authorize_objective_proposal".to_string(),
    }
}

fn objective_proposal_candidate_fingerprint(
    candidate: &HeadlessRunObjectiveProposalCandidate,
) -> String {
    let seed = json!({
        "version": "headless_objective_proposal_candidate_v1",
        "status": candidate.status,
        "journey_id": candidate.journey_id,
        "task_id": candidate.task_id,
        "run_id": candidate.run_id,
        "session_id": candidate.session_id,
        "drive_id": candidate.drive_id,
        "objective_context_fingerprint": candidate.objective_context_fingerprint,
        "selected_context_fingerprint": candidate.selected_context_fingerprint,
        "candidate_count": candidate.candidate_count,
        "proposal_id": candidate.proposal_id,
        "source_event_id": candidate.source_event_id,
        "source_event_kind": candidate.source_event_kind,
        "operation": candidate.operation,
        "path_fingerprint": candidate.path_fingerprint,
        "validation_status": candidate.validation_status,
        "approval_status": candidate.approval_status,
        "denial_reason": candidate.denial_reason,
        "next_action": candidate.next_action,
    });
    format!("sha256:{}", hex_sha256(seed.to_string().as_bytes()))
}

fn finalize_objective_proposal_candidate(
    mut candidate: HeadlessRunObjectiveProposalCandidate,
) -> HeadlessRunObjectiveProposalCandidate {
    candidate.candidate_fingerprint = objective_proposal_candidate_fingerprint(&candidate);
    candidate
}

fn denied_objective_proposal_candidate(
    checkpoint: &HeadlessJourneyStartCheckpoint,
    session_id: &str,
    drive_id: &str,
    status: &str,
    candidate_count: usize,
    denial_reason: &str,
    replayed: bool,
) -> HeadlessRunObjectiveProposalCandidate {
    let objective_context = checkpoint
        .objective_context
        .as_ref()
        .expect("objective context candidate requires objective context");
    finalize_objective_proposal_candidate(HeadlessRunObjectiveProposalCandidate {
        status: status.to_string(),
        journey_id: checkpoint.journey_id.clone(),
        task_id: checkpoint.task_id.clone(),
        run_id: checkpoint.run_id.clone(),
        session_id: session_id.to_string(),
        drive_id: drive_id.to_string(),
        objective_context_fingerprint: objective_context.objective_context_fingerprint.clone(),
        selected_context_fingerprint: objective_context.selected_context_fingerprint.clone(),
        candidate_count: candidate_count.min(16),
        proposal_id: None,
        source_event_id: None,
        source_event_kind: None,
        operation: None,
        path_fingerprint: None,
        validation_status: None,
        approval_status: None,
        denial_reason: Some(denial_reason.to_string()),
        candidate_fingerprint: String::new(),
        replayed,
        next_action: "inspect_progress_overview".to_string(),
    })
}

pub(super) fn headless_objective_proposal_candidate_outcome(
    store: &BrownieStore,
    checkpoint: &HeadlessJourneyStartCheckpoint,
    session_id: &str,
    drive_id: &str,
    replayed: bool,
) -> Result<Option<HeadlessRunObjectiveProposalCandidate>, String> {
    let Some(objective_context) = checkpoint.objective_context.as_ref() else {
        return Ok(None);
    };
    let events = read_existing_run_events(store, &checkpoint.run_id)?;
    let mut candidates: Vec<(LedgerEvent, Value)> = Vec::new();
    for event in events
        .iter()
        .filter(|event| event.kind == LedgerEventKind::WorkspacePatchProposed)
    {
        let Some(payload) = sanitize_ledger_payload(event.payload.clone()) else {
            return Ok(Some(denied_objective_proposal_candidate(
                checkpoint,
                session_id,
                drive_id,
                "blocked_malformed_candidate_evidence",
                candidates.len(),
                "workspace proposal evidence is malformed",
                replayed,
            )));
        };
        if payload
            .get("verification_recovery_repair")
            .and_then(Value::as_bool)
            .unwrap_or(false)
            || payload
                .get("patch_apply_recovery_repair")
                .and_then(Value::as_bool)
                .unwrap_or(false)
        {
            continue;
        }
        let Some(proposal_id) = payload.get("proposal_id").and_then(Value::as_str) else {
            return Ok(Some(denied_objective_proposal_candidate(
                checkpoint,
                session_id,
                drive_id,
                "blocked_malformed_candidate_evidence",
                candidates.len(),
                "workspace proposal evidence is missing proposal_id",
                replayed,
            )));
        };
        if proposal_id.trim().is_empty()
            || payload.get("path").and_then(Value::as_str).is_none()
            || payload.get("operation").and_then(Value::as_str).is_none()
            || payload
                .get("validation_status")
                .and_then(Value::as_str)
                .is_none()
        {
            return Ok(Some(denied_objective_proposal_candidate(
                checkpoint,
                session_id,
                drive_id,
                "blocked_malformed_candidate_evidence",
                candidates.len(),
                "workspace proposal evidence is missing bounded candidate fields",
                replayed,
            )));
        }
        let approval = approval_state(&events, proposal_id);
        if payload.get("validation_status").and_then(Value::as_str) == Some("Valid")
            && approval.approval_status == "Pending"
        {
            candidates.push((event.clone(), payload));
        }
    }
    if candidates.is_empty() {
        return Ok(Some(denied_objective_proposal_candidate(
            checkpoint,
            session_id,
            drive_id,
            "blocked_no_candidate",
            0,
            "no valid pending workspace proposal belongs to the objective-context run",
            replayed,
        )));
    }
    if candidates.len() > 1 {
        return Ok(Some(denied_objective_proposal_candidate(
            checkpoint,
            session_id,
            drive_id,
            "blocked_ambiguous_candidates",
            candidates.len(),
            "more than one valid pending workspace proposal belongs to the objective-context run",
            replayed,
        )));
    }
    let (event, payload) = candidates.pop().expect("one candidate");
    let proposal_id = payload
        .get("proposal_id")
        .and_then(Value::as_str)
        .expect("candidate proposal_id");
    let path = payload
        .get("path")
        .and_then(Value::as_str)
        .expect("candidate path");
    let operation = payload
        .get("operation")
        .and_then(Value::as_str)
        .expect("candidate operation");
    let validation_status = payload
        .get("validation_status")
        .and_then(Value::as_str)
        .expect("candidate validation status");
    Ok(Some(finalize_objective_proposal_candidate(
        HeadlessRunObjectiveProposalCandidate {
            status: "ready_for_review".to_string(),
            journey_id: checkpoint.journey_id.clone(),
            task_id: checkpoint.task_id.clone(),
            run_id: checkpoint.run_id.clone(),
            session_id: session_id.to_string(),
            drive_id: drive_id.to_string(),
            objective_context_fingerprint: objective_context.objective_context_fingerprint.clone(),
            selected_context_fingerprint: objective_context.selected_context_fingerprint.clone(),
            candidate_count: 1,
            proposal_id: Some(proposal_id.to_string()),
            source_event_id: Some(event.event_id),
            source_event_kind: Some("WorkspacePatchProposed".to_string()),
            operation: Some(operation.to_string()),
            path_fingerprint: Some(format!("sha256:{}", hex_sha256(path.as_bytes()))),
            validation_status: Some(validation_status.to_string()),
            approval_status: Some("Pending".to_string()),
            denial_reason: None,
            candidate_fingerprint: String::new(),
            replayed,
            next_action: "review_and_authorize_objective_proposal".to_string(),
        },
    )))
}

pub(super) fn validate_headless_objective_proposal_candidate_replay(
    store: &BrownieStore,
    checkpoint: &HeadlessJourneyStartCheckpoint,
    session_id: &str,
    drive_id: &str,
    persisted: &HeadlessRunObjectiveProposalCandidate,
) -> Result<HeadlessRunObjectiveProposalCandidate, String> {
    let Some(mut current) = headless_objective_proposal_candidate_outcome(
        store, checkpoint, session_id, drive_id, true,
    )?
    else {
        return Err(
            "invalid params: objective proposal candidate checkpoint cannot be replayed without objective context"
                .to_string(),
        );
    };
    if current.candidate_fingerprint != persisted.candidate_fingerprint {
        return Err(
            "invalid params: objective proposal candidate evidence is stale for persisted drive checkpoint"
                .to_string(),
        );
    }
    current.replayed = true;
    Ok(current)
}

fn validate_objective_proposal_authorization_preflight_target(
    target: &ObjectiveProposalAuthorizationPreflightTarget,
) -> Result<(), String> {
    if !target.authorize_objective_proposal_preflight {
        return Err(
            "objective proposal authorization preflight failed: authorization required".to_string(),
        );
    }
    if !is_valid_headless_run_id(&target.journey_id)
        || !is_valid_headless_run_id(&target.session_id)
        || !is_valid_headless_run_id(&target.source_drive_id)
    {
        return Err(
            "objective proposal authorization preflight failed: journey, session, and drive ids must be valid headless ids"
                .to_string(),
        );
    }
    for (field, value) in [
        (
            "expected_journey_fingerprint",
            target.expected_journey_fingerprint.as_str(),
        ),
        (
            "expected_candidate_fingerprint",
            target.expected_candidate_fingerprint.as_str(),
        ),
        (
            "expected_objective_context_fingerprint",
            target.expected_objective_context_fingerprint.as_str(),
        ),
        (
            "expected_selected_context_fingerprint",
            target.expected_selected_context_fingerprint.as_str(),
        ),
        (
            "expected_path_fingerprint",
            target.expected_path_fingerprint.as_str(),
        ),
        (
            "authorization_token_fingerprint",
            target.authorization_token_fingerprint.as_str(),
        ),
    ] {
        if !is_sha256_fingerprint(value) {
            return Err(format!(
                "objective proposal authorization preflight failed: {field} must be a sha256 fingerprint"
            ));
        }
    }
    if target.expected_task_id.trim().is_empty()
        || target.expected_run_id.trim().is_empty()
        || target.expected_proposal_id.trim().is_empty()
        || target.expected_source_event_id.trim().is_empty()
    {
        return Err(
            "objective proposal authorization preflight failed: task, run, proposal, and source event ids are required"
                .to_string(),
        );
    }
    if target.expected_source_event_kind != "WorkspacePatchProposed"
        || target.expected_operation != WorkspacePatchOperation::ReplaceFile.as_str()
        || target.expected_validation_status != "Valid"
        || target.expected_approval_status != "Pending"
    {
        return Err(
            "objective proposal authorization preflight failed: expected route labels must describe a valid pending replace_file proposal"
                .to_string(),
        );
    }
    Ok(())
}

fn objective_authorization_reason(continuation_id: &str) -> String {
    format!("headless objective proposal authorization preflight {continuation_id}")
}

fn objective_proposal_candidate_from_target(
    target: &ObjectiveProposalAuthorizationPreflightTarget,
) -> HeadlessRunObjectiveProposalCandidate {
    finalize_objective_proposal_candidate(HeadlessRunObjectiveProposalCandidate {
        status: "ready_for_review".to_string(),
        journey_id: target.journey_id.clone(),
        task_id: target.expected_task_id.clone(),
        run_id: target.expected_run_id.clone(),
        session_id: target.session_id.clone(),
        drive_id: target.source_drive_id.clone(),
        objective_context_fingerprint: target.expected_objective_context_fingerprint.clone(),
        selected_context_fingerprint: target.expected_selected_context_fingerprint.clone(),
        candidate_count: 1,
        proposal_id: Some(target.expected_proposal_id.clone()),
        source_event_id: Some(target.expected_source_event_id.clone()),
        source_event_kind: Some(target.expected_source_event_kind.clone()),
        operation: Some(target.expected_operation.clone()),
        path_fingerprint: Some(target.expected_path_fingerprint.clone()),
        validation_status: Some(target.expected_validation_status.clone()),
        approval_status: Some(target.expected_approval_status.clone()),
        denial_reason: None,
        candidate_fingerprint: String::new(),
        replayed: false,
        next_action: "review_and_authorize_objective_proposal".to_string(),
    })
}

fn objective_proposal_authorization_preflight_request_fingerprint(
    params: &HeadlessContinueOnceParams,
) -> Result<String, String> {
    let target = params
        .objective_proposal_authorization_preflight_target
        .as_ref()
        .ok_or_else(|| "objective proposal authorization preflight target missing".to_string())?;
    let continuation_id = params.continuation_id.as_deref().ok_or_else(|| {
        "objective proposal authorization preflight failed: continuation_id is required".to_string()
    })?;
    let seed = json!({
        "route_kind": "objective_proposal_authorization_preflight",
        "continuation_id": continuation_id,
        "authorize": params.authorize,
        "expected_progress_fingerprint": params.expected_progress_fingerprint,
        "expected_aggregate_sequence": params.expected_aggregate_sequence,
        "authorize_objective_proposal_preflight": target.authorize_objective_proposal_preflight,
        "journey_id": target.journey_id,
        "session_id": target.session_id,
        "source_drive_id": target.source_drive_id,
        "expected_journey_fingerprint": target.expected_journey_fingerprint,
        "expected_candidate_fingerprint": target.expected_candidate_fingerprint,
        "expected_objective_context_fingerprint": target.expected_objective_context_fingerprint,
        "expected_selected_context_fingerprint": target.expected_selected_context_fingerprint,
        "expected_task_id": target.expected_task_id,
        "expected_run_id": target.expected_run_id,
        "expected_proposal_id": target.expected_proposal_id,
        "expected_source_event_id": target.expected_source_event_id,
        "expected_source_event_kind": target.expected_source_event_kind,
        "expected_operation": target.expected_operation,
        "expected_path_fingerprint": target.expected_path_fingerprint,
        "expected_validation_status": target.expected_validation_status,
        "expected_approval_status": target.expected_approval_status,
        "authorization_token_fingerprint": target.authorization_token_fingerprint,
    });
    Ok(format!(
        "sha256:{}",
        hex_sha256(seed.to_string().as_bytes())
    ))
}

fn validate_objective_proposal_authorization_preflight_replay_request(
    params: &HeadlessContinueOnceParams,
    checkpoint: &HeadlessObjectiveProposalAuthorizationPreflightCheckpoint,
) -> Result<(), String> {
    let current = objective_proposal_authorization_preflight_request_fingerprint(params)?;
    match checkpoint.request_fingerprint.as_deref() {
        Some(stored) if stored == current => Ok(()),
        Some(_) => Err(
            "invalid params: headless objective proposal authorization preflight continuation request identity mismatch"
                .to_string(),
        ),
        None => Err(
            "invalid params: headless objective proposal authorization preflight checkpoint is missing request identity fingerprint"
                .to_string(),
        ),
    }
}

fn objective_proposal_authorization_preflight_fingerprint(
    result: &HeadlessRunObjectiveProposalAuthorizationPreflight,
) -> String {
    let seed = json!({
        "version": "headless_objective_proposal_authorization_preflight_v1",
        "status": result.status,
        "journey_id": result.journey_id,
        "task_id": result.task_id,
        "run_id": result.run_id,
        "session_id": result.session_id,
        "source_drive_id": result.source_drive_id,
        "proposal_id": result.proposal_id,
        "source_event_id": result.source_event_id,
        "source_event_kind": result.source_event_kind,
        "operation": result.operation,
        "path_fingerprint": result.path_fingerprint,
        "objective_context_fingerprint": result.objective_context_fingerprint,
        "selected_context_fingerprint": result.selected_context_fingerprint,
        "candidate_fingerprint": result.candidate_fingerprint,
        "authorization_token_fingerprint": result.authorization_token_fingerprint,
        "validation_status": result.validation_status,
        "approval_status": result.approval_status,
        "approved_at": result.approved_at,
        "preflight_snapshot_id": result.preflight_snapshot.snapshot_id,
        "preflight_canonical_path_hash": result.preflight_snapshot.canonical_path_hash,
        "preflight_file_sha256": result.preflight_snapshot.file_sha256,
        "preflight_stale": result.preflight_snapshot.stale,
        "apply_plan_id": result.apply_plan.plan_id,
        "apply_plan_status": result.apply_plan.status,
        "next_action": result.next_action,
    });
    format!("sha256:{}", hex_sha256(seed.to_string().as_bytes()))
}

fn finalize_objective_proposal_authorization_preflight(
    mut result: HeadlessRunObjectiveProposalAuthorizationPreflight,
) -> HeadlessRunObjectiveProposalAuthorizationPreflight {
    result.authorization_preflight_fingerprint =
        objective_proposal_authorization_preflight_fingerprint(&result);
    result
}

fn validate_current_objective_proposal_candidate_source(
    store: &BrownieStore,
    target: &ObjectiveProposalAuthorizationPreflightTarget,
) -> Result<(), String> {
    let events = read_existing_run_events(store, &target.expected_run_id)?;
    let mut matching_candidate_count = 0usize;
    let mut source_event_found = false;
    for event in events
        .iter()
        .filter(|event| event.kind == LedgerEventKind::WorkspacePatchProposed)
    {
        let Some(payload) = sanitize_ledger_payload(event.payload.clone()) else {
            return Err(
                "objective proposal authorization preflight failed: workspace proposal evidence is malformed"
                    .to_string(),
            );
        };
        let proposal_id = payload.get("proposal_id").and_then(Value::as_str);
        let path = payload.get("path").and_then(Value::as_str);
        let operation = payload.get("operation").and_then(Value::as_str);
        let validation_status = payload.get("validation_status").and_then(Value::as_str);
        if proposal_id == Some(target.expected_proposal_id.as_str())
            && path.is_some()
            && operation.is_some()
            && validation_status.is_some()
        {
            source_event_found = true;
            if event.event_id != target.expected_source_event_id
                || operation != Some(target.expected_operation.as_str())
                || validation_status != Some(target.expected_validation_status.as_str())
                || path
                    .map(|value| format!("sha256:{}", hex_sha256(value.as_bytes())))
                    .as_deref()
                    != Some(target.expected_path_fingerprint.as_str())
            {
                return Err(
                    "objective proposal authorization preflight failed: source proposal event evidence mismatch"
                        .to_string(),
                );
            }
        }
        let approval = proposal_id
            .map(|proposal_id| approval_state(&events, proposal_id))
            .unwrap_or_else(|| ApprovalState {
                approval_status: "Pending".to_string(),
                approval_reason: None,
                approval_reason_redacted: false,
                approved_at: None,
                rejected_at: None,
            });
        if validation_status == Some("Valid") && approval.approval_status == "Pending" {
            matching_candidate_count += 1;
        }
    }
    if !source_event_found {
        return Err(
            "objective proposal authorization preflight failed: source proposal event not found"
                .to_string(),
        );
    }
    let proposal = inspect_proposal(store, &target.expected_run_id, &target.expected_proposal_id)?;
    if proposal.approval_status == "Pending" && matching_candidate_count != 1 {
        return Err(
            "objective proposal authorization preflight failed: objective proposal candidate set is ambiguous or missing"
                .to_string(),
        );
    }
    Ok(())
}

fn validate_objective_proposal_authorization_preflight_route(
    store: &BrownieStore,
    target: &ObjectiveProposalAuthorizationPreflightTarget,
) -> Result<(), String> {
    let checkpoint = store
        .tasks()
        .read_headless_journey_start_checkpoint(&target.journey_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| {
            "objective proposal authorization preflight failed: journey checkpoint not found"
                .to_string()
        })?;
    if checkpoint.session_id != target.session_id
        || checkpoint.drive_id != target.source_drive_id
        || checkpoint.task_id != target.expected_task_id
        || checkpoint.run_id != target.expected_run_id
        || checkpoint.journey_fingerprint != target.expected_journey_fingerprint
    {
        return Err(
            "objective proposal authorization preflight failed: journey checkpoint evidence mismatch"
                .to_string(),
        );
    }
    let objective_context = checkpoint.objective_context.as_ref().ok_or_else(|| {
        "objective proposal authorization preflight failed: journey has no objective context"
            .to_string()
    })?;
    if objective_context.objective_context_fingerprint
        != target.expected_objective_context_fingerprint
        || objective_context.selected_context_fingerprint
            != target.expected_selected_context_fingerprint
    {
        return Err(
            "objective proposal authorization preflight failed: objective context evidence mismatch"
                .to_string(),
        );
    }
    let expected_candidate = objective_proposal_candidate_from_target(target);
    if expected_candidate.candidate_fingerprint != target.expected_candidate_fingerprint {
        return Err(
            "objective proposal authorization preflight failed: candidate fingerprint mismatch"
                .to_string(),
        );
    }
    let drive_checkpoint = store
        .tasks()
        .read_headless_run_session_drive_checkpoint(&target.session_id, &target.source_drive_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| {
            "objective proposal authorization preflight failed: source drive checkpoint not found"
                .to_string()
        })?;
    if drive_checkpoint
        .result
        .next_route
        .as_ref()
        .map(|route| &route.kind)
        != Some(&HeadlessContinueRouteKind::ReviewAndAuthorizeObjectiveProposal)
        || drive_checkpoint
            .result
            .objective_proposal_candidate
            .as_ref()
            .map(|candidate| candidate.candidate_fingerprint.as_str())
            != Some(target.expected_candidate_fingerprint.as_str())
    {
        return Err(
            "objective proposal authorization preflight failed: source drive route is not the objective proposal review route"
                .to_string(),
        );
    }
    validate_current_objective_proposal_candidate_source(store, target)
}

fn objective_proposal_authorization_preflight_result(
    target: &ObjectiveProposalAuthorizationPreflightTarget,
    proposal: &WorkspacePatchProposalSummary,
    snapshot: WorkspacePatchPreflightSnapshotSummary,
    apply_plan: WorkspacePatchApplyPlanSummary,
) -> HeadlessRunObjectiveProposalAuthorizationPreflight {
    finalize_objective_proposal_authorization_preflight(
        HeadlessRunObjectiveProposalAuthorizationPreflight {
            status: "authorized_preflight_ready".to_string(),
            journey_id: target.journey_id.clone(),
            task_id: target.expected_task_id.clone(),
            run_id: target.expected_run_id.clone(),
            session_id: target.session_id.clone(),
            source_drive_id: target.source_drive_id.clone(),
            proposal_id: target.expected_proposal_id.clone(),
            source_event_id: target.expected_source_event_id.clone(),
            source_event_kind: target.expected_source_event_kind.clone(),
            operation: target.expected_operation.clone(),
            path_fingerprint: target.expected_path_fingerprint.clone(),
            objective_context_fingerprint: target.expected_objective_context_fingerprint.clone(),
            selected_context_fingerprint: target.expected_selected_context_fingerprint.clone(),
            candidate_fingerprint: target.expected_candidate_fingerprint.clone(),
            authorization_token_fingerprint: target.authorization_token_fingerprint.clone(),
            validation_status: proposal.validation_status.clone(),
            approval_status: proposal.approval_status.clone(),
            approved_at: proposal.approved_at.clone(),
            preflight_snapshot: snapshot,
            apply_plan,
            authorization_preflight_fingerprint: String::new(),
            replayed: false,
            next_action: "apply_authorized_objective_proposal".to_string(),
        },
    )
}

pub(super) fn handle_headless_continue_objective_proposal_authorization_preflight(
    id: Value,
    store: &BrownieStore,
    progress_overview: &TaskListProgressOverview,
    params: HeadlessContinueOnceParams,
) -> JsonRpcResponse<Value> {
    let result = match headless_continue_objective_proposal_authorization_preflight(
        store,
        progress_overview,
        &params,
    ) {
        Ok(result) => result,
        Err(message) => return error_response(id, -32602, &message),
    };
    result_response(id, json!(result))
}

pub(super) fn headless_continue_objective_proposal_authorization_preflight_replay_result(
    id: Value,
    progress_overview: &TaskListProgressOverview,
    params: HeadlessContinueOnceParams,
    checkpoint: HeadlessObjectiveProposalAuthorizationPreflightCheckpoint,
) -> JsonRpcResponse<Value> {
    if let Err(message) =
        validate_objective_proposal_authorization_preflight_replay_request(&params, &checkpoint)
    {
        return error_response(id, -32602, &message);
    }
    let mut authorization_result = checkpoint.result;
    authorization_result.replayed = true;
    let next_route = HeadlessContinueRoute {
        kind: HeadlessContinueRouteKind::ApplyAuthorizedObjectiveProposalExplicitly,
        reason: "Objective proposal authorization and latest preflight were already completed by this continuation; replaying bounded result before explicit apply.".to_string(),
        task_id: Some(authorization_result.task_id.clone()),
        run_id: Some(authorization_result.run_id.clone()),
        proposal_id: Some(authorization_result.proposal_id.clone()),
        apply_id: None,
        failure_fingerprint: None,
        apply_fingerprint: Some(authorization_result.authorization_preflight_fingerprint.clone()),
        progress_fingerprint: Some(progress_overview.source_fingerprint.clone()),
        aggregate_sequence: Some(progress_overview.aggregate_sequence),
        next_action: "apply_authorized_objective_proposal".to_string(),
    };
    result_response(
        id,
        json!(HeadlessContinueOnceResult {
            status: HeadlessContinueOnceStatus::TaskExecuted,
            decision_id: Some(checkpoint.decision_id),
            continuation_id: Some(checkpoint.continuation_id),
            selected_task_id: None,
            selected_run_id: None,
            candidate_count: 1,
            expected_progress_fingerprint: params.expected_progress_fingerprint,
            expected_aggregate_sequence: params.expected_aggregate_sequence,
            current_progress_fingerprint: progress_overview.source_fingerprint.clone(),
            current_aggregate_sequence: progress_overview.aggregate_sequence,
            post_progress_fingerprint: Some(checkpoint.post_progress_fingerprint),
            post_aggregate_sequence: Some(checkpoint.post_aggregate_sequence),
            stale: false,
            replayed: true,
            task_run_result: None,
            proposal_apply_result: None,
            objective_proposal_authorization_preflight_result: Some(authorization_result),
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
            next_action: "apply_authorized_objective_proposal".to_string(),
        }),
    )
}

fn headless_continue_objective_proposal_authorization_preflight(
    store: &BrownieStore,
    progress_overview: &TaskListProgressOverview,
    params: &HeadlessContinueOnceParams,
) -> Result<HeadlessContinueOnceResult, String> {
    let target = params
        .objective_proposal_authorization_preflight_target
        .as_ref()
        .ok_or_else(|| "objective proposal authorization preflight target missing".to_string())?;
    validate_objective_proposal_authorization_preflight_target(target)?;
    let continuation_id = params.continuation_id.clone().ok_or_else(|| {
        "objective proposal authorization preflight failed: continuation_id is required".to_string()
    })?;
    let request_fingerprint =
        objective_proposal_authorization_preflight_request_fingerprint(params)?;
    validate_objective_proposal_authorization_preflight_route(store, target)?;

    let bounded_reason = objective_authorization_reason(&continuation_id);
    let mut proposal =
        inspect_proposal(store, &target.expected_run_id, &target.expected_proposal_id)?;
    if proposal.validation_status != "Valid" {
        return Err(
            "objective proposal authorization preflight failed: proposal is not valid".to_string(),
        );
    }
    match proposal.approval_status.as_str() {
        "Pending" => {
            let (approved, _) = approve_proposal(
                store,
                &target.expected_run_id,
                &target.expected_proposal_id,
                Some(bounded_reason.clone()),
            )?;
            proposal = approved;
        }
        "Approved"
            if proposal.approval_reason.as_deref() == Some(bounded_reason.as_str())
                && !proposal.approval_reason_redacted => {}
        "Rejected" => {
            return Err(
                "objective proposal authorization preflight failed: proposal is rejected"
                    .to_string(),
            )
        }
        _ => {
            return Err(
                "objective proposal authorization preflight failed: proposal is not pending for this continuation"
                    .to_string(),
            )
        }
    }
    if proposal.approval_status != "Approved" {
        return Err(
            "objective proposal authorization preflight failed: proposal approval did not complete"
                .to_string(),
        );
    }

    let (proposal, snapshot, apply_plan) = match (
        proposal.latest_snapshot.clone(),
        proposal.latest_apply_plan.clone(),
    ) {
        (Some(snapshot), Some(apply_plan)) if !snapshot.stale && apply_plan.status == "Ready" => {
            (proposal, snapshot, apply_plan)
        }
        _ => {
            let (proposal, snapshot, apply_plan) =
                preflight_proposal(store, &target.expected_run_id, &target.expected_proposal_id)?;
            (proposal, snapshot, apply_plan)
        }
    };
    if proposal.approval_status != "Approved"
        || proposal.validation_status != "Valid"
        || snapshot.proposal_id != target.expected_proposal_id
        || apply_plan.proposal_id != target.expected_proposal_id
        || apply_plan.status != "Ready"
    {
        return Err(
            "objective proposal authorization preflight failed: post-preflight evidence mismatch"
                .to_string(),
        );
    }

    let authorization_result =
        objective_proposal_authorization_preflight_result(target, &proposal, snapshot, apply_plan);
    let post_tasks = store
        .tasks()
        .list_tasks()
        .map_err(|error| error.to_string())?;
    let post_progress = task_list_progress_overview(store, &post_tasks)?;
    let decision_id = format!("headless_decision_{}", uuid::Uuid::new_v4().simple());
    store
        .write_headless_objective_proposal_authorization_preflight_checkpoint(
            &HeadlessObjectiveProposalAuthorizationPreflightCheckpoint {
                continuation_id: continuation_id.clone(),
                decision_id: decision_id.clone(),
                request_fingerprint: Some(request_fingerprint),
                expected_progress_fingerprint: params.expected_progress_fingerprint.clone(),
                expected_aggregate_sequence: params.expected_aggregate_sequence,
                current_progress_fingerprint: progress_overview.source_fingerprint.clone(),
                current_aggregate_sequence: progress_overview.aggregate_sequence,
                post_progress_fingerprint: post_progress.source_fingerprint.clone(),
                post_aggregate_sequence: post_progress.aggregate_sequence,
                journey_id: target.journey_id.clone(),
                session_id: target.session_id.clone(),
                source_drive_id: target.source_drive_id.clone(),
                proposal_id: target.expected_proposal_id.clone(),
                result: authorization_result.clone(),
            },
        )
        .map_err(|error| error.to_string())?;
    let next_route = HeadlessContinueRoute {
        kind: HeadlessContinueRouteKind::ApplyAuthorizedObjectiveProposalExplicitly,
        reason: "Authorized and preflighted the objective proposal candidate; controlled apply remains an explicit next step.".to_string(),
        task_id: Some(target.expected_task_id.clone()),
        run_id: Some(target.expected_run_id.clone()),
        proposal_id: Some(target.expected_proposal_id.clone()),
        apply_id: None,
        failure_fingerprint: None,
        apply_fingerprint: Some(
            authorization_result.authorization_preflight_fingerprint.clone(),
        ),
        progress_fingerprint: Some(post_progress.source_fingerprint.clone()),
        aggregate_sequence: Some(post_progress.aggregate_sequence),
        next_action: "apply_authorized_objective_proposal".to_string(),
    };
    Ok(HeadlessContinueOnceResult {
        status: HeadlessContinueOnceStatus::TaskExecuted,
        decision_id: Some(decision_id),
        continuation_id: Some(continuation_id),
        selected_task_id: None,
        selected_run_id: None,
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
        objective_proposal_authorization_preflight_result: Some(authorization_result),
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
        next_action: "apply_authorized_objective_proposal".to_string(),
    })
}

fn objective_proposal_apply_replacement_content_fingerprint(content: &str) -> String {
    format!("sha256:{}", hex_sha256(content.as_bytes()))
}

fn validate_objective_proposal_apply_target(
    target: &ObjectiveProposalApplyTarget,
) -> Result<(), String> {
    if !target.authorize_objective_proposal_apply {
        return Err("objective proposal apply failed: authorization required".to_string());
    }
    if !is_valid_headless_continuation_id(&target.authorization_preflight_continuation_id) {
        return Err(
            "objective proposal apply failed: authorization_preflight_continuation_id must be a valid continuation id"
                .to_string(),
        );
    }
    if !is_valid_headless_run_id(&target.journey_id)
        || !is_valid_headless_run_id(&target.session_id)
        || !is_valid_headless_run_id(&target.source_drive_id)
    {
        return Err(
            "objective proposal apply failed: journey, session, and drive ids must be valid headless ids"
                .to_string(),
        );
    }
    for (field, value) in [
        (
            "expected_journey_fingerprint",
            target.expected_journey_fingerprint.as_str(),
        ),
        (
            "expected_candidate_fingerprint",
            target.expected_candidate_fingerprint.as_str(),
        ),
        (
            "expected_objective_context_fingerprint",
            target.expected_objective_context_fingerprint.as_str(),
        ),
        (
            "expected_selected_context_fingerprint",
            target.expected_selected_context_fingerprint.as_str(),
        ),
        (
            "expected_path_fingerprint",
            target.expected_path_fingerprint.as_str(),
        ),
        (
            "expected_authorization_preflight_fingerprint",
            target.expected_authorization_preflight_fingerprint.as_str(),
        ),
        (
            "expected_target_sha256",
            target.expected_target_sha256.as_str(),
        ),
    ] {
        if !is_sha256_fingerprint(value) {
            return Err(format!(
                "objective proposal apply failed: {field} must be a sha256 fingerprint"
            ));
        }
    }
    if target.expected_task_id.trim().is_empty()
        || target.expected_run_id.trim().is_empty()
        || target.expected_proposal_id.trim().is_empty()
        || target.expected_source_event_id.trim().is_empty()
        || target
            .expected_authorization_preflight_decision_id
            .trim()
            .is_empty()
        || target.expected_preflight_snapshot_id.trim().is_empty()
        || target.expected_apply_plan_id.trim().is_empty()
    {
        return Err(
            "objective proposal apply failed: task, run, proposal, source event, authorization, snapshot, and plan ids are required"
                .to_string(),
        );
    }
    if target.expected_source_event_kind != "WorkspacePatchProposed"
        || target.expected_operation != WorkspacePatchOperation::ReplaceFile.as_str()
        || target.expected_validation_status != "Valid"
        || target.expected_approval_status != "Approved"
    {
        return Err(
            "objective proposal apply failed: expected route labels must describe an approved valid replace_file proposal"
                .to_string(),
        );
    }
    Ok(())
}

fn objective_proposal_apply_request_fingerprint(
    params: &HeadlessContinueOnceParams,
) -> Result<String, String> {
    let target = params
        .objective_proposal_apply_target
        .as_ref()
        .ok_or_else(|| "objective proposal apply target missing".to_string())?;
    let continuation_id = params.continuation_id.as_deref().ok_or_else(|| {
        "objective proposal apply failed: continuation_id is required".to_string()
    })?;
    let replacement_content_sha256 =
        objective_proposal_apply_replacement_content_fingerprint(&target.replacement_content);
    let seed = json!({
        "route_kind": "objective_proposal_apply",
        "continuation_id": continuation_id,
        "authorize": params.authorize,
        "expected_progress_fingerprint": params.expected_progress_fingerprint,
        "expected_aggregate_sequence": params.expected_aggregate_sequence,
        "authorize_objective_proposal_apply": target.authorize_objective_proposal_apply,
        "authorization_preflight_continuation_id": target.authorization_preflight_continuation_id,
        "expected_authorization_preflight_decision_id": target.expected_authorization_preflight_decision_id,
        "journey_id": target.journey_id,
        "session_id": target.session_id,
        "source_drive_id": target.source_drive_id,
        "expected_journey_fingerprint": target.expected_journey_fingerprint,
        "expected_candidate_fingerprint": target.expected_candidate_fingerprint,
        "expected_objective_context_fingerprint": target.expected_objective_context_fingerprint,
        "expected_selected_context_fingerprint": target.expected_selected_context_fingerprint,
        "expected_task_id": target.expected_task_id,
        "expected_run_id": target.expected_run_id,
        "expected_proposal_id": target.expected_proposal_id,
        "expected_source_event_id": target.expected_source_event_id,
        "expected_source_event_kind": target.expected_source_event_kind,
        "expected_operation": target.expected_operation,
        "expected_path_fingerprint": target.expected_path_fingerprint,
        "expected_validation_status": target.expected_validation_status,
        "expected_approval_status": target.expected_approval_status,
        "expected_authorization_preflight_fingerprint": target.expected_authorization_preflight_fingerprint,
        "expected_preflight_snapshot_id": target.expected_preflight_snapshot_id,
        "expected_apply_plan_id": target.expected_apply_plan_id,
        "expected_target_sha256": target.expected_target_sha256,
        "replacement_content_sha256": replacement_content_sha256,
        "replacement_content_bytes": target.replacement_content.as_bytes().len(),
        "replacement_content_chars": target.replacement_content.chars().count(),
    });
    Ok(format!(
        "sha256:{}",
        hex_sha256(seed.to_string().as_bytes())
    ))
}

fn validate_objective_proposal_apply_replay_request(
    params: &HeadlessContinueOnceParams,
    checkpoint: &HeadlessObjectiveProposalApplyCheckpoint,
) -> Result<(), String> {
    let current = objective_proposal_apply_request_fingerprint(params)?;
    match checkpoint.request_fingerprint.as_deref() {
        Some(stored) if stored == current => Ok(()),
        Some(_) => Err(
            "invalid params: headless objective proposal apply continuation request identity mismatch"
                .to_string(),
        ),
        None => Err(
            "invalid params: headless objective proposal apply checkpoint is missing request identity fingerprint"
                .to_string(),
        ),
    }
}

fn validate_objective_proposal_apply_route(
    store: &BrownieStore,
    target: &ObjectiveProposalApplyTarget,
) -> Result<HeadlessObjectiveProposalAuthorizationPreflightCheckpoint, String> {
    let checkpoint = store
        .read_headless_objective_proposal_authorization_preflight_checkpoint(
            &target.authorization_preflight_continuation_id,
        )
        .map_err(|error| error.to_string())?
        .ok_or_else(|| {
            "objective proposal apply failed: authorization preflight checkpoint not found"
                .to_string()
        })?;
    if checkpoint.decision_id != target.expected_authorization_preflight_decision_id {
        return Err(
            "objective proposal apply failed: authorization preflight decision mismatch"
                .to_string(),
        );
    }
    let result = &checkpoint.result;
    if result.status != "authorized_preflight_ready"
        || result.journey_id != target.journey_id
        || result.session_id != target.session_id
        || result.source_drive_id != target.source_drive_id
        || result.task_id != target.expected_task_id
        || result.run_id != target.expected_run_id
        || result.proposal_id != target.expected_proposal_id
        || result.source_event_id != target.expected_source_event_id
        || result.source_event_kind != target.expected_source_event_kind
        || result.operation != target.expected_operation
        || result.path_fingerprint != target.expected_path_fingerprint
        || result.objective_context_fingerprint != target.expected_objective_context_fingerprint
        || result.selected_context_fingerprint != target.expected_selected_context_fingerprint
        || result.candidate_fingerprint != target.expected_candidate_fingerprint
        || result.validation_status != target.expected_validation_status
        || result.approval_status != target.expected_approval_status
        || result.authorization_preflight_fingerprint
            != target.expected_authorization_preflight_fingerprint
        || result.preflight_snapshot.snapshot_id != target.expected_preflight_snapshot_id
        || result.apply_plan.plan_id != target.expected_apply_plan_id
    {
        return Err(
            "objective proposal apply failed: authorization preflight evidence mismatch"
                .to_string(),
        );
    }
    if result.preflight_snapshot.file_sha256.as_deref()
        != Some(target.expected_target_sha256.as_str())
        || result.preflight_snapshot.stale
        || result.apply_plan.status != "Ready"
    {
        return Err(
            "objective proposal apply failed: authorization preflight is not current and ready"
                .to_string(),
        );
    }
    let proposal = inspect_proposal(store, &target.expected_run_id, &target.expected_proposal_id)?;
    if proposal.operation != WorkspacePatchOperation::ReplaceFile.as_str()
        || proposal.validation_status != "Valid"
        || proposal.approval_status != "Approved"
    {
        return Err(
            "objective proposal apply failed: proposal is not an approved valid replace_file proposal"
                .to_string(),
        );
    }
    Ok(checkpoint)
}

pub(super) fn handle_headless_continue_objective_proposal_apply(
    id: Value,
    store: &BrownieStore,
    progress_overview: &TaskListProgressOverview,
    params: HeadlessContinueOnceParams,
) -> JsonRpcResponse<Value> {
    let result = match headless_continue_objective_proposal_apply(store, progress_overview, &params)
    {
        Ok(result) => result,
        Err(message) => return error_response(id, -32602, &message),
    };
    result_response(id, json!(result))
}

pub(super) fn headless_continue_objective_proposal_apply_replay_result(
    id: Value,
    progress_overview: &TaskListProgressOverview,
    params: HeadlessContinueOnceParams,
    checkpoint: HeadlessObjectiveProposalApplyCheckpoint,
) -> JsonRpcResponse<Value> {
    if let Err(message) = validate_objective_proposal_apply_replay_request(&params, &checkpoint) {
        return error_response(id, -32602, &message);
    }
    let next_route = HeadlessContinueRoute {
        kind: HeadlessContinueRouteKind::VerifyObjectiveApplyExplicitly,
        reason: "Objective proposal apply was already completed by this continuation; replaying bounded apply result."
            .to_string(),
        task_id: Some(checkpoint.task_id.clone()),
        run_id: Some(checkpoint.run_id.clone()),
        proposal_id: Some(checkpoint.proposal_id.clone()),
        apply_id: Some(checkpoint.result.apply_result.apply_id.clone()),
        failure_fingerprint: None,
        apply_fingerprint: Some(checkpoint.apply_fingerprint.clone()),
        progress_fingerprint: Some(progress_overview.source_fingerprint.clone()),
        aggregate_sequence: Some(progress_overview.aggregate_sequence),
        next_action: "verify_objective_apply".to_string(),
    };
    result_response(
        id,
        json!(HeadlessContinueOnceResult {
            status: HeadlessContinueOnceStatus::TaskExecuted,
            decision_id: Some(checkpoint.decision_id),
            continuation_id: Some(checkpoint.continuation_id),
            selected_task_id: Some(checkpoint.task_id),
            selected_run_id: Some(checkpoint.run_id),
            candidate_count: 1,
            expected_progress_fingerprint: params.expected_progress_fingerprint,
            expected_aggregate_sequence: params.expected_aggregate_sequence,
            current_progress_fingerprint: progress_overview.source_fingerprint.clone(),
            current_aggregate_sequence: progress_overview.aggregate_sequence,
            post_progress_fingerprint: Some(checkpoint.post_progress_fingerprint),
            post_aggregate_sequence: Some(checkpoint.post_aggregate_sequence),
            stale: false,
            replayed: true,
            task_run_result: None,
            proposal_apply_result: Some(checkpoint.result),
            objective_proposal_authorization_preflight_result: None,
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
            next_action: "verify_objective_apply".to_string(),
        }),
    )
}

fn headless_continue_objective_proposal_apply(
    store: &BrownieStore,
    progress_overview: &TaskListProgressOverview,
    params: &HeadlessContinueOnceParams,
) -> Result<HeadlessContinueOnceResult, String> {
    let target = params
        .objective_proposal_apply_target
        .as_ref()
        .ok_or_else(|| "objective proposal apply target missing".to_string())?;
    validate_objective_proposal_apply_target(target)?;
    let continuation_id = params.continuation_id.clone().ok_or_else(|| {
        "objective proposal apply failed: continuation_id is required".to_string()
    })?;
    let request_fingerprint = objective_proposal_apply_request_fingerprint(params)?;
    let authorization_checkpoint = validate_objective_proposal_apply_route(store, target)?;
    let selected_record = store
        .tasks()
        .get_task(&target.expected_task_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "objective proposal apply failed: source task not found".to_string())?;
    if selected_record.run_id != target.expected_run_id {
        return Err("objective proposal apply failed: source task/run mismatch".to_string());
    }

    let (proposal, apply_result) = apply_proposal(
        store,
        &ProposalApplyParams {
            run_id: target.expected_run_id.clone(),
            proposal_id: target.expected_proposal_id.clone(),
            expected_target_sha256: Some(target.expected_target_sha256.clone()),
            expected_target_absent: None,
            replacement_content: Some(target.replacement_content.clone()),
            patch_old_text: None,
            patch_new_text: None,
            patch_hunks: None,
            authorize: true,
            transaction_items: None,
            transaction_recovery_source: None,
        },
    )?;
    let proposal_apply_result = ProposalApplyResult {
        proposal,
        apply_result,
    };
    let apply_payload = json!(proposal_apply_result.apply_result);
    let apply_fingerprint = verification_recovery_apply_fingerprint(&apply_payload);
    let replacement_content_sha256 =
        objective_proposal_apply_replacement_content_fingerprint(&target.replacement_content);
    let decision_id = format!("headless_decision_{}", uuid::Uuid::new_v4().simple());
    let policy_version = "headless_continue_once_v1";
    store
        .tasks()
        .append_task_event_with_payload(
            &selected_record,
            LedgerEventKind::HeadlessContinuationDecisionRecorded,
            Some(json!({
                "decision_id": decision_id.clone(),
                "continuation_id": continuation_id.clone(),
                "selected_task_id": selected_record.task_id.clone(),
                "selected_run_id": selected_record.run_id.clone(),
                "expected_progress_fingerprint": params.expected_progress_fingerprint.clone(),
                "expected_aggregate_sequence": params.expected_aggregate_sequence,
                "candidate_count": 1,
                "policy_version": policy_version,
                "authorize": true,
                "authorize_objective_proposal_apply": true,
                "authorization_preflight_continuation_id": target.authorization_preflight_continuation_id.clone(),
                "authorization_preflight_decision_id": authorization_checkpoint.decision_id.clone(),
                "authorization_preflight_fingerprint": target.expected_authorization_preflight_fingerprint.clone(),
                "journey_id": target.journey_id.clone(),
                "session_id": target.session_id.clone(),
                "source_drive_id": target.source_drive_id.clone(),
                "source_event_id": target.expected_source_event_id.clone(),
                "source_event_kind": target.expected_source_event_kind.clone(),
                "proposal_id": target.expected_proposal_id.clone(),
                "operation": target.expected_operation.clone(),
                "path_fingerprint": target.expected_path_fingerprint.clone(),
                "expected_target_sha256": target.expected_target_sha256.clone(),
                "replacement_content_sha256": replacement_content_sha256.clone(),
                "replacement_content_bytes": target.replacement_content.as_bytes().len(),
                "replacement_content_chars": target.replacement_content.chars().count(),
                "apply_id": proposal_apply_result.apply_result.apply_id.clone(),
                "apply_status": proposal_apply_result.apply_result.apply_status.clone(),
                "applied": proposal_apply_result.apply_result.applied,
                "apply_fingerprint": apply_fingerprint.clone(),
                "next_action": "inspect_progress_overview",
                "reason": "Headless continue-once applied one authorized objective replace_file proposal under explicit authorization."
            })),
        )
        .map_err(|error| error.to_string())?;
    store
        .tasks()
        .write_headless_continuation_decision(&HeadlessContinuationDecisionLookup {
            decision_id: decision_id.clone(),
            continuation_id: continuation_id.clone(),
            selected_task_id: selected_record.task_id.clone(),
            selected_run_id: selected_record.run_id.clone(),
            expected_progress_fingerprint: params.expected_progress_fingerprint.clone(),
            expected_aggregate_sequence: params.expected_aggregate_sequence,
            candidate_count: 1,
            policy_version: policy_version.to_string(),
        })
        .map_err(|error| error.to_string())?;

    let post_tasks = store
        .tasks()
        .list_tasks()
        .map_err(|error| error.to_string())?;
    let post_progress = task_list_progress_overview(store, &post_tasks)?;
    store
        .write_headless_objective_proposal_apply_checkpoint(
            &HeadlessObjectiveProposalApplyCheckpoint {
                continuation_id: continuation_id.clone(),
                decision_id: decision_id.clone(),
                request_fingerprint: Some(request_fingerprint),
                authorization_preflight_continuation_id: target
                    .authorization_preflight_continuation_id
                    .clone(),
                expected_authorization_preflight_decision_id: target
                    .expected_authorization_preflight_decision_id
                    .clone(),
                expected_progress_fingerprint: params.expected_progress_fingerprint.clone(),
                expected_aggregate_sequence: params.expected_aggregate_sequence,
                current_progress_fingerprint: progress_overview.source_fingerprint.clone(),
                current_aggregate_sequence: progress_overview.aggregate_sequence,
                post_progress_fingerprint: post_progress.source_fingerprint.clone(),
                post_aggregate_sequence: post_progress.aggregate_sequence,
                journey_id: target.journey_id.clone(),
                session_id: target.session_id.clone(),
                source_drive_id: target.source_drive_id.clone(),
                task_id: target.expected_task_id.clone(),
                run_id: target.expected_run_id.clone(),
                proposal_id: target.expected_proposal_id.clone(),
                source_event_id: target.expected_source_event_id.clone(),
                source_event_kind: target.expected_source_event_kind.clone(),
                expected_authorization_preflight_fingerprint: target
                    .expected_authorization_preflight_fingerprint
                    .clone(),
                expected_preflight_snapshot_id: target.expected_preflight_snapshot_id.clone(),
                expected_apply_plan_id: target.expected_apply_plan_id.clone(),
                replacement_content_sha256,
                apply_fingerprint: apply_fingerprint.clone(),
                result: proposal_apply_result.clone(),
            },
        )
        .map_err(|error| error.to_string())?;
    let next_route = HeadlessContinueRoute {
        kind: HeadlessContinueRouteKind::VerifyObjectiveApplyExplicitly,
        reason: "Objective proposal apply completed with bounded apply result; verify the current target state."
            .to_string(),
        task_id: Some(target.expected_task_id.clone()),
        run_id: Some(target.expected_run_id.clone()),
        proposal_id: Some(target.expected_proposal_id.clone()),
        apply_id: Some(proposal_apply_result.apply_result.apply_id.clone()),
        failure_fingerprint: None,
        apply_fingerprint: Some(apply_fingerprint),
        progress_fingerprint: Some(post_progress.source_fingerprint.clone()),
        aggregate_sequence: Some(post_progress.aggregate_sequence),
        next_action: "verify_objective_apply".to_string(),
    };
    let next_action = next_route.next_action.clone();
    Ok(HeadlessContinueOnceResult {
        status: HeadlessContinueOnceStatus::TaskExecuted,
        decision_id: Some(decision_id),
        continuation_id: Some(continuation_id),
        selected_task_id: Some(selected_record.task_id),
        selected_run_id: Some(selected_record.run_id),
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
        proposal_apply_result: Some(proposal_apply_result),
        objective_proposal_authorization_preflight_result: None,
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
    })
}
