use super::*;

pub(super) fn handle_headless_continue_modepack_registry_update_selection(
    id: Value,
    store: &BrownieStore,
    progress_overview: &TaskListProgressOverview,
    params: HeadlessContinueOnceParams,
) -> JsonRpcResponse<Value> {
    let result = match headless_continue_modepack_registry_update_selection(
        store,
        progress_overview,
        &params,
    ) {
        Ok(result) => result,
        Err(message) => return error_response(id, -32603, &format!("internal error: {message}")),
    };
    result_response(id, json!(result))
}

pub(super) fn headless_continue_modepack_registry_update_selection_replay_result(
    id: Value,
    progress_overview: &TaskListProgressOverview,
    params: HeadlessContinueOnceParams,
    checkpoint: HeadlessModePackRegistryUpdateSelectionCheckpoint,
) -> JsonRpcResponse<Value> {
    if let Err(message) =
        validate_headless_modepack_registry_update_selection_replay_request(&params, &checkpoint)
    {
        return error_response(id, -32602, &message);
    }
    let mut selection_result = checkpoint.result;
    selection_result.selected = false;
    selection_result.replayed = true;
    selection_result.next_action = "fetch_selected_modepack_candidate_explicitly".to_string();
    let next_route = HeadlessContinueRoute {
        kind: HeadlessContinueRouteKind::FetchSelectedModePackCandidateExplicitly,
        reason: "Registry update selection was already executed by this continuation; replaying bounded selection result.".to_string(),
        task_id: None,
        run_id: None,
        proposal_id: None,
        apply_id: None,
        failure_fingerprint: None,
        apply_fingerprint: None,
        progress_fingerprint: Some(progress_overview.source_fingerprint.clone()),
        aggregate_sequence: Some(progress_overview.aggregate_sequence),
        next_action: "fetch_selected_modepack_candidate_explicitly".to_string(),
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
            objective_proposal_authorization_preflight_result: None,
            objective_apply_verification_result: None,
            objective_completion_acceptance_result: None,
            llm_provider_failure_retry_admission: None,
            product_continuation_admission: None,
            modepack_select_registry_update_result: Some(selection_result),
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
            next_action: "fetch_selected_modepack_candidate_explicitly".to_string(),
        }),
    )
}

pub(super) fn headless_modepack_registry_update_selection_request_fingerprint(
    params: &HeadlessContinueOnceParams,
) -> Result<String, String> {
    let target = params
        .modepack_registry_update_selection_target
        .as_ref()
        .ok_or_else(|| "modepack registry update selection target missing".to_string())?;
    let continuation_id = params.continuation_id.as_deref().ok_or_else(|| {
        "modepack registry update selection failed: continuation_id is required".to_string()
    })?;
    let seed = json!({
        "route_kind": "modepack_registry_update_selection",
        "continuation_id": continuation_id,
        "authorize": params.authorize,
        "authorize_modepack_registry_update_selection": target.authorize_modepack_registry_update_selection,
        "authorize_registry_trust": target.authorize_registry_trust,
        "expected_progress_fingerprint": params.expected_progress_fingerprint,
        "expected_aggregate_sequence": params.expected_aggregate_sequence,
        "registry_url": target.registry_url,
        "expected_registry_manifest_sha256": target.expected_registry_manifest_sha256,
        "expected_current_activation_fingerprint": target.expected_current_activation_fingerprint,
        "expected_registry_provenance_statement_sha256": target.expected_registry_provenance_statement_sha256,
        "expected_registry_signer_fingerprint": target.expected_registry_signer_fingerprint,
        "expected_registry_trusted_signer_trust_id": target.expected_registry_trusted_signer_trust_id,
        "expected_registry_trusted_signer_event_id": target.expected_registry_trusted_signer_event_id,
        "registry_provenance_statement_sha256": format!("sha256:{}", hex_sha256(target.registry_provenance_statement_json.as_bytes())),
        "registry_provenance_signature_sha256": format!("sha256:{}", hex_sha256(target.registry_provenance_signature_base64.as_bytes())),
        "registry_provenance_public_key_sha256": format!("sha256:{}", hex_sha256(target.registry_provenance_public_key_base64.as_bytes())),
    });
    Ok(format!(
        "sha256:{}",
        hex_sha256(seed.to_string().as_bytes())
    ))
}

pub(super) fn validate_headless_modepack_registry_update_selection_replay_request(
    params: &HeadlessContinueOnceParams,
    checkpoint: &HeadlessModePackRegistryUpdateSelectionCheckpoint,
) -> Result<(), String> {
    let current = headless_modepack_registry_update_selection_request_fingerprint(params)?;
    match checkpoint.request_fingerprint.as_deref() {
        Some(stored) if stored == current => Ok(()),
        Some(_) => Err(
            "invalid params: headless registry update selection continuation request identity mismatch"
                .to_string(),
        ),
        None => Err(
            "invalid params: headless registry update selection checkpoint is missing request identity fingerprint"
                .to_string(),
        ),
    }
}

pub(super) fn validate_modepack_registry_update_selection_target(
    target: &ModePackRegistryUpdateSelectionTarget,
) -> Result<(), String> {
    for (field, value) in [
        (
            "expected_registry_manifest_sha256",
            target.expected_registry_manifest_sha256.as_str(),
        ),
        (
            "expected_current_activation_fingerprint",
            target.expected_current_activation_fingerprint.as_str(),
        ),
        (
            "expected_registry_provenance_statement_sha256",
            target
                .expected_registry_provenance_statement_sha256
                .as_str(),
        ),
        (
            "expected_registry_signer_fingerprint",
            target.expected_registry_signer_fingerprint.as_str(),
        ),
    ] {
        if !is_sha256_fingerprint(value) {
            return Err(format!(
                "modepack registry update selection failed: {field} must be a sha256 fingerprint"
            ));
        }
    }
    if target
        .expected_registry_trusted_signer_trust_id
        .trim()
        .is_empty()
        || target
            .expected_registry_trusted_signer_event_id
            .trim()
            .is_empty()
    {
        return Err(
            "modepack registry update selection failed: registry trusted signer handles are required"
                .to_string(),
        );
    }
    Ok(())
}

pub(super) fn headless_continue_modepack_registry_update_selection(
    store: &BrownieStore,
    progress_overview: &TaskListProgressOverview,
    params: &HeadlessContinueOnceParams,
) -> Result<HeadlessContinueOnceResult, String> {
    #[cfg(test)]
    if headless_run_modepack_test_fetch_queue_is_configured() {
        return headless_continue_modepack_registry_update_selection_with_resolver(
            store,
            progress_overview,
            params,
            test_modepack_dns_resolver,
            fetch_headless_run_modepack_test_response,
        );
    }
    headless_continue_modepack_registry_update_selection_with_resolver(
        store,
        progress_overview,
        params,
        default_modepack_dns_resolver,
        fetch_modepack_url,
    )
}

pub(super) fn headless_continue_modepack_registry_update_selection_with_resolver<R, F>(
    store: &BrownieStore,
    progress_overview: &TaskListProgressOverview,
    params: &HeadlessContinueOnceParams,
    resolver: R,
    fetcher: F,
) -> Result<HeadlessContinueOnceResult, String>
where
    R: FnOnce(&str) -> Result<Vec<SocketAddr>, String>,
    F: FnOnce(&RemoteModePackFetchBinding) -> Result<RemoteModePackFetchResponse, String>,
{
    let target = params
        .modepack_registry_update_selection_target
        .as_ref()
        .ok_or_else(|| "modepack registry update selection target missing".to_string())?;
    if !target.authorize_modepack_registry_update_selection {
        return Err(
            "modepack registry update selection failed: authorization required".to_string(),
        );
    }
    validate_modepack_registry_update_selection_target(target)?;
    let continuation_id = params.continuation_id.clone().ok_or_else(|| {
        "modepack registry update selection failed: continuation_id is required".to_string()
    })?;
    let request_fingerprint =
        headless_modepack_registry_update_selection_request_fingerprint(params)?;
    let selection_result = select_modepack_registry_update_with_resolver(
        store,
        &ModePackSelectRegistryUpdateParams {
            authorize_registry_selection: target.authorize_modepack_registry_update_selection,
            authorize_registry_trust: target.authorize_registry_trust,
            registry_url: target.registry_url.clone(),
            expected_registry_manifest_sha256: target.expected_registry_manifest_sha256.clone(),
            expected_current_activation_fingerprint: target
                .expected_current_activation_fingerprint
                .clone(),
            expected_registry_provenance_statement_sha256: target
                .expected_registry_provenance_statement_sha256
                .clone(),
            expected_registry_signer_fingerprint: target
                .expected_registry_signer_fingerprint
                .clone(),
            expected_registry_trusted_signer_trust_id: target
                .expected_registry_trusted_signer_trust_id
                .clone(),
            expected_registry_trusted_signer_event_id: target
                .expected_registry_trusted_signer_event_id
                .clone(),
            registry_provenance_statement_json: target.registry_provenance_statement_json.clone(),
            registry_provenance_signature_base64: target
                .registry_provenance_signature_base64
                .clone(),
            registry_provenance_public_key_base64: target
                .registry_provenance_public_key_base64
                .clone(),
        },
        resolver,
        fetcher,
    )?;
    let post_tasks = store
        .tasks()
        .list_tasks()
        .map_err(|error| error.to_string())?;
    let post_progress = task_list_progress_overview(store, &post_tasks)?;
    let decision_id = format!("headless_decision_{}", uuid::Uuid::new_v4().simple());
    store
        .write_headless_modepack_registry_update_selection_checkpoint(
            &HeadlessModePackRegistryUpdateSelectionCheckpoint {
                continuation_id: continuation_id.clone(),
                decision_id: decision_id.clone(),
                request_fingerprint: Some(request_fingerprint),
                expected_progress_fingerprint: params.expected_progress_fingerprint.clone(),
                expected_aggregate_sequence: params.expected_aggregate_sequence,
                current_progress_fingerprint: progress_overview.source_fingerprint.clone(),
                current_aggregate_sequence: progress_overview.aggregate_sequence,
                post_progress_fingerprint: post_progress.source_fingerprint.clone(),
                post_aggregate_sequence: post_progress.aggregate_sequence,
                expected_current_activation_fingerprint: target
                    .expected_current_activation_fingerprint
                    .clone(),
                expected_registry_manifest_sha256: target.expected_registry_manifest_sha256.clone(),
                expected_registry_provenance_statement_sha256: target
                    .expected_registry_provenance_statement_sha256
                    .clone(),
                expected_registry_signer_fingerprint: target
                    .expected_registry_signer_fingerprint
                    .clone(),
                selection_id: selection_result.selection.selection_id.clone(),
                selection_event_id: selection_result.selection.selection_event_id.clone(),
                result: selection_result.clone(),
            },
        )
        .map_err(|error| error.to_string())?;
    let next_route = HeadlessContinueRoute {
        kind: HeadlessContinueRouteKind::FetchSelectedModePackCandidateExplicitly,
        reason: "Selected a trusted registry update candidate; fetching the selected candidate remains an explicit next step.".to_string(),
        task_id: None,
        run_id: None,
        proposal_id: None,
        apply_id: None,
        failure_fingerprint: None,
        apply_fingerprint: None,
        progress_fingerprint: Some(post_progress.source_fingerprint.clone()),
        aggregate_sequence: Some(post_progress.aggregate_sequence),
        next_action: "fetch_selected_modepack_candidate_explicitly".to_string(),
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
        objective_proposal_authorization_preflight_result: None,
        objective_apply_verification_result: None,
        objective_completion_acceptance_result: None,
        llm_provider_failure_retry_admission: None,
        product_continuation_admission: None,
        modepack_select_registry_update_result: Some(selection_result),
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
        next_action: "fetch_selected_modepack_candidate_explicitly".to_string(),
    })
}

pub(super) fn handle_headless_continue_modepack_selected_candidate_fetch(
    id: Value,
    store: &BrownieStore,
    progress_overview: &TaskListProgressOverview,
    params: HeadlessContinueOnceParams,
) -> JsonRpcResponse<Value> {
    let result = match headless_continue_modepack_selected_candidate_fetch(
        store,
        progress_overview,
        &params,
    ) {
        Ok(result) => result,
        Err(message) => return error_response(id, -32603, &format!("internal error: {message}")),
    };
    result_response(id, json!(result))
}

pub(super) fn headless_continue_modepack_selected_candidate_fetch_replay_result(
    id: Value,
    progress_overview: &TaskListProgressOverview,
    params: HeadlessContinueOnceParams,
    checkpoint: HeadlessModePackSelectedCandidateFetchCheckpoint,
) -> JsonRpcResponse<Value> {
    if let Err(message) =
        validate_headless_modepack_selected_candidate_fetch_replay_request(&params, &checkpoint)
    {
        return error_response(id, -32602, &message);
    }
    let mut fetch_result = checkpoint.result;
    fetch_result.fetched = false;
    fetch_result.replayed = true;
    let next_route = HeadlessContinueRoute {
        kind: HeadlessContinueRouteKind::VerifySelectedModePackCandidateProvenanceExplicitly,
        reason: "Registry-selected Mode Pack candidate was already fetched by this continuation; replaying bounded candidate fetch result.".to_string(),
        task_id: None,
        run_id: None,
        proposal_id: None,
        apply_id: None,
        failure_fingerprint: None,
        apply_fingerprint: None,
        progress_fingerprint: Some(progress_overview.source_fingerprint.clone()),
        aggregate_sequence: Some(progress_overview.aggregate_sequence),
        next_action: "verify_selected_modepack_candidate_provenance_explicitly".to_string(),
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
            objective_proposal_authorization_preflight_result: None,
            objective_apply_verification_result: None,
            objective_completion_acceptance_result: None,
            llm_provider_failure_retry_admission: None,
            product_continuation_admission: None,
            modepack_select_registry_update_result: None,
            modepack_fetch_candidate_result: Some(fetch_result),
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
            next_action: "verify_selected_modepack_candidate_provenance_explicitly".to_string(),
        }),
    )
}

pub(super) fn headless_modepack_selected_candidate_fetch_request_fingerprint(
    params: &HeadlessContinueOnceParams,
) -> Result<String, String> {
    let target = params
        .modepack_selected_candidate_fetch_target
        .as_ref()
        .ok_or_else(|| "modepack selected candidate fetch target missing".to_string())?;
    let continuation_id = params.continuation_id.as_deref().ok_or_else(|| {
        "modepack selected candidate fetch failed: continuation_id is required".to_string()
    })?;
    let seed = json!({
        "route_kind": "modepack_selected_candidate_fetch",
        "continuation_id": continuation_id,
        "authorize": params.authorize,
        "authorize_selected_candidate_fetch": target.authorize_selected_candidate_fetch,
        "expected_progress_fingerprint": params.expected_progress_fingerprint,
        "expected_aggregate_sequence": params.expected_aggregate_sequence,
        "selection_id": target.selection_id,
        "selection_event_id": target.selection_event_id,
        "expected_registry_manifest_sha256": target.expected_registry_manifest_sha256,
        "expected_candidate_url_fingerprint": target.expected_candidate_url_fingerprint,
        "expected_candidate_content_sha256": target.expected_candidate_content_sha256,
        "expected_candidate_compiled_policy_fingerprint": target.expected_candidate_compiled_policy_fingerprint,
        "expected_provenance_statement_url_fingerprint": target.expected_provenance_statement_url_fingerprint,
        "expected_provenance_statement_sha256": target.expected_provenance_statement_sha256,
        "expected_signer_fingerprint": target.expected_signer_fingerprint,
        "expected_current_activation_fingerprint": target.expected_current_activation_fingerprint,
    });
    Ok(format!(
        "sha256:{}",
        hex_sha256(seed.to_string().as_bytes())
    ))
}

pub(super) fn validate_headless_modepack_selected_candidate_fetch_replay_request(
    params: &HeadlessContinueOnceParams,
    checkpoint: &HeadlessModePackSelectedCandidateFetchCheckpoint,
) -> Result<(), String> {
    let current = headless_modepack_selected_candidate_fetch_request_fingerprint(params)?;
    match checkpoint.request_fingerprint.as_deref() {
        Some(stored) if stored == current => Ok(()),
        Some(_) => Err(
            "invalid params: headless selected candidate fetch continuation request identity mismatch"
                .to_string(),
        ),
        None => Err(
            "invalid params: headless selected candidate fetch checkpoint is missing request identity fingerprint"
                .to_string(),
        ),
    }
}

pub(super) fn headless_continue_modepack_selected_candidate_fetch(
    store: &BrownieStore,
    progress_overview: &TaskListProgressOverview,
    params: &HeadlessContinueOnceParams,
) -> Result<HeadlessContinueOnceResult, String> {
    #[cfg(test)]
    if headless_run_modepack_test_fetch_queue_is_configured() {
        return headless_continue_modepack_selected_candidate_fetch_with_resolver(
            store,
            progress_overview,
            params,
            test_modepack_dns_resolver,
            fetch_headless_run_modepack_test_response,
        );
    }
    headless_continue_modepack_selected_candidate_fetch_with_resolver(
        store,
        progress_overview,
        params,
        default_modepack_dns_resolver,
        fetch_modepack_url,
    )
}

pub(super) fn headless_continue_modepack_selected_candidate_fetch_with_resolver<R, F>(
    store: &BrownieStore,
    progress_overview: &TaskListProgressOverview,
    params: &HeadlessContinueOnceParams,
    resolver: R,
    mut fetcher: F,
) -> Result<HeadlessContinueOnceResult, String>
where
    R: Fn(&str) -> Result<Vec<SocketAddr>, String>,
    F: FnMut(&RemoteModePackFetchBinding) -> Result<RemoteModePackFetchResponse, String>,
{
    let target = params
        .modepack_selected_candidate_fetch_target
        .as_ref()
        .ok_or_else(|| "modepack selected candidate fetch target missing".to_string())?;
    if !target.authorize_selected_candidate_fetch {
        return Err("modepack selected candidate fetch failed: authorization required".to_string());
    }
    let continuation_id = params.continuation_id.clone().ok_or_else(|| {
        "modepack selected candidate fetch failed: continuation_id is required".to_string()
    })?;
    for (field, value) in [
        (
            "expected_registry_manifest_sha256",
            target.expected_registry_manifest_sha256.as_str(),
        ),
        (
            "expected_candidate_url_fingerprint",
            target.expected_candidate_url_fingerprint.as_str(),
        ),
        (
            "expected_candidate_content_sha256",
            target.expected_candidate_content_sha256.as_str(),
        ),
        (
            "expected_candidate_compiled_policy_fingerprint",
            target
                .expected_candidate_compiled_policy_fingerprint
                .as_str(),
        ),
        (
            "expected_provenance_statement_url_fingerprint",
            target
                .expected_provenance_statement_url_fingerprint
                .as_str(),
        ),
        (
            "expected_provenance_statement_sha256",
            target.expected_provenance_statement_sha256.as_str(),
        ),
        (
            "expected_signer_fingerprint",
            target.expected_signer_fingerprint.as_str(),
        ),
        (
            "expected_current_activation_fingerprint",
            target.expected_current_activation_fingerprint.as_str(),
        ),
    ] {
        if !is_sha256_fingerprint(value) {
            return Err(format!(
                "modepack selected candidate fetch failed: {field} must be a sha256 fingerprint"
            ));
        }
    }
    if target.selection_id.trim().is_empty() || target.selection_event_id.trim().is_empty() {
        return Err(
            "modepack selected candidate fetch failed: selection id and event id are required"
                .to_string(),
        );
    }
    let request_fingerprint =
        headless_modepack_selected_candidate_fetch_request_fingerprint(params)?;

    let selection = store
        .read_modepack_registry_update_selection_snapshot(
            &target.expected_current_activation_fingerprint,
            &target.expected_candidate_content_sha256,
        )
        .map_err(|error| error.to_string())?
        .ok_or_else(|| {
            "modepack selected candidate fetch failed: registry selection evidence not found"
                .to_string()
        })?;
    let summary = selection.summary;
    if summary.selection_id != target.selection_id
        || summary.selection_event_id != target.selection_event_id
        || summary.registry_manifest_sha256 != target.expected_registry_manifest_sha256
        || summary.candidate_url_fingerprint != target.expected_candidate_url_fingerprint
        || summary.candidate_content_sha256 != target.expected_candidate_content_sha256
        || summary.candidate_compiled_policy_fingerprint
            != target.expected_candidate_compiled_policy_fingerprint
        || summary.provenance_statement_url_fingerprint
            != target.expected_provenance_statement_url_fingerprint
        || summary.provenance_statement_sha256 != target.expected_provenance_statement_sha256
        || summary.signer_fingerprint != target.expected_signer_fingerprint
        || summary.current_activation_fingerprint != target.expected_current_activation_fingerprint
    {
        return Err(
            "modepack selected candidate fetch failed: registry selection evidence mismatch"
                .to_string(),
        );
    }
    let current = store
        .read_active_modepack_snapshot()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| {
            "modepack selected candidate fetch failed: active Mode Pack snapshot not found"
                .to_string()
        })?;
    if current.summary.activation_fingerprint != summary.current_activation_fingerprint
        || current.summary.modepack_name != summary.current_modepack_name
        || current.summary.source_kind != summary.current_source_kind
    {
        return Err(
            "modepack selected candidate fetch failed: active Mode Pack snapshot no longer matches registry selection"
                .to_string(),
        );
    }

    let fetch_result = fetch_remote_modepack_candidate_with_resolver(
        store,
        &ModePackFetchCandidateParams {
            authorize_fetch: true,
            url: summary.candidate_url.clone(),
            expected_content_sha256: Some(summary.candidate_content_sha256.clone()),
        },
        &resolver,
        &mut fetcher,
    )?;
    let provenance_binding =
        create_modepack_fetch_binding_with(&summary.provenance_statement_url, &resolver)?;
    let provenance_response = fetcher(&provenance_binding)?;
    let provenance_material = selected_candidate_provenance_material_from_response(
        provenance_response,
        &summary.provenance_statement_sha256,
        &summary.signer_fingerprint,
    )?;
    if fetch_result.candidate.content_sha256 != summary.candidate_content_sha256
        || fetch_result.candidate.compiled_policy_fingerprint
            != summary.candidate_compiled_policy_fingerprint
        || fetch_result.candidate.source_url_fingerprint != summary.candidate_url_fingerprint
    {
        return Err(
            "modepack selected candidate fetch failed: fetched candidate evidence mismatch"
                .to_string(),
        );
    }

    let post_tasks = store
        .tasks()
        .list_tasks()
        .map_err(|error| error.to_string())?;
    let post_progress = task_list_progress_overview(store, &post_tasks)?;
    let decision_id = format!("headless_decision_{}", uuid::Uuid::new_v4().simple());
    store
        .write_headless_modepack_selected_candidate_fetch_checkpoint(
            &HeadlessModePackSelectedCandidateFetchCheckpoint {
                continuation_id: continuation_id.clone(),
                decision_id: decision_id.clone(),
                request_fingerprint: Some(request_fingerprint),
                expected_progress_fingerprint: params.expected_progress_fingerprint.clone(),
                expected_aggregate_sequence: params.expected_aggregate_sequence,
                current_progress_fingerprint: progress_overview.source_fingerprint.clone(),
                current_aggregate_sequence: progress_overview.aggregate_sequence,
                post_progress_fingerprint: post_progress.source_fingerprint.clone(),
                post_aggregate_sequence: post_progress.aggregate_sequence,
                selection_id: summary.selection_id.clone(),
                selection_event_id: summary.selection_event_id.clone(),
                expected_provenance_statement_url_fingerprint: Some(
                    summary.provenance_statement_url_fingerprint.clone(),
                ),
                expected_provenance_statement_sha256: Some(
                    summary.provenance_statement_sha256.clone(),
                ),
                expected_signer_fingerprint: Some(summary.signer_fingerprint.clone()),
                expected_current_activation_fingerprint: Some(
                    summary.current_activation_fingerprint.clone(),
                ),
                provenance_statement_json: Some(provenance_material.provenance_statement_json),
                provenance_signature_base64: Some(provenance_material.provenance_signature_base64),
                provenance_public_key_base64: Some(
                    provenance_material.provenance_public_key_base64,
                ),
                result: fetch_result.clone(),
            },
        )
        .map_err(|error| error.to_string())?;
    let next_route = HeadlessContinueRoute {
        kind: HeadlessContinueRouteKind::VerifySelectedModePackCandidateProvenanceExplicitly,
        reason: "Fetched the registry-selected Mode Pack candidate; provenance verification remains an explicit next step.".to_string(),
        task_id: None,
        run_id: None,
        proposal_id: None,
        apply_id: None,
        failure_fingerprint: None,
        apply_fingerprint: None,
        progress_fingerprint: Some(post_progress.source_fingerprint.clone()),
        aggregate_sequence: Some(post_progress.aggregate_sequence),
        next_action: "verify_selected_modepack_candidate_provenance_explicitly".to_string(),
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
        objective_proposal_authorization_preflight_result: None,
        objective_apply_verification_result: None,
        objective_completion_acceptance_result: None,
        llm_provider_failure_retry_admission: None,
        product_continuation_admission: None,
        modepack_select_registry_update_result: None,
        modepack_fetch_candidate_result: Some(fetch_result),
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
        next_action: "verify_selected_modepack_candidate_provenance_explicitly".to_string(),
    })
}

pub(super) fn handle_headless_continue_modepack_selected_candidate_provenance_verification(
    id: Value,
    store: &BrownieStore,
    progress_overview: &TaskListProgressOverview,
    params: HeadlessContinueOnceParams,
) -> JsonRpcResponse<Value> {
    let result = match headless_continue_modepack_selected_candidate_provenance_verification(
        store,
        progress_overview,
        &params,
    ) {
        Ok(result) => result,
        Err(message) => return error_response(id, -32603, &format!("internal error: {message}")),
    };
    result_response(id, json!(result))
}

pub(super) fn headless_continue_modepack_selected_candidate_provenance_verification_replay_result(
    id: Value,
    progress_overview: &TaskListProgressOverview,
    params: HeadlessContinueOnceParams,
    checkpoint: HeadlessModePackSelectedCandidateProvenanceVerificationCheckpoint,
) -> JsonRpcResponse<Value> {
    if let Err(message) =
        validate_headless_modepack_selected_candidate_provenance_verification_replay_request(
            &params,
            &checkpoint,
        )
    {
        return error_response(id, -32602, &message);
    }
    let mut provenance_result = checkpoint.result;
    provenance_result.verified = false;
    provenance_result.replayed = true;
    provenance_result.next_action = "approve_verified_modepack_candidate_explicitly".to_string();
    let next_route = HeadlessContinueRoute {
        kind: HeadlessContinueRouteKind::ApproveVerifiedModePackCandidateExplicitly,
        reason: "Registry-selected Mode Pack candidate provenance was already verified by this continuation; replaying bounded verification result.".to_string(),
        task_id: None,
        run_id: None,
        proposal_id: None,
        apply_id: None,
        failure_fingerprint: None,
        apply_fingerprint: None,
        progress_fingerprint: Some(progress_overview.source_fingerprint.clone()),
        aggregate_sequence: Some(progress_overview.aggregate_sequence),
        next_action: "approve_verified_modepack_candidate_explicitly".to_string(),
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
            objective_proposal_authorization_preflight_result: None,
            objective_apply_verification_result: None,
            objective_completion_acceptance_result: None,
            llm_provider_failure_retry_admission: None,
            product_continuation_admission: None,
            modepack_select_registry_update_result: None,
            modepack_fetch_candidate_result: None,
            modepack_verify_candidate_provenance_result: Some(provenance_result),
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
            next_action: "approve_verified_modepack_candidate_explicitly".to_string(),
        }),
    )
}

pub(super) fn headless_modepack_selected_candidate_provenance_verification_request_fingerprint(
    params: &HeadlessContinueOnceParams,
) -> Result<String, String> {
    let target = params
        .modepack_selected_candidate_provenance_verification_target
        .as_ref()
        .ok_or_else(|| {
            "modepack selected candidate provenance verification target missing".to_string()
        })?;
    let continuation_id = params.continuation_id.as_deref().ok_or_else(|| {
        "modepack selected candidate provenance verification failed: continuation_id is required"
            .to_string()
    })?;
    let seed = json!({
        "route_kind": "modepack_selected_candidate_provenance_verification",
        "continuation_id": continuation_id,
        "authorize": params.authorize,
        "authorize_selected_candidate_provenance_verification": target.authorize_selected_candidate_provenance_verification,
        "expected_progress_fingerprint": params.expected_progress_fingerprint,
        "expected_aggregate_sequence": params.expected_aggregate_sequence,
        "fetch_continuation_id": target.fetch_continuation_id,
        "expected_fetch_decision_id": target.expected_fetch_decision_id,
        "selection_id": target.selection_id,
        "selection_event_id": target.selection_event_id,
        "expected_candidate_url_fingerprint": target.expected_candidate_url_fingerprint,
        "expected_candidate_content_sha256": target.expected_candidate_content_sha256,
        "expected_candidate_compiled_policy_fingerprint": target.expected_candidate_compiled_policy_fingerprint,
        "expected_provenance_statement_url_fingerprint": target.expected_provenance_statement_url_fingerprint,
        "expected_provenance_statement_sha256": target.expected_provenance_statement_sha256,
        "expected_signer_fingerprint": target.expected_signer_fingerprint,
        "expected_current_activation_fingerprint": target.expected_current_activation_fingerprint,
        "provenance_statement_json_sha256": format!("sha256:{}", hex_sha256(target.provenance_statement_json.as_bytes())),
        "provenance_signature_base64_sha256": format!("sha256:{}", hex_sha256(target.provenance_signature_base64.as_bytes())),
        "provenance_public_key_base64_sha256": format!("sha256:{}", hex_sha256(target.provenance_public_key_base64.as_bytes())),
    });
    Ok(format!(
        "sha256:{}",
        hex_sha256(seed.to_string().as_bytes())
    ))
}

pub(super) fn validate_headless_modepack_selected_candidate_provenance_verification_replay_request(
    params: &HeadlessContinueOnceParams,
    checkpoint: &HeadlessModePackSelectedCandidateProvenanceVerificationCheckpoint,
) -> Result<(), String> {
    let current =
        headless_modepack_selected_candidate_provenance_verification_request_fingerprint(params)?;
    match checkpoint.request_fingerprint.as_deref() {
        Some(stored) if stored == current => Ok(()),
        Some(_) => Err(
            "invalid params: headless selected candidate provenance verification continuation request identity mismatch"
                .to_string(),
        ),
        None => Err(
            "invalid params: headless selected candidate provenance verification checkpoint is missing request identity fingerprint"
                .to_string(),
        ),
    }
}

pub(super) fn headless_continue_modepack_selected_candidate_provenance_verification(
    store: &BrownieStore,
    progress_overview: &TaskListProgressOverview,
    params: &HeadlessContinueOnceParams,
) -> Result<HeadlessContinueOnceResult, String> {
    let target = params
        .modepack_selected_candidate_provenance_verification_target
        .as_ref()
        .ok_or_else(|| {
            "modepack selected candidate provenance verification target missing".to_string()
        })?;
    if !target.authorize_selected_candidate_provenance_verification {
        return Err(
            "modepack selected candidate provenance verification failed: authorization required"
                .to_string(),
        );
    }
    let continuation_id = params.continuation_id.clone().ok_or_else(|| {
        "modepack selected candidate provenance verification failed: continuation_id is required"
            .to_string()
    })?;
    if !is_valid_headless_continuation_id(&target.fetch_continuation_id) {
        return Err(
            "modepack selected candidate provenance verification failed: fetch_continuation_id is invalid"
                .to_string(),
        );
    }
    if target.expected_fetch_decision_id.trim().is_empty() {
        return Err(
            "modepack selected candidate provenance verification failed: expected_fetch_decision_id is required"
                .to_string(),
        );
    }
    for (field, value) in [
        (
            "expected_candidate_url_fingerprint",
            target.expected_candidate_url_fingerprint.as_str(),
        ),
        (
            "expected_candidate_content_sha256",
            target.expected_candidate_content_sha256.as_str(),
        ),
        (
            "expected_candidate_compiled_policy_fingerprint",
            target
                .expected_candidate_compiled_policy_fingerprint
                .as_str(),
        ),
        (
            "expected_provenance_statement_url_fingerprint",
            target
                .expected_provenance_statement_url_fingerprint
                .as_str(),
        ),
        (
            "expected_provenance_statement_sha256",
            target.expected_provenance_statement_sha256.as_str(),
        ),
        (
            "expected_signer_fingerprint",
            target.expected_signer_fingerprint.as_str(),
        ),
        (
            "expected_current_activation_fingerprint",
            target.expected_current_activation_fingerprint.as_str(),
        ),
    ] {
        if !is_sha256_fingerprint(value) {
            return Err(format!(
                "modepack selected candidate provenance verification failed: {field} must be a sha256 fingerprint"
            ));
        }
    }
    if target.selection_id.trim().is_empty() || target.selection_event_id.trim().is_empty() {
        return Err(
            "modepack selected candidate provenance verification failed: selection id and event id are required"
                .to_string(),
        );
    }
    let request_fingerprint =
        headless_modepack_selected_candidate_provenance_verification_request_fingerprint(params)?;
    let actual_statement_sha256 = format!(
        "sha256:{}",
        hex_sha256(target.provenance_statement_json.as_bytes())
    );
    if actual_statement_sha256 != target.expected_provenance_statement_sha256 {
        return Err(
            "modepack selected candidate provenance verification failed: provenance statement fingerprint mismatch"
                .to_string(),
        );
    }

    let fetch_checkpoint = store
        .read_headless_modepack_selected_candidate_fetch_checkpoint(&target.fetch_continuation_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| {
            "modepack selected candidate provenance verification failed: selected candidate fetch checkpoint not found"
                .to_string()
        })?;
    if fetch_checkpoint.decision_id != target.expected_fetch_decision_id
        || fetch_checkpoint.selection_id != target.selection_id
        || fetch_checkpoint.selection_event_id != target.selection_event_id
    {
        return Err(
            "modepack selected candidate provenance verification failed: selected candidate fetch checkpoint mismatch"
                .to_string(),
        );
    }
    let fetched_candidate = &fetch_checkpoint.result.candidate;
    if fetched_candidate.content_sha256 != target.expected_candidate_content_sha256
        || fetched_candidate.compiled_policy_fingerprint
            != target.expected_candidate_compiled_policy_fingerprint
        || fetched_candidate.source_url_fingerprint != target.expected_candidate_url_fingerprint
    {
        return Err(
            "modepack selected candidate provenance verification failed: fetched candidate evidence mismatch"
                .to_string(),
        );
    }

    let selection = store
        .read_modepack_registry_update_selection_snapshot(
            &target.expected_current_activation_fingerprint,
            &target.expected_candidate_content_sha256,
        )
        .map_err(|error| error.to_string())?
        .ok_or_else(|| {
            "modepack selected candidate provenance verification failed: registry selection evidence not found"
                .to_string()
        })?;
    let summary = selection.summary;
    if summary.selection_id != target.selection_id
        || summary.selection_event_id != target.selection_event_id
        || summary.candidate_url_fingerprint != target.expected_candidate_url_fingerprint
        || summary.candidate_content_sha256 != target.expected_candidate_content_sha256
        || summary.candidate_compiled_policy_fingerprint
            != target.expected_candidate_compiled_policy_fingerprint
        || summary.provenance_statement_url_fingerprint
            != target.expected_provenance_statement_url_fingerprint
        || summary.provenance_statement_sha256 != target.expected_provenance_statement_sha256
        || summary.signer_fingerprint != target.expected_signer_fingerprint
        || summary.current_activation_fingerprint != target.expected_current_activation_fingerprint
    {
        return Err(
            "modepack selected candidate provenance verification failed: registry selection evidence mismatch"
                .to_string(),
        );
    }
    let current = store
        .read_active_modepack_snapshot()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| {
            "modepack selected candidate provenance verification failed: active Mode Pack snapshot not found"
                .to_string()
        })?;
    if current.summary.activation_fingerprint != summary.current_activation_fingerprint
        || current.summary.modepack_name != summary.current_modepack_name
        || current.summary.source_kind != summary.current_source_kind
    {
        return Err(
            "modepack selected candidate provenance verification failed: active Mode Pack snapshot no longer matches registry selection"
                .to_string(),
        );
    }

    let mut provenance_result = verify_modepack_candidate_provenance(
        store,
        &ModePackVerifyCandidateProvenanceParams {
            authorize_provenance_verification: true,
            expected_content_sha256: target.expected_candidate_content_sha256.clone(),
            expected_compiled_policy_fingerprint: target
                .expected_candidate_compiled_policy_fingerprint
                .clone(),
            expected_signer_fingerprint: target.expected_signer_fingerprint.clone(),
            provenance_statement_json: target.provenance_statement_json.clone(),
            provenance_signature_base64: target.provenance_signature_base64.clone(),
            provenance_public_key_base64: target.provenance_public_key_base64.clone(),
        },
    )?;
    if provenance_result.provenance.content_sha256 != target.expected_candidate_content_sha256
        || provenance_result.provenance.compiled_policy_fingerprint
            != target.expected_candidate_compiled_policy_fingerprint
        || provenance_result.provenance.source_url_fingerprint
            != target.expected_candidate_url_fingerprint
        || provenance_result.provenance.statement_sha256
            != target.expected_provenance_statement_sha256
        || provenance_result.provenance.signer_fingerprint != target.expected_signer_fingerprint
    {
        return Err(
            "modepack selected candidate provenance verification failed: provenance result evidence mismatch"
                .to_string(),
        );
    }
    provenance_result.next_action = "approve_verified_modepack_candidate_explicitly".to_string();

    let post_tasks = store
        .tasks()
        .list_tasks()
        .map_err(|error| error.to_string())?;
    let post_progress = task_list_progress_overview(store, &post_tasks)?;
    let decision_id = format!("headless_decision_{}", uuid::Uuid::new_v4().simple());
    store
        .write_headless_modepack_selected_candidate_provenance_verification_checkpoint(
            &HeadlessModePackSelectedCandidateProvenanceVerificationCheckpoint {
                continuation_id: continuation_id.clone(),
                decision_id: decision_id.clone(),
                request_fingerprint: Some(request_fingerprint),
                fetch_continuation_id: target.fetch_continuation_id.clone(),
                expected_fetch_decision_id: target.expected_fetch_decision_id.clone(),
                expected_progress_fingerprint: params.expected_progress_fingerprint.clone(),
                expected_aggregate_sequence: params.expected_aggregate_sequence,
                current_progress_fingerprint: progress_overview.source_fingerprint.clone(),
                current_aggregate_sequence: progress_overview.aggregate_sequence,
                post_progress_fingerprint: post_progress.source_fingerprint.clone(),
                post_aggregate_sequence: post_progress.aggregate_sequence,
                selection_id: summary.selection_id,
                selection_event_id: summary.selection_event_id,
                result: provenance_result.clone(),
            },
        )
        .map_err(|error| error.to_string())?;
    let next_route = HeadlessContinueRoute {
        kind: HeadlessContinueRouteKind::ApproveVerifiedModePackCandidateExplicitly,
        reason: "Verified the registry-selected Mode Pack candidate provenance; candidate approval remains an explicit next step.".to_string(),
        task_id: None,
        run_id: None,
        proposal_id: None,
        apply_id: None,
        failure_fingerprint: None,
        apply_fingerprint: None,
        progress_fingerprint: Some(post_progress.source_fingerprint.clone()),
        aggregate_sequence: Some(post_progress.aggregate_sequence),
        next_action: "approve_verified_modepack_candidate_explicitly".to_string(),
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
        objective_proposal_authorization_preflight_result: None,
        objective_apply_verification_result: None,
        objective_completion_acceptance_result: None,
        llm_provider_failure_retry_admission: None,
        product_continuation_admission: None,
        modepack_select_registry_update_result: None,
        modepack_fetch_candidate_result: None,
        modepack_verify_candidate_provenance_result: Some(provenance_result),
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
        next_action: "approve_verified_modepack_candidate_explicitly".to_string(),
    })
}

pub(super) fn handle_headless_continue_modepack_selected_candidate_approval(
    id: Value,
    store: &BrownieStore,
    progress_overview: &TaskListProgressOverview,
    params: HeadlessContinueOnceParams,
) -> JsonRpcResponse<Value> {
    let result = match headless_continue_modepack_selected_candidate_approval(
        store,
        progress_overview,
        &params,
    ) {
        Ok(result) => result,
        Err(message) => return error_response(id, -32603, &format!("internal error: {message}")),
    };
    result_response(id, json!(result))
}

pub(super) fn headless_continue_modepack_selected_candidate_approval_replay_result(
    id: Value,
    progress_overview: &TaskListProgressOverview,
    params: HeadlessContinueOnceParams,
    checkpoint: HeadlessModePackSelectedCandidateApprovalCheckpoint,
) -> JsonRpcResponse<Value> {
    if let Err(message) =
        validate_headless_modepack_selected_candidate_approval_replay_request(&params, &checkpoint)
    {
        return error_response(id, -32602, &message);
    }
    let mut approval_result = checkpoint.result;
    approval_result.approved = false;
    approval_result.replayed = true;
    approval_result.next_action =
        "replace_active_with_approved_modepack_candidate_explicitly".to_string();
    let next_route = HeadlessContinueRoute {
        kind: HeadlessContinueRouteKind::RefreshProgressOverview,
        reason: "Registry-selected Mode Pack candidate approval was already completed by this continuation; replaying bounded approval result before explicit active replacement.".to_string(),
        task_id: None,
        run_id: None,
        proposal_id: None,
        apply_id: None,
        failure_fingerprint: None,
        apply_fingerprint: None,
        progress_fingerprint: Some(progress_overview.source_fingerprint.clone()),
        aggregate_sequence: Some(progress_overview.aggregate_sequence),
        next_action: "replace_active_with_approved_modepack_candidate_explicitly".to_string(),
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
            objective_proposal_authorization_preflight_result: None,
            objective_apply_verification_result: None,
            objective_completion_acceptance_result: None,
            llm_provider_failure_retry_admission: None,
            product_continuation_admission: None,
            modepack_select_registry_update_result: None,
            modepack_fetch_candidate_result: None,
            modepack_verify_candidate_provenance_result: None,
            modepack_approve_candidate_result: Some(approval_result),
            modepack_replace_active_result: None,
            modepack_rollback_active_result: None,
            next_route: Some(next_route),
            max_steps: None,
            step_count: None,
            executed_count: None,
            replayed_count: None,
            stop_reason: None,
            steps: Vec::new(),
            next_action: "replace_active_with_approved_modepack_candidate_explicitly".to_string(),
        }),
    )
}

pub(super) fn headless_modepack_selected_candidate_approval_request_fingerprint(
    params: &HeadlessContinueOnceParams,
) -> Result<String, String> {
    let target = params
        .modepack_selected_candidate_approval_target
        .as_ref()
        .ok_or_else(|| "modepack selected candidate approval target missing".to_string())?;
    let continuation_id = params.continuation_id.as_deref().ok_or_else(|| {
        "modepack selected candidate approval failed: continuation_id is required".to_string()
    })?;
    let seed = json!({
        "route_kind": "modepack_selected_candidate_approval",
        "continuation_id": continuation_id,
        "authorize": params.authorize,
        "authorize_selected_candidate_approval": target.authorize_selected_candidate_approval,
        "expected_progress_fingerprint": params.expected_progress_fingerprint,
        "expected_aggregate_sequence": params.expected_aggregate_sequence,
        "fetch_continuation_id": target.fetch_continuation_id,
        "expected_fetch_decision_id": target.expected_fetch_decision_id,
        "provenance_verification_continuation_id": target.provenance_verification_continuation_id,
        "expected_provenance_verification_decision_id": target.expected_provenance_verification_decision_id,
        "selection_id": target.selection_id,
        "selection_event_id": target.selection_event_id,
        "expected_candidate_url_fingerprint": target.expected_candidate_url_fingerprint,
        "expected_candidate_content_sha256": target.expected_candidate_content_sha256,
        "expected_candidate_compiled_policy_fingerprint": target.expected_candidate_compiled_policy_fingerprint,
        "expected_provenance_id": target.expected_provenance_id,
        "expected_provenance_event_id": target.expected_provenance_event_id,
        "expected_provenance_statement_url_fingerprint": target.expected_provenance_statement_url_fingerprint,
        "expected_provenance_statement_sha256": target.expected_provenance_statement_sha256,
        "expected_signer_fingerprint": target.expected_signer_fingerprint,
        "expected_current_activation_fingerprint": target.expected_current_activation_fingerprint,
    });
    Ok(format!(
        "sha256:{}",
        hex_sha256(seed.to_string().as_bytes())
    ))
}

pub(super) fn validate_headless_modepack_selected_candidate_approval_replay_request(
    params: &HeadlessContinueOnceParams,
    checkpoint: &HeadlessModePackSelectedCandidateApprovalCheckpoint,
) -> Result<(), String> {
    let current = headless_modepack_selected_candidate_approval_request_fingerprint(params)?;
    match checkpoint.request_fingerprint.as_deref() {
        Some(stored) if stored == current => Ok(()),
        Some(_) => Err(
            "invalid params: headless selected candidate approval continuation request identity mismatch"
                .to_string(),
        ),
        None => Err(
            "invalid params: headless selected candidate approval checkpoint is missing request identity fingerprint"
                .to_string(),
        ),
    }
}

pub(super) fn validate_selected_candidate_approval_target(
    target: &ModePackSelectedCandidateApprovalTarget,
) -> Result<(), String> {
    if !target.authorize_selected_candidate_approval {
        return Err(
            "modepack selected candidate approval failed: authorization required".to_string(),
        );
    }
    if !is_valid_headless_continuation_id(&target.fetch_continuation_id)
        || !is_valid_headless_continuation_id(&target.provenance_verification_continuation_id)
    {
        return Err(
            "modepack selected candidate approval failed: checkpoint continuation id is invalid"
                .to_string(),
        );
    }
    if target.expected_fetch_decision_id.trim().is_empty()
        || target
            .expected_provenance_verification_decision_id
            .trim()
            .is_empty()
        || target.expected_provenance_id.trim().is_empty()
        || target.expected_provenance_event_id.trim().is_empty()
    {
        return Err(
            "modepack selected candidate approval failed: expected checkpoint and provenance ids are required"
                .to_string(),
        );
    }
    for (field, value) in [
        (
            "expected_candidate_url_fingerprint",
            target.expected_candidate_url_fingerprint.as_str(),
        ),
        (
            "expected_candidate_content_sha256",
            target.expected_candidate_content_sha256.as_str(),
        ),
        (
            "expected_candidate_compiled_policy_fingerprint",
            target
                .expected_candidate_compiled_policy_fingerprint
                .as_str(),
        ),
        (
            "expected_provenance_statement_url_fingerprint",
            target
                .expected_provenance_statement_url_fingerprint
                .as_str(),
        ),
        (
            "expected_provenance_statement_sha256",
            target.expected_provenance_statement_sha256.as_str(),
        ),
        (
            "expected_signer_fingerprint",
            target.expected_signer_fingerprint.as_str(),
        ),
        (
            "expected_current_activation_fingerprint",
            target.expected_current_activation_fingerprint.as_str(),
        ),
    ] {
        if !is_sha256_fingerprint(value) {
            return Err(format!(
                "modepack selected candidate approval failed: {field} must be a sha256 fingerprint"
            ));
        }
    }
    if target.selection_id.trim().is_empty() || target.selection_event_id.trim().is_empty() {
        return Err(
            "modepack selected candidate approval failed: selection id and event id are required"
                .to_string(),
        );
    }
    Ok(())
}

pub(super) fn headless_continue_modepack_selected_candidate_approval(
    store: &BrownieStore,
    progress_overview: &TaskListProgressOverview,
    params: &HeadlessContinueOnceParams,
) -> Result<HeadlessContinueOnceResult, String> {
    let target = params
        .modepack_selected_candidate_approval_target
        .as_ref()
        .ok_or_else(|| "modepack selected candidate approval target missing".to_string())?;
    validate_selected_candidate_approval_target(target)?;
    let continuation_id = params.continuation_id.clone().ok_or_else(|| {
        "modepack selected candidate approval failed: continuation_id is required".to_string()
    })?;
    let request_fingerprint =
        headless_modepack_selected_candidate_approval_request_fingerprint(params)?;

    let fetch_checkpoint = store
        .read_headless_modepack_selected_candidate_fetch_checkpoint(&target.fetch_continuation_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| {
            "modepack selected candidate approval failed: selected candidate fetch checkpoint not found"
                .to_string()
        })?;
    let provenance_checkpoint = store
        .read_headless_modepack_selected_candidate_provenance_verification_checkpoint(
            &target.provenance_verification_continuation_id,
        )
        .map_err(|error| error.to_string())?
        .ok_or_else(|| {
            "modepack selected candidate approval failed: selected candidate provenance verification checkpoint not found"
                .to_string()
        })?;
    if fetch_checkpoint.decision_id != target.expected_fetch_decision_id
        || fetch_checkpoint.selection_id != target.selection_id
        || fetch_checkpoint.selection_event_id != target.selection_event_id
        || provenance_checkpoint.decision_id != target.expected_provenance_verification_decision_id
        || provenance_checkpoint.fetch_continuation_id != target.fetch_continuation_id
        || provenance_checkpoint.expected_fetch_decision_id != target.expected_fetch_decision_id
        || provenance_checkpoint.selection_id != target.selection_id
        || provenance_checkpoint.selection_event_id != target.selection_event_id
    {
        return Err(
            "modepack selected candidate approval failed: selected candidate checkpoint mismatch"
                .to_string(),
        );
    }
    let fetched_candidate = &fetch_checkpoint.result.candidate;
    let verified_provenance = &provenance_checkpoint.result.provenance;
    if fetched_candidate.content_sha256 != target.expected_candidate_content_sha256
        || fetched_candidate.compiled_policy_fingerprint
            != target.expected_candidate_compiled_policy_fingerprint
        || fetched_candidate.source_url_fingerprint != target.expected_candidate_url_fingerprint
        || verified_provenance.content_sha256 != target.expected_candidate_content_sha256
        || verified_provenance.compiled_policy_fingerprint
            != target.expected_candidate_compiled_policy_fingerprint
        || verified_provenance.source_url_fingerprint != target.expected_candidate_url_fingerprint
        || verified_provenance.provenance_id != target.expected_provenance_id
        || verified_provenance.provenance_event_id != target.expected_provenance_event_id
        || verified_provenance.statement_sha256 != target.expected_provenance_statement_sha256
        || verified_provenance.signer_fingerprint != target.expected_signer_fingerprint
    {
        return Err(
            "modepack selected candidate approval failed: selected candidate checkpoint evidence mismatch"
                .to_string(),
        );
    }
    let selection = store
        .read_modepack_registry_update_selection_snapshot(
            &target.expected_current_activation_fingerprint,
            &target.expected_candidate_content_sha256,
        )
        .map_err(|error| error.to_string())?
        .ok_or_else(|| {
            "modepack selected candidate approval failed: registry selection evidence not found"
                .to_string()
        })?;
    let summary = selection.summary;
    if summary.selection_id != target.selection_id
        || summary.selection_event_id != target.selection_event_id
        || summary.candidate_url_fingerprint != target.expected_candidate_url_fingerprint
        || summary.candidate_content_sha256 != target.expected_candidate_content_sha256
        || summary.candidate_compiled_policy_fingerprint
            != target.expected_candidate_compiled_policy_fingerprint
        || summary.provenance_statement_url_fingerprint
            != target.expected_provenance_statement_url_fingerprint
        || summary.provenance_statement_sha256 != target.expected_provenance_statement_sha256
        || summary.signer_fingerprint != target.expected_signer_fingerprint
        || summary.current_activation_fingerprint != target.expected_current_activation_fingerprint
    {
        return Err(
            "modepack selected candidate approval failed: registry selection evidence mismatch"
                .to_string(),
        );
    }
    let current = store
        .read_active_modepack_snapshot()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| {
            "modepack selected candidate approval failed: active Mode Pack snapshot not found"
                .to_string()
        })?;
    if current.summary.activation_fingerprint != summary.current_activation_fingerprint
        || current.summary.modepack_name != summary.current_modepack_name
        || current.summary.source_kind != summary.current_source_kind
    {
        return Err(
            "modepack selected candidate approval failed: active Mode Pack snapshot no longer matches registry selection"
                .to_string(),
        );
    }

    let mut approval_result = approve_remote_modepack_candidate(
        store,
        &ModePackApproveCandidateParams {
            authorize_trust: true,
            expected_content_sha256: target.expected_candidate_content_sha256.clone(),
            expected_compiled_policy_fingerprint: target
                .expected_candidate_compiled_policy_fingerprint
                .clone(),
            expected_provenance_id: target.expected_provenance_id.clone(),
            expected_provenance_event_id: target.expected_provenance_event_id.clone(),
            expected_signer_fingerprint: target.expected_signer_fingerprint.clone(),
            expected_statement_sha256: target.expected_provenance_statement_sha256.clone(),
        },
    )?;
    approval_result.next_action =
        "replace_active_with_approved_modepack_candidate_explicitly".to_string();

    let post_tasks = store
        .tasks()
        .list_tasks()
        .map_err(|error| error.to_string())?;
    let post_progress = task_list_progress_overview(store, &post_tasks)?;
    let decision_id = format!("headless_decision_{}", uuid::Uuid::new_v4().simple());
    store
        .write_headless_modepack_selected_candidate_approval_checkpoint(
            &HeadlessModePackSelectedCandidateApprovalCheckpoint {
                continuation_id: continuation_id.clone(),
                decision_id: decision_id.clone(),
                request_fingerprint: Some(request_fingerprint),
                fetch_continuation_id: target.fetch_continuation_id.clone(),
                expected_fetch_decision_id: target.expected_fetch_decision_id.clone(),
                provenance_verification_continuation_id: target
                    .provenance_verification_continuation_id
                    .clone(),
                expected_provenance_verification_decision_id: target
                    .expected_provenance_verification_decision_id
                    .clone(),
                expected_progress_fingerprint: params.expected_progress_fingerprint.clone(),
                expected_aggregate_sequence: params.expected_aggregate_sequence,
                current_progress_fingerprint: progress_overview.source_fingerprint.clone(),
                current_aggregate_sequence: progress_overview.aggregate_sequence,
                post_progress_fingerprint: post_progress.source_fingerprint.clone(),
                post_aggregate_sequence: post_progress.aggregate_sequence,
                selection_id: summary.selection_id,
                selection_event_id: summary.selection_event_id,
                result: approval_result.clone(),
            },
        )
        .map_err(|error| error.to_string())?;
    let next_route = HeadlessContinueRoute {
        kind: HeadlessContinueRouteKind::RefreshProgressOverview,
        reason: "Approved the registry-selected verified Mode Pack candidate; active replacement remains an explicit next step.".to_string(),
        task_id: None,
        run_id: None,
        proposal_id: None,
        apply_id: None,
        failure_fingerprint: None,
        apply_fingerprint: None,
        progress_fingerprint: Some(post_progress.source_fingerprint.clone()),
        aggregate_sequence: Some(post_progress.aggregate_sequence),
        next_action: "replace_active_with_approved_modepack_candidate_explicitly".to_string(),
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
        objective_proposal_authorization_preflight_result: None,
        objective_apply_verification_result: None,
        objective_completion_acceptance_result: None,
        llm_provider_failure_retry_admission: None,
        product_continuation_admission: None,
        modepack_select_registry_update_result: None,
        modepack_fetch_candidate_result: None,
        modepack_verify_candidate_provenance_result: None,
        modepack_approve_candidate_result: Some(approval_result),
        modepack_replace_active_result: None,
        modepack_rollback_active_result: None,
        next_route: Some(next_route),
        max_steps: None,
        step_count: None,
        executed_count: None,
        replayed_count: None,
        stop_reason: None,
        steps: Vec::new(),
        next_action: "replace_active_with_approved_modepack_candidate_explicitly".to_string(),
    })
}

pub(super) fn handle_headless_continue_modepack_selected_candidate_replacement(
    id: Value,
    store: &BrownieStore,
    progress_overview: &TaskListProgressOverview,
    params: HeadlessContinueOnceParams,
) -> JsonRpcResponse<Value> {
    let result = match headless_continue_modepack_selected_candidate_replacement(
        store,
        progress_overview,
        &params,
    ) {
        Ok(result) => result,
        Err(message) => return error_response(id, -32603, &format!("internal error: {message}")),
    };
    result_response(id, json!(result))
}

pub(super) fn headless_continue_modepack_selected_candidate_replacement_replay_result(
    id: Value,
    progress_overview: &TaskListProgressOverview,
    params: HeadlessContinueOnceParams,
    checkpoint: HeadlessModePackSelectedCandidateReplacementCheckpoint,
) -> JsonRpcResponse<Value> {
    if let Err(message) = validate_headless_modepack_selected_candidate_replacement_replay_request(
        &params,
        &checkpoint,
    ) {
        return error_response(id, -32602, &message);
    }
    let mut replacement_result = checkpoint.result;
    replacement_result.replaced = false;
    replacement_result.replayed = true;
    let next_route = HeadlessContinueRoute {
        kind: HeadlessContinueRouteKind::RefreshProgressOverview,
        reason: "Registry-selected approved Mode Pack candidate active replacement was already completed by this continuation; replaying bounded replacement result.".to_string(),
        task_id: None,
        run_id: None,
        proposal_id: None,
        apply_id: None,
        failure_fingerprint: None,
        apply_fingerprint: None,
        progress_fingerprint: Some(progress_overview.source_fingerprint.clone()),
        aggregate_sequence: Some(progress_overview.aggregate_sequence),
        next_action: "refresh_progress_overview".to_string(),
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
            objective_proposal_authorization_preflight_result: None,
            objective_apply_verification_result: None,
            objective_completion_acceptance_result: None,
            llm_provider_failure_retry_admission: None,
            product_continuation_admission: None,
            modepack_select_registry_update_result: None,
            modepack_fetch_candidate_result: None,
            modepack_verify_candidate_provenance_result: None,
            modepack_approve_candidate_result: None,
            modepack_replace_active_result: Some(replacement_result),
            modepack_rollback_active_result: None,
            next_route: Some(next_route),
            max_steps: None,
            step_count: None,
            executed_count: None,
            replayed_count: None,
            stop_reason: None,
            steps: Vec::new(),
            next_action: "refresh_progress_overview".to_string(),
        }),
    )
}

pub(super) fn headless_modepack_selected_candidate_replacement_request_fingerprint(
    params: &HeadlessContinueOnceParams,
) -> Result<String, String> {
    let target = params
        .modepack_selected_approved_candidate_replacement_target
        .as_ref()
        .ok_or_else(|| {
            "modepack selected approved candidate replacement target missing".to_string()
        })?;
    let continuation_id = params.continuation_id.as_deref().ok_or_else(|| {
        "modepack selected approved candidate replacement failed: continuation_id is required"
            .to_string()
    })?;
    let seed = json!({
        "route_kind": "modepack_selected_approved_candidate_replacement",
        "continuation_id": continuation_id,
        "authorize": params.authorize,
        "authorize_selected_candidate_replacement": target.authorize_selected_candidate_replacement,
        "expected_progress_fingerprint": params.expected_progress_fingerprint,
        "expected_aggregate_sequence": params.expected_aggregate_sequence,
        "fetch_continuation_id": target.fetch_continuation_id,
        "expected_fetch_decision_id": target.expected_fetch_decision_id,
        "provenance_verification_continuation_id": target.provenance_verification_continuation_id,
        "expected_provenance_verification_decision_id": target.expected_provenance_verification_decision_id,
        "approval_continuation_id": target.approval_continuation_id,
        "expected_approval_decision_id": target.expected_approval_decision_id,
        "selection_id": target.selection_id,
        "selection_event_id": target.selection_event_id,
        "expected_candidate_url_fingerprint": target.expected_candidate_url_fingerprint,
        "expected_candidate_content_sha256": target.expected_candidate_content_sha256,
        "expected_candidate_compiled_policy_fingerprint": target.expected_candidate_compiled_policy_fingerprint,
        "expected_candidate_activation_fingerprint": target.expected_candidate_activation_fingerprint,
        "expected_provenance_id": target.expected_provenance_id,
        "expected_provenance_event_id": target.expected_provenance_event_id,
        "expected_provenance_statement_url_fingerprint": target.expected_provenance_statement_url_fingerprint,
        "expected_provenance_statement_sha256": target.expected_provenance_statement_sha256,
        "expected_signer_fingerprint": target.expected_signer_fingerprint,
        "expected_current_activation_fingerprint": target.expected_current_activation_fingerprint,
        "expected_approved_candidate_id": target.expected_approved_candidate_id,
        "expected_approved_candidate_approval_id": target.expected_approved_candidate_approval_id,
        "expected_approved_candidate_approval_event_id": target.expected_approved_candidate_approval_event_id,
    });
    Ok(format!(
        "sha256:{}",
        hex_sha256(seed.to_string().as_bytes())
    ))
}

pub(super) fn validate_headless_modepack_selected_candidate_replacement_replay_request(
    params: &HeadlessContinueOnceParams,
    checkpoint: &HeadlessModePackSelectedCandidateReplacementCheckpoint,
) -> Result<(), String> {
    let current = headless_modepack_selected_candidate_replacement_request_fingerprint(params)?;
    match checkpoint.request_fingerprint.as_deref() {
        Some(stored) if stored == current => Ok(()),
        Some(_) => Err(
            "invalid params: headless selected approved candidate replacement continuation request identity mismatch"
                .to_string(),
        ),
        None => Err(
            "invalid params: headless selected approved candidate replacement checkpoint is missing request identity fingerprint"
                .to_string(),
        ),
    }
}

pub(super) fn validate_selected_approved_candidate_replacement_target(
    target: &ModePackSelectedApprovedCandidateReplacementTarget,
) -> Result<(), String> {
    if !target.authorize_selected_candidate_replacement {
        return Err(
            "modepack selected approved candidate replacement failed: authorization required"
                .to_string(),
        );
    }
    if !is_valid_headless_continuation_id(&target.fetch_continuation_id)
        || !is_valid_headless_continuation_id(&target.provenance_verification_continuation_id)
        || !is_valid_headless_continuation_id(&target.approval_continuation_id)
    {
        return Err(
            "modepack selected approved candidate replacement failed: checkpoint continuation id is invalid"
                .to_string(),
        );
    }
    if target.expected_fetch_decision_id.trim().is_empty()
        || target
            .expected_provenance_verification_decision_id
            .trim()
            .is_empty()
        || target.expected_approval_decision_id.trim().is_empty()
        || target.selection_id.trim().is_empty()
        || target.selection_event_id.trim().is_empty()
        || target.expected_provenance_id.trim().is_empty()
        || target.expected_provenance_event_id.trim().is_empty()
        || target.expected_approved_candidate_id.trim().is_empty()
        || target
            .expected_approved_candidate_approval_id
            .trim()
            .is_empty()
        || target
            .expected_approved_candidate_approval_event_id
            .trim()
            .is_empty()
    {
        return Err(
            "modepack selected approved candidate replacement failed: expected checkpoint, selection, provenance, and approval ids are required"
                .to_string(),
        );
    }
    for (field, value) in [
        (
            "expected_candidate_url_fingerprint",
            target.expected_candidate_url_fingerprint.as_str(),
        ),
        (
            "expected_candidate_content_sha256",
            target.expected_candidate_content_sha256.as_str(),
        ),
        (
            "expected_candidate_compiled_policy_fingerprint",
            target
                .expected_candidate_compiled_policy_fingerprint
                .as_str(),
        ),
        (
            "expected_candidate_activation_fingerprint",
            target.expected_candidate_activation_fingerprint.as_str(),
        ),
        (
            "expected_provenance_statement_url_fingerprint",
            target
                .expected_provenance_statement_url_fingerprint
                .as_str(),
        ),
        (
            "expected_provenance_statement_sha256",
            target.expected_provenance_statement_sha256.as_str(),
        ),
        (
            "expected_signer_fingerprint",
            target.expected_signer_fingerprint.as_str(),
        ),
        (
            "expected_current_activation_fingerprint",
            target.expected_current_activation_fingerprint.as_str(),
        ),
    ] {
        if !is_sha256_fingerprint(value) {
            return Err(format!(
                "modepack selected approved candidate replacement failed: {field} must be a sha256 fingerprint"
            ));
        }
    }
    Ok(())
}

pub(super) fn headless_continue_modepack_selected_candidate_replacement(
    store: &BrownieStore,
    progress_overview: &TaskListProgressOverview,
    params: &HeadlessContinueOnceParams,
) -> Result<HeadlessContinueOnceResult, String> {
    let target = params
        .modepack_selected_approved_candidate_replacement_target
        .as_ref()
        .ok_or_else(|| {
            "modepack selected approved candidate replacement target missing".to_string()
        })?;
    validate_selected_approved_candidate_replacement_target(target)?;
    let continuation_id = params.continuation_id.clone().ok_or_else(|| {
        "modepack selected approved candidate replacement failed: continuation_id is required"
            .to_string()
    })?;
    let request_fingerprint =
        headless_modepack_selected_candidate_replacement_request_fingerprint(params)?;

    let fetch_checkpoint = store
        .read_headless_modepack_selected_candidate_fetch_checkpoint(&target.fetch_continuation_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| {
            "modepack selected approved candidate replacement failed: selected candidate fetch checkpoint not found"
                .to_string()
        })?;
    let provenance_checkpoint = store
        .read_headless_modepack_selected_candidate_provenance_verification_checkpoint(
            &target.provenance_verification_continuation_id,
        )
        .map_err(|error| error.to_string())?
        .ok_or_else(|| {
            "modepack selected approved candidate replacement failed: selected candidate provenance verification checkpoint not found"
                .to_string()
        })?;
    let approval_checkpoint = store
        .read_headless_modepack_selected_candidate_approval_checkpoint(
            &target.approval_continuation_id,
        )
        .map_err(|error| error.to_string())?
        .ok_or_else(|| {
            "modepack selected approved candidate replacement failed: selected candidate approval checkpoint not found"
                .to_string()
        })?;
    if fetch_checkpoint.decision_id != target.expected_fetch_decision_id
        || provenance_checkpoint.decision_id != target.expected_provenance_verification_decision_id
        || approval_checkpoint.decision_id != target.expected_approval_decision_id
        || provenance_checkpoint.fetch_continuation_id != target.fetch_continuation_id
        || provenance_checkpoint.expected_fetch_decision_id != target.expected_fetch_decision_id
        || approval_checkpoint.fetch_continuation_id != target.fetch_continuation_id
        || approval_checkpoint.expected_fetch_decision_id != target.expected_fetch_decision_id
        || approval_checkpoint.provenance_verification_continuation_id
            != target.provenance_verification_continuation_id
        || approval_checkpoint.expected_provenance_verification_decision_id
            != target.expected_provenance_verification_decision_id
        || fetch_checkpoint.selection_id != target.selection_id
        || provenance_checkpoint.selection_id != target.selection_id
        || approval_checkpoint.selection_id != target.selection_id
        || fetch_checkpoint.selection_event_id != target.selection_event_id
        || provenance_checkpoint.selection_event_id != target.selection_event_id
        || approval_checkpoint.selection_event_id != target.selection_event_id
    {
        return Err(
            "modepack selected approved candidate replacement failed: selected candidate checkpoint mismatch"
                .to_string(),
        );
    }
    let fetched_candidate = &fetch_checkpoint.result.candidate;
    let verified_provenance = &provenance_checkpoint.result.provenance;
    let approved_candidate = &approval_checkpoint.result.approval;
    if fetched_candidate.content_sha256 != target.expected_candidate_content_sha256
        || fetched_candidate.compiled_policy_fingerprint
            != target.expected_candidate_compiled_policy_fingerprint
        || fetched_candidate.source_url_fingerprint != target.expected_candidate_url_fingerprint
        || verified_provenance.content_sha256 != target.expected_candidate_content_sha256
        || verified_provenance.compiled_policy_fingerprint
            != target.expected_candidate_compiled_policy_fingerprint
        || verified_provenance.source_url_fingerprint != target.expected_candidate_url_fingerprint
        || verified_provenance.provenance_id != target.expected_provenance_id
        || verified_provenance.provenance_event_id != target.expected_provenance_event_id
        || verified_provenance.statement_sha256 != target.expected_provenance_statement_sha256
        || verified_provenance.signer_fingerprint != target.expected_signer_fingerprint
        || approved_candidate.approval_id != target.expected_approved_candidate_approval_id
        || approved_candidate.approval_event_id
            != target.expected_approved_candidate_approval_event_id
        || approved_candidate.candidate_id != target.expected_approved_candidate_id
        || approved_candidate.content_sha256 != target.expected_candidate_content_sha256
        || approved_candidate.compiled_policy_fingerprint
            != target.expected_candidate_compiled_policy_fingerprint
        || approved_candidate.source_url_fingerprint != target.expected_candidate_url_fingerprint
        || approved_candidate.provenance_id != target.expected_provenance_id
        || approved_candidate.provenance_event_id != target.expected_provenance_event_id
        || approved_candidate.statement_sha256 != target.expected_provenance_statement_sha256
        || approved_candidate.signer_fingerprint != target.expected_signer_fingerprint
    {
        return Err(
            "modepack selected approved candidate replacement failed: selected approved candidate evidence mismatch"
                .to_string(),
        );
    }
    let selection = store
        .read_modepack_registry_update_selection_snapshot(
            &target.expected_current_activation_fingerprint,
            &target.expected_candidate_content_sha256,
        )
        .map_err(|error| error.to_string())?
        .ok_or_else(|| {
            "modepack selected approved candidate replacement failed: registry selection evidence not found"
                .to_string()
        })?;
    let summary = selection.summary;
    if summary.selection_id != target.selection_id
        || summary.selection_event_id != target.selection_event_id
        || summary.candidate_url_fingerprint != target.expected_candidate_url_fingerprint
        || summary.candidate_content_sha256 != target.expected_candidate_content_sha256
        || summary.candidate_compiled_policy_fingerprint
            != target.expected_candidate_compiled_policy_fingerprint
        || summary.provenance_statement_url_fingerprint
            != target.expected_provenance_statement_url_fingerprint
        || summary.provenance_statement_sha256 != target.expected_provenance_statement_sha256
        || summary.signer_fingerprint != target.expected_signer_fingerprint
        || summary.current_activation_fingerprint != target.expected_current_activation_fingerprint
    {
        return Err(
            "modepack selected approved candidate replacement failed: registry selection evidence mismatch"
                .to_string(),
        );
    }
    let current = store
        .read_active_modepack_snapshot()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| {
            "modepack selected approved candidate replacement failed: active Mode Pack snapshot not found"
                .to_string()
        })?;
    if current.summary.activation_fingerprint != summary.current_activation_fingerprint
        || current.summary.modepack_name != summary.current_modepack_name
        || current.summary.source_kind != summary.current_source_kind
    {
        return Err(
            "modepack selected approved candidate replacement failed: active Mode Pack snapshot no longer matches registry selection"
                .to_string(),
        );
    }
    let cached = store
        .read_modepack_candidate_snapshot(&target.expected_candidate_content_sha256)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| {
            "modepack selected approved candidate replacement failed: cached candidate evidence not found"
                .to_string()
        })?;
    let mut replacement_result = replace_active_workspace_modepack(
        store,
        &ModePackReplaceActiveParams {
            authorize_replacement: true,
            expected_current_activation_fingerprint: target
                .expected_current_activation_fingerprint
                .clone(),
            expected_candidate_activation_fingerprint: target
                .expected_candidate_activation_fingerprint
                .clone(),
            approved_candidate_approval_id: Some(
                target.expected_approved_candidate_approval_id.clone(),
            ),
            expected_approved_candidate_content_sha256: Some(
                target.expected_candidate_content_sha256.clone(),
            ),
            expected_approved_candidate_compiled_policy_fingerprint: Some(
                target
                    .expected_candidate_compiled_policy_fingerprint
                    .clone(),
            ),
            expected_approved_candidate_id: Some(target.expected_approved_candidate_id.clone()),
            expected_approved_candidate_source_url_host: Some(
                approved_candidate.source_url_host.clone(),
            ),
            expected_approved_candidate_source_url_fingerprint: Some(
                target.expected_candidate_url_fingerprint.clone(),
            ),
            expected_approved_candidate_dns_resolution_fingerprint: Some(
                cached.summary.dns_binding.resolution_fingerprint.clone(),
            ),
            expected_approved_candidate_pinned_address_fingerprint: Some(
                cached
                    .summary
                    .dns_binding
                    .pinned_address_fingerprint
                    .clone(),
            ),
            expected_approved_candidate_approval_event_id: Some(
                target.expected_approved_candidate_approval_event_id.clone(),
            ),
            update_admission: Some(ModePackUpdateAdmissionParams {
                authorize_update: true,
                expected_current_modepack_name: summary.current_modepack_name.clone(),
                expected_current_source_kind: summary.current_source_kind.clone(),
                expected_approved_candidate_provenance_id: target.expected_provenance_id.clone(),
                expected_approved_candidate_provenance_event_id: target
                    .expected_provenance_event_id
                    .clone(),
                expected_approved_candidate_signer_fingerprint: target
                    .expected_signer_fingerprint
                    .clone(),
                expected_approved_candidate_statement_sha256: target
                    .expected_provenance_statement_sha256
                    .clone(),
                expected_trusted_signer_trust_id: approved_candidate
                    .trusted_signer_trust_id
                    .clone(),
                expected_trusted_signer_event_id: approved_candidate
                    .trusted_signer_event_id
                    .clone(),
            }),
        },
    )?;
    replacement_result.replayed = false;
    let post_tasks = store
        .tasks()
        .list_tasks()
        .map_err(|error| error.to_string())?;
    let post_progress = task_list_progress_overview(store, &post_tasks)?;
    let decision_id = format!("headless_decision_{}", uuid::Uuid::new_v4().simple());
    store
        .write_headless_modepack_selected_candidate_replacement_checkpoint(
            &HeadlessModePackSelectedCandidateReplacementCheckpoint {
                continuation_id: continuation_id.clone(),
                decision_id: decision_id.clone(),
                request_fingerprint: Some(request_fingerprint),
                fetch_continuation_id: target.fetch_continuation_id.clone(),
                expected_fetch_decision_id: target.expected_fetch_decision_id.clone(),
                provenance_verification_continuation_id: target
                    .provenance_verification_continuation_id
                    .clone(),
                expected_provenance_verification_decision_id: target
                    .expected_provenance_verification_decision_id
                    .clone(),
                approval_continuation_id: target.approval_continuation_id.clone(),
                expected_approval_decision_id: target.expected_approval_decision_id.clone(),
                expected_progress_fingerprint: params.expected_progress_fingerprint.clone(),
                expected_aggregate_sequence: params.expected_aggregate_sequence,
                current_progress_fingerprint: progress_overview.source_fingerprint.clone(),
                current_aggregate_sequence: progress_overview.aggregate_sequence,
                post_progress_fingerprint: post_progress.source_fingerprint.clone(),
                post_aggregate_sequence: post_progress.aggregate_sequence,
                selection_id: summary.selection_id,
                selection_event_id: summary.selection_event_id,
                result: replacement_result.clone(),
            },
        )
        .map_err(|error| error.to_string())?;
    let next_route = HeadlessContinueRoute {
        kind: HeadlessContinueRouteKind::RefreshProgressOverview,
        reason: "Replaced the active Mode Pack with the registry-selected approved candidate under explicit headless authorization.".to_string(),
        task_id: None,
        run_id: None,
        proposal_id: None,
        apply_id: None,
        failure_fingerprint: None,
        apply_fingerprint: None,
        progress_fingerprint: Some(post_progress.source_fingerprint.clone()),
        aggregate_sequence: Some(post_progress.aggregate_sequence),
        next_action: "refresh_progress_overview".to_string(),
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
        objective_proposal_authorization_preflight_result: None,
        objective_apply_verification_result: None,
        objective_completion_acceptance_result: None,
        llm_provider_failure_retry_admission: None,
        product_continuation_admission: None,
        modepack_select_registry_update_result: None,
        modepack_fetch_candidate_result: None,
        modepack_verify_candidate_provenance_result: None,
        modepack_approve_candidate_result: None,
        modepack_replace_active_result: Some(replacement_result),
        modepack_rollback_active_result: None,
        next_route: Some(next_route),
        max_steps: None,
        step_count: None,
        executed_count: None,
        replayed_count: None,
        stop_reason: None,
        steps: Vec::new(),
        next_action: "refresh_progress_overview".to_string(),
    })
}

pub(super) fn handle_headless_continue_modepack_selected_active_rollback(
    id: Value,
    store: &BrownieStore,
    progress_overview: &TaskListProgressOverview,
    params: HeadlessContinueOnceParams,
) -> JsonRpcResponse<Value> {
    let result = match headless_continue_modepack_selected_active_rollback(
        store,
        progress_overview,
        &params,
    ) {
        Ok(result) => result,
        Err(message) => return error_response(id, -32603, &format!("internal error: {message}")),
    };
    result_response(id, json!(result))
}

pub(super) fn headless_continue_modepack_selected_active_rollback_replay_result(
    id: Value,
    progress_overview: &TaskListProgressOverview,
    params: HeadlessContinueOnceParams,
    checkpoint: HeadlessModePackSelectedActiveRollbackCheckpoint,
) -> JsonRpcResponse<Value> {
    if let Err(message) =
        validate_headless_modepack_selected_active_rollback_replay_request(&params, &checkpoint)
    {
        return error_response(id, -32602, &message);
    }
    let mut rollback_result = checkpoint.result;
    rollback_result.rolled_back = false;
    rollback_result.replayed = true;
    let next_route = HeadlessContinueRoute {
        kind: HeadlessContinueRouteKind::RefreshProgressOverview,
        reason: "Selected active Mode Pack rollback was already completed by this continuation; replaying bounded rollback result.".to_string(),
        task_id: None,
        run_id: None,
        proposal_id: None,
        apply_id: None,
        failure_fingerprint: None,
        apply_fingerprint: None,
        progress_fingerprint: Some(progress_overview.source_fingerprint.clone()),
        aggregate_sequence: Some(progress_overview.aggregate_sequence),
        next_action: "refresh_progress_overview".to_string(),
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
            modepack_rollback_active_result: Some(rollback_result),
            next_route: Some(next_route),
            max_steps: None,
            step_count: None,
            executed_count: None,
            replayed_count: None,
            stop_reason: None,
            steps: Vec::new(),
            next_action: "refresh_progress_overview".to_string(),
        }),
    )
}

pub(super) fn headless_modepack_selected_active_rollback_request_fingerprint(
    params: &HeadlessContinueOnceParams,
) -> Result<String, String> {
    let target = params
        .modepack_selected_active_rollback_target
        .as_ref()
        .ok_or_else(|| "modepack selected active rollback target missing".to_string())?;
    let continuation_id = params.continuation_id.as_deref().ok_or_else(|| {
        "modepack selected active rollback failed: continuation_id is required".to_string()
    })?;
    let seed = json!({
        "route_kind": "modepack_selected_active_rollback",
        "continuation_id": continuation_id,
        "authorize": params.authorize,
        "authorize_selected_active_modepack_rollback": target.authorize_selected_active_modepack_rollback,
        "expected_progress_fingerprint": params.expected_progress_fingerprint,
        "expected_aggregate_sequence": params.expected_aggregate_sequence,
        "replacement_event_id": target.replacement_event_id,
        "expected_current_activation_fingerprint": target.expected_current_activation_fingerprint,
        "expected_rollback_activation_fingerprint": target.expected_rollback_activation_fingerprint,
    });
    Ok(format!(
        "sha256:{}",
        hex_sha256(seed.to_string().as_bytes())
    ))
}

pub(super) fn validate_headless_modepack_selected_active_rollback_replay_request(
    params: &HeadlessContinueOnceParams,
    checkpoint: &HeadlessModePackSelectedActiveRollbackCheckpoint,
) -> Result<(), String> {
    let current = headless_modepack_selected_active_rollback_request_fingerprint(params)?;
    match checkpoint.request_fingerprint.as_deref() {
        Some(stored) if stored == current => Ok(()),
        Some(_) => Err(
            "invalid params: headless selected active modepack rollback continuation request identity mismatch"
                .to_string(),
        ),
        None => Err(
            "invalid params: headless selected active modepack rollback checkpoint is missing request identity fingerprint"
                .to_string(),
        ),
    }
}

pub(super) fn validate_selected_active_rollback_target(
    target: &ModePackSelectedActiveRollbackTarget,
) -> Result<(), String> {
    if !target.authorize_selected_active_modepack_rollback {
        return Err("modepack selected active rollback failed: authorization required".to_string());
    }
    if target.replacement_event_id.trim().is_empty() {
        return Err(
            "modepack selected active rollback failed: replacement_event_id is required"
                .to_string(),
        );
    }
    for (field, value) in [
        (
            "expected_current_activation_fingerprint",
            target.expected_current_activation_fingerprint.as_str(),
        ),
        (
            "expected_rollback_activation_fingerprint",
            target.expected_rollback_activation_fingerprint.as_str(),
        ),
    ] {
        if !is_sha256_fingerprint(value) {
            return Err(format!(
                "modepack selected active rollback failed: {field} must be a sha256 fingerprint"
            ));
        }
    }
    if target.expected_current_activation_fingerprint
        == target.expected_rollback_activation_fingerprint
    {
        return Err(
            "modepack selected active rollback failed: current and rollback fingerprints must differ"
                .to_string(),
        );
    }
    Ok(())
}

pub(super) fn headless_continue_modepack_selected_active_rollback(
    store: &BrownieStore,
    progress_overview: &TaskListProgressOverview,
    params: &HeadlessContinueOnceParams,
) -> Result<HeadlessContinueOnceResult, String> {
    let target = params
        .modepack_selected_active_rollback_target
        .as_ref()
        .ok_or_else(|| "modepack selected active rollback target missing".to_string())?;
    validate_selected_active_rollback_target(target)?;
    let continuation_id = params.continuation_id.clone().ok_or_else(|| {
        "modepack selected active rollback failed: continuation_id is required".to_string()
    })?;
    let request_fingerprint =
        headless_modepack_selected_active_rollback_request_fingerprint(params)?;
    if !store
        .active_modepack_replacement_event_matches(
            &target.replacement_event_id,
            &target.expected_current_activation_fingerprint,
            &target.expected_rollback_activation_fingerprint,
        )
        .map_err(|error| error.to_string())?
    {
        return Err(
            "modepack selected active rollback failed: replacement event evidence mismatch"
                .to_string(),
        );
    }
    let current = store
        .read_active_modepack_snapshot()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| {
            "modepack selected active rollback failed: active Mode Pack snapshot not found"
                .to_string()
        })?;
    if current.summary.activation_fingerprint != target.expected_current_activation_fingerprint {
        return Err(
            "modepack selected active rollback failed: active Mode Pack snapshot no longer matches replacement evidence"
                .to_string(),
        );
    }
    let mut rollback_result = rollback_active_workspace_modepack(
        store,
        &ModePackRollbackActiveParams {
            authorize_rollback: true,
            expected_current_activation_fingerprint: target
                .expected_current_activation_fingerprint
                .clone(),
            expected_rollback_activation_fingerprint: target
                .expected_rollback_activation_fingerprint
                .clone(),
        },
    )?;
    rollback_result.replayed = false;
    let post_tasks = store
        .tasks()
        .list_tasks()
        .map_err(|error| error.to_string())?;
    let post_progress = task_list_progress_overview(store, &post_tasks)?;
    let decision_id = format!("headless_decision_{}", uuid::Uuid::new_v4().simple());
    store
        .write_headless_modepack_selected_active_rollback_checkpoint(
            &HeadlessModePackSelectedActiveRollbackCheckpoint {
                continuation_id: continuation_id.clone(),
                decision_id: decision_id.clone(),
                request_fingerprint: Some(request_fingerprint),
                replacement_event_id: target.replacement_event_id.clone(),
                expected_progress_fingerprint: params.expected_progress_fingerprint.clone(),
                expected_aggregate_sequence: params.expected_aggregate_sequence,
                current_progress_fingerprint: progress_overview.source_fingerprint.clone(),
                current_aggregate_sequence: progress_overview.aggregate_sequence,
                post_progress_fingerprint: post_progress.source_fingerprint.clone(),
                post_aggregate_sequence: post_progress.aggregate_sequence,
                expected_current_activation_fingerprint: target
                    .expected_current_activation_fingerprint
                    .clone(),
                expected_rollback_activation_fingerprint: target
                    .expected_rollback_activation_fingerprint
                    .clone(),
                result: rollback_result.clone(),
            },
        )
        .map_err(|error| error.to_string())?;
    let next_route = HeadlessContinueRoute {
        kind: HeadlessContinueRouteKind::RefreshProgressOverview,
        reason: "Rolled back the selected active Mode Pack replacement under explicit headless authorization.".to_string(),
        task_id: None,
        run_id: None,
        proposal_id: None,
        apply_id: None,
        failure_fingerprint: None,
        apply_fingerprint: None,
        progress_fingerprint: Some(post_progress.source_fingerprint.clone()),
        aggregate_sequence: Some(post_progress.aggregate_sequence),
        next_action: "refresh_progress_overview".to_string(),
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
        modepack_rollback_active_result: Some(rollback_result),
        next_route: Some(next_route),
        max_steps: None,
        step_count: None,
        executed_count: None,
        replayed_count: None,
        stop_reason: None,
        steps: Vec::new(),
        next_action: "refresh_progress_overview".to_string(),
    })
}

pub(super) fn handle_modepack_activate(id: Value, params: Option<Value>) -> JsonRpcResponse<Value> {
    let params: ModePackActivateParams = match parse_params(params) {
        Ok(params) => params,
        Err(message) => return error_response(id, -32602, &message),
    };
    if !params.authorize {
        return error_response(
            id,
            -32602,
            "invalid params: activation authorization required",
        );
    }
    let store = match BrownieStore::from_env_or_cwd() {
        Ok(store) => store,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    let result = match activate_workspace_modepack(&store) {
        Ok(result) => result,
        Err(message) => return error_response(id, -32603, &format!("internal error: {message}")),
    };
    result_response(id, json!(result))
}

pub(super) fn handle_modepack_fetch_candidate(
    id: Value,
    params: Option<Value>,
) -> JsonRpcResponse<Value> {
    let params: ModePackFetchCandidateParams = match parse_params(params) {
        Ok(params) => params,
        Err(message) => return error_response(id, -32602, &message),
    };
    if !params.authorize_fetch {
        return error_response(
            id,
            -32602,
            "invalid params: remote Mode Pack candidate fetch authorization required",
        );
    }
    if let Some(expected) = params.expected_content_sha256.as_deref() {
        if !is_sha256_fingerprint(expected) {
            return error_response(
                id,
                -32602,
                "invalid params: expected_content_sha256 must be a sha256 fingerprint",
            );
        }
    }
    let store = match BrownieStore::from_env_or_cwd() {
        Ok(store) => store,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    let result = match fetch_remote_modepack_candidate(&store, &params) {
        Ok(result) => result,
        Err(message) => return error_response(id, -32603, &format!("internal error: {message}")),
    };
    result_response(id, json!(result))
}

pub(super) fn handle_modepack_select_registry_update(
    id: Value,
    params: Option<Value>,
) -> JsonRpcResponse<Value> {
    let params: ModePackSelectRegistryUpdateParams = match parse_params(params) {
        Ok(params) => params,
        Err(message) => return error_response(id, -32602, &message),
    };
    if !params.authorize_registry_selection {
        return error_response(
            id,
            -32602,
            "invalid params: Mode Pack registry update selection authorization required",
        );
    }
    if !params.authorize_registry_trust {
        return error_response(
            id,
            -32602,
            "invalid params: Mode Pack registry trust authorization required",
        );
    }
    if !is_sha256_fingerprint(&params.expected_registry_manifest_sha256) {
        return error_response(
            id,
            -32602,
            "invalid params: expected_registry_manifest_sha256 must be a sha256 fingerprint",
        );
    }
    if !is_sha256_fingerprint(&params.expected_registry_provenance_statement_sha256) {
        return error_response(
            id,
            -32602,
            "invalid params: expected_registry_provenance_statement_sha256 must be a sha256 fingerprint",
        );
    }
    if !is_sha256_fingerprint(&params.expected_registry_signer_fingerprint) {
        return error_response(
            id,
            -32602,
            "invalid params: expected_registry_signer_fingerprint must be a sha256 fingerprint",
        );
    }
    if !is_sha256_fingerprint(&params.expected_current_activation_fingerprint) {
        return error_response(
            id,
            -32602,
            "invalid params: expected_current_activation_fingerprint must be a sha256 fingerprint",
        );
    }
    let store = match BrownieStore::from_env_or_cwd() {
        Ok(store) => store,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    let result = match select_modepack_registry_update(&store, &params) {
        Ok(result) => result,
        Err(message) => return error_response(id, -32603, &format!("internal error: {message}")),
    };
    result_response(id, json!(result))
}

pub(super) fn handle_modepack_approve_candidate(
    id: Value,
    params: Option<Value>,
) -> JsonRpcResponse<Value> {
    let params: ModePackApproveCandidateParams = match parse_params(params) {
        Ok(params) => params,
        Err(message) => return error_response(id, -32602, &message),
    };
    if !params.authorize_trust {
        return error_response(
            id,
            -32602,
            "invalid params: remote Mode Pack candidate trust authorization required",
        );
    }
    if !is_sha256_fingerprint(&params.expected_content_sha256) {
        return error_response(
            id,
            -32602,
            "invalid params: expected_content_sha256 must be a sha256 fingerprint",
        );
    }
    if !is_sha256_fingerprint(&params.expected_compiled_policy_fingerprint) {
        return error_response(
            id,
            -32602,
            "invalid params: expected_compiled_policy_fingerprint must be a sha256 fingerprint",
        );
    }
    if params.expected_provenance_id.trim().is_empty() {
        return error_response(
            id,
            -32602,
            "invalid params: expected_provenance_id is required",
        );
    }
    if params.expected_provenance_event_id.trim().is_empty() {
        return error_response(
            id,
            -32602,
            "invalid params: expected_provenance_event_id is required",
        );
    }
    if !is_sha256_fingerprint(&params.expected_signer_fingerprint) {
        return error_response(
            id,
            -32602,
            "invalid params: expected_signer_fingerprint must be a sha256 fingerprint",
        );
    }
    if !is_sha256_fingerprint(&params.expected_statement_sha256) {
        return error_response(
            id,
            -32602,
            "invalid params: expected_statement_sha256 must be a sha256 fingerprint",
        );
    }
    let store = match BrownieStore::from_env_or_cwd() {
        Ok(store) => store,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    let result = match approve_remote_modepack_candidate(&store, &params) {
        Ok(result) => result,
        Err(message) => return error_response(id, -32603, &format!("internal error: {message}")),
    };
    result_response(id, json!(result))
}

pub(super) fn handle_modepack_trust_signer(
    id: Value,
    params: Option<Value>,
) -> JsonRpcResponse<Value> {
    let params: ModePackTrustSignerParams = match parse_params(params) {
        Ok(params) => params,
        Err(message) => return error_response(id, -32602, &message),
    };
    if !params.authorize_trust {
        return error_response(
            id,
            -32602,
            "invalid params: Mode Pack signer trust authorization required",
        );
    }
    if !is_sha256_fingerprint(&params.signer_fingerprint) {
        return error_response(
            id,
            -32602,
            "invalid params: signer_fingerprint must be a sha256 fingerprint",
        );
    }
    if let Some(expires_at) = params.expires_at.as_deref() {
        match parse_modepack_signer_trust_expiry(expires_at) {
            Ok(expires_at) if expires_at <= time::OffsetDateTime::now_utc() => {
                return error_response(
                    id,
                    -32602,
                    "invalid params: signer trust expires_at must be in the future",
                );
            }
            Ok(_) => {}
            Err(message) => return error_response(id, -32602, &message),
        }
    }
    let store = match BrownieStore::from_env_or_cwd() {
        Ok(store) => store,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    let result = match trust_modepack_signer(&store, &params) {
        Ok(result) => result,
        Err(message) => return error_response(id, -32603, &format!("internal error: {message}")),
    };
    result_response(id, json!(result))
}

pub(super) fn handle_modepack_revoke_signer(
    id: Value,
    params: Option<Value>,
) -> JsonRpcResponse<Value> {
    let params: ModePackRevokeSignerParams = match parse_params(params) {
        Ok(params) => params,
        Err(message) => return error_response(id, -32602, &message),
    };
    if !params.authorize_revocation {
        return error_response(
            id,
            -32602,
            "invalid params: Mode Pack signer revocation authorization required",
        );
    }
    if !is_sha256_fingerprint(&params.signer_fingerprint) {
        return error_response(
            id,
            -32602,
            "invalid params: signer_fingerprint must be a sha256 fingerprint",
        );
    }
    let store = match BrownieStore::from_env_or_cwd() {
        Ok(store) => store,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    let result = match revoke_modepack_signer(&store, &params) {
        Ok(result) => result,
        Err(message) => return error_response(id, -32603, &format!("internal error: {message}")),
    };
    result_response(id, json!(result))
}

pub(super) fn handle_modepack_verify_candidate_provenance(
    id: Value,
    params: Option<Value>,
) -> JsonRpcResponse<Value> {
    let params: ModePackVerifyCandidateProvenanceParams = match parse_params(params) {
        Ok(params) => params,
        Err(message) => return error_response(id, -32602, &message),
    };
    if !params.authorize_provenance_verification {
        return error_response(
            id,
            -32602,
            "invalid params: Mode Pack provenance verification authorization required",
        );
    }
    if !is_sha256_fingerprint(&params.expected_content_sha256) {
        return error_response(
            id,
            -32602,
            "invalid params: expected_content_sha256 must be a sha256 fingerprint",
        );
    }
    if !is_sha256_fingerprint(&params.expected_compiled_policy_fingerprint) {
        return error_response(
            id,
            -32602,
            "invalid params: expected_compiled_policy_fingerprint must be a sha256 fingerprint",
        );
    }
    if !is_sha256_fingerprint(&params.expected_signer_fingerprint) {
        return error_response(
            id,
            -32602,
            "invalid params: expected_signer_fingerprint must be a sha256 fingerprint",
        );
    }
    let store = match BrownieStore::from_env_or_cwd() {
        Ok(store) => store,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    let result = match verify_modepack_candidate_provenance(&store, &params) {
        Ok(result) => result,
        Err(message) => return error_response(id, -32603, &format!("internal error: {message}")),
    };
    result_response(id, json!(result))
}

pub(super) fn handle_modepack_replace_active(
    id: Value,
    params: Option<Value>,
) -> JsonRpcResponse<Value> {
    let params: ModePackReplaceActiveParams = match parse_params(params) {
        Ok(params) => params,
        Err(message) => return error_response(id, -32602, &message),
    };
    if !params.authorize_replacement {
        return error_response(
            id,
            -32602,
            "invalid params: active Mode Pack replacement authorization required",
        );
    }
    if !is_sha256_fingerprint(&params.expected_current_activation_fingerprint) {
        return error_response(
            id,
            -32602,
            "invalid params: expected_current_activation_fingerprint must be a sha256 fingerprint",
        );
    }
    if !is_sha256_fingerprint(&params.expected_candidate_activation_fingerprint) {
        return error_response(
            id,
            -32602,
            "invalid params: expected_candidate_activation_fingerprint must be a sha256 fingerprint",
        );
    }
    if let Some(expected) = params.expected_approved_candidate_content_sha256.as_deref() {
        if !is_sha256_fingerprint(expected) {
            return error_response(
                id,
                -32602,
                "invalid params: expected_approved_candidate_content_sha256 must be a sha256 fingerprint",
            );
        }
    }
    if let Some(expected) = params
        .expected_approved_candidate_compiled_policy_fingerprint
        .as_deref()
    {
        if !is_sha256_fingerprint(expected) {
            return error_response(
                id,
                -32602,
                "invalid params: expected_approved_candidate_compiled_policy_fingerprint must be a sha256 fingerprint",
            );
        }
    }
    if let Some(expected) = params
        .expected_approved_candidate_source_url_fingerprint
        .as_deref()
    {
        if !is_sha256_fingerprint(expected) {
            return error_response(
                id,
                -32602,
                "invalid params: expected_approved_candidate_source_url_fingerprint must be a sha256 fingerprint",
            );
        }
    }
    if let Some(expected) = params
        .expected_approved_candidate_dns_resolution_fingerprint
        .as_deref()
    {
        if !is_sha256_fingerprint(expected) {
            return error_response(
                id,
                -32602,
                "invalid params: expected_approved_candidate_dns_resolution_fingerprint must be a sha256 fingerprint",
            );
        }
    }
    if let Some(expected) = params
        .expected_approved_candidate_pinned_address_fingerprint
        .as_deref()
    {
        if !is_sha256_fingerprint(expected) {
            return error_response(
                id,
                -32602,
                "invalid params: expected_approved_candidate_pinned_address_fingerprint must be a sha256 fingerprint",
            );
        }
    }
    let store = match BrownieStore::from_env_or_cwd() {
        Ok(store) => store,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    let result = match replace_active_workspace_modepack(&store, &params) {
        Ok(result) => result,
        Err(message) => return error_response(id, -32603, &format!("internal error: {message}")),
    };
    result_response(id, json!(result))
}

pub(super) fn handle_modepack_rollback_active(
    id: Value,
    params: Option<Value>,
) -> JsonRpcResponse<Value> {
    let params: ModePackRollbackActiveParams = match parse_params(params) {
        Ok(params) => params,
        Err(message) => return error_response(id, -32602, &message),
    };
    if !params.authorize_rollback {
        return error_response(
            id,
            -32602,
            "invalid params: active Mode Pack rollback authorization required",
        );
    }
    if !is_sha256_fingerprint(&params.expected_current_activation_fingerprint) {
        return error_response(
            id,
            -32602,
            "invalid params: expected_current_activation_fingerprint must be a sha256 fingerprint",
        );
    }
    if !is_sha256_fingerprint(&params.expected_rollback_activation_fingerprint) {
        return error_response(
            id,
            -32602,
            "invalid params: expected_rollback_activation_fingerprint must be a sha256 fingerprint",
        );
    }
    let store = match BrownieStore::from_env_or_cwd() {
        Ok(store) => store,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    let result = match rollback_active_workspace_modepack(&store, &params) {
        Ok(result) => result,
        Err(message) => return error_response(id, -32603, &format!("internal error: {message}")),
    };
    result_response(id, json!(result))
}

pub(super) fn fetch_remote_modepack_candidate(
    store: &BrownieStore,
    params: &ModePackFetchCandidateParams,
) -> Result<ModePackFetchCandidateResult, String> {
    fetch_remote_modepack_candidate_with_resolver(
        store,
        params,
        default_modepack_dns_resolver,
        fetch_modepack_url,
    )
}

#[cfg(test)]
pub(super) fn fetch_remote_modepack_candidate_with<F>(
    store: &BrownieStore,
    params: &ModePackFetchCandidateParams,
    mut fetcher: F,
) -> Result<ModePackFetchCandidateResult, String>
where
    F: FnMut(&RemoteModePackFetchBinding) -> Result<RemoteModePackFetchResponse, String>,
{
    fetch_remote_modepack_candidate_with_resolver(
        store,
        params,
        test_modepack_dns_resolver,
        &mut fetcher,
    )
}

pub(super) fn fetch_remote_modepack_candidate_with_resolver<R, F>(
    store: &BrownieStore,
    params: &ModePackFetchCandidateParams,
    resolver: R,
    mut fetcher: F,
) -> Result<ModePackFetchCandidateResult, String>
where
    R: Fn(&str) -> Result<Vec<SocketAddr>, String>,
    F: FnMut(&RemoteModePackFetchBinding) -> Result<RemoteModePackFetchResponse, String>,
{
    let binding = create_modepack_fetch_binding_with(&params.url, resolver)?;
    let response = fetcher(&binding)?;
    if response.status != 200 {
        return Err(format!(
            "modepack candidate fetch failed: unsupported HTTP status {}",
            response.status
        ));
    }
    if !modepack_candidate_content_type_allowed(response.content_type.as_deref()) {
        return Err("modepack candidate fetch failed: unsupported content type".to_string());
    }
    if response.body.len() > MODEPACK_REMOTE_FETCH_MAX_BYTES {
        return Err("modepack candidate fetch failed: response exceeds byte limit".to_string());
    }
    let content_sha256 = format!("sha256:{}", hex_sha256(&response.body));
    if let Some(expected) = params.expected_content_sha256.as_deref() {
        if expected != content_sha256 {
            return Err(format!(
                "modepack candidate fetch failed: content fingerprint mismatch: expected {expected} but found {content_sha256}"
            ));
        }
    }
    let body = String::from_utf8(response.body)
        .map_err(|_| "modepack candidate fetch failed: response is not UTF-8".to_string())?;
    if scan_text_for_sensitive_content(&body) {
        return Err(
            "modepack candidate fetch failed: response contains sensitive-like content".to_string(),
        );
    }
    let snapshot = load_modepack_from_str_with_options(
        &body,
        MODEPACK_CANDIDATE_CACHE_SOURCE_PATH,
        ModePackLoadOptions::trusted_local_developer(),
    )
    .map_err(|error| format!("modepack candidate compile failed: {error}"))?;
    let policies = snapshot
        .modes
        .iter()
        .map(|policy| ActiveModePackPolicySnapshot {
            mode_id: policy.mode_id.clone(),
            display_name: policy.display_name.clone(),
            role_definition: policy.role_definition.clone(),
            when_to_use: policy.when_to_use.clone(),
            description: policy.description.clone(),
            prompt_sections: mode_prompt_sections_payload(policy),
            verification_responsibility: policy.verification_responsibility.clone(),
            instruction_fingerprint: policy.instruction_fingerprint.clone(),
            permissions: mode_permissions_payload(policy),
            workspace_write_scopes: mode_workspace_write_scopes_payload(policy),
            allowed_handoff_targets: policy.allowed_handoff_targets.clone(),
            mcp_access: mode_mcp_access_payload(policy),
            completion_rules: policy.completion_rules.clone(),
            policy_fingerprint: external_modepack_policy_fingerprint(
                &snapshot.name,
                snapshot.schema_version,
                policy,
            ),
        })
        .collect::<Vec<_>>();
    let mode_ids = policies
        .iter()
        .map(|policy| policy.mode_id.clone())
        .collect::<Vec<_>>();
    let global_policy_artifacts = modepack_global_policy_artifacts_payload(&snapshot);
    let compiled_policy_fingerprint = active_modepack_compiled_policy_fingerprint(
        &snapshot.name,
        snapshot.schema_version,
        snapshot.entrypoints.default_mode_id(),
        &global_policy_artifacts,
        &policies,
    );
    let summary = ModePackCandidateSummary {
        candidate_id: format!("modepack_candidate_{}", &content_sha256[7..23]),
        source_kind: "remote_https".to_string(),
        source_url_host: binding.url.host_str().unwrap_or_default().to_string(),
        source_url_fingerprint: format!("sha256:{}", hex_sha256(binding.url.as_str().as_bytes())),
        dns_binding: binding.summary,
        content_sha256,
        byte_count: body.len(),
        modepack_name: snapshot.name,
        schema_version: snapshot.schema_version,
        mode_count: mode_ids.len(),
        mode_ids,
        default_entrypoint: snapshot.entrypoints.default.clone(),
        compiled_policy_fingerprint,
        cached_at: codebase_index_timestamp().map_err(|error| error.to_string())?,
        cache_event_id: String::new(),
    };
    let candidate_snapshot = ModePackCandidateSnapshot {
        summary,
        modepack_json: body,
    };
    let committed = store
        .commit_modepack_candidate_snapshot(&candidate_snapshot)
        .map_err(|error| format!("modepack candidate cache failed: {error}"))?;
    Ok(ModePackFetchCandidateResult {
        fetched: !committed.replayed,
        replayed: committed.replayed,
        candidate: committed.snapshot.summary,
        next_action: "review_candidate_then_replace_active_modepack".to_string(),
    })
}

pub(super) fn selected_candidate_provenance_material_from_response(
    response: RemoteModePackFetchResponse,
    expected_statement_sha256: &str,
    expected_signer_fingerprint: &str,
) -> Result<SelectedCandidateProvenanceMaterial, String> {
    if response.status != 200 {
        return Err(format!(
            "modepack selected candidate fetch failed: provenance statement unsupported HTTP status {}",
            response.status
        ));
    }
    if !modepack_candidate_content_type_allowed(response.content_type.as_deref()) {
        return Err(
            "modepack selected candidate fetch failed: provenance statement unsupported content type"
                .to_string(),
        );
    }
    if response.body.len() > MODEPACK_PROVENANCE_STATEMENT_MAX_BYTES {
        return Err(
            "modepack selected candidate fetch failed: provenance statement exceeds byte limit"
                .to_string(),
        );
    }
    let body = String::from_utf8(response.body).map_err(|_| {
        "modepack selected candidate fetch failed: provenance statement response is not UTF-8"
            .to_string()
    })?;
    if scan_text_for_sensitive_content(&body) {
        return Err(
            "modepack selected candidate fetch failed: provenance statement response contains sensitive-like content"
                .to_string(),
        );
    }
    let material: SelectedCandidateProvenanceMaterial =
        serde_json::from_str(&body).map_err(|error| {
            format!(
                "modepack selected candidate fetch failed: invalid provenance statement response JSON: {error}"
            )
        })?;
    if material.provenance_statement_json.as_bytes().len() > MODEPACK_PROVENANCE_STATEMENT_MAX_BYTES
    {
        return Err(
            "modepack selected candidate fetch failed: provenance statement exceeds byte limit"
                .to_string(),
        );
    }
    if scan_text_for_sensitive_content(&material.provenance_statement_json) {
        return Err(
            "modepack selected candidate fetch failed: provenance statement contains sensitive-like content"
                .to_string(),
        );
    }
    let statement_sha256 = format!(
        "sha256:{}",
        hex_sha256(material.provenance_statement_json.as_bytes())
    );
    if statement_sha256 != expected_statement_sha256 {
        return Err(
            "modepack selected candidate fetch failed: provenance statement fingerprint mismatch"
                .to_string(),
        );
    }
    let public_key_bytes = general_purpose::STANDARD
        .decode(&material.provenance_public_key_base64)
        .map_err(|_| {
            "modepack selected candidate fetch failed: provenance public key is not base64"
                .to_string()
        })?;
    if public_key_bytes.len() != 32 {
        return Err(
            "modepack selected candidate fetch failed: provenance public key must be 32 bytes"
                .to_string(),
        );
    }
    let signer_fingerprint = format!("sha256:{}", hex_sha256(&public_key_bytes));
    if signer_fingerprint != expected_signer_fingerprint {
        return Err(
            "modepack selected candidate fetch failed: provenance signer fingerprint mismatch"
                .to_string(),
        );
    }
    let signature_bytes = general_purpose::STANDARD
        .decode(&material.provenance_signature_base64)
        .map_err(|_| {
            "modepack selected candidate fetch failed: provenance signature is not base64"
                .to_string()
        })?;
    if signature_bytes.len() != 64 {
        return Err(
            "modepack selected candidate fetch failed: provenance signature must be 64 bytes"
                .to_string(),
        );
    }
    Ok(material)
}

pub(super) fn select_modepack_registry_update(
    store: &BrownieStore,
    params: &ModePackSelectRegistryUpdateParams,
) -> Result<ModePackSelectRegistryUpdateResult, String> {
    select_modepack_registry_update_with_resolver(
        store,
        params,
        default_modepack_dns_resolver,
        fetch_modepack_url,
    )
}

#[cfg(test)]
pub(super) fn select_modepack_registry_update_with<F>(
    store: &BrownieStore,
    params: &ModePackSelectRegistryUpdateParams,
    fetcher: F,
) -> Result<ModePackSelectRegistryUpdateResult, String>
where
    F: FnOnce(&RemoteModePackFetchBinding) -> Result<RemoteModePackFetchResponse, String>,
{
    select_modepack_registry_update_with_resolver(
        store,
        params,
        test_modepack_dns_resolver,
        fetcher,
    )
}

pub(super) fn select_modepack_registry_update_with_resolver<R, F>(
    store: &BrownieStore,
    params: &ModePackSelectRegistryUpdateParams,
    resolver: R,
    fetcher: F,
) -> Result<ModePackSelectRegistryUpdateResult, String>
where
    R: FnOnce(&str) -> Result<Vec<SocketAddr>, String>,
    F: FnOnce(&RemoteModePackFetchBinding) -> Result<RemoteModePackFetchResponse, String>,
{
    let registry_binding = create_modepack_fetch_binding_with(&params.registry_url, resolver)?;
    let registry_url = &registry_binding.url;
    let current = store
        .read_active_modepack_snapshot()
        .map_err(|error| format!("modepack registry update selection failed: {error}"))?
        .ok_or_else(|| {
            "modepack registry update selection failed: active Mode Pack snapshot not found"
                .to_string()
        })?;
    if current.summary.activation_fingerprint != params.expected_current_activation_fingerprint {
        return Err(format!(
            "modepack registry update selection failed: current activation fingerprint mismatch: expected {} but found {}",
            params.expected_current_activation_fingerprint,
            current.summary.activation_fingerprint
        ));
    }
    if current.summary.source_kind != "remote_https_candidate" {
        return Err(
            "modepack registry update selection failed: active Mode Pack is not a remote HTTPS candidate"
                .to_string(),
        );
    }

    let response = fetcher(&registry_binding)?;
    if response.status != 200 {
        return Err(format!(
            "modepack registry update selection failed: unsupported HTTP status {}",
            response.status
        ));
    }
    if !modepack_candidate_content_type_allowed(response.content_type.as_deref()) {
        return Err(
            "modepack registry update selection failed: unsupported content type".to_string(),
        );
    }
    if response.body.len() > MODEPACK_REMOTE_FETCH_MAX_BYTES {
        return Err(
            "modepack registry update selection failed: manifest exceeds byte limit".to_string(),
        );
    }
    let registry_manifest_sha256 = format!("sha256:{}", hex_sha256(&response.body));
    if registry_manifest_sha256 != params.expected_registry_manifest_sha256 {
        return Err(format!(
            "modepack registry update selection failed: manifest fingerprint mismatch: expected {} but found {}",
            params.expected_registry_manifest_sha256, registry_manifest_sha256
        ));
    }
    let body = String::from_utf8(response.body).map_err(|_| {
        "modepack registry update selection failed: manifest is not UTF-8".to_string()
    })?;
    if scan_text_for_sensitive_content(&body) {
        return Err(
            "modepack registry update selection failed: manifest contains sensitive-like content"
                .to_string(),
        );
    }
    let manifest: ModePackRegistryManifest = serde_json::from_str(&body).map_err(|error| {
        format!("modepack registry update selection failed: invalid manifest JSON: {error}")
    })?;
    if manifest.schema_version != 1 {
        return Err(
            "modepack registry update selection failed: unsupported manifest schema_version"
                .to_string(),
        );
    }
    if manifest.entries.is_empty() || manifest.entries.len() > 32 {
        return Err(
            "modepack registry update selection failed: manifest entry count is out of range"
                .to_string(),
        );
    }

    let mut matches = Vec::new();
    for entry in manifest.entries {
        validate_modepack_registry_manifest_entry(&entry)?;
        let candidate_url = validate_modepack_fetch_url(&entry.candidate_url, false)?;
        let provenance_statement_url =
            validate_modepack_fetch_url(&entry.provenance_statement_url, false)?;
        if entry.modepack_name == current.summary.modepack_name
            && entry.source_kind == current.summary.source_kind
        {
            matches.push((entry, candidate_url, provenance_statement_url));
        }
    }
    if matches.is_empty() {
        return Err(
            "modepack registry update selection failed: no entry matches the active Mode Pack"
                .to_string(),
        );
    }
    if matches.len() > 1 {
        return Err(
            "modepack registry update selection failed: manifest contains duplicate matching entries"
                .to_string(),
        );
    }

    let (entry, candidate_url, provenance_statement_url) = matches.remove(0);
    if modepack_registry_entry_matches_active_candidate(&entry, &current.summary) {
        return Err(
            "modepack registry update selection failed: candidate identity matches the active Mode Pack"
                .to_string(),
        );
    }
    let registry_url_fingerprint =
        format!("sha256:{}", hex_sha256(registry_url.as_str().as_bytes()));
    let candidate_url_fingerprint =
        format!("sha256:{}", hex_sha256(candidate_url.as_str().as_bytes()));
    let provenance_statement_url_fingerprint = format!(
        "sha256:{}",
        hex_sha256(provenance_statement_url.as_str().as_bytes())
    );
    let registry_trust = verify_modepack_registry_manifest_trust(
        store,
        params,
        &current.summary,
        &registry_binding.summary,
        &registry_url_fingerprint,
        &registry_manifest_sha256,
        &entry,
        &candidate_url_fingerprint,
        &provenance_statement_url_fingerprint,
    )?;
    let selected_at = codebase_index_timestamp().map_err(|error| error.to_string())?;
    let selection_id_inputs = json!({
        "version": "modepack_registry_update_selection_id_v1",
        "current_activation_fingerprint": current.summary.activation_fingerprint,
        "registry_manifest_sha256": registry_manifest_sha256,
        "registry_provenance_statement_sha256": registry_trust.statement_sha256,
        "registry_signer_fingerprint": registry_trust.signer_fingerprint,
        "candidate_content_sha256": entry.candidate_content_sha256,
    });
    let selection_id = format!(
        "modepack_registry_selection_{}",
        &hex_sha256(selection_id_inputs.to_string().as_bytes())[..16]
    );
    let selection = ModePackRegistryUpdateSelectionSummary {
        selection_id,
        registry_url_host: registry_url.host_str().unwrap_or_default().to_string(),
        registry_url_fingerprint,
        registry_dns_binding: registry_binding.summary,
        registry_manifest_sha256,
        registry_provenance_statement_sha256: registry_trust.statement_sha256,
        registry_signer_fingerprint: registry_trust.signer_fingerprint,
        registry_trusted_signer_trust_id: registry_trust.trusted_signer_trust_id,
        registry_trusted_signer_event_id: registry_trust.trusted_signer_event_id,
        current_activation_fingerprint: current.summary.activation_fingerprint,
        current_modepack_name: current.summary.modepack_name,
        current_source_kind: current.summary.source_kind,
        candidate_url: candidate_url.as_str().to_string(),
        candidate_url_host: candidate_url.host_str().unwrap_or_default().to_string(),
        candidate_url_fingerprint,
        candidate_content_sha256: entry.candidate_content_sha256,
        candidate_compiled_policy_fingerprint: entry.candidate_compiled_policy_fingerprint,
        provenance_statement_url: provenance_statement_url.as_str().to_string(),
        provenance_statement_url_host: provenance_statement_url
            .host_str()
            .unwrap_or_default()
            .to_string(),
        provenance_statement_url_fingerprint,
        provenance_statement_sha256: entry.provenance_statement_sha256,
        signer_fingerprint: entry.signer_fingerprint,
        selected_at,
        selection_event_id: String::new(),
    };
    let committed = store
        .commit_modepack_registry_update_selection_snapshot(
            &ModePackRegistryUpdateSelectionSnapshot { summary: selection },
        )
        .map_err(|error| format!("modepack registry update selection failed: {error}"))?;
    Ok(ModePackSelectRegistryUpdateResult {
        selected: !committed.replayed,
        replayed: committed.replayed,
        selection: committed.selection.summary,
        next_action: "fetch_selected_modepack_candidate".to_string(),
    })
}

pub(super) fn modepack_registry_entry_matches_active_candidate(
    entry: &ModePackRegistryManifestEntry,
    current: &ModePackActiveSnapshotSummary,
) -> bool {
    entry.modepack_name == current.modepack_name
        && entry.source_kind == current.source_kind
        && entry.candidate_compiled_policy_fingerprint == current.compiled_policy_fingerprint
}

pub(super) fn validate_modepack_registry_manifest_entry(
    entry: &ModePackRegistryManifestEntry,
) -> Result<(), String> {
    if entry.modepack_name.trim().is_empty() || entry.modepack_name.len() > 96 {
        return Err(
            "modepack registry update selection failed: entry modepack_name is invalid".to_string(),
        );
    }
    if entry.source_kind != "remote_https_candidate" {
        return Err(
            "modepack registry update selection failed: entry source_kind is unsupported"
                .to_string(),
        );
    }
    for (field_name, value) in [
        ("candidate_content_sha256", &entry.candidate_content_sha256),
        (
            "candidate_compiled_policy_fingerprint",
            &entry.candidate_compiled_policy_fingerprint,
        ),
        (
            "provenance_statement_sha256",
            &entry.provenance_statement_sha256,
        ),
        ("signer_fingerprint", &entry.signer_fingerprint),
    ] {
        if !is_sha256_fingerprint(value) {
            return Err(format!(
                "modepack registry update selection failed: entry {field_name} must be a sha256 fingerprint"
            ));
        }
    }
    Ok(())
}

struct ModePackRegistryManifestTrustEvidence {
    statement_sha256: String,
    signer_fingerprint: String,
    trusted_signer_trust_id: String,
    trusted_signer_event_id: String,
}

#[allow(clippy::too_many_arguments)]
fn verify_modepack_registry_manifest_trust(
    store: &BrownieStore,
    params: &ModePackSelectRegistryUpdateParams,
    current: &ModePackActiveSnapshotSummary,
    registry_dns_binding: &ModePackDnsBindingSummary,
    registry_url_fingerprint: &str,
    registry_manifest_sha256: &str,
    entry: &ModePackRegistryManifestEntry,
    candidate_url_fingerprint: &str,
    provenance_statement_url_fingerprint: &str,
) -> Result<ModePackRegistryManifestTrustEvidence, String> {
    let statement_json = &params.registry_provenance_statement_json;
    if statement_json.as_bytes().len() > MODEPACK_PROVENANCE_STATEMENT_MAX_BYTES {
        return Err(
            "modepack registry update selection failed: registry trust statement exceeds byte limit"
                .to_string(),
        );
    }
    if scan_text_for_sensitive_content(statement_json) {
        return Err(
            "modepack registry update selection failed: registry trust statement contains sensitive-like content"
                .to_string(),
        );
    }
    let statement_sha256 = format!("sha256:{}", hex_sha256(statement_json.as_bytes()));
    if statement_sha256 != params.expected_registry_provenance_statement_sha256 {
        return Err(format!(
            "modepack registry update selection failed: registry trust statement fingerprint mismatch: expected {} but found {}",
            params.expected_registry_provenance_statement_sha256, statement_sha256
        ));
    }
    let public_key_bytes = general_purpose::STANDARD
        .decode(&params.registry_provenance_public_key_base64)
        .map_err(|_| {
            "modepack registry update selection failed: registry trust public key is not base64"
                .to_string()
        })?;
    if public_key_bytes.len() != 32 {
        return Err(
            "modepack registry update selection failed: registry trust public key must be 32 bytes"
                .to_string(),
        );
    }
    let signature_bytes = general_purpose::STANDARD
        .decode(&params.registry_provenance_signature_base64)
        .map_err(|_| {
            "modepack registry update selection failed: registry trust signature is not base64"
                .to_string()
        })?;
    if signature_bytes.len() != 64 {
        return Err(
            "modepack registry update selection failed: registry trust signature must be 64 bytes"
                .to_string(),
        );
    }
    let signer_fingerprint = format!("sha256:{}", hex_sha256(&public_key_bytes));
    if signer_fingerprint != params.expected_registry_signer_fingerprint {
        return Err(format!(
            "modepack registry update selection failed: registry trust signer fingerprint mismatch: expected {} but found {}",
            params.expected_registry_signer_fingerprint, signer_fingerprint
        ));
    }
    let verifying_key =
        VerifyingKey::from_bytes(public_key_bytes.as_slice().try_into().map_err(|_| {
            "modepack registry update selection failed: registry trust public key length invalid"
                .to_string()
        })?)
        .map_err(|_| {
            "modepack registry update selection failed: registry trust public key invalid"
                .to_string()
        })?;
    let signature = Signature::from_slice(&signature_bytes).map_err(|_| {
        "modepack registry update selection failed: registry trust signature invalid".to_string()
    })?;
    verifying_key
        .verify(statement_json.as_bytes(), &signature)
        .map_err(|_| {
            "modepack registry update selection failed: registry trust bad signature".to_string()
        })?;
    let statement: Value = serde_json::from_str(statement_json).map_err(|_| {
        "modepack registry update selection failed: registry trust statement is not JSON"
            .to_string()
    })?;
    validate_modepack_registry_manifest_trust_statement(
        &statement,
        current,
        registry_dns_binding,
        registry_url_fingerprint,
        registry_manifest_sha256,
        entry,
        candidate_url_fingerprint,
        provenance_statement_url_fingerprint,
        &signer_fingerprint,
    )?;

    let trusted_signer = store
        .read_modepack_trusted_signer_snapshot(&signer_fingerprint)
        .map_err(|error| format!("modepack registry update selection failed: {error}"))?
        .ok_or_else(|| {
            "modepack registry update selection failed: registry trusted signer not found"
                .to_string()
        })?;
    if trusted_signer.summary.signer_fingerprint != signer_fingerprint
        || trusted_signer.summary.trust_id != params.expected_registry_trusted_signer_trust_id
        || trusted_signer.summary.trust_event_id != params.expected_registry_trusted_signer_event_id
    {
        return Err(
            "modepack registry update selection failed: registry trusted signer is stale"
                .to_string(),
        );
    }
    if store
        .read_modepack_revoked_signer_snapshot(&signer_fingerprint)
        .map_err(|error| format!("modepack registry update selection failed: {error}"))?
        .is_some()
    {
        return Err(
            "modepack registry update selection failed: registry trusted signer revoked"
                .to_string(),
        );
    }
    if modepack_signer_trust_expired(&trusted_signer.summary)? {
        return Err(
            "modepack registry update selection failed: registry trusted signer expired"
                .to_string(),
        );
    }
    Ok(ModePackRegistryManifestTrustEvidence {
        statement_sha256,
        signer_fingerprint,
        trusted_signer_trust_id: trusted_signer.summary.trust_id,
        trusted_signer_event_id: trusted_signer.summary.trust_event_id,
    })
}

#[allow(clippy::too_many_arguments)]
pub(super) fn validate_modepack_registry_manifest_trust_statement(
    statement: &Value,
    current: &ModePackActiveSnapshotSummary,
    registry_dns_binding: &ModePackDnsBindingSummary,
    registry_url_fingerprint: &str,
    registry_manifest_sha256: &str,
    entry: &ModePackRegistryManifestEntry,
    candidate_url_fingerprint: &str,
    provenance_statement_url_fingerprint: &str,
    signer_fingerprint: &str,
) -> Result<(), String> {
    for (field, expected) in [
        ("registry_url_fingerprint", registry_url_fingerprint),
        (
            "registry_dns_resolution_fingerprint",
            registry_dns_binding.resolution_fingerprint.as_str(),
        ),
        (
            "registry_pinned_address_fingerprint",
            registry_dns_binding.pinned_address_fingerprint.as_str(),
        ),
        ("registry_manifest_sha256", registry_manifest_sha256),
        ("current_modepack_name", current.modepack_name.as_str()),
        ("current_source_kind", current.source_kind.as_str()),
        ("candidate_url_fingerprint", candidate_url_fingerprint),
        (
            "candidate_content_sha256",
            entry.candidate_content_sha256.as_str(),
        ),
        (
            "candidate_compiled_policy_fingerprint",
            entry.candidate_compiled_policy_fingerprint.as_str(),
        ),
        (
            "provenance_statement_url_fingerprint",
            provenance_statement_url_fingerprint,
        ),
        (
            "provenance_statement_sha256",
            entry.provenance_statement_sha256.as_str(),
        ),
        ("signer_fingerprint", signer_fingerprint),
    ] {
        if statement.get(field).and_then(Value::as_str) != Some(expected) {
            return Err(format!(
                "modepack registry update selection failed: registry trust statement {field} mismatch"
            ));
        }
    }
    if !statement
        .get("signer_identity")
        .and_then(Value::as_str)
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
    {
        return Err(
            "modepack registry update selection failed: registry trust signer identity missing"
                .to_string(),
        );
    }
    Ok(())
}

pub(super) fn approve_remote_modepack_candidate(
    store: &BrownieStore,
    params: &ModePackApproveCandidateParams,
) -> Result<ModePackApproveCandidateResult, String> {
    let cached = store
        .read_modepack_candidate_snapshot(&params.expected_content_sha256)
        .map_err(|error| format!("modepack candidate approval failed: {error}"))?
        .ok_or_else(|| {
            "modepack candidate approval failed: cached candidate not found".to_string()
        })?;
    let actual_content_sha256 = format!("sha256:{}", hex_sha256(cached.modepack_json.as_bytes()));
    if actual_content_sha256 != params.expected_content_sha256 {
        return Err(format!(
            "modepack candidate approval failed: cached content fingerprint mismatch: expected {} but found {}",
            params.expected_content_sha256, actual_content_sha256
        ));
    }
    if cached.summary.content_sha256 != params.expected_content_sha256 {
        return Err(format!(
            "modepack candidate approval failed: cached summary fingerprint mismatch: expected {} but found {}",
            params.expected_content_sha256, cached.summary.content_sha256
        ));
    }
    let recompiled = load_modepack_from_str_with_options(
        &cached.modepack_json,
        MODEPACK_CANDIDATE_CACHE_SOURCE_PATH,
        ModePackLoadOptions::trusted_signed_active_modepack(),
    )
    .map_err(|error| format!("modepack candidate approval compile failed: {error}"))?;
    let policy_snapshots = recompiled
        .modes
        .iter()
        .map(|policy| ActiveModePackPolicySnapshot {
            mode_id: policy.mode_id.clone(),
            display_name: policy.display_name.clone(),
            role_definition: policy.role_definition.clone(),
            when_to_use: policy.when_to_use.clone(),
            description: policy.description.clone(),
            prompt_sections: mode_prompt_sections_payload(policy),
            verification_responsibility: policy.verification_responsibility.clone(),
            instruction_fingerprint: policy.instruction_fingerprint.clone(),
            permissions: mode_permissions_payload(policy),
            workspace_write_scopes: mode_workspace_write_scopes_payload(policy),
            allowed_handoff_targets: policy.allowed_handoff_targets.clone(),
            mcp_access: mode_mcp_access_payload(policy),
            completion_rules: policy.completion_rules.clone(),
            policy_fingerprint: external_modepack_policy_fingerprint(
                &recompiled.name,
                recompiled.schema_version,
                policy,
            ),
        })
        .collect::<Vec<_>>();
    let mode_ids = policy_snapshots
        .iter()
        .map(|policy| policy.mode_id.clone())
        .collect::<Vec<_>>();
    let compiled_policy_fingerprint = active_modepack_compiled_policy_fingerprint(
        &recompiled.name,
        recompiled.schema_version,
        recompiled.entrypoints.default_mode_id(),
        &modepack_global_policy_artifacts_payload(&recompiled),
        &policy_snapshots,
    );
    if compiled_policy_fingerprint != params.expected_compiled_policy_fingerprint {
        return Err(format!(
            "modepack candidate approval failed: compiled policy fingerprint mismatch: expected {} but found {}",
            params.expected_compiled_policy_fingerprint, compiled_policy_fingerprint
        ));
    }
    if cached.summary.compiled_policy_fingerprint != params.expected_compiled_policy_fingerprint {
        return Err(format!(
            "modepack candidate approval failed: cached summary policy fingerprint mismatch: expected {} but found {}",
            params.expected_compiled_policy_fingerprint, cached.summary.compiled_policy_fingerprint
        ));
    }
    if cached.summary.mode_ids != mode_ids {
        return Err("modepack candidate approval failed: cached mode ids are stale".to_string());
    }
    let provenance = store
        .read_modepack_candidate_provenance_snapshot(&params.expected_content_sha256)
        .map_err(|error| format!("modepack candidate approval failed: {error}"))?
        .ok_or_else(|| {
            "modepack candidate approval failed: verified provenance not found".to_string()
        })?;
    let provenance_summary = provenance.summary;
    if provenance_summary.provenance_id != params.expected_provenance_id {
        return Err(format!(
            "modepack candidate approval failed: provenance id mismatch: expected {} but found {}",
            params.expected_provenance_id, provenance_summary.provenance_id
        ));
    }
    if provenance_summary.provenance_event_id != params.expected_provenance_event_id {
        return Err(format!(
            "modepack candidate approval failed: provenance event mismatch: expected {} but found {}",
            params.expected_provenance_event_id, provenance_summary.provenance_event_id
        ));
    }
    if provenance_summary.signer_fingerprint != params.expected_signer_fingerprint {
        return Err(format!(
            "modepack candidate approval failed: signer fingerprint mismatch: expected {} but found {}",
            params.expected_signer_fingerprint, provenance_summary.signer_fingerprint
        ));
    }
    if provenance_summary.statement_sha256 != params.expected_statement_sha256 {
        return Err(format!(
            "modepack candidate approval failed: statement fingerprint mismatch: expected {} but found {}",
            params.expected_statement_sha256, provenance_summary.statement_sha256
        ));
    }
    if provenance_summary.candidate_id != cached.summary.candidate_id
        || provenance_summary.source_kind != cached.summary.source_kind
        || provenance_summary.source_url_host != cached.summary.source_url_host
        || provenance_summary.source_url_fingerprint != cached.summary.source_url_fingerprint
        || provenance_summary.content_sha256 != params.expected_content_sha256
        || provenance_summary.modepack_name != recompiled.name
        || provenance_summary.schema_version != recompiled.schema_version
        || provenance_summary.mode_count != mode_ids.len()
        || provenance_summary.mode_ids != mode_ids
        || provenance_summary.compiled_policy_fingerprint != compiled_policy_fingerprint
    {
        return Err("modepack candidate approval failed: verified provenance is stale".to_string());
    }
    let trusted_signer = store
        .read_modepack_trusted_signer_snapshot(&provenance_summary.signer_fingerprint)
        .map_err(|error| format!("modepack candidate approval failed: {error}"))?
        .ok_or_else(|| {
            "modepack candidate approval failed: trusted signer not found".to_string()
        })?;
    if trusted_signer.summary.signer_fingerprint != provenance_summary.signer_fingerprint {
        return Err("modepack candidate approval failed: trusted signer is stale".to_string());
    }
    if store
        .read_modepack_revoked_signer_snapshot(&provenance_summary.signer_fingerprint)
        .map_err(|error| format!("modepack candidate approval failed: {error}"))?
        .is_some()
    {
        return Err("modepack candidate approval failed: trusted signer revoked".to_string());
    }
    if modepack_signer_trust_expired(&trusted_signer.summary)? {
        return Err("modepack candidate approval failed: trusted signer expired".to_string());
    }

    let approved_at = codebase_index_timestamp().map_err(|error| error.to_string())?;
    let approval_summary = ModePackApprovedCandidateSummary {
        approval_id: format!(
            "modepack_candidate_approval_{}",
            &actual_content_sha256[7..23]
        ),
        candidate_id: cached.summary.candidate_id,
        source_kind: cached.summary.source_kind,
        source_url_host: cached.summary.source_url_host,
        source_url_fingerprint: cached.summary.source_url_fingerprint,
        dns_binding: Some(cached.summary.dns_binding),
        content_sha256: params.expected_content_sha256.clone(),
        modepack_name: recompiled.name,
        schema_version: recompiled.schema_version,
        mode_count: mode_ids.len(),
        mode_ids,
        compiled_policy_fingerprint,
        provenance_id: provenance_summary.provenance_id,
        provenance_event_id: provenance_summary.provenance_event_id,
        trusted_signer_trust_id: trusted_signer.summary.trust_id,
        trusted_signer_event_id: trusted_signer.summary.trust_event_id,
        signer_fingerprint: provenance_summary.signer_fingerprint,
        statement_sha256: provenance_summary.statement_sha256,
        approved_at,
        approval_event_id: String::new(),
        consumed: false,
    };
    let committed = store
        .approve_modepack_candidate_snapshot(&ModePackApprovedCandidateSnapshot {
            summary: approval_summary,
        })
        .map_err(|error| format!("modepack candidate approval failed: {error}"))?;
    Ok(ModePackApproveCandidateResult {
        approved: !committed.replayed,
        replayed: committed.replayed,
        approval: committed.approval.summary,
        next_action: "replace_active_with_approved_modepack_candidate".to_string(),
    })
}

pub(super) fn trust_modepack_signer(
    store: &BrownieStore,
    params: &ModePackTrustSignerParams,
) -> Result<ModePackTrustSignerResult, String> {
    let trusted_at = codebase_index_timestamp().map_err(|error| error.to_string())?;
    let trust_summary = ModePackTrustedSignerSummary {
        trust_id: format!(
            "modepack_signer_trust_{}",
            &params.signer_fingerprint[7..23]
        ),
        signer_fingerprint: params.signer_fingerprint.clone(),
        trusted_at,
        expires_at: params.expires_at.clone(),
        trust_event_id: String::new(),
    };
    let committed = store
        .trust_modepack_signer_snapshot(&ModePackTrustedSignerSnapshot {
            summary: trust_summary,
        })
        .map_err(|error| format!("modepack signer trust failed: {error}"))?;
    let trusted_signer = committed.trusted_signer.summary;
    let has_expiry = trusted_signer.expires_at.is_some();
    Ok(ModePackTrustSignerResult {
        trusted: !committed.replayed,
        replayed: committed.replayed,
        trusted_signer,
        next_action: if has_expiry {
            "verify_or_approve_modepack_candidate_before_signer_trust_expires".to_string()
        } else {
            "verify_or_approve_modepack_candidate_for_trusted_signer".to_string()
        },
    })
}

pub(super) fn parse_modepack_signer_trust_expiry(
    expires_at: &str,
) -> Result<time::OffsetDateTime, String> {
    time::OffsetDateTime::parse(expires_at, &time::format_description::well_known::Rfc3339)
        .map_err(|_| "invalid params: expires_at must be an RFC3339 timestamp".to_string())
}

pub(super) fn modepack_signer_trust_expired(
    summary: &ModePackTrustedSignerSummary,
) -> Result<bool, String> {
    let Some(expires_at) = summary.expires_at.as_deref() else {
        return Ok(false);
    };
    let expires_at = parse_modepack_signer_trust_expiry(expires_at)
        .map_err(|error| format!("modepack candidate approval failed: {error}"))?;
    Ok(expires_at <= time::OffsetDateTime::now_utc())
}

pub(super) fn revoke_modepack_signer(
    store: &BrownieStore,
    params: &ModePackRevokeSignerParams,
) -> Result<ModePackRevokeSignerResult, String> {
    if let Some(existing) = store
        .read_modepack_revoked_signer_snapshot(&params.signer_fingerprint)
        .map_err(|error| format!("modepack signer revocation failed: {error}"))?
    {
        return Ok(ModePackRevokeSignerResult {
            revoked: false,
            replayed: true,
            revoked_signer: existing.summary,
            next_action: "signer_revoked_approval_denied_until_retrusted".to_string(),
        });
    }
    let trusted_signer = store
        .read_modepack_trusted_signer_snapshot(&params.signer_fingerprint)
        .map_err(|error| format!("modepack signer revocation failed: {error}"))?
        .ok_or_else(|| "modepack signer revocation failed: trusted signer not found".to_string())?;
    let revoked_at = codebase_index_timestamp().map_err(|error| error.to_string())?;
    let revocation_summary = ModePackRevokedSignerSummary {
        revocation_id: format!(
            "modepack_signer_revocation_{}",
            &params.signer_fingerprint[7..23]
        ),
        signer_fingerprint: params.signer_fingerprint.clone(),
        trusted_signer_trust_id: trusted_signer.summary.trust_id,
        trusted_signer_event_id: trusted_signer.summary.trust_event_id,
        revoked_at,
        revocation_event_id: String::new(),
    };
    let committed = store
        .revoke_modepack_signer_snapshot(&ModePackRevokedSignerSnapshot {
            summary: revocation_summary,
        })
        .map_err(|error| format!("modepack signer revocation failed: {error}"))?;
    Ok(ModePackRevokeSignerResult {
        revoked: !committed.replayed,
        replayed: committed.replayed,
        revoked_signer: committed.revoked_signer.summary,
        next_action: "signer_revoked_approval_denied_until_retrusted".to_string(),
    })
}

pub(super) fn verify_modepack_candidate_provenance(
    store: &BrownieStore,
    params: &ModePackVerifyCandidateProvenanceParams,
) -> Result<ModePackVerifyCandidateProvenanceResult, String> {
    if params.provenance_statement_json.as_bytes().len() > MODEPACK_PROVENANCE_STATEMENT_MAX_BYTES {
        return Err(
            "modepack candidate provenance verification failed: statement exceeds byte limit"
                .to_string(),
        );
    }
    if scan_text_for_sensitive_content(&params.provenance_statement_json) {
        return Err(
            "modepack candidate provenance verification failed: statement contains sensitive-like content"
                .to_string(),
        );
    }
    let public_key_bytes = general_purpose::STANDARD
        .decode(&params.provenance_public_key_base64)
        .map_err(|_| {
            "modepack candidate provenance verification failed: public key is not base64"
                .to_string()
        })?;
    if public_key_bytes.len() != 32 {
        return Err(
            "modepack candidate provenance verification failed: public key must be 32 bytes"
                .to_string(),
        );
    }
    let signature_bytes = general_purpose::STANDARD
        .decode(&params.provenance_signature_base64)
        .map_err(|_| {
            "modepack candidate provenance verification failed: signature is not base64".to_string()
        })?;
    if signature_bytes.len() != 64 {
        return Err(
            "modepack candidate provenance verification failed: signature must be 64 bytes"
                .to_string(),
        );
    }
    let signer_fingerprint = format!("sha256:{}", hex_sha256(&public_key_bytes));
    if signer_fingerprint != params.expected_signer_fingerprint {
        return Err(format!(
            "modepack candidate provenance verification failed: signer fingerprint mismatch: expected {} but found {}",
            params.expected_signer_fingerprint, signer_fingerprint
        ));
    }
    let verifying_key =
        VerifyingKey::from_bytes(public_key_bytes.as_slice().try_into().map_err(|_| {
            "modepack candidate provenance verification failed: public key length invalid"
                .to_string()
        })?)
        .map_err(|_| {
            "modepack candidate provenance verification failed: public key invalid".to_string()
        })?;
    let signature = Signature::from_slice(&signature_bytes).map_err(|_| {
        "modepack candidate provenance verification failed: signature invalid".to_string()
    })?;
    verifying_key
        .verify(params.provenance_statement_json.as_bytes(), &signature)
        .map_err(|_| {
            "modepack candidate provenance verification failed: bad signature".to_string()
        })?;
    let statement: Value =
        serde_json::from_str(&params.provenance_statement_json).map_err(|_| {
            "modepack candidate provenance verification failed: statement is not JSON".to_string()
        })?;
    let cached = store
        .read_modepack_candidate_snapshot(&params.expected_content_sha256)
        .map_err(|error| format!("modepack candidate provenance verification failed: {error}"))?
        .ok_or_else(|| {
            "modepack candidate provenance verification failed: cached candidate not found"
                .to_string()
        })?;
    let actual_content_sha256 = format!("sha256:{}", hex_sha256(cached.modepack_json.as_bytes()));
    if actual_content_sha256 != params.expected_content_sha256 {
        return Err(format!(
            "modepack candidate provenance verification failed: cached content fingerprint mismatch: expected {} but found {}",
            params.expected_content_sha256, actual_content_sha256
        ));
    }
    if cached.summary.content_sha256 != params.expected_content_sha256 {
        return Err(format!(
            "modepack candidate provenance verification failed: cached summary fingerprint mismatch: expected {} but found {}",
            params.expected_content_sha256, cached.summary.content_sha256
        ));
    }
    let recompiled = load_modepack_from_str_with_options(
        &cached.modepack_json,
        MODEPACK_CANDIDATE_CACHE_SOURCE_PATH,
        ModePackLoadOptions::trusted_signed_active_modepack(),
    )
    .map_err(|error| {
        format!("modepack candidate provenance verification compile failed: {error}")
    })?;
    let policy_snapshots = recompiled
        .modes
        .iter()
        .map(|policy| ActiveModePackPolicySnapshot {
            mode_id: policy.mode_id.clone(),
            display_name: policy.display_name.clone(),
            role_definition: policy.role_definition.clone(),
            when_to_use: policy.when_to_use.clone(),
            description: policy.description.clone(),
            prompt_sections: mode_prompt_sections_payload(policy),
            verification_responsibility: policy.verification_responsibility.clone(),
            instruction_fingerprint: policy.instruction_fingerprint.clone(),
            permissions: mode_permissions_payload(policy),
            workspace_write_scopes: mode_workspace_write_scopes_payload(policy),
            allowed_handoff_targets: policy.allowed_handoff_targets.clone(),
            mcp_access: mode_mcp_access_payload(policy),
            completion_rules: policy.completion_rules.clone(),
            policy_fingerprint: external_modepack_policy_fingerprint(
                &recompiled.name,
                recompiled.schema_version,
                policy,
            ),
        })
        .collect::<Vec<_>>();
    let mode_ids = policy_snapshots
        .iter()
        .map(|policy| policy.mode_id.clone())
        .collect::<Vec<_>>();
    let compiled_policy_fingerprint = active_modepack_compiled_policy_fingerprint(
        &recompiled.name,
        recompiled.schema_version,
        recompiled.entrypoints.default_mode_id(),
        &modepack_global_policy_artifacts_payload(&recompiled),
        &policy_snapshots,
    );
    if compiled_policy_fingerprint != params.expected_compiled_policy_fingerprint {
        return Err(format!(
            "modepack candidate provenance verification failed: compiled policy fingerprint mismatch: expected {} but found {}",
            params.expected_compiled_policy_fingerprint, compiled_policy_fingerprint
        ));
    }
    if cached.summary.compiled_policy_fingerprint != params.expected_compiled_policy_fingerprint {
        return Err(format!(
            "modepack candidate provenance verification failed: cached summary policy fingerprint mismatch: expected {} but found {}",
            params.expected_compiled_policy_fingerprint, cached.summary.compiled_policy_fingerprint
        ));
    }
    if cached.summary.mode_ids != mode_ids {
        return Err(
            "modepack candidate provenance verification failed: cached mode ids are stale"
                .to_string(),
        );
    }
    validate_modepack_provenance_statement(
        &statement,
        &cached.summary,
        &mode_ids,
        recompiled.schema_version,
        &params.expected_content_sha256,
        &params.expected_compiled_policy_fingerprint,
        &signer_fingerprint,
    )?;

    let provenance_summary = ModePackCandidateProvenanceSummary {
        provenance_id: format!(
            "modepack_candidate_provenance_{}",
            &actual_content_sha256[7..23]
        ),
        candidate_id: cached.summary.candidate_id,
        source_kind: cached.summary.source_kind,
        source_url_host: cached.summary.source_url_host,
        source_url_fingerprint: cached.summary.source_url_fingerprint,
        dns_binding: Some(cached.summary.dns_binding),
        content_sha256: params.expected_content_sha256.clone(),
        modepack_name: recompiled.name,
        schema_version: recompiled.schema_version,
        mode_count: mode_ids.len(),
        mode_ids,
        compiled_policy_fingerprint,
        signer_fingerprint,
        statement_sha256: format!(
            "sha256:{}",
            hex_sha256(params.provenance_statement_json.as_bytes())
        ),
        signature_sha256: format!("sha256:{}", hex_sha256(&signature_bytes)),
        verified_at: codebase_index_timestamp().map_err(|error| error.to_string())?,
        provenance_event_id: String::new(),
    };
    let committed = store
        .verify_modepack_candidate_provenance_snapshot(&ModePackCandidateProvenanceSnapshot {
            summary: provenance_summary,
        })
        .map_err(|error| format!("modepack candidate provenance verification failed: {error}"))?;
    Ok(ModePackVerifyCandidateProvenanceResult {
        verified: !committed.replayed,
        replayed: committed.replayed,
        provenance: committed.provenance.summary,
        next_action: "approve_verified_modepack_candidate".to_string(),
    })
}

pub(super) fn validate_modepack_provenance_statement(
    statement: &Value,
    cached_summary: &ModePackCandidateSummary,
    mode_ids: &[String],
    schema_version: u64,
    expected_content_sha256: &str,
    expected_compiled_policy_fingerprint: &str,
    signer_fingerprint: &str,
) -> Result<(), String> {
    if statement.get("content_sha256").and_then(Value::as_str) != Some(expected_content_sha256) {
        return Err(
            "modepack candidate provenance verification failed: statement content fingerprint mismatch"
                .to_string(),
        );
    }
    if statement
        .get("compiled_policy_fingerprint")
        .and_then(Value::as_str)
        != Some(expected_compiled_policy_fingerprint)
    {
        return Err(
            "modepack candidate provenance verification failed: statement policy fingerprint mismatch"
                .to_string(),
        );
    }
    if statement
        .get("source_url_fingerprint")
        .and_then(Value::as_str)
        != Some(cached_summary.source_url_fingerprint.as_str())
    {
        return Err(
            "modepack candidate provenance verification failed: statement source fingerprint mismatch"
                .to_string(),
        );
    }
    if statement.get("schema_version").and_then(Value::as_u64) != Some(schema_version) {
        return Err(
            "modepack candidate provenance verification failed: statement schema version mismatch"
                .to_string(),
        );
    }
    if statement.get("signer_fingerprint").and_then(Value::as_str) != Some(signer_fingerprint) {
        return Err(
            "modepack candidate provenance verification failed: statement signer fingerprint mismatch"
                .to_string(),
        );
    }
    if !statement
        .get("signer_identity")
        .and_then(Value::as_str)
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
    {
        return Err(
            "modepack candidate provenance verification failed: statement signer identity missing"
                .to_string(),
        );
    }
    let statement_mode_ids = statement
        .get("mode_ids")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            "modepack candidate provenance verification failed: statement mode_ids missing"
                .to_string()
        })?
        .iter()
        .map(|value| {
            value.as_str().map(ToString::to_string).ok_or_else(|| {
                "modepack candidate provenance verification failed: statement mode_ids invalid"
                    .to_string()
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    if statement_mode_ids != mode_ids {
        return Err(
            "modepack candidate provenance verification failed: statement mode ids mismatch"
                .to_string(),
        );
    }
    Ok(())
}

pub(super) fn validate_modepack_fetch_url(
    value: &str,
    resolve_addresses: bool,
) -> Result<url::Url, String> {
    let parsed =
        url::Url::parse(value).map_err(|_| "modepack candidate URL is invalid".to_string())?;
    if parsed.scheme() != "https" {
        return Err("modepack candidate URL must use https".to_string());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("modepack candidate URL must not contain credentials".to_string());
    }
    if parsed.fragment().is_some() {
        return Err("modepack candidate URL must not contain a fragment".to_string());
    }
    if !matches!(parsed.port_or_known_default(), Some(443)) {
        return Err("modepack candidate URL uses an unsupported port".to_string());
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| "modepack candidate URL host is required".to_string())?;
    if host.eq_ignore_ascii_case("localhost") {
        return Err("modepack candidate URL host is not allowed".to_string());
    }
    if let Ok(ip) = host.parse::<IpAddr>() {
        if private_or_special_ip(ip) {
            return Err("modepack candidate URL resolves to a disallowed address".to_string());
        }
    }
    if resolve_addresses {
        let addrs = (host, 443)
            .to_socket_addrs()
            .map_err(|error| format!("modepack candidate URL resolution failed: {error}"))?;
        for addr in addrs {
            if private_or_special_ip(addr.ip()) {
                return Err("modepack candidate URL resolves to a disallowed address".to_string());
            }
        }
    }
    Ok(parsed)
}

pub(super) fn default_modepack_dns_resolver(host: &str) -> Result<Vec<SocketAddr>, String> {
    (host, 443)
        .to_socket_addrs()
        .map(|addrs| addrs.collect::<Vec<_>>())
        .map_err(|error| format!("modepack candidate URL resolution failed: {error}"))
}

#[cfg(test)]
pub(super) fn test_modepack_dns_resolver(_host: &str) -> Result<Vec<SocketAddr>, String> {
    Ok(vec![SocketAddr::from(([93, 184, 216, 34], 443))])
}

pub(super) fn create_modepack_fetch_binding_with<R>(
    value: &str,
    resolver: R,
) -> Result<RemoteModePackFetchBinding, String>
where
    R: FnOnce(&str) -> Result<Vec<SocketAddr>, String>,
{
    let parsed = validate_modepack_fetch_url(value, false)?;
    let host = parsed
        .host_str()
        .ok_or_else(|| "modepack candidate URL host is required".to_string())?;
    let mut addrs = resolver(host)?;
    if addrs.is_empty() {
        return Err("modepack candidate URL resolution returned no addresses".to_string());
    }
    addrs.sort_by_key(|addr| addr.to_string());
    for addr in &addrs {
        if private_or_special_ip(addr.ip()) {
            return Err("modepack candidate URL resolves to a disallowed address".to_string());
        }
    }
    let pinned_addr = addrs[0];
    let address_fingerprints = addrs
        .iter()
        .map(|addr| hex_sha256(addr.to_string().as_bytes()))
        .collect::<Vec<_>>();
    let resolution_fingerprint = format!(
        "sha256:{}",
        hex_sha256(address_fingerprints.join("\n").as_bytes())
    );
    let pinned_address_fingerprint =
        format!("sha256:{}", hex_sha256(pinned_addr.to_string().as_bytes()));
    let pinned_address_family = match pinned_addr.ip() {
        IpAddr::V4(_) => "ipv4",
        IpAddr::V6(_) => "ipv6",
    }
    .to_string();
    Ok(RemoteModePackFetchBinding {
        url: parsed,
        pinned_addr,
        summary: ModePackDnsBindingSummary {
            resolution_fingerprint,
            pinned_address_fingerprint,
            resolved_address_count: addrs.len(),
            pinned_address_family,
        },
    })
}

pub(super) fn private_or_special_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || ip.is_broadcast()
                || ip.octets()[0] == 0
                || matches!(
                    ip.octets(),
                    [192, 0, 2, _] | [198, 51, 100, _] | [203, 0, 113, _]
                )
        }
        IpAddr::V6(ip) => {
            ip.is_loopback()
                || ip.is_unspecified()
                || ip.is_unique_local()
                || ip.is_unicast_link_local()
                || ip.segments()[0] == 0x2001 && ip.segments()[1] == 0x0db8
        }
    }
}

pub(super) fn modepack_candidate_content_type_allowed(content_type: Option<&str>) -> bool {
    let Some(content_type) = content_type else {
        return true;
    };
    let media_type = content_type
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    matches!(
        media_type.as_str(),
        "application/json" | "text/json" | "text/plain" | "application/octet-stream"
    )
}

pub(super) fn fetch_modepack_url(
    binding: &RemoteModePackFetchBinding,
) -> Result<RemoteModePackFetchResponse, String> {
    let host = binding
        .url
        .host_str()
        .ok_or_else(|| "modepack candidate URL host is required".to_string())?;
    let client = reqwest::blocking::Client::builder()
        .resolve(host, binding.pinned_addr)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(MODEPACK_REMOTE_FETCH_TIMEOUT)
        .build()
        .map_err(|error| format!("modepack candidate fetch client failed: {error}"))?;
    let mut response = client
        .get(binding.url.as_str())
        .send()
        .map_err(|error| format!("modepack candidate fetch failed: {error}"))?;
    if response.status().is_redirection() {
        return Err("modepack candidate fetch failed: redirects are not allowed".to_string());
    }
    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(ToString::to_string);
    let mut body = Vec::new();
    response
        .copy_to(&mut body)
        .map_err(|error| format!("modepack candidate response read failed: {error}"))?;
    Ok(RemoteModePackFetchResponse {
        status,
        content_type,
        body,
    })
}

pub(super) fn activate_workspace_modepack(
    store: &BrownieStore,
) -> Result<ModePackActivateResult, String> {
    let snapshot = build_active_modepack_snapshot(store)?;
    let committed = store
        .commit_active_modepack_snapshot(&snapshot)
        .map_err(|error| format!("modepack activation failed: {error}"))?;
    Ok(ModePackActivateResult {
        activated: !committed.replayed,
        replayed: committed.replayed,
        snapshot: committed.snapshot.summary,
    })
}

pub(super) fn replace_active_workspace_modepack(
    store: &BrownieStore,
    params: &ModePackReplaceActiveParams,
) -> Result<ModePackReplaceActiveResult, String> {
    let approved_candidate = match (
        params.approved_candidate_approval_id.as_deref(),
        params.expected_approved_candidate_content_sha256.as_deref(),
        params
            .expected_approved_candidate_compiled_policy_fingerprint
            .as_deref(),
    ) {
        (None, None, None) => None,
        (Some(approval_id), Some(content_sha256), Some(policy_fingerprint)) => Some((
            approval_id,
            content_sha256,
            policy_fingerprint,
            build_active_modepack_snapshot_from_approved_candidate(
                store,
                params,
                approval_id,
                content_sha256,
                policy_fingerprint,
            )?,
        )),
        _ => {
            return Err(
                "modepack replacement failed: approved candidate activation requires approval id, content sha256, and compiled policy fingerprint".to_string(),
            )
        }
    };
    let snapshot = match approved_candidate.as_ref() {
        Some((_, _, _, (snapshot, approved))) => {
            if approved.consumed {
                let active = store
                    .read_active_modepack_snapshot()
                    .map_err(|error| format!("modepack replacement failed: {error}"))?
                    .ok_or_else(|| {
                        "modepack replacement failed: missing active modepack snapshot".to_string()
                    })?;
                if active.summary.activation_fingerprint
                    != params.expected_candidate_activation_fingerprint
                {
                    return Err(
                        "modepack replacement failed: approved candidate is already consumed"
                            .to_string(),
                    );
                }
            }
            snapshot.clone()
        }
        None => build_active_modepack_snapshot(store)?,
    };
    if snapshot.summary.activation_fingerprint != params.expected_candidate_activation_fingerprint {
        return Err(format!(
            "modepack replacement failed: candidate activation fingerprint mismatch: expected {} but found {}",
            params.expected_candidate_activation_fingerprint,
            snapshot.summary.activation_fingerprint
        ));
    }
    let update_admission = match params.update_admission.as_ref() {
        Some(update_params) => {
            let Some((_, _, _, (_, approved))) = approved_candidate.as_ref() else {
                return Err(
                    "modepack replacement failed: update admission requires an approved remote candidate".to_string(),
                );
            };
            let active = store
                .read_active_modepack_snapshot()
                .map_err(|error| format!("modepack replacement failed: {error}"))?;
            if approved.consumed
                && active
                    .as_ref()
                    .map(|snapshot| {
                        snapshot.summary.activation_fingerprint
                            == params.expected_candidate_activation_fingerprint
                    })
                    .unwrap_or(false)
            {
                None
            } else {
                Some(validate_modepack_update_admission(
                    store,
                    params,
                    update_params,
                    &snapshot.summary,
                    approved,
                )?)
            }
        }
        None => None,
    };
    let committed = store
        .replace_active_modepack_snapshot(
            &params.expected_current_activation_fingerprint,
            &snapshot,
            update_admission.as_ref(),
        )
        .map_err(|error| format!("modepack replacement failed: {error}"))?;
    let mut result = ModePackReplaceActiveResult {
        replaced: !committed.replayed,
        replayed: committed.replayed,
        previous_snapshot: committed.previous_snapshot.summary,
        replacement_snapshot: committed.replacement_snapshot.summary,
        replacement_event_id: committed.event_id,
        approved_candidate: None,
        candidate_consumed_event_id: None,
        update_admission: committed.update_admission,
    };
    if let Some((approval_id, content_sha256, _, _)) = approved_candidate {
        let consumed = store
            .consume_approved_modepack_candidate(
                content_sha256,
                approval_id,
                &result.replacement_event_id,
                &result.replacement_snapshot.activation_fingerprint,
            )
            .map_err(|error| format!("modepack replacement failed: {error}"))?;
        result.approved_candidate = Some(consumed.approval.summary);
        result.candidate_consumed_event_id = Some(consumed.event_id);
    }
    Ok(result)
}

pub(super) fn validate_modepack_update_admission(
    store: &BrownieStore,
    params: &ModePackReplaceActiveParams,
    update_params: &ModePackUpdateAdmissionParams,
    candidate: &ModePackActiveSnapshotSummary,
    approved: &ModePackApprovedCandidateSummary,
) -> Result<ModePackUpdateAdmissionSummary, String> {
    if !update_params.authorize_update {
        return Err("modepack replacement failed: update authorization required".to_string());
    }
    let active = store
        .read_active_modepack_snapshot()
        .map_err(|error| format!("modepack replacement failed: {error}"))?
        .ok_or_else(|| {
            "modepack replacement failed: missing active modepack snapshot".to_string()
        })?;
    if active.summary.activation_fingerprint != params.expected_current_activation_fingerprint {
        return Err(format!(
            "modepack replacement failed: stale active modepack snapshot: expected {} but found {}",
            params.expected_current_activation_fingerprint, active.summary.activation_fingerprint
        ));
    }
    if active.summary.modepack_name != update_params.expected_current_modepack_name {
        return Err(format!(
            "modepack replacement failed: active modepack name mismatch: expected {} but found {}",
            update_params.expected_current_modepack_name, active.summary.modepack_name
        ));
    }
    if active.summary.source_kind != update_params.expected_current_source_kind {
        return Err(format!(
            "modepack replacement failed: active source kind mismatch: expected {} but found {}",
            update_params.expected_current_source_kind, active.summary.source_kind
        ));
    }
    if active.summary.source_kind != "remote_https_candidate" {
        return Err(
            "modepack replacement failed: update admission requires an active remote HTTPS modepack"
                .to_string(),
        );
    }
    if candidate.source_kind != "remote_https_candidate" {
        return Err(
            "modepack replacement failed: update admission requires a remote HTTPS candidate"
                .to_string(),
        );
    }
    if candidate.modepack_name != active.summary.modepack_name {
        return Err(format!(
            "modepack replacement failed: update candidate modepack name mismatch: expected {} but found {}",
            active.summary.modepack_name, candidate.modepack_name
        ));
    }
    if candidate.activation_fingerprint == active.summary.activation_fingerprint {
        return Err(
            "modepack replacement failed: update candidate matches current activation fingerprint"
                .to_string(),
        );
    }
    if approved.provenance_id != update_params.expected_approved_candidate_provenance_id
        || approved.provenance_event_id
            != update_params.expected_approved_candidate_provenance_event_id
        || approved.signer_fingerprint
            != update_params.expected_approved_candidate_signer_fingerprint
        || approved.statement_sha256 != update_params.expected_approved_candidate_statement_sha256
        || approved.trusted_signer_trust_id != update_params.expected_trusted_signer_trust_id
        || approved.trusted_signer_event_id != update_params.expected_trusted_signer_event_id
    {
        return Err(
            "modepack replacement failed: approved candidate update evidence mismatch".to_string(),
        );
    }
    let cached = store
        .read_modepack_candidate_snapshot(&approved.content_sha256)
        .map_err(|error| format!("modepack replacement failed: {error}"))?
        .ok_or_else(|| {
            "modepack replacement failed: cached approved candidate not found".to_string()
        })?;
    if cached.summary.candidate_id != approved.candidate_id
        || cached.summary.content_sha256 != approved.content_sha256
        || cached.summary.compiled_policy_fingerprint != approved.compiled_policy_fingerprint
        || cached.summary.modepack_name != approved.modepack_name
        || cached.summary.mode_ids != approved.mode_ids
        || cached.summary.source_url_host != approved.source_url_host
        || cached.summary.source_url_fingerprint != approved.source_url_fingerprint
    {
        return Err("modepack replacement failed: approved candidate cache is stale".to_string());
    }
    validate_approved_modepack_candidate_identity_binding(params, approved, &cached.summary)
        .map_err(|error| format!("modepack replacement failed: {error}"))?;
    let provenance = store
        .read_modepack_candidate_provenance_snapshot(&approved.content_sha256)
        .map_err(|error| format!("modepack replacement failed: {error}"))?
        .ok_or_else(|| {
            "modepack replacement failed: approved candidate provenance not found".to_string()
        })?;
    if provenance.summary.provenance_id != approved.provenance_id
        || provenance.summary.provenance_event_id != approved.provenance_event_id
        || provenance.summary.candidate_id != approved.candidate_id
        || provenance.summary.source_url_host != approved.source_url_host
        || provenance.summary.source_url_fingerprint != approved.source_url_fingerprint
        || provenance.summary.content_sha256 != approved.content_sha256
        || provenance.summary.modepack_name != approved.modepack_name
        || provenance.summary.mode_ids != approved.mode_ids
        || provenance.summary.compiled_policy_fingerprint != approved.compiled_policy_fingerprint
        || provenance.summary.signer_fingerprint != approved.signer_fingerprint
        || provenance.summary.statement_sha256 != approved.statement_sha256
    {
        return Err(
            "modepack replacement failed: approved candidate provenance is stale".to_string(),
        );
    }
    let trusted_signer = store
        .read_modepack_trusted_signer_snapshot(&approved.signer_fingerprint)
        .map_err(|error| format!("modepack replacement failed: {error}"))?
        .ok_or_else(|| "modepack replacement failed: trusted signer not found".to_string())?;
    if trusted_signer.summary.trust_id != approved.trusted_signer_trust_id
        || trusted_signer.summary.trust_event_id != approved.trusted_signer_event_id
        || trusted_signer.summary.signer_fingerprint != approved.signer_fingerprint
    {
        return Err("modepack replacement failed: trusted signer is stale".to_string());
    }
    if store
        .read_modepack_revoked_signer_snapshot(&approved.signer_fingerprint)
        .map_err(|error| format!("modepack replacement failed: {error}"))?
        .is_some()
    {
        return Err("modepack replacement failed: trusted signer revoked".to_string());
    }
    if modepack_signer_trust_expired(&trusted_signer.summary).map_err(|error| {
        error.replace(
            "modepack candidate approval failed",
            "modepack replacement failed",
        )
    })? {
        return Err("modepack replacement failed: trusted signer expired".to_string());
    }
    let admitted_at = codebase_index_timestamp().map_err(|error| error.to_string())?;
    Ok(ModePackUpdateAdmissionSummary {
        update_id: format!(
            "modepack_update_{}",
            &candidate.activation_fingerprint[7..23]
        ),
        current_activation_fingerprint: active.summary.activation_fingerprint,
        replacement_activation_fingerprint: candidate.activation_fingerprint.clone(),
        modepack_name: candidate.modepack_name.clone(),
        source_kind: candidate.source_kind.clone(),
        approval_id: approved.approval_id.clone(),
        candidate_id: approved.candidate_id.clone(),
        source_url_host: approved.source_url_host.clone(),
        source_url_fingerprint: approved.source_url_fingerprint.clone(),
        dns_binding: cached.summary.dns_binding.clone(),
        content_sha256: approved.content_sha256.clone(),
        compiled_policy_fingerprint: approved.compiled_policy_fingerprint.clone(),
        provenance_id: approved.provenance_id.clone(),
        provenance_event_id: approved.provenance_event_id.clone(),
        trusted_signer_trust_id: approved.trusted_signer_trust_id.clone(),
        trusted_signer_event_id: approved.trusted_signer_event_id.clone(),
        signer_fingerprint: approved.signer_fingerprint.clone(),
        statement_sha256: approved.statement_sha256.clone(),
        admitted_at,
        admission_event_id: String::new(),
    })
}

pub(super) fn validate_approved_modepack_candidate_identity_binding(
    params: &ModePackReplaceActiveParams,
    approved: &ModePackApprovedCandidateSummary,
    cached: &ModePackCandidateSummary,
) -> Result<(), String> {
    let Some(expected_candidate_id) = params.expected_approved_candidate_id.as_deref() else {
        return Err("approved candidate identity binding requires candidate id".to_string());
    };
    let Some(expected_source_url_host) = params
        .expected_approved_candidate_source_url_host
        .as_deref()
    else {
        return Err("approved candidate identity binding requires source url host".to_string());
    };
    let Some(expected_source_url_fingerprint) = params
        .expected_approved_candidate_source_url_fingerprint
        .as_deref()
    else {
        return Err(
            "approved candidate identity binding requires source url fingerprint".to_string(),
        );
    };
    let Some(expected_dns_resolution_fingerprint) = params
        .expected_approved_candidate_dns_resolution_fingerprint
        .as_deref()
    else {
        return Err(
            "approved candidate identity binding requires DNS resolution fingerprint".to_string(),
        );
    };
    let Some(expected_pinned_address_fingerprint) = params
        .expected_approved_candidate_pinned_address_fingerprint
        .as_deref()
    else {
        return Err(
            "approved candidate identity binding requires pinned address fingerprint".to_string(),
        );
    };
    let Some(expected_approval_event_id) = params
        .expected_approved_candidate_approval_event_id
        .as_deref()
    else {
        return Err("approved candidate identity binding requires approval event id".to_string());
    };

    if approved.candidate_id != expected_candidate_id
        || cached.candidate_id != expected_candidate_id
        || approved.source_url_host != expected_source_url_host
        || cached.source_url_host != expected_source_url_host
        || approved.source_url_fingerprint != expected_source_url_fingerprint
        || cached.source_url_fingerprint != expected_source_url_fingerprint
        || cached.dns_binding.resolution_fingerprint != expected_dns_resolution_fingerprint
        || cached.dns_binding.pinned_address_fingerprint != expected_pinned_address_fingerprint
        || approved.approval_event_id != expected_approval_event_id
    {
        return Err("approved candidate identity evidence mismatch".to_string());
    }
    if let Some(approved_dns_binding) = approved.dns_binding.as_ref() {
        if approved_dns_binding.resolution_fingerprint != cached.dns_binding.resolution_fingerprint
            || approved_dns_binding.pinned_address_fingerprint
                != cached.dns_binding.pinned_address_fingerprint
        {
            return Err("approved candidate DNS binding is stale".to_string());
        }
    }
    Ok(())
}

pub(super) fn build_active_modepack_snapshot_from_approved_candidate(
    store: &BrownieStore,
    params: &ModePackReplaceActiveParams,
    approval_id: &str,
    content_sha256: &str,
    compiled_policy_fingerprint: &str,
) -> Result<(ActiveModePackSnapshot, ModePackApprovedCandidateSummary), String> {
    let approved = store
        .read_approved_modepack_candidate_snapshot(content_sha256)
        .map_err(|error| format!("approved modepack candidate load failed: {error}"))?
        .ok_or_else(|| "approved modepack candidate load failed: approval not found".to_string())?;
    if approved.summary.approval_id != approval_id {
        return Err(format!(
            "approved modepack candidate load failed: approval id mismatch: expected {} but found {}",
            approval_id, approved.summary.approval_id
        ));
    }
    if approved.summary.compiled_policy_fingerprint != compiled_policy_fingerprint {
        return Err(format!(
            "approved modepack candidate load failed: compiled policy fingerprint mismatch: expected {} but found {}",
            compiled_policy_fingerprint, approved.summary.compiled_policy_fingerprint
        ));
    }
    let cached = store
        .read_modepack_candidate_snapshot(content_sha256)
        .map_err(|error| format!("approved modepack candidate cache load failed: {error}"))?
        .ok_or_else(|| {
            "approved modepack candidate cache load failed: cached candidate not found".to_string()
        })?;
    let actual_content_sha256 = format!("sha256:{}", hex_sha256(cached.modepack_json.as_bytes()));
    if actual_content_sha256 != content_sha256 {
        return Err(format!(
            "approved modepack candidate cache load failed: cached content fingerprint mismatch: expected {} but found {}",
            content_sha256, actual_content_sha256
        ));
    }
    let snapshot = load_modepack_from_str_with_options(
        &cached.modepack_json,
        MODEPACK_CANDIDATE_CACHE_SOURCE_PATH,
        ModePackLoadOptions::trusted_signed_active_modepack(),
    )
    .map_err(|error| format!("approved modepack candidate compile failed: {error}"))?;
    let policies = snapshot
        .modes
        .iter()
        .map(|policy| {
            let policy_fingerprint = external_modepack_policy_fingerprint(
                &snapshot.name,
                snapshot.schema_version,
                policy,
            );
            ActiveModePackPolicySnapshot {
                mode_id: policy.mode_id.clone(),
                display_name: policy.display_name.clone(),
                role_definition: policy.role_definition.clone(),
                when_to_use: policy.when_to_use.clone(),
                description: policy.description.clone(),
                prompt_sections: mode_prompt_sections_payload(policy),
                verification_responsibility: policy.verification_responsibility.clone(),
                instruction_fingerprint: policy.instruction_fingerprint.clone(),
                permissions: mode_permissions_payload(policy),
                workspace_write_scopes: mode_workspace_write_scopes_payload(policy),
                allowed_handoff_targets: policy.allowed_handoff_targets.clone(),
                mcp_access: mode_mcp_access_payload(policy),
                completion_rules: policy.completion_rules.clone(),
                policy_fingerprint,
            }
        })
        .collect::<Vec<_>>();
    let mode_ids = policies
        .iter()
        .map(|policy| policy.mode_id.clone())
        .collect::<Vec<_>>();
    let global_policy_artifacts = modepack_global_policy_artifacts_payload(&snapshot);
    let actual_compiled_policy_fingerprint = active_modepack_compiled_policy_fingerprint(
        &snapshot.name,
        snapshot.schema_version,
        snapshot.entrypoints.default_mode_id(),
        &global_policy_artifacts,
        &policies,
    );
    if actual_compiled_policy_fingerprint != compiled_policy_fingerprint {
        return Err(format!(
            "approved modepack candidate compile failed: compiled policy fingerprint mismatch: expected {} but found {}",
            compiled_policy_fingerprint, actual_compiled_policy_fingerprint
        ));
    }
    if cached.summary.compiled_policy_fingerprint != compiled_policy_fingerprint
        || cached.summary.content_sha256 != content_sha256
        || cached.summary.mode_ids != mode_ids
        || approved.summary.candidate_id != cached.summary.candidate_id
        || approved.summary.source_url_host != cached.summary.source_url_host
        || approved.summary.source_url_fingerprint != cached.summary.source_url_fingerprint
    {
        return Err(
            "approved modepack candidate load failed: cached candidate summary is stale"
                .to_string(),
        );
    }
    validate_approved_modepack_candidate_identity_binding(
        params,
        &approved.summary,
        &cached.summary,
    )
    .map_err(|error| format!("approved modepack candidate load failed: {error}"))?;
    let activated_at = codebase_index_timestamp().map_err(|error| error.to_string())?;
    let activation_fingerprint = active_modepack_activation_fingerprint(
        &snapshot.name,
        snapshot.schema_version,
        &actual_compiled_policy_fingerprint,
        &mode_ids,
        snapshot.entrypoints.default_mode_id(),
    );
    let summary = ModePackActiveSnapshotSummary {
        activation_id: format!("modepack_activation_{}", &activation_fingerprint[7..23]),
        activation_fingerprint,
        modepack_name: snapshot.name,
        schema_version: snapshot.schema_version,
        source_kind: "remote_https_candidate".to_string(),
        source_path: cached.summary.candidate_id,
        mode_count: mode_ids.len(),
        mode_ids,
        default_entrypoint: snapshot.entrypoints.default.clone(),
        compiled_policy_fingerprint: actual_compiled_policy_fingerprint,
        activated_at,
        activation_event_id: String::new(),
    };
    Ok((
        ActiveModePackSnapshot {
            summary,
            global_policy_artifacts,
            policies,
        },
        approved.summary,
    ))
}

pub(super) fn rollback_active_workspace_modepack(
    store: &BrownieStore,
    params: &ModePackRollbackActiveParams,
) -> Result<ModePackRollbackActiveResult, String> {
    let committed = store
        .rollback_active_modepack_snapshot(
            &params.expected_current_activation_fingerprint,
            &params.expected_rollback_activation_fingerprint,
        )
        .map_err(|error| format!("modepack rollback failed: {error}"))?;
    Ok(ModePackRollbackActiveResult {
        rolled_back: !committed.replayed,
        replayed: committed.replayed,
        current_snapshot: committed.current_snapshot.summary,
        restored_snapshot: committed.restored_snapshot.summary,
        rollback_event_id: committed.event_id,
    })
}

pub(super) fn build_active_modepack_snapshot(
    store: &BrownieStore,
) -> Result<ActiveModePackSnapshot, String> {
    let Some(snapshot) = load_workspace_modepack(store.workspace_root())
        .map_err(|error| format!("modepack load failed: {error}"))?
    else {
        return Err("modepack activation failed: missing .brownie/modepack.json".to_string());
    };
    let activated_at = codebase_index_timestamp().map_err(|error| error.to_string())?;
    let policy_snapshots = snapshot
        .modes
        .iter()
        .map(|policy| {
            let policy_fingerprint = external_modepack_policy_fingerprint(
                &snapshot.name,
                snapshot.schema_version,
                policy,
            );
            ActiveModePackPolicySnapshot {
                mode_id: policy.mode_id.clone(),
                display_name: policy.display_name.clone(),
                role_definition: policy.role_definition.clone(),
                when_to_use: policy.when_to_use.clone(),
                description: policy.description.clone(),
                prompt_sections: mode_prompt_sections_payload(policy),
                verification_responsibility: policy.verification_responsibility.clone(),
                instruction_fingerprint: policy.instruction_fingerprint.clone(),
                permissions: mode_permissions_payload(policy),
                workspace_write_scopes: mode_workspace_write_scopes_payload(policy),
                allowed_handoff_targets: policy.allowed_handoff_targets.clone(),
                mcp_access: mode_mcp_access_payload(policy),
                completion_rules: policy.completion_rules.clone(),
                policy_fingerprint,
            }
        })
        .collect::<Vec<_>>();
    let mode_ids = policy_snapshots
        .iter()
        .map(|policy| policy.mode_id.clone())
        .collect::<Vec<_>>();
    let global_policy_artifacts = modepack_global_policy_artifacts_payload(&snapshot);
    let compiled_policy_fingerprint = active_modepack_compiled_policy_fingerprint(
        &snapshot.name,
        snapshot.schema_version,
        snapshot.entrypoints.default_mode_id(),
        &global_policy_artifacts,
        &policy_snapshots,
    );
    let activation_fingerprint = active_modepack_activation_fingerprint(
        &snapshot.name,
        snapshot.schema_version,
        &compiled_policy_fingerprint,
        &mode_ids,
        snapshot.entrypoints.default_mode_id(),
    );
    let summary = ModePackActiveSnapshotSummary {
        activation_id: format!("modepack_activation_{}", &activation_fingerprint[7..23]),
        activation_fingerprint,
        modepack_name: snapshot.name,
        schema_version: snapshot.schema_version,
        source_kind: "workspace_modepack".to_string(),
        source_path: WORKSPACE_MODEPACK_PATH.to_string(),
        mode_count: mode_ids.len(),
        mode_ids,
        default_entrypoint: snapshot.entrypoints.default.clone(),
        compiled_policy_fingerprint,
        activated_at,
        activation_event_id: String::new(),
    };
    Ok(ActiveModePackSnapshot {
        summary,
        global_policy_artifacts,
        policies: policy_snapshots,
    })
}

pub(super) fn mode_permissions_payload(policy: &CompiledModePolicy) -> Value {
    json!({
        "read_only": policy.permissions.read_only,
        "workspace_write": policy.permissions.workspace_write,
        "process_exec": policy.permissions.process_exec,
        "network_access": policy.permissions.network_access,
        "service_control": policy.permissions.service_control,
        "destructive": policy.permissions.destructive,
        "can_spawn_subtasks": policy.permissions.can_spawn_subtasks,
        "codebase_index": policy.permissions.codebase_index,
        "mcp_tool_access": policy.permissions.mcp_tool_access,
    })
}

pub(super) fn mode_mcp_access_payload(policy: &CompiledModePolicy) -> Vec<Value> {
    policy
        .mcp_access
        .iter()
        .map(|access| json!(access))
        .collect()
}

pub(super) fn mode_workspace_write_scopes_payload(policy: &CompiledModePolicy) -> Vec<Value> {
    policy
        .workspace_write_scopes
        .iter()
        .map(|scope| json!(scope))
        .collect()
}

pub(super) fn mode_prompt_sections_payload(policy: &CompiledModePolicy) -> Vec<Value> {
    policy
        .prompt_sections
        .iter()
        .map(|section| json!(section))
        .collect()
}

pub(super) fn modepack_global_policy_artifacts_payload(snapshot: &ModePackSnapshot) -> Vec<Value> {
    snapshot
        .global_policy_artifacts
        .iter()
        .map(|artifact| json!(artifact))
        .collect()
}

pub(super) fn active_modepack_compiled_policy_fingerprint(
    modepack_name: &str,
    schema_version: u64,
    default_entrypoint: Option<&str>,
    global_policy_artifacts: &[Value],
    policies: &[ActiveModePackPolicySnapshot],
) -> String {
    let canonical = json!({
        "version": "active_modepack_compiled_policy_fingerprint_v3",
        "modepack_name": modepack_name,
        "schema_version": schema_version,
        "source_path": WORKSPACE_MODEPACK_PATH,
        "default_entrypoint": default_entrypoint,
        "global_policy_artifacts": global_policy_artifacts,
        "policies": policies,
    });
    format!("sha256:{}", hex_sha256(canonical.to_string().as_bytes()))
}

pub(super) fn active_modepack_activation_fingerprint(
    modepack_name: &str,
    schema_version: u64,
    compiled_policy_fingerprint: &str,
    mode_ids: &[String],
    default_entrypoint: Option<&str>,
) -> String {
    let canonical = json!({
        "version": "active_modepack_activation_fingerprint_v2",
        "modepack_name": modepack_name,
        "schema_version": schema_version,
        "source_path": WORKSPACE_MODEPACK_PATH,
        "mode_ids": mode_ids,
        "default_entrypoint": default_entrypoint,
        "compiled_policy_fingerprint": compiled_policy_fingerprint,
    });
    format!("sha256:{}", hex_sha256(canonical.to_string().as_bytes()))
}

pub(super) fn external_modepack_task_provenance_from_mode_resolved(
    store: &BrownieStore,
    record: &TaskRecord,
) -> Result<Option<Value>, TaskRunAdmissionRejection> {
    let events = store
        .tasks()
        .read_ledger_events(&record.run_id)
        .map_err(|error| TaskRunAdmissionRejection::Internal(error.to_string()))?;
    Ok(events
        .iter()
        .rev()
        .find(|event| event.kind == LedgerEventKind::ModeResolved)
        .and_then(|event| event.payload.as_ref())
        .and_then(|payload| payload.get("external_modepack_task_provenance"))
        .cloned())
}

pub(super) fn direct_external_modepack_task_requires_provenance(record: &TaskRecord) -> bool {
    record.parent_run_id.is_none()
        && record.parent_task_id.is_none()
        && record
            .mode_id
            .as_deref()
            .is_some_and(|mode_id| BuiltinModeRegistry::get(mode_id).is_none())
}

pub(super) fn revalidate_external_modepack_task_provenance_for_run(
    store: &BrownieStore,
    record: &TaskRecord,
) -> Result<(), TaskRunAdmissionRejection> {
    if record.parent_run_id.is_some() || record.parent_task_id.is_some() {
        return Ok(());
    }

    let provenance = external_modepack_task_provenance_from_mode_resolved(store, record)?;
    let Some(provenance) = provenance else {
        if direct_external_modepack_task_requires_provenance(record) {
            return external_modepack_task_provenance_denied(
                record,
                store,
                "missing_external_modepack_task_provenance",
                "invalid params: external Mode Pack task provenance is missing",
            );
        }
        return Ok(());
    };

    let Some(mode_id) = record.mode_id.as_deref() else {
        return external_modepack_task_provenance_denied(
            record,
            store,
            "missing_task_mode_id",
            "invalid params: external Mode Pack task provenance is invalid",
        );
    };
    if provenance.get("version").and_then(Value::as_str)
        != Some(EXTERNAL_MODEPACK_TASK_PROVENANCE_VERSION)
        || !is_bounded_modepack_provenance_string(provenance.get("source_kind"))
        || !is_bounded_modepack_provenance_string(provenance.get("source_path"))
        || provenance.get("mode_id").and_then(Value::as_str) != Some(mode_id)
    {
        return external_modepack_task_provenance_denied(
            record,
            store,
            "malformed_external_modepack_task_provenance",
            "invalid params: external Mode Pack task provenance is invalid",
        );
    }
    let Some(captured_fingerprint) = provenance
        .get("policy_fingerprint")
        .and_then(Value::as_str)
        .filter(|value| value.starts_with("sha256:") && value.len() == "sha256:".len() + 64)
    else {
        return external_modepack_task_provenance_denied(
            record,
            store,
            "malformed_external_modepack_policy_fingerprint",
            "invalid params: external Mode Pack task provenance is invalid",
        );
    };
    let captured_activation_fingerprint = provenance
        .get("activation_fingerprint")
        .and_then(Value::as_str);
    if captured_activation_fingerprint.is_some_and(|value| !is_sha256_fingerprint(value)) {
        return external_modepack_task_provenance_denied(
            record,
            store,
            "malformed_external_modepack_activation_fingerprint",
            "invalid params: external Mode Pack task provenance is invalid",
        );
    }
    let current = match external_modepack_task_provenance_payload(store, mode_id) {
        Ok(current) => current,
        Err(_) => {
            return external_modepack_task_provenance_denied(
                record,
                store,
                "malformed_external_modepack_task_policy",
                "invalid params: external Mode Pack task provenance is stale",
            );
        }
    };
    let Some(current) = current else {
        return external_modepack_task_provenance_denied(
            record,
            store,
            "stale_external_modepack_task_policy_missing",
            "invalid params: external Mode Pack task provenance is stale",
        );
    };
    for key in [
        "source_kind",
        "modepack_name",
        "schema_version",
        "source_path",
        "mode_id",
        "policy_fingerprint",
    ] {
        if provenance.get(key) != current.get(key) {
            return external_modepack_task_provenance_denied(
                record,
                store,
                "stale_external_modepack_task_policy_mismatch",
                "invalid params: external Mode Pack task provenance is stale",
            );
        }
    }
    if let Some(captured_activation_fingerprint) = captured_activation_fingerprint {
        if current
            .get("activation_fingerprint")
            .and_then(Value::as_str)
            != Some(captured_activation_fingerprint)
        {
            return external_modepack_task_provenance_denied(
                record,
                store,
                "stale_external_modepack_task_policy_mismatch",
                "invalid params: external Mode Pack task provenance is stale",
            );
        }
    }
    if current.get("policy_fingerprint").and_then(Value::as_str) != Some(captured_fingerprint) {
        return external_modepack_task_provenance_denied(
            record,
            store,
            "stale_external_modepack_task_policy_mismatch",
            "invalid params: external Mode Pack task provenance is stale",
        );
    }
    Ok(())
}

pub(super) fn is_bounded_modepack_provenance_string(value: Option<&Value>) -> bool {
    value
        .and_then(Value::as_str)
        .is_some_and(|value| !value.is_empty() && value.len() <= 160 && is_bounded_ascii(value))
}

pub(super) fn is_bounded_ascii(value: &str) -> bool {
    value
        .bytes()
        .all(|byte| byte.is_ascii() && !byte.is_ascii_control())
}

pub(super) fn modepack_provenance_denial_field(
    record: &TaskRecord,
    store: &BrownieStore,
    field: &str,
    fallback: &str,
) -> String {
    external_modepack_task_provenance_from_mode_resolved(store, record)
        .ok()
        .flatten()
        .and_then(|provenance| {
            provenance
                .get(field)
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty() && value.len() <= 160 && is_bounded_ascii(value))
                .map(ToString::to_string)
        })
        .unwrap_or_else(|| fallback.to_string())
}

pub(super) fn external_modepack_task_provenance_denied(
    record: &TaskRecord,
    store: &BrownieStore,
    reason: &'static str,
    message: &'static str,
) -> Result<(), TaskRunAdmissionRejection> {
    let events = store
        .tasks()
        .read_ledger_events(&record.run_id)
        .map_err(|error| TaskRunAdmissionRejection::Internal(error.to_string()))?;
    if !events.iter().any(|event| {
        event.kind == LedgerEventKind::ExternalModePackTaskProvenanceDenied
            && event
                .payload
                .as_ref()
                .and_then(|payload| payload.get("reason"))
                .and_then(Value::as_str)
                == Some(reason)
    }) {
        store
            .tasks()
            .append_task_event_with_payload(
                record,
                LedgerEventKind::ExternalModePackTaskProvenanceDenied,
                Some(json!({
                    "status": "Denied",
                    "reason": reason,
                    "task_id": record.task_id,
                    "run_id": record.run_id,
                    "mode_id": record.mode_id,
                    "source_kind": modepack_provenance_denial_field(record, store, "source_kind", "workspace_modepack"),
                    "source_path": modepack_provenance_denial_field(record, store, "source_path", WORKSPACE_MODEPACK_PATH),
                })),
            )
            .map_err(|error| TaskRunAdmissionRejection::Internal(error.to_string()))?;
    }
    Err(TaskRunAdmissionRejection::InvalidParams(message))
}

pub(super) fn external_modepack_child_provenance_payload(
    store: &BrownieStore,
    child_mode_id: &str,
    parent_run_id: &str,
    source_handoff_envelope_id: &str,
    source_handoff_envelope_fingerprint: &str,
) -> Result<Option<Value>, String> {
    if let Some(snapshot) = store
        .read_active_modepack_snapshot()
        .map_err(|error| format!("active modepack snapshot load failed: {error}"))?
    {
        let Some(policy) = snapshot
            .policies
            .iter()
            .find(|policy| policy.mode_id == child_mode_id)
        else {
            return Ok(None);
        };
        return Ok(Some(json!({
            "version": EXTERNAL_MODEPACK_CHILD_PROVENANCE_VERSION,
            "source_kind": snapshot.summary.source_kind,
            "modepack_name": snapshot.summary.modepack_name,
            "schema_version": snapshot.summary.schema_version,
            "source_path": snapshot.summary.source_path,
            "mode_id": policy.mode_id,
            "policy_fingerprint": policy.policy_fingerprint,
            "activation_fingerprint": snapshot.summary.activation_fingerprint,
            "captured_parent_run_id": parent_run_id,
            "captured_handoff_envelope_id": source_handoff_envelope_id,
            "captured_handoff_envelope_fingerprint": source_handoff_envelope_fingerprint,
        })));
    }

    let Some(snapshot) = load_workspace_modepack(store.workspace_root())
        .map_err(|error| format!("modepack load failed: {error}"))?
    else {
        return Ok(None);
    };
    let Some(policy) = snapshot
        .modes
        .iter()
        .find(|policy| policy.mode_id == child_mode_id)
    else {
        return Ok(None);
    };
    let policy_fingerprint =
        external_modepack_policy_fingerprint(&snapshot.name, snapshot.schema_version, policy);
    Ok(Some(json!({
        "version": EXTERNAL_MODEPACK_CHILD_PROVENANCE_VERSION,
        "source_kind": "workspace_modepack",
        "modepack_name": snapshot.name,
        "schema_version": snapshot.schema_version,
        "source_path": WORKSPACE_MODEPACK_PATH,
        "mode_id": policy.mode_id,
        "policy_fingerprint": policy_fingerprint,
        "captured_parent_run_id": parent_run_id,
        "captured_handoff_envelope_id": source_handoff_envelope_id,
        "captured_handoff_envelope_fingerprint": source_handoff_envelope_fingerprint,
    })))
}
