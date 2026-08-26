use super::*;

fn headless_run_drive_explicit_modepack_target_count(params: &HeadlessRunDriveParams) -> usize {
    usize::from(params.modepack_registry_update_selection_target.is_some())
        + usize::from(params.modepack_selected_candidate_fetch_target.is_some())
        + usize::from(
            params
                .modepack_selected_candidate_provenance_verification_target
                .is_some(),
        )
        + usize::from(params.modepack_selected_candidate_approval_target.is_some())
        + usize::from(
            params
                .modepack_selected_approved_candidate_replacement_target
                .is_some(),
        )
}

fn headless_run_drive_has_explicit_modepack_target(params: &HeadlessRunDriveParams) -> bool {
    headless_run_drive_explicit_modepack_target_count(params) > 0
}

fn headless_journey_task_start_fingerprint(admission: &HeadlessRunJourneyAdmission) -> String {
    let seed = json!({
        "journey_id": admission.journey_id,
        "task_start": admission.task_start,
        "product_objective_continuation_source": admission.product_objective_continuation_source,
        "objective_context_fingerprint": admission
            .objective_context
            .as_ref()
            .map(headless_journey_objective_context_fingerprint),
    });
    format!("sha256:{}", hex_sha256(seed.to_string().as_bytes()))
}

fn headless_journey_effective_task_start(
    task_start: &HeadlessRunJourneyTaskStartEnvelope,
) -> HeadlessRunJourneyTaskStartEnvelope {
    let mut effective = task_start.clone();
    if effective
        .mode_id
        .as_deref()
        .map(str::trim)
        .unwrap_or_default()
        .is_empty()
    {
        effective.mode_id = Some("provider-runner".to_string());
    }
    effective
}

fn headless_journey_selected_index_context_fingerprint(
    context: &TaskRunSelectedIndexContext,
) -> String {
    let seed = json!({
        "query_id": context.query_id,
        "selection_id": context.selection_id,
        "query_fingerprint": context.query_fingerprint,
        "selection_fingerprint": context.selection_fingerprint,
        "index_id": context.snapshot.index_id,
        "workspace_fingerprint": context.snapshot.workspace_fingerprint,
        "snapshot_fingerprint": context.snapshot.snapshot_fingerprint,
        "read_path_fingerprint": format!("sha256:{}", hex_sha256(context.path.as_bytes())),
        "file_kind": context.file_kind,
        "bytes_read": context.bytes_read,
        "content_sha256": context.content_sha256,
        "source_event_id": context.ledger_event_id,
        "source_event_kind": context.ledger_event_kind,
        "next_action": context.next_action,
    });
    format!("sha256:{}", hex_sha256(seed.to_string().as_bytes()))
}

fn headless_journey_objective_context_fingerprint(
    context: &brownie_protocol::HeadlessRunJourneyObjectiveContext,
) -> String {
    let seed = json!({
        "objective_id": context.objective_id,
        "objective_fingerprint": context.objective_fingerprint,
        "selected_context_fingerprint": headless_journey_selected_index_context_fingerprint(
            &context.selected_index_context,
        ),
    });
    format!("sha256:{}", hex_sha256(seed.to_string().as_bytes()))
}

fn validate_headless_journey_objective_context(
    store: &BrownieStore,
    policy: &CompiledModePolicy,
    context: &brownie_protocol::HeadlessRunJourneyObjectiveContext,
) -> Result<(), TaskRunAdmissionRejection> {
    if !context.authorize_objective_context_admission {
        return invalid_selected_index_context("objective_context authorization is required");
    }
    if !is_valid_headless_run_id(&context.objective_id) {
        return invalid_selected_index_context("objective_id is malformed");
    }
    if !is_sha256_fingerprint(&context.objective_fingerprint) {
        return invalid_selected_index_context("objective_fingerprint is malformed");
    }
    validate_selected_index_context_evidence(store, policy, &context.selected_index_context)?;
    Ok(())
}

fn headless_journey_objective_context_metadata(
    context: &brownie_protocol::HeadlessRunJourneyObjectiveContext,
    validated: &ValidatedTaskRunSelectedIndexContext,
) -> HeadlessRunJourneyObjectiveContextMetadata {
    let summary = &validated.summary;
    HeadlessRunJourneyObjectiveContextMetadata {
        objective_id: context.objective_id.clone(),
        objective_fingerprint: context.objective_fingerprint.clone(),
        objective_context_fingerprint: headless_journey_objective_context_fingerprint(context),
        selected_context_fingerprint: headless_journey_selected_index_context_fingerprint(
            &context.selected_index_context,
        ),
        prompt_context_id: summary.prompt_context_id.clone(),
        source_event_id: summary.source_event_id.clone(),
        source_event_kind: summary.source_event_kind.clone(),
        query_id: summary.query_id.clone(),
        selection_id: summary.selection_id.clone(),
        query_fingerprint: summary.query_fingerprint.clone(),
        selection_fingerprint: summary.selection_fingerprint.clone(),
        index_id: summary.index_id.clone(),
        workspace_fingerprint: summary.workspace_fingerprint.clone(),
        snapshot_fingerprint: summary.snapshot_fingerprint.clone(),
        read_path_fingerprint: summary.read_path_fingerprint.clone(),
        file_kind: summary.file_kind.clone(),
        bytes_read: summary.bytes_read,
        content_char_count: summary.content_char_count,
        content_sha256: summary.content_sha256.clone(),
        next_action: "run_admitted_coding_task".to_string(),
    }
}

fn validate_headless_journey_admission(
    params: &HeadlessRunDriveParams,
    drive_id: &str,
) -> Result<(), String> {
    let Some(admission) = params.journey_admission.as_ref() else {
        return Ok(());
    };
    if !is_valid_headless_run_id(&admission.journey_id) {
        return Err("invalid params: journey_id must be 1-48 ASCII alphanumeric, dash, underscore, colon, or dot characters".to_string());
    }
    if !admission.authorize_journey_start {
        return Err("invalid params: authorize_journey_start must be true".to_string());
    }
    let source_count = usize::from(admission.task_start.is_some())
        + usize::from(admission.product_objective_continuation_source.is_some());
    if source_count != 1 {
        return Err("invalid params: journey admission requires exactly one task_start or product_objective_continuation_source".to_string());
    }
    if let Some(task_start) = admission.task_start.as_ref() {
        if task_start.goal.trim().is_empty() {
            return Err("invalid params: journey task_start.goal must not be empty".to_string());
        }
    }
    if let Some(source) = admission.product_objective_continuation_source.as_ref() {
        validate_product_objective_continuation_journey_source_shape(source)?;
    }
    if params.expected_start_session_sequence != 0 {
        return Err(
            "invalid params: journey admission requires expected_start_session_sequence 0"
                .to_string(),
        );
    }
    if drive_id.starts_with("drive.") {
        return Err("invalid params: journey admission requires an explicit drive_id".to_string());
    }
    if headless_run_drive_has_explicit_modepack_target(params) {
        return Err("invalid params: journey admission cannot be combined with explicit modepack run-control targets".to_string());
    }
    if params.authorize_completion_finalization.unwrap_or(false) {
        return Err(
            "invalid params: journey admission cannot authorize completion finalization"
                .to_string(),
        );
    }
    if admission.objective_context.is_some() {
        if params.max_advances.unwrap_or(1) != 1 || params.max_steps_per_advance.unwrap_or(1) != 1 {
            return Err(
                "invalid params: objective_context admission requires one advance with one step"
                    .to_string(),
            );
        }
    }
    Ok(())
}

fn headless_journey_start_checkpoint_for_admission(
    store: &BrownieStore,
    admission: &HeadlessRunJourneyAdmission,
    session_id: &str,
    drive_id: &str,
    id: &Value,
) -> Result<HeadlessJourneyStartCheckpoint, JsonRpcResponse<Value>> {
    let task_start_fingerprint = headless_journey_task_start_fingerprint(admission);
    if let Some(existing) = store
        .tasks()
        .read_headless_journey_start_checkpoint(&admission.journey_id)
        .map_err(|error| error_response(id.clone(), -32603, &format!("internal error: {error}")))?
    {
        if existing.session_id != session_id
            || existing.drive_id != drive_id
            || existing.task_start_fingerprint != task_start_fingerprint
        {
            return Err(error_response(
                id.clone(),
                -32602,
                "invalid params: journey_id conflicts with persisted journey start checkpoint",
            ));
        }
        if let Some(source) = admission.product_objective_continuation_source.as_ref() {
            let (_, provenance) = product_objective_continuation_for_journey_source(
                store, source, false,
            )
            .map_err(|error| match error {
                VerificationRecoveryAdmissionError::InvalidParams(message) => {
                    error_response(id.clone(), -32602, &message)
                }
                VerificationRecoveryAdmissionError::Internal(message) => {
                    error_response(id.clone(), -32603, &format!("internal error: {message}"))
                }
            })?;
            if existing.product_objective_continuation_provenance.as_ref() != Some(&provenance) {
                return Err(error_response(
                    id.clone(),
                    -32602,
                    "invalid params: product objective continuation source conflicts with persisted journey start checkpoint",
                ));
            }
        }
        return Ok(existing);
    }
    if store
        .tasks()
        .read_headless_run_session_checkpoint(session_id)
        .map_err(|error| error_response(id.clone(), -32603, &format!("internal error: {error}")))?
        .is_some()
    {
        return Err(error_response(
            id.clone(),
            -32602,
            "invalid params: journey admission requires no existing session checkpoint",
        ));
    }
    let product_objective_continuation_provenance =
        if let Some(source) = admission.product_objective_continuation_source.as_ref() {
            let (_, provenance) = product_objective_continuation_for_journey_source(
                store, source, true,
            )
            .map_err(|error| match error {
                VerificationRecoveryAdmissionError::InvalidParams(message) => {
                    error_response(id.clone(), -32602, &message)
                }
                VerificationRecoveryAdmissionError::Internal(message) => {
                    error_response(id.clone(), -32603, &format!("internal error: {message}"))
                }
            })?;
            Some(provenance)
        } else {
            None
        };
    let (start_task_id, start_run_id, policy, cleanup_started_task) = if let Some(source) =
        admission.product_objective_continuation_source.as_ref()
    {
        let (record, _) = product_objective_continuation_for_journey_source(store, source, true)
            .map_err(|error| match error {
                VerificationRecoveryAdmissionError::InvalidParams(message) => {
                    error_response(id.clone(), -32602, &message)
                }
                VerificationRecoveryAdmissionError::Internal(message) => {
                    error_response(id.clone(), -32603, &format!("internal error: {message}"))
                }
            })?;
        let policy = resolve_task_start_policy(record.mode_id.as_deref(), store)
            .map_err(|message| error_response(id.clone(), -32602, &message))?;
        (record.task_id, record.run_id, policy, false)
    } else {
        let Some(task_start) = admission.task_start.as_ref() else {
            return Err(error_response(
                id.clone(),
                -32602,
                "invalid params: journey admission requires task_start",
            ));
        };
        let task_start = headless_journey_effective_task_start(task_start);
        let policy = resolve_task_start_policy(task_start.mode_id.as_deref(), store)
            .map_err(|message| error_response(id.clone(), -32602, &message))?;
        let start_response = handle_task_start(
            id.clone(),
            Some(json!({
                "goal": task_start.goal.clone(),
                "mode_id": task_start.mode_id.clone(),
            })),
        );
        let Some(start_value) = start_response.result else {
            return Err(JsonRpcResponse {
                jsonrpc: JSONRPC_VERSION.to_string(),
                id: id.clone(),
                result: None,
                error: start_response.error,
            });
        };
        let start_result: TaskStartResult =
            serde_json::from_value(start_value).map_err(|error| {
                error_response(id.clone(), -32603, &format!("internal error: {error}"))
            })?;
        (start_result.task_id, start_result.run_id, policy, true)
    };
    if let Some(context) = admission.objective_context.as_ref() {
        validate_headless_journey_objective_context(store, &policy, context).map_err(
            |rejection| {
                let cleanup = if cleanup_started_task {
                    store.tasks().remove_task_run(&start_task_id, &start_run_id)
                } else {
                    Ok(())
                };
                match rejection {
                    TaskRunAdmissionRejection::InvalidParams(message) => {
                        let message = match cleanup {
                            Ok(()) => message.to_string(),
                            Err(cleanup_error) => {
                                format!("{message}; cleanup failed: {cleanup_error}")
                            }
                        };
                        error_response(id.clone(), -32602, &message)
                    }
                    TaskRunAdmissionRejection::Internal(message) => {
                        let message = match cleanup {
                            Ok(()) => format!("internal error: {message}"),
                            Err(cleanup_error) => {
                                format!(
                                    "internal error: {message}; cleanup failed: {cleanup_error}"
                                )
                            }
                        };
                        error_response(id.clone(), -32603, &message)
                    }
                }
            },
        )?;
    }
    let tasks = store
        .tasks()
        .list_tasks()
        .map_err(|error| error_response(id.clone(), -32603, &format!("internal error: {error}")))?;
    let progress = task_list_progress_overview(store, &tasks)
        .map_err(|error| error_response(id.clone(), -32603, &format!("internal error: {error}")))?;
    let start_progress = HeadlessRunProgressCheckpoint {
        progress_fingerprint: progress.source_fingerprint,
        aggregate_sequence: progress.aggregate_sequence,
    };
    let objective_context_metadata = if let Some(context) = admission.objective_context.as_ref() {
        let Some(record) = store.tasks().get_task(&start_task_id).map_err(|error| {
            let cleanup = if cleanup_started_task {
                store.tasks().remove_task_run(&start_task_id, &start_run_id)
            } else {
                Ok(())
            };
            let message = match cleanup {
                Ok(()) => format!("internal error: journey admission task lookup failed: {error}"),
                Err(cleanup_error) => format!(
                    "internal error: journey admission task lookup failed: {error}; cleanup failed: {cleanup_error}"
                ),
            };
            error_response(id.clone(), -32603, &message)
        })?
        else {
            let cleanup = if cleanup_started_task {
                store.tasks().remove_task_run(&start_task_id, &start_run_id)
            } else {
                Ok(())
            };
            let message = match cleanup {
                Ok(()) => "internal error: journey admission task lookup failed".to_string(),
                Err(cleanup_error) => format!(
                    "internal error: journey admission task lookup failed; cleanup failed: {cleanup_error}"
                ),
            };
            return Err(error_response(id.clone(), -32603, &message));
        };
        let validated = validate_task_run_selected_index_context(
            store,
            &record,
            &policy,
            &context.selected_index_context,
        )
        .map_err(|rejection| {
            let cleanup = if cleanup_started_task {
                store.tasks().remove_task_run(&start_task_id, &start_run_id)
            } else {
                Ok(())
            };
            match rejection {
                TaskRunAdmissionRejection::InvalidParams(message) => {
                    let message = match cleanup {
                        Ok(()) => message.to_string(),
                        Err(cleanup_error) => {
                            format!("{message}; cleanup failed: {cleanup_error}")
                        }
                    };
                    error_response(id.clone(), -32602, &message)
                }
                TaskRunAdmissionRejection::Internal(message) => {
                    let message = match cleanup {
                        Ok(()) => format!("internal error: {message}"),
                        Err(cleanup_error) => {
                            format!("internal error: {message}; cleanup failed: {cleanup_error}")
                        }
                    };
                    error_response(id.clone(), -32603, &message)
                }
            }
        })?;
        Some(headless_journey_objective_context_metadata(
            context, &validated,
        ))
    } else {
        None
    };
    let journey_seed = json!({
        "journey_id": admission.journey_id,
        "session_id": session_id,
        "drive_id": drive_id,
        "task_id": start_task_id,
        "run_id": start_run_id,
        "task_start_fingerprint": task_start_fingerprint,
        "start_progress": start_progress,
        "objective_context": objective_context_metadata.clone(),
        "product_objective_continuation_provenance": product_objective_continuation_provenance.clone(),
    });
    let checkpoint = HeadlessJourneyStartCheckpoint {
        journey_id: admission.journey_id.clone(),
        session_id: session_id.to_string(),
        drive_id: drive_id.to_string(),
        task_id: start_task_id,
        run_id: start_run_id,
        task_start_fingerprint,
        start_progress,
        journey_fingerprint: format!("sha256:{}", hex_sha256(journey_seed.to_string().as_bytes())),
        objective_context: objective_context_metadata,
        product_objective_continuation_provenance,
    };
    #[cfg(test)]
    if std::env::var_os("BROWNIE_TEST_FAIL_HEADLESS_JOURNEY_CHECKPOINT_WRITE").is_some() {
        let cleanup = if cleanup_started_task {
            store
                .tasks()
                .remove_task_run(&checkpoint.task_id, &checkpoint.run_id)
        } else {
            Ok(())
        };
        let message = match cleanup {
            Ok(()) => {
                "internal error: simulated journey admission checkpoint commit failure".to_string()
            }
            Err(cleanup_error) => format!(
                "internal error: simulated journey admission checkpoint commit failure; cleanup failed: {cleanup_error}"
            ),
        };
        return Err(error_response(id.clone(), -32603, &message));
    }
    store
        .tasks()
        .write_headless_journey_start_checkpoint(&checkpoint)
        .map_err(|error| {
            let cleanup = if cleanup_started_task {
                store
                    .tasks()
                    .remove_task_run(&checkpoint.task_id, &checkpoint.run_id)
            } else {
                Ok(())
            };
            let message = match cleanup {
                Ok(()) => format!("internal error: journey admission checkpoint commit failed: {error}"),
                Err(cleanup_error) => format!(
                    "internal error: journey admission checkpoint commit failed: {error}; cleanup failed: {cleanup_error}"
                ),
            };
            error_response(id.clone(), -32603, &message)
        })?;
    if let Some(record) = store
        .tasks()
        .get_task(&checkpoint.task_id)
        .map_err(|error| error_response(id.clone(), -32603, &format!("internal error: {error}")))?
    {
        #[cfg(test)]
        if std::env::var_os("BROWNIE_TEST_FAIL_HEADLESS_JOURNEY_STARTED_APPEND").is_some() {
            let checkpoint_cleanup = store
                .tasks()
                .remove_headless_journey_start_checkpoint(&checkpoint);
            let task_cleanup = if cleanup_started_task {
                store
                    .tasks()
                    .remove_task_run(&checkpoint.task_id, &checkpoint.run_id)
            } else {
                Ok(())
            };
            let message = match (checkpoint_cleanup, task_cleanup) {
                (Ok(()), Ok(())) => {
                    "internal error: simulated HeadlessJourneyStarted append failure".to_string()
                }
                (checkpoint_result, task_result) => format!(
                    "internal error: simulated HeadlessJourneyStarted append failure; checkpoint cleanup: {}; task cleanup: {}",
                    checkpoint_result
                        .err()
                        .map(|error| error.to_string())
                        .unwrap_or_else(|| "ok".to_string()),
                    task_result
                        .err()
                        .map(|error| error.to_string())
                        .unwrap_or_else(|| "ok".to_string())
                ),
            };
            return Err(error_response(id.clone(), -32603, &message));
        }
        let mut event_payload = json!({
            "journey_id": checkpoint.journey_id,
            "session_id": checkpoint.session_id,
            "drive_id": checkpoint.drive_id,
            "task_id": checkpoint.task_id,
            "run_id": checkpoint.run_id,
            "task_start_fingerprint": checkpoint.task_start_fingerprint,
            "start_progress_fingerprint": checkpoint.start_progress.progress_fingerprint,
            "start_aggregate_sequence": checkpoint.start_progress.aggregate_sequence,
            "journey_fingerprint": checkpoint.journey_fingerprint,
            "next_action": "drive_headless_journey",
            "reason": "Headless journey admitted one initial task under bounded runtime-owned drive authority."
        });
        if let Some(objective_context) = checkpoint.objective_context.as_ref() {
            event_payload["objective_context"] = json!(objective_context);
            event_payload["next_action"] = json!("run_admitted_coding_task");
        }
        if let Some(provenance) = checkpoint
            .product_objective_continuation_provenance
            .as_ref()
        {
            event_payload["product_objective_continuation_provenance"] = json!(provenance);
            event_payload["remaining_capability"] = json!(provenance.remaining_capability);
            event_payload["remaining_capability_fingerprint"] =
                json!(provenance.remaining_capability_fingerprint);
            event_payload["derived_objective_fingerprint"] =
                json!(provenance.derived_objective_fingerprint);
            event_payload["derived_goal_fingerprint"] = json!(provenance.derived_goal_fingerprint);
            event_payload["next_action"] = json!("drive_headless_journey");
        }
        store
            .tasks()
            .append_task_event_with_payload(
                &record,
                LedgerEventKind::HeadlessJourneyStarted,
                Some(event_payload),
            )
            .map_err(|error| {
                let checkpoint_cleanup = store
                    .tasks()
                    .remove_headless_journey_start_checkpoint(&checkpoint);
                let task_cleanup = if cleanup_started_task {
                    store
                        .tasks()
                        .remove_task_run(&checkpoint.task_id, &checkpoint.run_id)
                } else {
                    Ok(())
                };
                let message = match (checkpoint_cleanup, task_cleanup) {
                    (Ok(()), Ok(())) => {
                        format!("internal error: journey admission event commit failed: {error}")
                    }
                    (checkpoint_result, task_result) => format!(
                        "internal error: journey admission event commit failed: {error}; checkpoint cleanup: {}; task cleanup: {}",
                        checkpoint_result
                            .err()
                            .map(|cleanup_error| cleanup_error.to_string())
                            .unwrap_or_else(|| "ok".to_string()),
                        task_result
                            .err()
                            .map(|cleanup_error| cleanup_error.to_string())
                            .unwrap_or_else(|| "ok".to_string())
                    ),
                };
                error_response(id.clone(), -32603, &message)
            })?;
    }
    Ok(checkpoint)
}

fn headless_journey_metadata(
    checkpoint: &HeadlessJourneyStartCheckpoint,
    result: &HeadlessRunDriveResult,
    replayed: bool,
) -> HeadlessRunJourneyMetadata {
    HeadlessRunJourneyMetadata {
        journey_id: checkpoint.journey_id.clone(),
        task_id: checkpoint.task_id.clone(),
        run_id: checkpoint.run_id.clone(),
        session_id: result.session_id.clone(),
        drive_id: result.drive_id.clone(),
        start_progress_fingerprint: checkpoint.start_progress.progress_fingerprint.clone(),
        start_aggregate_sequence: checkpoint.start_progress.aggregate_sequence,
        post_progress_fingerprint: result
            .post_progress
            .as_ref()
            .map(|progress| progress.progress_fingerprint.clone()),
        post_aggregate_sequence: result
            .post_progress
            .as_ref()
            .map(|progress| progress.aggregate_sequence),
        closure_status: result.completion_closure.status.clone(),
        next_action: result.next_action.clone(),
        replayed,
        journey_fingerprint: checkpoint.journey_fingerprint.clone(),
        objective_context: checkpoint.objective_context.clone(),
        product_objective_continuation_provenance: checkpoint
            .product_objective_continuation_provenance
            .clone(),
        proposal_candidate: result.objective_proposal_candidate.clone(),
    }
}

#[derive(Debug, Clone)]
struct HeadlessJourneyRouteResumePlan {
    journey_checkpoint: HeadlessJourneyStartCheckpoint,
    route_kind: HeadlessContinueRouteKind,
    source_continuation_id: String,
    source_decision_id: String,
    source_checkpoint_fingerprint: String,
    derived_fetch_target: Option<ModePackSelectedCandidateFetchTarget>,
    derived_provenance_target: Option<ModePackSelectedCandidateProvenanceVerificationTarget>,
    derived_approval_target: Option<ModePackSelectedCandidateApprovalTarget>,
    derived_replacement_target: Option<ModePackSelectedApprovedCandidateReplacementTarget>,
    derived_target_class: String,
    resume_fingerprint: String,
}

#[derive(Debug, Clone)]
struct HeadlessJourneyClosurePlan {
    journey_checkpoint: HeadlessJourneyStartCheckpoint,
    source_replacement_drive_id: String,
    source_replacement_resume_fingerprint: String,
    replacement_continuation_id: String,
    replacement_checkpoint_fingerprint: String,
    active_modepack_activation_fingerprint: String,
    request_fingerprint: String,
}

pub(super) fn modepack_selected_candidate_fetch_target_from_selection_checkpoint(
    checkpoint: &HeadlessModePackRegistryUpdateSelectionCheckpoint,
) -> ModePackSelectedCandidateFetchTarget {
    let selected = &checkpoint.result.selection;
    ModePackSelectedCandidateFetchTarget {
        authorize_selected_candidate_fetch: true,
        selection_id: selected.selection_id.clone(),
        selection_event_id: selected.selection_event_id.clone(),
        expected_registry_manifest_sha256: selected.registry_manifest_sha256.clone(),
        expected_candidate_url_fingerprint: selected.candidate_url_fingerprint.clone(),
        expected_candidate_content_sha256: selected.candidate_content_sha256.clone(),
        expected_candidate_compiled_policy_fingerprint: selected
            .candidate_compiled_policy_fingerprint
            .clone(),
        expected_provenance_statement_url_fingerprint: selected
            .provenance_statement_url_fingerprint
            .clone(),
        expected_provenance_statement_sha256: selected.provenance_statement_sha256.clone(),
        expected_signer_fingerprint: selected.signer_fingerprint.clone(),
        expected_current_activation_fingerprint: selected.current_activation_fingerprint.clone(),
    }
}

pub(super) fn headless_registry_update_selection_checkpoint_fingerprint(
    checkpoint: &HeadlessModePackRegistryUpdateSelectionCheckpoint,
) -> String {
    let selected = &checkpoint.result.selection;
    let seed = json!({
        "checkpoint_kind": "headless_modepack_registry_update_selection",
        "continuation_id": checkpoint.continuation_id,
        "decision_id": checkpoint.decision_id,
        "request_fingerprint": checkpoint.request_fingerprint,
        "expected_progress_fingerprint": checkpoint.expected_progress_fingerprint,
        "expected_aggregate_sequence": checkpoint.expected_aggregate_sequence,
        "current_progress_fingerprint": checkpoint.current_progress_fingerprint,
        "current_aggregate_sequence": checkpoint.current_aggregate_sequence,
        "post_progress_fingerprint": checkpoint.post_progress_fingerprint,
        "post_aggregate_sequence": checkpoint.post_aggregate_sequence,
        "selection_id": selected.selection_id,
        "selection_event_id": selected.selection_event_id,
        "registry_manifest_sha256": selected.registry_manifest_sha256,
        "candidate_url_fingerprint": selected.candidate_url_fingerprint,
        "candidate_content_sha256": selected.candidate_content_sha256,
        "candidate_compiled_policy_fingerprint": selected.candidate_compiled_policy_fingerprint,
        "provenance_statement_url_fingerprint": selected.provenance_statement_url_fingerprint,
        "provenance_statement_sha256": selected.provenance_statement_sha256,
        "signer_fingerprint": selected.signer_fingerprint,
        "current_activation_fingerprint": selected.current_activation_fingerprint,
    });
    format!("sha256:{}", hex_sha256(seed.to_string().as_bytes()))
}

fn modepack_selected_candidate_provenance_target_from_fetch_checkpoint(
    checkpoint: &HeadlessModePackSelectedCandidateFetchCheckpoint,
) -> Result<ModePackSelectedCandidateProvenanceVerificationTarget, String> {
    let candidate = &checkpoint.result.candidate;
    Ok(ModePackSelectedCandidateProvenanceVerificationTarget {
        authorize_selected_candidate_provenance_verification: true,
        fetch_continuation_id: checkpoint.continuation_id.clone(),
        expected_fetch_decision_id: checkpoint.decision_id.clone(),
        selection_id: checkpoint.selection_id.clone(),
        selection_event_id: checkpoint.selection_event_id.clone(),
        expected_candidate_url_fingerprint: candidate.source_url_fingerprint.clone(),
        expected_candidate_content_sha256: candidate.content_sha256.clone(),
        expected_candidate_compiled_policy_fingerprint: candidate.compiled_policy_fingerprint.clone(),
        expected_provenance_statement_url_fingerprint: checkpoint
            .expected_provenance_statement_url_fingerprint
            .clone()
            .ok_or_else(|| {
                "invalid params: journey route resume selected-candidate fetch checkpoint is missing provenance statement URL fingerprint"
                    .to_string()
            })?,
        expected_provenance_statement_sha256: checkpoint
            .expected_provenance_statement_sha256
            .clone()
            .ok_or_else(|| {
                "invalid params: journey route resume selected-candidate fetch checkpoint is missing provenance statement fingerprint"
                    .to_string()
            })?,
        expected_signer_fingerprint: checkpoint.expected_signer_fingerprint.clone().ok_or_else(
            || {
                "invalid params: journey route resume selected-candidate fetch checkpoint is missing signer fingerprint"
                    .to_string()
            },
        )?,
        expected_current_activation_fingerprint: checkpoint
            .expected_current_activation_fingerprint
            .clone()
            .ok_or_else(|| {
                "invalid params: journey route resume selected-candidate fetch checkpoint is missing current activation fingerprint"
                    .to_string()
            })?,
        provenance_statement_json: checkpoint.provenance_statement_json.clone().ok_or_else(
            || {
                "invalid params: journey route resume selected-candidate fetch checkpoint is missing provenance material"
                    .to_string()
            },
        )?,
        provenance_signature_base64: checkpoint
            .provenance_signature_base64
            .clone()
            .ok_or_else(|| {
                "invalid params: journey route resume selected-candidate fetch checkpoint is missing provenance material"
                    .to_string()
            })?,
        provenance_public_key_base64: checkpoint
            .provenance_public_key_base64
            .clone()
            .ok_or_else(|| {
                "invalid params: journey route resume selected-candidate fetch checkpoint is missing provenance material"
                    .to_string()
            })?,
    })
}

pub(super) fn headless_selected_candidate_fetch_checkpoint_fingerprint(
    checkpoint: &HeadlessModePackSelectedCandidateFetchCheckpoint,
) -> String {
    let candidate = &checkpoint.result.candidate;
    let seed = json!({
        "checkpoint_kind": "headless_modepack_selected_candidate_fetch",
        "continuation_id": checkpoint.continuation_id,
        "decision_id": checkpoint.decision_id,
        "request_fingerprint": checkpoint.request_fingerprint,
        "expected_progress_fingerprint": checkpoint.expected_progress_fingerprint,
        "expected_aggregate_sequence": checkpoint.expected_aggregate_sequence,
        "current_progress_fingerprint": checkpoint.current_progress_fingerprint,
        "current_aggregate_sequence": checkpoint.current_aggregate_sequence,
        "post_progress_fingerprint": checkpoint.post_progress_fingerprint,
        "post_aggregate_sequence": checkpoint.post_aggregate_sequence,
        "selection_id": checkpoint.selection_id,
        "selection_event_id": checkpoint.selection_event_id,
        "expected_provenance_statement_url_fingerprint": checkpoint.expected_provenance_statement_url_fingerprint,
        "expected_provenance_statement_sha256": checkpoint.expected_provenance_statement_sha256,
        "expected_signer_fingerprint": checkpoint.expected_signer_fingerprint,
        "expected_current_activation_fingerprint": checkpoint.expected_current_activation_fingerprint,
        "provenance_statement_json_sha256": checkpoint.provenance_statement_json.as_ref().map(|value| format!("sha256:{}", hex_sha256(value.as_bytes()))),
        "provenance_signature_base64_sha256": checkpoint.provenance_signature_base64.as_ref().map(|value| format!("sha256:{}", hex_sha256(value.as_bytes()))),
        "provenance_public_key_base64_sha256": checkpoint.provenance_public_key_base64.as_ref().map(|value| format!("sha256:{}", hex_sha256(value.as_bytes()))),
        "candidate_id": candidate.candidate_id,
        "candidate_url_fingerprint": candidate.source_url_fingerprint,
        "candidate_content_sha256": candidate.content_sha256,
        "candidate_compiled_policy_fingerprint": candidate.compiled_policy_fingerprint,
    });
    format!("sha256:{}", hex_sha256(seed.to_string().as_bytes()))
}

fn modepack_selected_candidate_approval_target_from_provenance_checkpoint(
    provenance_checkpoint: &HeadlessModePackSelectedCandidateProvenanceVerificationCheckpoint,
    fetch_checkpoint: &HeadlessModePackSelectedCandidateFetchCheckpoint,
) -> Result<ModePackSelectedCandidateApprovalTarget, String> {
    if provenance_checkpoint.fetch_continuation_id != fetch_checkpoint.continuation_id
        || provenance_checkpoint.expected_fetch_decision_id != fetch_checkpoint.decision_id
        || provenance_checkpoint.selection_id != fetch_checkpoint.selection_id
        || provenance_checkpoint.selection_event_id != fetch_checkpoint.selection_event_id
    {
        return Err(
            "invalid params: journey route resume provenance checkpoint conflicts with referenced fetch checkpoint"
                .to_string(),
        );
    }
    let candidate = &fetch_checkpoint.result.candidate;
    let provenance = &provenance_checkpoint.result.provenance;
    if candidate.source_url_fingerprint != provenance.source_url_fingerprint
        || candidate.content_sha256 != provenance.content_sha256
        || candidate.compiled_policy_fingerprint != provenance.compiled_policy_fingerprint
    {
        return Err(
            "invalid params: journey route resume provenance evidence conflicts with referenced fetch checkpoint"
                .to_string(),
        );
    }
    let expected_provenance_statement_sha256 = fetch_checkpoint
        .expected_provenance_statement_sha256
        .clone()
        .ok_or_else(|| {
            "invalid params: journey route resume selected-candidate fetch checkpoint is missing provenance statement fingerprint"
                .to_string()
        })?;
    if expected_provenance_statement_sha256 != provenance.statement_sha256 {
        return Err(
            "invalid params: journey route resume provenance statement fingerprint conflicts with fetch checkpoint"
                .to_string(),
        );
    }
    let expected_signer_fingerprint =
        fetch_checkpoint
            .expected_signer_fingerprint
            .clone()
            .ok_or_else(|| {
                "invalid params: journey route resume selected-candidate fetch checkpoint is missing signer fingerprint"
                    .to_string()
            })?;
    if expected_signer_fingerprint != provenance.signer_fingerprint {
        return Err(
            "invalid params: journey route resume provenance signer conflicts with fetch checkpoint"
                .to_string(),
        );
    }
    Ok(ModePackSelectedCandidateApprovalTarget {
        authorize_selected_candidate_approval: true,
        fetch_continuation_id: fetch_checkpoint.continuation_id.clone(),
        expected_fetch_decision_id: fetch_checkpoint.decision_id.clone(),
        provenance_verification_continuation_id: provenance_checkpoint.continuation_id.clone(),
        expected_provenance_verification_decision_id: provenance_checkpoint.decision_id.clone(),
        selection_id: provenance_checkpoint.selection_id.clone(),
        selection_event_id: provenance_checkpoint.selection_event_id.clone(),
        expected_candidate_url_fingerprint: provenance.source_url_fingerprint.clone(),
        expected_candidate_content_sha256: provenance.content_sha256.clone(),
        expected_candidate_compiled_policy_fingerprint: provenance
            .compiled_policy_fingerprint
            .clone(),
        expected_provenance_id: provenance.provenance_id.clone(),
        expected_provenance_event_id: provenance.provenance_event_id.clone(),
        expected_provenance_statement_url_fingerprint: fetch_checkpoint
            .expected_provenance_statement_url_fingerprint
            .clone()
            .ok_or_else(|| {
                "invalid params: journey route resume selected-candidate fetch checkpoint is missing provenance statement URL fingerprint"
                    .to_string()
            })?,
        expected_provenance_statement_sha256,
        expected_signer_fingerprint,
        expected_current_activation_fingerprint: fetch_checkpoint
            .expected_current_activation_fingerprint
            .clone()
            .ok_or_else(|| {
                "invalid params: journey route resume selected-candidate fetch checkpoint is missing current activation fingerprint"
                    .to_string()
            })?,
    })
}

pub(super) fn headless_selected_candidate_provenance_verification_checkpoint_fingerprint(
    checkpoint: &HeadlessModePackSelectedCandidateProvenanceVerificationCheckpoint,
) -> String {
    let provenance = &checkpoint.result.provenance;
    let seed = json!({
        "checkpoint_kind": "headless_modepack_selected_candidate_provenance_verification",
        "continuation_id": checkpoint.continuation_id,
        "decision_id": checkpoint.decision_id,
        "request_fingerprint": checkpoint.request_fingerprint,
        "fetch_continuation_id": checkpoint.fetch_continuation_id,
        "expected_fetch_decision_id": checkpoint.expected_fetch_decision_id,
        "expected_progress_fingerprint": checkpoint.expected_progress_fingerprint,
        "expected_aggregate_sequence": checkpoint.expected_aggregate_sequence,
        "current_progress_fingerprint": checkpoint.current_progress_fingerprint,
        "current_aggregate_sequence": checkpoint.current_aggregate_sequence,
        "post_progress_fingerprint": checkpoint.post_progress_fingerprint,
        "post_aggregate_sequence": checkpoint.post_aggregate_sequence,
        "selection_id": checkpoint.selection_id,
        "selection_event_id": checkpoint.selection_event_id,
        "provenance_id": provenance.provenance_id,
        "candidate_id": provenance.candidate_id,
        "source_url_fingerprint": provenance.source_url_fingerprint,
        "content_sha256": provenance.content_sha256,
        "compiled_policy_fingerprint": provenance.compiled_policy_fingerprint,
        "signer_fingerprint": provenance.signer_fingerprint,
        "statement_sha256": provenance.statement_sha256,
        "signature_sha256": provenance.signature_sha256,
        "provenance_event_id": provenance.provenance_event_id,
    });
    format!("sha256:{}", hex_sha256(seed.to_string().as_bytes()))
}

fn modepack_candidate_activation_fingerprint_from_approved_candidate(
    store: &BrownieStore,
    content_sha256: &str,
    compiled_policy_fingerprint: &str,
) -> Result<String, String> {
    let cached = store
        .read_modepack_candidate_snapshot(content_sha256)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| {
            "invalid params: journey route resume cached approved candidate evidence is missing"
                .to_string()
        })?;
    let actual_content_sha256 = format!("sha256:{}", hex_sha256(cached.modepack_json.as_bytes()));
    if actual_content_sha256 != content_sha256
        || cached.summary.content_sha256 != content_sha256
        || cached.summary.compiled_policy_fingerprint != compiled_policy_fingerprint
    {
        return Err(
            "invalid params: journey route resume cached approved candidate evidence is stale"
                .to_string(),
        );
    }
    let snapshot = load_modepack_from_str(
        &cached.modepack_json,
        MODEPACK_CANDIDATE_CACHE_SOURCE_PATH,
    )
    .map_err(|error| {
        format!("invalid params: journey route resume approved candidate compile failed: {error}")
    })?;
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
                permissions: mode_permissions_payload(policy),
                allowed_handoff_targets: policy.allowed_handoff_targets.clone(),
                completion_rules: policy.completion_rules.clone(),
                policy_fingerprint,
            }
        })
        .collect::<Vec<_>>();
    let mode_ids = policies
        .iter()
        .map(|policy| policy.mode_id.clone())
        .collect::<Vec<_>>();
    let actual_compiled_policy_fingerprint = active_modepack_compiled_policy_fingerprint(
        &snapshot.name,
        snapshot.schema_version,
        &policies,
    );
    if actual_compiled_policy_fingerprint != compiled_policy_fingerprint
        || cached.summary.modepack_name != snapshot.name
        || cached.summary.schema_version != snapshot.schema_version
        || cached.summary.mode_ids != mode_ids
    {
        return Err(
            "invalid params: journey route resume approved candidate compiled evidence is stale"
                .to_string(),
        );
    }
    Ok(active_modepack_activation_fingerprint(
        &snapshot.name,
        snapshot.schema_version,
        &actual_compiled_policy_fingerprint,
        &mode_ids,
    ))
}

fn modepack_selected_approved_candidate_replacement_target_from_approval_checkpoint(
    store: &BrownieStore,
    approval_checkpoint: &HeadlessModePackSelectedCandidateApprovalCheckpoint,
    provenance_checkpoint: &HeadlessModePackSelectedCandidateProvenanceVerificationCheckpoint,
    fetch_checkpoint: &HeadlessModePackSelectedCandidateFetchCheckpoint,
) -> Result<ModePackSelectedApprovedCandidateReplacementTarget, String> {
    if provenance_checkpoint.continuation_id
        != approval_checkpoint.provenance_verification_continuation_id
        || provenance_checkpoint.decision_id
            != approval_checkpoint.expected_provenance_verification_decision_id
        || provenance_checkpoint.fetch_continuation_id != approval_checkpoint.fetch_continuation_id
        || provenance_checkpoint.expected_fetch_decision_id
            != approval_checkpoint.expected_fetch_decision_id
        || fetch_checkpoint.continuation_id != approval_checkpoint.fetch_continuation_id
        || fetch_checkpoint.decision_id != approval_checkpoint.expected_fetch_decision_id
        || fetch_checkpoint.selection_id != approval_checkpoint.selection_id
        || provenance_checkpoint.selection_id != approval_checkpoint.selection_id
        || fetch_checkpoint.selection_event_id != approval_checkpoint.selection_event_id
        || provenance_checkpoint.selection_event_id != approval_checkpoint.selection_event_id
    {
        return Err(
            "invalid params: journey route resume approval checkpoint conflicts with referenced fetch or provenance checkpoint"
                .to_string(),
        );
    }
    let candidate = &fetch_checkpoint.result.candidate;
    let provenance = &provenance_checkpoint.result.provenance;
    let approval = &approval_checkpoint.result.approval;
    if candidate.source_url_fingerprint != provenance.source_url_fingerprint
        || candidate.source_url_fingerprint != approval.source_url_fingerprint
        || candidate.content_sha256 != provenance.content_sha256
        || candidate.content_sha256 != approval.content_sha256
        || candidate.compiled_policy_fingerprint != provenance.compiled_policy_fingerprint
        || candidate.compiled_policy_fingerprint != approval.compiled_policy_fingerprint
        || provenance.provenance_id != approval.provenance_id
        || provenance.provenance_event_id != approval.provenance_event_id
        || provenance.statement_sha256 != approval.statement_sha256
        || provenance.signer_fingerprint != approval.signer_fingerprint
    {
        return Err(
            "invalid params: journey route resume approval evidence conflicts with referenced checkpoint evidence"
                .to_string(),
        );
    }
    let expected_provenance_statement_url_fingerprint = fetch_checkpoint
        .expected_provenance_statement_url_fingerprint
        .clone()
        .ok_or_else(|| {
            "invalid params: journey route resume selected-candidate fetch checkpoint is missing provenance statement URL fingerprint"
                .to_string()
        })?;
    let expected_provenance_statement_sha256 = fetch_checkpoint
        .expected_provenance_statement_sha256
        .clone()
        .ok_or_else(|| {
            "invalid params: journey route resume selected-candidate fetch checkpoint is missing provenance statement fingerprint"
                .to_string()
        })?;
    let expected_signer_fingerprint =
        fetch_checkpoint
            .expected_signer_fingerprint
            .clone()
            .ok_or_else(|| {
                "invalid params: journey route resume selected-candidate fetch checkpoint is missing signer fingerprint"
                    .to_string()
            })?;
    let expected_current_activation_fingerprint = fetch_checkpoint
        .expected_current_activation_fingerprint
        .clone()
        .ok_or_else(|| {
            "invalid params: journey route resume selected-candidate fetch checkpoint is missing current activation fingerprint"
                .to_string()
        })?;
    if expected_provenance_statement_sha256 != provenance.statement_sha256
        || expected_provenance_statement_sha256 != approval.statement_sha256
        || expected_signer_fingerprint != provenance.signer_fingerprint
        || expected_signer_fingerprint != approval.signer_fingerprint
    {
        return Err(
            "invalid params: journey route resume approval trust evidence conflicts with fetch checkpoint"
                .to_string(),
        );
    }
    let expected_candidate_activation_fingerprint =
        modepack_candidate_activation_fingerprint_from_approved_candidate(
            store,
            &approval.content_sha256,
            &approval.compiled_policy_fingerprint,
        )?;
    Ok(ModePackSelectedApprovedCandidateReplacementTarget {
        authorize_selected_candidate_replacement: true,
        fetch_continuation_id: fetch_checkpoint.continuation_id.clone(),
        expected_fetch_decision_id: fetch_checkpoint.decision_id.clone(),
        provenance_verification_continuation_id: provenance_checkpoint.continuation_id.clone(),
        expected_provenance_verification_decision_id: provenance_checkpoint.decision_id.clone(),
        approval_continuation_id: approval_checkpoint.continuation_id.clone(),
        expected_approval_decision_id: approval_checkpoint.decision_id.clone(),
        selection_id: approval_checkpoint.selection_id.clone(),
        selection_event_id: approval_checkpoint.selection_event_id.clone(),
        expected_candidate_url_fingerprint: candidate.source_url_fingerprint.clone(),
        expected_candidate_content_sha256: candidate.content_sha256.clone(),
        expected_candidate_compiled_policy_fingerprint: candidate
            .compiled_policy_fingerprint
            .clone(),
        expected_candidate_activation_fingerprint,
        expected_provenance_id: provenance.provenance_id.clone(),
        expected_provenance_event_id: provenance.provenance_event_id.clone(),
        expected_provenance_statement_url_fingerprint,
        expected_provenance_statement_sha256,
        expected_signer_fingerprint,
        expected_current_activation_fingerprint,
        expected_approved_candidate_id: approval.candidate_id.clone(),
        expected_approved_candidate_approval_id: approval.approval_id.clone(),
        expected_approved_candidate_approval_event_id: approval.approval_event_id.clone(),
    })
}

pub(super) fn headless_selected_candidate_approval_checkpoint_fingerprint(
    checkpoint: &HeadlessModePackSelectedCandidateApprovalCheckpoint,
) -> String {
    let approval = &checkpoint.result.approval;
    let seed = json!({
        "checkpoint_kind": "headless_modepack_selected_candidate_approval",
        "continuation_id": checkpoint.continuation_id,
        "decision_id": checkpoint.decision_id,
        "request_fingerprint": checkpoint.request_fingerprint,
        "fetch_continuation_id": checkpoint.fetch_continuation_id,
        "expected_fetch_decision_id": checkpoint.expected_fetch_decision_id,
        "provenance_verification_continuation_id": checkpoint.provenance_verification_continuation_id,
        "expected_provenance_verification_decision_id": checkpoint.expected_provenance_verification_decision_id,
        "expected_progress_fingerprint": checkpoint.expected_progress_fingerprint,
        "expected_aggregate_sequence": checkpoint.expected_aggregate_sequence,
        "current_progress_fingerprint": checkpoint.current_progress_fingerprint,
        "current_aggregate_sequence": checkpoint.current_aggregate_sequence,
        "post_progress_fingerprint": checkpoint.post_progress_fingerprint,
        "post_aggregate_sequence": checkpoint.post_aggregate_sequence,
        "selection_id": checkpoint.selection_id,
        "selection_event_id": checkpoint.selection_event_id,
        "approval_id": approval.approval_id,
        "approval_event_id": approval.approval_event_id,
        "candidate_id": approval.candidate_id,
        "source_url_fingerprint": approval.source_url_fingerprint,
        "content_sha256": approval.content_sha256,
        "compiled_policy_fingerprint": approval.compiled_policy_fingerprint,
        "provenance_id": approval.provenance_id,
        "provenance_event_id": approval.provenance_event_id,
        "signer_fingerprint": approval.signer_fingerprint,
        "statement_sha256": approval.statement_sha256,
        "trusted_signer_trust_id": approval.trusted_signer_trust_id,
        "trusted_signer_event_id": approval.trusted_signer_event_id,
        "consumed": approval.consumed,
    });
    format!("sha256:{}", hex_sha256(seed.to_string().as_bytes()))
}

fn headless_selected_candidate_replacement_checkpoint_fingerprint(
    checkpoint: &HeadlessModePackSelectedCandidateReplacementCheckpoint,
) -> String {
    let result = &checkpoint.result;
    let approved_candidate = result.approved_candidate.as_ref();
    let seed = json!({
        "checkpoint_kind": "headless_modepack_selected_candidate_replacement",
        "continuation_id": checkpoint.continuation_id,
        "decision_id": checkpoint.decision_id,
        "request_fingerprint": checkpoint.request_fingerprint,
        "fetch_continuation_id": checkpoint.fetch_continuation_id,
        "expected_fetch_decision_id": checkpoint.expected_fetch_decision_id,
        "provenance_verification_continuation_id": checkpoint.provenance_verification_continuation_id,
        "expected_provenance_verification_decision_id": checkpoint.expected_provenance_verification_decision_id,
        "approval_continuation_id": checkpoint.approval_continuation_id,
        "expected_approval_decision_id": checkpoint.expected_approval_decision_id,
        "expected_progress_fingerprint": checkpoint.expected_progress_fingerprint,
        "expected_aggregate_sequence": checkpoint.expected_aggregate_sequence,
        "current_progress_fingerprint": checkpoint.current_progress_fingerprint,
        "current_aggregate_sequence": checkpoint.current_aggregate_sequence,
        "post_progress_fingerprint": checkpoint.post_progress_fingerprint,
        "post_aggregate_sequence": checkpoint.post_aggregate_sequence,
        "selection_id": checkpoint.selection_id,
        "selection_event_id": checkpoint.selection_event_id,
        "replaced": result.replaced,
        "previous_activation_fingerprint": result.previous_snapshot.activation_fingerprint,
        "replacement_activation_fingerprint": result.replacement_snapshot.activation_fingerprint,
        "replacement_event_id": result.replacement_event_id,
        "approved_candidate_id": approved_candidate.map(|candidate| candidate.candidate_id.clone()),
        "approved_candidate_approval_id": approved_candidate.map(|candidate| candidate.approval_id.clone()),
        "approved_candidate_content_sha256": approved_candidate.map(|candidate| candidate.content_sha256.clone()),
        "approved_candidate_compiled_policy_fingerprint": approved_candidate.map(|candidate| candidate.compiled_policy_fingerprint.clone()),
        "candidate_consumed_event_id": result.candidate_consumed_event_id,
    });
    format!("sha256:{}", hex_sha256(seed.to_string().as_bytes()))
}

pub(super) fn headless_journey_route_resume_request_fingerprint(
    params: &HeadlessRunDriveParams,
    drive_id: &str,
    source_checkpoint_fingerprint: &str,
) -> Result<String, String> {
    let resume = params
        .journey_route_resume
        .as_ref()
        .ok_or_else(|| "journey route resume missing".to_string())?;
    let seed = json!({
        "resume_kind": "headless_journey_route_resume",
        "authorize": params.authorize,
        "session_id": params.session_id,
        "drive_id": drive_id,
        "expected_start_session_sequence": params.expected_start_session_sequence,
        "journey_id": resume.journey_id,
        "authorize_journey_route_resume": resume.authorize_journey_route_resume,
        "expected_journey_fingerprint": resume.expected_journey_fingerprint,
        "expected_route_kind": resume.expected_route_kind,
        "expected_source_checkpoint_fingerprint": resume.expected_source_checkpoint_fingerprint,
        "source_checkpoint_fingerprint": source_checkpoint_fingerprint,
    });
    Ok(format!(
        "sha256:{}",
        hex_sha256(seed.to_string().as_bytes())
    ))
}

fn validate_headless_journey_route_resume(
    params: &HeadlessRunDriveParams,
    max_advances: u8,
    max_steps_per_advance: u8,
) -> Result<(), String> {
    let Some(resume) = params.journey_route_resume.as_ref() else {
        return Ok(());
    };
    if !is_valid_headless_run_id(&resume.journey_id) {
        return Err("invalid params: journey route resume journey_id must be 1-48 ASCII alphanumeric, dash, underscore, colon, or dot characters".to_string());
    }
    if !resume.authorize_journey_route_resume {
        return Err("invalid params: authorize_journey_route_resume must be true".to_string());
    }
    if !is_sha256_fingerprint(&resume.expected_journey_fingerprint) {
        return Err(
            "invalid params: expected_journey_fingerprint must be a sha256 fingerprint".to_string(),
        );
    }
    if !is_sha256_fingerprint(&resume.expected_source_checkpoint_fingerprint) {
        return Err(
            "invalid params: expected_source_checkpoint_fingerprint must be a sha256 fingerprint"
                .to_string(),
        );
    }
    if !matches!(
        resume.expected_route_kind,
        HeadlessContinueRouteKind::FetchSelectedModePackCandidateExplicitly
            | HeadlessContinueRouteKind::VerifySelectedModePackCandidateProvenanceExplicitly
            | HeadlessContinueRouteKind::ApproveVerifiedModePackCandidateExplicitly
            | HeadlessContinueRouteKind::ReplaceActiveWithApprovedModePackCandidateExplicitly
    ) {
        return Err(
            "invalid params: journey route resume only supports fetch_selected_mode_pack_candidate_explicitly, verify_selected_mode_pack_candidate_provenance_explicitly, approve_verified_mode_pack_candidate_explicitly, or replace_active_with_approved_modepack_candidate_explicitly"
                .to_string(),
        );
    }
    if params.journey_admission.is_some() {
        return Err(
            "invalid params: journey route resume cannot be combined with journey admission"
                .to_string(),
        );
    }
    if headless_run_drive_has_explicit_modepack_target(params) {
        return Err("invalid params: journey route resume cannot be combined with explicit modepack run-control targets".to_string());
    }
    if params.context_budget.is_some() {
        return Err(
            "invalid params: journey route resume cannot be combined with context_budget"
                .to_string(),
        );
    }
    if params.authorize_completion_finalization.unwrap_or(false) {
        return Err(
            "invalid params: journey route resume cannot authorize completion finalization"
                .to_string(),
        );
    }
    if !(max_advances == 1 || max_advances == 2) || max_steps_per_advance != 1 {
        return Err(
            "invalid params: journey route resume requires bounded max_advances and max_steps_per_advance 1"
                .to_string(),
        );
    }
    if params.drive_id.is_none() {
        return Err(
            "invalid params: journey route resume requires an explicit drive_id".to_string(),
        );
    }
    Ok(())
}

fn headless_journey_route_resume_plan(
    store: &BrownieStore,
    params: &HeadlessRunDriveParams,
    drive_id: &str,
    start_checkpoint: Option<&HeadlessRunSessionCheckpoint>,
) -> Result<Option<HeadlessJourneyRouteResumePlan>, String> {
    let Some(resume) = params.journey_route_resume.as_ref() else {
        return Ok(None);
    };
    let journey_checkpoint = store
        .tasks()
        .read_headless_journey_start_checkpoint(&resume.journey_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| {
            "invalid params: journey route resume requires a persisted journey checkpoint"
                .to_string()
        })?;
    if journey_checkpoint.session_id != params.session_id {
        return Err(
            "invalid params: journey route resume session_id conflicts with persisted journey"
                .to_string(),
        );
    }
    if journey_checkpoint.journey_fingerprint != resume.expected_journey_fingerprint {
        return Err(
            "invalid params: expected_journey_fingerprint is stale for journey route resume"
                .to_string(),
        );
    }
    let start_checkpoint = start_checkpoint.ok_or_else(|| {
        "invalid params: journey route resume requires an existing session checkpoint".to_string()
    })?;
    if start_checkpoint.session_sequence != params.expected_start_session_sequence {
        return Err(
            "invalid params: journey route resume expected_start_session_sequence must match the current session checkpoint"
                .to_string(),
        );
    }
    let has_expected_route = headless_run_checkpoint_has_next_route(
        start_checkpoint,
        resume.expected_route_kind.clone(),
    );
    let has_replacement_action = resume.expected_route_kind
        == HeadlessContinueRouteKind::ReplaceActiveWithApprovedModePackCandidateExplicitly
        && headless_run_checkpoint_has_next_route_action(
            start_checkpoint,
            HeadlessContinueRouteKind::RefreshProgressOverview,
            "replace_active_with_approved_modepack_candidate_explicitly",
        );
    if !has_expected_route && !has_replacement_action {
        return Err(format!(
            "invalid params: journey route resume requires persisted session route {}",
            serde_json::to_value(&resume.expected_route_kind)
                .ok()
                .and_then(|value| value.as_str().map(ToString::to_string))
                .unwrap_or_else(|| "expected".to_string())
        ));
    }
    let start_progress = start_checkpoint
        .result
        .post_progress
        .as_ref()
        .ok_or_else(|| {
            "invalid params: journey route resume requires persisted post progress".to_string()
        })?;
    let source_continuation_id = start_checkpoint
        .result
        .steps
        .iter()
        .find_map(|step| step.continuation_id.clone())
        .ok_or_else(|| {
            "invalid params: journey route resume source continuation evidence is missing"
                .to_string()
        })?;
    let (
        source_decision_id,
        source_checkpoint_fingerprint,
        derived_fetch_target,
        derived_provenance_target,
        derived_approval_target,
        derived_replacement_target,
        derived_target_class,
    ) = match resume.expected_route_kind {
        HeadlessContinueRouteKind::FetchSelectedModePackCandidateExplicitly => {
            let selection_checkpoint = store
                .read_headless_modepack_registry_update_selection_checkpoint(
                    &source_continuation_id,
                )
                .map_err(|error| error.to_string())?
                .ok_or_else(|| {
                    "invalid params: journey route resume registry selection checkpoint is missing"
                        .to_string()
                })?;
            if selection_checkpoint.post_progress_fingerprint != start_progress.progress_fingerprint
                || selection_checkpoint.post_aggregate_sequence != start_progress.aggregate_sequence
            {
                return Err(
                    "invalid params: journey route resume registry selection checkpoint is stale"
                        .to_string(),
                );
            }
            let source_checkpoint_fingerprint =
                headless_registry_update_selection_checkpoint_fingerprint(&selection_checkpoint);
            let derived_fetch_target =
                modepack_selected_candidate_fetch_target_from_selection_checkpoint(
                    &selection_checkpoint,
                );
            (
                selection_checkpoint.decision_id,
                source_checkpoint_fingerprint,
                Some(derived_fetch_target),
                None,
                None,
                None,
                "modepack_selected_candidate_fetch_target".to_string(),
            )
        }
        HeadlessContinueRouteKind::VerifySelectedModePackCandidateProvenanceExplicitly => {
            let fetch_checkpoint = store
                .read_headless_modepack_selected_candidate_fetch_checkpoint(&source_continuation_id)
                .map_err(|error| error.to_string())?
                .ok_or_else(|| {
                    "invalid params: journey route resume selected-candidate fetch checkpoint is missing"
                        .to_string()
                })?;
            if fetch_checkpoint.post_progress_fingerprint != start_progress.progress_fingerprint
                || fetch_checkpoint.post_aggregate_sequence != start_progress.aggregate_sequence
            {
                return Err(
                    "invalid params: journey route resume selected-candidate fetch checkpoint is stale"
                        .to_string(),
                );
            }
            let source_checkpoint_fingerprint =
                headless_selected_candidate_fetch_checkpoint_fingerprint(&fetch_checkpoint);
            let derived_provenance_target =
                modepack_selected_candidate_provenance_target_from_fetch_checkpoint(
                    &fetch_checkpoint,
                )?;
            (
                fetch_checkpoint.decision_id,
                source_checkpoint_fingerprint,
                None,
                Some(derived_provenance_target),
                None,
                None,
                "modepack_selected_candidate_provenance_verification_target".to_string(),
            )
        }
        HeadlessContinueRouteKind::ApproveVerifiedModePackCandidateExplicitly => {
            let provenance_checkpoint = store
                .read_headless_modepack_selected_candidate_provenance_verification_checkpoint(
                    &source_continuation_id,
                )
                .map_err(|error| error.to_string())?
                .ok_or_else(|| {
                    "invalid params: journey route resume selected-candidate provenance verification checkpoint is missing"
                        .to_string()
                })?;
            if provenance_checkpoint.post_progress_fingerprint
                != start_progress.progress_fingerprint
                || provenance_checkpoint.post_aggregate_sequence
                    != start_progress.aggregate_sequence
            {
                return Err(
                    "invalid params: journey route resume selected-candidate provenance verification checkpoint is stale"
                        .to_string(),
                );
            }
            let fetch_checkpoint = store
                .read_headless_modepack_selected_candidate_fetch_checkpoint(
                    &provenance_checkpoint.fetch_continuation_id,
                )
                .map_err(|error| error.to_string())?
                .ok_or_else(|| {
                    "invalid params: journey route resume referenced selected-candidate fetch checkpoint is missing"
                        .to_string()
                })?;
            let source_checkpoint_fingerprint =
                headless_selected_candidate_provenance_verification_checkpoint_fingerprint(
                    &provenance_checkpoint,
                );
            let derived_approval_target =
                modepack_selected_candidate_approval_target_from_provenance_checkpoint(
                    &provenance_checkpoint,
                    &fetch_checkpoint,
                )?;
            (
                provenance_checkpoint.decision_id,
                source_checkpoint_fingerprint,
                None,
                None,
                Some(derived_approval_target),
                None,
                "modepack_selected_candidate_approval_target".to_string(),
            )
        }
        HeadlessContinueRouteKind::ReplaceActiveWithApprovedModePackCandidateExplicitly => {
            let approval_checkpoint = store
                .read_headless_modepack_selected_candidate_approval_checkpoint(
                    &source_continuation_id,
                )
                .map_err(|error| error.to_string())?
                .ok_or_else(|| {
                    "invalid params: journey route resume selected-candidate approval checkpoint is missing"
                        .to_string()
                })?;
            if approval_checkpoint.post_progress_fingerprint != start_progress.progress_fingerprint
                || approval_checkpoint.post_aggregate_sequence != start_progress.aggregate_sequence
            {
                return Err(
                    "invalid params: journey route resume selected-candidate approval checkpoint is stale"
                        .to_string(),
                );
            }
            let provenance_checkpoint = store
                .read_headless_modepack_selected_candidate_provenance_verification_checkpoint(
                    &approval_checkpoint.provenance_verification_continuation_id,
                )
                .map_err(|error| error.to_string())?
                .ok_or_else(|| {
                    "invalid params: journey route resume referenced selected-candidate provenance verification checkpoint is missing"
                        .to_string()
                })?;
            let fetch_checkpoint = store
                .read_headless_modepack_selected_candidate_fetch_checkpoint(
                    &approval_checkpoint.fetch_continuation_id,
                )
                .map_err(|error| error.to_string())?
                .ok_or_else(|| {
                    "invalid params: journey route resume referenced selected-candidate fetch checkpoint is missing"
                        .to_string()
                })?;
            let source_checkpoint_fingerprint =
                headless_selected_candidate_approval_checkpoint_fingerprint(&approval_checkpoint);
            let derived_replacement_target =
                modepack_selected_approved_candidate_replacement_target_from_approval_checkpoint(
                    store,
                    &approval_checkpoint,
                    &provenance_checkpoint,
                    &fetch_checkpoint,
                )?;
            (
                approval_checkpoint.decision_id,
                source_checkpoint_fingerprint,
                None,
                None,
                None,
                Some(derived_replacement_target),
                "modepack_selected_approved_candidate_replacement_target".to_string(),
            )
        }
        _ => unreachable!("validated route kind"),
    };
    if source_checkpoint_fingerprint != resume.expected_source_checkpoint_fingerprint {
        return Err(
            "invalid params: expected_source_checkpoint_fingerprint is stale for journey route resume"
                .to_string(),
        );
    }
    let resume_fingerprint = headless_journey_route_resume_request_fingerprint(
        params,
        drive_id,
        &source_checkpoint_fingerprint,
    )?;
    Ok(Some(HeadlessJourneyRouteResumePlan {
        journey_checkpoint,
        route_kind: resume.expected_route_kind.clone(),
        source_continuation_id,
        source_decision_id,
        source_checkpoint_fingerprint,
        derived_fetch_target,
        derived_provenance_target,
        derived_approval_target,
        derived_replacement_target,
        derived_target_class,
        resume_fingerprint,
    }))
}

fn validate_headless_journey_route_resume_replay(
    params: &HeadlessRunDriveParams,
    drive_id: &str,
    result: &HeadlessRunDriveResult,
) -> Result<(), String> {
    match (
        params.journey_route_resume.as_ref(),
        result.journey_route_resume.as_ref(),
    ) {
        (None, None) => Ok(()),
        (Some(_), None) => {
            Err("invalid params: drive_id conflicts with a non-resume drive checkpoint".to_string())
        }
        (None, Some(_)) => Err(
            "invalid params: journey_route_resume is required to replay a journey route resume drive"
                .to_string(),
        ),
        (Some(resume), Some(metadata)) => {
            if metadata.session_id != params.session_id || metadata.drive_id != drive_id {
                return Err(
                    "invalid params: journey route resume replay conflicts with persisted drive"
                        .to_string(),
                );
            }
            if metadata.journey_id != resume.journey_id
                || metadata.route_kind != resume.expected_route_kind
                || metadata.source_checkpoint_fingerprint
                    != resume.expected_source_checkpoint_fingerprint
            {
                return Err(
                    "invalid params: journey route resume replay identity mismatch".to_string(),
                );
            }
            if !matches!(
                resume.expected_route_kind,
                HeadlessContinueRouteKind::FetchSelectedModePackCandidateExplicitly
                    | HeadlessContinueRouteKind::VerifySelectedModePackCandidateProvenanceExplicitly
                    | HeadlessContinueRouteKind::ApproveVerifiedModePackCandidateExplicitly
                    | HeadlessContinueRouteKind::ReplaceActiveWithApprovedModePackCandidateExplicitly
            ) {
                return Err(
                    "invalid params: journey route resume only supports fetch_selected_mode_pack_candidate_explicitly, verify_selected_mode_pack_candidate_provenance_explicitly, approve_verified_mode_pack_candidate_explicitly, or replace_active_with_approved_modepack_candidate_explicitly"
                        .to_string(),
                );
            }
            if !resume.authorize_journey_route_resume {
                return Err(
                    "invalid params: authorize_journey_route_resume must be true".to_string(),
                );
            }
            if metadata.resume_fingerprint
                != headless_journey_route_resume_request_fingerprint(
                    params,
                    drive_id,
                    &metadata.source_checkpoint_fingerprint,
                )?
            {
                return Err(
                    "invalid params: journey route resume replay fingerprint mismatch".to_string(),
                );
            }
            Ok(())
        }
    }
}

fn headless_journey_route_resume_metadata(
    plan: &HeadlessJourneyRouteResumePlan,
    session_id: &str,
    drive_id: &str,
    advances: &[HeadlessRunAdvanceResult],
    next_action: &str,
    replayed: bool,
) -> HeadlessRunJourneyRouteResumeMetadata {
    let first_advance = advances.first();
    let first_step = first_advance.and_then(|advance| advance.steps.first());
    let post_route = first_advance.and_then(|advance| advance.post_progress.as_ref());
    HeadlessRunJourneyRouteResumeMetadata {
        journey_id: plan.journey_checkpoint.journey_id.clone(),
        task_id: plan.journey_checkpoint.task_id.clone(),
        run_id: plan.journey_checkpoint.run_id.clone(),
        session_id: session_id.to_string(),
        drive_id: drive_id.to_string(),
        route_kind: plan.route_kind.clone(),
        source_continuation_id: plan.source_continuation_id.clone(),
        source_decision_id: plan.source_decision_id.clone(),
        source_checkpoint_fingerprint: plan.source_checkpoint_fingerprint.clone(),
        derived_target_class: plan.derived_target_class.clone(),
        result_advance_id: first_advance.map(|advance| advance.advance_id.clone()),
        result_continuation_id: first_step.and_then(|step| step.continuation_id.clone()),
        post_route_progress_fingerprint: post_route
            .map(|progress| progress.progress_fingerprint.clone()),
        post_route_aggregate_sequence: post_route.map(|progress| progress.aggregate_sequence),
        next_action: next_action.to_string(),
        replayed,
        resume_fingerprint: plan.resume_fingerprint.clone(),
    }
}

fn validate_headless_journey_closure(
    params: &HeadlessRunDriveParams,
    max_advances: u8,
    max_steps_per_advance: u8,
) -> Result<(), String> {
    let Some(closure) = params.journey_closure.as_ref() else {
        return Ok(());
    };
    if !is_valid_headless_run_id(&closure.journey_id) {
        return Err("invalid params: journey closure journey_id must be 1-48 ASCII alphanumeric, dash, underscore, colon, or dot characters".to_string());
    }
    if !closure.authorize_journey_closure {
        return Err("invalid params: authorize_journey_closure must be true".to_string());
    }
    if !is_sha256_fingerprint(&closure.expected_journey_fingerprint) {
        return Err(
            "invalid params: journey closure expected_journey_fingerprint must be a sha256 fingerprint"
                .to_string(),
        );
    }
    if !is_valid_headless_run_id(&closure.source_replacement_drive_id) {
        return Err("invalid params: journey closure source_replacement_drive_id must be 1-48 ASCII alphanumeric, dash, underscore, colon, or dot characters".to_string());
    }
    if !is_sha256_fingerprint(&closure.expected_replacement_resume_fingerprint) {
        return Err(
            "invalid params: expected_replacement_resume_fingerprint must be a sha256 fingerprint"
                .to_string(),
        );
    }
    if params.journey_admission.is_some() || params.journey_route_resume.is_some() {
        return Err(
            "invalid params: journey closure cannot be combined with journey admission or route resume"
                .to_string(),
        );
    }
    if headless_run_drive_has_explicit_modepack_target(params) {
        return Err(
            "invalid params: journey closure cannot be combined with explicit modepack run-control targets"
                .to_string(),
        );
    }
    if params.context_budget.is_some() {
        return Err(
            "invalid params: journey closure cannot be combined with context_budget".to_string(),
        );
    }
    if params.authorize_completion_finalization.is_some()
        || params.expected_completion_closure_fingerprint.is_some()
    {
        return Err(
            "invalid params: journey closure cannot be combined with completion finalization fields"
                .to_string(),
        );
    }
    if !(max_advances == 1 || max_advances == 2) || max_steps_per_advance != 1 {
        return Err(
            "invalid params: journey closure requires bounded max_advances and max_steps_per_advance 1"
                .to_string(),
        );
    }
    if params.drive_id.is_none() {
        return Err("invalid params: journey closure requires an explicit drive_id".to_string());
    }
    Ok(())
}

fn headless_journey_closure_request_fingerprint(
    params: &HeadlessRunDriveParams,
    drive_id: &str,
    replacement_checkpoint_fingerprint: &str,
    active_modepack_activation_fingerprint: &str,
) -> Result<String, String> {
    let closure = params
        .journey_closure
        .as_ref()
        .ok_or_else(|| "journey closure missing".to_string())?;
    let seed = json!({
        "closure_kind": "headless_journey_closure",
        "authorize": params.authorize,
        "session_id": params.session_id,
        "drive_id": drive_id,
        "expected_start_session_sequence": params.expected_start_session_sequence,
        "journey_id": closure.journey_id,
        "authorize_journey_closure": closure.authorize_journey_closure,
        "expected_journey_fingerprint": closure.expected_journey_fingerprint,
        "source_replacement_drive_id": closure.source_replacement_drive_id,
        "expected_replacement_resume_fingerprint": closure.expected_replacement_resume_fingerprint,
        "replacement_checkpoint_fingerprint": replacement_checkpoint_fingerprint,
        "active_modepack_activation_fingerprint": active_modepack_activation_fingerprint,
    });
    Ok(format!(
        "sha256:{}",
        hex_sha256(seed.to_string().as_bytes())
    ))
}

fn headless_journey_closure_plan(
    store: &BrownieStore,
    params: &HeadlessRunDriveParams,
    drive_id: &str,
    start_checkpoint: Option<&HeadlessRunSessionCheckpoint>,
) -> Result<Option<HeadlessJourneyClosurePlan>, String> {
    let Some(closure) = params.journey_closure.as_ref() else {
        return Ok(None);
    };
    if closure.source_replacement_drive_id == drive_id {
        return Err(
            "invalid params: journey closure source replacement drive must differ from closure drive"
                .to_string(),
        );
    }
    let journey_checkpoint = store
        .tasks()
        .read_headless_journey_start_checkpoint(&closure.journey_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| {
            "invalid params: journey closure requires a persisted journey checkpoint".to_string()
        })?;
    if journey_checkpoint.session_id != params.session_id {
        return Err(
            "invalid params: journey closure session_id conflicts with persisted journey"
                .to_string(),
        );
    }
    if journey_checkpoint.journey_fingerprint != closure.expected_journey_fingerprint {
        return Err(
            "invalid params: expected_journey_fingerprint is stale for journey closure".to_string(),
        );
    }
    validate_headless_journey_not_already_closed(
        store,
        &journey_checkpoint.journey_id,
        &journey_checkpoint.run_id,
        drive_id,
    )?;
    let start_checkpoint = start_checkpoint.ok_or_else(|| {
        "invalid params: journey closure requires an existing session checkpoint".to_string()
    })?;
    if start_checkpoint.session_sequence != params.expected_start_session_sequence {
        return Err(
            "invalid params: journey closure expected_start_session_sequence must match the current session checkpoint"
                .to_string(),
        );
    }
    let source_drive = store
        .tasks()
        .read_headless_run_session_drive_checkpoint(
            &params.session_id,
            &closure.source_replacement_drive_id,
        )
        .map_err(|error| error.to_string())?
        .ok_or_else(|| {
            "invalid params: journey closure source replacement drive checkpoint not found"
                .to_string()
        })?;
    if source_drive.result.session_id != params.session_id
        || source_drive.result.drive_id != closure.source_replacement_drive_id
        || source_drive.result.end_session_sequence != params.expected_start_session_sequence
    {
        return Err(
            "invalid params: journey closure source replacement drive conflicts with current session"
                .to_string(),
        );
    }
    let resume = source_drive.result.journey_route_resume.as_ref().ok_or_else(|| {
        "invalid params: journey closure source drive is missing replacement route resume metadata"
            .to_string()
    })?;
    if resume.journey_id != closure.journey_id
        || resume.task_id != journey_checkpoint.task_id
        || resume.run_id != journey_checkpoint.run_id
        || resume.route_kind
            != HeadlessContinueRouteKind::ReplaceActiveWithApprovedModePackCandidateExplicitly
    {
        return Err(
            "invalid params: journey closure source drive is not the replacement route resume"
                .to_string(),
        );
    }
    if resume.resume_fingerprint != closure.expected_replacement_resume_fingerprint {
        return Err(
            "invalid params: expected_replacement_resume_fingerprint is stale for journey closure"
                .to_string(),
        );
    }
    let replacement_continuation_id = resume.result_continuation_id.clone().ok_or_else(|| {
        "invalid params: journey closure replacement continuation id is missing".to_string()
    })?;
    let replacement_checkpoint = store
        .read_headless_modepack_selected_candidate_replacement_checkpoint(
            &replacement_continuation_id,
        )
        .map_err(|error| error.to_string())?
        .ok_or_else(|| {
            "invalid params: journey closure selected approved candidate replacement checkpoint not found"
                .to_string()
        })?;
    if !replacement_checkpoint.result.replaced
        || replacement_checkpoint
            .result
            .candidate_consumed_event_id
            .is_none()
    {
        return Err(
            "invalid params: journey closure replacement checkpoint is not committed".to_string(),
        );
    }
    if replacement_checkpoint.continuation_id != replacement_continuation_id
        || replacement_checkpoint.post_progress_fingerprint
            != resume
                .post_route_progress_fingerprint
                .clone()
                .unwrap_or_default()
        || replacement_checkpoint.post_aggregate_sequence
            != resume.post_route_aggregate_sequence.unwrap_or_default()
    {
        return Err(
            "invalid params: journey closure replacement checkpoint conflicts with route resume metadata"
                .to_string(),
        );
    }
    let active = store
        .read_active_modepack_snapshot()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| {
            "invalid params: journey closure active Mode Pack snapshot not found".to_string()
        })?;
    if active.summary.activation_fingerprint
        != replacement_checkpoint
            .result
            .replacement_snapshot
            .activation_fingerprint
    {
        return Err(
            "invalid params: journey closure active Mode Pack no longer matches replacement evidence"
                .to_string(),
        );
    }
    let replacement_checkpoint_fingerprint =
        headless_selected_candidate_replacement_checkpoint_fingerprint(&replacement_checkpoint);
    let request_fingerprint = headless_journey_closure_request_fingerprint(
        params,
        drive_id,
        &replacement_checkpoint_fingerprint,
        &active.summary.activation_fingerprint,
    )?;
    Ok(Some(HeadlessJourneyClosurePlan {
        journey_checkpoint,
        source_replacement_drive_id: closure.source_replacement_drive_id.clone(),
        source_replacement_resume_fingerprint: closure
            .expected_replacement_resume_fingerprint
            .clone(),
        replacement_continuation_id,
        replacement_checkpoint_fingerprint,
        active_modepack_activation_fingerprint: active.summary.activation_fingerprint,
        request_fingerprint,
    }))
}

fn validate_headless_journey_not_already_closed(
    store: &BrownieStore,
    journey_id: &str,
    run_id: &str,
    drive_id: &str,
) -> Result<(), String> {
    let events = store
        .tasks()
        .read_ledger_events(run_id)
        .map_err(|error| format!("failed to read journey closure ledger evidence: {error}"))?;
    for event in events
        .iter()
        .filter(|event| event.kind == LedgerEventKind::HeadlessJourneyClosed)
    {
        let Some(payload) = event.payload.as_ref() else {
            continue;
        };
        if payload.get("journey_id").and_then(Value::as_str) != Some(journey_id) {
            continue;
        }
        if payload.get("drive_id").and_then(Value::as_str) == Some(drive_id) {
            continue;
        }
        return Err(
            "invalid params: journey closure is already committed under a different drive_id"
                .to_string(),
        );
    }
    Ok(())
}

fn validate_headless_journey_closure_replay(
    params: &HeadlessRunDriveParams,
    drive_id: &str,
    result: &HeadlessRunDriveResult,
) -> Result<(), String> {
    match (
        params.journey_closure.as_ref(),
        result.journey_closure.as_ref(),
    ) {
        (None, None) => Ok(()),
        (Some(_), None) => Err(
            "invalid params: drive_id conflicts with a non-closure drive checkpoint".to_string(),
        ),
        (None, Some(_)) => Err(
            "invalid params: journey_closure is required to replay a journey closure drive"
                .to_string(),
        ),
        (Some(closure), Some(metadata)) => {
            if metadata.session_id != params.session_id || metadata.drive_id != drive_id {
                return Err(
                    "invalid params: journey closure replay conflicts with persisted drive"
                        .to_string(),
                );
            }
            if metadata.journey_id != closure.journey_id
                || metadata.source_replacement_drive_id != closure.source_replacement_drive_id
                || metadata.source_replacement_resume_fingerprint
                    != closure.expected_replacement_resume_fingerprint
            {
                return Err("invalid params: journey closure replay identity mismatch".to_string());
            }
            if !closure.authorize_journey_closure {
                return Err("invalid params: authorize_journey_closure must be true".to_string());
            }
            let request_fingerprint = headless_journey_closure_request_fingerprint(
                params,
                drive_id,
                &metadata.replacement_checkpoint_fingerprint,
                &metadata.active_modepack_activation_fingerprint,
            )?;
            if metadata.journey_closure_fingerprint
                != headless_journey_closure_metadata_fingerprint(metadata, &request_fingerprint)
            {
                return Err(
                    "invalid params: journey closure replay fingerprint mismatch".to_string(),
                );
            }
            Ok(())
        }
    }
}

fn headless_journey_closure_metadata_fingerprint(
    metadata: &HeadlessRunJourneyClosureMetadata,
    request_fingerprint: &str,
) -> String {
    let seed = json!({
        "closure_kind": "headless_journey_closure_metadata",
        "journey_id": metadata.journey_id,
        "task_id": metadata.task_id,
        "run_id": metadata.run_id,
        "session_id": metadata.session_id,
        "drive_id": metadata.drive_id,
        "source_replacement_drive_id": metadata.source_replacement_drive_id,
        "source_replacement_resume_fingerprint": metadata.source_replacement_resume_fingerprint,
        "replacement_route_kind": metadata.replacement_route_kind,
        "replacement_continuation_id": metadata.replacement_continuation_id,
        "replacement_checkpoint_fingerprint": metadata.replacement_checkpoint_fingerprint,
        "active_modepack_activation_fingerprint": metadata.active_modepack_activation_fingerprint,
        "closure_fingerprint": metadata.closure_fingerprint,
        "finalization_fingerprint": metadata.finalization_fingerprint,
        "terminal_completion_fingerprint": metadata.terminal_completion_fingerprint,
        "progress_fingerprint": metadata.progress_fingerprint,
        "aggregate_sequence": metadata.aggregate_sequence,
        "next_action": metadata.next_action,
        "request_fingerprint": request_fingerprint,
    });
    format!("sha256:{}", hex_sha256(seed.to_string().as_bytes()))
}

fn headless_journey_closure_metadata(
    plan: &HeadlessJourneyClosurePlan,
    session_id: &str,
    drive_id: &str,
    finalization: Option<&HeadlessRunCompletionFinalization>,
    completion_closure: &HeadlessRunCompletionClosure,
    replayed: bool,
) -> HeadlessRunJourneyClosureMetadata {
    let finalization_fingerprint =
        finalization.map(|finalization| finalization.finalization_fingerprint.clone());
    let terminal_completion_fingerprint =
        completion_closure.terminal_completion_fingerprint.clone();
    let mut metadata = HeadlessRunJourneyClosureMetadata {
        journey_id: plan.journey_checkpoint.journey_id.clone(),
        task_id: plan.journey_checkpoint.task_id.clone(),
        run_id: plan.journey_checkpoint.run_id.clone(),
        session_id: session_id.to_string(),
        drive_id: drive_id.to_string(),
        source_replacement_drive_id: plan.source_replacement_drive_id.clone(),
        source_replacement_resume_fingerprint: plan.source_replacement_resume_fingerprint.clone(),
        replacement_route_kind:
            HeadlessContinueRouteKind::ReplaceActiveWithApprovedModePackCandidateExplicitly,
        replacement_continuation_id: plan.replacement_continuation_id.clone(),
        replacement_checkpoint_fingerprint: plan.replacement_checkpoint_fingerprint.clone(),
        active_modepack_activation_fingerprint: plan.active_modepack_activation_fingerprint.clone(),
        closure_fingerprint: completion_closure.closure_fingerprint.clone(),
        finalization_fingerprint,
        terminal_completion_fingerprint,
        progress_fingerprint: completion_closure.progress_fingerprint.clone(),
        aggregate_sequence: completion_closure.aggregate_sequence,
        next_action: "complete_headless_journey".to_string(),
        replayed,
        journey_closure_fingerprint: String::new(),
    };
    metadata.journey_closure_fingerprint =
        headless_journey_closure_metadata_fingerprint(&metadata, &plan.request_fingerprint);
    metadata
}

fn headless_journey_execution_request_fingerprint(
    params: &HeadlessRunDriveParams,
    drive_id: &str,
) -> Result<String, String> {
    let execution = params
        .journey_execution
        .as_ref()
        .ok_or_else(|| "journey execution missing".to_string())?;
    let seed = json!({
        "execution_kind": "headless_journey_execution",
        "authorize": params.authorize,
        "session_id": params.session_id,
        "drive_id": drive_id,
        "journey_id": execution.journey_id,
        "authorize_journey_execution": execution.authorize_journey_execution,
    });
    Ok(format!(
        "sha256:{}",
        hex_sha256(seed.to_string().as_bytes())
    ))
}

fn validate_headless_journey_execution(
    params: &HeadlessRunDriveParams,
    drive_id: &str,
    max_advances: u8,
    max_steps_per_advance: u8,
) -> Result<(), String> {
    let Some(execution) = params.journey_execution.as_ref() else {
        return Ok(());
    };
    if !is_valid_headless_run_id(&execution.journey_id) {
        return Err("invalid params: journey execution journey_id must be 1-48 ASCII alphanumeric, dash, underscore, colon, or dot characters".to_string());
    }
    if !execution.authorize_journey_execution {
        return Err("invalid params: authorize_journey_execution must be true".to_string());
    }
    if let Some(fingerprint) = execution.expected_journey_fingerprint.as_deref() {
        if !is_sha256_fingerprint(fingerprint) {
            return Err(
                "invalid params: journey execution expected_journey_fingerprint must be a sha256 fingerprint"
                    .to_string(),
            );
        }
    }
    if let Some(task_start) = execution.task_start.as_ref() {
        if task_start.goal.trim().is_empty() {
            return Err(
                "invalid params: journey execution task_start.goal must not be empty".to_string(),
            );
        }
    }
    if params.expected_start_session_sequence == 0 {
        if execution.task_start.is_none() {
            return Err(
                "invalid params: journey execution admission requires task_start".to_string(),
            );
        }
        if execution.expected_journey_fingerprint.is_some() {
            return Err("invalid params: journey execution admission cannot include expected_journey_fingerprint before the journey exists".to_string());
        }
    } else if execution.expected_journey_fingerprint.is_none() {
        return Err(
            "invalid params: journey execution requires expected_journey_fingerprint after admission"
                .to_string(),
        );
    }
    if let Some(fingerprint) = execution
        .expected_execution_checkpoint_fingerprint
        .as_deref()
    {
        if !is_sha256_fingerprint(fingerprint) {
            return Err(
                "invalid params: expected_execution_checkpoint_fingerprint must be a sha256 fingerprint"
                    .to_string(),
            );
        }
    }
    if drive_id.starts_with("drive.") || params.drive_id.is_none() {
        return Err("invalid params: journey execution requires an explicit drive_id".to_string());
    }
    if params.journey_admission.is_some()
        || params.journey_route_resume.is_some()
        || params.journey_closure.is_some()
    {
        return Err("invalid params: journey execution cannot be combined with journey admission, route resume, or closure envelopes".to_string());
    }
    if headless_run_drive_has_explicit_modepack_target(params) {
        return Err("invalid params: journey execution cannot be combined with explicit modepack run-control targets".to_string());
    }
    if params.context_budget.is_some() {
        return Err(
            "invalid params: journey execution cannot be combined with context_budget".to_string(),
        );
    }
    if params.authorize_completion_finalization.is_some()
        || params.expected_completion_closure_fingerprint.is_some()
    {
        return Err("invalid params: journey execution cannot be combined with completion finalization fields".to_string());
    }
    let max_advances_allowed = if params.expected_start_session_sequence == 0 {
        max_advances == 1
    } else {
        max_advances == 1 || max_advances == 2
    };
    if !max_advances_allowed || max_steps_per_advance != 1 {
        return Err(
            "invalid params: journey execution requires bounded max_advances and max_steps_per_advance 1"
                .to_string(),
        );
    }
    Ok(())
}

fn headless_journey_execution_drive_id(
    parent_drive_id: &str,
    suffix: &str,
) -> Result<String, String> {
    let drive_id = format!("{parent_drive_id}.{suffix}");
    if !is_valid_headless_run_id(&drive_id) {
        return Err(
            "invalid params: journey execution derived drive_id exceeds bounded identifier limits"
                .to_string(),
        );
    }
    Ok(drive_id)
}

fn headless_journey_execution_checkpoint_fingerprint(
    metadata: &HeadlessRunJourneyExecutionMetadata,
    request_fingerprint: &str,
) -> String {
    let seed = json!({
        "execution_kind": "headless_journey_execution_checkpoint",
        "journey_id": metadata.journey_id,
        "task_id": metadata.task_id,
        "run_id": metadata.run_id,
        "session_id": metadata.session_id,
        "drive_id": metadata.drive_id,
        "journey_fingerprint": metadata.journey_fingerprint,
        "completed_boundaries": metadata.completed_boundaries,
        "complete": metadata.complete,
        "next_action": metadata.next_action,
        "request_fingerprint": request_fingerprint,
    });
    format!("sha256:{}", hex_sha256(seed.to_string().as_bytes()))
}

fn headless_journey_execution_metadata(
    journey: &HeadlessJourneyStartCheckpoint,
    session_id: &str,
    drive_id: &str,
    completed_boundaries: Vec<HeadlessRunJourneyExecutionBoundaryMetadata>,
    complete: bool,
    next_action: String,
    replayed: bool,
    request_fingerprint: &str,
) -> HeadlessRunJourneyExecutionMetadata {
    let mut metadata = HeadlessRunJourneyExecutionMetadata {
        journey_id: journey.journey_id.clone(),
        task_id: journey.task_id.clone(),
        run_id: journey.run_id.clone(),
        session_id: session_id.to_string(),
        drive_id: drive_id.to_string(),
        journey_fingerprint: journey.journey_fingerprint.clone(),
        completed_boundaries,
        complete,
        next_action,
        replayed,
        execution_checkpoint_fingerprint: String::new(),
    };
    metadata.execution_checkpoint_fingerprint =
        headless_journey_execution_checkpoint_fingerprint(&metadata, request_fingerprint);
    metadata
}

fn headless_journey_execution_boundary_from_result(
    boundary: &str,
    result: &HeadlessRunDriveResult,
) -> HeadlessRunJourneyExecutionBoundaryMetadata {
    HeadlessRunJourneyExecutionBoundaryMetadata {
        boundary: boundary.to_string(),
        drive_id: result.drive_id.clone(),
        route_kind: result
            .journey_route_resume
            .as_ref()
            .map(|metadata| metadata.route_kind.clone()),
        session_sequence: result.end_session_sequence,
        drive_fingerprint: result.drive_fingerprint.clone(),
        resume_fingerprint: result
            .journey_route_resume
            .as_ref()
            .map(|metadata| metadata.resume_fingerprint.clone()),
        journey_closure_fingerprint: result
            .journey_closure
            .as_ref()
            .map(|metadata| metadata.journey_closure_fingerprint.clone()),
        replayed: result.replayed,
    }
}

fn headless_journey_execution_write_checkpoint(
    store: &BrownieStore,
    journey: &HeadlessJourneyStartCheckpoint,
    session_id: &str,
    drive_id: &str,
    request_fingerprint: &str,
    completed_boundaries: Vec<HeadlessRunJourneyExecutionBoundaryMetadata>,
    complete: bool,
    next_action: String,
    replayed: bool,
) -> Result<HeadlessRunJourneyExecutionMetadata, String> {
    let metadata = headless_journey_execution_metadata(
        journey,
        session_id,
        drive_id,
        completed_boundaries,
        complete,
        next_action,
        replayed,
        request_fingerprint,
    );
    store
        .tasks()
        .write_headless_journey_execution_checkpoint(&HeadlessJourneyExecutionCheckpoint {
            journey_id: journey.journey_id.clone(),
            session_id: session_id.to_string(),
            drive_id: drive_id.to_string(),
            request_fingerprint: request_fingerprint.to_string(),
            journey_fingerprint: journey.journey_fingerprint.clone(),
            complete,
            metadata: metadata.clone(),
        })
        .map_err(|error| format!("failed to write journey execution checkpoint: {error}"))?;
    Ok(metadata)
}

fn headless_journey_execution_recover_admission_boundary(
    store: &BrownieStore,
    journey: &HeadlessJourneyStartCheckpoint,
    params: &HeadlessRunDriveParams,
    drive_id: &str,
    request_fingerprint: &str,
    completed_boundaries: &mut Vec<HeadlessRunJourneyExecutionBoundaryMetadata>,
) -> Result<Option<HeadlessRunDriveResult>, String> {
    if !completed_boundaries.is_empty() {
        return Ok(None);
    }
    let child_drive_id = headless_journey_execution_drive_id(drive_id, "admit")?;
    let checkpoint = store
        .tasks()
        .read_headless_run_session_drive_checkpoint(&params.session_id, &child_drive_id)
        .map_err(|error| error.to_string())?;
    let Some(checkpoint) = checkpoint else {
        return Ok(None);
    };
    if checkpoint.session_id != params.session_id
        || checkpoint.drive_id != child_drive_id
        || checkpoint.start_session_sequence != 0
    {
        return Err(
            "invalid params: recovered journey admission drive checkpoint is stale".to_string(),
        );
    }
    let mut result = checkpoint.result;
    let Some(metadata) = result.journey.as_ref() else {
        return Err(
            "internal error: recovered journey admission drive checkpoint is missing journey metadata"
                .to_string(),
        );
    };
    if metadata.journey_id != journey.journey_id
        || metadata.task_id != journey.task_id
        || metadata.run_id != journey.run_id
        || metadata.session_id != journey.session_id
        || metadata.drive_id != child_drive_id
        || metadata.journey_fingerprint != journey.journey_fingerprint
    {
        return Err(
            "invalid params: recovered journey admission drive checkpoint conflicts with persisted journey"
                .to_string(),
        );
    }
    result.replayed = true;
    if let Some(metadata) = result.journey.as_mut() {
        metadata.replayed = true;
    }
    completed_boundaries.push(headless_journey_execution_boundary_from_result(
        "admit_journey",
        &result,
    ));
    let mut execution_metadata = headless_journey_execution_write_checkpoint(
        store,
        journey,
        &params.session_id,
        drive_id,
        request_fingerprint,
        completed_boundaries.clone(),
        false,
        result.next_action.clone(),
        false,
    )?;
    execution_metadata.replayed = true;
    result.journey_execution = Some(execution_metadata);
    Ok(Some(result))
}

fn headless_journey_execution_has_boundary(
    completed_boundaries: &[HeadlessRunJourneyExecutionBoundaryMetadata],
    boundary: &str,
) -> bool {
    completed_boundaries
        .iter()
        .any(|metadata| metadata.boundary == boundary)
}

fn headless_journey_execution_recover_route_boundary(
    store: &BrownieStore,
    journey: &HeadlessJourneyStartCheckpoint,
    params: &HeadlessRunDriveParams,
    drive_id: &str,
    request_fingerprint: &str,
    route_kind: HeadlessContinueRouteKind,
    completed_boundaries: &mut Vec<HeadlessRunJourneyExecutionBoundaryMetadata>,
) -> Result<Option<HeadlessRunDriveResult>, String> {
    let (boundary, suffix) = headless_journey_execution_route_boundary(&route_kind);
    if headless_journey_execution_has_boundary(completed_boundaries, boundary) {
        return Ok(None);
    }
    let Some(previous_boundary) = completed_boundaries.last() else {
        return Ok(None);
    };
    let child_drive_id = headless_journey_execution_drive_id(drive_id, suffix)?;
    let checkpoint = store
        .tasks()
        .read_headless_run_session_drive_checkpoint(&params.session_id, &child_drive_id)
        .map_err(|error| error.to_string())?;
    let Some(checkpoint) = checkpoint else {
        return Ok(None);
    };
    if checkpoint.session_id != params.session_id
        || checkpoint.drive_id != child_drive_id
        || checkpoint.start_session_sequence != previous_boundary.session_sequence
    {
        return Err(
            "invalid params: recovered journey route drive checkpoint is stale".to_string(),
        );
    }
    let mut result = checkpoint.result;
    if result.session_id != params.session_id
        || result.drive_id != child_drive_id
        || result.start_session_sequence != checkpoint.start_session_sequence
    {
        return Err(
            "invalid params: recovered journey route drive result conflicts with checkpoint"
                .to_string(),
        );
    }
    let Some(metadata) = result.journey_route_resume.as_ref() else {
        return Err(
            "internal error: recovered journey route drive checkpoint is missing route metadata"
                .to_string(),
        );
    };
    if metadata.journey_id != journey.journey_id
        || metadata.task_id != journey.task_id
        || metadata.run_id != journey.run_id
        || metadata.session_id != journey.session_id
        || metadata.drive_id != child_drive_id
        || metadata.route_kind != route_kind
        || !is_sha256_fingerprint(&metadata.source_checkpoint_fingerprint)
        || !is_sha256_fingerprint(&metadata.resume_fingerprint)
    {
        return Err(
            "invalid params: recovered journey route drive checkpoint conflicts with persisted journey"
                .to_string(),
        );
    }
    result.replayed = true;
    if let Some(metadata) = result.journey_route_resume.as_mut() {
        metadata.replayed = true;
    }
    completed_boundaries.push(headless_journey_execution_boundary_from_result(
        boundary, &result,
    ));
    let mut execution_metadata = headless_journey_execution_write_checkpoint(
        store,
        journey,
        &params.session_id,
        drive_id,
        request_fingerprint,
        completed_boundaries.clone(),
        false,
        result.next_action.clone(),
        false,
    )?;
    execution_metadata.replayed = true;
    result.journey_execution = Some(execution_metadata);
    Ok(Some(result))
}

fn headless_journey_execution_recover_closure_boundary(
    store: &BrownieStore,
    journey: &HeadlessJourneyStartCheckpoint,
    params: &HeadlessRunDriveParams,
    drive_id: &str,
    request_fingerprint: &str,
    completed_boundaries: &mut Vec<HeadlessRunJourneyExecutionBoundaryMetadata>,
) -> Result<Option<HeadlessRunDriveResult>, String> {
    if headless_journey_execution_has_boundary(completed_boundaries, "close_journey") {
        return Ok(None);
    }
    let Some(replacement) = completed_boundaries
        .iter()
        .rev()
        .find(|boundary| boundary.boundary == "replace_active_modepack")
        .cloned()
    else {
        return Ok(None);
    };
    let Some(replacement_resume_fingerprint) = replacement.resume_fingerprint.as_deref() else {
        return Err("internal error: replacement boundary missing resume fingerprint".to_string());
    };
    headless_journey_execution_complete_task_if_needed(
        store,
        journey,
        replacement_resume_fingerprint,
    )?;
    let child_drive_id = headless_journey_execution_drive_id(drive_id, "closure")?;
    let checkpoint = store
        .tasks()
        .read_headless_run_session_drive_checkpoint(&params.session_id, &child_drive_id)
        .map_err(|error| error.to_string())?;
    let Some(checkpoint) = checkpoint else {
        return Ok(None);
    };
    if checkpoint.session_id != params.session_id
        || checkpoint.drive_id != child_drive_id
        || checkpoint.start_session_sequence != replacement.session_sequence
    {
        return Err(
            "invalid params: recovered journey closure drive checkpoint is stale".to_string(),
        );
    }
    let mut result = checkpoint.result;
    if result.session_id != params.session_id
        || result.drive_id != child_drive_id
        || result.start_session_sequence != checkpoint.start_session_sequence
    {
        return Err(
            "invalid params: recovered journey closure drive result conflicts with checkpoint"
                .to_string(),
        );
    }
    let Some(metadata) = result.journey_closure.as_ref() else {
        return Err(
            "internal error: recovered journey closure drive checkpoint is missing closure metadata"
                .to_string(),
        );
    };
    if metadata.journey_id != journey.journey_id
        || metadata.task_id != journey.task_id
        || metadata.run_id != journey.run_id
        || metadata.session_id != journey.session_id
        || metadata.drive_id != child_drive_id
        || metadata.source_replacement_drive_id != replacement.drive_id
        || metadata.source_replacement_resume_fingerprint != replacement_resume_fingerprint
        || !is_sha256_fingerprint(&metadata.journey_closure_fingerprint)
    {
        return Err(
            "invalid params: recovered journey closure drive checkpoint conflicts with persisted journey"
                .to_string(),
        );
    }
    result.replayed = true;
    if let Some(metadata) = result.journey_closure.as_mut() {
        metadata.replayed = true;
    }
    completed_boundaries.push(headless_journey_execution_boundary_from_result(
        "close_journey",
        &result,
    ));
    let mut execution_metadata = headless_journey_execution_write_checkpoint(
        store,
        journey,
        &params.session_id,
        drive_id,
        request_fingerprint,
        completed_boundaries.clone(),
        true,
        "complete_headless_journey".to_string(),
        false,
    )?;
    execution_metadata.replayed = true;
    if let Err(error) =
        append_headless_journey_executed_event_if_missing(store, &execution_metadata)
    {
        return Err(format!("internal error: {error}"));
    }
    result.journey_execution = Some(execution_metadata);
    Ok(Some(result))
}

fn headless_journey_execution_recover_committed_boundaries(
    store: &BrownieStore,
    journey: &HeadlessJourneyStartCheckpoint,
    params: &HeadlessRunDriveParams,
    drive_id: &str,
    request_fingerprint: &str,
    completed_boundaries: &mut Vec<HeadlessRunJourneyExecutionBoundaryMetadata>,
) -> Result<Option<HeadlessRunDriveResult>, String> {
    let mut last_result = None;
    if let Some(result) = headless_journey_execution_recover_admission_boundary(
        store,
        journey,
        params,
        drive_id,
        request_fingerprint,
        completed_boundaries,
    )? {
        last_result = Some(result);
    }
    for route_kind in [
        HeadlessContinueRouteKind::FetchSelectedModePackCandidateExplicitly,
        HeadlessContinueRouteKind::VerifySelectedModePackCandidateProvenanceExplicitly,
        HeadlessContinueRouteKind::ApproveVerifiedModePackCandidateExplicitly,
        HeadlessContinueRouteKind::ReplaceActiveWithApprovedModePackCandidateExplicitly,
    ] {
        if let Some(result) = headless_journey_execution_recover_route_boundary(
            store,
            journey,
            params,
            drive_id,
            request_fingerprint,
            route_kind,
            completed_boundaries,
        )? {
            last_result = Some(result);
        }
    }
    if let Some(result) = headless_journey_execution_recover_closure_boundary(
        store,
        journey,
        params,
        drive_id,
        request_fingerprint,
        completed_boundaries,
    )? {
        last_result = Some(result);
    }
    Ok(last_result)
}

fn headless_journey_source_checkpoint_fingerprint_for_route(
    store: &BrownieStore,
    start_checkpoint: &HeadlessRunSessionCheckpoint,
    route_kind: HeadlessContinueRouteKind,
) -> Result<String, String> {
    let source_continuation_id = start_checkpoint
        .result
        .steps
        .iter()
        .find_map(|step| step.continuation_id.clone())
        .ok_or_else(|| {
            "invalid params: journey execution source continuation evidence is missing".to_string()
        })?;
    match route_kind {
        HeadlessContinueRouteKind::FetchSelectedModePackCandidateExplicitly => {
            let checkpoint = store
                .read_headless_modepack_registry_update_selection_checkpoint(
                    &source_continuation_id,
                )
                .map_err(|error| error.to_string())?
                .ok_or_else(|| {
                    "invalid params: journey execution registry selection checkpoint is missing"
                        .to_string()
                })?;
            Ok(headless_registry_update_selection_checkpoint_fingerprint(
                &checkpoint,
            ))
        }
        HeadlessContinueRouteKind::VerifySelectedModePackCandidateProvenanceExplicitly => {
            let checkpoint = store
                .read_headless_modepack_selected_candidate_fetch_checkpoint(
                    &source_continuation_id,
                )
                .map_err(|error| error.to_string())?
                .ok_or_else(|| {
                    "invalid params: journey execution selected-candidate fetch checkpoint is missing"
                        .to_string()
                })?;
            Ok(headless_selected_candidate_fetch_checkpoint_fingerprint(
                &checkpoint,
            ))
        }
        HeadlessContinueRouteKind::ApproveVerifiedModePackCandidateExplicitly => {
            let checkpoint = store
                .read_headless_modepack_selected_candidate_provenance_verification_checkpoint(
                    &source_continuation_id,
                )
                .map_err(|error| error.to_string())?
                .ok_or_else(|| {
                    "invalid params: journey execution selected-candidate provenance checkpoint is missing"
                        .to_string()
                })?;
            Ok(
                headless_selected_candidate_provenance_verification_checkpoint_fingerprint(
                    &checkpoint,
                ),
            )
        }
        HeadlessContinueRouteKind::ReplaceActiveWithApprovedModePackCandidateExplicitly => {
            let checkpoint = store
                .read_headless_modepack_selected_candidate_approval_checkpoint(
                    &source_continuation_id,
                )
                .map_err(|error| error.to_string())?
                .ok_or_else(|| {
                    "invalid params: journey execution selected-candidate approval checkpoint is missing"
                        .to_string()
                })?;
            Ok(headless_selected_candidate_approval_checkpoint_fingerprint(
                &checkpoint,
            ))
        }
        _ => Err(
            "invalid params: journey execution only supports the Golden Journey route chain"
                .to_string(),
        ),
    }
}

fn headless_journey_execution_next_route(
    checkpoint: &HeadlessRunSessionCheckpoint,
) -> Option<HeadlessContinueRouteKind> {
    let route_kind = headless_run_checkpoint_next_route_kind(checkpoint).cloned();
    match route_kind {
        Some(HeadlessContinueRouteKind::FetchSelectedModePackCandidateExplicitly)
        | Some(HeadlessContinueRouteKind::VerifySelectedModePackCandidateProvenanceExplicitly)
        | Some(HeadlessContinueRouteKind::ApproveVerifiedModePackCandidateExplicitly)
        | Some(HeadlessContinueRouteKind::ReplaceActiveWithApprovedModePackCandidateExplicitly) => {
            route_kind
        }
        Some(HeadlessContinueRouteKind::RefreshProgressOverview)
            if headless_run_checkpoint_has_next_route_action(
                checkpoint,
                HeadlessContinueRouteKind::RefreshProgressOverview,
                "replace_active_with_approved_modepack_candidate_explicitly",
            ) =>
        {
            Some(HeadlessContinueRouteKind::ReplaceActiveWithApprovedModePackCandidateExplicitly)
        }
        _ => None,
    }
}

fn headless_journey_execution_route_boundary(
    route_kind: &HeadlessContinueRouteKind,
) -> (&'static str, &'static str) {
    match route_kind {
        HeadlessContinueRouteKind::FetchSelectedModePackCandidateExplicitly => {
            ("fetch_selected_candidate", "fetch")
        }
        HeadlessContinueRouteKind::VerifySelectedModePackCandidateProvenanceExplicitly => {
            ("verify_candidate_provenance", "provenance")
        }
        HeadlessContinueRouteKind::ApproveVerifiedModePackCandidateExplicitly => {
            ("approve_verified_candidate", "approval")
        }
        HeadlessContinueRouteKind::ReplaceActiveWithApprovedModePackCandidateExplicitly => {
            ("replace_active_modepack", "replacement")
        }
        _ => ("unsupported", "unsupported"),
    }
}

fn headless_journey_execution_complete_task_if_needed(
    store: &BrownieStore,
    journey: &HeadlessJourneyStartCheckpoint,
    replacement_resume_fingerprint: &str,
) -> Result<(), String> {
    let Some(record) = store
        .tasks()
        .get_task(&journey.task_id)
        .map_err(|error| error.to_string())?
    else {
        return Err("invalid params: journey execution task record is missing".to_string());
    };
    if record.run_id != journey.run_id {
        return Err("invalid params: journey execution task/run identity mismatch".to_string());
    }
    if record.status == TaskStatus::Completed {
        return Ok(());
    }
    let completion_seed = json!({
        "completion_kind": "headless_journey_execution_replacement_completion",
        "journey_id": journey.journey_id,
        "task_id": journey.task_id,
        "run_id": journey.run_id,
        "replacement_resume_fingerprint": replacement_resume_fingerprint,
    });
    let completion_fingerprint = format!(
        "sha256:{}",
        hex_sha256(completion_seed.to_string().as_bytes())
    );
    store
        .tasks()
        .update_task_status_with_payload(
            &journey.task_id,
            TaskStatus::Completed,
            LedgerEventKind::TaskCompleted,
            Some(json!({
                "completion_evidence": TaskRunCompletionEvidence {
                    final_state: "Completed".to_string(),
                    task_status: TaskStatus::Completed,
                    completion_result_fingerprint: completion_fingerprint,
                    completion_summary_preview: "headless golden journey complete".to_string(),
                    completion_summary_chars: 32,
                    completion_summary_truncated: false,
                    final_response_present: false,
                    final_response_chars: 0,
                    replayed: false,
                }
            })),
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn append_headless_journey_executed_event_if_missing(
    store: &BrownieStore,
    metadata: &HeadlessRunJourneyExecutionMetadata,
) -> anyhow::Result<()> {
    let Some(record) = store.tasks().get_task(&metadata.task_id)? else {
        return Ok(());
    };
    if record.run_id != metadata.run_id {
        return Ok(());
    }
    let already_recorded = store
        .tasks()
        .read_ledger_events(&record.run_id)?
        .iter()
        .any(|event| {
            event.kind == LedgerEventKind::HeadlessJourneyExecuted
                && event
                    .payload
                    .as_ref()
                    .and_then(|payload| payload.get("execution_checkpoint_fingerprint"))
                    .and_then(Value::as_str)
                    == Some(metadata.execution_checkpoint_fingerprint.as_str())
        });
    if already_recorded {
        return Ok(());
    }
    store.tasks().append_task_event_with_payload(
        &record,
        LedgerEventKind::HeadlessJourneyExecuted,
        Some(json!({
            "journey_id": metadata.journey_id,
            "session_id": metadata.session_id,
            "drive_id": metadata.drive_id,
            "task_id": metadata.task_id,
            "run_id": metadata.run_id,
            "journey_fingerprint": metadata.journey_fingerprint,
            "completed_boundary_count": metadata.completed_boundaries.len(),
            "complete": metadata.complete,
            "next_action": metadata.next_action,
            "execution_checkpoint_fingerprint": metadata.execution_checkpoint_fingerprint,
            "reason": "Headless Golden Journey execution completed through bounded runtime-owned boundary continuation."
        })),
    )
}

fn handle_headless_journey_execution(
    id: Value,
    params: &HeadlessRunDriveParams,
    drive_id: &str,
    store: &BrownieStore,
) -> JsonRpcResponse<Value> {
    let Some(execution) = params.journey_execution.as_ref() else {
        return error_response(id, -32603, "internal error: journey execution missing");
    };
    let request_fingerprint = match headless_journey_execution_request_fingerprint(params, drive_id)
    {
        Ok(fingerprint) => fingerprint,
        Err(message) => return error_response(id, -32602, &message),
    };
    let existing_execution = match store
        .tasks()
        .read_headless_journey_execution_checkpoint(&execution.journey_id)
    {
        Ok(checkpoint) => checkpoint,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    if let Some(existing) = existing_execution.as_ref() {
        if existing.session_id != params.session_id
            || existing.drive_id != drive_id
            || existing.request_fingerprint != request_fingerprint
        {
            return error_response(
                id,
                -32602,
                "invalid params: journey execution conflicts with persisted execution checkpoint",
            );
        }
        if let Some(expected_journey_fingerprint) =
            execution.expected_journey_fingerprint.as_deref()
        {
            if existing.journey_fingerprint != expected_journey_fingerprint {
                return error_response(
                    id,
                    -32602,
                    "invalid params: journey execution expected_journey_fingerprint is stale",
                );
            }
        }
        if let Some(expected) = execution
            .expected_execution_checkpoint_fingerprint
            .as_deref()
        {
            if expected != existing.metadata.execution_checkpoint_fingerprint {
                return error_response(
                    id,
                    -32602,
                    "invalid params: expected_execution_checkpoint_fingerprint is stale for journey execution",
                );
            }
        }
        if existing.complete {
            let Some(last_boundary) = existing.metadata.completed_boundaries.last() else {
                return error_response(
                    id,
                    -32603,
                    "internal error: completed journey execution checkpoint has no boundary metadata",
                );
            };
            let Some(checkpoint) = (match store.tasks().read_headless_run_session_drive_checkpoint(
                &params.session_id,
                &last_boundary.drive_id,
            ) {
                Ok(checkpoint) => checkpoint,
                Err(error) => {
                    return error_response(id, -32603, &format!("internal error: {error}"))
                }
            }) else {
                return error_response(
                    id,
                    -32603,
                    "internal error: completed journey execution drive checkpoint is missing",
                );
            };
            let mut result = checkpoint.result;
            result.replayed = true;
            if let Some(metadata) = result.journey_closure.as_mut() {
                metadata.replayed = true;
            }
            let mut metadata = existing.metadata.clone();
            metadata.replayed = true;
            result.journey_execution = Some(metadata.clone());
            if let Err(error) = append_headless_journey_executed_event_if_missing(store, &metadata)
            {
                return error_response(id, -32603, &format!("internal error: {error}"));
            }
            return result_response(id, json!(result));
        }
    } else if execution
        .expected_execution_checkpoint_fingerprint
        .is_some()
    {
        return error_response(
            id,
            -32602,
            "invalid params: expected_execution_checkpoint_fingerprint has no persisted journey execution checkpoint",
        );
    }

    let mut journey = match store
        .tasks()
        .read_headless_journey_start_checkpoint(&execution.journey_id)
    {
        Ok(checkpoint) => checkpoint,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };

    let mut completed_boundaries = existing_execution
        .as_ref()
        .map(|checkpoint| checkpoint.metadata.completed_boundaries.clone())
        .unwrap_or_default();
    let mut last_result: Option<HeadlessRunDriveResult> = None;
    if let Some(existing) = existing_execution.as_ref() {
        if let Some(last_boundary) = existing.metadata.completed_boundaries.last() {
            let checkpoint = match store.tasks().read_headless_run_session_drive_checkpoint(
                &params.session_id,
                &last_boundary.drive_id,
            ) {
                Ok(checkpoint) => checkpoint,
                Err(error) => {
                    return error_response(id, -32603, &format!("internal error: {error}"))
                }
            };
            let Some(checkpoint) = checkpoint else {
                return error_response(
                    id,
                    -32603,
                    "internal error: persisted journey execution boundary drive is missing",
                );
            };
            let mut result = checkpoint.result;
            result.replayed = true;
            if let Some(metadata) = result.journey_route_resume.as_mut() {
                metadata.replayed = true;
            }
            if let Some(metadata) = result.journey_closure.as_mut() {
                metadata.replayed = true;
            }
            let mut metadata = existing.metadata.clone();
            metadata.replayed = true;
            result.journey_execution = Some(metadata);
            last_result = Some(result);
        }
    }
    if journey.is_none() {
        let Some(task_start) = execution.task_start.as_ref() else {
            return error_response(
                id,
                -32602,
                "invalid params: journey execution requires a persisted journey checkpoint or task_start",
            );
        };
        let child_drive_id = match headless_journey_execution_drive_id(drive_id, "admit") {
            Ok(child_drive_id) => child_drive_id,
            Err(message) => return error_response(id, -32602, &message),
        };
        let child_request = json!({
            "authorize": true,
            "session_id": params.session_id,
            "drive_id": child_drive_id,
            "expected_start_session_sequence": 0,
            "max_advances": 1,
            "max_steps_per_advance": 1,
            "journey_admission": {
                "journey_id": execution.journey_id,
                "authorize_journey_start": true,
                "task_start": task_start
            }
        });
        let response = handle_headless_run_drive(id.clone(), Some(child_request));
        let Some(value) = response.result else {
            return JsonRpcResponse {
                jsonrpc: JSONRPC_VERSION.to_string(),
                id,
                result: None,
                error: response.error,
            };
        };
        let result: HeadlessRunDriveResult = match serde_json::from_value(value) {
            Ok(result) => result,
            Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
        };
        journey = match store
            .tasks()
            .read_headless_journey_start_checkpoint(&execution.journey_id)
        {
            Ok(checkpoint) => checkpoint,
            Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
        };
        let Some(journey_checkpoint) = journey.as_ref() else {
            return error_response(
                id,
                -32603,
                "internal error: journey execution admission did not persist a journey checkpoint",
            );
        };
        completed_boundaries.push(headless_journey_execution_boundary_from_result(
            "admit_journey",
            &result,
        ));
        let metadata = match headless_journey_execution_write_checkpoint(
            store,
            journey_checkpoint,
            &params.session_id,
            drive_id,
            &request_fingerprint,
            completed_boundaries.clone(),
            false,
            result.next_action.clone(),
            false,
        ) {
            Ok(metadata) => metadata,
            Err(message) => {
                return error_response(id, -32603, &format!("internal error: {message}"))
            }
        };
        last_result = Some(HeadlessRunDriveResult {
            journey_execution: Some(metadata),
            ..result
        });
    }
    let Some(journey) = journey else {
        return error_response(
            id,
            -32602,
            "invalid params: journey execution requires a persisted journey checkpoint",
        );
    };
    if journey.session_id != params.session_id {
        return error_response(
            id,
            -32602,
            "invalid params: journey execution identity conflicts with persisted journey",
        );
    }
    if let Some(expected_journey_fingerprint) = execution.expected_journey_fingerprint.as_deref() {
        if journey.journey_fingerprint != expected_journey_fingerprint {
            return error_response(
                id,
                -32602,
                "invalid params: journey execution identity conflicts with persisted journey",
            );
        }
    }
    if let Some(task_start) = execution.task_start.as_ref() {
        let admission = HeadlessRunJourneyAdmission {
            journey_id: execution.journey_id.clone(),
            authorize_journey_start: true,
            task_start: Some(task_start.clone()),
            objective_context: None,
            product_objective_continuation_source: None,
        };
        if journey.task_start_fingerprint != headless_journey_task_start_fingerprint(&admission) {
            return error_response(
                id,
                -32602,
                "invalid params: journey execution task_start conflicts with persisted journey",
            );
        }
    }
    match headless_journey_execution_recover_committed_boundaries(
        store,
        &journey,
        params,
        drive_id,
        &request_fingerprint,
        &mut completed_boundaries,
    ) {
        Ok(recovered) => {
            if let Some(result) = recovered {
                let complete = result
                    .journey_execution
                    .as_ref()
                    .map(|metadata| metadata.complete)
                    .unwrap_or(false);
                last_result = Some(result.clone());
                if complete {
                    return result_response(id, json!(result));
                }
            }
        }
        Err(message) => return error_response(id, -32602, &message),
    }
    if existing_execution.is_none() && completed_boundaries.is_empty() {
        match headless_journey_execution_recover_admission_boundary(
            store,
            &journey,
            params,
            drive_id,
            &request_fingerprint,
            &mut completed_boundaries,
        ) {
            Ok(recovered) => {
                if recovered.is_some() {
                    last_result = recovered;
                }
            }
            Err(message) => return error_response(id, -32602, &message),
        }
    }
    for _ in 0..6 {
        let session_checkpoint = match store
            .tasks()
            .read_headless_run_session_checkpoint(&params.session_id)
        {
            Ok(Some(checkpoint)) => checkpoint,
            Ok(None) => {
                return error_response(
                    id,
                    -32602,
                    "invalid params: journey execution requires an existing session checkpoint",
                )
            }
            Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
        };
        if session_checkpoint.session_sequence < params.expected_start_session_sequence {
            return error_response(
                id,
                -32602,
                "invalid params: journey execution session checkpoint is older than expected_start_session_sequence",
            );
        }
        if let Some(route_kind) = headless_journey_execution_next_route(&session_checkpoint) {
            let source_checkpoint_fingerprint =
                match headless_journey_source_checkpoint_fingerprint_for_route(
                    store,
                    &session_checkpoint,
                    route_kind.clone(),
                ) {
                    Ok(fingerprint) => fingerprint,
                    Err(message) => return error_response(id, -32602, &message),
                };
            let (boundary, suffix) = headless_journey_execution_route_boundary(&route_kind);
            let child_drive_id = match headless_journey_execution_drive_id(drive_id, suffix) {
                Ok(child_drive_id) => child_drive_id,
                Err(message) => return error_response(id, -32602, &message),
            };
            let child_request = json!({
                "authorize": true,
                "session_id": params.session_id,
                "drive_id": child_drive_id,
                "expected_start_session_sequence": session_checkpoint.session_sequence,
                "max_advances": 2,
                "max_steps_per_advance": 1,
                "journey_route_resume": {
                    "journey_id": execution.journey_id,
                    "authorize_journey_route_resume": true,
                    "expected_journey_fingerprint": journey.journey_fingerprint,
                    "expected_route_kind": route_kind,
                    "expected_source_checkpoint_fingerprint": source_checkpoint_fingerprint
                }
            });
            let response = handle_headless_run_drive(id.clone(), Some(child_request));
            let Some(value) = response.result else {
                return JsonRpcResponse {
                    jsonrpc: JSONRPC_VERSION.to_string(),
                    id,
                    result: None,
                    error: response.error,
                };
            };
            let result: HeadlessRunDriveResult = match serde_json::from_value(value) {
                Ok(result) => result,
                Err(error) => {
                    return error_response(id, -32603, &format!("internal error: {error}"))
                }
            };
            completed_boundaries.push(headless_journey_execution_boundary_from_result(
                boundary, &result,
            ));
            let metadata = match headless_journey_execution_write_checkpoint(
                store,
                &journey,
                &params.session_id,
                drive_id,
                &request_fingerprint,
                completed_boundaries.clone(),
                false,
                result.next_action.clone(),
                false,
            ) {
                Ok(metadata) => metadata,
                Err(message) => {
                    return error_response(id, -32603, &format!("internal error: {message}"))
                }
            };
            last_result = Some(HeadlessRunDriveResult {
                journey_execution: Some(metadata),
                ..result
            });
            continue;
        }

        let replacement = completed_boundaries
            .iter()
            .rev()
            .find(|boundary| boundary.boundary == "replace_active_modepack")
            .cloned();
        let Some(replacement) = replacement else {
            if let Some(result) = last_result {
                return result_response(id, json!(result));
            }
            return error_response(
                id,
                -32602,
                "invalid params: journey execution requires a persisted Golden Journey route boundary",
            );
        };
        let Some(replacement_resume_fingerprint) = replacement.resume_fingerprint.as_deref() else {
            return error_response(
                id,
                -32603,
                "internal error: replacement boundary missing resume fingerprint",
            );
        };
        if let Err(message) = headless_journey_execution_complete_task_if_needed(
            store,
            &journey,
            replacement_resume_fingerprint,
        ) {
            return error_response(id, -32602, &message);
        }
        let child_drive_id = match headless_journey_execution_drive_id(drive_id, "closure") {
            Ok(child_drive_id) => child_drive_id,
            Err(message) => return error_response(id, -32602, &message),
        };
        let child_request = json!({
            "authorize": true,
            "session_id": params.session_id,
            "drive_id": child_drive_id,
            "expected_start_session_sequence": session_checkpoint.session_sequence,
            "max_advances": 1,
            "max_steps_per_advance": 1,
            "journey_closure": {
                "journey_id": execution.journey_id,
                "authorize_journey_closure": true,
                "expected_journey_fingerprint": journey.journey_fingerprint,
                "source_replacement_drive_id": replacement.drive_id,
                "expected_replacement_resume_fingerprint": replacement_resume_fingerprint
            }
        });
        let response = handle_headless_run_drive(id.clone(), Some(child_request));
        let Some(value) = response.result else {
            return JsonRpcResponse {
                jsonrpc: JSONRPC_VERSION.to_string(),
                id,
                result: None,
                error: response.error,
            };
        };
        let mut result: HeadlessRunDriveResult = match serde_json::from_value(value) {
            Ok(result) => result,
            Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
        };
        completed_boundaries.push(headless_journey_execution_boundary_from_result(
            "close_journey",
            &result,
        ));
        let metadata = match headless_journey_execution_write_checkpoint(
            store,
            &journey,
            &params.session_id,
            drive_id,
            &request_fingerprint,
            completed_boundaries,
            true,
            "complete_headless_journey".to_string(),
            false,
        ) {
            Ok(metadata) => metadata,
            Err(message) => {
                return error_response(id, -32603, &format!("internal error: {message}"))
            }
        };
        if let Err(error) = append_headless_journey_executed_event_if_missing(store, &metadata) {
            return error_response(id, -32603, &format!("internal error: {error}"));
        }
        result.journey_execution = Some(metadata);
        return result_response(id, json!(result));
    }
    error_response(
        id,
        -32602,
        "invalid params: journey execution exceeded bounded Golden Journey boundary budget",
    )
}

pub(super) fn headless_run_checkpoint_is_progress_overview_boundary(
    checkpoint: &HeadlessRunSessionCheckpoint,
) -> bool {
    matches!(
        headless_run_checkpoint_next_route_kind(checkpoint),
        None | Some(HeadlessContinueRouteKind::InspectProgressOverview)
            | Some(HeadlessContinueRouteKind::RefreshProgressOverview)
    )
}

pub(super) fn handle_headless_run_drive(
    id: Value,
    params: Option<Value>,
) -> JsonRpcResponse<Value> {
    let params: HeadlessRunDriveParams = match parse_params(params) {
        Ok(params) => params,
        Err(message) => return error_response(id, -32602, &message),
    };
    if !params.authorize {
        return error_response(id, -32602, "invalid params: authorize must be true");
    }
    if !is_valid_headless_run_id(&params.session_id) {
        return error_response(
            id,
            -32602,
            "invalid params: session_id must be 1-48 ASCII alphanumeric, dash, underscore, colon, or dot characters",
        );
    }
    if params.expected_start_session_sequence == 0
        && params.journey_admission.is_none()
        && params.journey_execution.is_none()
    {
        return error_response(
            id,
            -32602,
            "invalid params: expected_start_session_sequence must be greater than zero",
        );
    }
    let drive_id = params
        .drive_id
        .clone()
        .unwrap_or_else(|| format!("drive.{}", params.expected_start_session_sequence));
    if !is_valid_headless_run_id(&drive_id) {
        return error_response(
            id,
            -32602,
            "invalid params: drive_id must be 1-48 ASCII alphanumeric, dash, underscore, colon, or dot characters",
        );
    }
    if let Err(message) = validate_headless_journey_admission(&params, &drive_id) {
        return error_response(id, -32602, &message);
    }
    let max_advances = params.max_advances.unwrap_or(1);
    if max_advances == 0 || max_advances > HEADLESS_RUN_DRIVE_MAX_ADVANCES {
        return error_response(
            id,
            -32602,
            "invalid params: max_advances must be between 1 and 3",
        );
    }
    let max_steps_per_advance = params
        .max_steps_per_advance
        .unwrap_or(HEADLESS_CONTINUE_MAX_BUDGET_STEPS);
    if max_steps_per_advance == 0 || max_steps_per_advance > HEADLESS_CONTINUE_MAX_BUDGET_STEPS {
        return error_response(
            id,
            -32602,
            "invalid params: max_steps_per_advance must be between 1 and 3",
        );
    }
    if params.modepack_registry_update_selection_target.is_some() && max_steps_per_advance > 1 {
        return error_response(
            id,
            -32602,
            "invalid params: modepack_registry_update_selection_target cannot be combined with max_steps_per_advance greater than 1",
        );
    }
    if params.modepack_selected_candidate_fetch_target.is_some() && max_steps_per_advance > 1 {
        return error_response(
            id,
            -32602,
            "invalid params: modepack_selected_candidate_fetch_target cannot be combined with max_steps_per_advance greater than 1",
        );
    }
    if params
        .modepack_selected_candidate_provenance_verification_target
        .is_some()
        && max_steps_per_advance > 1
    {
        return error_response(
            id,
            -32602,
            "invalid params: modepack_selected_candidate_provenance_verification_target cannot be combined with max_steps_per_advance greater than 1",
        );
    }
    if params.modepack_selected_candidate_approval_target.is_some() && max_steps_per_advance > 1 {
        return error_response(
            id,
            -32602,
            "invalid params: modepack_selected_candidate_approval_target cannot be combined with max_steps_per_advance greater than 1",
        );
    }
    if params
        .modepack_selected_approved_candidate_replacement_target
        .is_some()
        && max_steps_per_advance > 1
    {
        return error_response(
            id,
            -32602,
            "invalid params: modepack_selected_approved_candidate_replacement_target cannot be combined with max_steps_per_advance greater than 1",
        );
    }
    if params.product_continuation_admission_target.is_some() && max_steps_per_advance > 1 {
        return error_response(
            id,
            -32602,
            "invalid params: product_continuation_admission_target cannot be combined with max_steps_per_advance greater than 1",
        );
    }
    if params.product_continuation_run_target.is_some() && max_steps_per_advance > 1 {
        return error_response(
            id,
            -32602,
            "invalid params: product_continuation_run_target cannot be combined with max_steps_per_advance greater than 1",
        );
    }
    if params.product_continuation_derived_target.is_some() && max_steps_per_advance > 1 {
        return error_response(
            id,
            -32602,
            "invalid params: product_continuation_derived_target cannot be combined with max_steps_per_advance greater than 1",
        );
    }
    let product_continuation_target_count = [
        params.product_continuation_admission_target.is_some(),
        params.product_continuation_run_target.is_some(),
        params.product_continuation_derived_target.is_some(),
    ]
    .into_iter()
    .filter(|present| *present)
    .count();
    if product_continuation_target_count > 1 {
        return error_response(
            id,
            -32602,
            "invalid params: only one explicit product-continuation drive target may be supplied",
        );
    }
    if let Err(message) =
        validate_headless_journey_route_resume(&params, max_advances, max_steps_per_advance)
    {
        return error_response(id, -32602, &message);
    }
    if let Err(message) =
        validate_headless_journey_closure(&params, max_advances, max_steps_per_advance)
    {
        return error_response(id, -32602, &message);
    }
    if let Err(message) =
        validate_headless_journey_execution(&params, &drive_id, max_advances, max_steps_per_advance)
    {
        return error_response(id, -32602, &message);
    }
    if headless_run_drive_explicit_modepack_target_count(&params) > 1 {
        return error_response(
            id,
            -32602,
            "invalid params: only one explicit modepack run-control target may be supplied",
        );
    }
    if let Err(message) = validate_headless_context_budget_bounds(params.context_budget.as_ref()) {
        return error_response(id, -32602, message);
    }
    if headless_run_drive_has_explicit_modepack_target(&params) && params.context_budget.is_some() {
        return error_response(
            id,
            -32602,
            "invalid params: context_budget is supported only for normal headless task continuation",
        );
    }
    if product_continuation_target_count > 0 && params.context_budget.is_some() {
        return error_response(
            id,
            -32602,
            "invalid params: context_budget is supported only for normal headless task continuation",
        );
    }
    if params.authorize_completion_finalization.unwrap_or(false)
        && params.expected_completion_closure_fingerprint.is_none()
    {
        return error_response(
            id,
            -32602,
            "invalid params: expected_completion_closure_fingerprint is required when completion finalization is authorized",
        );
    }
    if let Some(fingerprint) = params.expected_completion_closure_fingerprint.as_deref() {
        if !is_sha256_fingerprint(fingerprint) {
            return error_response(
                id,
                -32602,
                "invalid params: expected_completion_closure_fingerprint must be a sha256 fingerprint",
            );
        }
    }

    let store = match BrownieStore::from_env_or_cwd() {
        Ok(store) => store,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    if params.journey_execution.is_some() {
        return handle_headless_journey_execution(id, &params, &drive_id, &store);
    }
    let journey_checkpoint = if let Some(admission) = params.journey_admission.as_ref() {
        match headless_journey_start_checkpoint_for_admission(
            &store,
            admission,
            &params.session_id,
            &drive_id,
            &id,
        ) {
            Ok(checkpoint) => Some(checkpoint),
            Err(response) => return response,
        }
    } else {
        None
    };
    let drive_start_session_sequence = if journey_checkpoint.is_some() {
        0
    } else {
        params.expected_start_session_sequence
    };
    if let Ok(Some(checkpoint)) = store
        .tasks()
        .read_headless_run_session_drive_checkpoint(&params.session_id, &drive_id)
    {
        if checkpoint.start_session_sequence != drive_start_session_sequence {
            return error_response(
                id,
                -32602,
                "invalid params: drive_id conflicts with persisted start session sequence",
            );
        }
        if checkpoint.result.journey_route_resume.is_none() {
            if let Some(first_advance) = checkpoint.result.advances.first() {
                let replay_checkpoint = HeadlessRunSessionCheckpoint {
                    session_id: first_advance.session_id.clone(),
                    advance_id: first_advance.advance_id.clone(),
                    session_sequence: first_advance.session_sequence,
                    result: first_advance.clone(),
                };
                if let Err(message) = validate_headless_run_selected_candidate_fetch_replay_target(
                    &store,
                    &replay_checkpoint,
                    params.modepack_selected_candidate_fetch_target.as_ref(),
                ) {
                    return error_response(id, -32602, &message);
                }
                if let Err(message) = validate_headless_run_registry_selection_replay_target(
                    &store,
                    &replay_checkpoint,
                    params.modepack_registry_update_selection_target.as_ref(),
                ) {
                    return error_response(id, -32602, &message);
                }
                if let Err(message) =
                    validate_headless_run_selected_candidate_provenance_verification_replay_target(
                        &store,
                        &replay_checkpoint,
                        params
                            .modepack_selected_candidate_provenance_verification_target
                            .as_ref(),
                    )
                {
                    return error_response(id, -32602, &message);
                }
                if let Err(message) =
                    validate_headless_run_selected_candidate_approval_replay_target(
                        &store,
                        &replay_checkpoint,
                        params.modepack_selected_candidate_approval_target.as_ref(),
                    )
                {
                    return error_response(id, -32602, &message);
                }
                if let Err(message) =
                    validate_headless_run_selected_candidate_replacement_replay_target(
                        &store,
                        &replay_checkpoint,
                        params
                            .modepack_selected_approved_candidate_replacement_target
                            .as_ref(),
                    )
                {
                    return error_response(id, -32602, &message);
                }
                if let Err(message) = validate_headless_run_product_continuation_replay_target(
                    &store,
                    &replay_checkpoint,
                    params.product_continuation_admission_target.as_ref(),
                    params.product_continuation_run_target.as_ref(),
                ) {
                    return error_response(id, -32602, &message);
                }
                if let Err(message) =
                    validate_headless_run_product_continuation_derived_replay_target(
                        &store,
                        &replay_checkpoint,
                        params.product_continuation_derived_target.as_ref(),
                    )
                {
                    return error_response(id, -32602, &message);
                }
            }
        }
        if let Err(message) =
            validate_headless_journey_route_resume_replay(&params, &drive_id, &checkpoint.result)
        {
            return error_response(id, -32602, &message);
        }
        if let Err(message) =
            validate_headless_journey_closure_replay(&params, &drive_id, &checkpoint.result)
        {
            return error_response(id, -32602, &message);
        }
        let mut result = checkpoint.result;
        result.replayed = true;
        if let Some(metadata) = result.journey_route_resume.as_mut() {
            metadata.replayed = true;
        }
        if let Some(metadata) = result.journey_closure.as_mut() {
            metadata.replayed = true;
        }
        if let Some(accepted_completion) = result.accepted_completion.as_mut() {
            accepted_completion.replayed = true;
        }
        if let Some(product_evidence_matrix) = result.product_evidence_matrix.as_mut() {
            product_evidence_matrix.replayed = true;
        }
        if let Some(product_completion_decision) = result.product_completion_decision.as_mut() {
            product_completion_decision.replayed = true;
        }
        if let Some(checkpoint) = journey_checkpoint.as_ref() {
            if let Some(persisted) = result.objective_proposal_candidate.as_ref() {
                match validate_headless_objective_proposal_candidate_replay(
                    &store,
                    checkpoint,
                    &result.session_id,
                    &result.drive_id,
                    persisted,
                ) {
                    Ok(candidate) => result.objective_proposal_candidate = Some(candidate),
                    Err(message) => return error_response(id, -32602, &message),
                }
            }
            result.journey = Some(headless_journey_metadata(checkpoint, &result, true));
        }
        let closure_expected_fingerprint = result
            .journey_closure
            .as_ref()
            .map(|_| result.completion_closure.closure_fingerprint.clone());
        let expected_closure_fingerprint = closure_expected_fingerprint
            .as_deref()
            .or(params.expected_completion_closure_fingerprint.as_deref());
        if result.journey_closure.is_some() {
            match headless_run_completion_finalization_replay_from_checkpoint(
                &store,
                &result,
                expected_closure_fingerprint,
            ) {
                Ok(finalization) => result.completion_finalization = Some(finalization),
                Err(message) => return error_response(id, -32602, &message),
            }
        } else {
            match headless_run_completion_finalization(
                &store,
                &result,
                params.authorize_completion_finalization.unwrap_or(false),
                expected_closure_fingerprint,
            ) {
                Ok(finalization) => result.completion_finalization = finalization,
                Err(message) => return error_response(id, -32602, &message),
            }
        }
        match headless_run_selected_product_gap_closure(
            &store,
            &result,
            params.selected_product_gap_closure.as_ref(),
        ) {
            Ok(Some(closure)) => result.selected_product_gap_closure = Some(closure),
            Ok(None) => {}
            Err(message) => return error_response(id, -32602, &message),
        }
        match headless_run_product_evidence_matrix(
            &store,
            &result,
            params.product_evidence_derivation.as_ref(),
        ) {
            Ok(Some(matrix)) => result.product_evidence_matrix = Some(matrix),
            Ok(None) => {}
            Err(message) => return error_response(id, -32602, &message),
        }
        match headless_run_product_completion_decision(
            &store,
            &result,
            params.product_completion_decision.as_ref(),
        ) {
            Ok(Some(decision)) => {
                result.product_completion_decision = Some(decision);
            }
            Ok(None) => {}
            Err(message) => return error_response(id, -32602, &message),
        }
        if let Some(metadata) = result.journey_route_resume.as_ref() {
            if let Err(error) =
                append_headless_journey_route_resume_event_if_missing(&store, metadata)
            {
                return error_response(id, -32603, &format!("internal error: {error}"));
            }
        }
        if let Some(metadata) = result.journey_closure.as_ref() {
            if let Err(error) = append_headless_journey_closed_event_if_missing(&store, metadata) {
                return error_response(id, -32603, &format!("internal error: {error}"));
            }
        }
        return result_response(id, json!(result));
    }

    let existing_start_checkpoint = match store
        .tasks()
        .read_headless_run_session_checkpoint(&params.session_id)
    {
        Ok(checkpoint) => checkpoint,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    if journey_checkpoint.is_none() && existing_start_checkpoint.is_none() {
        return error_response(
            id,
            -32602,
            "invalid params: existing session checkpoint is required",
        );
    }
    if let Some(start_checkpoint) = existing_start_checkpoint.as_ref() {
        if journey_checkpoint.is_none()
            && start_checkpoint.session_sequence != params.expected_start_session_sequence
        {
            return error_response(
                id,
                -32602,
                "invalid params: expected_start_session_sequence must match the current session checkpoint",
            );
        }
        if params.modepack_selected_candidate_fetch_target.is_some()
            && !start_checkpoint
                .result
                .next_route
                .as_ref()
                .map(|route| {
                    route.kind
                        == HeadlessContinueRouteKind::FetchSelectedModePackCandidateExplicitly
                })
                .unwrap_or(false)
        {
            return error_response(
                id,
                -32602,
                "invalid params: modepack_selected_candidate_fetch_target requires persisted session route fetch_selected_modepack_candidate_explicitly",
            );
        }
        if params
            .modepack_selected_candidate_provenance_verification_target
            .is_some()
            && !headless_run_checkpoint_has_next_route(
                start_checkpoint,
                HeadlessContinueRouteKind::VerifySelectedModePackCandidateProvenanceExplicitly,
            )
        {
            return error_response(
                id,
                -32602,
                "invalid params: modepack_selected_candidate_provenance_verification_target requires persisted session route verify_selected_modepack_candidate_provenance_explicitly",
            );
        }
        if params.modepack_selected_candidate_approval_target.is_some()
            && !headless_run_checkpoint_has_next_route(
                start_checkpoint,
                HeadlessContinueRouteKind::ApproveVerifiedModePackCandidateExplicitly,
            )
        {
            return error_response(
                id,
                -32602,
                "invalid params: modepack_selected_candidate_approval_target requires persisted session route approve_verified_modepack_candidate_explicitly",
            );
        }
        if params
            .modepack_selected_approved_candidate_replacement_target
            .is_some()
            && !headless_run_checkpoint_has_next_route(
                start_checkpoint,
                HeadlessContinueRouteKind::ReplaceActiveWithApprovedModePackCandidateExplicitly,
            )
            && !headless_run_checkpoint_has_next_route_action(
                start_checkpoint,
                HeadlessContinueRouteKind::RefreshProgressOverview,
                "replace_active_with_approved_modepack_candidate_explicitly",
            )
        {
            return error_response(
                id,
                -32602,
                "invalid params: modepack_selected_approved_candidate_replacement_target requires persisted session route replace_active_with_approved_modepack_candidate_explicitly",
            );
        }
        if params.modepack_registry_update_selection_target.is_some()
            && !headless_run_checkpoint_is_progress_overview_boundary(start_checkpoint)
        {
            return error_response(
                id,
                -32602,
                "invalid params: modepack_registry_update_selection_target requires a persisted progress overview route boundary",
            );
        }
        if params.product_continuation_admission_target.is_some()
            && !headless_run_checkpoint_has_next_route(
                start_checkpoint,
                HeadlessContinueRouteKind::AdmitProductContinuationTaskExplicitly,
            )
        {
            return error_response(
                id,
                -32602,
                "invalid params: product_continuation_admission_target requires persisted session route admit_product_continuation_task_explicitly",
            );
        }
        if params.product_continuation_run_target.is_some()
            && !headless_run_checkpoint_has_next_route(
                start_checkpoint,
                HeadlessContinueRouteKind::RunProductContinuationTaskExplicitly,
            )
        {
            return error_response(
                id,
                -32602,
                "invalid params: product_continuation_run_target requires persisted session route run_product_continuation_task_explicitly",
            );
        }
        if params.parent_join_run_target.is_some()
            && !headless_run_checkpoint_has_next_route(
                start_checkpoint,
                HeadlessContinueRouteKind::RunParentTaskExplicitly,
            )
        {
            return error_response(
                id,
                -32602,
                "invalid params: parent_join_run_target requires persisted session route run_parent_task_explicitly",
            );
        }
        if let Some(target) = params.product_continuation_derived_target.as_ref() {
            if let Err(message) = validate_product_continuation_derived_target(target) {
                return error_response(id, -32602, &message);
            }
            if !matches!(
                headless_run_checkpoint_next_route_kind(start_checkpoint),
                Some(HeadlessContinueRouteKind::AdmitProductContinuationTaskExplicitly)
                    | Some(HeadlessContinueRouteKind::RunProductContinuationTaskExplicitly)
            ) {
                return error_response(
                    id,
                    -32602,
                    "invalid params: product_continuation_derived_target requires persisted product-continuation route",
                );
            }
        }
    }
    let preflight_tasks = match store.tasks().list_tasks() {
        Ok(tasks) => tasks,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    if let Err(message) = headless_latest_accepted_completed_task(&store, &preflight_tasks) {
        return error_response(id, -32602, &message);
    }
    let journey_route_resume_plan = match headless_journey_route_resume_plan(
        &store,
        &params,
        &drive_id,
        existing_start_checkpoint.as_ref(),
    ) {
        Ok(plan) => plan,
        Err(message) => return error_response(id, -32602, &message),
    };
    let journey_closure_plan = match headless_journey_closure_plan(
        &store,
        &params,
        &drive_id,
        existing_start_checkpoint.as_ref(),
    ) {
        Ok(plan) => plan,
        Err(message) => return error_response(id, -32602, &message),
    };
    let start_progress = if let Some(checkpoint) = journey_checkpoint.as_ref() {
        checkpoint.start_progress.clone()
    } else {
        let Some(start_checkpoint) = existing_start_checkpoint.as_ref() else {
            return error_response(
                id,
                -32602,
                "invalid params: existing session checkpoint is required",
            );
        };
        let Some(start_progress) = start_checkpoint.result.post_progress.clone() else {
            return error_response(
                id,
                -32603,
                "internal error: persisted session checkpoint is missing post progress",
            );
        };
        start_progress
    };
    if let Some(plan) = journey_closure_plan.as_ref() {
        let post_tasks = match store.tasks().list_tasks() {
            Ok(tasks) => tasks,
            Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
        };
        let post_overview = match task_list_progress_overview(&store, &post_tasks) {
            Ok(progress) => progress,
            Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
        };
        let terminal_completion_evidence =
            match headless_latest_completed_task_completion_evidence(&store, &post_tasks) {
                Ok(evidence) => evidence,
                Err(message) => {
                    return error_response(id, -32603, &format!("internal error: {message}"))
                }
            };
        let status = HeadlessContinueOnceStatus::NoEligibleTask;
        let stop_reason = "journey_closure".to_string();
        let next_action = "complete_headless_journey".to_string();
        let post_progress = Some(HeadlessRunProgressCheckpoint {
            progress_fingerprint: post_overview.source_fingerprint.clone(),
            aggregate_sequence: post_overview.aggregate_sequence,
        });
        let completion_closure = headless_run_completion_closure(
            status.clone(),
            &stop_reason,
            None,
            &next_action,
            &terminal_completion_evidence,
            &post_overview,
            false,
        );
        let result_without_fingerprint = HeadlessRunDriveResult {
            status: status.clone(),
            session_id: params.session_id.clone(),
            drive_id: drive_id.clone(),
            start_session_sequence: drive_start_session_sequence,
            end_session_sequence: drive_start_session_sequence,
            replayed: false,
            max_advances,
            max_steps_per_advance,
            advance_count: 0,
            executed_count: 0,
            replayed_count: 0,
            stop_reason: stop_reason.clone(),
            drive_fingerprint: String::new(),
            terminal_completion_evidence: terminal_completion_evidence.clone(),
            completion_closure: completion_closure.clone(),
            completion_finalization: None,
            accepted_completion: None,
            product_evidence_matrix: None,
            selected_product_gap_closure: None,
            product_completion_decision: None,
            start_progress: start_progress.clone(),
            post_progress: post_progress.clone(),
            next_route: None,
            objective_proposal_candidate: None,
            advances: Vec::new(),
            journey_route_resume: None,
            journey_closure: None,
            journey: None,
            journey_execution: None,
            next_action: next_action.clone(),
        };
        let completion_finalization =
            match headless_run_completion_finalization(
                &store,
                &result_without_fingerprint,
                true,
                Some(&completion_closure.closure_fingerprint),
            ) {
                Ok(Some(finalization)) => Some(finalization),
                Ok(None) => return error_response(
                    id,
                    -32602,
                    "invalid params: journey closure requires committed completion finalization",
                ),
                Err(message) => return error_response(id, -32602, &message),
            };
        let journey_closure_metadata = headless_journey_closure_metadata(
            plan,
            &params.session_id,
            &drive_id,
            completion_finalization.as_ref(),
            &completion_closure,
            false,
        );
        let drive_seed = json!({
            "session_id": params.session_id,
            "drive_id": drive_id,
            "start_session_sequence": drive_start_session_sequence,
            "end_session_sequence": drive_start_session_sequence,
            "max_advances": max_advances,
            "max_steps_per_advance": max_steps_per_advance,
            "advance_count": 0,
            "executed_count": 0,
            "replayed_count": 0,
            "stop_reason": stop_reason,
            "terminal_completion_evidence": terminal_completion_evidence,
            "completion_closure": completion_closure,
            "completion_finalization": completion_finalization,
            "accepted_completion": null,
            "product_evidence_matrix": null,
            "product_completion_decision": null,
            "objective_proposal_candidate": null,
            "journey_closure": journey_closure_metadata,
            "next_action": next_action
        });
        let drive_fingerprint = format!("sha256:{}", hex_sha256(drive_seed.to_string().as_bytes()));
        let mut result = HeadlessRunDriveResult {
            status,
            session_id: params.session_id.clone(),
            drive_id: drive_id.clone(),
            start_session_sequence: drive_start_session_sequence,
            end_session_sequence: drive_start_session_sequence,
            replayed: false,
            max_advances,
            max_steps_per_advance,
            advance_count: 0,
            executed_count: 0,
            replayed_count: 0,
            stop_reason,
            drive_fingerprint,
            terminal_completion_evidence,
            completion_closure,
            completion_finalization,
            accepted_completion: None,
            product_evidence_matrix: None,
            selected_product_gap_closure: None,
            product_completion_decision: None,
            start_progress,
            post_progress,
            next_route: None,
            objective_proposal_candidate: None,
            advances: Vec::new(),
            journey_route_resume: None,
            journey_closure: Some(journey_closure_metadata),
            journey: None,
            journey_execution: None,
            next_action,
        };
        result.journey = Some(headless_journey_metadata(
            &plan.journey_checkpoint,
            &result,
            false,
        ));
        let checkpoint = HeadlessRunSessionDriveCheckpoint {
            session_id: params.session_id,
            drive_id,
            start_session_sequence: drive_start_session_sequence,
            result: result.clone(),
        };
        if let Err(error) = store
            .tasks()
            .write_headless_run_session_drive_checkpoint(&checkpoint)
        {
            return error_response(id, -32603, &format!("internal error: {error}"));
        }
        if let Err(error) = append_headless_run_session_drive_completed_events(&store, &result) {
            return error_response(id, -32603, &format!("internal error: {error}"));
        }
        return result_response(id, json!(result));
    }

    let mut advances = Vec::new();
    let mut stop_reason = "drive_budget_exhausted".to_string();
    let mut next_action = "inspect_progress_overview".to_string();
    let mut next_route = None;
    let mut post_progress = Some(start_progress.clone());
    for index in 0..max_advances {
        let session_sequence = drive_start_session_sequence + u64::from(index) + 1;
        let advance_id = format!("{}.{}", drive_id, session_sequence);
        let mut advance_params = json!({
            "authorize": true,
            "session_id": params.session_id.clone(),
            "advance_id": advance_id,
            "expected_session_sequence": session_sequence,
            "max_steps": max_steps_per_advance,
            "context_budget": params.context_budget.clone()
        });
        if index == 0 {
            if journey_checkpoint.is_some() {
                advance_params["expected_progress_fingerprint"] =
                    json!(start_progress.progress_fingerprint.clone());
                advance_params["expected_aggregate_sequence"] =
                    json!(start_progress.aggregate_sequence);
                if let Some(context) = params
                    .journey_admission
                    .as_ref()
                    .and_then(|admission| admission.objective_context.as_ref())
                {
                    advance_params["selected_index_context"] =
                        json!(context.selected_index_context.clone());
                }
            }
            if let Some(target) = params.modepack_selected_candidate_fetch_target.clone() {
                advance_params["modepack_selected_candidate_fetch_target"] = json!(target);
            }
            if let Some(plan) = journey_route_resume_plan.as_ref() {
                if let Some(target) = plan.derived_fetch_target.clone() {
                    advance_params["modepack_selected_candidate_fetch_target"] = json!(target);
                }
                if let Some(target) = plan.derived_provenance_target.clone() {
                    advance_params["modepack_selected_candidate_provenance_verification_target"] =
                        json!(target);
                }
                if let Some(target) = plan.derived_approval_target.clone() {
                    advance_params["modepack_selected_candidate_approval_target"] = json!(target);
                }
                if let Some(target) = plan.derived_replacement_target.clone() {
                    advance_params["modepack_selected_approved_candidate_replacement_target"] =
                        json!(target);
                }
            }
            if let Some(target) = params.modepack_registry_update_selection_target.clone() {
                advance_params["modepack_registry_update_selection_target"] = json!(target);
            }
            if let Some(target) = params.product_continuation_admission_target.clone() {
                advance_params["product_continuation_admission_target"] = json!(target);
            }
            if let Some(target) = params.product_continuation_run_target.clone() {
                advance_params["product_continuation_run_target"] = json!(target);
            }
            if let Some(target) = params.parent_join_run_target.clone() {
                advance_params["parent_join_run_target"] = json!(target);
            }
            if let Some(target) = params.product_continuation_derived_target.clone() {
                advance_params["product_continuation_derived_target"] = json!(target);
            }
            if let Some(target) = params
                .modepack_selected_candidate_provenance_verification_target
                .clone()
            {
                advance_params["modepack_selected_candidate_provenance_verification_target"] =
                    json!(target);
            }
            if let Some(target) = params.modepack_selected_candidate_approval_target.clone() {
                advance_params["modepack_selected_candidate_approval_target"] = json!(target);
            }
            if let Some(target) = params
                .modepack_selected_approved_candidate_replacement_target
                .clone()
            {
                advance_params["modepack_selected_approved_candidate_replacement_target"] =
                    json!(target);
            }
        } else if let Some(target) = params.product_continuation_derived_target.clone() {
            let latest_checkpoint = match store
                .tasks()
                .read_headless_run_session_checkpoint(&params.session_id)
            {
                Ok(Some(checkpoint)) => checkpoint,
                Ok(None) => {
                    stop_reason = "product_continuation_checkpoint_missing".to_string();
                    next_action = "inspect_progress_overview".to_string();
                    break;
                }
                Err(error) => {
                    return error_response(id, -32603, &format!("internal error: {error}"))
                }
            };
            if matches!(
                headless_run_checkpoint_next_route_kind(&latest_checkpoint),
                Some(HeadlessContinueRouteKind::AdmitProductContinuationTaskExplicitly)
                    | Some(HeadlessContinueRouteKind::RunProductContinuationTaskExplicitly)
            ) {
                advance_params["product_continuation_derived_target"] = json!(target);
            } else {
                stop_reason = "no_eligible_product_continuation_route".to_string();
                next_action = latest_checkpoint.result.next_action;
                next_route = latest_checkpoint.result.next_route;
                post_progress = latest_checkpoint.result.post_progress;
                break;
            }
        }
        let response = handle_headless_run_advance(id.clone(), Some(advance_params));
        let Some(result_value) = response.result else {
            return JsonRpcResponse {
                jsonrpc: JSONRPC_VERSION.to_string(),
                id,
                result: None,
                error: response.error,
            };
        };
        let advance: HeadlessRunAdvanceResult = match serde_json::from_value(result_value) {
            Ok(result) => result,
            Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
        };
        stop_reason = advance.stop_reason.clone();
        next_action = advance.next_action.clone();
        next_route = advance.next_route.clone();
        post_progress = advance.post_progress.clone();
        let product_continuation_sequence = params.product_continuation_derived_target.is_some();
        let should_continue_normal = !product_continuation_sequence
            && advance.status == HeadlessContinueOnceStatus::TaskExecuted
            && advance
                .next_route
                .as_ref()
                .map(|route| route.kind == HeadlessContinueRouteKind::InspectProgressOverview)
                .unwrap_or(false)
            && advance.post_progress.is_some();
        let should_continue_product = product_continuation_sequence
            && advance
                .next_route
                .as_ref()
                .map(|route| {
                    matches!(
                        route.kind,
                        HeadlessContinueRouteKind::AdmitProductContinuationTaskExplicitly
                            | HeadlessContinueRouteKind::RunProductContinuationTaskExplicitly
                    )
                })
                .unwrap_or(false)
            && advance.post_progress.is_some();
        advances.push(advance);
        if !(should_continue_normal || should_continue_product) {
            break;
        }
    }

    let executed_count = advances.iter().map(|advance| advance.executed_count).sum();
    let replayed_count = advances.iter().map(|advance| advance.replayed_count).sum();
    let end_session_sequence = advances
        .last()
        .map(|advance| advance.session_sequence)
        .unwrap_or(drive_start_session_sequence);
    let status = advances
        .last()
        .map(|advance| advance.status.clone())
        .unwrap_or(HeadlessContinueOnceStatus::NoEligibleTask);
    let post_tasks = match store.tasks().list_tasks() {
        Ok(tasks) => tasks,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    let post_overview = match task_list_progress_overview(&store, &post_tasks) {
        Ok(progress) => progress,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    let latest_terminal_completion_evidence =
        match headless_latest_completed_task_completion_evidence(&store, &post_tasks) {
            Ok(evidence) => evidence,
            Err(message) => {
                return error_response(id, -32603, &format!("internal error: {message}"))
            }
        };
    let terminal_completion_evidence = latest_terminal_completion_evidence;
    let accepted_completion = match headless_latest_accepted_completed_task(&store, &post_tasks) {
        Ok(accepted_completion) => accepted_completion,
        Err(message) => return error_response(id, -32602, &message),
    };
    if let (Some(accepted), Some(evidence)) = (
        accepted_completion.as_ref(),
        terminal_completion_evidence.as_ref(),
    ) {
        if accepted.terminal_completion_fingerprint != evidence.completion_result_fingerprint {
            return error_response(
                id,
                -32602,
                "invalid params: accepted completion evidence is stale for latest terminal completion",
            );
        }
    }
    let objective_proposal_candidate = match journey_checkpoint.as_ref() {
        Some(checkpoint) => match headless_objective_proposal_candidate_outcome(
            &store,
            checkpoint,
            &params.session_id,
            &drive_id,
            false,
        ) {
            Ok(candidate) => candidate,
            Err(message) => return error_response(id, -32602, &message),
        },
        None => None,
    };
    if let Some(candidate) = objective_proposal_candidate.as_ref() {
        if candidate.status == "ready_for_review" {
            next_route = Some(objective_proposal_candidate_route(
                candidate,
                &post_overview,
            ));
            next_action = "review_and_authorize_objective_proposal".to_string();
            stop_reason = "objective_proposal_candidate_ready".to_string();
        }
    }
    let completion_closure = headless_run_completion_closure(
        status.clone(),
        &stop_reason,
        next_route.as_ref(),
        &next_action,
        &terminal_completion_evidence,
        &post_overview,
        advances.len() >= usize::from(max_advances),
    );
    let journey_route_resume_metadata = journey_route_resume_plan.as_ref().map(|plan| {
        headless_journey_route_resume_metadata(
            plan,
            &params.session_id,
            &drive_id,
            &advances,
            &next_action,
            false,
        )
    });
    let result_without_fingerprint = HeadlessRunDriveResult {
        status: status.clone(),
        session_id: params.session_id.clone(),
        drive_id: drive_id.clone(),
        start_session_sequence: drive_start_session_sequence,
        end_session_sequence,
        replayed: false,
        max_advances,
        max_steps_per_advance,
        advance_count: advances.len(),
        executed_count,
        replayed_count,
        stop_reason: stop_reason.clone(),
        drive_fingerprint: String::new(),
        terminal_completion_evidence: terminal_completion_evidence.clone(),
        completion_closure: completion_closure.clone(),
        completion_finalization: None,
        accepted_completion: accepted_completion.clone(),
        product_evidence_matrix: None,
        selected_product_gap_closure: None,
        product_completion_decision: None,
        start_progress: start_progress.clone(),
        post_progress: post_progress.clone(),
        next_route: next_route.clone(),
        objective_proposal_candidate: objective_proposal_candidate.clone(),
        advances: advances.clone(),
        journey_route_resume: journey_route_resume_metadata.clone(),
        journey_closure: None,
        journey: None,
        journey_execution: None,
        next_action: next_action.clone(),
    };
    let completion_finalization = match headless_run_completion_finalization(
        &store,
        &result_without_fingerprint,
        params.authorize_completion_finalization.unwrap_or(false),
        params.expected_completion_closure_fingerprint.as_deref(),
    ) {
        Ok(finalization) => finalization,
        Err(message) => return error_response(id, -32602, &message),
    };
    let mut result_for_decision = result_without_fingerprint.clone();
    result_for_decision.completion_finalization = completion_finalization.clone();
    let selected_product_gap_closure = match headless_run_selected_product_gap_closure(
        &store,
        &result_for_decision,
        params.selected_product_gap_closure.as_ref(),
    ) {
        Ok(closure) => closure,
        Err(message) => return error_response(id, -32602, &message),
    };
    result_for_decision.selected_product_gap_closure = selected_product_gap_closure.clone();
    let product_evidence_matrix = match headless_run_product_evidence_matrix(
        &store,
        &result_for_decision,
        params.product_evidence_derivation.as_ref(),
    ) {
        Ok(matrix) => matrix,
        Err(message) => return error_response(id, -32602, &message),
    };
    result_for_decision.product_evidence_matrix = product_evidence_matrix.clone();
    let product_completion_decision = match headless_run_product_completion_decision(
        &store,
        &result_for_decision,
        params.product_completion_decision.as_ref(),
    ) {
        Ok(decision) => decision,
        Err(message) => return error_response(id, -32602, &message),
    };
    let drive_seed = json!({
        "session_id": params.session_id,
        "drive_id": drive_id,
        "start_session_sequence": drive_start_session_sequence,
        "end_session_sequence": end_session_sequence,
        "max_advances": max_advances,
        "max_steps_per_advance": max_steps_per_advance,
        "advance_count": advances.len(),
        "executed_count": executed_count,
        "replayed_count": replayed_count,
        "stop_reason": stop_reason,
        "terminal_completion_evidence": terminal_completion_evidence,
        "completion_closure": completion_closure,
        "completion_finalization": completion_finalization,
        "accepted_completion": accepted_completion,
        "product_evidence_matrix": product_evidence_matrix,
        "selected_product_gap_closure": selected_product_gap_closure,
        "product_completion_decision": product_completion_decision,
        "objective_proposal_candidate": objective_proposal_candidate,
        "journey_route_resume": journey_route_resume_metadata,
        "journey_closure": null,
        "next_action": next_action
    });
    let drive_fingerprint = format!("sha256:{}", hex_sha256(drive_seed.to_string().as_bytes()));
    let mut result = HeadlessRunDriveResult {
        status,
        session_id: params.session_id.clone(),
        drive_id: drive_id.clone(),
        start_session_sequence: drive_start_session_sequence,
        end_session_sequence,
        replayed: false,
        max_advances,
        max_steps_per_advance,
        advance_count: advances.len(),
        executed_count,
        replayed_count,
        stop_reason,
        drive_fingerprint,
        terminal_completion_evidence,
        completion_closure,
        completion_finalization,
        accepted_completion,
        product_evidence_matrix,
        selected_product_gap_closure,
        product_completion_decision,
        start_progress,
        post_progress,
        next_route,
        objective_proposal_candidate,
        advances,
        journey_route_resume: journey_route_resume_metadata,
        journey_closure: None,
        journey: None,
        journey_execution: None,
        next_action,
    };
    if let Some(checkpoint) = journey_checkpoint.as_ref() {
        result.journey = Some(headless_journey_metadata(checkpoint, &result, false));
    }
    let checkpoint = HeadlessRunSessionDriveCheckpoint {
        session_id: params.session_id,
        drive_id,
        start_session_sequence: drive_start_session_sequence,
        result: result.clone(),
    };
    if let Err(error) = store
        .tasks()
        .write_headless_run_session_drive_checkpoint(&checkpoint)
    {
        return error_response(id, -32603, &format!("internal error: {error}"));
    }
    if let Err(error) = append_headless_run_session_drive_completed_events(&store, &result) {
        return error_response(id, -32603, &format!("internal error: {error}"));
    }
    result_response(id, json!(result))
}

pub(super) fn headless_run_completion_finalization(
    store: &BrownieStore,
    result: &HeadlessRunDriveResult,
    authorized: bool,
    expected_closure_fingerprint: Option<&str>,
) -> Result<Option<HeadlessRunCompletionFinalization>, String> {
    if result.completion_closure.status != HeadlessRunCompletionClosureStatus::Complete {
        if authorized {
            return Err(
                "invalid params: completion finalization requires completion_closure.status complete"
                    .to_string(),
            );
        }
        return Ok(None);
    }
    let remaining_headless_route = result.completion_closure.route_candidate_count > 0
        || result
            .next_route
            .as_ref()
            .map(|route| {
                !matches!(
                    route.kind,
                    HeadlessContinueRouteKind::InspectProgressOverview
                        | HeadlessContinueRouteKind::NoEligibleTask
                        | HeadlessContinueRouteKind::RefreshProgressOverview
                )
            })
            .unwrap_or(false);
    if remaining_headless_route {
        if authorized {
            return Err(
                "invalid params: completion finalization requires no remaining headless route"
                    .to_string(),
            );
        }
        return Ok(None);
    }
    let existing = store
        .tasks()
        .read_headless_run_completion_finalization_checkpoint(&result.session_id, &result.drive_id)
        .map_err(|error| format!("failed to read completion finalization checkpoint: {error}"))?;
    if let Some(checkpoint) = existing {
        let owner = headless_run_completion_finalization_owner(store, result)?;
        if checkpoint.closure_fingerprint != result.completion_closure.closure_fingerprint {
            return Err(
                "invalid params: persisted completion finalization conflicts with current closure"
                    .to_string(),
            );
        }
        if let Some(expected) = expected_closure_fingerprint {
            if expected != checkpoint.closure_fingerprint {
                return Err(
                    "invalid params: expected_completion_closure_fingerprint does not match persisted finalization"
                    .to_string(),
                );
            }
        }
        if checkpoint.owner_task_id.as_deref() != Some(owner.task_id.as_str())
            || checkpoint.owner_run_id.as_deref() != Some(owner.run_id.as_str())
            || checkpoint.terminal_completion_fingerprint.as_deref()
                != Some(owner.terminal_completion_fingerprint.as_str())
            || checkpoint.result.owner_task_id.as_deref() != Some(owner.task_id.as_str())
            || checkpoint.result.owner_run_id.as_deref() != Some(owner.run_id.as_str())
            || checkpoint.result.terminal_completion_fingerprint.as_deref()
                != Some(owner.terminal_completion_fingerprint.as_str())
            || checkpoint.result.progress_fingerprint
                != result.completion_closure.progress_fingerprint
            || checkpoint.result.aggregate_sequence != result.completion_closure.aggregate_sequence
            || checkpoint.result.start_session_sequence != result.start_session_sequence
            || checkpoint.result.end_session_sequence != result.end_session_sequence
        {
            return Err(
                "invalid params: persisted completion finalization conflicts with current owner"
                    .to_string(),
            );
        }
        let mut finalization = checkpoint.result;
        append_headless_run_completion_finalized_event(store, &finalization, &owner)
            .map_err(|error| format!("failed to record completion finalization event: {error}"))?;
        finalization.replayed = true;
        return Ok(Some(finalization));
    }

    if !authorized {
        return Ok(None);
    }
    let Some(expected) = expected_closure_fingerprint else {
        return Err(
            "invalid params: expected_completion_closure_fingerprint is required when completion finalization is authorized"
                .to_string(),
        );
    };
    if expected != result.completion_closure.closure_fingerprint {
        return Err(
            "invalid params: expected_completion_closure_fingerprint does not match completion closure"
                .to_string(),
        );
    }
    let owner = headless_run_completion_finalization_owner(store, result)?;
    let seed = json!({
        "version": "headless_completion_finalization_v1",
        "session_id": result.session_id,
        "drive_id": result.drive_id,
        "start_session_sequence": result.start_session_sequence,
        "end_session_sequence": result.end_session_sequence,
        "closure_fingerprint": result.completion_closure.closure_fingerprint,
        "progress_fingerprint": result.completion_closure.progress_fingerprint,
        "aggregate_sequence": result.completion_closure.aggregate_sequence,
        "owner_task_id": owner.task_id,
        "owner_run_id": owner.run_id,
        "terminal_completion_fingerprint": owner.terminal_completion_fingerprint,
        "terminal_task_count": result.completion_closure.terminal_task_count,
        "total_task_count": result.completion_closure.total_task_count
    });
    let finalization = HeadlessRunCompletionFinalization {
        status: "finalized".to_string(),
        session_id: result.session_id.clone(),
        drive_id: result.drive_id.clone(),
        start_session_sequence: result.start_session_sequence,
        end_session_sequence: result.end_session_sequence,
        closure_fingerprint: result.completion_closure.closure_fingerprint.clone(),
        progress_fingerprint: result.completion_closure.progress_fingerprint.clone(),
        aggregate_sequence: result.completion_closure.aggregate_sequence,
        owner_task_id: Some(owner.task_id.clone()),
        owner_run_id: Some(owner.run_id.clone()),
        terminal_completion_fingerprint: Some(owner.terminal_completion_fingerprint.clone()),
        terminal_task_count: result.completion_closure.terminal_task_count,
        total_task_count: result.completion_closure.total_task_count,
        finalization_fingerprint: format!("sha256:{}", hex_sha256(seed.to_string().as_bytes())),
        replayed: false,
        next_action: "close_headless_run".to_string(),
    };
    let checkpoint = HeadlessRunCompletionFinalizationCheckpoint {
        session_id: result.session_id.clone(),
        drive_id: result.drive_id.clone(),
        closure_fingerprint: result.completion_closure.closure_fingerprint.clone(),
        owner_task_id: Some(owner.task_id.clone()),
        owner_run_id: Some(owner.run_id.clone()),
        terminal_completion_fingerprint: Some(owner.terminal_completion_fingerprint.clone()),
        result: finalization.clone(),
    };
    store
        .tasks()
        .write_headless_run_completion_finalization_checkpoint(&checkpoint)
        .map_err(|error| format!("failed to write completion finalization checkpoint: {error}"))?;
    append_headless_run_completion_finalized_event(store, &finalization, &owner)
        .map_err(|error| format!("failed to record completion finalization event: {error}"))?;
    Ok(Some(finalization))
}

fn headless_run_completion_finalization_replay_from_checkpoint(
    store: &BrownieStore,
    result: &HeadlessRunDriveResult,
    expected_closure_fingerprint: Option<&str>,
) -> Result<HeadlessRunCompletionFinalization, String> {
    if result.completion_closure.status != HeadlessRunCompletionClosureStatus::Complete {
        return Err(
            "invalid params: persisted journey closure finalization requires completion_closure.status complete"
                .to_string(),
        );
    }
    let checkpoint = store
        .tasks()
        .read_headless_run_completion_finalization_checkpoint(&result.session_id, &result.drive_id)
        .map_err(|error| format!("failed to read completion finalization checkpoint: {error}"))?
        .ok_or_else(|| {
            "invalid params: persisted journey closure is missing completion finalization checkpoint"
                .to_string()
        })?;
    if checkpoint.closure_fingerprint != result.completion_closure.closure_fingerprint {
        return Err(
            "invalid params: persisted journey closure finalization conflicts with drive closure"
                .to_string(),
        );
    }
    if let Some(expected) = expected_closure_fingerprint {
        if expected != checkpoint.closure_fingerprint {
            return Err(
                "invalid params: expected_completion_closure_fingerprint does not match persisted finalization"
                    .to_string(),
            );
        }
    }
    let Some(owner_task_id) = checkpoint.owner_task_id.as_deref() else {
        return Err(
            "invalid params: persisted completion finalization is missing owner_task_id"
                .to_string(),
        );
    };
    let Some(owner_run_id) = checkpoint.owner_run_id.as_deref() else {
        return Err(
            "invalid params: persisted completion finalization is missing owner_run_id".to_string(),
        );
    };
    let Some(terminal_completion_fingerprint) =
        checkpoint.terminal_completion_fingerprint.as_deref()
    else {
        return Err("invalid params: persisted completion finalization is missing terminal completion fingerprint"
            .to_string());
    };
    if checkpoint.result.owner_task_id.as_deref() != Some(owner_task_id)
        || checkpoint.result.owner_run_id.as_deref() != Some(owner_run_id)
        || checkpoint.result.terminal_completion_fingerprint.as_deref()
            != Some(terminal_completion_fingerprint)
        || checkpoint.result.session_id != result.session_id
        || checkpoint.result.drive_id != result.drive_id
        || checkpoint.result.closure_fingerprint != result.completion_closure.closure_fingerprint
        || checkpoint.result.progress_fingerprint != result.completion_closure.progress_fingerprint
        || checkpoint.result.aggregate_sequence != result.completion_closure.aggregate_sequence
        || checkpoint.result.start_session_sequence != result.start_session_sequence
        || checkpoint.result.end_session_sequence != result.end_session_sequence
        || result
            .completion_closure
            .terminal_completion_fingerprint
            .as_deref()
            != Some(terminal_completion_fingerprint)
    {
        return Err(
            "invalid params: persisted completion finalization conflicts with journey closure drive"
                .to_string(),
        );
    }
    if let Some(result_finalization) = result.completion_finalization.as_ref() {
        if result_finalization.finalization_fingerprint
            != checkpoint.result.finalization_fingerprint
        {
            return Err(
                "invalid params: drive checkpoint finalization conflicts with persisted finalization"
                    .to_string(),
            );
        }
    }
    let owner = HeadlessRunCompletionFinalizationOwner {
        task_id: owner_task_id.to_string(),
        run_id: owner_run_id.to_string(),
        terminal_completion_fingerprint: terminal_completion_fingerprint.to_string(),
    };
    append_headless_run_completion_finalized_event(store, &checkpoint.result, &owner)
        .map_err(|error| format!("failed to record completion finalization event: {error}"))?;
    let mut finalization = checkpoint.result;
    finalization.replayed = true;
    Ok(finalization)
}

#[derive(Debug, Clone)]
pub(super) struct HeadlessRunCompletionFinalizationOwner {
    pub(super) task_id: String,
    pub(super) run_id: String,
    pub(super) terminal_completion_fingerprint: String,
}

fn headless_run_completion_finalization_owner(
    store: &BrownieStore,
    result: &HeadlessRunDriveResult,
) -> Result<HeadlessRunCompletionFinalizationOwner, String> {
    let tasks = store
        .tasks()
        .list_tasks()
        .map_err(|error| format!("invalid params: failed to read current tasks: {error}"))?;
    let progress = task_list_progress_overview(store, &tasks)?;
    if progress.source_fingerprint != result.completion_closure.progress_fingerprint
        || progress.aggregate_sequence != result.completion_closure.aggregate_sequence
    {
        return Err(
            "invalid params: completion finalization requires current progress to match closure"
                .to_string(),
        );
    }
    if progress.root_task_ids.len() != 1 {
        return Err(
            "invalid params: completion finalization requires exactly one root task owner"
                .to_string(),
        );
    }
    let task_id = progress.root_task_ids[0].clone();
    if !progress.terminal_task_ids.iter().any(|id| id == &task_id) {
        return Err(
            "invalid params: completion finalization owner task is not terminal".to_string(),
        );
    }
    let record = tasks
        .iter()
        .find(|record| record.task_id == task_id)
        .ok_or_else(|| {
            "invalid params: completion finalization owner task is missing".to_string()
        })?;
    if record.status != TaskStatus::Completed {
        return Err(
            "invalid params: completion finalization owner task must be completed".to_string(),
        );
    }
    let evidence =
        task_run_completion_evidence_for_record(store, record, false)?.ok_or_else(|| {
            "invalid params: completion finalization owner task is missing completion evidence"
                .to_string()
        })?;
    if evidence.final_state != "Completed" || evidence.task_status != TaskStatus::Completed {
        return Err(
            "invalid params: completion finalization owner evidence must be completed".to_string(),
        );
    }
    let Some(closure_fingerprint) = result
        .completion_closure
        .terminal_completion_fingerprint
        .as_deref()
    else {
        return Err(
            "invalid params: completion finalization requires terminal completion fingerprint"
                .to_string(),
        );
    };
    if evidence.completion_result_fingerprint != closure_fingerprint {
        return Err(
            "invalid params: completion finalization owner evidence does not match closure"
                .to_string(),
        );
    }
    if result
        .terminal_completion_evidence
        .as_ref()
        .is_some_and(|result_evidence| {
            result_evidence.completion_result_fingerprint != evidence.completion_result_fingerprint
                || result_evidence.task_status != evidence.task_status
                || result_evidence.final_state != evidence.final_state
        })
    {
        return Err(
            "invalid params: completion finalization result evidence does not match owner"
                .to_string(),
        );
    }
    Ok(HeadlessRunCompletionFinalizationOwner {
        task_id,
        run_id: record.run_id.clone(),
        terminal_completion_fingerprint: evidence.completion_result_fingerprint,
    })
}

pub(super) fn headless_latest_completed_task_completion_evidence(
    store: &BrownieStore,
    tasks: &[TaskRecord],
) -> Result<Option<TaskRunCompletionEvidence>, String> {
    let Some(record) = tasks
        .iter()
        .filter(|record| record.status == TaskStatus::Completed)
        .max_by_key(|record| record.updated_at.clone())
    else {
        return Ok(None);
    };
    task_run_completion_evidence_for_record(store, record, false)
}

fn headless_latest_accepted_completed_task(
    store: &BrownieStore,
    tasks: &[TaskRecord],
) -> Result<Option<HeadlessRunAcceptedCompletion>, String> {
    let Some(record) = tasks
        .iter()
        .filter(|record| record.status == TaskStatus::Completed)
        .max_by_key(|record| record.updated_at.clone())
    else {
        return Ok(None);
    };
    let events = store
        .tasks()
        .read_ledger_events(&record.run_id)
        .map_err(|error| error.to_string())?;
    let Some(completion_evidence) = task_run_completion_evidence_from_events(&events, record, true)
    else {
        return Ok(None);
    };
    if completion_evidence.final_state != "Completed"
        || completion_evidence.task_status != TaskStatus::Completed
    {
        return Ok(None);
    }
    let verifier_gate_status = match progress_verification_state(&events) {
        ProgressVerificationState::NotRequired => "NotRequired".to_string(),
        ProgressVerificationState::Passed => VERIFICATION_COMPLETION_GATE_STATUS_PASSED.to_string(),
        ProgressVerificationState::Failed
        | ProgressVerificationState::Pending
        | ProgressVerificationState::Unknown => return Ok(None),
    };
    let Some(acceptance) = task_run_completion_acceptance_from_events(
        &events,
        record,
        &completion_evidence,
        &verifier_gate_status,
    )?
    else {
        return Ok(None);
    };
    Ok(Some(HeadlessRunAcceptedCompletion {
        task_id: acceptance.task_id,
        run_id: acceptance.run_id,
        acceptance_id: acceptance.acceptance_id,
        status: acceptance.status,
        terminal_completion_fingerprint: acceptance.terminal_completion_fingerprint,
        acceptance_fingerprint: acceptance.acceptance_fingerprint,
        verifier_gate_status: acceptance.verifier_gate_status,
        replayed: true,
        next_action: "close_headless_run".to_string(),
    }))
}

pub(super) fn headless_run_completion_closure(
    status: HeadlessContinueOnceStatus,
    stop_reason: &str,
    next_route: Option<&HeadlessContinueRoute>,
    next_action: &str,
    terminal_completion_evidence: &Option<brownie_protocol::TaskRunCompletionEvidence>,
    progress_overview: &brownie_protocol::TaskListProgressOverview,
    drive_budget_spent: bool,
) -> HeadlessRunCompletionClosure {
    let route_candidate = progress_overview.headless_route_candidates.first();
    let route_kind = next_route
        .map(|route| route.kind.clone())
        .or_else(|| route_candidate.map(|candidate| candidate.kind.clone()));
    let route_task_id = next_route
        .and_then(|route| route.task_id.clone())
        .or_else(|| route_candidate.and_then(|candidate| candidate.task_id.clone()));
    let route_run_id = next_route
        .and_then(|route| route.run_id.clone())
        .or_else(|| route_candidate.and_then(|candidate| candidate.run_id.clone()));
    let route_candidate_count = progress_overview.headless_route_candidates.len();
    let all_known_tasks_completed = progress_overview.task_count > 0
        && progress_overview.terminal_task_ids.len() == progress_overview.task_count
        && progress_overview.status_counts.running == 0
        && progress_overview.status_counts.created == 0
        && progress_overview.status_counts.queued == 0
        && progress_overview.status_counts.failed == 0
        && progress_overview.status_counts.cancelled == 0
        && progress_overview.status_counts.completed == progress_overview.task_count;
    let routed_explicit_action =
        progress_overview
            .headless_route_candidates
            .iter()
            .any(|candidate| {
                !matches!(
                    candidate.kind,
                    HeadlessContinueRouteKind::InspectProgressOverview
                        | HeadlessContinueRouteKind::NoEligibleTask
                        | HeadlessContinueRouteKind::RefreshProgressOverview
                )
            })
            || next_route
                .map(|route| {
                    !matches!(
                        route.kind,
                        HeadlessContinueRouteKind::InspectProgressOverview
                            | HeadlessContinueRouteKind::NoEligibleTask
                            | HeadlessContinueRouteKind::RefreshProgressOverview
                    )
                })
                .unwrap_or(false);
    let has_valid_terminal_completion_evidence = terminal_completion_evidence
        .as_ref()
        .map(|evidence| {
            evidence.final_state == "Completed" && evidence.task_status == TaskStatus::Completed
        })
        .unwrap_or(false);
    let no_remaining_headless_route = route_candidate_count == 0
        && next_route
            .map(|route| {
                matches!(
                    route.kind,
                    HeadlessContinueRouteKind::InspectProgressOverview
                        | HeadlessContinueRouteKind::NoEligibleTask
                        | HeadlessContinueRouteKind::RefreshProgressOverview
                )
            })
            .unwrap_or(true);
    let closure_status = if status == HeadlessContinueOnceStatus::StaleProgress {
        HeadlessRunCompletionClosureStatus::StaleNoProgress
    } else if status == HeadlessContinueOnceStatus::TaskInProgress
        || progress_overview.status_counts.running > 0
    {
        HeadlessRunCompletionClosureStatus::TaskInProgress
    } else if routed_explicit_action {
        HeadlessRunCompletionClosureStatus::RoutedExplicitAction
    } else if all_known_tasks_completed
        && no_remaining_headless_route
        && has_valid_terminal_completion_evidence
    {
        HeadlessRunCompletionClosureStatus::Complete
    } else if drive_budget_spent
        && matches!(status, HeadlessContinueOnceStatus::TaskExecuted)
        && !all_known_tasks_completed
    {
        HeadlessRunCompletionClosureStatus::BudgetExhausted
    } else {
        match status {
            HeadlessContinueOnceStatus::StaleProgress => {
                HeadlessRunCompletionClosureStatus::StaleNoProgress
            }
            HeadlessContinueOnceStatus::TaskInProgress => {
                HeadlessRunCompletionClosureStatus::TaskInProgress
            }
            HeadlessContinueOnceStatus::NoEligibleTask => {
                HeadlessRunCompletionClosureStatus::NoEligibleTask
            }
            HeadlessContinueOnceStatus::TaskExecuted => {
                HeadlessRunCompletionClosureStatus::UnknownNonterminal
            }
        }
    };
    let terminal_completion_fingerprint = terminal_completion_evidence
        .as_ref()
        .map(|evidence| evidence.completion_result_fingerprint.clone());
    let seed = json!({
        "status": closure_status,
        "stop_reason": stop_reason,
        "terminal_task_count": progress_overview.terminal_task_ids.len(),
        "total_task_count": progress_overview.task_count,
        "runnable_task_count": progress_overview.runnable_task_ids.len(),
        "blocked_task_count": progress_overview.blocked_task_ids.len(),
        "route_candidate_count": route_candidate_count,
        "progress_fingerprint": progress_overview.source_fingerprint,
        "aggregate_sequence": progress_overview.aggregate_sequence,
        "route_kind": route_kind.clone(),
        "route_task_id": route_task_id.clone(),
        "route_run_id": route_run_id.clone(),
        "terminal_completion_fingerprint": terminal_completion_fingerprint.clone(),
        "next_action": next_action
    });
    let closure_fingerprint = format!("sha256:{}", hex_sha256(seed.to_string().as_bytes()));
    HeadlessRunCompletionClosure {
        status: closure_status,
        stop_reason: stop_reason.to_string(),
        terminal_task_count: progress_overview.terminal_task_ids.len(),
        total_task_count: progress_overview.task_count,
        runnable_task_count: progress_overview.runnable_task_ids.len(),
        blocked_task_count: progress_overview.blocked_task_ids.len(),
        route_candidate_count,
        progress_fingerprint: progress_overview.source_fingerprint.clone(),
        aggregate_sequence: progress_overview.aggregate_sequence,
        route_kind,
        route_task_id,
        route_run_id,
        terminal_completion_fingerprint,
        next_action: next_action.to_string(),
        closure_fingerprint,
    }
}
