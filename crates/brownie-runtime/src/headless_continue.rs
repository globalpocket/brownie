use super::*;

pub(super) fn handle_headless_continue_once(
    id: Value,
    params: Option<Value>,
) -> JsonRpcResponse<Value> {
    let params: HeadlessContinueOnceParams = match parse_params(params) {
        Ok(params) => params,
        Err(message) => return error_response(id, -32602, &message),
    };
    if !params.authorize {
        return error_response(id, -32602, "invalid params: authorize must be true");
    }
    if params.expected_progress_fingerprint.trim().is_empty() {
        return error_response(
            id,
            -32602,
            "invalid params: expected_progress_fingerprint must not be empty",
        );
    }
    if let Some(continuation_id) = params.continuation_id.as_deref() {
        if !is_valid_headless_continuation_id(continuation_id) {
            return error_response(
                id,
                -32602,
                "invalid params: continuation_id must be 1-96 ASCII alphanumeric, dash, underscore, colon, or dot characters",
            );
        }
    }
    if let Some(scope) = params.continuation_scope.as_ref() {
        if let Err(message) = validate_headless_continue_scope(scope) {
            return error_response(id, -32602, message);
        }
        if params.max_steps.unwrap_or(1) > 1 {
            return error_response(
                id,
                -32602,
                "invalid params: continuation_scope cannot be combined with max_steps greater than 1",
            );
        }
    }
    if params.verification_recovery_retry_source.is_some() && params.max_steps.unwrap_or(1) > 1 {
        return error_response(
            id,
            -32602,
            "invalid params: verification_recovery_retry_source cannot be combined with max_steps greater than 1",
        );
    }
    if params.llm_provider_failure_retry_source.is_some() && params.max_steps.unwrap_or(1) > 1 {
        return error_response(
            id,
            -32602,
            "invalid params: llm_provider_failure_retry_source cannot be combined with max_steps greater than 1",
        );
    }
    if params.product_continuation_admission_target.is_some() && params.max_steps.unwrap_or(1) > 1 {
        return error_response(
            id,
            -32602,
            "invalid params: product_continuation_admission_target cannot be combined with max_steps greater than 1",
        );
    }
    if params.product_continuation_run_target.is_some() && params.max_steps.unwrap_or(1) > 1 {
        return error_response(
            id,
            -32602,
            "invalid params: product_continuation_run_target cannot be combined with max_steps greater than 1",
        );
    }
    if params.product_loop_stop_recovery_target.is_some() && params.max_steps.unwrap_or(1) > 1 {
        return error_response(
            id,
            -32602,
            "invalid params: product_loop_stop_recovery_target cannot be combined with max_steps greater than 1",
        );
    }
    if params.llm_provider_failure_retry_run_target.is_some() && params.max_steps.unwrap_or(1) > 1 {
        return error_response(
            id,
            -32602,
            "invalid params: llm_provider_failure_retry_run_target cannot be combined with max_steps greater than 1",
        );
    }
    if params.parent_join_run_target.is_some() && params.max_steps.unwrap_or(1) > 1 {
        return error_response(
            id,
            -32602,
            "invalid params: parent_join_run_target cannot be combined with max_steps greater than 1",
        );
    }
    if params
        .objective_proposal_authorization_preflight_target
        .is_some()
        && params.max_steps.unwrap_or(1) > 1
    {
        return error_response(
            id,
            -32602,
            "invalid params: objective_proposal_authorization_preflight_target cannot be combined with max_steps greater than 1",
        );
    }
    if params.objective_proposal_apply_target.is_some() && params.max_steps.unwrap_or(1) > 1 {
        return error_response(
            id,
            -32602,
            "invalid params: objective_proposal_apply_target cannot be combined with max_steps greater than 1",
        );
    }
    if params.objective_apply_verification_target.is_some() && params.max_steps.unwrap_or(1) > 1 {
        return error_response(
            id,
            -32602,
            "invalid params: objective_apply_verification_target cannot be combined with max_steps greater than 1",
        );
    }
    if params.objective_completion_acceptance_target.is_some() && params.max_steps.unwrap_or(1) > 1
    {
        return error_response(
            id,
            -32602,
            "invalid params: objective_completion_acceptance_target cannot be combined with max_steps greater than 1",
        );
    }
    if params.modepack_registry_update_selection_target.is_some()
        && params.max_steps.unwrap_or(1) > 1
    {
        return error_response(
            id,
            -32602,
            "invalid params: modepack_registry_update_selection_target cannot be combined with max_steps greater than 1",
        );
    }
    if params.modepack_selected_candidate_fetch_target.is_some()
        && params.max_steps.unwrap_or(1) > 1
    {
        return error_response(
            id,
            -32602,
            "invalid params: modepack_selected_candidate_fetch_target cannot be combined with max_steps greater than 1",
        );
    }
    if params
        .modepack_selected_candidate_provenance_verification_target
        .is_some()
        && params.max_steps.unwrap_or(1) > 1
    {
        return error_response(
            id,
            -32602,
            "invalid params: modepack_selected_candidate_provenance_verification_target cannot be combined with max_steps greater than 1",
        );
    }
    if params.modepack_selected_candidate_approval_target.is_some()
        && params.max_steps.unwrap_or(1) > 1
    {
        return error_response(
            id,
            -32602,
            "invalid params: modepack_selected_candidate_approval_target cannot be combined with max_steps greater than 1",
        );
    }
    if params
        .modepack_selected_approved_candidate_replacement_target
        .is_some()
        && params.max_steps.unwrap_or(1) > 1
    {
        return error_response(
            id,
            -32602,
            "invalid params: modepack_selected_approved_candidate_replacement_target cannot be combined with max_steps greater than 1",
        );
    }
    if params.modepack_selected_active_rollback_target.is_some()
        && params.max_steps.unwrap_or(1) > 1
    {
        return error_response(
            id,
            -32602,
            "invalid params: modepack_selected_active_rollback_target cannot be combined with max_steps greater than 1",
        );
    }
    if params.selected_index_context.is_some() && params.max_steps.unwrap_or(1) > 1 {
        return error_response(
            id,
            -32602,
            "invalid params: selected_index_context cannot be combined with max_steps greater than 1",
        );
    }
    if params.verification_recovery_source.is_some() && params.max_steps.unwrap_or(1) > 1 {
        return error_response(
            id,
            -32602,
            "invalid params: verification_recovery_source cannot be combined with max_steps greater than 1",
        );
    }
    if params.verification_recovery_run_target.is_some() && params.max_steps.unwrap_or(1) > 1 {
        return error_response(
            id,
            -32602,
            "invalid params: verification_recovery_run_target cannot be combined with max_steps greater than 1",
        );
    }
    if params.verification_recovery_context_read.is_some() && params.max_steps.unwrap_or(1) > 1 {
        return error_response(
            id,
            -32602,
            "invalid params: verification_recovery_context_read cannot be combined with max_steps greater than 1",
        );
    }
    if params.patch_apply_recovery_source.is_some() && params.max_steps.unwrap_or(1) > 1 {
        return error_response(
            id,
            -32602,
            "invalid params: patch_apply_recovery_source cannot be combined with max_steps greater than 1",
        );
    }
    if params.patch_apply_recovery_run_target.is_some() && params.max_steps.unwrap_or(1) > 1 {
        return error_response(
            id,
            -32602,
            "invalid params: patch_apply_recovery_run_target cannot be combined with max_steps greater than 1",
        );
    }
    if params.patch_apply_recovery_apply_target.is_some() && params.max_steps.unwrap_or(1) > 1 {
        return error_response(
            id,
            -32602,
            "invalid params: patch_apply_recovery_apply_target cannot be combined with max_steps greater than 1",
        );
    }
    if params.verification_recovery_apply_target.is_some() && params.max_steps.unwrap_or(1) > 1 {
        return error_response(
            id,
            -32602,
            "invalid params: verification_recovery_apply_target cannot be combined with max_steps greater than 1",
        );
    }
    if params.verification_recovery_retry_run_target.is_some() && params.max_steps.unwrap_or(1) > 1
    {
        return error_response(
            id,
            -32602,
            "invalid params: verification_recovery_retry_run_target cannot be combined with max_steps greater than 1",
        );
    }
    if params.verification_recovery_retry_source.is_some()
        && params.verification_recovery_retry_run_target.is_some()
    {
        return error_response(
            id,
            -32602,
            "invalid params: verification_recovery_retry_source and verification_recovery_retry_run_target cannot be combined",
        );
    }
    if params.llm_provider_failure_retry_source.is_some()
        && params.llm_provider_failure_retry_run_target.is_some()
    {
        return error_response(
            id,
            -32602,
            "invalid params: llm_provider_failure_retry_source and llm_provider_failure_retry_run_target cannot be combined",
        );
    }
    if params.llm_provider_failure_retry_source.is_some()
        && (params.verification_recovery_source.is_some()
            || params.verification_recovery_retry_source.is_some()
            || params.verification_recovery_run_target.is_some()
            || params.patch_apply_recovery_source.is_some()
            || params.patch_apply_recovery_run_target.is_some()
            || params.patch_apply_recovery_apply_target.is_some()
            || params.verification_recovery_apply_target.is_some()
            || params.verification_recovery_retry_run_target.is_some())
    {
        return error_response(
            id,
            -32602,
            "invalid params: llm_provider_failure_retry_source cannot be combined with verification recovery fields",
        );
    }
    if params.llm_provider_failure_retry_run_target.is_some()
        && (params.verification_recovery_source.is_some()
            || params.verification_recovery_retry_source.is_some()
            || params.verification_recovery_run_target.is_some()
            || params.patch_apply_recovery_source.is_some()
            || params.patch_apply_recovery_run_target.is_some()
            || params.patch_apply_recovery_apply_target.is_some()
            || params.verification_recovery_apply_target.is_some()
            || params.verification_recovery_retry_run_target.is_some())
    {
        return error_response(
            id,
            -32602,
            "invalid params: llm_provider_failure_retry_run_target cannot be combined with verification recovery fields",
        );
    }
    if params.verification_recovery_source.is_some()
        && params.verification_recovery_run_target.is_some()
    {
        return error_response(
            id,
            -32602,
            "invalid params: verification_recovery_source and verification_recovery_run_target cannot be combined",
        );
    }
    if params.verification_recovery_context_read.is_some()
        && params.verification_recovery_run_target.is_none()
    {
        return error_response(
            id,
            -32602,
            "invalid params: verification_recovery_context_read requires verification_recovery_run_target",
        );
    }
    if params.verification_recovery_context_read.is_some()
        && (params.verification_recovery_source.is_some()
            || params.verification_recovery_retry_source.is_some()
            || params.verification_recovery_retry_run_target.is_some()
            || params.patch_apply_recovery_source.is_some()
            || params.patch_apply_recovery_run_target.is_some()
            || params.patch_apply_recovery_apply_target.is_some()
            || params.verification_recovery_apply_target.is_some()
            || params.llm_provider_failure_retry_source.is_some()
            || params.llm_provider_failure_retry_run_target.is_some())
    {
        return error_response(
            id,
            -32602,
            "invalid params: verification_recovery_context_read can only be combined with verification_recovery_run_target",
        );
    }
    if params.patch_apply_recovery_source.is_some()
        && params.patch_apply_recovery_run_target.is_some()
    {
        return error_response(
            id,
            -32602,
            "invalid params: patch_apply_recovery_source and patch_apply_recovery_run_target cannot be combined",
        );
    }
    if params.patch_apply_recovery_source.is_some()
        && params.patch_apply_recovery_apply_target.is_some()
    {
        return error_response(
            id,
            -32602,
            "invalid params: patch_apply_recovery_source and patch_apply_recovery_apply_target cannot be combined",
        );
    }
    if params.patch_apply_recovery_run_target.is_some()
        && params.patch_apply_recovery_apply_target.is_some()
    {
        return error_response(
            id,
            -32602,
            "invalid params: patch_apply_recovery_run_target and patch_apply_recovery_apply_target cannot be combined",
        );
    }
    if params.patch_apply_recovery_source.is_some()
        && (params.verification_recovery_source.is_some()
            || params.verification_recovery_run_target.is_some()
            || params.verification_recovery_apply_target.is_some()
            || params.verification_recovery_retry_source.is_some()
            || params.verification_recovery_retry_run_target.is_some()
            || params.patch_apply_recovery_apply_target.is_some()
            || params.llm_provider_failure_retry_source.is_some()
            || params.llm_provider_failure_retry_run_target.is_some())
    {
        return error_response(
            id,
            -32602,
            "invalid params: patch_apply_recovery_source cannot be combined with other recovery fields",
        );
    }
    if params.patch_apply_recovery_run_target.is_some()
        && (params.verification_recovery_source.is_some()
            || params.verification_recovery_run_target.is_some()
            || params.verification_recovery_apply_target.is_some()
            || params.verification_recovery_retry_source.is_some()
            || params.verification_recovery_retry_run_target.is_some()
            || params.patch_apply_recovery_apply_target.is_some()
            || params.llm_provider_failure_retry_source.is_some()
            || params.llm_provider_failure_retry_run_target.is_some())
    {
        return error_response(
            id,
            -32602,
            "invalid params: patch_apply_recovery_run_target cannot be combined with other recovery fields",
        );
    }
    if params.patch_apply_recovery_apply_target.is_some()
        && (params.verification_recovery_source.is_some()
            || params.verification_recovery_run_target.is_some()
            || params.verification_recovery_apply_target.is_some()
            || params.verification_recovery_retry_source.is_some()
            || params.verification_recovery_retry_run_target.is_some()
            || params.llm_provider_failure_retry_source.is_some()
            || params.llm_provider_failure_retry_run_target.is_some())
    {
        return error_response(
            id,
            -32602,
            "invalid params: patch_apply_recovery_apply_target cannot be combined with other recovery fields",
        );
    }
    if params.verification_recovery_apply_target.is_some()
        && (params.verification_recovery_source.is_some()
            || params.verification_recovery_run_target.is_some()
            || params.verification_recovery_retry_source.is_some()
            || params.verification_recovery_retry_run_target.is_some())
    {
        return error_response(
            id,
            -32602,
            "invalid params: verification_recovery_apply_target cannot be combined with other verification recovery fields",
        );
    }
    if params.verification_recovery_run_target.is_some()
        && (params.verification_recovery_retry_source.is_some()
            || params.verification_recovery_retry_run_target.is_some())
    {
        return error_response(
            id,
            -32602,
            "invalid params: verification_recovery_run_target cannot be combined with verification retry fields",
        );
    }
    if params.verification_recovery_source.is_some()
        && (params.verification_recovery_retry_source.is_some()
            || params.verification_recovery_retry_run_target.is_some())
    {
        return error_response(
            id,
            -32602,
            "invalid params: verification_recovery_source cannot be combined with verification retry fields",
        );
    }
    if params.parent_join_run_target.is_some()
        && (params.verification_recovery_source.is_some()
            || params.verification_recovery_goal.is_some()
            || params.verification_recovery_mode_id.is_some()
            || params.verification_recovery_retry_source.is_some()
            || params.verification_recovery_retry_goal.is_some()
            || params.verification_recovery_retry_mode_id.is_some()
            || params.llm_provider_failure_retry_source.is_some()
            || params.llm_provider_failure_retry_goal.is_some()
            || params.llm_provider_failure_retry_mode_id.is_some()
            || params.verification_recovery_run_target.is_some()
            || params.verification_recovery_context_read.is_some()
            || params.patch_apply_recovery_source.is_some()
            || params.patch_apply_recovery_goal.is_some()
            || params.patch_apply_recovery_mode_id.is_some()
            || params.patch_apply_recovery_run_target.is_some()
            || params.patch_apply_recovery_apply_target.is_some()
            || params.verification_recovery_apply_target.is_some()
            || params.verification_recovery_retry_run_target.is_some()
            || params.llm_provider_failure_retry_run_target.is_some()
            || params
                .objective_proposal_authorization_preflight_target
                .is_some()
            || params.objective_apply_verification_target.is_some()
            || params.objective_completion_acceptance_target.is_some()
            || params.modepack_registry_update_selection_target.is_some()
            || params.modepack_selected_candidate_fetch_target.is_some()
            || params
                .modepack_selected_candidate_provenance_verification_target
                .is_some()
            || params.modepack_selected_candidate_approval_target.is_some()
            || params
                .modepack_selected_approved_candidate_replacement_target
                .is_some()
            || params.modepack_selected_active_rollback_target.is_some())
    {
        return error_response(
            id,
            -32602,
            "invalid params: parent_join_run_target cannot be combined with recovery, apply, retry, provider, or context-read fields",
        );
    }
    if params
        .objective_proposal_authorization_preflight_target
        .is_some()
        && (params.verification_recovery_source.is_some()
            || params.verification_recovery_goal.is_some()
            || params.verification_recovery_mode_id.is_some()
            || params.verification_recovery_retry_source.is_some()
            || params.verification_recovery_retry_goal.is_some()
            || params.verification_recovery_retry_mode_id.is_some()
            || params.llm_provider_failure_retry_source.is_some()
            || params.llm_provider_failure_retry_goal.is_some()
            || params.llm_provider_failure_retry_mode_id.is_some()
            || params.verification_recovery_run_target.is_some()
            || params.verification_recovery_context_read.is_some()
            || params.patch_apply_recovery_source.is_some()
            || params.patch_apply_recovery_goal.is_some()
            || params.patch_apply_recovery_mode_id.is_some()
            || params.patch_apply_recovery_run_target.is_some()
            || params.patch_apply_recovery_apply_target.is_some()
            || params.verification_recovery_apply_target.is_some()
            || params.verification_recovery_retry_run_target.is_some()
            || params.llm_provider_failure_retry_run_target.is_some()
            || params.parent_join_run_target.is_some()
            || params.modepack_registry_update_selection_target.is_some()
            || params.modepack_selected_candidate_fetch_target.is_some()
            || params
                .modepack_selected_candidate_provenance_verification_target
                .is_some()
            || params.modepack_selected_candidate_approval_target.is_some()
            || params
                .modepack_selected_approved_candidate_replacement_target
                .is_some()
            || params.modepack_selected_active_rollback_target.is_some()
            || params.context_budget.is_some()
            || params.selected_index_context.is_some())
    {
        return error_response(
            id,
            -32602,
            "invalid params: objective_proposal_authorization_preflight_target cannot be combined with task, recovery, apply, retry, provider, context-read, parent-join, modepack, or index-context fields",
        );
    }
    if params.modepack_selected_candidate_fetch_target.is_some()
        && (params.verification_recovery_source.is_some()
            || params.verification_recovery_goal.is_some()
            || params.verification_recovery_mode_id.is_some()
            || params.verification_recovery_retry_source.is_some()
            || params.verification_recovery_retry_goal.is_some()
            || params.verification_recovery_retry_mode_id.is_some()
            || params.llm_provider_failure_retry_source.is_some()
            || params.llm_provider_failure_retry_goal.is_some()
            || params.llm_provider_failure_retry_mode_id.is_some()
            || params.verification_recovery_run_target.is_some()
            || params.verification_recovery_context_read.is_some()
            || params.patch_apply_recovery_source.is_some()
            || params.patch_apply_recovery_goal.is_some()
            || params.patch_apply_recovery_mode_id.is_some()
            || params.patch_apply_recovery_run_target.is_some()
            || params.patch_apply_recovery_apply_target.is_some()
            || params.verification_recovery_apply_target.is_some()
            || params.verification_recovery_retry_run_target.is_some()
            || params.llm_provider_failure_retry_run_target.is_some()
            || params.parent_join_run_target.is_some()
            || params.modepack_registry_update_selection_target.is_some()
            || params
                .modepack_selected_candidate_provenance_verification_target
                .is_some()
            || params.modepack_selected_candidate_approval_target.is_some()
            || params
                .modepack_selected_approved_candidate_replacement_target
                .is_some())
    {
        return error_response(
            id,
            -32602,
            "invalid params: modepack_selected_candidate_fetch_target cannot be combined with task, recovery, apply, retry, provider, context-read, or parent-join fields",
        );
    }
    if params.modepack_registry_update_selection_target.is_some()
        && (params.verification_recovery_source.is_some()
            || params.verification_recovery_goal.is_some()
            || params.verification_recovery_mode_id.is_some()
            || params.verification_recovery_retry_source.is_some()
            || params.verification_recovery_retry_goal.is_some()
            || params.verification_recovery_retry_mode_id.is_some()
            || params.llm_provider_failure_retry_source.is_some()
            || params.llm_provider_failure_retry_goal.is_some()
            || params.llm_provider_failure_retry_mode_id.is_some()
            || params.verification_recovery_run_target.is_some()
            || params.verification_recovery_context_read.is_some()
            || params.patch_apply_recovery_source.is_some()
            || params.patch_apply_recovery_goal.is_some()
            || params.patch_apply_recovery_mode_id.is_some()
            || params.patch_apply_recovery_run_target.is_some()
            || params.patch_apply_recovery_apply_target.is_some()
            || params.verification_recovery_apply_target.is_some()
            || params.verification_recovery_retry_run_target.is_some()
            || params.llm_provider_failure_retry_run_target.is_some()
            || params.parent_join_run_target.is_some()
            || params.modepack_selected_candidate_fetch_target.is_some()
            || params
                .modepack_selected_candidate_provenance_verification_target
                .is_some()
            || params.modepack_selected_candidate_approval_target.is_some()
            || params
                .modepack_selected_approved_candidate_replacement_target
                .is_some()
            || params.modepack_selected_active_rollback_target.is_some())
    {
        return error_response(
            id,
            -32602,
            "invalid params: modepack_registry_update_selection_target cannot be combined with task, recovery, apply, retry, provider, context-read, parent-join, or selected-candidate fields",
        );
    }
    if params
        .modepack_selected_candidate_provenance_verification_target
        .is_some()
        && (params.verification_recovery_source.is_some()
            || params.verification_recovery_goal.is_some()
            || params.verification_recovery_mode_id.is_some()
            || params.verification_recovery_retry_source.is_some()
            || params.verification_recovery_retry_goal.is_some()
            || params.verification_recovery_retry_mode_id.is_some()
            || params.llm_provider_failure_retry_source.is_some()
            || params.llm_provider_failure_retry_goal.is_some()
            || params.llm_provider_failure_retry_mode_id.is_some()
            || params.verification_recovery_run_target.is_some()
            || params.verification_recovery_context_read.is_some()
            || params.patch_apply_recovery_source.is_some()
            || params.patch_apply_recovery_goal.is_some()
            || params.patch_apply_recovery_mode_id.is_some()
            || params.patch_apply_recovery_run_target.is_some()
            || params.patch_apply_recovery_apply_target.is_some()
            || params.verification_recovery_apply_target.is_some()
            || params.verification_recovery_retry_run_target.is_some()
            || params.llm_provider_failure_retry_run_target.is_some()
            || params.parent_join_run_target.is_some()
            || params.modepack_registry_update_selection_target.is_some()
            || params.modepack_selected_candidate_fetch_target.is_some()
            || params.modepack_selected_candidate_approval_target.is_some()
            || params
                .modepack_selected_approved_candidate_replacement_target
                .is_some())
    {
        return error_response(
            id,
            -32602,
            "invalid params: modepack_selected_candidate_provenance_verification_target cannot be combined with task, recovery, apply, retry, provider, context-read, parent-join, or selected-candidate fetch fields",
        );
    }
    if params.modepack_selected_candidate_approval_target.is_some()
        && (params.verification_recovery_source.is_some()
            || params.verification_recovery_goal.is_some()
            || params.verification_recovery_mode_id.is_some()
            || params.verification_recovery_retry_source.is_some()
            || params.verification_recovery_retry_goal.is_some()
            || params.verification_recovery_retry_mode_id.is_some()
            || params.llm_provider_failure_retry_source.is_some()
            || params.llm_provider_failure_retry_goal.is_some()
            || params.llm_provider_failure_retry_mode_id.is_some()
            || params.verification_recovery_run_target.is_some()
            || params.verification_recovery_context_read.is_some()
            || params.patch_apply_recovery_source.is_some()
            || params.patch_apply_recovery_goal.is_some()
            || params.patch_apply_recovery_mode_id.is_some()
            || params.patch_apply_recovery_run_target.is_some()
            || params.patch_apply_recovery_apply_target.is_some()
            || params.verification_recovery_apply_target.is_some()
            || params.verification_recovery_retry_run_target.is_some()
            || params.llm_provider_failure_retry_run_target.is_some()
            || params.parent_join_run_target.is_some()
            || params.modepack_selected_candidate_fetch_target.is_some()
            || params
                .modepack_selected_candidate_provenance_verification_target
                .is_some()
            || params
                .modepack_selected_approved_candidate_replacement_target
                .is_some())
    {
        return error_response(
            id,
            -32602,
            "invalid params: modepack_selected_candidate_approval_target cannot be combined with task, recovery, apply, retry, provider, context-read, parent-join, fetch, or provenance verification fields",
        );
    }
    if params
        .modepack_selected_approved_candidate_replacement_target
        .is_some()
        && (params.verification_recovery_source.is_some()
            || params.verification_recovery_goal.is_some()
            || params.verification_recovery_mode_id.is_some()
            || params.verification_recovery_retry_source.is_some()
            || params.verification_recovery_retry_goal.is_some()
            || params.verification_recovery_retry_mode_id.is_some()
            || params.llm_provider_failure_retry_source.is_some()
            || params.llm_provider_failure_retry_goal.is_some()
            || params.llm_provider_failure_retry_mode_id.is_some()
            || params.verification_recovery_run_target.is_some()
            || params.verification_recovery_context_read.is_some()
            || params.patch_apply_recovery_source.is_some()
            || params.patch_apply_recovery_goal.is_some()
            || params.patch_apply_recovery_mode_id.is_some()
            || params.patch_apply_recovery_run_target.is_some()
            || params.patch_apply_recovery_apply_target.is_some()
            || params.verification_recovery_apply_target.is_some()
            || params.verification_recovery_retry_run_target.is_some()
            || params.llm_provider_failure_retry_run_target.is_some()
            || params.parent_join_run_target.is_some()
            || params.modepack_selected_candidate_fetch_target.is_some()
            || params
                .modepack_selected_candidate_provenance_verification_target
                .is_some()
            || params.modepack_selected_candidate_approval_target.is_some())
    {
        return error_response(
            id,
            -32602,
            "invalid params: modepack_selected_approved_candidate_replacement_target cannot be combined with task, recovery, apply, retry, provider, context-read, parent-join, fetch, provenance verification, or approval fields",
        );
    }
    if params.modepack_selected_active_rollback_target.is_some()
        && (params.verification_recovery_source.is_some()
            || params.verification_recovery_goal.is_some()
            || params.verification_recovery_mode_id.is_some()
            || params.verification_recovery_retry_source.is_some()
            || params.verification_recovery_retry_goal.is_some()
            || params.verification_recovery_retry_mode_id.is_some()
            || params.llm_provider_failure_retry_source.is_some()
            || params.llm_provider_failure_retry_goal.is_some()
            || params.llm_provider_failure_retry_mode_id.is_some()
            || params.verification_recovery_run_target.is_some()
            || params.verification_recovery_context_read.is_some()
            || params.patch_apply_recovery_source.is_some()
            || params.patch_apply_recovery_goal.is_some()
            || params.patch_apply_recovery_mode_id.is_some()
            || params.patch_apply_recovery_run_target.is_some()
            || params.patch_apply_recovery_apply_target.is_some()
            || params.verification_recovery_apply_target.is_some()
            || params.verification_recovery_retry_run_target.is_some()
            || params.llm_provider_failure_retry_run_target.is_some()
            || params.parent_join_run_target.is_some()
            || params.modepack_selected_candidate_fetch_target.is_some()
            || params
                .modepack_selected_candidate_provenance_verification_target
                .is_some()
            || params.modepack_selected_candidate_approval_target.is_some()
            || params
                .modepack_selected_approved_candidate_replacement_target
                .is_some())
    {
        return error_response(
            id,
            -32602,
            "invalid params: modepack_selected_active_rollback_target cannot be combined with task, recovery, apply, retry, provider, context-read, parent-join, fetch, provenance verification, approval, or replacement fields",
        );
    }
    if params.objective_proposal_apply_target.is_some()
        && (params.context_budget.is_some()
            || params.selected_index_context.is_some()
            || params.verification_recovery_source.is_some()
            || params.verification_recovery_goal.is_some()
            || params.verification_recovery_mode_id.is_some()
            || params.verification_recovery_retry_source.is_some()
            || params.verification_recovery_retry_goal.is_some()
            || params.verification_recovery_retry_mode_id.is_some()
            || params.llm_provider_failure_retry_source.is_some()
            || params.llm_provider_failure_retry_goal.is_some()
            || params.llm_provider_failure_retry_mode_id.is_some()
            || params.verification_recovery_run_target.is_some()
            || params.verification_recovery_context_read.is_some()
            || params.patch_apply_recovery_source.is_some()
            || params.patch_apply_recovery_goal.is_some()
            || params.patch_apply_recovery_mode_id.is_some()
            || params.patch_apply_recovery_run_target.is_some()
            || params.patch_apply_recovery_apply_target.is_some()
            || params.verification_recovery_apply_target.is_some()
            || params.verification_recovery_retry_run_target.is_some()
            || params.llm_provider_failure_retry_run_target.is_some()
            || params.parent_join_run_target.is_some()
            || params
                .objective_proposal_authorization_preflight_target
                .is_some()
            || params.modepack_registry_update_selection_target.is_some()
            || params.modepack_selected_candidate_fetch_target.is_some()
            || params
                .modepack_selected_candidate_provenance_verification_target
                .is_some()
            || params.modepack_selected_candidate_approval_target.is_some()
            || params
                .modepack_selected_approved_candidate_replacement_target
                .is_some()
            || params.modepack_selected_active_rollback_target.is_some())
    {
        return error_response(
            id,
            -32602,
            "invalid params: objective_proposal_apply_target cannot be combined with task, recovery, retry, provider, context-read, parent-join, modepack, or objective preflight fields",
        );
    }
    if params.objective_apply_verification_target.is_some()
        && (params.context_budget.is_some()
            || params.selected_index_context.is_some()
            || params.verification_recovery_source.is_some()
            || params.verification_recovery_goal.is_some()
            || params.verification_recovery_mode_id.is_some()
            || params.verification_recovery_retry_source.is_some()
            || params.verification_recovery_retry_goal.is_some()
            || params.verification_recovery_retry_mode_id.is_some()
            || params.llm_provider_failure_retry_source.is_some()
            || params.llm_provider_failure_retry_goal.is_some()
            || params.llm_provider_failure_retry_mode_id.is_some()
            || params.verification_recovery_run_target.is_some()
            || params.verification_recovery_context_read.is_some()
            || params.patch_apply_recovery_source.is_some()
            || params.patch_apply_recovery_goal.is_some()
            || params.patch_apply_recovery_mode_id.is_some()
            || params.patch_apply_recovery_run_target.is_some()
            || params.patch_apply_recovery_apply_target.is_some()
            || params.verification_recovery_apply_target.is_some()
            || params.verification_recovery_retry_run_target.is_some()
            || params.llm_provider_failure_retry_run_target.is_some()
            || params.parent_join_run_target.is_some()
            || params
                .objective_proposal_authorization_preflight_target
                .is_some()
            || params.objective_proposal_apply_target.is_some()
            || params.objective_completion_acceptance_target.is_some()
            || params.modepack_registry_update_selection_target.is_some()
            || params.modepack_selected_candidate_fetch_target.is_some()
            || params
                .modepack_selected_candidate_provenance_verification_target
                .is_some()
            || params.modepack_selected_candidate_approval_target.is_some()
            || params
                .modepack_selected_approved_candidate_replacement_target
                .is_some()
            || params.modepack_selected_active_rollback_target.is_some())
    {
        return error_response(
            id,
            -32602,
            "invalid params: objective_apply_verification_target cannot be combined with task, recovery, retry, provider, context-read, parent-join, modepack, objective preflight, or objective apply fields",
        );
    }
    if params.objective_completion_acceptance_target.is_some()
        && (params.context_budget.is_some()
            || params.selected_index_context.is_some()
            || params.verification_recovery_source.is_some()
            || params.verification_recovery_goal.is_some()
            || params.verification_recovery_mode_id.is_some()
            || params.verification_recovery_retry_source.is_some()
            || params.verification_recovery_retry_goal.is_some()
            || params.verification_recovery_retry_mode_id.is_some()
            || params.llm_provider_failure_retry_source.is_some()
            || params.llm_provider_failure_retry_goal.is_some()
            || params.llm_provider_failure_retry_mode_id.is_some()
            || params.verification_recovery_run_target.is_some()
            || params.verification_recovery_context_read.is_some()
            || params.patch_apply_recovery_source.is_some()
            || params.patch_apply_recovery_goal.is_some()
            || params.patch_apply_recovery_mode_id.is_some()
            || params.patch_apply_recovery_run_target.is_some()
            || params.patch_apply_recovery_apply_target.is_some()
            || params.verification_recovery_apply_target.is_some()
            || params.verification_recovery_retry_run_target.is_some()
            || params.llm_provider_failure_retry_run_target.is_some()
            || params.parent_join_run_target.is_some()
            || params
                .objective_proposal_authorization_preflight_target
                .is_some()
            || params.objective_proposal_apply_target.is_some()
            || params.objective_apply_verification_target.is_some()
            || params.modepack_registry_update_selection_target.is_some()
            || params.modepack_selected_candidate_fetch_target.is_some()
            || params
                .modepack_selected_candidate_provenance_verification_target
                .is_some()
            || params.modepack_selected_candidate_approval_target.is_some()
            || params
                .modepack_selected_approved_candidate_replacement_target
                .is_some()
            || params.modepack_selected_active_rollback_target.is_some())
    {
        return error_response(
            id,
            -32602,
            "invalid params: objective_completion_acceptance_target cannot be combined with task, recovery, retry, provider, context-read, parent-join, modepack, objective preflight, objective apply, or objective verification fields",
        );
    }
    if params.product_continuation_admission_target.is_some()
        && (params.context_budget.is_some()
            || params.selected_index_context.is_some()
            || params.product_continuation_run_target.is_some()
            || params.verification_recovery_source.is_some()
            || params.verification_recovery_goal.is_some()
            || params.verification_recovery_mode_id.is_some()
            || params.verification_recovery_retry_source.is_some()
            || params.verification_recovery_retry_goal.is_some()
            || params.verification_recovery_retry_mode_id.is_some()
            || params.llm_provider_failure_retry_source.is_some()
            || params.llm_provider_failure_retry_goal.is_some()
            || params.llm_provider_failure_retry_mode_id.is_some()
            || params.verification_recovery_run_target.is_some()
            || params.verification_recovery_context_read.is_some()
            || params.patch_apply_recovery_source.is_some()
            || params.patch_apply_recovery_goal.is_some()
            || params.patch_apply_recovery_mode_id.is_some()
            || params.patch_apply_recovery_run_target.is_some()
            || params.patch_apply_recovery_apply_target.is_some()
            || params.verification_recovery_apply_target.is_some()
            || params.verification_recovery_retry_run_target.is_some()
            || params.llm_provider_failure_retry_run_target.is_some()
            || params.parent_join_run_target.is_some()
            || params
                .objective_proposal_authorization_preflight_target
                .is_some()
            || params.objective_proposal_apply_target.is_some()
            || params.objective_apply_verification_target.is_some()
            || params.objective_completion_acceptance_target.is_some()
            || params.modepack_registry_update_selection_target.is_some()
            || params.modepack_selected_candidate_fetch_target.is_some()
            || params
                .modepack_selected_candidate_provenance_verification_target
                .is_some()
            || params.modepack_selected_candidate_approval_target.is_some()
            || params
                .modepack_selected_approved_candidate_replacement_target
                .is_some()
            || params.modepack_selected_active_rollback_target.is_some())
    {
        return error_response(
            id,
            -32602,
            "invalid params: product_continuation_admission_target cannot be combined with task, recovery, retry, provider, context-read, parent-join, modepack, objective, or index-context fields",
        );
    }
    if params.product_continuation_run_target.is_some()
        && (params.context_budget.is_some()
            || params.selected_index_context.is_some()
            || params.product_continuation_admission_target.is_some()
            || params.product_loop_stop_recovery_target.is_some()
            || params.verification_recovery_source.is_some()
            || params.verification_recovery_goal.is_some()
            || params.verification_recovery_mode_id.is_some()
            || params.verification_recovery_retry_source.is_some()
            || params.verification_recovery_retry_goal.is_some()
            || params.verification_recovery_retry_mode_id.is_some()
            || params.llm_provider_failure_retry_source.is_some()
            || params.llm_provider_failure_retry_goal.is_some()
            || params.llm_provider_failure_retry_mode_id.is_some()
            || params.llm_provider_failure_retry_run_target.is_some()
            || params.verification_recovery_run_target.is_some()
            || params.verification_recovery_context_read.is_some()
            || params.patch_apply_recovery_source.is_some()
            || params.patch_apply_recovery_goal.is_some()
            || params.patch_apply_recovery_mode_id.is_some()
            || params.patch_apply_recovery_run_target.is_some()
            || params.patch_apply_recovery_apply_target.is_some()
            || params.verification_recovery_apply_target.is_some()
            || params.verification_recovery_retry_run_target.is_some()
            || params.parent_join_run_target.is_some()
            || params
                .objective_proposal_authorization_preflight_target
                .is_some()
            || params.objective_proposal_apply_target.is_some()
            || params.objective_apply_verification_target.is_some()
            || params.objective_completion_acceptance_target.is_some()
            || params.modepack_registry_update_selection_target.is_some()
            || params.modepack_selected_candidate_fetch_target.is_some()
            || params
                .modepack_selected_candidate_provenance_verification_target
                .is_some()
            || params.modepack_selected_candidate_approval_target.is_some()
            || params
                .modepack_selected_approved_candidate_replacement_target
                .is_some()
            || params.modepack_selected_active_rollback_target.is_some())
    {
        return error_response(
            id,
            -32602,
            "invalid params: product_continuation_run_target cannot be combined with task, recovery, retry, provider, context-read, parent-join, modepack, objective, admission, or index-context fields",
        );
    }
    if params.product_loop_stop_recovery_target.is_some()
        && (params.context_budget.is_some()
            || params.selected_index_context.is_some()
            || params.product_continuation_admission_target.is_some()
            || params.product_continuation_run_target.is_some()
            || params.verification_recovery_source.is_some()
            || params.verification_recovery_goal.is_some()
            || params.verification_recovery_mode_id.is_some()
            || params.verification_recovery_retry_source.is_some()
            || params.verification_recovery_retry_goal.is_some()
            || params.verification_recovery_retry_mode_id.is_some()
            || params.llm_provider_failure_retry_source.is_some()
            || params.llm_provider_failure_retry_goal.is_some()
            || params.llm_provider_failure_retry_mode_id.is_some()
            || params.verification_recovery_run_target.is_some()
            || params.verification_recovery_context_read.is_some()
            || params.patch_apply_recovery_source.is_some()
            || params.patch_apply_recovery_goal.is_some()
            || params.patch_apply_recovery_mode_id.is_some()
            || params.patch_apply_recovery_run_target.is_some()
            || params.patch_apply_recovery_apply_target.is_some()
            || params.verification_recovery_apply_target.is_some()
            || params.verification_recovery_retry_run_target.is_some()
            || params.llm_provider_failure_retry_run_target.is_some()
            || params.parent_join_run_target.is_some()
            || params
                .objective_proposal_authorization_preflight_target
                .is_some()
            || params.objective_proposal_apply_target.is_some()
            || params.objective_apply_verification_target.is_some()
            || params.objective_completion_acceptance_target.is_some()
            || params.modepack_registry_update_selection_target.is_some()
            || params.modepack_selected_candidate_fetch_target.is_some()
            || params
                .modepack_selected_candidate_provenance_verification_target
                .is_some()
            || params.modepack_selected_candidate_approval_target.is_some()
            || params
                .modepack_selected_approved_candidate_replacement_target
                .is_some()
            || params.modepack_selected_active_rollback_target.is_some())
    {
        return error_response(
            id,
            -32602,
            "invalid params: product_loop_stop_recovery_target cannot be combined with task, recovery, retry, provider, context-read, parent-join, modepack, objective, product-continuation, or index-context fields",
        );
    }
    if let Err(message) = validate_headless_context_budget_bounds(params.context_budget.as_ref()) {
        return error_response(id, -32602, message);
    }
    if let Some(max_steps) = params.max_steps {
        if max_steps == 0 || max_steps > HEADLESS_CONTINUE_MAX_BUDGET_STEPS {
            return error_response(
                id,
                -32602,
                "invalid params: max_steps must be between 1 and 3",
            );
        }
        if max_steps > 1 {
            let Some(continuation_id) = params.continuation_id.as_deref() else {
                return error_response(
                    id,
                    -32602,
                    "invalid params: continuation_id is required when max_steps is greater than 1",
                );
            };
            if continuation_id.len() > 80 {
                return error_response(
                    id,
                    -32602,
                    "invalid params: continuation_id must be at most 80 characters when max_steps is greater than 1",
                );
            }
            return handle_headless_continue_budget(id, params);
        }
    }
    if params.context_budget.is_some()
        && (params.verification_recovery_source.is_some()
            || params.verification_recovery_retry_source.is_some()
            || params.llm_provider_failure_retry_source.is_some()
            || params.llm_provider_failure_retry_run_target.is_some()
            || params.product_continuation_run_target.is_some()
            || params.verification_recovery_run_target.is_some()
            || params.verification_recovery_context_read.is_some()
            || params.patch_apply_recovery_source.is_some()
            || params.patch_apply_recovery_run_target.is_some()
            || params.patch_apply_recovery_apply_target.is_some()
            || params.verification_recovery_apply_target.is_some()
            || params.verification_recovery_retry_run_target.is_some()
            || params.parent_join_run_target.is_some()
            || params.modepack_selected_candidate_fetch_target.is_some()
            || params
                .modepack_selected_candidate_provenance_verification_target
                .is_some()
            || params.modepack_selected_candidate_approval_target.is_some()
            || params
                .modepack_selected_approved_candidate_replacement_target
                .is_some())
    {
        return error_response(
            id,
            -32602,
            "invalid params: context_budget is supported only for normal headless task continuation",
        );
    }
    if params.continuation_scope.is_some() && headless_continue_once_has_non_task_target(&params) {
        return error_response(
            id,
            -32602,
            "invalid params: continuation_scope is supported only for normal headless task continuation",
        );
    }
    if params.selected_index_context.is_some()
        && (params.verification_recovery_source.is_some()
            || params.verification_recovery_retry_source.is_some()
            || params.llm_provider_failure_retry_source.is_some()
            || params.llm_provider_failure_retry_run_target.is_some()
            || params.product_continuation_run_target.is_some()
            || params.verification_recovery_run_target.is_some()
            || params.verification_recovery_context_read.is_some()
            || params.patch_apply_recovery_source.is_some()
            || params.patch_apply_recovery_run_target.is_some()
            || params.patch_apply_recovery_apply_target.is_some()
            || params.verification_recovery_apply_target.is_some()
            || params.verification_recovery_retry_run_target.is_some()
            || params.parent_join_run_target.is_some()
            || params.modepack_registry_update_selection_target.is_some()
            || params.modepack_selected_candidate_fetch_target.is_some()
            || params
                .modepack_selected_candidate_provenance_verification_target
                .is_some()
            || params.modepack_selected_candidate_approval_target.is_some()
            || params
                .modepack_selected_approved_candidate_replacement_target
                .is_some()
            || params.modepack_selected_active_rollback_target.is_some())
    {
        return error_response(
            id,
            -32602,
            "invalid params: selected_index_context is supported only for normal headless task continuation",
        );
    }

    let store = match BrownieStore::from_env_or_cwd() {
        Ok(store) => store,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    let tasks = match store.tasks().list_tasks() {
        Ok(tasks) => tasks,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    let progress_overview = match task_list_progress_overview(&store, &tasks) {
        Ok(progress_overview) => progress_overview,
        Err(message) => return error_response(id, -32603, &format!("internal error: {message}")),
    };

    if let Some(continuation_id) = params.continuation_id.as_deref() {
        if params.product_continuation_admission_target.is_some() {
            match headless_product_continuation_admission_decision_for_replay(
                &store,
                &tasks,
                continuation_id,
            ) {
                Ok(Some(decision)) => {
                    return headless_continue_product_continuation_admission_replay_result(
                        id,
                        &progress_overview,
                        params,
                        decision,
                    );
                }
                Ok(None) => {}
                Err(message) => {
                    return error_response(id, -32603, &format!("internal error: {message}"))
                }
            }
        }
        if params.product_loop_stop_recovery_target.is_some() {
            match headless_product_loop_stop_recovery_decision_for_replay(
                &store,
                &tasks,
                continuation_id,
            ) {
                Ok(Some(decision)) => {
                    return headless_product_loop_stop_recovery_replay_result(
                        id,
                        &progress_overview,
                        params,
                        decision,
                    );
                }
                Ok(None) => {}
                Err(message) => {
                    return error_response(id, -32603, &format!("internal error: {message}"))
                }
            }
        }
        if params.product_continuation_run_target.is_some() {
            match headless_product_continuation_run_decision_for_replay(
                &store,
                &tasks,
                continuation_id,
            ) {
                Ok(Some((decision, request_fingerprint))) => {
                    return headless_continue_product_continuation_run_replay_result(
                        id,
                        &store,
                        &progress_overview,
                        params,
                        decision,
                        request_fingerprint,
                    );
                }
                Ok(None) => {}
                Err(message) => {
                    return error_response(id, -32603, &format!("internal error: {message}"))
                }
            }
        }
        if params.modepack_registry_update_selection_target.is_some() {
            match store.read_headless_modepack_registry_update_selection_checkpoint(continuation_id)
            {
                Ok(Some(checkpoint)) => {
                    return headless_continue_modepack_registry_update_selection_replay_result(
                        id,
                        &progress_overview,
                        params,
                        checkpoint,
                    );
                }
                Ok(None) => {}
                Err(error) => {
                    return error_response(id, -32603, &format!("internal error: {error}"))
                }
            }
        }
        if params.modepack_selected_candidate_fetch_target.is_some() {
            match store.read_headless_modepack_selected_candidate_fetch_checkpoint(continuation_id)
            {
                Ok(Some(checkpoint)) => {
                    return headless_continue_modepack_selected_candidate_fetch_replay_result(
                        id,
                        &progress_overview,
                        params,
                        checkpoint,
                    );
                }
                Ok(None) => {}
                Err(error) => {
                    return error_response(id, -32603, &format!("internal error: {error}"))
                }
            }
        }
        if params
            .modepack_selected_candidate_provenance_verification_target
            .is_some()
        {
            match store
                .read_headless_modepack_selected_candidate_provenance_verification_checkpoint(
                    continuation_id,
                ) {
                Ok(Some(checkpoint)) => {
                    return headless_continue_modepack_selected_candidate_provenance_verification_replay_result(
                        id,
                        &progress_overview,
                        params,
                        checkpoint,
                    );
                }
                Ok(None) => {}
                Err(error) => {
                    return error_response(id, -32603, &format!("internal error: {error}"))
                }
            }
        }
        if params.modepack_selected_candidate_approval_target.is_some() {
            match store
                .read_headless_modepack_selected_candidate_approval_checkpoint(continuation_id)
            {
                Ok(Some(checkpoint)) => {
                    return headless_continue_modepack_selected_candidate_approval_replay_result(
                        id,
                        &progress_overview,
                        params,
                        checkpoint,
                    );
                }
                Ok(None) => {}
                Err(error) => {
                    return error_response(id, -32603, &format!("internal error: {error}"))
                }
            }
        }
        if params
            .objective_proposal_authorization_preflight_target
            .is_some()
        {
            match store.read_headless_objective_proposal_authorization_preflight_checkpoint(
                continuation_id,
            ) {
                Ok(Some(checkpoint)) => {
                    return headless_continue_objective_proposal_authorization_preflight_replay_result(
                        id,
                        &progress_overview,
                        params,
                        checkpoint,
                    );
                }
                Ok(None) => {}
                Err(error) => {
                    return error_response(id, -32603, &format!("internal error: {error}"))
                }
            }
        }
        if params.objective_proposal_apply_target.is_some() {
            match store.read_headless_objective_proposal_apply_checkpoint(continuation_id) {
                Ok(Some(checkpoint)) => {
                    return headless_continue_objective_proposal_apply_replay_result(
                        id,
                        &progress_overview,
                        params,
                        checkpoint,
                    );
                }
                Ok(None) => {}
                Err(error) => {
                    return error_response(id, -32603, &format!("internal error: {error}"))
                }
            }
        }
        if params.objective_apply_verification_target.is_some() {
            match store.read_headless_objective_apply_verification_checkpoint(continuation_id) {
                Ok(Some(checkpoint)) => {
                    return headless_continue_objective_apply_verification_replay_result(
                        id,
                        &progress_overview,
                        params,
                        checkpoint,
                    );
                }
                Ok(None) => {}
                Err(error) => {
                    return error_response(id, -32603, &format!("internal error: {error}"))
                }
            }
        }
        if params.objective_completion_acceptance_target.is_some() {
            match store.read_headless_objective_completion_acceptance_checkpoint(continuation_id) {
                Ok(Some(checkpoint)) => {
                    return headless_continue_objective_completion_acceptance_replay_result(
                        id,
                        &progress_overview,
                        params,
                        checkpoint,
                    );
                }
                Ok(None) => {}
                Err(error) => {
                    return error_response(id, -32603, &format!("internal error: {error}"))
                }
            }
        }
        if params
            .modepack_selected_approved_candidate_replacement_target
            .is_some()
        {
            match store
                .read_headless_modepack_selected_candidate_replacement_checkpoint(continuation_id)
            {
                Ok(Some(checkpoint)) => {
                    return headless_continue_modepack_selected_candidate_replacement_replay_result(
                        id,
                        &progress_overview,
                        params,
                        checkpoint,
                    );
                }
                Ok(None) => {}
                Err(error) => {
                    return error_response(id, -32603, &format!("internal error: {error}"))
                }
            }
        }
        if params.modepack_selected_active_rollback_target.is_some() {
            match store.read_headless_modepack_selected_active_rollback_checkpoint(continuation_id)
            {
                Ok(Some(checkpoint)) => {
                    return headless_continue_modepack_selected_active_rollback_replay_result(
                        id,
                        &progress_overview,
                        params,
                        checkpoint,
                    );
                }
                Ok(None) => {}
                Err(error) => {
                    return error_response(id, -32603, &format!("internal error: {error}"))
                }
            }
        }
        match headless_continuation_decision_for_replay(&store, &tasks, continuation_id) {
            Ok(Some(decision)) => {
                return headless_continue_once_replay_result(
                    id,
                    &store,
                    &progress_overview,
                    params,
                    decision,
                );
            }
            Ok(None) => {}
            Err(message) => {
                return error_response(id, -32603, &format!("internal error: {message}"))
            }
        }
    }

    if progress_overview.source_fingerprint != params.expected_progress_fingerprint
        || progress_overview.aggregate_sequence != params.expected_aggregate_sequence
    {
        let next_route = headless_continue_route_refresh(
            "Current progress differs from the caller's expected fingerprint; refresh before continuing.",
            &progress_overview,
        );
        return result_response(
            id,
            json!(HeadlessContinueOnceResult {
                status: HeadlessContinueOnceStatus::StaleProgress,
                decision_id: None,
                continuation_id: params.continuation_id,
                selected_task_id: None,
                selected_run_id: None,
                candidate_count: 0,
                expected_progress_fingerprint: params.expected_progress_fingerprint,
                expected_aggregate_sequence: params.expected_aggregate_sequence,
                current_progress_fingerprint: progress_overview.source_fingerprint,
                current_aggregate_sequence: progress_overview.aggregate_sequence,
                post_progress_fingerprint: None,
                post_aggregate_sequence: None,
                stale: true,
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
                next_action: "refresh_progress_overview".to_string(),
            }),
        );
    }

    if params.modepack_registry_update_selection_target.is_some() {
        return handle_headless_continue_modepack_registry_update_selection(
            id,
            &store,
            &progress_overview,
            params,
        );
    }
    if params.modepack_selected_candidate_fetch_target.is_some() {
        return handle_headless_continue_modepack_selected_candidate_fetch(
            id,
            &store,
            &progress_overview,
            params,
        );
    }
    if params
        .modepack_selected_candidate_provenance_verification_target
        .is_some()
    {
        return handle_headless_continue_modepack_selected_candidate_provenance_verification(
            id,
            &store,
            &progress_overview,
            params,
        );
    }
    if params.modepack_selected_candidate_approval_target.is_some() {
        return handle_headless_continue_modepack_selected_candidate_approval(
            id,
            &store,
            &progress_overview,
            params,
        );
    }
    if params
        .objective_proposal_authorization_preflight_target
        .is_some()
    {
        return handle_headless_continue_objective_proposal_authorization_preflight(
            id,
            &store,
            &progress_overview,
            params,
        );
    }
    if params.objective_proposal_apply_target.is_some() {
        return handle_headless_continue_objective_proposal_apply(
            id,
            &store,
            &progress_overview,
            params,
        );
    }
    if params.objective_apply_verification_target.is_some() {
        return handle_headless_continue_objective_apply_verification(
            id,
            &store,
            &progress_overview,
            params,
        );
    }
    if params.objective_completion_acceptance_target.is_some() {
        return handle_headless_continue_objective_completion_acceptance(
            id,
            &store,
            &progress_overview,
            params,
        );
    }
    if params.product_continuation_admission_target.is_some() {
        return handle_headless_continue_product_continuation_admission(
            id,
            &store,
            &progress_overview,
            params,
        );
    }
    if params.product_loop_stop_recovery_target.is_some() {
        return handle_headless_continue_product_loop_stop_recovery(
            id,
            &store,
            &progress_overview,
            params,
        );
    }
    if params.product_continuation_run_target.is_some() {
        return handle_headless_continue_product_continuation_run(
            id,
            &store,
            &progress_overview,
            params,
        );
    }
    if params
        .modepack_selected_approved_candidate_replacement_target
        .is_some()
    {
        return handle_headless_continue_modepack_selected_candidate_replacement(
            id,
            &store,
            &progress_overview,
            params,
        );
    }
    if params.modepack_selected_active_rollback_target.is_some() {
        return handle_headless_continue_modepack_selected_active_rollback(
            id,
            &store,
            &progress_overview,
            params,
        );
    }

    if params.verification_recovery_source.is_some() {
        return handle_headless_continue_verification_recovery_admission(
            id,
            &store,
            &progress_overview,
            params,
        );
    }
    if params.patch_apply_recovery_source.is_some() {
        return handle_headless_continue_patch_apply_recovery_admission(
            id,
            &store,
            &progress_overview,
            params,
        );
    }
    if params.verification_recovery_retry_source.is_some() {
        return handle_headless_continue_verification_recovery_retry_admission(
            id,
            &store,
            &progress_overview,
            params,
        );
    }
    if params.llm_provider_failure_retry_source.is_some() {
        return handle_headless_continue_llm_provider_failure_retry_admission(
            id,
            &store,
            &progress_overview,
            params,
        );
    }
    if params.verification_recovery_run_target.is_some() {
        return handle_headless_continue_verification_recovery_run(
            id,
            &store,
            &progress_overview,
            params,
        );
    }
    if params.patch_apply_recovery_run_target.is_some() {
        return handle_headless_continue_patch_apply_recovery_run(
            id,
            &store,
            &progress_overview,
            params,
        );
    }
    if params.patch_apply_recovery_apply_target.is_some() {
        return handle_headless_continue_patch_apply_recovery_apply(
            id,
            &store,
            &progress_overview,
            params,
        );
    }
    if params.verification_recovery_apply_target.is_some() {
        return handle_headless_continue_verification_recovery_apply(
            id,
            &store,
            &progress_overview,
            params,
        );
    }
    if params.verification_recovery_retry_run_target.is_some() {
        return handle_headless_continue_verification_recovery_retry_run(
            id,
            &store,
            &progress_overview,
            params,
        );
    }
    if params.llm_provider_failure_retry_run_target.is_some() {
        return handle_headless_continue_llm_provider_failure_retry_run(
            id,
            &store,
            &progress_overview,
            params,
        );
    }
    if params.parent_join_run_target.is_some() {
        return handle_headless_continue_parent_join_run(id, &store, &progress_overview, params);
    }

    let mut candidate_task_ids = headless_continue_once_candidate_task_ids(&progress_overview);
    if let Some(scope) = params.continuation_scope.as_ref() {
        candidate_task_ids = match scoped_headless_continue_once_candidate_task_ids(
            &store,
            &tasks,
            &candidate_task_ids,
            scope,
        ) {
            Ok(candidate_task_ids) => candidate_task_ids,
            Err(message) => return error_response(id, -32602, &message),
        };
    }
    candidate_task_ids.sort();
    let candidate_count = candidate_task_ids.len();
    let Some(selected_task_id) = candidate_task_ids.first().cloned() else {
        let next_route = headless_continue_route_no_eligible(
            "No created or queued task is currently eligible for headless continuation.",
            &progress_overview,
        );
        return result_response(
            id,
            json!(HeadlessContinueOnceResult {
                status: HeadlessContinueOnceStatus::NoEligibleTask,
                decision_id: None,
                continuation_id: params.continuation_id,
                selected_task_id: None,
                selected_run_id: None,
                candidate_count,
                expected_progress_fingerprint: params.expected_progress_fingerprint,
                expected_aggregate_sequence: params.expected_aggregate_sequence,
                current_progress_fingerprint: progress_overview.source_fingerprint,
                current_aggregate_sequence: progress_overview.aggregate_sequence,
                post_progress_fingerprint: None,
                post_aggregate_sequence: None,
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
                next_action: "inspect_progress_overview".to_string(),
            }),
        );
    };

    let selected_record = match store.tasks().get_task(&selected_task_id) {
        Ok(Some(record)) => record,
        Ok(None) => return error_response(id, -32603, "internal error: selected task not found"),
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    if !matches!(
        selected_record.status,
        TaskStatus::Created | TaskStatus::Queued
    ) {
        let next_route = headless_continue_route_refresh(
            "Selected task was no longer runnable after candidate selection; refresh progress.",
            &progress_overview,
        );
        return result_response(
            id,
            json!(HeadlessContinueOnceResult {
                status: HeadlessContinueOnceStatus::StaleProgress,
                decision_id: None,
                continuation_id: params.continuation_id,
                selected_task_id: None,
                selected_run_id: None,
                candidate_count,
                expected_progress_fingerprint: params.expected_progress_fingerprint,
                expected_aggregate_sequence: params.expected_aggregate_sequence,
                current_progress_fingerprint: progress_overview.source_fingerprint,
                current_aggregate_sequence: progress_overview.aggregate_sequence,
                post_progress_fingerprint: None,
                post_aggregate_sequence: None,
                stale: true,
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
                next_action: "refresh_progress_overview".to_string(),
            }),
        );
    }
    if let Err(rejection) =
        validate_task_run_context_budget(&selected_record, params.context_budget.as_ref())
    {
        return match rejection {
            TaskRunAdmissionRejection::InvalidParams(message) => {
                error_response(id, -32602, message)
            }
            TaskRunAdmissionRejection::Internal(message) => {
                error_response(id, -32603, &format!("internal error: {message}"))
            }
        };
    }

    let decision_id = format!("headless_decision_{}", uuid::Uuid::new_v4().simple());
    let policy_version = "headless_continue_once_v1";
    if let Err(error) = store.tasks().append_task_event_with_payload(
        &selected_record,
        LedgerEventKind::HeadlessContinuationDecisionRecorded,
        Some(json!({
            "decision_id": decision_id,
            "continuation_id": params.continuation_id,
            "selected_task_id": selected_record.task_id,
            "selected_run_id": selected_record.run_id,
            "expected_progress_fingerprint": params.expected_progress_fingerprint,
            "expected_aggregate_sequence": params.expected_aggregate_sequence,
            "candidate_count": candidate_count,
            "policy_version": policy_version,
            "authorize": true,
            "next_action": "run_task_explicitly",
            "reason": "Headless continue-once selected one eligible runnable task from runtime progress overview."
        })),
    ) {
        return error_response(id, -32603, &format!("internal error: {error}"));
    }
    if let Some(continuation_id) = params.continuation_id.as_ref() {
        if let Err(error) = store.tasks().write_headless_continuation_decision(
            &HeadlessContinuationDecisionLookup {
                decision_id: decision_id.clone(),
                continuation_id: continuation_id.clone(),
                selected_task_id: selected_record.task_id.clone(),
                selected_run_id: selected_record.run_id.clone(),
                expected_progress_fingerprint: params.expected_progress_fingerprint.clone(),
                expected_aggregate_sequence: params.expected_aggregate_sequence,
                candidate_count,
                policy_version: policy_version.to_string(),
            },
        ) {
            return error_response(id, -32603, &format!("internal error: {error}"));
        }
    }

    let task_run_response = handle_task_run(
        id.clone(),
        Some(json!({
            "task_id": selected_record.task_id,
            "context_budget": params.context_budget.clone(),
            "selected_index_context": params.selected_index_context.clone(),
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

    let post_tasks = match store.tasks().list_tasks() {
        Ok(tasks) => tasks,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    let post_progress_overview = match task_list_progress_overview(&store, &post_tasks) {
        Ok(progress_overview) => progress_overview,
        Err(message) => return error_response(id, -32603, &format!("internal error: {message}")),
    };
    let next_route = headless_continue_next_route(
        &selected_record,
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
            candidate_count,
            expected_progress_fingerprint: params.expected_progress_fingerprint,
            expected_aggregate_sequence: params.expected_aggregate_sequence,
            current_progress_fingerprint: progress_overview.source_fingerprint,
            current_aggregate_sequence: progress_overview.aggregate_sequence,
            post_progress_fingerprint: Some(post_progress_overview.source_fingerprint),
            post_aggregate_sequence: Some(post_progress_overview.aggregate_sequence),
            stale: false,
            replayed: false,
            task_run_result: Some(task_run_result),
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

fn validate_headless_continue_scope(scope: &HeadlessContinueScope) -> Result<(), &'static str> {
    let selector_count = [
        scope.session_id.as_deref(),
        scope.session_id_prefix.as_deref(),
        scope.journey_id.as_deref(),
        scope.task_id.as_deref(),
        scope.run_id.as_deref(),
    ]
    .into_iter()
    .filter(|selector| selector.is_some())
    .count();
    if selector_count == 0 {
        return Err("invalid params: continuation_scope must include at least one selector");
    }

    for (field, value) in [
        ("session_id", scope.session_id.as_deref()),
        ("session_id_prefix", scope.session_id_prefix.as_deref()),
        ("journey_id", scope.journey_id.as_deref()),
        ("task_id", scope.task_id.as_deref()),
        ("run_id", scope.run_id.as_deref()),
    ] {
        if let Some(value) = value {
            if !is_valid_headless_continue_scope_value(value) {
                return match field {
                    "session_id" => Err("invalid params: continuation_scope.session_id must be 1-96 ASCII alphanumeric, dash, underscore, colon, or dot characters"),
                    "session_id_prefix" => Err("invalid params: continuation_scope.session_id_prefix must be 1-96 ASCII alphanumeric, dash, underscore, colon, or dot characters"),
                    "journey_id" => Err("invalid params: continuation_scope.journey_id must be 1-96 ASCII alphanumeric, dash, underscore, colon, or dot characters"),
                    "task_id" => Err("invalid params: continuation_scope.task_id must be 1-96 ASCII alphanumeric, dash, underscore, colon, or dot characters"),
                    _ => Err("invalid params: continuation_scope.run_id must be 1-96 ASCII alphanumeric, dash, underscore, colon, or dot characters"),
                };
            }
        }
    }
    Ok(())
}

fn is_valid_headless_continue_scope_value(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 96
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':' | b'.'))
}

fn headless_continue_once_has_non_task_target(params: &HeadlessContinueOnceParams) -> bool {
    params.verification_recovery_source.is_some()
        || params.verification_recovery_goal.is_some()
        || params.verification_recovery_mode_id.is_some()
        || params.verification_recovery_retry_source.is_some()
        || params.verification_recovery_retry_goal.is_some()
        || params.verification_recovery_retry_mode_id.is_some()
        || params.llm_provider_failure_retry_source.is_some()
        || params.llm_provider_failure_retry_goal.is_some()
        || params.llm_provider_failure_retry_mode_id.is_some()
        || params.product_continuation_admission_target.is_some()
        || params.product_continuation_run_target.is_some()
        || params.product_loop_stop_recovery_target.is_some()
        || params.verification_recovery_run_target.is_some()
        || params.verification_recovery_context_read.is_some()
        || params.patch_apply_recovery_source.is_some()
        || params.patch_apply_recovery_goal.is_some()
        || params.patch_apply_recovery_mode_id.is_some()
        || params.patch_apply_recovery_run_target.is_some()
        || params.patch_apply_recovery_apply_target.is_some()
        || params.verification_recovery_apply_target.is_some()
        || params.verification_recovery_retry_run_target.is_some()
        || params.llm_provider_failure_retry_run_target.is_some()
        || params.parent_join_run_target.is_some()
        || params
            .objective_proposal_authorization_preflight_target
            .is_some()
        || params.objective_proposal_apply_target.is_some()
        || params.objective_apply_verification_target.is_some()
        || params.objective_completion_acceptance_target.is_some()
        || params.modepack_registry_update_selection_target.is_some()
        || params.modepack_selected_candidate_fetch_target.is_some()
        || params
            .modepack_selected_candidate_provenance_verification_target
            .is_some()
        || params.modepack_selected_candidate_approval_target.is_some()
        || params
            .modepack_selected_approved_candidate_replacement_target
            .is_some()
        || params.modepack_selected_active_rollback_target.is_some()
}

fn scoped_headless_continue_once_candidate_task_ids(
    store: &BrownieStore,
    tasks: &[TaskRecord],
    candidate_task_ids: &[String],
    scope: &HeadlessContinueScope,
) -> Result<Vec<String>, String> {
    let matching_checkpoints = scoped_matching_journey_start_checkpoints(store, tasks, scope)?;
    if matching_checkpoints.is_empty() {
        return Ok(Vec::new());
    }

    let allowed_task_ids = scoped_allowed_task_ids(tasks, &matching_checkpoints);
    Ok(candidate_task_ids
        .iter()
        .filter(|task_id| allowed_task_ids.contains(task_id.as_str()))
        .cloned()
        .collect())
}

fn scoped_matching_journey_start_checkpoints(
    store: &BrownieStore,
    tasks: &[TaskRecord],
    scope: &HeadlessContinueScope,
) -> Result<Vec<HeadlessJourneyStartCheckpoint>, String> {
    let mut checkpoints: Vec<_> = store
        .tasks()
        .list_headless_journey_start_checkpoints()
        .map_err(|error| error.to_string())?
        .into_iter()
        .filter(|checkpoint| headless_journey_start_matches_scope(checkpoint, scope))
        .collect();
    if checkpoints.is_empty() {
        return Ok(Vec::new());
    }
    if scope.latest_matching_session {
        checkpoints.sort_by(|a, b| {
            scoped_journey_start_sort_key(a, tasks).cmp(&scoped_journey_start_sort_key(b, tasks))
        });
        return Ok(checkpoints.into_iter().rev().take(1).collect());
    }
    if checkpoints.len() > 1 {
        return Err(
            "invalid params: continuation_scope matched multiple journey checkpoints; use latest_matching_session or an exact selector"
                .to_string(),
        );
    }
    Ok(checkpoints)
}

fn headless_journey_start_matches_scope(
    checkpoint: &HeadlessJourneyStartCheckpoint,
    scope: &HeadlessContinueScope,
) -> bool {
    scope
        .session_id
        .as_ref()
        .map(|session_id| checkpoint.session_id == *session_id)
        .unwrap_or(true)
        && scope
            .session_id_prefix
            .as_ref()
            .map(|prefix| checkpoint.session_id.starts_with(prefix))
            .unwrap_or(true)
        && scope
            .journey_id
            .as_ref()
            .map(|journey_id| checkpoint.journey_id == *journey_id)
            .unwrap_or(true)
        && scope
            .task_id
            .as_ref()
            .map(|task_id| checkpoint.task_id == *task_id)
            .unwrap_or(true)
        && scope
            .run_id
            .as_ref()
            .map(|run_id| checkpoint.run_id == *run_id)
            .unwrap_or(true)
}

fn scoped_journey_start_sort_key(
    checkpoint: &HeadlessJourneyStartCheckpoint,
    tasks: &[TaskRecord],
) -> (String, String, String, String) {
    let task = tasks
        .iter()
        .find(|task| task.task_id == checkpoint.task_id || task.run_id == checkpoint.run_id);
    (
        task.map(|task| task.created_at.clone()).unwrap_or_default(),
        task.map(|task| task.updated_at.clone()).unwrap_or_default(),
        checkpoint.session_id.clone(),
        checkpoint.journey_id.clone(),
    )
}

fn scoped_allowed_task_ids(
    tasks: &[TaskRecord],
    checkpoints: &[HeadlessJourneyStartCheckpoint],
) -> std::collections::BTreeSet<String> {
    let mut allowed_task_ids = std::collections::BTreeSet::new();
    let mut allowed_run_ids = std::collections::BTreeSet::new();
    for checkpoint in checkpoints {
        allowed_task_ids.insert(checkpoint.task_id.clone());
        allowed_run_ids.insert(checkpoint.run_id.clone());
    }

    let mut changed = true;
    while changed {
        changed = false;
        for task in tasks {
            if task
                .parent_run_id
                .as_ref()
                .map(|parent_run_id| allowed_run_ids.contains(parent_run_id))
                .unwrap_or(false)
                && allowed_task_ids.insert(task.task_id.clone())
            {
                allowed_run_ids.insert(task.run_id.clone());
                changed = true;
            }
        }
    }

    allowed_task_ids
}

pub(super) fn handle_headless_run_advance(
    id: Value,
    params: Option<Value>,
) -> JsonRpcResponse<Value> {
    let params: HeadlessRunAdvanceParams = match parse_params(params) {
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
    if let Some(advance_id) = params.advance_id.as_deref() {
        if !is_valid_headless_run_id(advance_id) {
            return error_response(
                id,
                -32602,
                "invalid params: advance_id must be 1-48 ASCII alphanumeric, dash, underscore, colon, or dot characters",
            );
        }
    }
    let max_steps = params.max_steps.unwrap_or(1);
    if max_steps == 0 || max_steps > HEADLESS_CONTINUE_MAX_BUDGET_STEPS {
        return error_response(
            id,
            -32602,
            "invalid params: max_steps must be between 1 and 3",
        );
    }
    if params.modepack_registry_update_selection_target.is_some() && max_steps > 1 {
        return error_response(
            id,
            -32602,
            "invalid params: modepack_registry_update_selection_target cannot be combined with max_steps greater than 1",
        );
    }
    if params.product_continuation_admission_target.is_some() && max_steps > 1 {
        return error_response(
            id,
            -32602,
            "invalid params: product_continuation_admission_target cannot be combined with max_steps greater than 1",
        );
    }
    if params.product_continuation_run_target.is_some() && max_steps > 1 {
        return error_response(
            id,
            -32602,
            "invalid params: product_continuation_run_target cannot be combined with max_steps greater than 1",
        );
    }
    if params.product_continuation_derived_target.is_some() && max_steps > 1 {
        return error_response(
            id,
            -32602,
            "invalid params: product_continuation_derived_target cannot be combined with max_steps greater than 1",
        );
    }
    if params.parent_join_run_target.is_some() && max_steps > 1 {
        return error_response(
            id,
            -32602,
            "invalid params: parent_join_run_target cannot be combined with max_steps greater than 1",
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
            "invalid params: only one explicit product-continuation run-control target may be supplied",
        );
    }
    if params.modepack_selected_candidate_fetch_target.is_some() && max_steps > 1 {
        return error_response(
            id,
            -32602,
            "invalid params: modepack_selected_candidate_fetch_target cannot be combined with max_steps greater than 1",
        );
    }
    if params
        .modepack_selected_candidate_provenance_verification_target
        .is_some()
        && max_steps > 1
    {
        return error_response(
            id,
            -32602,
            "invalid params: modepack_selected_candidate_provenance_verification_target cannot be combined with max_steps greater than 1",
        );
    }
    if params.modepack_selected_candidate_approval_target.is_some() && max_steps > 1 {
        return error_response(
            id,
            -32602,
            "invalid params: modepack_selected_candidate_approval_target cannot be combined with max_steps greater than 1",
        );
    }
    if params
        .modepack_selected_approved_candidate_replacement_target
        .is_some()
        && max_steps > 1
    {
        return error_response(
            id,
            -32602,
            "invalid params: modepack_selected_approved_candidate_replacement_target cannot be combined with max_steps greater than 1",
        );
    }
    if headless_run_advance_explicit_modepack_target_count(&params) > 1 {
        return error_response(
            id,
            -32602,
            "invalid params: only one explicit modepack run-control target may be supplied",
        );
    }
    if let Err(message) = validate_headless_context_budget_bounds(params.context_budget.as_ref()) {
        return error_response(id, -32602, message);
    }
    if headless_run_advance_has_explicit_modepack_target(&params) && params.context_budget.is_some()
    {
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
    if headless_run_advance_has_explicit_modepack_target(&params)
        && params.selected_index_context.is_some()
    {
        return error_response(
            id,
            -32602,
            "invalid params: selected_index_context is supported only for normal headless task continuation",
        );
    }
    if product_continuation_target_count > 0 && params.selected_index_context.is_some() {
        return error_response(
            id,
            -32602,
            "invalid params: selected_index_context is supported only for normal headless task continuation",
        );
    }
    if params.selected_index_context.is_some() && max_steps > 1 {
        return error_response(
            id,
            -32602,
            "invalid params: selected_index_context cannot be combined with max_steps greater than 1",
        );
    }
    if params.expected_session_sequence == 0 {
        return error_response(
            id,
            -32602,
            "invalid params: expected_session_sequence must be greater than zero",
        );
    }

    let store = match BrownieStore::from_env_or_cwd() {
        Ok(store) => store,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    let existing = match store
        .tasks()
        .read_headless_run_session_checkpoint(&params.session_id)
    {
        Ok(existing) => existing,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    if let Some(checkpoint) = existing.as_ref() {
        if checkpoint.session_sequence == params.expected_session_sequence {
            if params
                .advance_id
                .as_ref()
                .map(|advance_id| advance_id != &checkpoint.advance_id)
                .unwrap_or(false)
            {
                return error_response(
                    id,
                    -32602,
                    "invalid params: advance_id conflicts with persisted session sequence",
                );
            }
            if let Err(message) = validate_headless_run_selected_candidate_fetch_replay_target(
                &store,
                checkpoint,
                params.modepack_selected_candidate_fetch_target.as_ref(),
            ) {
                return error_response(id, -32602, &message);
            }
            if let Err(message) = validate_headless_run_registry_selection_replay_target(
                &store,
                checkpoint,
                params.modepack_registry_update_selection_target.as_ref(),
            ) {
                return error_response(id, -32602, &message);
            }
            if let Err(message) =
                validate_headless_run_selected_candidate_provenance_verification_replay_target(
                    &store,
                    checkpoint,
                    params
                        .modepack_selected_candidate_provenance_verification_target
                        .as_ref(),
                )
            {
                return error_response(id, -32602, &message);
            }
            if let Err(message) = validate_headless_run_selected_candidate_approval_replay_target(
                &store,
                checkpoint,
                params.modepack_selected_candidate_approval_target.as_ref(),
            ) {
                return error_response(id, -32602, &message);
            }
            if let Err(message) = validate_headless_run_selected_candidate_replacement_replay_target(
                &store,
                checkpoint,
                params
                    .modepack_selected_approved_candidate_replacement_target
                    .as_ref(),
            ) {
                return error_response(id, -32602, &message);
            }
            if let Err(message) = validate_headless_run_product_continuation_replay_target(
                &store,
                checkpoint,
                params.product_continuation_admission_target.as_ref(),
                params.product_continuation_run_target.as_ref(),
            ) {
                return error_response(id, -32602, &message);
            }
            if let Err(message) = validate_headless_run_product_continuation_derived_replay_target(
                &store,
                checkpoint,
                params.product_continuation_derived_target.as_ref(),
            ) {
                return error_response(id, -32602, &message);
            }
            let mut result = checkpoint.result.clone();
            result.replayed = true;
            return result_response(id, json!(result));
        }
        if params.expected_session_sequence != checkpoint.session_sequence + 1 {
            return error_response(
                id,
                -32602,
                "invalid params: expected_session_sequence must match the next runtime-owned session sequence",
            );
        }
        if params.modepack_selected_candidate_fetch_target.is_some()
            && !checkpoint
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
                checkpoint,
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
                checkpoint,
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
                checkpoint,
                HeadlessContinueRouteKind::ReplaceActiveWithApprovedModePackCandidateExplicitly,
            )
            && !headless_run_checkpoint_has_next_route_action(
                checkpoint,
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
            && !headless_run_checkpoint_is_progress_overview_boundary(checkpoint)
        {
            return error_response(
                id,
                -32602,
                "invalid params: modepack_registry_update_selection_target requires a persisted progress overview route boundary",
            );
        }
        if params.product_continuation_admission_target.is_some()
            && !headless_run_checkpoint_has_next_route(
                checkpoint,
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
                checkpoint,
                HeadlessContinueRouteKind::RunProductContinuationTaskExplicitly,
            )
        {
            return error_response(
                id,
                -32602,
                "invalid params: product_continuation_run_target requires persisted session route run_product_continuation_task_explicitly",
            );
        }
        if let Some(target) = params.product_continuation_derived_target.as_ref() {
            if let Err(message) = validate_product_continuation_derived_target(target) {
                return error_response(id, -32602, &message);
            }
            if !matches!(
                headless_run_checkpoint_next_route_kind(checkpoint),
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
    } else if params.expected_session_sequence != 1 {
        return error_response(
            id,
            -32602,
            "invalid params: new session expected_session_sequence must be 1",
        );
    } else if params.modepack_selected_candidate_fetch_target.is_some()
        || params
            .modepack_selected_candidate_provenance_verification_target
            .is_some()
        || params.modepack_selected_candidate_approval_target.is_some()
        || params
            .modepack_selected_approved_candidate_replacement_target
            .is_some()
        || params.product_continuation_admission_target.is_some()
        || params.product_continuation_run_target.is_some()
        || params.product_continuation_derived_target.is_some()
    {
        return error_response(
            id,
            -32602,
            "invalid params: explicit route run-control target requires an existing session checkpoint",
        );
    }

    let (start_fingerprint, start_sequence) = if let Some(checkpoint) = existing.as_ref() {
        let Some(post_progress) = checkpoint.result.post_progress.clone() else {
            return error_response(
                id,
                -32603,
                "internal error: persisted session checkpoint is missing post progress",
            );
        };
        (
            post_progress.progress_fingerprint,
            post_progress.aggregate_sequence,
        )
    } else {
        let Some(fingerprint) = params.expected_progress_fingerprint.clone() else {
            return error_response(
                id,
                -32602,
                "invalid params: expected_progress_fingerprint is required for a new session",
            );
        };
        let Some(sequence) = params.expected_aggregate_sequence else {
            return error_response(
                id,
                -32602,
                "invalid params: expected_aggregate_sequence is required for a new session",
            );
        };
        (fingerprint, sequence)
    };

    let advance_id = params
        .advance_id
        .clone()
        .unwrap_or_else(|| format!("seq.{}", params.expected_session_sequence));
    let (derived_admission_target, derived_run_target) = if let (Some(checkpoint), Some(target)) = (
        existing.as_ref(),
        params.product_continuation_derived_target.as_ref(),
    ) {
        match product_continuation_derived_targets_from_checkpoint(&store, checkpoint, target) {
            Ok(targets) => targets,
            Err(message) => return error_response(id, -32602, &message),
        }
    } else {
        (None, None)
    };
    let continuation_id = format!(
        "run.{}.{}",
        params.session_id, params.expected_session_sequence
    );
    if !is_valid_headless_continuation_id(&continuation_id) {
        return error_response(
            id,
            -32602,
            "invalid params: session_id is too long for derived continuation IDs",
        );
    }
    let mut continue_params = json!({
        "authorize": true,
        "expected_progress_fingerprint": start_fingerprint,
        "expected_aggregate_sequence": start_sequence,
        "continuation_id": continuation_id,
        "max_steps": max_steps,
        "context_budget": params.context_budget.clone(),
        "selected_index_context": params.selected_index_context.clone()
    });
    if let Some(target) = params.modepack_selected_candidate_fetch_target.clone() {
        continue_params["modepack_selected_candidate_fetch_target"] = json!(target);
    }
    if let Some(target) = params.product_continuation_admission_target.clone() {
        continue_params["product_continuation_admission_target"] = json!(target);
    }
    if let Some(target) = params.product_continuation_run_target.clone() {
        continue_params["product_continuation_run_target"] = json!(target);
    }
    if let Some(target) = params.parent_join_run_target.clone() {
        continue_params["parent_join_run_target"] = json!(target);
    }
    if let Some(target) = derived_admission_target {
        continue_params["product_continuation_admission_target"] = json!(target);
    }
    if let Some(target) = derived_run_target {
        continue_params["product_continuation_run_target"] = json!(target);
    }
    if let Some(target) = params.modepack_registry_update_selection_target.clone() {
        continue_params["modepack_registry_update_selection_target"] = json!(target);
    }
    if let Some(target) = params
        .modepack_selected_candidate_provenance_verification_target
        .clone()
    {
        continue_params["modepack_selected_candidate_provenance_verification_target"] =
            json!(target);
    }
    if let Some(target) = params.modepack_selected_candidate_approval_target.clone() {
        continue_params["modepack_selected_candidate_approval_target"] = json!(target);
    }
    if let Some(target) = params
        .modepack_selected_approved_candidate_replacement_target
        .clone()
    {
        continue_params["modepack_selected_approved_candidate_replacement_target"] = json!(target);
    }
    let response = handle_headless_continue_once(id.clone(), Some(continue_params));
    let Some(result_value) = response.result else {
        return JsonRpcResponse {
            jsonrpc: JSONRPC_VERSION.to_string(),
            id,
            result: None,
            error: response.error,
        };
    };
    let continue_result: HeadlessContinueOnceResult = match serde_json::from_value(result_value) {
        Ok(result) => result,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    if continue_result.status == HeadlessContinueOnceStatus::StaleProgress {
        return error_response(
            id,
            -32602,
            "invalid params: starting progress checkpoint is stale",
        );
    }
    let start_progress = HeadlessRunProgressCheckpoint {
        progress_fingerprint: continue_result.current_progress_fingerprint.clone(),
        aggregate_sequence: continue_result.current_aggregate_sequence,
    };
    let post_progress = match (
        continue_result.post_progress_fingerprint.clone(),
        continue_result.post_aggregate_sequence,
    ) {
        (Some(progress_fingerprint), Some(aggregate_sequence)) => {
            Some(HeadlessRunProgressCheckpoint {
                progress_fingerprint,
                aggregate_sequence,
            })
        }
        _ if continue_result.status == HeadlessContinueOnceStatus::NoEligibleTask => {
            Some(start_progress.clone())
        }
        _ => None,
    };
    let advance_steps = if continue_result.steps.is_empty() {
        vec![HeadlessContinueStepResult {
            step_index: 1,
            status: continue_result.status.clone(),
            decision_id: continue_result.decision_id.clone(),
            continuation_id: continue_result.continuation_id.clone(),
            selected_task_id: continue_result.selected_task_id.clone(),
            selected_run_id: continue_result.selected_run_id.clone(),
            candidate_count: continue_result.candidate_count,
            current_progress_fingerprint: continue_result.current_progress_fingerprint.clone(),
            current_aggregate_sequence: continue_result.current_aggregate_sequence,
            post_progress_fingerprint: continue_result.post_progress_fingerprint.clone(),
            post_aggregate_sequence: continue_result.post_aggregate_sequence,
            replayed: continue_result.replayed,
            context_budget: continue_result
                .task_run_result
                .as_ref()
                .and_then(|result| result.context_budget.clone()),
            terminal_completion_evidence: continue_result
                .task_run_result
                .as_ref()
                .and_then(|result| result.completion_evidence.clone()),
            parent_join_readiness_outcome: continue_result
                .task_run_result
                .as_ref()
                .and_then(|result| result.parent_join_readiness_outcome.clone()),
            next_route: continue_result.next_route.clone(),
            next_action: continue_result.next_action.clone(),
        }]
    } else {
        continue_result.steps.clone()
    };
    let terminal_completion_evidence = headless_terminal_completion_evidence_from_steps(
        &advance_steps,
        continue_result
            .task_run_result
            .as_ref()
            .and_then(|result| result.completion_evidence.as_ref()),
    );
    let step_count = continue_result.step_count.unwrap_or(advance_steps.len());
    let executed_count = continue_result.executed_count.unwrap_or_else(|| {
        usize::from(continue_result.status == HeadlessContinueOnceStatus::TaskExecuted)
    });
    let replayed_count = continue_result
        .replayed_count
        .unwrap_or_else(|| usize::from(continue_result.replayed));
    let checkpoint_seed = json!({
        "session_id": params.session_id,
        "advance_id": advance_id,
        "session_sequence": params.expected_session_sequence,
        "start_progress": start_progress,
        "post_progress": post_progress,
        "max_steps": max_steps,
        "step_count": step_count,
        "executed_count": executed_count,
        "replayed_count": replayed_count,
        "stop_reason": continue_result.stop_reason.clone().unwrap_or_else(|| headless_continue_budget_stop_reason(&continue_result, 1, max_steps)),
        "terminal_completion_evidence": terminal_completion_evidence,
        "next_action": continue_result.next_action,
    });
    let checkpoint_fingerprint = format!(
        "sha256:{}",
        hex_sha256(checkpoint_seed.to_string().as_bytes())
    );
    let result = HeadlessRunAdvanceResult {
        status: continue_result.status.clone(),
        session_id: params.session_id.clone(),
        advance_id: advance_id.clone(),
        session_sequence: params.expected_session_sequence,
        replayed: false,
        start_progress,
        post_progress,
        max_steps,
        step_count,
        executed_count,
        replayed_count,
        stop_reason: continue_result.stop_reason.clone().unwrap_or_else(|| {
            headless_continue_budget_stop_reason(&continue_result, 1, max_steps)
        }),
        checkpoint_fingerprint,
        terminal_completion_evidence,
        next_route: continue_result.next_route.clone(),
        steps: advance_steps,
        next_action: continue_result.next_action.clone(),
    };
    if let Err(error) = append_headless_run_session_advanced_events(&store, &result) {
        return error_response(id, -32603, &format!("internal error: {error}"));
    }
    let checkpoint = HeadlessRunSessionCheckpoint {
        session_id: params.session_id,
        advance_id,
        session_sequence: params.expected_session_sequence,
        result: result.clone(),
    };
    if let Err(error) = store
        .tasks()
        .write_headless_run_session_checkpoint(&checkpoint)
    {
        return error_response(id, -32603, &format!("internal error: {error}"));
    }
    result_response(id, json!(result))
}

pub(super) fn validate_headless_run_selected_candidate_fetch_replay_target(
    store: &BrownieStore,
    checkpoint: &HeadlessRunSessionCheckpoint,
    target: Option<&ModePackSelectedCandidateFetchTarget>,
) -> Result<(), String> {
    let continuation_id = checkpoint
        .result
        .steps
        .iter()
        .find_map(|step| step.continuation_id.as_deref());
    let Some(continuation_id) = continuation_id else {
        return Ok(());
    };
    let routed_fetch_replay = target.is_some()
        || matches!(
            headless_run_checkpoint_next_route_kind(checkpoint),
            Some(HeadlessContinueRouteKind::VerifySelectedModePackCandidateProvenanceExplicitly)
        );
    let fetch_checkpoint = store
        .read_headless_modepack_selected_candidate_fetch_checkpoint(continuation_id)
        .map_err(|error| error.to_string())?;
    let Some(fetch_checkpoint) = fetch_checkpoint else {
        if routed_fetch_replay {
            return Err(
                "invalid params: routed selected-candidate fetch replay checkpoint is missing subordinate fetch evidence"
                    .to_string(),
            );
        }
        return Ok(());
    };
    let Some(target) = target.cloned() else {
        return Err(
            "invalid params: modepack_selected_candidate_fetch_target is required to replay a routed selected-candidate fetch advance"
                .to_string(),
        );
    };
    let replay_params = HeadlessContinueOnceParams {
        authorize: true,
        expected_progress_fingerprint: checkpoint
            .result
            .start_progress
            .progress_fingerprint
            .clone(),
        expected_aggregate_sequence: checkpoint.result.start_progress.aggregate_sequence,
        continuation_id: Some(continuation_id.to_string()),
        continuation_scope: None,
        max_steps: Some(checkpoint.result.max_steps),
        context_budget: None,
        selected_index_context: None,
        verification_recovery_source: None,
        verification_recovery_goal: None,
        verification_recovery_mode_id: None,
        verification_recovery_retry_source: None,
        verification_recovery_retry_goal: None,
        verification_recovery_retry_mode_id: None,
        llm_provider_failure_retry_source: None,
        llm_provider_failure_retry_goal: None,
        llm_provider_failure_retry_mode_id: None,
        product_continuation_admission_target: None,
        product_continuation_run_target: None,
        product_loop_stop_recovery_target: None,
        verification_recovery_run_target: None,
        verification_recovery_context_read: None,
        patch_apply_recovery_source: None,
        patch_apply_recovery_goal: None,
        patch_apply_recovery_mode_id: None,
        patch_apply_recovery_run_target: None,
        patch_apply_recovery_apply_target: None,
        verification_recovery_apply_target: None,
        verification_recovery_retry_run_target: None,
        llm_provider_failure_retry_run_target: None,
        parent_join_run_target: None,
        objective_proposal_authorization_preflight_target: None,
        objective_proposal_apply_target: None,
        objective_apply_verification_target: None,
        objective_completion_acceptance_target: None,
        modepack_registry_update_selection_target: None,
        modepack_selected_candidate_fetch_target: Some(target),
        modepack_selected_candidate_provenance_verification_target: None,
        modepack_selected_candidate_approval_target: None,
        modepack_selected_approved_candidate_replacement_target: None,
        modepack_selected_active_rollback_target: None,
    };
    validate_headless_modepack_selected_candidate_fetch_replay_request(
        &replay_params,
        &fetch_checkpoint,
    )
}

pub(super) fn validate_headless_run_selected_candidate_provenance_verification_replay_target(
    store: &BrownieStore,
    checkpoint: &HeadlessRunSessionCheckpoint,
    target: Option<&ModePackSelectedCandidateProvenanceVerificationTarget>,
) -> Result<(), String> {
    let continuation_id = checkpoint
        .result
        .steps
        .iter()
        .find_map(|step| step.continuation_id.as_deref());
    let Some(continuation_id) = continuation_id else {
        return Ok(());
    };
    let routed_replay = target.is_some()
        || matches!(
            headless_run_checkpoint_next_route_kind(checkpoint),
            Some(HeadlessContinueRouteKind::ApproveVerifiedModePackCandidateExplicitly)
        );
    let stored = store
        .read_headless_modepack_selected_candidate_provenance_verification_checkpoint(
            continuation_id,
        )
        .map_err(|error| error.to_string())?;
    let Some(stored) = stored else {
        if routed_replay {
            return Err(
                "invalid params: routed selected-candidate provenance verification replay checkpoint is missing subordinate provenance evidence"
                    .to_string(),
            );
        }
        return Ok(());
    };
    let Some(target) = target.cloned() else {
        return Err(
            "invalid params: modepack_selected_candidate_provenance_verification_target is required to replay a routed selected-candidate provenance verification advance"
                .to_string(),
        );
    };
    let mut replay_params = headless_run_replay_continue_once_params(checkpoint, continuation_id);
    replay_params.modepack_selected_candidate_provenance_verification_target = Some(target);
    validate_headless_modepack_selected_candidate_provenance_verification_replay_request(
        &replay_params,
        &stored,
    )
}

pub(super) fn validate_headless_run_selected_candidate_approval_replay_target(
    store: &BrownieStore,
    checkpoint: &HeadlessRunSessionCheckpoint,
    target: Option<&ModePackSelectedCandidateApprovalTarget>,
) -> Result<(), String> {
    let continuation_id = checkpoint
        .result
        .steps
        .iter()
        .find_map(|step| step.continuation_id.as_deref());
    let Some(continuation_id) = continuation_id else {
        return Ok(());
    };
    let routed_replay = target.is_some();
    let stored = store
        .read_headless_modepack_selected_candidate_approval_checkpoint(continuation_id)
        .map_err(|error| error.to_string())?;
    let Some(stored) = stored else {
        if routed_replay {
            return Err(
                "invalid params: routed selected-candidate approval replay checkpoint is missing subordinate approval evidence"
                    .to_string(),
            );
        }
        return Ok(());
    };
    let Some(target) = target.cloned() else {
        return Err(
            "invalid params: modepack_selected_candidate_approval_target is required to replay a routed selected-candidate approval advance"
                .to_string(),
        );
    };
    let mut replay_params = headless_run_replay_continue_once_params(checkpoint, continuation_id);
    replay_params.modepack_selected_candidate_approval_target = Some(target);
    validate_headless_modepack_selected_candidate_approval_replay_request(&replay_params, &stored)
}

pub(super) fn validate_headless_run_selected_candidate_replacement_replay_target(
    store: &BrownieStore,
    checkpoint: &HeadlessRunSessionCheckpoint,
    target: Option<&ModePackSelectedApprovedCandidateReplacementTarget>,
) -> Result<(), String> {
    let continuation_id = checkpoint
        .result
        .steps
        .iter()
        .find_map(|step| step.continuation_id.as_deref());
    let Some(continuation_id) = continuation_id else {
        return Ok(());
    };
    let routed_replay = target.is_some();
    let stored = store
        .read_headless_modepack_selected_candidate_replacement_checkpoint(continuation_id)
        .map_err(|error| error.to_string())?;
    let Some(stored) = stored else {
        if routed_replay {
            return Err(
                "invalid params: routed selected approved candidate replacement replay checkpoint is missing subordinate replacement evidence"
                    .to_string(),
            );
        }
        return Ok(());
    };
    let Some(target) = target.cloned() else {
        return Err(
            "invalid params: modepack_selected_approved_candidate_replacement_target is required to replay a routed selected approved candidate replacement advance"
                .to_string(),
        );
    };
    let mut replay_params = headless_run_replay_continue_once_params(checkpoint, continuation_id);
    replay_params.modepack_selected_approved_candidate_replacement_target = Some(target);
    validate_headless_modepack_selected_candidate_replacement_replay_request(
        &replay_params,
        &stored,
    )
}

pub(super) fn validate_headless_run_registry_selection_replay_target(
    store: &BrownieStore,
    checkpoint: &HeadlessRunSessionCheckpoint,
    target: Option<&ModePackRegistryUpdateSelectionTarget>,
) -> Result<(), String> {
    let continuation_id = checkpoint
        .result
        .steps
        .iter()
        .find_map(|step| step.continuation_id.as_deref());
    let Some(continuation_id) = continuation_id else {
        return Ok(());
    };
    let routed_selection_replay = target.is_some()
        || matches!(
            headless_run_checkpoint_next_route_kind(checkpoint),
            Some(HeadlessContinueRouteKind::FetchSelectedModePackCandidateExplicitly)
        );
    let selection_checkpoint = store
        .read_headless_modepack_registry_update_selection_checkpoint(continuation_id)
        .map_err(|error| error.to_string())?;
    let Some(selection_checkpoint) = selection_checkpoint else {
        if routed_selection_replay {
            return Err(
                "invalid params: routed registry selection replay checkpoint is missing subordinate selection evidence"
                    .to_string(),
            );
        }
        return Ok(());
    };
    let Some(target) = target.cloned() else {
        return Err(
            "invalid params: modepack_registry_update_selection_target is required to replay a routed registry selection advance"
                .to_string(),
        );
    };
    let replay_params = HeadlessContinueOnceParams {
        authorize: true,
        expected_progress_fingerprint: checkpoint
            .result
            .start_progress
            .progress_fingerprint
            .clone(),
        expected_aggregate_sequence: checkpoint.result.start_progress.aggregate_sequence,
        continuation_id: Some(continuation_id.to_string()),
        continuation_scope: None,
        max_steps: Some(checkpoint.result.max_steps),
        context_budget: None,
        selected_index_context: None,
        verification_recovery_source: None,
        verification_recovery_goal: None,
        verification_recovery_mode_id: None,
        verification_recovery_retry_source: None,
        verification_recovery_retry_goal: None,
        verification_recovery_retry_mode_id: None,
        llm_provider_failure_retry_source: None,
        llm_provider_failure_retry_goal: None,
        llm_provider_failure_retry_mode_id: None,
        product_continuation_admission_target: None,
        product_continuation_run_target: None,
        product_loop_stop_recovery_target: None,
        verification_recovery_run_target: None,
        verification_recovery_context_read: None,
        patch_apply_recovery_source: None,
        patch_apply_recovery_goal: None,
        patch_apply_recovery_mode_id: None,
        patch_apply_recovery_run_target: None,
        patch_apply_recovery_apply_target: None,
        verification_recovery_apply_target: None,
        verification_recovery_retry_run_target: None,
        llm_provider_failure_retry_run_target: None,
        parent_join_run_target: None,
        objective_proposal_authorization_preflight_target: None,
        objective_proposal_apply_target: None,
        objective_apply_verification_target: None,
        objective_completion_acceptance_target: None,
        modepack_registry_update_selection_target: Some(target),
        modepack_selected_candidate_fetch_target: None,
        modepack_selected_candidate_provenance_verification_target: None,
        modepack_selected_candidate_approval_target: None,
        modepack_selected_approved_candidate_replacement_target: None,
        modepack_selected_active_rollback_target: None,
    };
    validate_headless_modepack_registry_update_selection_replay_request(
        &replay_params,
        &selection_checkpoint,
    )
}

pub(super) fn headless_run_replay_continue_once_params(
    checkpoint: &HeadlessRunSessionCheckpoint,
    continuation_id: &str,
) -> HeadlessContinueOnceParams {
    HeadlessContinueOnceParams {
        authorize: true,
        expected_progress_fingerprint: checkpoint
            .result
            .start_progress
            .progress_fingerprint
            .clone(),
        expected_aggregate_sequence: checkpoint.result.start_progress.aggregate_sequence,
        continuation_id: Some(continuation_id.to_string()),
        continuation_scope: None,
        max_steps: Some(checkpoint.result.max_steps),
        context_budget: None,
        selected_index_context: None,
        verification_recovery_source: None,
        verification_recovery_goal: None,
        verification_recovery_mode_id: None,
        verification_recovery_retry_source: None,
        verification_recovery_retry_goal: None,
        verification_recovery_retry_mode_id: None,
        llm_provider_failure_retry_source: None,
        llm_provider_failure_retry_goal: None,
        llm_provider_failure_retry_mode_id: None,
        product_continuation_admission_target: None,
        product_continuation_run_target: None,
        product_loop_stop_recovery_target: None,
        verification_recovery_run_target: None,
        verification_recovery_context_read: None,
        patch_apply_recovery_source: None,
        patch_apply_recovery_goal: None,
        patch_apply_recovery_mode_id: None,
        patch_apply_recovery_run_target: None,
        patch_apply_recovery_apply_target: None,
        verification_recovery_apply_target: None,
        verification_recovery_retry_run_target: None,
        llm_provider_failure_retry_run_target: None,
        parent_join_run_target: None,
        objective_proposal_authorization_preflight_target: None,
        objective_proposal_apply_target: None,
        objective_apply_verification_target: None,
        objective_completion_acceptance_target: None,
        modepack_registry_update_selection_target: None,
        modepack_selected_candidate_fetch_target: None,
        modepack_selected_candidate_provenance_verification_target: None,
        modepack_selected_candidate_approval_target: None,
        modepack_selected_approved_candidate_replacement_target: None,
        modepack_selected_active_rollback_target: None,
    }
}

pub(super) fn headless_run_checkpoint_next_route_kind(
    checkpoint: &HeadlessRunSessionCheckpoint,
) -> Option<&HeadlessContinueRouteKind> {
    checkpoint
        .result
        .next_route
        .as_ref()
        .map(|route| &route.kind)
        .or_else(|| {
            checkpoint
                .result
                .steps
                .iter()
                .find_map(|step| step.next_route.as_ref().map(|route| &route.kind))
        })
}

pub(super) fn headless_run_checkpoint_has_next_route(
    checkpoint: &HeadlessRunSessionCheckpoint,
    expected: HeadlessContinueRouteKind,
) -> bool {
    headless_run_checkpoint_next_route_kind(checkpoint)
        .map(|kind| kind == &expected)
        .unwrap_or(false)
}

pub(super) fn headless_run_checkpoint_has_next_route_action(
    checkpoint: &HeadlessRunSessionCheckpoint,
    expected: HeadlessContinueRouteKind,
    next_action: &str,
) -> bool {
    checkpoint
        .result
        .next_route
        .as_ref()
        .map(|route| route.kind == expected && route.next_action == next_action)
        .unwrap_or(false)
}

fn headless_run_advance_explicit_modepack_target_count(params: &HeadlessRunAdvanceParams) -> usize {
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

fn headless_run_advance_has_explicit_modepack_target(params: &HeadlessRunAdvanceParams) -> bool {
    headless_run_advance_explicit_modepack_target_count(params) > 0
}

fn handle_headless_continue_verification_recovery_retry_admission(
    id: Value,
    store: &BrownieStore,
    progress_overview: &TaskListProgressOverview,
    params: HeadlessContinueOnceParams,
) -> JsonRpcResponse<Value> {
    let Some(source) = params.verification_recovery_retry_source else {
        return error_response(
            id,
            -32603,
            "internal error: missing verification recovery retry source",
        );
    };
    let goal = params
        .verification_recovery_retry_goal
        .unwrap_or_else(|| "Retry verification after applied recovery".to_string());
    if goal.trim().is_empty() {
        return error_response(
            id,
            -32602,
            "invalid params: verification_recovery_retry_goal must not be empty",
        );
    }
    let mode_id = params
        .verification_recovery_retry_mode_id
        .or_else(|| Some("verifier".to_string()));
    let start_response = handle_task_start(
        id.clone(),
        Some(json!({
            "goal": goal,
            "mode_id": mode_id,
            "verification_recovery_retry_source": source,
        })),
    );
    let Some(start_value) = start_response.result else {
        return JsonRpcResponse {
            jsonrpc: JSONRPC_VERSION.to_string(),
            id,
            result: None,
            error: start_response.error,
        };
    };
    let start_result: TaskStartResult = match serde_json::from_value(start_value) {
        Ok(result) => result,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    let Some(admission) = start_result.verification_recovery_retry_admission.clone() else {
        return error_response(
            id,
            -32603,
            "internal error: missing verification recovery retry admission",
        );
    };
    let retry_record = match store.tasks().get_task(&admission.retry_task_id) {
        Ok(Some(record)) if record.run_id == admission.retry_run_id => record,
        Ok(Some(_)) => {
            return error_response(
                id,
                -32603,
                "internal error: verification retry admission task/run mismatch",
            );
        }
        Ok(None) => {
            return error_response(
                id,
                -32603,
                "internal error: verification retry admission task not found",
            );
        }
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };

    let decision_id = format!("headless_decision_{}", uuid::Uuid::new_v4().simple());
    let policy_version = "headless_continue_once_v1";
    if !admission.replayed {
        if let Err(error) = store.tasks().append_task_event_with_payload(
            &retry_record,
            LedgerEventKind::HeadlessContinuationDecisionRecorded,
            Some(json!({
                "decision_id": decision_id.clone(),
                "continuation_id": params.continuation_id.clone(),
                "selected_task_id": retry_record.task_id.clone(),
                "selected_run_id": retry_record.run_id.clone(),
                "expected_progress_fingerprint": params.expected_progress_fingerprint.clone(),
                "expected_aggregate_sequence": params.expected_aggregate_sequence,
                "candidate_count": 1,
                "policy_version": policy_version,
                "authorize": true,
                "authorize_verification_retry": true,
                "source_task_id": admission.source_task_id.clone(),
                "source_run_id": admission.source_run_id.clone(),
                "recovery_task_id": admission.recovery_task_id.clone(),
                "recovery_run_id": admission.recovery_run_id.clone(),
                "proposal_id": admission.proposal_id.clone(),
                "apply_id": admission.apply_id.clone(),
                "failure_fingerprint": admission.failure_fingerprint.clone(),
                "apply_fingerprint": admission.apply_fingerprint.clone(),
                "next_action": "run_verification_retry_task_explicitly",
                "reason": "Headless continue-once admitted one verification retry task from bounded recovery apply evidence."
            })),
        ) {
            return error_response(id, -32603, &format!("internal error: {error}"));
        }
    }
    if let Some(continuation_id) = params.continuation_id.as_ref() {
        if let Err(error) = store.tasks().write_headless_continuation_decision(
            &HeadlessContinuationDecisionLookup {
                decision_id: decision_id.clone(),
                continuation_id: continuation_id.clone(),
                selected_task_id: retry_record.task_id.clone(),
                selected_run_id: retry_record.run_id.clone(),
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
    let next_route = headless_continue_next_route(&retry_record, None, &post_progress_overview);
    let next_action = next_route.next_action.clone();

    result_response(
        id,
        json!(HeadlessContinueOnceResult {
            status: HeadlessContinueOnceStatus::TaskInProgress,
            decision_id: Some(decision_id),
            continuation_id: params.continuation_id,
            selected_task_id: Some(retry_record.task_id),
            selected_run_id: Some(retry_record.run_id),
            candidate_count: 1,
            expected_progress_fingerprint: params.expected_progress_fingerprint,
            expected_aggregate_sequence: params.expected_aggregate_sequence,
            current_progress_fingerprint: progress_overview.source_fingerprint.clone(),
            current_aggregate_sequence: progress_overview.aggregate_sequence,
            post_progress_fingerprint: Some(post_progress_overview.source_fingerprint),
            post_aggregate_sequence: Some(post_progress_overview.aggregate_sequence),
            stale: false,
            replayed: admission.replayed,
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

fn handle_headless_continue_verification_recovery_admission(
    id: Value,
    store: &BrownieStore,
    progress_overview: &TaskListProgressOverview,
    params: HeadlessContinueOnceParams,
) -> JsonRpcResponse<Value> {
    let Some(source) = params.verification_recovery_source else {
        return error_response(
            id,
            -32603,
            "internal error: missing verification recovery source",
        );
    };
    let goal = params
        .verification_recovery_goal
        .unwrap_or_else(|| "Recover failed verification".to_string());
    if goal.trim().is_empty() {
        return error_response(
            id,
            -32602,
            "invalid params: verification_recovery_goal must not be empty",
        );
    }
    let mode_id = params
        .verification_recovery_mode_id
        .or_else(|| Some("implementer".to_string()));
    let start_response = handle_task_start(
        id.clone(),
        Some(json!({
            "goal": goal,
            "mode_id": mode_id,
            "verification_recovery_source": source,
        })),
    );
    let Some(start_value) = start_response.result else {
        return JsonRpcResponse {
            jsonrpc: JSONRPC_VERSION.to_string(),
            id,
            result: None,
            error: start_response.error,
        };
    };
    let start_result: TaskStartResult = match serde_json::from_value(start_value) {
        Ok(result) => result,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    let Some(admission) = start_result.verification_recovery_admission.clone() else {
        return error_response(
            id,
            -32603,
            "internal error: missing verification recovery admission",
        );
    };
    let recovery_record = match store.tasks().get_task(&admission.recovery_task_id) {
        Ok(Some(record)) if record.run_id == admission.recovery_run_id => record,
        Ok(Some(_)) => {
            return error_response(
                id,
                -32603,
                "internal error: verification recovery admission task/run mismatch",
            );
        }
        Ok(None) => {
            return error_response(
                id,
                -32603,
                "internal error: verification recovery admission task not found",
            );
        }
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };

    let decision_id = format!("headless_decision_{}", uuid::Uuid::new_v4().simple());
    let policy_version = "headless_continue_once_v1";
    if let Err(error) = store.tasks().append_task_event_with_payload(
        &recovery_record,
        LedgerEventKind::HeadlessContinuationDecisionRecorded,
        Some(json!({
            "decision_id": decision_id.clone(),
            "continuation_id": params.continuation_id.clone(),
            "selected_task_id": recovery_record.task_id.clone(),
            "selected_run_id": recovery_record.run_id.clone(),
            "expected_progress_fingerprint": params.expected_progress_fingerprint.clone(),
            "expected_aggregate_sequence": params.expected_aggregate_sequence,
            "candidate_count": 1,
            "policy_version": policy_version,
            "authorize": true,
            "authorize_recovery": true,
            "source_task_id": admission.source_task_id.clone(),
            "source_run_id": admission.source_run_id.clone(),
            "recovery_task_id": admission.recovery_task_id.clone(),
            "recovery_run_id": admission.recovery_run_id.clone(),
            "failure_fingerprint": admission.failure_fingerprint.clone(),
            "next_action": "run_recovery_task_explicitly",
            "reason": "Headless continue-once admitted one verification recovery task from bounded verifier failure evidence."
        })),
    ) {
        return error_response(id, -32603, &format!("internal error: {error}"));
    }
    if let Some(continuation_id) = params.continuation_id.as_ref() {
        if let Err(error) = store.tasks().write_headless_continuation_decision(
            &HeadlessContinuationDecisionLookup {
                decision_id: decision_id.clone(),
                continuation_id: continuation_id.clone(),
                selected_task_id: recovery_record.task_id.clone(),
                selected_run_id: recovery_record.run_id.clone(),
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
    let next_route = headless_continue_next_route(&recovery_record, None, &post_progress_overview);
    let next_action = next_route.next_action.clone();

    result_response(
        id,
        json!(HeadlessContinueOnceResult {
            status: HeadlessContinueOnceStatus::TaskInProgress,
            decision_id: Some(decision_id),
            continuation_id: params.continuation_id,
            selected_task_id: Some(recovery_record.task_id),
            selected_run_id: Some(recovery_record.run_id),
            candidate_count: 1,
            expected_progress_fingerprint: params.expected_progress_fingerprint,
            expected_aggregate_sequence: params.expected_aggregate_sequence,
            current_progress_fingerprint: progress_overview.source_fingerprint.clone(),
            current_aggregate_sequence: progress_overview.aggregate_sequence,
            post_progress_fingerprint: Some(post_progress_overview.source_fingerprint),
            post_aggregate_sequence: Some(post_progress_overview.aggregate_sequence),
            stale: false,
            replayed: admission.replayed,
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

fn handle_headless_continue_llm_provider_failure_retry_admission(
    id: Value,
    store: &BrownieStore,
    progress_overview: &TaskListProgressOverview,
    params: HeadlessContinueOnceParams,
) -> JsonRpcResponse<Value> {
    let Some(source) = params.llm_provider_failure_retry_source else {
        return error_response(
            id,
            -32603,
            "internal error: missing LLM provider failure retry source",
        );
    };
    let goal = params
        .llm_provider_failure_retry_goal
        .unwrap_or_else(|| "Retry LLM provider failure".to_string());
    if goal.trim().is_empty() {
        return error_response(
            id,
            -32602,
            "invalid params: llm_provider_failure_retry_goal must not be empty",
        );
    }
    let mode_id = params
        .llm_provider_failure_retry_mode_id
        .or_else(|| Some("provider-runner".to_string()));
    let start_response = handle_task_start(
        id.clone(),
        Some(json!({
            "goal": goal,
            "mode_id": mode_id,
            "llm_provider_failure_retry_source": source,
        })),
    );
    let Some(start_value) = start_response.result else {
        return JsonRpcResponse {
            jsonrpc: JSONRPC_VERSION.to_string(),
            id,
            result: None,
            error: start_response.error,
        };
    };
    let start_result: TaskStartResult = match serde_json::from_value(start_value) {
        Ok(result) => result,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    let Some(admission) = start_result.llm_provider_failure_retry_admission.clone() else {
        return error_response(
            id,
            -32603,
            "internal error: missing LLM provider failure retry admission",
        );
    };
    let retry_record = match store.tasks().get_task(&admission.retry_task_id) {
        Ok(Some(record)) if record.run_id == admission.retry_run_id => record,
        Ok(Some(_)) => {
            return error_response(
                id,
                -32603,
                "internal error: LLM provider retry admission task/run mismatch",
            );
        }
        Ok(None) => {
            return error_response(
                id,
                -32603,
                "internal error: LLM provider retry admission task not found",
            );
        }
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };

    let decision_id = format!("headless_decision_{}", uuid::Uuid::new_v4().simple());
    let policy_version = "headless_continue_once_v1";
    if let Err(error) = store.tasks().append_task_event_with_payload(
        &retry_record,
        LedgerEventKind::HeadlessContinuationDecisionRecorded,
        Some(json!({
            "decision_id": decision_id.clone(),
            "continuation_id": params.continuation_id.clone(),
            "selected_task_id": retry_record.task_id.clone(),
            "selected_run_id": retry_record.run_id.clone(),
            "expected_progress_fingerprint": params.expected_progress_fingerprint.clone(),
            "expected_aggregate_sequence": params.expected_aggregate_sequence,
            "candidate_count": 1,
            "policy_version": policy_version,
            "authorize": true,
            "authorize_provider_failure_retry": true,
            "source_task_id": admission.source_task_id.clone(),
            "source_run_id": admission.source_run_id.clone(),
            "retry_task_id": admission.retry_task_id.clone(),
            "retry_run_id": admission.retry_run_id.clone(),
            "failure_fingerprint": admission.failure_fingerprint.clone(),
            "failure_class": admission.failure_class.clone(),
            "retryable": admission.retryable,
            "next_action": "run_llm_provider_retry_task_explicitly",
            "reason": "Headless continue-once admitted one LLM provider failure retry task from bounded provider failure evidence."
        })),
    ) {
        return error_response(id, -32603, &format!("internal error: {error}"));
    }
    if let Some(continuation_id) = params.continuation_id.as_ref() {
        if let Err(error) = store.tasks().write_headless_continuation_decision(
            &HeadlessContinuationDecisionLookup {
                decision_id: decision_id.clone(),
                continuation_id: continuation_id.clone(),
                selected_task_id: retry_record.task_id.clone(),
                selected_run_id: retry_record.run_id.clone(),
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
    let next_route = headless_continue_next_route(&retry_record, None, &post_progress_overview);
    let next_action = next_route.next_action.clone();

    result_response(
        id,
        json!(HeadlessContinueOnceResult {
            status: HeadlessContinueOnceStatus::TaskInProgress,
            decision_id: Some(decision_id),
            continuation_id: params.continuation_id,
            selected_task_id: Some(retry_record.task_id),
            selected_run_id: Some(retry_record.run_id),
            candidate_count: 1,
            expected_progress_fingerprint: params.expected_progress_fingerprint,
            expected_aggregate_sequence: params.expected_aggregate_sequence,
            current_progress_fingerprint: progress_overview.source_fingerprint.clone(),
            current_aggregate_sequence: progress_overview.aggregate_sequence,
            post_progress_fingerprint: Some(post_progress_overview.source_fingerprint),
            post_aggregate_sequence: Some(post_progress_overview.aggregate_sequence),
            stale: false,
            replayed: admission.replayed,
            task_run_result: None,
            proposal_apply_result: None,
            objective_proposal_authorization_preflight_result: None,
            llm_provider_failure_retry_admission: Some(admission),
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

fn handle_headless_continue_patch_apply_recovery_admission(
    id: Value,
    store: &BrownieStore,
    progress_overview: &TaskListProgressOverview,
    params: HeadlessContinueOnceParams,
) -> JsonRpcResponse<Value> {
    let Some(source) = params.patch_apply_recovery_source else {
        return error_response(
            id,
            -32603,
            "internal error: missing patch apply recovery source",
        );
    };
    let goal = params
        .patch_apply_recovery_goal
        .unwrap_or_else(|| "Recover failed patch apply".to_string());
    if goal.trim().is_empty() {
        return error_response(
            id,
            -32602,
            "invalid params: patch_apply_recovery_goal must not be empty",
        );
    }
    let mode_id = params
        .patch_apply_recovery_mode_id
        .or_else(|| Some("implementer".to_string()));
    let start_response = handle_task_start(
        id.clone(),
        Some(json!({
            "goal": goal,
            "mode_id": mode_id,
            "patch_apply_recovery_source": source,
        })),
    );
    let Some(start_value) = start_response.result else {
        return JsonRpcResponse {
            jsonrpc: JSONRPC_VERSION.to_string(),
            id,
            result: None,
            error: start_response.error,
        };
    };
    let start_result: TaskStartResult = match serde_json::from_value(start_value) {
        Ok(result) => result,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    let Some(admission) = start_result.patch_apply_recovery_admission.clone() else {
        return error_response(
            id,
            -32603,
            "internal error: missing patch apply recovery admission",
        );
    };
    let recovery_record = match store.tasks().get_task(&admission.recovery_task_id) {
        Ok(Some(record)) if record.run_id == admission.recovery_run_id => record,
        Ok(Some(_)) => {
            return error_response(
                id,
                -32603,
                "internal error: patch apply recovery admission task/run mismatch",
            );
        }
        Ok(None) => {
            return error_response(
                id,
                -32603,
                "internal error: patch apply recovery admission task not found",
            );
        }
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };

    let decision_id = format!("headless_decision_{}", uuid::Uuid::new_v4().simple());
    let policy_version = "headless_continue_once_v1";
    if let Err(error) = store.tasks().append_task_event_with_payload(
        &recovery_record,
        LedgerEventKind::HeadlessContinuationDecisionRecorded,
        Some(json!({
            "decision_id": decision_id.clone(),
            "continuation_id": params.continuation_id.clone(),
            "selected_task_id": recovery_record.task_id.clone(),
            "selected_run_id": recovery_record.run_id.clone(),
            "expected_progress_fingerprint": params.expected_progress_fingerprint.clone(),
            "expected_aggregate_sequence": params.expected_aggregate_sequence,
            "candidate_count": 1,
            "policy_version": policy_version,
            "authorize": true,
            "authorize_patch_apply_recovery": true,
            "source_run_id": admission.source_run_id.clone(),
            "source_proposal_id": admission.source_proposal_id.clone(),
            "source_apply_id": admission.source_apply_id.clone(),
            "recovery_task_id": admission.recovery_task_id.clone(),
            "recovery_run_id": admission.recovery_run_id.clone(),
            "source_apply_fingerprint": admission.source_apply_fingerprint.clone(),
            "failure_fingerprint": admission.failure_fingerprint.clone(),
            "next_action": "run_recovery_task_explicitly",
            "reason": "Headless continue-once admitted one patch apply recovery task from bounded failed patch apply evidence."
        })),
    ) {
        return error_response(id, -32603, &format!("internal error: {error}"));
    }
    if let Some(continuation_id) = params.continuation_id.as_ref() {
        if let Err(error) = store.tasks().write_headless_continuation_decision(
            &HeadlessContinuationDecisionLookup {
                decision_id: decision_id.clone(),
                continuation_id: continuation_id.clone(),
                selected_task_id: recovery_record.task_id.clone(),
                selected_run_id: recovery_record.run_id.clone(),
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
    let next_route = headless_continue_next_route(&recovery_record, None, &post_progress_overview);
    let next_action = next_route.next_action.clone();

    result_response(
        id,
        json!(HeadlessContinueOnceResult {
            status: HeadlessContinueOnceStatus::TaskInProgress,
            decision_id: Some(decision_id),
            continuation_id: params.continuation_id,
            selected_task_id: Some(recovery_record.task_id),
            selected_run_id: Some(recovery_record.run_id),
            candidate_count: 1,
            expected_progress_fingerprint: params.expected_progress_fingerprint,
            expected_aggregate_sequence: params.expected_aggregate_sequence,
            current_progress_fingerprint: progress_overview.source_fingerprint.clone(),
            current_aggregate_sequence: progress_overview.aggregate_sequence,
            post_progress_fingerprint: Some(post_progress_overview.source_fingerprint),
            post_aggregate_sequence: Some(post_progress_overview.aggregate_sequence),
            stale: false,
            replayed: admission.replayed,
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

fn handle_headless_continue_llm_provider_failure_retry_run(
    id: Value,
    store: &BrownieStore,
    progress_overview: &TaskListProgressOverview,
    params: HeadlessContinueOnceParams,
) -> JsonRpcResponse<Value> {
    let Some(target) = params.llm_provider_failure_retry_run_target.as_ref() else {
        return error_response(
            id,
            -32603,
            "internal error: missing LLM provider failure retry run target",
        );
    };
    let selected_record =
        match llm_provider_failure_retry_record_for_headless_run_target(store, target) {
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
                "internal error: LLM provider retry run task/run mismatch after execution",
            );
        }
        Ok(None) => {
            return error_response(
                id,
                -32603,
                "internal error: LLM provider retry run task not found after execution",
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
            "selected_task_id": post_run_record.task_id.clone(),
            "selected_run_id": post_run_record.run_id.clone(),
            "expected_progress_fingerprint": params.expected_progress_fingerprint.clone(),
            "expected_aggregate_sequence": params.expected_aggregate_sequence,
            "candidate_count": 1,
            "policy_version": policy_version,
            "authorize": true,
            "authorize_provider_failure_retry_run": true,
            "source_task_id": target.source_task_id.clone(),
            "source_run_id": target.source_run_id.clone(),
            "retry_task_id": target.retry_task_id.clone(),
            "retry_run_id": target.retry_run_id.clone(),
            "failure_fingerprint": target.expected_failure_fingerprint.clone(),
            "next_action": "inspect_progress_overview",
            "reason": "Headless continue-once ran one targeted LLM provider retry task from bounded route evidence."
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

fn handle_headless_continue_patch_apply_recovery_run(
    id: Value,
    store: &BrownieStore,
    progress_overview: &TaskListProgressOverview,
    params: HeadlessContinueOnceParams,
) -> JsonRpcResponse<Value> {
    let Some(target) = params.patch_apply_recovery_run_target.as_ref() else {
        return error_response(
            id,
            -32603,
            "internal error: missing patch apply recovery run target",
        );
    };
    let selected_record = match patch_apply_recovery_record_for_headless_run_target(store, target) {
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
                "internal error: patch apply recovery run task/run mismatch after execution",
            );
        }
        Ok(None) => {
            return error_response(
                id,
                -32603,
                "internal error: patch apply recovery run task not found after execution",
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
            "selected_task_id": post_run_record.task_id.clone(),
            "selected_run_id": post_run_record.run_id.clone(),
            "expected_progress_fingerprint": params.expected_progress_fingerprint.clone(),
            "expected_aggregate_sequence": params.expected_aggregate_sequence,
            "candidate_count": 1,
            "policy_version": policy_version,
            "authorize": true,
            "authorize_patch_apply_recovery_run": true,
            "source_run_id": target.source_run_id.clone(),
            "source_proposal_id": target.source_proposal_id.clone(),
            "source_apply_id": target.source_apply_id.clone(),
            "recovery_task_id": target.recovery_task_id.clone(),
            "recovery_run_id": target.recovery_run_id.clone(),
            "source_apply_fingerprint": target.expected_source_apply_fingerprint.clone(),
            "failure_fingerprint": target.expected_failure_fingerprint.clone(),
            "next_action": "review_and_authorize_recovery_proposal",
            "reason": "Headless continue-once ran one targeted patch apply recovery task from bounded route evidence."
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

fn handle_headless_continue_patch_apply_recovery_apply(
    id: Value,
    store: &BrownieStore,
    progress_overview: &TaskListProgressOverview,
    params: HeadlessContinueOnceParams,
) -> JsonRpcResponse<Value> {
    let Some(target) = params.patch_apply_recovery_apply_target.as_ref() else {
        return error_response(
            id,
            -32603,
            "internal error: missing patch apply recovery apply target",
        );
    };
    let selected_record = match patch_apply_recovery_record_for_headless_apply_target(store, target)
    {
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
    let patch_hunks = match patch_hunks_from_apply_params(&ProposalApplyParams {
        run_id: target.recovery_run_id.clone(),
        proposal_id: target.recovery_proposal_id.clone(),
        expected_target_sha256: Some(target.expected_target_sha256.clone()),
        expected_target_absent: None,
        replacement_content: None,
        patch_old_text: target.patch_old_text.clone(),
        patch_new_text: target.patch_new_text.clone(),
        patch_hunks: target.patch_hunks.clone(),
        authorize: true,
        transaction_items: None,
        transaction_recovery_source: None,
    }) {
        Ok(hunks) => hunks,
        Err(message) => return error_response(id, -32602, message),
    };
    let (proposal, apply_result) = match apply_proposal(
        store,
        &ProposalApplyParams {
            run_id: target.recovery_run_id.clone(),
            proposal_id: target.recovery_proposal_id.clone(),
            expected_target_sha256: Some(target.expected_target_sha256.clone()),
            expected_target_absent: None,
            replacement_content: None,
            patch_old_text: target.patch_old_text.clone(),
            patch_new_text: target.patch_new_text.clone(),
            patch_hunks: target.patch_hunks.clone(),
            authorize: true,
            transaction_items: None,
            transaction_recovery_source: None,
        },
    ) {
        Ok(result) => result,
        Err(message) => return error_response(id, -32602, &message),
    };
    let apply_evidence = match latest_recovery_apply_evidence(
        store,
        &target.recovery_run_id,
        &target.recovery_proposal_id,
        &apply_result.apply_id,
    ) {
        Ok(evidence) => evidence,
        Err(error) => {
            return match error {
                VerificationRecoveryAdmissionError::InvalidParams(message) => {
                    error_response(id, -32602, &message)
                }
                VerificationRecoveryAdmissionError::Internal(message) => {
                    error_response(id, -32603, &format!("internal error: {message}"))
                }
            }
        }
    };
    let decision_id = format!("headless_decision_{}", uuid::Uuid::new_v4().simple());
    let policy_version = "headless_continue_once_v1";
    if let Err(error) = store.tasks().append_task_event_with_payload(
        &selected_record,
        LedgerEventKind::HeadlessContinuationDecisionRecorded,
        Some(json!({
            "decision_id": decision_id.clone(),
            "continuation_id": params.continuation_id.clone(),
            "selected_task_id": selected_record.task_id.clone(),
            "selected_run_id": selected_record.run_id.clone(),
            "expected_progress_fingerprint": params.expected_progress_fingerprint.clone(),
            "expected_aggregate_sequence": params.expected_aggregate_sequence,
            "candidate_count": 1,
            "policy_version": policy_version,
            "authorize": true,
            "authorize_patch_apply_recovery_apply": true,
            "source_run_id": target.source_run_id.clone(),
            "source_proposal_id": target.source_proposal_id.clone(),
            "source_apply_id": target.source_apply_id.clone(),
            "recovery_task_id": target.recovery_task_id.clone(),
            "recovery_run_id": target.recovery_run_id.clone(),
            "recovery_proposal_id": target.recovery_proposal_id.clone(),
            "proposal_id": target.recovery_proposal_id.clone(),
            "source_apply_fingerprint": target.expected_source_apply_fingerprint.clone(),
            "failure_fingerprint": target.expected_failure_fingerprint.clone(),
            "expected_target_sha256": target.expected_target_sha256.clone(),
            "hunk_count": patch_hunks.len(),
            "apply_id": apply_result.apply_id.clone(),
            "apply_fingerprint": apply_evidence.apply_fingerprint.clone(),
            "next_action": "inspect_progress_overview",
            "reason": "Headless continue-once applied one approved patch recovery proposal under explicit authorization."
        })),
    ) {
        return error_response(id, -32603, &format!("internal error: {error}"));
    }
    if let Some(continuation_id) = params.continuation_id.as_ref() {
        if let Err(error) = store.tasks().write_headless_continuation_decision(
            &HeadlessContinuationDecisionLookup {
                decision_id: decision_id.clone(),
                continuation_id: continuation_id.clone(),
                selected_task_id: selected_record.task_id.clone(),
                selected_run_id: selected_record.run_id.clone(),
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
    let next_route = HeadlessContinueRoute {
        kind: HeadlessContinueRouteKind::InspectProgressOverview,
        reason:
            "Patch recovery proposal was applied with post-write verification; inspect progress."
                .to_string(),
        task_id: Some(target.recovery_task_id.clone()),
        run_id: Some(target.recovery_run_id.clone()),
        proposal_id: Some(target.recovery_proposal_id.clone()),
        apply_id: Some(apply_result.apply_id.clone()),
        failure_fingerprint: Some(target.expected_failure_fingerprint.clone()),
        apply_fingerprint: Some(apply_evidence.apply_fingerprint),
        progress_fingerprint: Some(post_progress_overview.source_fingerprint.clone()),
        aggregate_sequence: Some(post_progress_overview.aggregate_sequence),
        next_action: "inspect_progress_overview".to_string(),
    };
    let next_action = next_route.next_action.clone();

    result_response(
        id,
        json!(HeadlessContinueOnceResult {
            status: HeadlessContinueOnceStatus::TaskExecuted,
            decision_id: Some(decision_id),
            continuation_id: params.continuation_id,
            selected_task_id: Some(selected_record.task_id.clone()),
            selected_run_id: Some(selected_record.run_id.clone()),
            candidate_count: 1,
            expected_progress_fingerprint: params.expected_progress_fingerprint,
            expected_aggregate_sequence: params.expected_aggregate_sequence,
            current_progress_fingerprint: progress_overview.source_fingerprint.clone(),
            current_aggregate_sequence: progress_overview.aggregate_sequence,
            post_progress_fingerprint: Some(post_progress_overview.source_fingerprint),
            post_aggregate_sequence: Some(post_progress_overview.aggregate_sequence),
            stale: false,
            replayed: false,
            task_run_result: None,
            proposal_apply_result: Some(ProposalApplyResult {
                proposal,
                apply_result,
            }),
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

fn handle_headless_continue_verification_recovery_retry_run(
    id: Value,
    store: &BrownieStore,
    progress_overview: &TaskListProgressOverview,
    params: HeadlessContinueOnceParams,
) -> JsonRpcResponse<Value> {
    let Some(target) = params.verification_recovery_retry_run_target.as_ref() else {
        return error_response(
            id,
            -32603,
            "internal error: missing verification recovery retry run target",
        );
    };
    let selected_record =
        match verification_recovery_retry_record_for_headless_run_target(store, target) {
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
                "internal error: verification retry run task/run mismatch after execution",
            );
        }
        Ok(None) => {
            return error_response(
                id,
                -32603,
                "internal error: verification retry run task not found after execution",
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
            "selected_task_id": post_run_record.task_id.clone(),
            "selected_run_id": post_run_record.run_id.clone(),
            "expected_progress_fingerprint": params.expected_progress_fingerprint.clone(),
            "expected_aggregate_sequence": params.expected_aggregate_sequence,
            "candidate_count": 1,
            "policy_version": policy_version,
            "authorize": true,
            "authorize_verification_retry_run": true,
            "proposal_id": target.proposal_id.clone(),
            "apply_id": target.apply_id.clone(),
            "failure_fingerprint": target.expected_failure_fingerprint.clone(),
            "apply_fingerprint": target.expected_apply_fingerprint.clone(),
            "next_action": "inspect_progress_overview",
            "reason": "Headless continue-once ran one targeted verification retry task from bounded route evidence."
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

fn handle_headless_continue_verification_recovery_apply(
    id: Value,
    store: &BrownieStore,
    progress_overview: &TaskListProgressOverview,
    params: HeadlessContinueOnceParams,
) -> JsonRpcResponse<Value> {
    let Some(target) = params.verification_recovery_apply_target.as_ref() else {
        return error_response(
            id,
            -32603,
            "internal error: missing verification recovery apply target",
        );
    };
    let selected_record =
        match verification_recovery_record_for_headless_apply_target(store, target) {
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
    let (proposal, apply_result) = match apply_proposal(
        store,
        &ProposalApplyParams {
            run_id: target.recovery_run_id.clone(),
            proposal_id: target.proposal_id.clone(),
            expected_target_sha256: target.expected_target_sha256.clone(),
            expected_target_absent: target.expected_target_absent,
            replacement_content: target.replacement_content.clone(),
            patch_old_text: None,
            patch_new_text: None,
            patch_hunks: None,
            authorize: true,
            transaction_items: None,
            transaction_recovery_source: None,
        },
    ) {
        Ok(result) => result,
        Err(message) => return error_response(id, -32602, &message),
    };
    let apply_evidence = match latest_recovery_apply_evidence(
        store,
        &target.recovery_run_id,
        &target.proposal_id,
        &apply_result.apply_id,
    ) {
        Ok(evidence) => evidence,
        Err(error) => {
            return match error {
                VerificationRecoveryAdmissionError::InvalidParams(message) => {
                    error_response(id, -32602, &message)
                }
                VerificationRecoveryAdmissionError::Internal(message) => {
                    error_response(id, -32603, &format!("internal error: {message}"))
                }
            }
        }
    };
    let decision_id = format!("headless_decision_{}", uuid::Uuid::new_v4().simple());
    let policy_version = "headless_continue_once_v1";
    if let Err(error) = store.tasks().append_task_event_with_payload(
        &selected_record,
        LedgerEventKind::HeadlessContinuationDecisionRecorded,
        Some(json!({
            "decision_id": decision_id.clone(),
            "continuation_id": params.continuation_id.clone(),
            "selected_task_id": selected_record.task_id.clone(),
            "selected_run_id": selected_record.run_id.clone(),
            "expected_progress_fingerprint": params.expected_progress_fingerprint.clone(),
            "expected_aggregate_sequence": params.expected_aggregate_sequence,
            "candidate_count": 1,
            "policy_version": policy_version,
            "authorize": true,
            "authorize_recovery_apply": true,
            "source_task_id": target.source_task_id.clone(),
            "source_run_id": target.source_run_id.clone(),
            "failure_fingerprint": target.expected_failure_fingerprint.clone(),
            "proposal_id": target.proposal_id.clone(),
            "apply_id": apply_result.apply_id.clone(),
            "apply_fingerprint": apply_evidence.apply_fingerprint.clone(),
            "next_action": "start_verification_retry_explicitly",
            "reason": "Headless continue-once applied one approved recovery-scoped proposal under explicit authorization."
        })),
    ) {
        return error_response(id, -32603, &format!("internal error: {error}"));
    }
    if let Some(continuation_id) = params.continuation_id.as_ref() {
        if let Err(error) = store.tasks().write_headless_continuation_decision(
            &HeadlessContinuationDecisionLookup {
                decision_id: decision_id.clone(),
                continuation_id: continuation_id.clone(),
                selected_task_id: selected_record.task_id.clone(),
                selected_run_id: selected_record.run_id.clone(),
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
    let next_route = HeadlessContinueRoute {
        kind: HeadlessContinueRouteKind::StartVerificationRetryExplicitly,
        reason: "Recovery proposal was applied with post-write verification; start verification retry explicitly."
            .to_string(),
        task_id: Some(target.source_task_id.clone()),
        run_id: Some(target.source_run_id.clone()),
        proposal_id: Some(target.proposal_id.clone()),
        apply_id: Some(apply_result.apply_id.clone()),
        failure_fingerprint: Some(target.expected_failure_fingerprint.clone()),
        apply_fingerprint: Some(apply_evidence.apply_fingerprint),
        progress_fingerprint: Some(post_progress_overview.source_fingerprint.clone()),
        aggregate_sequence: Some(post_progress_overview.aggregate_sequence),
        next_action: "start_verification_retry_explicitly".to_string(),
    };
    let next_action = next_route.next_action.clone();

    result_response(
        id,
        json!(HeadlessContinueOnceResult {
            status: HeadlessContinueOnceStatus::TaskExecuted,
            decision_id: Some(decision_id),
            continuation_id: params.continuation_id,
            selected_task_id: Some(selected_record.task_id.clone()),
            selected_run_id: Some(selected_record.run_id.clone()),
            candidate_count: 1,
            expected_progress_fingerprint: params.expected_progress_fingerprint,
            expected_aggregate_sequence: params.expected_aggregate_sequence,
            current_progress_fingerprint: progress_overview.source_fingerprint.clone(),
            current_aggregate_sequence: progress_overview.aggregate_sequence,
            post_progress_fingerprint: Some(post_progress_overview.source_fingerprint),
            post_aggregate_sequence: Some(post_progress_overview.aggregate_sequence),
            stale: false,
            replayed: false,
            task_run_result: None,
            proposal_apply_result: Some(ProposalApplyResult {
                proposal,
                apply_result,
            }),
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

fn handle_headless_continue_verification_recovery_run(
    id: Value,
    store: &BrownieStore,
    progress_overview: &TaskListProgressOverview,
    params: HeadlessContinueOnceParams,
) -> JsonRpcResponse<Value> {
    let Some(target) = params.verification_recovery_run_target.as_ref() else {
        return error_response(
            id,
            -32603,
            "internal error: missing verification recovery run target",
        );
    };
    let selected_record = match verification_recovery_record_for_headless_run_target(store, target)
    {
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
    let decision_id = format!("headless_decision_{}", uuid::Uuid::new_v4().simple());
    let policy_version = "headless_continue_once_v1";

    let task_run_params = match params.verification_recovery_context_read.as_ref() {
        Some(context_read) => json!({
            "task_id": selected_record.task_id.clone(),
            "verification_recovery_context_read": context_read,
        }),
        None => json!({
            "task_id": selected_record.task_id.clone(),
        }),
    };
    let task_run_response = handle_task_run(id.clone(), Some(task_run_params));
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
                "internal error: verification recovery run task/run mismatch after execution",
            );
        }
        Ok(None) => {
            return error_response(
                id,
                -32603,
                "internal error: verification recovery run task not found after execution",
            );
        }
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    let context_read_summary = task_run_result.verification_recovery_context_read.clone();
    if let Err(error) = store.tasks().append_task_event_with_payload(
        &post_run_record,
        LedgerEventKind::HeadlessContinuationDecisionRecorded,
        Some(json!({
            "decision_id": decision_id.clone(),
            "continuation_id": params.continuation_id.clone(),
            "selected_task_id": post_run_record.task_id.clone(),
            "selected_run_id": post_run_record.run_id.clone(),
            "expected_progress_fingerprint": params.expected_progress_fingerprint.clone(),
            "expected_aggregate_sequence": params.expected_aggregate_sequence,
            "candidate_count": 1,
            "policy_version": policy_version,
            "authorize": true,
            "authorize_recovery_run": true,
            "source_task_id": target.source_task_id.clone(),
            "source_run_id": target.source_run_id.clone(),
            "failure_fingerprint": target.expected_failure_fingerprint.clone(),
            "verification_recovery_context_read": context_read_summary.is_some(),
            "context_read_id": context_read_summary
                .as_ref()
                .map(|summary| summary.context_read_id.clone()),
            "diagnostic_index": context_read_summary
                .as_ref()
                .map(|summary| summary.diagnostic_index),
            "excerpt_sha256": context_read_summary
                .as_ref()
                .map(|summary| summary.excerpt_sha256.clone()),
            "read_path_fingerprint": context_read_summary
                .as_ref()
                .map(|summary| summary.read_path_fingerprint.clone()),
            "excerpt_bytes": context_read_summary
                .as_ref()
                .map(|summary| summary.excerpt_bytes),
            "next_action": "review_and_authorize_recovery_proposal",
            "reason": "Headless continue-once ran one targeted verification recovery task from bounded route evidence."
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

fn handle_headless_continue_parent_join_run(
    id: Value,
    store: &BrownieStore,
    progress_overview: &TaskListProgressOverview,
    params: HeadlessContinueOnceParams,
) -> JsonRpcResponse<Value> {
    let Some(target) = params.parent_join_run_target.as_ref() else {
        return error_response(id, -32603, "internal error: missing parent join run target");
    };
    let selected_record = match parent_join_record_for_headless_run_target(store, target) {
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
                "internal error: parent join run task/run mismatch after execution",
            );
        }
        Ok(None) => {
            return error_response(
                id,
                -32603,
                "internal error: parent join run task not found after execution",
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
            "selected_task_id": post_run_record.task_id.clone(),
            "selected_run_id": post_run_record.run_id.clone(),
            "expected_progress_fingerprint": params.expected_progress_fingerprint.clone(),
            "expected_aggregate_sequence": params.expected_aggregate_sequence,
            "candidate_count": 1,
            "policy_version": policy_version,
            "authorize": true,
            "authorize_parent_join_run": true,
            "parent_task_id": target.parent_task_id.clone(),
            "parent_run_id": target.parent_run_id.clone(),
            "child_completion_fingerprint": target.expected_child_completion_fingerprint.clone(),
            "child_completion_child_count": target.expected_child_completion_child_count,
            "child_terminal_completed_count": target.expected_terminal_completed_child_count,
            "child_terminal_failed_count": target.expected_terminal_failed_child_count,
            "next_action": "inspect_progress_overview",
            "reason": "Headless continue-once ran one completed parent join continuation from bounded child completion evidence."
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

fn handle_headless_continue_budget(
    id: Value,
    params: HeadlessContinueOnceParams,
) -> JsonRpcResponse<Value> {
    let max_steps = params.max_steps.unwrap_or(1);
    let root_continuation_id = params
        .continuation_id
        .clone()
        .expect("validated budget continuation id");
    let mut expected_progress_fingerprint = params.expected_progress_fingerprint.clone();
    let mut expected_aggregate_sequence = params.expected_aggregate_sequence;
    let mut steps = Vec::new();
    let mut executed_count = 0usize;
    let mut replayed_count = 0usize;
    let mut final_result: Option<HeadlessContinueOnceResult> = None;
    let mut stop_reason = "budget_exhausted".to_string();

    for step_index in 0..max_steps {
        let step_continuation_id = format!("{root_continuation_id}.step.{}", step_index + 1);
        let response = handle_headless_continue_once(
            id.clone(),
            Some(json!({
                "authorize": true,
                "expected_progress_fingerprint": expected_progress_fingerprint,
                "expected_aggregate_sequence": expected_aggregate_sequence,
                "continuation_id": step_continuation_id,
                "context_budget": params.context_budget.clone()
            })),
        );
        let Some(result_value) = response.result else {
            return JsonRpcResponse {
                jsonrpc: JSONRPC_VERSION.to_string(),
                id,
                result: None,
                error: response.error,
            };
        };
        let result: HeadlessContinueOnceResult = match serde_json::from_value(result_value) {
            Ok(result) => result,
            Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
        };

        if result.status == HeadlessContinueOnceStatus::TaskExecuted {
            executed_count += 1;
        }
        if result.replayed {
            replayed_count += 1;
        }
        steps.push(HeadlessContinueStepResult {
            step_index: step_index + 1,
            status: result.status.clone(),
            decision_id: result.decision_id.clone(),
            continuation_id: result.continuation_id.clone(),
            selected_task_id: result.selected_task_id.clone(),
            selected_run_id: result.selected_run_id.clone(),
            candidate_count: result.candidate_count,
            current_progress_fingerprint: result.current_progress_fingerprint.clone(),
            current_aggregate_sequence: result.current_aggregate_sequence,
            post_progress_fingerprint: result.post_progress_fingerprint.clone(),
            post_aggregate_sequence: result.post_aggregate_sequence,
            replayed: result.replayed,
            context_budget: result
                .task_run_result
                .as_ref()
                .and_then(|task_run_result| task_run_result.context_budget.clone()),
            terminal_completion_evidence: result
                .task_run_result
                .as_ref()
                .and_then(|task_run_result| task_run_result.completion_evidence.clone()),
            parent_join_readiness_outcome: result
                .task_run_result
                .as_ref()
                .and_then(|task_run_result| task_run_result.parent_join_readiness_outcome.clone()),
            next_route: result.next_route.clone(),
            next_action: result.next_action.clone(),
        });

        let can_continue = result.status == HeadlessContinueOnceStatus::TaskExecuted
            && result
                .next_route
                .as_ref()
                .map(|route| route.kind == HeadlessContinueRouteKind::InspectProgressOverview)
                .unwrap_or(false)
            && step_index + 1 < max_steps;
        if !can_continue {
            stop_reason = headless_continue_budget_stop_reason(&result, step_index + 1, max_steps);
            final_result = Some(result);
            break;
        }

        let Some(post_fingerprint) = result.post_progress_fingerprint.clone() else {
            stop_reason = "missing_post_progress".to_string();
            final_result = Some(result);
            break;
        };
        let Some(post_sequence) = result.post_aggregate_sequence else {
            stop_reason = "missing_post_progress".to_string();
            final_result = Some(result);
            break;
        };
        expected_progress_fingerprint = post_fingerprint;
        expected_aggregate_sequence = post_sequence;
        final_result = Some(result);
    }

    let mut result = final_result.unwrap_or(HeadlessContinueOnceResult {
        status: HeadlessContinueOnceStatus::NoEligibleTask,
        decision_id: None,
        continuation_id: Some(root_continuation_id.clone()),
        selected_task_id: None,
        selected_run_id: None,
        candidate_count: 0,
        expected_progress_fingerprint: params.expected_progress_fingerprint,
        expected_aggregate_sequence: params.expected_aggregate_sequence,
        current_progress_fingerprint: expected_progress_fingerprint,
        current_aggregate_sequence: expected_aggregate_sequence,
        post_progress_fingerprint: None,
        post_aggregate_sequence: None,
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
        next_route: None,
        max_steps: None,
        step_count: None,
        executed_count: None,
        replayed_count: None,
        stop_reason: None,
        steps: Vec::new(),
        next_action: "inspect_progress_overview".to_string(),
    });
    if steps.len() == max_steps as usize
        && result.status == HeadlessContinueOnceStatus::TaskExecuted
        && result
            .next_route
            .as_ref()
            .map(|route| route.kind == HeadlessContinueRouteKind::InspectProgressOverview)
            .unwrap_or(false)
    {
        stop_reason = "budget_exhausted".to_string();
    }
    result.continuation_id = Some(root_continuation_id);
    result.max_steps = Some(max_steps);
    result.step_count = Some(steps.len());
    result.executed_count = Some(executed_count);
    result.replayed_count = Some(replayed_count);
    result.stop_reason = Some(stop_reason);
    result.steps = steps;
    result_response(id, json!(result))
}

fn headless_continue_budget_stop_reason(
    result: &HeadlessContinueOnceResult,
    completed_step: u8,
    max_steps: u8,
) -> String {
    match result.status {
        HeadlessContinueOnceStatus::StaleProgress => "stale_progress".to_string(),
        HeadlessContinueOnceStatus::NoEligibleTask => "no_eligible_task".to_string(),
        HeadlessContinueOnceStatus::TaskInProgress => "task_in_progress".to_string(),
        HeadlessContinueOnceStatus::TaskExecuted => {
            if completed_step >= max_steps {
                return "budget_exhausted".to_string();
            }
            match result.next_route.as_ref().map(|route| &route.kind) {
                Some(HeadlessContinueRouteKind::InspectProgressOverview) => {
                    "inspect_progress_overview".to_string()
                }
                Some(HeadlessContinueRouteKind::RefreshProgressOverview) => {
                    "stale_progress".to_string()
                }
                Some(HeadlessContinueRouteKind::NoEligibleTask) => "no_eligible_task".to_string(),
                Some(HeadlessContinueRouteKind::StartVerificationRecoveryExplicitly) => {
                    "explicit_verification_recovery_boundary".to_string()
                }
                Some(HeadlessContinueRouteKind::RunRecoveryTaskExplicitly) => {
                    "explicit_recovery_task_run_boundary".to_string()
                }
                Some(HeadlessContinueRouteKind::ReviewAndAuthorizeRecoveryProposal) => {
                    "explicit_recovery_proposal_review_boundary".to_string()
                }
                Some(HeadlessContinueRouteKind::ReviewAndAuthorizeObjectiveProposal) => {
                    "explicit_objective_proposal_review_boundary".to_string()
                }
                Some(HeadlessContinueRouteKind::ApplyApprovedRecoveryProposalExplicitly) => {
                    "explicit_recovery_apply_boundary".to_string()
                }
                Some(HeadlessContinueRouteKind::ApplyAuthorizedObjectiveProposalExplicitly) => {
                    "explicit_objective_apply_boundary".to_string()
                }
                Some(HeadlessContinueRouteKind::VerifyObjectiveApplyExplicitly) => {
                    "explicit_objective_apply_verification_boundary".to_string()
                }
                Some(HeadlessContinueRouteKind::AcceptObjectiveCompletionExplicitly) => {
                    "explicit_objective_completion_acceptance_boundary".to_string()
                }
                Some(HeadlessContinueRouteKind::StartVerificationRetryExplicitly) => {
                    "explicit_verification_retry_boundary".to_string()
                }
                Some(HeadlessContinueRouteKind::RunVerificationRetryTaskExplicitly) => {
                    "explicit_verification_retry_task_run_boundary".to_string()
                }
                Some(HeadlessContinueRouteKind::RunLlmProviderRetryTaskExplicitly) => {
                    "explicit_llm_provider_retry_task_run_boundary".to_string()
                }
                Some(HeadlessContinueRouteKind::AdmitProductContinuationTaskExplicitly) => {
                    "explicit_product_continuation_admission_boundary".to_string()
                }
                Some(HeadlessContinueRouteKind::RunProductContinuationTaskExplicitly) => {
                    "explicit_product_continuation_task_run_boundary".to_string()
                }
                Some(HeadlessContinueRouteKind::FetchSelectedModePackCandidateExplicitly) => {
                    "explicit_modepack_candidate_fetch_boundary".to_string()
                }
                Some(
                    HeadlessContinueRouteKind::VerifySelectedModePackCandidateProvenanceExplicitly,
                ) => "explicit_modepack_candidate_provenance_boundary".to_string(),
                Some(HeadlessContinueRouteKind::ApproveVerifiedModePackCandidateExplicitly) => {
                    "explicit_modepack_candidate_approval_boundary".to_string()
                }
                Some(
                    HeadlessContinueRouteKind::ReplaceActiveWithApprovedModePackCandidateExplicitly,
                ) => "explicit_modepack_candidate_replacement_boundary".to_string(),
                Some(HeadlessContinueRouteKind::RunParentTaskExplicitly) => {
                    "explicit_parent_join_boundary".to_string()
                }
                None => "missing_next_route".to_string(),
            }
        }
    }
}

fn headless_terminal_completion_evidence_from_steps(
    steps: &[HeadlessContinueStepResult],
    fallback: Option<&TaskRunCompletionEvidence>,
) -> Option<TaskRunCompletionEvidence> {
    steps
        .iter()
        .rev()
        .find_map(|step| step.terminal_completion_evidence.clone())
        .or_else(|| fallback.cloned())
}

fn headless_continue_once_replay_result(
    id: Value,
    store: &BrownieStore,
    progress_overview: &TaskListProgressOverview,
    params: HeadlessContinueOnceParams,
    decision: HeadlessContinuationDecisionLookup,
) -> JsonRpcResponse<Value> {
    let selected_record = match store.tasks().get_task(&decision.selected_task_id) {
        Ok(Some(record)) if record.run_id == decision.selected_run_id => record,
        Ok(Some(_)) => {
            return error_response(
                id,
                -32603,
                "internal error: headless continuation decision selected task/run mismatch",
            );
        }
        Ok(None) => {
            return error_response(
                id,
                -32603,
                "internal error: headless continuation decision selected task not found",
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
    let recovery_apply_replay = headless_recovery_apply_result_for_replay(
        store,
        &selected_record,
        &decision,
        &post_progress_overview,
    )
    .map_err(|message| error_response(id.clone(), -32603, &format!("internal error: {message}")));
    let recovery_apply_replay = match recovery_apply_replay {
        Ok(replay) => replay,
        Err(response) => return response,
    };
    let (proposal_apply_result, next_route) =
        if let Some((proposal_apply_result, apply_route)) = recovery_apply_replay {
            (Some(proposal_apply_result), apply_route)
        } else {
            (None, next_route)
        };
    let status = if task_run_result.is_some() || proposal_apply_result.is_some() {
        HeadlessContinueOnceStatus::TaskExecuted
    } else {
        HeadlessContinueOnceStatus::TaskInProgress
    };
    let llm_provider_failure_retry_admission =
        llm_provider_failure_retry_admission_for_headless_replay(&selected_record);
    let next_action = next_route.next_action.clone();

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
            proposal_apply_result,
            objective_proposal_authorization_preflight_result: None,
            llm_provider_failure_retry_admission,
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

fn llm_provider_failure_retry_admission_for_headless_replay(
    record: &TaskRecord,
) -> Option<LlmProviderFailureRetryAdmission> {
    let provenance = record.llm_provider_failure_retry_provenance.as_ref()?;
    Some(LlmProviderFailureRetryAdmission {
        source_task_id: provenance.source_task_id.clone(),
        source_run_id: provenance.source_run_id.clone(),
        retry_task_id: record.task_id.clone(),
        retry_run_id: record.run_id.clone(),
        failure_fingerprint: provenance.failure_fingerprint.clone(),
        failure_class: provenance.failure_class.clone(),
        retryable: provenance.retryable,
        retry_running_enabled: false,
        next_action: "run_llm_provider_retry_task_explicitly".to_string(),
        replayed: true,
    })
}

fn headless_continuation_decision_for_replay(
    store: &BrownieStore,
    tasks: &[TaskRecord],
    continuation_id: &str,
) -> Result<Option<HeadlessContinuationDecisionLookup>, String> {
    if let Some(indexed) = store
        .tasks()
        .read_headless_continuation_decision(continuation_id)
        .map_err(|error| error.to_string())?
    {
        if let Some(scanned) =
            headless_continuation_decision_from_task_ledgers(store, tasks, continuation_id)?
        {
            if scanned != indexed {
                return Err(format!(
                    "conflicting headless continuation decision for {continuation_id}"
                ));
            }
        }
        return Ok(Some(indexed));
    }
    let Some(scanned) =
        headless_continuation_decision_from_task_ledgers(store, tasks, continuation_id)?
    else {
        return Ok(None);
    };
    store
        .tasks()
        .write_headless_continuation_decision(&scanned)
        .map_err(|error| error.to_string())?;
    Ok(Some(scanned))
}

fn headless_recovery_apply_result_for_replay(
    store: &BrownieStore,
    selected_record: &TaskRecord,
    decision: &HeadlessContinuationDecisionLookup,
    progress_overview: &TaskListProgressOverview,
) -> Result<Option<(ProposalApplyResult, HeadlessContinueRoute)>, String> {
    let events = store
        .tasks()
        .read_ledger_events(&selected_record.run_id)
        .map_err(|error| error.to_string())?;
    let decision_payload = events.iter().rev().find_map(|event| {
        if event.kind != LedgerEventKind::HeadlessContinuationDecisionRecorded {
            return None;
        }
        let payload = event.payload.as_ref()?;
        if payload.get("decision_id").and_then(Value::as_str) != Some(decision.decision_id.as_str())
            || (payload
                .get("authorize_recovery_apply")
                .and_then(Value::as_bool)
                != Some(true)
                && payload
                    .get("authorize_patch_apply_recovery_apply")
                    .and_then(Value::as_bool)
                    != Some(true)
                && payload
                    .get("authorize_objective_proposal_apply")
                    .and_then(Value::as_bool)
                    != Some(true))
        {
            return None;
        }
        Some(payload.clone())
    });
    let Some(decision_payload) = decision_payload else {
        return Ok(None);
    };
    let proposal_id = decision_payload
        .get("proposal_id")
        .and_then(Value::as_str)
        .ok_or_else(|| "headless recovery apply decision missing proposal_id".to_string())?;
    let apply_id = decision_payload
        .get("apply_id")
        .and_then(Value::as_str)
        .ok_or_else(|| "headless recovery apply decision missing apply_id".to_string())?;
    let apply_payload = events
        .iter()
        .rev()
        .find_map(|event| {
            if event.kind != LedgerEventKind::WorkspacePatchApplyResultRecorded {
                return None;
            }
            let payload = event.payload.as_ref()?;
            if payload.get("proposal_id").and_then(Value::as_str) == Some(proposal_id)
                && payload.get("apply_id").and_then(Value::as_str) == Some(apply_id)
            {
                Some(payload.clone())
            } else {
                None
            }
        })
        .ok_or_else(|| "headless recovery apply replay missing apply result".to_string())?;
    let mut apply_summary_payload = apply_payload.clone();
    if let Some(object) = apply_summary_payload.as_object_mut() {
        object
            .entry("checklist")
            .or_insert_with(|| Value::Array(Vec::new()));
        object
            .entry("transaction_id")
            .or_insert_with(|| Value::Null);
        object
            .entry("transaction_status")
            .or_insert_with(|| Value::Null);
        object
            .entry("transaction_items")
            .or_insert_with(|| Value::Array(Vec::new()));
        object
            .entry("transaction_recovery_source")
            .or_insert_with(|| Value::Null);
        object
            .entry("transaction_recovery_status")
            .or_insert_with(|| Value::Null);
    }
    let apply_result: WorkspacePatchApplyResultSummary =
        serde_json::from_value(apply_summary_payload).map_err(|error| error.to_string())?;
    let proposal = inspect_proposal(store, &selected_record.run_id, proposal_id)?;
    let apply_fingerprint = decision_payload
        .get("apply_fingerprint")
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .unwrap_or_else(|| verification_recovery_apply_fingerprint(&apply_payload));
    let is_patch_recovery_apply = decision_payload
        .get("authorize_patch_apply_recovery_apply")
        .and_then(Value::as_bool)
        == Some(true);
    let is_objective_proposal_apply = decision_payload
        .get("authorize_objective_proposal_apply")
        .and_then(Value::as_bool)
        == Some(true);
    let next_route = if is_objective_proposal_apply {
        HeadlessContinueRoute {
            kind: HeadlessContinueRouteKind::InspectProgressOverview,
            reason: "Objective proposal was already applied by this continuation; replaying bounded apply result."
                .to_string(),
            task_id: decision_payload
                .get("selected_task_id")
                .and_then(Value::as_str)
                .map(ToString::to_string),
            run_id: decision_payload
                .get("selected_run_id")
                .and_then(Value::as_str)
                .map(ToString::to_string),
            proposal_id: Some(proposal_id.to_string()),
            apply_id: Some(apply_id.to_string()),
            failure_fingerprint: None,
            apply_fingerprint: Some(apply_fingerprint),
            progress_fingerprint: Some(progress_overview.source_fingerprint.clone()),
            aggregate_sequence: Some(progress_overview.aggregate_sequence),
            next_action: "inspect_progress_overview".to_string(),
        }
    } else if is_patch_recovery_apply {
        HeadlessContinueRoute {
            kind: HeadlessContinueRouteKind::InspectProgressOverview,
            reason: "Patch recovery proposal was already applied by this continuation; replaying bounded apply result."
                .to_string(),
            task_id: decision_payload
                .get("recovery_task_id")
                .and_then(Value::as_str)
                .map(ToString::to_string),
            run_id: decision_payload
                .get("recovery_run_id")
                .and_then(Value::as_str)
                .map(ToString::to_string),
            proposal_id: Some(proposal_id.to_string()),
            apply_id: Some(apply_id.to_string()),
            failure_fingerprint: decision_payload
                .get("failure_fingerprint")
                .and_then(Value::as_str)
                .map(ToString::to_string),
            apply_fingerprint: Some(apply_fingerprint),
            progress_fingerprint: Some(progress_overview.source_fingerprint.clone()),
            aggregate_sequence: Some(progress_overview.aggregate_sequence),
            next_action: "inspect_progress_overview".to_string(),
        }
    } else {
        HeadlessContinueRoute {
            kind: HeadlessContinueRouteKind::StartVerificationRetryExplicitly,
            reason: "Recovery proposal was already applied by this continuation; replaying bounded apply result."
                .to_string(),
            task_id: decision_payload
                .get("source_task_id")
                .and_then(Value::as_str)
                .map(ToString::to_string),
            run_id: decision_payload
                .get("source_run_id")
                .and_then(Value::as_str)
                .map(ToString::to_string),
            proposal_id: Some(proposal_id.to_string()),
            apply_id: Some(apply_id.to_string()),
            failure_fingerprint: decision_payload
                .get("failure_fingerprint")
                .and_then(Value::as_str)
                .map(ToString::to_string),
            apply_fingerprint: Some(apply_fingerprint),
            progress_fingerprint: Some(progress_overview.source_fingerprint.clone()),
            aggregate_sequence: Some(progress_overview.aggregate_sequence),
            next_action: "start_verification_retry_explicitly".to_string(),
        }
    };
    Ok(Some((
        ProposalApplyResult {
            proposal,
            apply_result,
        },
        next_route,
    )))
}

fn headless_continuation_decision_from_task_ledgers(
    store: &BrownieStore,
    tasks: &[TaskRecord],
    continuation_id: &str,
) -> Result<Option<HeadlessContinuationDecisionLookup>, String> {
    let mut found: Option<HeadlessContinuationDecisionLookup> = None;
    for task in tasks {
        let events = store
            .tasks()
            .read_ledger_events(&task.run_id)
            .map_err(|error| error.to_string())?;
        for event in events {
            if event.kind != LedgerEventKind::HeadlessContinuationDecisionRecorded {
                continue;
            }
            let Some(payload) = event.payload.as_ref() else {
                continue;
            };
            if payload.get("continuation_id").and_then(Value::as_str) != Some(continuation_id) {
                continue;
            }
            if payload.get("route_kind").and_then(Value::as_str)
                == Some("product_continuation_admission")
            {
                continue;
            }
            let Some(decision) = headless_continuation_decision_from_payload(payload) else {
                return Err(format!(
                    "invalid headless continuation decision evidence for {continuation_id}"
                ));
            };
            if let Some(existing) = found.as_ref() {
                if existing != &decision {
                    return Err(format!(
                        "conflicting headless continuation decision for {continuation_id}"
                    ));
                }
            } else {
                found = Some(decision);
            }
        }
    }
    Ok(found)
}

pub(super) fn headless_continuation_decision_from_payload(
    payload: &Value,
) -> Option<HeadlessContinuationDecisionLookup> {
    Some(HeadlessContinuationDecisionLookup {
        decision_id: payload.get("decision_id")?.as_str()?.to_string(),
        continuation_id: payload.get("continuation_id")?.as_str()?.to_string(),
        selected_task_id: payload.get("selected_task_id")?.as_str()?.to_string(),
        selected_run_id: payload.get("selected_run_id")?.as_str()?.to_string(),
        expected_progress_fingerprint: payload
            .get("expected_progress_fingerprint")?
            .as_str()?
            .to_string(),
        expected_aggregate_sequence: payload.get("expected_aggregate_sequence")?.as_u64()?,
        candidate_count: payload.get("candidate_count")?.as_u64()? as usize,
        policy_version: payload
            .get("policy_version")
            .and_then(Value::as_str)
            .unwrap_or("headless_continue_once_v1")
            .to_string(),
    })
}

pub(super) fn task_run_result_for_headless_replay(
    store: &BrownieStore,
    record: &TaskRecord,
) -> Result<Option<TaskRunResult>, String> {
    if !matches!(
        record.status,
        TaskStatus::Completed | TaskStatus::Failed | TaskStatus::Cancelled
    ) {
        return Ok(None);
    }
    let completion_evidence = task_run_completion_evidence_for_record(store, record, true)?;
    let verification_recovery_context_read =
        verification_recovery_context_read_summary_for_replay(store, record)
            .map_err(|error| error.to_string())?;

    match llm_provider_failure_outcome_for_replay(store, record) {
        Ok(Some((agent_loop, llm_provider_failure))) => {
            return Ok(Some(TaskRunResult {
                task_id: record.task_id.clone(),
                run_id: record.run_id.clone(),
                status: record.status.clone(),
                agent_loop,
                completion_evidence: completion_evidence.clone(),
                completion_acceptance: None,
                llm_provider_failure: Some(llm_provider_failure),
                selected_index_prompt_context: None,
                verification_recovery_context_read: verification_recovery_context_read.clone(),
                context_budget: task_run_context_budget_summary_for_record(store, record)?,
                verification_completion_gate: None,
                verification_recovery_repair: None,
                patch_apply_recovery_repair: None,
                verification_recovery_retry: None,
                recovery_cycle_budget_outcome: None,
                child_orchestration_outcome: None,
                parent_join_readiness_outcome: None,
            }));
        }
        Ok(None) => {}
        Err(error) => return Err(error),
    }

    match verification_recovery_repair_outcome_for_replay(store, record) {
        Ok(Some((agent_loop, verification_recovery_repair))) => {
            return Ok(Some(TaskRunResult {
                task_id: record.task_id.clone(),
                run_id: record.run_id.clone(),
                status: record.status.clone(),
                agent_loop,
                completion_evidence: completion_evidence.clone(),
                completion_acceptance: None,
                llm_provider_failure: None,
                selected_index_prompt_context: None,
                verification_recovery_context_read: verification_recovery_context_read.clone(),
                context_budget: task_run_context_budget_summary_for_record(store, record)?,
                verification_completion_gate: None,
                verification_recovery_repair: Some(verification_recovery_repair),
                patch_apply_recovery_repair: None,
                verification_recovery_retry: None,
                recovery_cycle_budget_outcome: None,
                child_orchestration_outcome: None,
                parent_join_readiness_outcome: None,
            }));
        }
        Ok(None) => {}
        Err(error) => return Err(error.to_string()),
    }

    match patch_apply_recovery_repair_outcome_for_replay(store, record) {
        Ok(Some((agent_loop, patch_apply_recovery_repair))) => {
            return Ok(Some(TaskRunResult {
                task_id: record.task_id.clone(),
                run_id: record.run_id.clone(),
                status: record.status.clone(),
                agent_loop,
                completion_evidence: completion_evidence.clone(),
                completion_acceptance: None,
                llm_provider_failure: None,
                selected_index_prompt_context: None,
                verification_recovery_context_read: None,
                context_budget: task_run_context_budget_summary_for_record(store, record)?,
                verification_completion_gate: None,
                verification_recovery_repair: None,
                patch_apply_recovery_repair: Some(patch_apply_recovery_repair),
                verification_recovery_retry: None,
                recovery_cycle_budget_outcome: None,
                child_orchestration_outcome: None,
                parent_join_readiness_outcome: None,
            }));
        }
        Ok(None) => {}
        Err(error) => return Err(error.to_string()),
    }

    match verification_recovery_retry_outcome_for_replay(store, record) {
        Ok(Some((agent_loop, verification_completion_gate, verification_recovery_retry))) => {
            return Ok(Some(TaskRunResult {
                task_id: record.task_id.clone(),
                run_id: record.run_id.clone(),
                status: record.status.clone(),
                agent_loop,
                completion_evidence: completion_evidence.clone(),
                completion_acceptance: None,
                llm_provider_failure: None,
                selected_index_prompt_context: None,
                verification_recovery_context_read: None,
                context_budget: task_run_context_budget_summary_for_record(store, record)?,
                verification_completion_gate,
                verification_recovery_repair: None,
                patch_apply_recovery_repair: None,
                verification_recovery_retry: Some(verification_recovery_retry),
                recovery_cycle_budget_outcome: None,
                child_orchestration_outcome: None,
                parent_join_readiness_outcome: None,
            }));
        }
        Ok(None) => {}
        Err(error) => return Err(error.to_string()),
    }

    match recovery_cycle_budget_outcome_for_replay(store, record) {
        Ok(Some((agent_loop, recovery_cycle_budget_outcome))) => {
            return Ok(Some(TaskRunResult {
                task_id: record.task_id.clone(),
                run_id: record.run_id.clone(),
                status: record.status.clone(),
                agent_loop,
                completion_evidence: completion_evidence.clone(),
                completion_acceptance: None,
                llm_provider_failure: None,
                selected_index_prompt_context: None,
                verification_recovery_context_read: None,
                context_budget: task_run_context_budget_summary_for_record(store, record)?,
                verification_completion_gate: None,
                verification_recovery_repair: None,
                patch_apply_recovery_repair: None,
                verification_recovery_retry: None,
                recovery_cycle_budget_outcome: Some(recovery_cycle_budget_outcome),
                child_orchestration_outcome: None,
                parent_join_readiness_outcome: None,
            }));
        }
        Ok(None) => {}
        Err(error) => return Err(error),
    }

    match child_orchestration_outcome_for_replay(store, record) {
        Ok(Some((agent_loop, child_orchestration_outcome))) => {
            return Ok(Some(TaskRunResult {
                task_id: record.task_id.clone(),
                run_id: record.run_id.clone(),
                status: record.status.clone(),
                agent_loop,
                completion_evidence: completion_evidence.clone(),
                completion_acceptance: None,
                llm_provider_failure: None,
                selected_index_prompt_context: None,
                verification_recovery_context_read: None,
                context_budget: task_run_context_budget_summary_for_record(store, record)?,
                verification_completion_gate: None,
                verification_recovery_repair: None,
                patch_apply_recovery_repair: None,
                verification_recovery_retry: None,
                recovery_cycle_budget_outcome: None,
                child_orchestration_outcome: Some(child_orchestration_outcome),
                parent_join_readiness_outcome: None,
            }));
        }
        Ok(None) => {}
        Err(error) => return Err(error),
    }

    match parent_join_readiness_outcome_for_replay(store, record) {
        Ok(Some((agent_loop, parent_join_readiness_outcome))) => {
            return Ok(Some(TaskRunResult {
                task_id: record.task_id.clone(),
                run_id: record.run_id.clone(),
                status: record.status.clone(),
                agent_loop,
                completion_evidence: completion_evidence.clone(),
                completion_acceptance: None,
                llm_provider_failure: None,
                selected_index_prompt_context: None,
                verification_recovery_context_read: None,
                context_budget: task_run_context_budget_summary_for_record(store, record)?,
                verification_completion_gate: None,
                verification_recovery_repair: None,
                patch_apply_recovery_repair: None,
                verification_recovery_retry: None,
                recovery_cycle_budget_outcome: None,
                child_orchestration_outcome: None,
                parent_join_readiness_outcome: Some(parent_join_readiness_outcome),
            }));
        }
        Ok(None) => {}
        Err(error) => return Err(error),
    }

    let events = store
        .tasks()
        .read_ledger_events(&record.run_id)
        .map_err(|error| error.to_string())?;
    let Some(agent_loop) = task_run_agent_loop_summary_from_events(&events) else {
        return Ok(None);
    };
    let runtime_requirement = runtime_verification_requirement_for_record(record);
    let verification_completion_gate = verification_completion_gate_for_run_with_requirement(
        &events,
        runtime_requirement.as_ref(),
    );
    Ok(Some(TaskRunResult {
        task_id: record.task_id.clone(),
        run_id: record.run_id.clone(),
        status: record.status.clone(),
        agent_loop,
        completion_evidence,
        completion_acceptance: None,
        llm_provider_failure: llm_provider_failure_outcome_from_events(&events),
        selected_index_prompt_context: None,
        verification_recovery_context_read,
        context_budget: task_run_context_budget_summary_from_events(&events),
        verification_completion_gate,
        verification_recovery_repair: None,
        patch_apply_recovery_repair: None,
        verification_recovery_retry: None,
        recovery_cycle_budget_outcome: None,
        child_orchestration_outcome: None,
        parent_join_readiness_outcome: None,
    }))
}

fn task_run_context_budget_summary_for_record(
    store: &BrownieStore,
    record: &TaskRecord,
) -> Result<Option<TaskRunContextBudgetSummary>, String> {
    let events = store
        .tasks()
        .read_ledger_events(&record.run_id)
        .map_err(|error| error.to_string())?;
    Ok(task_run_context_budget_summary_from_events(&events))
}

pub(super) fn task_run_context_budget_summary_from_events(
    events: &[LedgerEvent],
) -> Option<TaskRunContextBudgetSummary> {
    let payload = events
        .iter()
        .rev()
        .find(|event| {
            matches!(
                event.kind,
                LedgerEventKind::SecondPassPromptBuilt | LedgerEventKind::PromptBuilt
            )
        })?
        .payload
        .as_ref()?;
    if payload
        .get("context_budget_requested")
        .and_then(Value::as_bool)
        != Some(true)
    {
        return None;
    }
    Some(TaskRunContextBudgetSummary {
        requested: true,
        max_prompt_chars: payload_usize(payload, "context_budget_max_prompt_chars")?,
        max_ledger_events: payload_usize(payload, "context_budget_max_ledger_events")?,
        max_selected_index_chars: payload_usize(
            payload,
            "context_budget_max_selected_index_chars",
        )?,
        total_events: payload_usize(payload, "context_total_events")?,
        included_events: payload_usize(payload, "context_included_events")?,
        omitted_events: payload_usize(payload, "context_omitted_events")?,
        selected_index_context_present: payload
            .get("context_budget_selected_index_context_present")
            .and_then(Value::as_bool)?,
        selected_index_content_chars: payload_usize(
            payload,
            "context_budget_selected_index_content_chars",
        )?,
        selected_index_materialized_chars: payload_usize(
            payload,
            "context_budget_selected_index_materialized_chars",
        )?,
        selected_index_truncated: payload
            .get("context_budget_selected_index_truncated")
            .and_then(Value::as_bool)?,
        protected_context_chars: payload_usize(payload, "context_budget_protected_context_chars")?,
        prompt_chars: payload_usize(payload, "context_budget_prompt_chars")?,
        prompt_within_budget: payload
            .get("context_budget_prompt_within_budget")
            .and_then(Value::as_bool)?,
    })
}

pub(super) fn headless_continue_next_route(
    record: &TaskRecord,
    result: Option<&TaskRunResult>,
    progress_overview: &TaskListProgressOverview,
) -> HeadlessContinueRoute {
    if matches!(
        record.status,
        TaskStatus::Created | TaskStatus::Queued | TaskStatus::Running
    ) && result.is_none()
    {
        if matches!(record.status, TaskStatus::Created | TaskStatus::Queued) {
            if let Some(provenance) = record.verification_recovery_provenance.as_ref() {
                return HeadlessContinueRoute {
                    kind: HeadlessContinueRouteKind::RunRecoveryTaskExplicitly,
                    reason: "Verifier failure evidence has materialized a recovery task; run it explicitly."
                        .to_string(),
                    task_id: Some(record.task_id.clone()),
                    run_id: Some(record.run_id.clone()),
                    proposal_id: None,
                    apply_id: None,
                    failure_fingerprint: Some(provenance.failure_fingerprint.clone()),
                    apply_fingerprint: None,
                    progress_fingerprint: Some(progress_overview.source_fingerprint.clone()),
                    aggregate_sequence: Some(progress_overview.aggregate_sequence),
                    next_action: "run_recovery_task_explicitly".to_string(),
                };
            }
            if let Some(provenance) = record.verification_recovery_retry_provenance.as_ref() {
                return HeadlessContinueRoute {
                    kind: HeadlessContinueRouteKind::RunVerificationRetryTaskExplicitly,
                    reason: "Approved recovery apply evidence has materialized a verification retry task; run it explicitly."
                        .to_string(),
                    task_id: Some(record.task_id.clone()),
                    run_id: Some(record.run_id.clone()),
                    proposal_id: Some(provenance.proposal_id.clone()),
                    apply_id: Some(provenance.apply_id.clone()),
                    failure_fingerprint: Some(provenance.failure_fingerprint.clone()),
                    apply_fingerprint: Some(provenance.apply_fingerprint.clone()),
                    progress_fingerprint: Some(progress_overview.source_fingerprint.clone()),
                    aggregate_sequence: Some(progress_overview.aggregate_sequence),
                    next_action: "run_verification_retry_task_explicitly".to_string(),
                };
            }
            if let Some(provenance) = record.patch_apply_recovery_provenance.as_ref() {
                return HeadlessContinueRoute {
                    kind: HeadlessContinueRouteKind::RunRecoveryTaskExplicitly,
                    reason: "Failed patch apply evidence has materialized a recovery task; run it explicitly."
                        .to_string(),
                    task_id: Some(record.task_id.clone()),
                    run_id: Some(record.run_id.clone()),
                    proposal_id: Some(provenance.source_proposal_id.clone()),
                    apply_id: Some(provenance.source_apply_id.clone()),
                    failure_fingerprint: Some(provenance.failure_fingerprint.clone()),
                    apply_fingerprint: Some(provenance.source_apply_fingerprint.clone()),
                    progress_fingerprint: Some(progress_overview.source_fingerprint.clone()),
                    aggregate_sequence: Some(progress_overview.aggregate_sequence),
                    next_action: "run_recovery_task_explicitly".to_string(),
                };
            }
            if let Some(provenance) = record.llm_provider_failure_retry_provenance.as_ref() {
                return HeadlessContinueRoute {
                    kind: HeadlessContinueRouteKind::RunLlmProviderRetryTaskExplicitly,
                    reason: "LLM provider failure evidence has materialized a provider retry task; run it explicitly."
                        .to_string(),
                    task_id: Some(record.task_id.clone()),
                    run_id: Some(record.run_id.clone()),
                    proposal_id: None,
                    apply_id: None,
                    failure_fingerprint: Some(provenance.failure_fingerprint.clone()),
                    apply_fingerprint: None,
                    progress_fingerprint: Some(progress_overview.source_fingerprint.clone()),
                    aggregate_sequence: Some(progress_overview.aggregate_sequence),
                    next_action: "run_llm_provider_retry_task_explicitly".to_string(),
                };
            }
        }
        return headless_continue_route_inspect(
            "Selected task is not terminal; inspect progress before retrying.",
            Some(record.task_id.clone()),
            Some(record.run_id.clone()),
            progress_overview,
        );
    }
    let Some(result) = result else {
        return headless_continue_route_inspect(
            "Selected task outcome is unavailable from bounded replay evidence.",
            Some(record.task_id.clone()),
            Some(record.run_id.clone()),
            progress_overview,
        );
    };

    if let Some(repair) = result.verification_recovery_repair.as_ref() {
        if let Some(proposal_id) = repair.proposal_id.as_ref() {
            return HeadlessContinueRoute {
                kind: HeadlessContinueRouteKind::ReviewAndAuthorizeRecoveryProposal,
                reason: "Recovery repair produced one bounded proposal; review and authorize it explicitly."
                    .to_string(),
                task_id: Some(repair.recovery_task_id.clone()),
                run_id: Some(repair.recovery_run_id.clone()),
                proposal_id: Some(proposal_id.clone()),
                apply_id: None,
                failure_fingerprint: Some(repair.failure_fingerprint.clone()),
                apply_fingerprint: None,
                progress_fingerprint: Some(progress_overview.source_fingerprint.clone()),
                aggregate_sequence: Some(progress_overview.aggregate_sequence),
                next_action: "review_and_authorize_recovery_proposal".to_string(),
            };
        }
    }

    if let Some(repair) = result.patch_apply_recovery_repair.as_ref() {
        if let Some(proposal_id) = repair.proposal_id.as_ref() {
            return HeadlessContinueRoute {
                kind: HeadlessContinueRouteKind::ReviewAndAuthorizeRecoveryProposal,
                reason: "Patch apply recovery repair produced one bounded proposal; review and authorize it explicitly."
                    .to_string(),
                task_id: Some(repair.recovery_task_id.clone()),
                run_id: Some(repair.recovery_run_id.clone()),
                proposal_id: Some(proposal_id.clone()),
                apply_id: None,
                failure_fingerprint: Some(repair.failure_fingerprint.clone()),
                apply_fingerprint: Some(repair.source_apply_fingerprint.clone()),
                progress_fingerprint: Some(progress_overview.source_fingerprint.clone()),
                aggregate_sequence: Some(progress_overview.aggregate_sequence),
                next_action: "review_and_authorize_recovery_proposal".to_string(),
            };
        }
    }

    if let Some(retry) = result.verification_recovery_retry.as_ref() {
        return HeadlessContinueRoute {
            kind: if retry.retry_status == VERIFICATION_COMPLETION_GATE_STATUS_PASSED {
                HeadlessContinueRouteKind::InspectProgressOverview
            } else {
                HeadlessContinueRouteKind::StartVerificationRecoveryExplicitly
            },
            reason: if retry.retry_status == VERIFICATION_COMPLETION_GATE_STATUS_PASSED {
                "Verification retry passed; inspect progress for remaining work.".to_string()
            } else {
                "Verification retry failed; start recovery explicitly if policy allows.".to_string()
            },
            task_id: Some(retry.retry_task_id.clone()),
            run_id: Some(retry.retry_run_id.clone()),
            proposal_id: Some(retry.proposal_id.clone()),
            apply_id: Some(retry.apply_id.clone()),
            failure_fingerprint: Some(retry.failure_fingerprint.clone()),
            apply_fingerprint: Some(retry.apply_fingerprint.clone()),
            progress_fingerprint: Some(progress_overview.source_fingerprint.clone()),
            aggregate_sequence: Some(progress_overview.aggregate_sequence),
            next_action: if retry.retry_status == VERIFICATION_COMPLETION_GATE_STATUS_PASSED {
                "inspect_progress_overview".to_string()
            } else {
                "start_verification_recovery_explicitly".to_string()
            },
        };
    }

    if let Some(parent_join) = result.parent_join_readiness_outcome.as_ref() {
        if parent_join.parent_join_ready {
            return HeadlessContinueRoute {
                kind: HeadlessContinueRouteKind::RunParentTaskExplicitly,
                reason: "All controlled children reached terminal state; run the parent continuation explicitly."
                    .to_string(),
                task_id: Some(parent_join.parent_task_id.clone()),
                run_id: Some(parent_join.parent_run_id.clone()),
                proposal_id: None,
                apply_id: None,
                failure_fingerprint: None,
                apply_fingerprint: None,
                progress_fingerprint: Some(progress_overview.source_fingerprint.clone()),
                aggregate_sequence: Some(progress_overview.aggregate_sequence),
                next_action: "run_parent_task_explicitly".to_string(),
            };
        }
    }

    if let Some(gate) = result.verification_completion_gate.as_ref() {
        if gate.status == VERIFICATION_COMPLETION_GATE_STATUS_FAILED {
            return HeadlessContinueRoute {
                kind: HeadlessContinueRouteKind::StartVerificationRecoveryExplicitly,
                reason: "Verification completion gate failed; start recovery explicitly with bounded failure evidence."
                    .to_string(),
                task_id: Some(result.task_id.clone()),
                run_id: Some(result.run_id.clone()),
                proposal_id: None,
                apply_id: None,
                failure_fingerprint: gate.requirement_fingerprint.clone(),
                apply_fingerprint: None,
                progress_fingerprint: Some(progress_overview.source_fingerprint.clone()),
                aggregate_sequence: Some(progress_overview.aggregate_sequence),
                next_action: "start_verification_recovery_explicitly".to_string(),
            };
        }
    }

    let candidate_task_ids = headless_continue_once_candidate_task_ids(progress_overview);
    if candidate_task_ids.is_empty() {
        return headless_continue_route_no_eligible(
            "Selected task is terminal and no eligible continuation task remains.",
            progress_overview,
        );
    }
    headless_continue_route_inspect(
        "Selected task is terminal; inspect progress for the next explicit continuation step.",
        Some(result.task_id.clone()),
        Some(result.run_id.clone()),
        progress_overview,
    )
}

fn headless_continue_route_refresh(
    reason: &str,
    progress_overview: &TaskListProgressOverview,
) -> HeadlessContinueRoute {
    HeadlessContinueRoute {
        kind: HeadlessContinueRouteKind::RefreshProgressOverview,
        reason: reason.to_string(),
        task_id: None,
        run_id: None,
        proposal_id: None,
        apply_id: None,
        failure_fingerprint: None,
        apply_fingerprint: None,
        progress_fingerprint: Some(progress_overview.source_fingerprint.clone()),
        aggregate_sequence: Some(progress_overview.aggregate_sequence),
        next_action: "refresh_progress_overview".to_string(),
    }
}

fn headless_continue_route_no_eligible(
    reason: &str,
    progress_overview: &TaskListProgressOverview,
) -> HeadlessContinueRoute {
    HeadlessContinueRoute {
        kind: HeadlessContinueRouteKind::NoEligibleTask,
        reason: reason.to_string(),
        task_id: None,
        run_id: None,
        proposal_id: None,
        apply_id: None,
        failure_fingerprint: None,
        apply_fingerprint: None,
        progress_fingerprint: Some(progress_overview.source_fingerprint.clone()),
        aggregate_sequence: Some(progress_overview.aggregate_sequence),
        next_action: "inspect_progress_overview".to_string(),
    }
}

fn headless_continue_route_inspect(
    reason: &str,
    task_id: Option<String>,
    run_id: Option<String>,
    progress_overview: &TaskListProgressOverview,
) -> HeadlessContinueRoute {
    HeadlessContinueRoute {
        kind: HeadlessContinueRouteKind::InspectProgressOverview,
        reason: reason.to_string(),
        task_id,
        run_id,
        proposal_id: None,
        apply_id: None,
        failure_fingerprint: None,
        apply_fingerprint: None,
        progress_fingerprint: Some(progress_overview.source_fingerprint.clone()),
        aggregate_sequence: Some(progress_overview.aggregate_sequence),
        next_action: "inspect_progress_overview".to_string(),
    }
}

pub(super) fn is_valid_headless_continuation_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 96
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':' | b'.'))
}

pub(super) fn is_valid_headless_run_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 48
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':' | b'.'))
}

fn append_headless_run_session_advanced_events(
    store: &BrownieStore,
    result: &HeadlessRunAdvanceResult,
) -> anyhow::Result<()> {
    for step in result
        .steps
        .iter()
        .filter(|step| step.status == HeadlessContinueOnceStatus::TaskExecuted && !step.replayed)
    {
        let Some(task_id) = step.selected_task_id.as_deref() else {
            continue;
        };
        let Some(run_id) = step.selected_run_id.as_deref() else {
            continue;
        };
        let Some(record) = store.tasks().get_task(task_id)? else {
            continue;
        };
        if record.run_id != run_id {
            continue;
        }
        store.tasks().append_task_event_with_payload(
            &record,
            LedgerEventKind::HeadlessRunSessionAdvanced,
            Some(json!({
                "session_id": result.session_id,
                "advance_id": result.advance_id,
                "session_sequence": result.session_sequence,
                "step_index": step.step_index,
                "selected_task_id": task_id,
                "selected_run_id": run_id,
                "start_progress_fingerprint": result.start_progress.progress_fingerprint,
                "start_aggregate_sequence": result.start_progress.aggregate_sequence,
                "post_progress_fingerprint": result.post_progress.as_ref().map(|progress| progress.progress_fingerprint.clone()),
                "post_aggregate_sequence": result.post_progress.as_ref().map(|progress| progress.aggregate_sequence),
                "checkpoint_fingerprint": result.checkpoint_fingerprint,
                "stop_reason": result.stop_reason,
                "terminal_completion_evidence": step.terminal_completion_evidence,
                "next_action": result.next_action,
                "reason": "Headless run session advanced through bounded runtime-owned continuation execution."
            })),
        )?;
    }
    Ok(())
}

pub(super) fn append_headless_journey_route_resume_event_if_missing(
    store: &BrownieStore,
    resume: &HeadlessRunJourneyRouteResumeMetadata,
) -> anyhow::Result<()> {
    let Some(record) = store.tasks().get_task(&resume.task_id)? else {
        return Ok(());
    };
    if record.run_id != resume.run_id {
        return Ok(());
    }
    let already_recorded = store
        .tasks()
        .read_ledger_events(&record.run_id)?
        .iter()
        .any(|event| {
            event.kind == LedgerEventKind::HeadlessJourneyRouteResumed
                && event
                    .payload
                    .as_ref()
                    .and_then(|payload| payload.get("resume_fingerprint"))
                    .and_then(Value::as_str)
                    == Some(resume.resume_fingerprint.as_str())
        });
    if already_recorded {
        return Ok(());
    }
    store.tasks().append_task_event_with_payload(
        &record,
        LedgerEventKind::HeadlessJourneyRouteResumed,
        Some(json!({
            "journey_id": resume.journey_id,
            "session_id": resume.session_id,
            "drive_id": resume.drive_id,
            "task_id": resume.task_id,
            "run_id": resume.run_id,
            "route_kind": resume.route_kind,
            "source_continuation_id": resume.source_continuation_id,
            "source_decision_id": resume.source_decision_id,
            "source_checkpoint_fingerprint": resume.source_checkpoint_fingerprint,
            "derived_target_class": resume.derived_target_class,
            "result_advance_id": resume.result_advance_id,
            "result_continuation_id": resume.result_continuation_id,
            "post_route_progress_fingerprint": resume.post_route_progress_fingerprint,
            "post_route_aggregate_sequence": resume.post_route_aggregate_sequence,
            "next_action": resume.next_action,
            "resume_fingerprint": resume.resume_fingerprint,
            "reason": "Headless journey route resumed through bounded runtime-derived route target evidence."
        })),
    )?;
    Ok(())
}

pub(super) fn append_headless_journey_closed_event_if_missing(
    store: &BrownieStore,
    closure: &HeadlessRunJourneyClosureMetadata,
) -> anyhow::Result<()> {
    let Some(record) = store.tasks().get_task(&closure.task_id)? else {
        return Ok(());
    };
    if record.run_id != closure.run_id {
        return Ok(());
    }
    let already_recorded = store
        .tasks()
        .read_ledger_events(&record.run_id)?
        .iter()
        .any(|event| {
            event.kind == LedgerEventKind::HeadlessJourneyClosed
                && event
                    .payload
                    .as_ref()
                    .and_then(|payload| payload.get("journey_closure_fingerprint"))
                    .and_then(Value::as_str)
                    == Some(closure.journey_closure_fingerprint.as_str())
        });
    if already_recorded {
        return Ok(());
    }
    store.tasks().append_task_event_with_payload(
        &record,
        LedgerEventKind::HeadlessJourneyClosed,
        Some(json!({
            "journey_id": closure.journey_id,
            "session_id": closure.session_id,
            "drive_id": closure.drive_id,
            "task_id": closure.task_id,
            "run_id": closure.run_id,
            "source_replacement_drive_id": closure.source_replacement_drive_id,
            "source_replacement_resume_fingerprint": closure.source_replacement_resume_fingerprint,
            "replacement_route_kind": closure.replacement_route_kind,
            "replacement_continuation_id": closure.replacement_continuation_id,
            "replacement_checkpoint_fingerprint": closure.replacement_checkpoint_fingerprint,
            "active_modepack_activation_fingerprint": closure.active_modepack_activation_fingerprint,
            "closure_fingerprint": closure.closure_fingerprint,
            "finalization_fingerprint": closure.finalization_fingerprint,
            "terminal_completion_fingerprint": closure.terminal_completion_fingerprint,
            "progress_fingerprint": closure.progress_fingerprint,
            "aggregate_sequence": closure.aggregate_sequence,
            "next_action": closure.next_action,
            "journey_closure_fingerprint": closure.journey_closure_fingerprint,
            "reason": "Headless Golden Journey closed from bounded replacement and completion evidence under runtime-owned drive authority."
        })),
    )?;
    Ok(())
}

pub(super) fn append_headless_run_session_drive_completed_events(
    store: &BrownieStore,
    result: &HeadlessRunDriveResult,
) -> anyhow::Result<()> {
    for advance in &result.advances {
        for step in advance.steps.iter().filter(|step| {
            step.status == HeadlessContinueOnceStatus::TaskExecuted && !step.replayed
        }) {
            let Some(task_id) = step.selected_task_id.as_deref() else {
                continue;
            };
            let Some(run_id) = step.selected_run_id.as_deref() else {
                continue;
            };
            let Some(record) = store.tasks().get_task(task_id)? else {
                continue;
            };
            if record.run_id != run_id {
                continue;
            }
            store.tasks().append_task_event_with_payload(
                &record,
                LedgerEventKind::HeadlessRunSessionDriveCompleted,
                Some(json!({
                    "session_id": result.session_id,
                    "drive_id": result.drive_id,
                    "start_session_sequence": result.start_session_sequence,
                    "end_session_sequence": result.end_session_sequence,
                    "advance_id": advance.advance_id,
                    "session_sequence": advance.session_sequence,
                    "step_index": step.step_index,
                    "selected_task_id": task_id,
                    "selected_run_id": run_id,
                    "drive_fingerprint": result.drive_fingerprint,
                    "stop_reason": result.stop_reason,
                    "terminal_completion_evidence": step.terminal_completion_evidence,
                    "completion_closure": result.completion_closure,
                    "next_action": result.next_action,
                    "reason": "Headless run session drive completed through bounded runtime-owned continuation execution."
                })),
            )?;
        }
    }
    if let Some(resume) = result.journey_route_resume.as_ref() {
        append_headless_journey_route_resume_event_if_missing(store, resume)?;
    }
    if let Some(closure) = result.journey_closure.as_ref() {
        append_headless_journey_closed_event_if_missing(store, closure)?;
    }
    if let Some(matrix) = result.product_evidence_matrix.as_ref() {
        append_headless_product_evidence_matrix_event_if_missing(store, matrix)?;
    }
    if let Some(closure) = result.selected_product_gap_closure.as_ref() {
        append_headless_selected_product_gap_closure_event_if_missing(store, closure)?;
    }
    if let Some(decision) = result.product_completion_decision.as_ref() {
        append_headless_product_completion_decision_event_if_missing(store, decision)?;
    }
    Ok(())
}
