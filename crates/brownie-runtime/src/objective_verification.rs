use super::*;

fn validate_objective_apply_verification_target(
    target: &ObjectiveApplyVerificationTarget,
) -> Result<(), String> {
    if !target.authorize_objective_apply_verification {
        return Err("objective apply verification failed: authorization required".to_string());
    }
    if !is_valid_headless_continuation_id(&target.objective_apply_continuation_id) {
        return Err(
            "objective apply verification failed: objective_apply_continuation_id must be a valid continuation id"
                .to_string(),
        );
    }
    if !is_valid_headless_run_id(&target.journey_id)
        || !is_valid_headless_run_id(&target.session_id)
        || !is_valid_headless_run_id(&target.source_drive_id)
    {
        return Err(
            "objective apply verification failed: journey, session, and drive ids must be valid headless ids"
                .to_string(),
        );
    }
    for (field, value) in [
        (
            "expected_path_fingerprint",
            target.expected_path_fingerprint.as_str(),
        ),
        (
            "expected_apply_fingerprint",
            target.expected_apply_fingerprint.as_str(),
        ),
        (
            "expected_post_write_sha256",
            target.expected_post_write_sha256.as_str(),
        ),
    ] {
        if !is_sha256_fingerprint(value) {
            return Err(format!(
                "objective apply verification failed: {field} must be a sha256 fingerprint"
            ));
        }
    }
    if target
        .expected_objective_apply_decision_id
        .trim()
        .is_empty()
        || target.expected_task_id.trim().is_empty()
        || target.expected_run_id.trim().is_empty()
        || target.expected_proposal_id.trim().is_empty()
        || target.expected_apply_id.trim().is_empty()
    {
        return Err(
            "objective apply verification failed: decision, task, run, proposal, and apply ids are required"
                .to_string(),
        );
    }
    if target.expected_operation != WorkspacePatchOperation::ReplaceFile.as_str()
        || target.expected_apply_status != "Applied"
        || !target.expected_authorization_consumed
    {
        return Err(
            "objective apply verification failed: expected labels must describe a successful authorized replace_file apply"
                .to_string(),
        );
    }
    Ok(())
}

fn objective_apply_verification_request_fingerprint(
    params: &HeadlessContinueOnceParams,
) -> Result<String, String> {
    let target = params
        .objective_apply_verification_target
        .as_ref()
        .ok_or_else(|| "objective apply verification target missing".to_string())?;
    let continuation_id = params.continuation_id.as_deref().ok_or_else(|| {
        "objective apply verification failed: continuation_id is required".to_string()
    })?;
    let seed = json!({
        "route_kind": "objective_apply_verification",
        "continuation_id": continuation_id,
        "authorize": params.authorize,
        "expected_progress_fingerprint": params.expected_progress_fingerprint,
        "expected_aggregate_sequence": params.expected_aggregate_sequence,
        "authorize_objective_apply_verification": target.authorize_objective_apply_verification,
        "objective_apply_continuation_id": target.objective_apply_continuation_id,
        "expected_objective_apply_decision_id": target.expected_objective_apply_decision_id,
        "journey_id": target.journey_id,
        "session_id": target.session_id,
        "source_drive_id": target.source_drive_id,
        "expected_task_id": target.expected_task_id,
        "expected_run_id": target.expected_run_id,
        "expected_proposal_id": target.expected_proposal_id,
        "expected_apply_id": target.expected_apply_id,
        "expected_operation": target.expected_operation,
        "expected_apply_status": target.expected_apply_status,
        "expected_authorization_consumed": target.expected_authorization_consumed,
        "expected_path_fingerprint": target.expected_path_fingerprint,
        "expected_apply_fingerprint": target.expected_apply_fingerprint,
        "expected_post_write_sha256": target.expected_post_write_sha256,
    });
    Ok(format!(
        "sha256:{}",
        hex_sha256(seed.to_string().as_bytes())
    ))
}

fn validate_objective_apply_verification_replay_request(
    params: &HeadlessContinueOnceParams,
    checkpoint: &HeadlessObjectiveApplyVerificationCheckpoint,
) -> Result<(), String> {
    let current = objective_apply_verification_request_fingerprint(params)?;
    match checkpoint.request_fingerprint.as_deref() {
        Some(stored) if stored == current => Ok(()),
        Some(_) => Err(
            "invalid params: headless objective apply verification continuation request identity mismatch"
                .to_string(),
        ),
        None => Err(
            "invalid params: headless objective apply verification checkpoint is missing request identity fingerprint"
                .to_string(),
        ),
    }
}

fn validate_objective_apply_verification_route(
    store: &BrownieStore,
    target: &ObjectiveApplyVerificationTarget,
) -> Result<(HeadlessObjectiveProposalApplyCheckpoint, String), String> {
    let checkpoint = store
        .read_headless_objective_proposal_apply_checkpoint(&target.objective_apply_continuation_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| {
            "objective apply verification failed: objective apply checkpoint not found".to_string()
        })?;
    if checkpoint.decision_id != target.expected_objective_apply_decision_id {
        return Err(
            "objective apply verification failed: objective apply decision mismatch".to_string(),
        );
    }
    let apply = &checkpoint.result.apply_result;
    if checkpoint.journey_id != target.journey_id
        || checkpoint.session_id != target.session_id
        || checkpoint.source_drive_id != target.source_drive_id
        || checkpoint.task_id != target.expected_task_id
        || checkpoint.run_id != target.expected_run_id
        || checkpoint.proposal_id != target.expected_proposal_id
        || checkpoint.apply_fingerprint != target.expected_apply_fingerprint
        || apply.apply_id != target.expected_apply_id
        || apply.operation != target.expected_operation
        || apply.apply_status != target.expected_apply_status
        || apply.authorization_consumed != target.expected_authorization_consumed
        || apply.post_write_sha256.as_deref() != Some(target.expected_post_write_sha256.as_str())
        || apply.path != checkpoint.result.proposal.path
    {
        return Err("objective apply verification failed: apply evidence mismatch".to_string());
    }
    if !apply.applied || !apply.failed_checks.is_empty() || !apply.blocked_checks.is_empty() {
        return Err(
            "objective apply verification failed: apply result is not a clean success".to_string(),
        );
    }
    let actual_path_fingerprint = format!("sha256:{}", hex_sha256(apply.path.as_bytes()));
    if actual_path_fingerprint != target.expected_path_fingerprint {
        return Err("objective apply verification failed: path fingerprint mismatch".to_string());
    }
    let target_path = resolve_apply_target_path(store, &checkpoint.result.proposal)
        .map_err(|reason| format!("objective apply verification failed: {reason}"))?;
    let bytes = fs::read(&target_path).map_err(|_| {
        "objective apply verification failed: target file is not readable".to_string()
    })?;
    let current_target_sha256 = format!("sha256:{}", hex_sha256(&bytes));
    Ok((checkpoint, current_target_sha256))
}

pub(super) fn handle_headless_continue_objective_apply_verification(
    id: Value,
    store: &BrownieStore,
    progress_overview: &TaskListProgressOverview,
    params: HeadlessContinueOnceParams,
) -> JsonRpcResponse<Value> {
    let result =
        match headless_continue_objective_apply_verification(store, progress_overview, &params) {
            Ok(result) => result,
            Err(message) => return error_response(id, -32602, &message),
        };
    result_response(id, json!(result))
}

pub(super) fn headless_continue_objective_apply_verification_replay_result(
    id: Value,
    progress_overview: &TaskListProgressOverview,
    params: HeadlessContinueOnceParams,
    checkpoint: HeadlessObjectiveApplyVerificationCheckpoint,
) -> JsonRpcResponse<Value> {
    if let Err(message) = validate_objective_apply_verification_replay_request(&params, &checkpoint)
    {
        return error_response(id, -32602, &message);
    }
    let next_route = HeadlessContinueRoute {
        kind: checkpoint.route_kind.clone(),
        reason: "Objective apply verification was already completed by this continuation; replaying bounded verification route."
            .to_string(),
        task_id: Some(checkpoint.task_id.clone()),
        run_id: Some(checkpoint.run_id.clone()),
        proposal_id: Some(checkpoint.proposal_id.clone()),
        apply_id: Some(checkpoint.apply_id.clone()),
        failure_fingerprint: if checkpoint.verification_status == "mismatch" {
            Some(checkpoint.expected_apply_fingerprint.clone())
        } else {
            None
        },
        apply_fingerprint: Some(checkpoint.expected_apply_fingerprint.clone()),
        progress_fingerprint: Some(progress_overview.source_fingerprint.clone()),
        aggregate_sequence: Some(progress_overview.aggregate_sequence),
        next_action: checkpoint.next_action.clone(),
    };
    let next_action = next_route.next_action.clone();
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
            proposal_apply_result: None,
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
        }),
    )
}

fn headless_continue_objective_apply_verification(
    store: &BrownieStore,
    progress_overview: &TaskListProgressOverview,
    params: &HeadlessContinueOnceParams,
) -> Result<HeadlessContinueOnceResult, String> {
    let target = params
        .objective_apply_verification_target
        .as_ref()
        .ok_or_else(|| "objective apply verification target missing".to_string())?;
    validate_objective_apply_verification_target(target)?;
    let continuation_id = params.continuation_id.clone().ok_or_else(|| {
        "objective apply verification failed: continuation_id is required".to_string()
    })?;
    let request_fingerprint = objective_apply_verification_request_fingerprint(params)?;
    let (apply_checkpoint, current_target_sha256) =
        validate_objective_apply_verification_route(store, target)?;
    let selected_record = store
        .tasks()
        .get_task(&target.expected_task_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "objective apply verification failed: source task not found".to_string())?;
    if selected_record.run_id != target.expected_run_id {
        return Err("objective apply verification failed: source task/run mismatch".to_string());
    }
    let verification_status = if current_target_sha256 == target.expected_post_write_sha256 {
        "verified"
    } else {
        "mismatch"
    };
    let (route_kind, next_action, route_reason) = if verification_status == "verified" {
        (
            HeadlessContinueRouteKind::AcceptObjectiveCompletionExplicitly,
            "accept_objective_completion",
            "Objective apply verification matched the current target hash; proceed to accepted completion boundary.",
        )
    } else {
        (
            HeadlessContinueRouteKind::StartVerificationRecoveryExplicitly,
            "start_verification_recovery",
            "Objective apply verification found a current target hash mismatch; start verification recovery explicitly.",
        )
    };
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
                "authorize_objective_apply_verification": true,
                "objective_apply_continuation_id": target.objective_apply_continuation_id.clone(),
                "objective_apply_decision_id": apply_checkpoint.decision_id.clone(),
                "journey_id": target.journey_id.clone(),
                "session_id": target.session_id.clone(),
                "source_drive_id": target.source_drive_id.clone(),
                "proposal_id": target.expected_proposal_id.clone(),
                "apply_id": target.expected_apply_id.clone(),
                "operation": target.expected_operation.clone(),
                "path_fingerprint": target.expected_path_fingerprint.clone(),
                "expected_apply_fingerprint": target.expected_apply_fingerprint.clone(),
                "expected_post_write_sha256": target.expected_post_write_sha256.clone(),
                "current_target_sha256": current_target_sha256.clone(),
                "verification_status": verification_status,
                "next_action": next_action,
                "reason": route_reason
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
        .write_headless_objective_apply_verification_checkpoint(
            &HeadlessObjectiveApplyVerificationCheckpoint {
                continuation_id: continuation_id.clone(),
                decision_id: decision_id.clone(),
                request_fingerprint: Some(request_fingerprint),
                objective_apply_continuation_id: target.objective_apply_continuation_id.clone(),
                expected_objective_apply_decision_id: target
                    .expected_objective_apply_decision_id
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
                apply_id: target.expected_apply_id.clone(),
                expected_path_fingerprint: target.expected_path_fingerprint.clone(),
                expected_apply_fingerprint: target.expected_apply_fingerprint.clone(),
                expected_post_write_sha256: target.expected_post_write_sha256.clone(),
                current_target_sha256: current_target_sha256.clone(),
                verification_status: verification_status.to_string(),
                route_kind: route_kind.clone(),
                next_action: next_action.to_string(),
            },
        )
        .map_err(|error| error.to_string())?;
    let next_route = HeadlessContinueRoute {
        kind: route_kind,
        reason: route_reason.to_string(),
        task_id: Some(target.expected_task_id.clone()),
        run_id: Some(target.expected_run_id.clone()),
        proposal_id: Some(target.expected_proposal_id.clone()),
        apply_id: Some(target.expected_apply_id.clone()),
        failure_fingerprint: if verification_status == "mismatch" {
            Some(target.expected_apply_fingerprint.clone())
        } else {
            None
        },
        apply_fingerprint: Some(target.expected_apply_fingerprint.clone()),
        progress_fingerprint: Some(post_progress.source_fingerprint.clone()),
        aggregate_sequence: Some(post_progress.aggregate_sequence),
        next_action: next_action.to_string(),
    };
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
        proposal_apply_result: None,
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
        next_action: next_action.to_string(),
    })
}

fn validate_objective_completion_acceptance_target(
    target: &ObjectiveCompletionAcceptanceTarget,
) -> Result<(), String> {
    if !target.authorize_objective_completion_acceptance {
        return Err("objective completion acceptance failed: authorization required".to_string());
    }
    if !is_valid_headless_continuation_id(&target.objective_apply_verification_continuation_id) {
        return Err(
            "objective completion acceptance failed: objective_apply_verification_continuation_id must be a valid continuation id"
                .to_string(),
        );
    }
    if !is_valid_headless_run_id(&target.journey_id)
        || !is_valid_headless_run_id(&target.session_id)
        || !is_valid_headless_run_id(&target.source_drive_id)
    {
        return Err(
            "objective completion acceptance failed: journey, session, and drive ids must be valid headless ids"
                .to_string(),
        );
    }
    for (field, value) in [
        (
            "expected_path_fingerprint",
            target.expected_path_fingerprint.as_str(),
        ),
        (
            "expected_apply_fingerprint",
            target.expected_apply_fingerprint.as_str(),
        ),
        (
            "expected_post_write_sha256",
            target.expected_post_write_sha256.as_str(),
        ),
        (
            "expected_current_target_sha256",
            target.expected_current_target_sha256.as_str(),
        ),
        (
            "expected_verification_fingerprint",
            target.expected_verification_fingerprint.as_str(),
        ),
    ] {
        if !is_sha256_fingerprint(value) {
            return Err(format!(
                "objective completion acceptance failed: {field} must be a sha256 fingerprint"
            ));
        }
    }
    if target
        .expected_objective_apply_verification_decision_id
        .trim()
        .is_empty()
        || target.expected_task_id.trim().is_empty()
        || target.expected_run_id.trim().is_empty()
        || target.expected_proposal_id.trim().is_empty()
        || target.expected_apply_id.trim().is_empty()
    {
        return Err(
            "objective completion acceptance failed: decision, task, run, proposal, and apply ids are required"
                .to_string(),
        );
    }
    if target.expected_operation != WorkspacePatchOperation::ReplaceFile.as_str()
        || target.expected_apply_status != "Applied"
        || !target.expected_authorization_consumed
        || target.expected_verification_status != "verified"
        || target.expected_verification_route_kind
            != HeadlessContinueRouteKind::AcceptObjectiveCompletionExplicitly
    {
        return Err(
            "objective completion acceptance failed: expected labels must describe a verified objective replace_file apply"
                .to_string(),
        );
    }
    Ok(())
}

fn objective_completion_acceptance_request_fingerprint(
    params: &HeadlessContinueOnceParams,
) -> Result<String, String> {
    let target = params
        .objective_completion_acceptance_target
        .as_ref()
        .ok_or_else(|| "objective completion acceptance target missing".to_string())?;
    let continuation_id = params.continuation_id.as_deref().ok_or_else(|| {
        "objective completion acceptance failed: continuation_id is required".to_string()
    })?;
    let seed = json!({
        "route_kind": "objective_completion_acceptance",
        "continuation_id": continuation_id,
        "authorize": params.authorize,
        "expected_progress_fingerprint": params.expected_progress_fingerprint,
        "expected_aggregate_sequence": params.expected_aggregate_sequence,
        "authorize_objective_completion_acceptance": target.authorize_objective_completion_acceptance,
        "objective_apply_verification_continuation_id": target.objective_apply_verification_continuation_id,
        "expected_objective_apply_verification_decision_id": target.expected_objective_apply_verification_decision_id,
        "journey_id": target.journey_id,
        "session_id": target.session_id,
        "source_drive_id": target.source_drive_id,
        "expected_task_id": target.expected_task_id,
        "expected_run_id": target.expected_run_id,
        "expected_proposal_id": target.expected_proposal_id,
        "expected_apply_id": target.expected_apply_id,
        "expected_operation": target.expected_operation,
        "expected_apply_status": target.expected_apply_status,
        "expected_authorization_consumed": target.expected_authorization_consumed,
        "expected_path_fingerprint": target.expected_path_fingerprint,
        "expected_apply_fingerprint": target.expected_apply_fingerprint,
        "expected_post_write_sha256": target.expected_post_write_sha256,
        "expected_current_target_sha256": target.expected_current_target_sha256,
        "expected_verification_status": target.expected_verification_status,
        "expected_verification_route_kind": target.expected_verification_route_kind,
        "expected_verification_fingerprint": target.expected_verification_fingerprint,
    });
    Ok(format!(
        "sha256:{}",
        hex_sha256(seed.to_string().as_bytes())
    ))
}

fn validate_objective_completion_acceptance_replay_request(
    params: &HeadlessContinueOnceParams,
    checkpoint: &HeadlessObjectiveCompletionAcceptanceCheckpoint,
) -> Result<(), String> {
    let current = objective_completion_acceptance_request_fingerprint(params)?;
    match checkpoint.request_fingerprint.as_deref() {
        Some(stored) if stored == current => Ok(()),
        Some(_) => Err(
            "invalid params: headless objective completion acceptance continuation request identity mismatch"
                .to_string(),
        ),
        None => Err(
            "invalid params: headless objective completion acceptance checkpoint is missing request identity fingerprint"
                .to_string(),
        ),
    }
}

fn validate_objective_completion_acceptance_route(
    store: &BrownieStore,
    target: &ObjectiveCompletionAcceptanceTarget,
) -> Result<HeadlessObjectiveApplyVerificationCheckpoint, String> {
    let checkpoint = store
        .read_headless_objective_apply_verification_checkpoint(
            &target.objective_apply_verification_continuation_id,
        )
        .map_err(|error| error.to_string())?
        .ok_or_else(|| {
            "objective completion acceptance failed: objective apply verification checkpoint not found"
                .to_string()
        })?;
    if checkpoint.decision_id != target.expected_objective_apply_verification_decision_id {
        return Err(
            "objective completion acceptance failed: objective apply verification decision mismatch"
                .to_string(),
        );
    }
    if checkpoint.journey_id != target.journey_id
        || checkpoint.session_id != target.session_id
        || checkpoint.source_drive_id != target.source_drive_id
        || checkpoint.task_id != target.expected_task_id
        || checkpoint.run_id != target.expected_run_id
        || checkpoint.proposal_id != target.expected_proposal_id
        || checkpoint.apply_id != target.expected_apply_id
        || checkpoint.expected_path_fingerprint != target.expected_path_fingerprint
        || checkpoint.expected_apply_fingerprint != target.expected_apply_fingerprint
        || checkpoint.expected_post_write_sha256 != target.expected_post_write_sha256
        || checkpoint.current_target_sha256 != target.expected_current_target_sha256
        || checkpoint.verification_status != target.expected_verification_status
        || checkpoint.route_kind != target.expected_verification_route_kind
        || checkpoint.request_fingerprint.as_deref()
            != Some(target.expected_verification_fingerprint.as_str())
    {
        return Err(
            "objective completion acceptance failed: verification evidence mismatch".to_string(),
        );
    }
    if checkpoint.verification_status != "verified"
        || checkpoint.route_kind != HeadlessContinueRouteKind::AcceptObjectiveCompletionExplicitly
        || checkpoint.next_action != "accept_objective_completion"
    {
        return Err(
            "objective completion acceptance failed: verification route is not eligible for completion acceptance"
                .to_string(),
        );
    }
    Ok(checkpoint)
}

pub(super) fn handle_headless_continue_objective_completion_acceptance(
    id: Value,
    store: &BrownieStore,
    progress_overview: &TaskListProgressOverview,
    params: HeadlessContinueOnceParams,
) -> JsonRpcResponse<Value> {
    let result = match headless_continue_objective_completion_acceptance(
        store,
        progress_overview,
        &params,
    ) {
        Ok(result) => result,
        Err(message) => return error_response(id, -32602, &message),
    };
    result_response(id, json!(result))
}

pub(super) fn headless_continue_objective_completion_acceptance_replay_result(
    id: Value,
    progress_overview: &TaskListProgressOverview,
    params: HeadlessContinueOnceParams,
    checkpoint: HeadlessObjectiveCompletionAcceptanceCheckpoint,
) -> JsonRpcResponse<Value> {
    if let Err(message) =
        validate_objective_completion_acceptance_replay_request(&params, &checkpoint)
    {
        return error_response(id, -32602, &message);
    }
    let next_route = HeadlessContinueRoute {
        kind: checkpoint.route_kind.clone(),
        reason:
            "Objective completion was already accepted by this continuation; replaying bounded acceptance route."
                .to_string(),
        task_id: Some(checkpoint.task_id.clone()),
        run_id: Some(checkpoint.run_id.clone()),
        proposal_id: Some(checkpoint.proposal_id.clone()),
        apply_id: Some(checkpoint.apply_id.clone()),
        failure_fingerprint: None,
        apply_fingerprint: Some(checkpoint.expected_apply_fingerprint.clone()),
        progress_fingerprint: Some(progress_overview.source_fingerprint.clone()),
        aggregate_sequence: Some(progress_overview.aggregate_sequence),
        next_action: checkpoint.next_action.clone(),
    };
    let next_action = next_route.next_action.clone();
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
            proposal_apply_result: None,
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
        }),
    )
}

fn headless_continue_objective_completion_acceptance(
    store: &BrownieStore,
    progress_overview: &TaskListProgressOverview,
    params: &HeadlessContinueOnceParams,
) -> Result<HeadlessContinueOnceResult, String> {
    let target = params
        .objective_completion_acceptance_target
        .as_ref()
        .ok_or_else(|| "objective completion acceptance target missing".to_string())?;
    validate_objective_completion_acceptance_target(target)?;
    let continuation_id = params.continuation_id.clone().ok_or_else(|| {
        "objective completion acceptance failed: continuation_id is required".to_string()
    })?;
    let request_fingerprint = objective_completion_acceptance_request_fingerprint(params)?;
    let verification_checkpoint = validate_objective_completion_acceptance_route(store, target)?;
    let selected_record = store
        .tasks()
        .get_task(&target.expected_task_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| {
            "objective completion acceptance failed: source task not found".to_string()
        })?;
    if selected_record.run_id != target.expected_run_id {
        return Err("objective completion acceptance failed: source task/run mismatch".to_string());
    }
    let decision_id = format!("headless_decision_{}", uuid::Uuid::new_v4().simple());
    let policy_version = "headless_continue_once_v1";
    let next_action = "close_headless_run";
    let route_reason =
        "Objective apply verification was accepted as completed; close the Golden Journey explicitly.";
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
                "authorize_objective_completion_acceptance": true,
                "objective_apply_verification_continuation_id": target.objective_apply_verification_continuation_id.clone(),
                "objective_apply_verification_decision_id": verification_checkpoint.decision_id.clone(),
                "journey_id": target.journey_id.clone(),
                "session_id": target.session_id.clone(),
                "source_drive_id": target.source_drive_id.clone(),
                "proposal_id": target.expected_proposal_id.clone(),
                "apply_id": target.expected_apply_id.clone(),
                "operation": target.expected_operation.clone(),
                "path_fingerprint": target.expected_path_fingerprint.clone(),
                "expected_apply_fingerprint": target.expected_apply_fingerprint.clone(),
                "expected_post_write_sha256": target.expected_post_write_sha256.clone(),
                "expected_current_target_sha256": target.expected_current_target_sha256.clone(),
                "expected_verification_fingerprint": target.expected_verification_fingerprint.clone(),
                "acceptance_status": "accepted",
                "next_action": next_action,
                "reason": route_reason
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
        .write_headless_objective_completion_acceptance_checkpoint(
            &HeadlessObjectiveCompletionAcceptanceCheckpoint {
                continuation_id: continuation_id.clone(),
                decision_id: decision_id.clone(),
                request_fingerprint: Some(request_fingerprint),
                objective_apply_verification_continuation_id: target
                    .objective_apply_verification_continuation_id
                    .clone(),
                expected_objective_apply_verification_decision_id: target
                    .expected_objective_apply_verification_decision_id
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
                apply_id: target.expected_apply_id.clone(),
                expected_path_fingerprint: target.expected_path_fingerprint.clone(),
                expected_apply_fingerprint: target.expected_apply_fingerprint.clone(),
                expected_post_write_sha256: target.expected_post_write_sha256.clone(),
                expected_current_target_sha256: target.expected_current_target_sha256.clone(),
                expected_verification_fingerprint: target.expected_verification_fingerprint.clone(),
                acceptance_status: "accepted".to_string(),
                route_kind: HeadlessContinueRouteKind::RefreshProgressOverview,
                next_action: next_action.to_string(),
            },
        )
        .map_err(|error| error.to_string())?;
    let next_route = HeadlessContinueRoute {
        kind: HeadlessContinueRouteKind::RefreshProgressOverview,
        reason: route_reason.to_string(),
        task_id: Some(target.expected_task_id.clone()),
        run_id: Some(target.expected_run_id.clone()),
        proposal_id: Some(target.expected_proposal_id.clone()),
        apply_id: Some(target.expected_apply_id.clone()),
        failure_fingerprint: None,
        apply_fingerprint: Some(target.expected_apply_fingerprint.clone()),
        progress_fingerprint: Some(post_progress.source_fingerprint.clone()),
        aggregate_sequence: Some(post_progress.aggregate_sequence),
        next_action: next_action.to_string(),
    };
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
        proposal_apply_result: None,
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
        next_action: next_action.to_string(),
    })
}
