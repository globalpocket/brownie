use super::*;

pub(super) fn push_bounded_cargo_diagnostics(
    destination: &mut Vec<BoundedCargoDiagnostic>,
    diagnostics: Vec<BoundedCargoDiagnostic>,
) {
    for diagnostic in diagnostics {
        if destination.len() >= MAX_BOUNDED_CARGO_DIAGNOSTICS {
            break;
        }
        if !destination.contains(&diagnostic) {
            destination.push(diagnostic);
        }
    }
}

pub(super) fn bounded_cargo_diagnostics_from_event(
    event: &LedgerEvent,
) -> Vec<BoundedCargoDiagnostic> {
    event
        .payload
        .as_ref()
        .and_then(|payload| payload.get("bounded_cargo_diagnostics"))
        .map(bounded_cargo_diagnostics_from_value)
        .unwrap_or_default()
}

pub(super) fn bounded_cargo_diagnostics_from_value(value: &Value) -> Vec<BoundedCargoDiagnostic> {
    let Some(items) = value.as_array() else {
        return Vec::new();
    };
    let mut diagnostics = Vec::new();
    for item in items.iter().take(MAX_BOUNDED_CARGO_DIAGNOSTICS) {
        if let Some(diagnostic) = sanitized_bounded_cargo_diagnostic(item) {
            if diagnostics.len() >= MAX_BOUNDED_CARGO_DIAGNOSTICS {
                break;
            }
            if !diagnostics.contains(&diagnostic) {
                diagnostics.push(diagnostic);
            }
        }
    }
    diagnostics
}

fn sanitized_bounded_cargo_diagnostic(item: &Value) -> Option<BoundedCargoDiagnostic> {
    let tool_id = item.get("tool_id")?.as_str()?;
    let check_id = item.get("check_id")?.as_str()?;
    let diagnostic_kind = item.get("diagnostic_kind")?.as_str()?;
    let severity = item.get("severity")?.as_str()?;
    let truncated = item.get("truncated")?.as_bool()?;
    match (tool_id, check_id) {
        (VERIFICATION_CARGO_CHECK_TOOL_ID, "cargo_check") => {
            if !matches!(diagnostic_kind, "compile_error" | "compile_warning") {
                return None;
            }
            if !matches!(severity, "error" | "warning") {
                return None;
            }
            let workspace_relative_path = item
                .get("workspace_relative_path")
                .and_then(Value::as_str)
                .and_then(sanitize_bounded_cargo_diagnostic_path)?;
            let line = item.get("line").and_then(positive_usize)?;
            let column = item.get("column").and_then(positive_usize)?;
            let code = item
                .get("code")
                .and_then(Value::as_str)
                .and_then(sanitize_bounded_cargo_diagnostic_code);
            Some(BoundedCargoDiagnostic {
                tool_id: tool_id.to_string(),
                check_id: check_id.to_string(),
                diagnostic_kind: diagnostic_kind.to_string(),
                severity: severity.to_string(),
                code,
                test_name_hash: None,
                workspace_relative_path: Some(workspace_relative_path),
                line: Some(line),
                column: Some(column),
                truncated,
            })
        }
        (VERIFICATION_CARGO_TEST_TOOL_ID, "cargo_test") => {
            if !matches!(
                diagnostic_kind,
                "panic_location" | "test_failure" | "unavailable"
            ) {
                return None;
            }
            if severity != "error" {
                return None;
            }
            let test_name_hash = item
                .get("test_name_hash")
                .and_then(Value::as_str)
                .and_then(sanitize_bounded_cargo_diagnostic_fingerprint);
            let workspace_relative_path = item
                .get("workspace_relative_path")
                .and_then(Value::as_str)
                .and_then(sanitize_bounded_cargo_diagnostic_path);
            let line = item.get("line").and_then(positive_usize);
            let column = item.get("column").and_then(positive_usize);
            if diagnostic_kind == "panic_location"
                && (test_name_hash.is_none()
                    || workspace_relative_path.is_none()
                    || line.is_none()
                    || column.is_none())
            {
                return None;
            }
            if diagnostic_kind == "test_failure" && test_name_hash.is_none() {
                return None;
            }
            Some(BoundedCargoDiagnostic {
                tool_id: tool_id.to_string(),
                check_id: check_id.to_string(),
                diagnostic_kind: diagnostic_kind.to_string(),
                severity: severity.to_string(),
                code: None,
                test_name_hash,
                workspace_relative_path,
                line,
                column,
                truncated,
            })
        }
        _ => None,
    }
}

fn positive_usize(value: &Value) -> Option<usize> {
    let raw = value.as_u64()?;
    if raw == 0 {
        return None;
    }
    usize::try_from(raw).ok()
}

fn sanitize_bounded_cargo_diagnostic_code(code: &str) -> Option<String> {
    if code.is_empty() || code.len() > MAX_BOUNDED_CARGO_DIAGNOSTIC_CODE_CHARS {
        return None;
    }
    if !code
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
    {
        return None;
    }
    Some(code.to_string())
}

fn sanitize_bounded_cargo_diagnostic_fingerprint(fingerprint: &str) -> Option<String> {
    if is_sha256_fingerprint(fingerprint) {
        Some(fingerprint.to_string())
    } else {
        None
    }
}

pub(super) fn sanitize_bounded_cargo_diagnostic_path(path: &str) -> Option<String> {
    if path.is_empty()
        || path.len() > MAX_BOUNDED_CARGO_DIAGNOSTIC_PATH_CHARS
        || path.contains('\0')
        || path.contains('\\')
    {
        return None;
    }
    let path = Path::new(path);
    if path.is_absolute() {
        return None;
    }
    let mut components = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(name) => {
                let name = name.to_string_lossy();
                if name.is_empty()
                    || name == "."
                    || name == ".."
                    || is_bounded_cargo_diagnostic_protected_component(&name)
                {
                    return None;
                }
                components.push(name.to_string());
            }
            Component::CurDir => {}
            Component::ParentDir | Component::Prefix(_) | Component::RootDir => return None,
        }
    }
    if components.is_empty() {
        return None;
    }
    Some(components.join("/"))
}

fn is_bounded_cargo_diagnostic_protected_component(component: &str) -> bool {
    matches!(component, ".git" | ".brownie" | "node_modules" | "target")
}

fn verification_completion_gate_payload(gate: &TaskRunVerificationCompletionGate) -> Value {
    let mut payload = json!({
        "verification_completion_gate_status": gate.status,
        "required_verifier_count": gate.required_verifier_count,
        "passed_verifier_count": gate.passed_verifier_count,
        "failed_verifier_count": gate.failed_verifier_count,
        "required_verifier_tool_ids": gate.required_verifier_tool_ids.clone(),
        "passed_verifier_tool_ids": gate.passed_verifier_tool_ids.clone(),
        "failed_verifier_tool_ids": gate.failed_verifier_tool_ids.clone(),
        "missing_verifier_tool_ids": gate.missing_verifier_tool_ids.clone(),
        "failure_reasons": gate.failure_reasons.clone(),
        "next_action": gate.next_action.clone(),
    });
    if let Some(object) = payload.as_object_mut() {
        if !gate.bounded_cargo_diagnostics.is_empty() {
            object.insert(
                "bounded_cargo_diagnostics".to_string(),
                json!(gate.bounded_cargo_diagnostics.clone()),
            );
        }
        if let Some(requirement_id) = gate.requirement_id.as_ref() {
            object.insert(
                "verification_requirement_id".to_string(),
                json!(requirement_id),
            );
        }
        if let Some(source_kind) = gate.requirement_source_kind.as_ref() {
            object.insert(
                "verification_requirement_source_kind".to_string(),
                json!(source_kind),
            );
        }
        if let Some(source_apply_id) = gate.source_apply_id.as_ref() {
            object.insert("source_apply_id".to_string(), json!(source_apply_id));
        }
        if let Some(fingerprint) = gate.requirement_fingerprint.as_ref() {
            object.insert(
                "verification_requirement_fingerprint".to_string(),
                json!(fingerprint),
            );
        }
    }
    payload
}

fn verification_recovery_repair_payload(
    repair: &TaskRunVerificationRecoveryRepairOutcome,
) -> Value {
    let mut payload = json!({
        "verification_recovery_repair_gate_status": repair.gate_status,
        "verification_recovery_repair": true,
        "source_task_id": repair.source_task_id,
        "source_run_id": repair.source_run_id,
        "recovery_task_id": repair.recovery_task_id,
        "recovery_run_id": repair.recovery_run_id,
        "failure_fingerprint": repair.failure_fingerprint,
        "failed_verifier_tool_ids": repair.failed_verifier_tool_ids,
        "proposal_count": repair.proposal_count,
        "apply_enabled": repair.apply_enabled,
        "next_action": repair.next_action,
    });
    if let Some(object) = payload.as_object_mut() {
        if let Some(proposal_id) = repair.proposal_id.as_ref() {
            object.insert("proposal_id".to_string(), json!(proposal_id));
        }
        if let Some(reason) = repair.failure_reason.as_ref() {
            object.insert("failure_reason".to_string(), json!(reason));
        }
    }
    payload
}

pub(super) fn task_run_terminal_payload(
    completion_evidence: Option<&TaskRunCompletionEvidence>,
    verification_completion_gate: Option<&TaskRunVerificationCompletionGate>,
    verification_recovery_repair: Option<&TaskRunVerificationRecoveryRepairOutcome>,
) -> Option<Value> {
    let mut payload = json!({});
    if let Some(evidence) = completion_evidence {
        merge_json_object(&mut payload, json!({ "completion_evidence": evidence }));
    }
    if let Some(gate) = verification_completion_gate {
        merge_json_object(&mut payload, verification_completion_gate_payload(gate));
    }
    if let Some(repair) = verification_recovery_repair {
        merge_json_object(&mut payload, verification_recovery_repair_payload(repair));
    }
    if payload
        .as_object()
        .map(|object| object.is_empty())
        .unwrap_or(true)
    {
        None
    } else {
        Some(payload)
    }
}

fn merge_json_object(target: &mut Value, source: Value) {
    let Some(target_object) = target.as_object_mut() else {
        return;
    };
    let Some(source_object) = source.as_object() else {
        return;
    };
    for (key, value) in source_object {
        target_object.insert(key.clone(), value.clone());
    }
}

pub(super) fn append_verification_recovery_retry_tool_execution(
    store: &BrownieStore,
    record: &TaskRecord,
    policy: &CompiledModePolicy,
    tool_id: &str,
    runtime_requirement: Option<&RuntimeVerificationRequirement>,
) -> anyhow::Result<()> {
    let definition = BuiltinToolRegistry::get(tool_id)
        .ok_or_else(|| anyhow::anyhow!("unknown verification retry tool id: {tool_id}"))?;
    if !is_verification_tool_id(&definition.tool_id) {
        anyhow::bail!("unsupported verification retry tool id: {tool_id}");
    }
    let check_id = match definition.tool_id.as_str() {
        VERIFICATION_CARGO_FMT_CHECK_TOOL_ID => "cargo_fmt_check",
        VERIFICATION_CARGO_CHECK_TOOL_ID => "cargo_check",
        VERIFICATION_CARGO_TEST_TOOL_ID => "cargo_test",
        _ => anyhow::bail!("unsupported verification retry tool id: {tool_id}"),
    };
    let input = json!({
        "check_id": check_id,
    });
    let permission = RuntimePermissionGate::check(policy, definition.required_action.clone());
    let mut intent_payload = json!({
        "tool_id": definition.tool_id,
        "required_action": runtime_action_name(&definition.required_action),
        "allowed": permission.allowed,
        "reason": permission.reason,
        "request_reason": "verification_recovery_retry",
        "input_summary": summarize_intent_input(&input),
        "verification_recovery_retry": true,
    });
    add_runtime_requirement_payload_fields(&mut intent_payload, runtime_requirement);
    store.tasks().append_task_event_with_payload(
        record,
        LedgerEventKind::ToolIntentPermissionChecked,
        Some(intent_payload.clone()),
    )?;
    store.tasks().append_task_event_with_payload(
        record,
        if permission.allowed {
            LedgerEventKind::ToolIntentApproved
        } else {
            LedgerEventKind::ToolIntentDenied
        },
        Some(intent_payload),
    )?;
    store.tasks().append_task_event_with_payload(
        record,
        LedgerEventKind::ToolExecutionRequested,
        Some({
            let mut payload = json!({
                "tool_id": definition.tool_id,
                "input_summary": summarize_intent_input(&input),
                "verification_recovery_retry": true,
            });
            add_runtime_requirement_payload_fields(&mut payload, runtime_requirement);
            payload
        }),
    )?;
    store.tasks().append_task_event_with_payload(
        record,
        LedgerEventKind::ToolExecutionPermissionChecked,
        Some({
            let mut payload = json!({
                "tool_id": definition.tool_id,
                "required_action": runtime_action_name(&definition.required_action),
                "allowed": permission.allowed,
                "reason": permission.reason,
                "verification_recovery_retry": true,
            });
            add_runtime_requirement_payload_fields(&mut payload, runtime_requirement);
            payload
        }),
    )?;
    if !permission.allowed {
        store.tasks().append_task_event_with_payload(
            record,
            LedgerEventKind::ToolExecutionDenied,
            Some({
                let mut payload = json!({
                    "tool_id": definition.tool_id,
                    "status": "Denied",
                    "reason": permission.reason,
                    "verification_recovery_retry": true,
                });
                add_runtime_requirement_payload_fields(&mut payload, runtime_requirement);
                payload
            }),
        )?;
        return Ok(());
    }

    let result = ToolExecutor::execute_controlled(
        store.workspace_root(),
        ToolExecutionRequest {
            tool_id: definition.tool_id,
            input,
        },
    )?;
    let kind = match result.status {
        ToolExecutionStatus::Completed => LedgerEventKind::ToolExecutionCompleted,
        ToolExecutionStatus::Denied => LedgerEventKind::ToolExecutionDenied,
        ToolExecutionStatus::Failed => LedgerEventKind::ToolExecutionFailed,
    };
    let mut payload = tool_execution_ledger_payload(&result);
    if let Some(object) = payload.as_object_mut() {
        object.insert("verification_recovery_retry".to_string(), json!(true));
    }
    add_runtime_requirement_payload_fields(&mut payload, runtime_requirement);
    store
        .tasks()
        .append_task_event_with_payload(record, kind, Some(payload))?;
    Ok(())
}

fn add_runtime_requirement_payload_fields(
    payload: &mut Value,
    runtime_requirement: Option<&RuntimeVerificationRequirement>,
) {
    let Some(requirement) = runtime_requirement else {
        return;
    };
    if let Some(object) = payload.as_object_mut() {
        object.insert(
            "verification_requirement_id".to_string(),
            json!(requirement.requirement_id),
        );
        object.insert(
            "verification_requirement_source_kind".to_string(),
            json!(requirement.source_kind),
        );
        object.insert(
            "source_apply_id".to_string(),
            json!(requirement.source_apply_id),
        );
        object.insert(
            "verification_requirement_fingerprint".to_string(),
            json!(requirement.requirement_fingerprint),
        );
    }
}

pub(super) fn runtime_verification_requirement_for_record(
    record: &TaskRecord,
) -> Option<RuntimeVerificationRequirement> {
    let provenance = record.verification_recovery_retry_provenance.as_ref()?;
    let mut required_verifier_tool_ids = provenance.retried_verifier_tool_ids.clone();
    required_verifier_tool_ids.sort();
    required_verifier_tool_ids.dedup();
    if required_verifier_tool_ids.is_empty() {
        return None;
    }
    let source_kind = "verification_recovery_retry_apply".to_string();
    let canonical = json!({
        "version": "runtime_required_verification_requirement_v1",
        "task_id": record.task_id,
        "run_id": record.run_id,
        "source_kind": source_kind,
        "source_task_id": provenance.source_task_id,
        "source_run_id": provenance.source_run_id,
        "recovery_task_id": provenance.recovery_task_id,
        "recovery_run_id": provenance.recovery_run_id,
        "proposal_id": provenance.proposal_id,
        "apply_id": provenance.apply_id,
        "failure_fingerprint": provenance.failure_fingerprint,
        "apply_fingerprint": provenance.apply_fingerprint,
        "required_verifier_tool_ids": required_verifier_tool_ids,
    });
    let requirement_fingerprint =
        format!("sha256:{}", hex_sha256(canonical.to_string().as_bytes()));
    let requirement_id = format!(
        "verification_requirement_{}",
        requirement_fingerprint
            .trim_start_matches("sha256:")
            .chars()
            .take(16)
            .collect::<String>()
    );
    Some(RuntimeVerificationRequirement {
        requirement_id,
        source_kind,
        source_apply_id: provenance.apply_id.clone(),
        requirement_fingerprint,
        required_verifier_tool_ids,
    })
}

#[derive(Debug, Clone)]
pub(super) enum VerificationRecoveryAdmissionError {
    InvalidParams(String),
    Internal(String),
}

impl std::fmt::Display for VerificationRecoveryAdmissionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            VerificationRecoveryAdmissionError::InvalidParams(message)
            | VerificationRecoveryAdmissionError::Internal(message) => formatter.write_str(message),
        }
    }
}

pub(super) fn verification_recovery_provenance_for_source(
    store: &BrownieStore,
    source: &VerificationRecoverySource,
) -> Result<VerificationRecoveryProvenance, VerificationRecoveryAdmissionError> {
    if source.source_task_id.trim().is_empty() {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: verification_recovery_source.source_task_id must not be empty".into(),
        ));
    }
    if source.source_run_id.trim().is_empty() {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: verification_recovery_source.source_run_id must not be empty".into(),
        ));
    }
    if !source.authorize_recovery {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: verification_recovery_source.authorize_recovery must be true".into(),
        ));
    }
    if !is_sha256_fingerprint(&source.expected_failure_fingerprint) {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: verification_recovery_source.expected_failure_fingerprint must be a sha256 fingerprint".into(),
        ));
    }

    let source_task = store
        .tasks()
        .get_task(&source.source_task_id)
        .map_err(|error| VerificationRecoveryAdmissionError::Internal(error.to_string()))?
        .ok_or_else(|| {
            VerificationRecoveryAdmissionError::InvalidParams(
                "invalid params: verification_recovery_source.source_task_id was not found".into(),
            )
        })?;

    if source_task.run_id != source.source_run_id {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: verification_recovery_source.source_run_id does not match source task"
                .into(),
        ));
    }
    if source_task.status != TaskStatus::Failed {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: verification recovery source task must be terminal Failed".into(),
        ));
    }

    let events = store
        .tasks()
        .read_ledger_events(&source.source_run_id)
        .map_err(|error| VerificationRecoveryAdmissionError::Internal(error.to_string()))?;
    let gate = verification_completion_gate_for_run(&events).ok_or_else(|| {
        VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: verification recovery source has no verification completion gate"
                .into(),
        )
    })?;
    if gate.status != VERIFICATION_COMPLETION_GATE_STATUS_FAILED || gate.failed_verifier_count == 0
    {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: verification recovery source gate is not failed".into(),
        ));
    }
    if !has_terminal_failed_task_event_with_verification_gate(&events) {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: verification recovery source is not a terminal failed verification run"
                .into(),
        ));
    }

    let actual_fingerprint = verification_recovery_failure_fingerprint(&source_task, &gate);
    if actual_fingerprint != source.expected_failure_fingerprint {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: verification_recovery_source.expected_failure_fingerprint is stale"
                .into(),
        ));
    }

    Ok(VerificationRecoveryProvenance {
        source_task_id: source_task.task_id,
        source_run_id: source_task.run_id,
        failure_fingerprint: actual_fingerprint,
        required_verifier_count: gate.required_verifier_count,
        passed_verifier_count: gate.passed_verifier_count,
        failed_verifier_count: gate.failed_verifier_count,
        failed_verifier_tool_ids: gate.failed_verifier_tool_ids,
        failure_reasons: gate.failure_reasons,
        bounded_cargo_diagnostics: gate.bounded_cargo_diagnostics,
    })
}

#[derive(Debug, Clone)]
pub(super) struct VerificationRecoveryApplyEvidence {
    pub(super) apply_fingerprint: String,
}

pub(super) fn verification_recovery_retry_provenance_for_source(
    store: &BrownieStore,
    source: &VerificationRecoveryRetrySource,
) -> Result<VerificationRecoveryRetryProvenance, VerificationRecoveryAdmissionError> {
    validate_verification_recovery_retry_source_shape(source)?;

    let recovery_source = VerificationRecoverySource {
        source_task_id: source.source_task_id.clone(),
        source_run_id: source.source_run_id.clone(),
        expected_failure_fingerprint: source.expected_failure_fingerprint.clone(),
        authorize_recovery: true,
    };
    let latest_recovery_provenance =
        verification_recovery_provenance_for_source(store, &recovery_source)?;

    let recovery_task = store
        .tasks()
        .get_task(&source.recovery_task_id)
        .map_err(|error| VerificationRecoveryAdmissionError::Internal(error.to_string()))?
        .ok_or_else(|| {
            VerificationRecoveryAdmissionError::InvalidParams(
                "invalid params: verification_recovery_retry_source.recovery_task_id was not found"
                    .into(),
            )
        })?;
    if recovery_task.run_id != source.recovery_run_id {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: verification_recovery_retry_source.recovery_run_id does not match recovery task"
                .into(),
        ));
    }
    let Some(recovery_provenance) = recovery_task.verification_recovery_provenance.as_ref() else {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: verification recovery retry source task is not a recovery task".into(),
        ));
    };
    if recovery_provenance != &latest_recovery_provenance {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: verification recovery retry source recovery provenance is stale"
                .into(),
        ));
    }

    let proposals =
        verification_recovery_repair_proposals_for_run(store, &recovery_task, recovery_provenance)
            .map_err(|error| VerificationRecoveryAdmissionError::Internal(error.to_string()))?;
    if !proposals
        .iter()
        .any(|proposal| proposal.applicable && proposal.proposal_id == source.proposal_id)
    {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: verification recovery retry source proposal is not recovery-scoped"
                .into(),
        ));
    }

    let apply_evidence = latest_recovery_apply_evidence(
        store,
        &source.recovery_run_id,
        &source.proposal_id,
        &source.apply_id,
    )?;
    if apply_evidence.apply_fingerprint != source.expected_apply_fingerprint {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: verification_recovery_retry_source.expected_apply_fingerprint is stale"
                .into(),
        ));
    }

    let retried_verifier_tool_ids = recovery_provenance
        .failed_verifier_tool_ids
        .iter()
        .map(|tool_id| tool_id.as_str())
        .collect::<Vec<_>>();
    if retried_verifier_tool_ids.is_empty()
        || !retried_verifier_tool_ids
            .iter()
            .all(|tool_id| is_verification_tool_id(tool_id))
    {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: verification recovery retry source has unsupported verifier set"
                .into(),
        ));
    }

    Ok(VerificationRecoveryRetryProvenance {
        source_task_id: source.source_task_id.clone(),
        source_run_id: source.source_run_id.clone(),
        recovery_task_id: source.recovery_task_id.clone(),
        recovery_run_id: source.recovery_run_id.clone(),
        proposal_id: source.proposal_id.clone(),
        apply_id: source.apply_id.clone(),
        failure_fingerprint: source.expected_failure_fingerprint.clone(),
        apply_fingerprint: source.expected_apply_fingerprint.clone(),
        retried_verifier_tool_ids: retried_verifier_tool_ids
            .into_iter()
            .map(ToString::to_string)
            .collect(),
    })
}

pub(super) fn llm_provider_failure_retry_provenance_for_source(
    store: &BrownieStore,
    source: &LlmProviderFailureRetrySource,
) -> Result<LlmProviderFailureRetryProvenance, VerificationRecoveryAdmissionError> {
    if source.source_task_id.trim().is_empty() {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: llm_provider_failure_retry_source.source_task_id must not be empty"
                .into(),
        ));
    }
    if source.source_run_id.trim().is_empty() {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: llm_provider_failure_retry_source.source_run_id must not be empty"
                .into(),
        ));
    }
    if !source.authorize_provider_failure_retry {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: llm_provider_failure_retry_source.authorize_provider_failure_retry must be true"
                .into(),
        ));
    }
    if !is_sha256_fingerprint(&source.expected_failure_fingerprint) {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: llm_provider_failure_retry_source.expected_failure_fingerprint must be a sha256 fingerprint"
                .into(),
        ));
    }

    let source_task = store
        .tasks()
        .get_task(&source.source_task_id)
        .map_err(|error| VerificationRecoveryAdmissionError::Internal(error.to_string()))?
        .ok_or_else(|| {
            VerificationRecoveryAdmissionError::InvalidParams(
                "invalid params: llm_provider_failure_retry_source.source_task_id was not found"
                    .into(),
            )
        })?;

    if source_task.run_id != source.source_run_id {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: llm_provider_failure_retry_source.source_run_id does not match source task"
                .into(),
        ));
    }
    if source_task.status != TaskStatus::Failed {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: LLM provider failure retry source task must be terminal Failed".into(),
        ));
    }

    let events = store
        .tasks()
        .read_ledger_events(&source.source_run_id)
        .map_err(|error| VerificationRecoveryAdmissionError::Internal(error.to_string()))?;
    let Some(outcome) = llm_provider_failure_outcome_from_events(&events) else {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: LLM provider failure retry source has no structured provider failure evidence"
                .into(),
        ));
    };
    if outcome.failure_fingerprint != source.expected_failure_fingerprint {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: llm_provider_failure_retry_source.expected_failure_fingerprint is stale"
                .into(),
        ));
    }
    if !outcome.retryable || !is_retryable_llm_provider_failure_class(&outcome.failure_class) {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: LLM provider failure retry source failure class is not retryable"
                .into(),
        ));
    }

    Ok(LlmProviderFailureRetryProvenance {
        source_task_id: source_task.task_id,
        source_run_id: source_task.run_id,
        failure_fingerprint: outcome.failure_fingerprint,
        failure_class: outcome.failure_class,
        provider: outcome.provider,
        model: outcome.model,
        request_phase: outcome.request_phase,
        retryable: outcome.retryable,
    })
}

pub(super) fn latest_product_completion_decision_payload<'a>(
    events: &'a [LedgerEvent],
    source_task_id: &str,
    source_run_id: &str,
) -> Option<&'a Value> {
    events.iter().rev().find_map(|event| {
        if event.kind != LedgerEventKind::HeadlessRunProductCompletionDecisionRecorded {
            return None;
        }
        let payload = event.payload.as_ref()?;
        if payload.get("task_id").and_then(Value::as_str) == Some(source_task_id)
            && payload.get("run_id").and_then(Value::as_str) == Some(source_run_id)
        {
            Some(payload)
        } else {
            None
        }
    })
}

fn is_retryable_llm_provider_failure_class(failure_class: &str) -> bool {
    matches!(
        failure_class,
        "http_status"
            | "transport_or_timeout"
            | "invalid_provider_response"
            | "missing_provider_content"
            | "unknown_provider_failure"
    )
}

fn validate_verification_recovery_retry_source_shape(
    source: &VerificationRecoveryRetrySource,
) -> Result<(), VerificationRecoveryAdmissionError> {
    for (field, value) in [
        ("source_task_id", source.source_task_id.as_str()),
        ("source_run_id", source.source_run_id.as_str()),
        ("recovery_task_id", source.recovery_task_id.as_str()),
        ("recovery_run_id", source.recovery_run_id.as_str()),
        ("proposal_id", source.proposal_id.as_str()),
        ("apply_id", source.apply_id.as_str()),
    ] {
        if value.trim().is_empty() {
            return Err(VerificationRecoveryAdmissionError::InvalidParams(format!(
                "invalid params: verification_recovery_retry_source.{field} must not be empty"
            )));
        }
    }
    if !source.authorize_verification_retry {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: verification_recovery_retry_source.authorize_verification_retry must be true"
                .into(),
        ));
    }
    if !is_sha256_fingerprint(&source.expected_failure_fingerprint) {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: verification_recovery_retry_source.expected_failure_fingerprint must be a sha256 fingerprint"
                .into(),
        ));
    }
    if !is_sha256_fingerprint(&source.expected_apply_fingerprint) {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: verification_recovery_retry_source.expected_apply_fingerprint must be a sha256 fingerprint"
                .into(),
        ));
    }
    Ok(())
}

pub(super) fn verification_recovery_retry_record_for_headless_run_target(
    store: &BrownieStore,
    target: &VerificationRecoveryRetryRunTarget,
) -> Result<TaskRecord, TaskRunAdmissionRejection> {
    for value in [
        ("retry_task_id", target.retry_task_id.as_str()),
        ("retry_run_id", target.retry_run_id.as_str()),
        ("proposal_id", target.proposal_id.as_str()),
        ("apply_id", target.apply_id.as_str()),
    ]
    .map(|(_, value)| value)
    {
        if value.trim().is_empty() {
            return Err(TaskRunAdmissionRejection::InvalidParams(
                "invalid params: verification_recovery_retry_run_target fields must not be empty",
            ));
        }
    }
    if !target.authorize_verification_retry_run {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: verification_recovery_retry_run_target.authorize_verification_retry_run must be true",
        ));
    }
    if !is_sha256_fingerprint(&target.expected_failure_fingerprint) {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: verification_recovery_retry_run_target.expected_failure_fingerprint must be a sha256 fingerprint",
        ));
    }
    if !is_sha256_fingerprint(&target.expected_apply_fingerprint) {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: verification_recovery_retry_run_target.expected_apply_fingerprint must be a sha256 fingerprint",
        ));
    }

    let record = store
        .tasks()
        .get_task(&target.retry_task_id)
        .map_err(|error| TaskRunAdmissionRejection::Internal(error.to_string()))?
        .ok_or({
            TaskRunAdmissionRejection::InvalidParams(
                "invalid params: verification_recovery_retry_run_target.retry_task_id was not found",
            )
        })?;
    if record.run_id != target.retry_run_id {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: verification_recovery_retry_run_target.retry_run_id does not match retry task",
        ));
    }
    if !matches!(record.status, TaskStatus::Created | TaskStatus::Queued) {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: verification recovery retry run target task must be Created or Queued",
        ));
    }
    let Some(provenance) = record.verification_recovery_retry_provenance.as_ref() else {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: verification recovery retry run target task has no retry provenance",
        ));
    };
    if provenance.proposal_id != target.proposal_id {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: verification_recovery_retry_run_target.proposal_id is stale",
        ));
    }
    if provenance.apply_id != target.apply_id {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: verification_recovery_retry_run_target.apply_id is stale",
        ));
    }
    if provenance.failure_fingerprint != target.expected_failure_fingerprint {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: verification_recovery_retry_run_target.expected_failure_fingerprint is stale",
        ));
    }
    if provenance.apply_fingerprint != target.expected_apply_fingerprint {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: verification_recovery_retry_run_target.expected_apply_fingerprint is stale",
        ));
    }
    revalidate_verification_recovery_retry_task_for_run(store, &record)?;
    Ok(record)
}

pub(super) fn llm_provider_failure_retry_record_for_headless_run_target(
    store: &BrownieStore,
    target: &LlmProviderFailureRetryRunTarget,
) -> Result<TaskRecord, TaskRunAdmissionRejection> {
    for value in [
        target.retry_task_id.as_str(),
        target.retry_run_id.as_str(),
        target.source_task_id.as_str(),
        target.source_run_id.as_str(),
    ] {
        if value.trim().is_empty() {
            return Err(TaskRunAdmissionRejection::InvalidParams(
                "invalid params: llm_provider_failure_retry_run_target fields must not be empty",
            ));
        }
    }
    if !target.authorize_provider_failure_retry_run {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: llm_provider_failure_retry_run_target.authorize_provider_failure_retry_run must be true",
        ));
    }
    if !is_sha256_fingerprint(&target.expected_failure_fingerprint) {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: llm_provider_failure_retry_run_target.expected_failure_fingerprint must be a sha256 fingerprint",
        ));
    }

    let record = store
        .tasks()
        .get_task(&target.retry_task_id)
        .map_err(|error| TaskRunAdmissionRejection::Internal(error.to_string()))?
        .ok_or({
            TaskRunAdmissionRejection::InvalidParams(
                "invalid params: llm_provider_failure_retry_run_target.retry_task_id was not found",
            )
        })?;
    if record.run_id != target.retry_run_id {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: llm_provider_failure_retry_run_target.retry_run_id does not match retry task",
        ));
    }
    if !matches!(record.status, TaskStatus::Created | TaskStatus::Queued) {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: LLM provider failure retry run target task must be Created or Queued",
        ));
    }
    let Some(provenance) = record.llm_provider_failure_retry_provenance.as_ref() else {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: LLM provider failure retry run target task has no retry provenance",
        ));
    };
    if provenance.source_task_id != target.source_task_id {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: llm_provider_failure_retry_run_target.source_task_id is stale",
        ));
    }
    if provenance.source_run_id != target.source_run_id {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: llm_provider_failure_retry_run_target.source_run_id is stale",
        ));
    }
    if provenance.failure_fingerprint != target.expected_failure_fingerprint {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: llm_provider_failure_retry_run_target.expected_failure_fingerprint is stale",
        ));
    }
    revalidate_llm_provider_failure_retry_task_for_run(store, &record)?;
    Ok(record)
}

pub(super) fn verification_recovery_record_for_headless_apply_target(
    store: &BrownieStore,
    target: &VerificationRecoveryApplyTarget,
) -> Result<TaskRecord, TaskRunAdmissionRejection> {
    for value in [
        target.source_task_id.as_str(),
        target.source_run_id.as_str(),
        target.recovery_task_id.as_str(),
        target.recovery_run_id.as_str(),
        target.proposal_id.as_str(),
    ] {
        if value.trim().is_empty() {
            return Err(TaskRunAdmissionRejection::InvalidParams(
                "invalid params: verification_recovery_apply_target fields must not be empty",
            ));
        }
    }
    if !target.authorize_recovery_apply {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: verification_recovery_apply_target.authorize_recovery_apply must be true",
        ));
    }
    if !is_sha256_fingerprint(&target.expected_failure_fingerprint) {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: verification_recovery_apply_target.expected_failure_fingerprint must be a sha256 fingerprint",
        ));
    }
    if let Some(expected_target_sha256) = target.expected_target_sha256.as_ref() {
        if !is_sha256_fingerprint(expected_target_sha256) {
            return Err(TaskRunAdmissionRejection::InvalidParams(
                "invalid params: verification_recovery_apply_target.expected_target_sha256 must be a sha256 fingerprint",
            ));
        }
    }

    let record = store
        .tasks()
        .get_task(&target.recovery_task_id)
        .map_err(|error| TaskRunAdmissionRejection::Internal(error.to_string()))?
        .ok_or({
            TaskRunAdmissionRejection::InvalidParams(
                "invalid params: verification_recovery_apply_target.recovery_task_id was not found",
            )
        })?;
    if record.run_id != target.recovery_run_id {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: verification_recovery_apply_target.recovery_run_id does not match recovery task",
        ));
    }
    let Some(provenance) = record.verification_recovery_provenance.as_ref() else {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: verification recovery apply target task has no recovery provenance",
        ));
    };
    if provenance.source_task_id != target.source_task_id {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: verification_recovery_apply_target.source_task_id is stale",
        ));
    }
    if provenance.source_run_id != target.source_run_id {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: verification_recovery_apply_target.source_run_id is stale",
        ));
    }
    if provenance.failure_fingerprint != target.expected_failure_fingerprint {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: verification_recovery_apply_target.expected_failure_fingerprint is stale",
        ));
    }
    revalidate_verification_recovery_task_for_run(store, &record)?;
    let proposals = verification_recovery_repair_proposals_for_run(store, &record, provenance)
        .map_err(|error| TaskRunAdmissionRejection::Internal(error.to_string()))?;
    if !proposals
        .iter()
        .any(|proposal| proposal.applicable && proposal.proposal_id == target.proposal_id)
    {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: verification_recovery_apply_target.proposal_id is not recovery-scoped",
        ));
    }
    Ok(record)
}

pub(super) fn verification_recovery_record_for_headless_run_target(
    store: &BrownieStore,
    target: &VerificationRecoveryRunTarget,
) -> Result<TaskRecord, TaskRunAdmissionRejection> {
    for value in [
        target.recovery_task_id.as_str(),
        target.recovery_run_id.as_str(),
        target.source_task_id.as_str(),
        target.source_run_id.as_str(),
    ] {
        if value.trim().is_empty() {
            return Err(TaskRunAdmissionRejection::InvalidParams(
                "invalid params: verification_recovery_run_target fields must not be empty",
            ));
        }
    }
    if !target.authorize_recovery_run {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: verification_recovery_run_target.authorize_recovery_run must be true",
        ));
    }
    if !is_sha256_fingerprint(&target.expected_failure_fingerprint) {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: verification_recovery_run_target.expected_failure_fingerprint must be a sha256 fingerprint",
        ));
    }

    let record = store
        .tasks()
        .get_task(&target.recovery_task_id)
        .map_err(|error| TaskRunAdmissionRejection::Internal(error.to_string()))?
        .ok_or({
            TaskRunAdmissionRejection::InvalidParams(
                "invalid params: verification_recovery_run_target.recovery_task_id was not found",
            )
        })?;
    if record.run_id != target.recovery_run_id {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: verification_recovery_run_target.recovery_run_id does not match recovery task",
        ));
    }
    if !matches!(record.status, TaskStatus::Created | TaskStatus::Queued) {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: verification recovery run target task must be Created or Queued",
        ));
    }
    let Some(provenance) = record.verification_recovery_provenance.as_ref() else {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: verification recovery run target task has no recovery provenance",
        ));
    };
    if provenance.source_task_id != target.source_task_id {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: verification_recovery_run_target.source_task_id is stale",
        ));
    }
    if provenance.source_run_id != target.source_run_id {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: verification_recovery_run_target.source_run_id is stale",
        ));
    }
    if provenance.failure_fingerprint != target.expected_failure_fingerprint {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: verification_recovery_run_target.expected_failure_fingerprint is stale",
        ));
    }
    revalidate_verification_recovery_task_for_run(store, &record)?;
    Ok(record)
}

pub(super) fn parent_join_record_for_headless_run_target(
    store: &BrownieStore,
    target: &ParentJoinRunTarget,
) -> Result<TaskRecord, TaskRunAdmissionRejection> {
    for value in [
        target.parent_task_id.as_str(),
        target.parent_run_id.as_str(),
        target.expected_child_completion_fingerprint.as_str(),
    ] {
        if value.trim().is_empty() {
            return Err(TaskRunAdmissionRejection::InvalidParams(
                "invalid params: parent_join_run_target fields must not be empty",
            ));
        }
    }
    if !target.authorize_parent_join_run {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: parent_join_run_target.authorize_parent_join_run must be true",
        ));
    }
    if !is_sha256_fingerprint(&target.expected_child_completion_fingerprint) {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: parent_join_run_target.expected_child_completion_fingerprint must be a sha256 fingerprint",
        ));
    }
    if target.expected_child_completion_child_count == 0 {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: parent_join_run_target.expected_child_completion_child_count must be greater than zero",
        ));
    }
    if target.expected_terminal_completed_child_count + target.expected_terminal_failed_child_count
        != target.expected_child_completion_child_count
    {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: parent_join_run_target terminal child counts must equal expected_child_completion_child_count",
        ));
    }

    let record = store
        .tasks()
        .get_task(&target.parent_task_id)
        .map_err(|error| TaskRunAdmissionRejection::Internal(error.to_string()))?
        .ok_or(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: parent_join_run_target.parent_task_id was not found",
        ))?;
    if record.run_id != target.parent_run_id {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: parent_join_run_target.parent_run_id does not match parent task",
        ));
    }
    if record.parent_run_id.is_some() {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: parent_join_run_target must select a parent task, not a child task",
        ));
    }
    if record.status != TaskStatus::Completed {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: parent join run target task must be Completed",
        ));
    }
    let admission = validate_completed_parent_join_continuation_admission(&record, store)?;
    if admission.child_completion_fingerprint != target.expected_child_completion_fingerprint {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: parent_join_run_target.expected_child_completion_fingerprint is stale",
        ));
    }
    if admission.child_completion_child_count != target.expected_child_completion_child_count {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: parent_join_run_target.expected_child_completion_child_count is stale",
        ));
    }
    if admission.child_terminal_completed_count != target.expected_terminal_completed_child_count {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: parent_join_run_target.expected_terminal_completed_child_count is stale",
        ));
    }
    if admission.child_terminal_failed_count != target.expected_terminal_failed_child_count {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: parent_join_run_target.expected_terminal_failed_child_count is stale",
        ));
    }
    Ok(record)
}

pub(super) fn patch_apply_recovery_record_for_headless_run_target(
    store: &BrownieStore,
    target: &PatchApplyRecoveryRunTarget,
) -> Result<TaskRecord, TaskRunAdmissionRejection> {
    for value in [
        target.recovery_task_id.as_str(),
        target.recovery_run_id.as_str(),
        target.source_run_id.as_str(),
        target.source_proposal_id.as_str(),
        target.source_apply_id.as_str(),
    ] {
        if value.trim().is_empty() {
            return Err(TaskRunAdmissionRejection::InvalidParams(
                "invalid params: patch_apply_recovery_run_target fields must not be empty",
            ));
        }
    }
    if !target.authorize_patch_apply_recovery_run {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: patch_apply_recovery_run_target.authorize_patch_apply_recovery_run must be true",
        ));
    }
    if !is_sha256_fingerprint(&target.expected_source_apply_fingerprint) {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: patch_apply_recovery_run_target.expected_source_apply_fingerprint must be a sha256 fingerprint",
        ));
    }
    if !is_sha256_fingerprint(&target.expected_failure_fingerprint) {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: patch_apply_recovery_run_target.expected_failure_fingerprint must be a sha256 fingerprint",
        ));
    }

    let record = store
        .tasks()
        .get_task(&target.recovery_task_id)
        .map_err(|error| TaskRunAdmissionRejection::Internal(error.to_string()))?
        .ok_or(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: patch_apply_recovery_run_target.recovery_task_id was not found",
        ))?;
    if record.run_id != target.recovery_run_id {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: patch_apply_recovery_run_target.recovery_run_id does not match recovery task",
        ));
    }
    if !matches!(record.status, TaskStatus::Created | TaskStatus::Queued) {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: patch apply recovery run target task must be Created or Queued",
        ));
    }
    let Some(provenance) = record.patch_apply_recovery_provenance.as_ref() else {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: patch apply recovery run target task has no recovery provenance",
        ));
    };
    if provenance.source_run_id != target.source_run_id {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: patch_apply_recovery_run_target.source_run_id is stale",
        ));
    }
    if provenance.source_proposal_id != target.source_proposal_id {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: patch_apply_recovery_run_target.source_proposal_id is stale",
        ));
    }
    if provenance.source_apply_id != target.source_apply_id {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: patch_apply_recovery_run_target.source_apply_id is stale",
        ));
    }
    if provenance.source_apply_fingerprint != target.expected_source_apply_fingerprint {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: patch_apply_recovery_run_target.expected_source_apply_fingerprint is stale",
        ));
    }
    if provenance.failure_fingerprint != target.expected_failure_fingerprint {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: patch_apply_recovery_run_target.expected_failure_fingerprint is stale",
        ));
    }
    revalidate_patch_apply_recovery_task_for_run(store, &record)?;
    Ok(record)
}

pub(super) fn patch_apply_recovery_record_for_headless_apply_target(
    store: &BrownieStore,
    target: &PatchApplyRecoveryApplyTarget,
) -> Result<TaskRecord, TaskRunAdmissionRejection> {
    for value in [
        target.recovery_task_id.as_str(),
        target.recovery_run_id.as_str(),
        target.source_run_id.as_str(),
        target.source_proposal_id.as_str(),
        target.source_apply_id.as_str(),
        target.recovery_proposal_id.as_str(),
    ] {
        if value.trim().is_empty() {
            return Err(TaskRunAdmissionRejection::InvalidParams(
                "invalid params: patch_apply_recovery_apply_target fields must not be empty",
            ));
        }
    }
    if !target.authorize_patch_apply_recovery_apply {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: patch_apply_recovery_apply_target.authorize_patch_apply_recovery_apply must be true",
        ));
    }
    if !is_sha256_fingerprint(&target.expected_source_apply_fingerprint) {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: patch_apply_recovery_apply_target.expected_source_apply_fingerprint must be a sha256 fingerprint",
        ));
    }
    if !is_sha256_fingerprint(&target.expected_failure_fingerprint) {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: patch_apply_recovery_apply_target.expected_failure_fingerprint must be a sha256 fingerprint",
        ));
    }
    if !is_sha256_fingerprint(&target.expected_target_sha256) {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: patch_apply_recovery_apply_target.expected_target_sha256 must be a sha256 fingerprint",
        ));
    }

    let record = store
        .tasks()
        .get_task(&target.recovery_task_id)
        .map_err(|error| TaskRunAdmissionRejection::Internal(error.to_string()))?
        .ok_or(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: patch_apply_recovery_apply_target.recovery_task_id was not found",
        ))?;
    if record.run_id != target.recovery_run_id {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: patch_apply_recovery_apply_target.recovery_run_id does not match recovery task",
        ));
    }
    let Some(provenance) = record.patch_apply_recovery_provenance.as_ref() else {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: patch apply recovery apply target task has no recovery provenance",
        ));
    };
    if provenance.source_run_id != target.source_run_id {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: patch_apply_recovery_apply_target.source_run_id is stale",
        ));
    }
    if provenance.source_proposal_id != target.source_proposal_id {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: patch_apply_recovery_apply_target.source_proposal_id is stale",
        ));
    }
    if provenance.source_apply_id != target.source_apply_id {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: patch_apply_recovery_apply_target.source_apply_id is stale",
        ));
    }
    if provenance.source_apply_fingerprint != target.expected_source_apply_fingerprint {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: patch_apply_recovery_apply_target.expected_source_apply_fingerprint is stale",
        ));
    }
    if provenance.failure_fingerprint != target.expected_failure_fingerprint {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: patch_apply_recovery_apply_target.expected_failure_fingerprint is stale",
        ));
    }
    revalidate_patch_apply_recovery_task_for_run(store, &record)?;
    let proposals = patch_apply_recovery_repair_proposals_for_run(store, &record, provenance)
        .map_err(|error| TaskRunAdmissionRejection::Internal(error.to_string()))?;
    if !proposals
        .iter()
        .any(|proposal| proposal.applicable && proposal.proposal_id == target.recovery_proposal_id)
    {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: patch_apply_recovery_apply_target.recovery_proposal_id is not recovery-scoped",
        ));
    }
    Ok(record)
}

pub(super) fn latest_recovery_apply_evidence(
    store: &BrownieStore,
    recovery_run_id: &str,
    proposal_id: &str,
    apply_id: &str,
) -> Result<VerificationRecoveryApplyEvidence, VerificationRecoveryAdmissionError> {
    let events = store
        .tasks()
        .read_ledger_events(recovery_run_id)
        .map_err(|error| VerificationRecoveryAdmissionError::Internal(error.to_string()))?;
    let payload = events
        .iter()
        .rev()
        .find_map(|event| {
            if event.kind != LedgerEventKind::WorkspacePatchApplyResultRecorded {
                return None;
            }
            let Value::Object(_) = event.payload.as_ref()? else {
                return None;
            };
            let payload = event.payload.clone()?;
            if payload.get("proposal_id").and_then(Value::as_str) == Some(proposal_id)
                && payload.get("apply_id").and_then(Value::as_str) == Some(apply_id)
            {
                Some(payload)
            } else {
                None
            }
        })
        .ok_or_else(|| {
            VerificationRecoveryAdmissionError::InvalidParams(
                "invalid params: verification recovery retry source has no matching apply result"
                    .into(),
            )
        })?;

    if payload.get("apply_status").and_then(Value::as_str) != Some("Applied")
        || payload.get("applied").and_then(Value::as_bool) != Some(true)
        || payload
            .get("authorization_consumed")
            .and_then(Value::as_bool)
            != Some(true)
    {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: verification recovery retry source apply result is not applied".into(),
        ));
    }
    let operation = payload
        .get("operation")
        .and_then(Value::as_str)
        .unwrap_or("");
    let operation_verified = match operation {
        "replace_file" => {
            payload
                .get("atomic_replacement_completed")
                .and_then(Value::as_bool)
                == Some(true)
                && payload
                    .get("post_write_sha256")
                    .and_then(Value::as_str)
                    .filter(|hash| is_sha256_fingerprint(hash))
                    .is_some()
        }
        "patch_file" => {
            payload
                .get("atomic_replacement_completed")
                .and_then(Value::as_bool)
                == Some(true)
                && payload
                    .get("post_write_sha256")
                    .and_then(Value::as_str)
                    .filter(|hash| is_sha256_fingerprint(hash))
                    .is_some()
        }
        "create_file" => {
            payload
                .get("atomic_create_completed")
                .and_then(Value::as_bool)
                == Some(true)
                && payload
                    .get("post_write_sha256")
                    .and_then(Value::as_str)
                    .filter(|hash| is_sha256_fingerprint(hash))
                    .is_some()
        }
        "delete_file" => {
            payload
                .get("atomic_delete_completed")
                .and_then(Value::as_bool)
                == Some(true)
                && payload
                    .get("post_delete_target_exists")
                    .and_then(Value::as_bool)
                    == Some(false)
        }
        _ => false,
    };
    if !operation_verified {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: verification recovery retry source apply post-state is not verified"
                .into(),
        ));
    }

    Ok(VerificationRecoveryApplyEvidence {
        apply_fingerprint: verification_recovery_apply_fingerprint(&payload),
    })
}

pub(super) fn verification_recovery_apply_fingerprint(payload: &Value) -> String {
    let canonical = json!({
        "version": "verification_recovery_apply_fingerprint_v1",
        "proposal_id": payload.get("proposal_id").and_then(Value::as_str),
        "apply_id": payload.get("apply_id").and_then(Value::as_str),
        "apply_status": payload.get("apply_status").and_then(Value::as_str),
        "authorization_consumed": payload.get("authorization_consumed").and_then(Value::as_bool),
        "applied": payload.get("applied").and_then(Value::as_bool),
        "operation": payload.get("operation").and_then(Value::as_str),
        "hunk_count": payload.get("hunk_count").and_then(Value::as_u64),
        "hunk_fingerprint": payload.get("hunk_fingerprint").and_then(Value::as_str),
        "atomic_replacement_completed": payload.get("atomic_replacement_completed").and_then(Value::as_bool),
        "atomic_create_completed": payload.get("atomic_create_completed").and_then(Value::as_bool),
        "atomic_delete_completed": payload.get("atomic_delete_completed").and_then(Value::as_bool),
        "path": payload.get("path").and_then(Value::as_str),
        "expected_target_sha256": payload.get("expected_target_sha256").and_then(Value::as_str),
        "expected_target_absent": payload.get("expected_target_absent").and_then(Value::as_bool),
        "pre_write_target_sha256": payload.get("pre_write_target_sha256").and_then(Value::as_str),
        "pre_write_target_exists": payload.get("pre_write_target_exists").and_then(Value::as_bool),
        "post_write_sha256": payload.get("post_write_sha256").and_then(Value::as_str),
        "post_delete_target_exists": payload.get("post_delete_target_exists").and_then(Value::as_bool),
        "content_chars": payload.get("content_chars").and_then(Value::as_u64),
        "content_bytes": payload.get("content_bytes").and_then(Value::as_u64),
    });
    format!("sha256:{}", hex_sha256(canonical.to_string().as_bytes()))
}

pub(super) fn patch_apply_recovery_provenance_for_source(
    store: &BrownieStore,
    source: &PatchApplyRecoverySource,
) -> Result<PatchApplyRecoveryProvenance, VerificationRecoveryAdmissionError> {
    for (field, value) in [
        ("source_run_id", source.source_run_id.as_str()),
        ("source_proposal_id", source.source_proposal_id.as_str()),
        ("source_apply_id", source.source_apply_id.as_str()),
    ] {
        if value.trim().is_empty() {
            return Err(VerificationRecoveryAdmissionError::InvalidParams(format!(
                "invalid params: patch_apply_recovery_source.{field} must not be empty"
            )));
        }
    }
    if !source.authorize_patch_apply_recovery {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: patch_apply_recovery_source.authorize_patch_apply_recovery must be true"
                .into(),
        ));
    }
    if !is_sha256_fingerprint(&source.expected_source_apply_fingerprint) {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: patch_apply_recovery_source.expected_source_apply_fingerprint must be a sha256 fingerprint"
                .into(),
        ));
    }
    if !is_sha256_fingerprint(&source.expected_failure_fingerprint) {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: patch_apply_recovery_source.expected_failure_fingerprint must be a sha256 fingerprint"
                .into(),
        ));
    }

    let events = store
        .tasks()
        .read_ledger_events(&source.source_run_id)
        .map_err(|error| VerificationRecoveryAdmissionError::Internal(error.to_string()))?;
    let latest_for_proposal = events
        .iter()
        .rev()
        .find_map(|event| {
            if event.kind != LedgerEventKind::WorkspacePatchApplyResultRecorded {
                return None;
            }
            let payload = event.payload.clone()?;
            if payload.get("proposal_id").and_then(Value::as_str)
                == Some(source.source_proposal_id.as_str())
            {
                Some(payload)
            } else {
                None
            }
        })
        .ok_or_else(|| {
            VerificationRecoveryAdmissionError::InvalidParams(
                "invalid params: patch apply recovery source has no matching apply result".into(),
            )
        })?;
    if latest_for_proposal.get("apply_id").and_then(Value::as_str)
        != Some(source.source_apply_id.as_str())
    {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: patch apply recovery source apply result is superseded".into(),
        ));
    }
    let payload = latest_for_proposal;
    if payload.get("operation").and_then(Value::as_str) != Some("patch_file") {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: patch apply recovery source operation is not patch_file".into(),
        ));
    }
    if payload.get("apply_status").and_then(Value::as_str) != Some("Denied") {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: patch apply recovery source status is not denied".into(),
        ));
    }
    if payload.get("applied").and_then(Value::as_bool) != Some(false) {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: patch apply recovery source applied flag must be false".into(),
        ));
    }
    if payload
        .get("authorization_consumed")
        .and_then(Value::as_bool)
        != Some(false)
    {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: patch apply recovery source authorization must be unconsumed".into(),
        ));
    }
    let normalized_path = patch_apply_recovery_normalized_path(
        payload
            .get("path")
            .and_then(Value::as_str)
            .unwrap_or_default(),
    )
    .ok_or_else(|| {
        VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: patch apply recovery source path is not safe".into(),
        )
    })?;
    let failure_class = patch_apply_recovery_failure_class(&payload).ok_or_else(|| {
        VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: patch apply recovery source failure class is not recoverable".into(),
        )
    })?;
    let failed_checks = payload_string_array(&payload, "failed_checks");
    if failed_checks.len() != 1 || failed_checks.first() != Some(&failure_class) {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: patch apply recovery source must have exactly one recoverable failed check"
                .into(),
        ));
    }
    if !payload_string_array(&payload, "blocked_checks").is_empty() {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: patch apply recovery source blocked checks must be empty".into(),
        ));
    }
    let hunk_count = payload
        .get("hunk_count")
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
        .filter(|value| (1..=5).contains(value))
        .ok_or_else(|| {
            VerificationRecoveryAdmissionError::InvalidParams(
                "invalid params: patch apply recovery source hunk_count is invalid".into(),
            )
        })?;
    let hunk_fingerprint = payload
        .get("hunk_fingerprint")
        .and_then(Value::as_str)
        .filter(|value| is_sha256_fingerprint(value))
        .ok_or_else(|| {
            VerificationRecoveryAdmissionError::InvalidParams(
                "invalid params: patch apply recovery source hunk_fingerprint is invalid".into(),
            )
        })?
        .to_string();
    let source_apply_fingerprint = patch_apply_recovery_source_fingerprint(&payload);
    if source_apply_fingerprint != source.expected_source_apply_fingerprint {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: patch_apply_recovery_source.expected_source_apply_fingerprint is stale"
                .into(),
        ));
    }
    let failure_fingerprint = patch_apply_recovery_failure_fingerprint(
        &payload,
        &source_apply_fingerprint,
        &failure_class,
    );
    if failure_fingerprint != source.expected_failure_fingerprint {
        return Err(VerificationRecoveryAdmissionError::InvalidParams(
            "invalid params: patch_apply_recovery_source.expected_failure_fingerprint is stale"
                .into(),
        ));
    }
    Ok(PatchApplyRecoveryProvenance {
        source_run_id: source.source_run_id.clone(),
        source_proposal_id: source.source_proposal_id.clone(),
        source_apply_id: source.source_apply_id.clone(),
        source_apply_fingerprint,
        failure_fingerprint,
        failure_class,
        operation: "patch_file".to_string(),
        path: normalized_path,
        hunk_count: Some(hunk_count),
        hunk_fingerprint: Some(hunk_fingerprint),
    })
}

fn patch_apply_recovery_failure_class(payload: &Value) -> Option<String> {
    let failed = payload_string_array(payload, "failed_checks");
    for check in [
        "expected_target_hash_matches",
        "latest_preflight_validation",
        "patch_hunk_context_matches",
        "approved_patch_metadata_matches",
    ] {
        if failed.iter().any(|value| value == check) {
            return Some(check.to_string());
        }
    }
    None
}

pub(super) fn patch_apply_recovery_normalized_path(path: &str) -> Option<String> {
    if path.trim().is_empty() {
        return None;
    }
    let mut components = Vec::new();
    for component in Path::new(path).components() {
        match component {
            Component::CurDir => {}
            Component::Normal(value) => components.push(value.to_str()?.to_string()),
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    if components.is_empty() {
        return None;
    }
    let normalized = components.join("/");
    brownie_tools::preflight_workspace_write_path(&normalized).ok()?;
    Some(normalized)
}

pub(super) fn patch_apply_recovery_runtime_goal(
    caller_goal: &str,
    provenance: &PatchApplyRecoveryProvenance,
) -> String {
    let hunk_count = provenance
        .hunk_count
        .map(|value| value.to_string())
        .unwrap_or_else(|| "unknown".to_string());
    let hunk_fingerprint = provenance.hunk_fingerprint.as_deref().unwrap_or("unknown");
    format!(
        "Patch apply recovery task. Runtime constraints: recover only source path {}; source operation {}; failure class {}; source proposal {}; source apply {}; source apply fingerprint {}; failure fingerprint {}; source hunk count {}; source hunk fingerprint {}; create exactly one patch_file recovery proposal for the source path; do not approve, apply, or mutate workspace files. Caller supplemental goal: {}",
        provenance.path,
        provenance.operation,
        provenance.failure_class,
        provenance.source_proposal_id,
        provenance.source_apply_id,
        provenance.source_apply_fingerprint,
        provenance.failure_fingerprint,
        hunk_count,
        hunk_fingerprint,
        caller_goal.trim()
    )
}

pub(super) fn patch_apply_recovery_source_fingerprint(payload: &Value) -> String {
    let canonical = json!({
        "version": "patch_apply_recovery_source_v1",
        "proposal_id": payload.get("proposal_id").and_then(Value::as_str),
        "apply_id": payload.get("apply_id").and_then(Value::as_str),
        "apply_status": payload.get("apply_status").and_then(Value::as_str),
        "operation": payload.get("operation").and_then(Value::as_str),
        "path": payload.get("path").and_then(Value::as_str),
        "expected_target_sha256": payload.get("expected_target_sha256").and_then(Value::as_str),
        "pre_write_target_sha256": payload.get("pre_write_target_sha256").and_then(Value::as_str),
        "hunk_count": payload.get("hunk_count").and_then(Value::as_u64),
        "hunk_fingerprint": payload.get("hunk_fingerprint").and_then(Value::as_str),
        "failed_checks": payload_string_array(payload, "failed_checks"),
        "blocked_checks": payload_string_array(payload, "blocked_checks"),
    });
    format!("sha256:{}", hex_sha256(canonical.to_string().as_bytes()))
}

pub(super) fn patch_apply_recovery_failure_fingerprint(
    payload: &Value,
    source_apply_fingerprint: &str,
    failure_class: &str,
) -> String {
    let canonical = json!({
        "version": "patch_apply_recovery_failure_v1",
        "source_apply_fingerprint": source_apply_fingerprint,
        "failure_class": failure_class,
        "apply_reason": payload.get("apply_reason").and_then(Value::as_str),
    });
    format!("sha256:{}", hex_sha256(canonical.to_string().as_bytes()))
}

pub(super) fn revalidate_verification_recovery_task_for_run(
    store: &BrownieStore,
    record: &TaskRecord,
) -> Result<bool, TaskRunAdmissionRejection> {
    let Some(provenance) = record.verification_recovery_provenance.as_ref() else {
        return Ok(false);
    };
    let source = VerificationRecoverySource {
        source_task_id: provenance.source_task_id.clone(),
        source_run_id: provenance.source_run_id.clone(),
        expected_failure_fingerprint: provenance.failure_fingerprint.clone(),
        authorize_recovery: true,
    };
    let latest =
        verification_recovery_provenance_for_source(store, &source).map_err(
            |error| match error {
                VerificationRecoveryAdmissionError::InvalidParams(_) => {
                    TaskRunAdmissionRejection::InvalidParams(
                        "invalid params: verification recovery provenance is stale",
                    )
                }
                VerificationRecoveryAdmissionError::Internal(message) => {
                    TaskRunAdmissionRejection::Internal(message)
                }
            },
        )?;
    if latest != *provenance {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: verification recovery provenance is stale",
        ));
    }
    Ok(true)
}

pub(super) fn revalidate_patch_apply_recovery_task_for_run(
    store: &BrownieStore,
    record: &TaskRecord,
) -> Result<bool, TaskRunAdmissionRejection> {
    let Some(provenance) = record.patch_apply_recovery_provenance.as_ref() else {
        return Ok(false);
    };
    let source = PatchApplyRecoverySource {
        source_run_id: provenance.source_run_id.clone(),
        source_proposal_id: provenance.source_proposal_id.clone(),
        source_apply_id: provenance.source_apply_id.clone(),
        expected_source_apply_fingerprint: provenance.source_apply_fingerprint.clone(),
        expected_failure_fingerprint: provenance.failure_fingerprint.clone(),
        authorize_patch_apply_recovery: true,
    };
    let latest =
        patch_apply_recovery_provenance_for_source(store, &source).map_err(
            |error| match error {
                VerificationRecoveryAdmissionError::InvalidParams(_) => {
                    TaskRunAdmissionRejection::InvalidParams(
                        "invalid params: patch apply recovery provenance is stale",
                    )
                }
                VerificationRecoveryAdmissionError::Internal(message) => {
                    TaskRunAdmissionRejection::Internal(message)
                }
            },
        )?;
    if latest != *provenance {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: patch apply recovery provenance is stale",
        ));
    }
    Ok(true)
}

pub(super) fn revalidate_verification_recovery_retry_task_for_run(
    store: &BrownieStore,
    record: &TaskRecord,
) -> Result<bool, TaskRunAdmissionRejection> {
    let Some(provenance) = record.verification_recovery_retry_provenance.as_ref() else {
        return Ok(false);
    };
    let source = VerificationRecoveryRetrySource {
        source_task_id: provenance.source_task_id.clone(),
        source_run_id: provenance.source_run_id.clone(),
        recovery_task_id: provenance.recovery_task_id.clone(),
        recovery_run_id: provenance.recovery_run_id.clone(),
        proposal_id: provenance.proposal_id.clone(),
        apply_id: provenance.apply_id.clone(),
        expected_failure_fingerprint: provenance.failure_fingerprint.clone(),
        expected_apply_fingerprint: provenance.apply_fingerprint.clone(),
        authorize_verification_retry: true,
    };
    let latest =
        verification_recovery_retry_provenance_for_source(store, &source).map_err(|error| {
            match error {
                VerificationRecoveryAdmissionError::InvalidParams(_) => {
                    TaskRunAdmissionRejection::InvalidParams(
                        "invalid params: verification recovery retry provenance is stale",
                    )
                }
                VerificationRecoveryAdmissionError::Internal(message) => {
                    TaskRunAdmissionRejection::Internal(message)
                }
            }
        })?;
    if latest != *provenance {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: verification recovery retry provenance is stale",
        ));
    }
    Ok(true)
}

pub(super) fn revalidate_llm_provider_failure_retry_task_for_run(
    store: &BrownieStore,
    record: &TaskRecord,
) -> Result<bool, TaskRunAdmissionRejection> {
    let Some(provenance) = record.llm_provider_failure_retry_provenance.as_ref() else {
        return Ok(false);
    };
    let source = LlmProviderFailureRetrySource {
        source_task_id: provenance.source_task_id.clone(),
        source_run_id: provenance.source_run_id.clone(),
        expected_failure_fingerprint: provenance.failure_fingerprint.clone(),
        authorize_provider_failure_retry: true,
    };
    let latest =
        llm_provider_failure_retry_provenance_for_source(store, &source).map_err(|error| {
            match error {
                VerificationRecoveryAdmissionError::InvalidParams(_) => {
                    TaskRunAdmissionRejection::InvalidParams(
                        "invalid params: LLM provider failure retry provenance is stale",
                    )
                }
                VerificationRecoveryAdmissionError::Internal(message) => {
                    TaskRunAdmissionRejection::Internal(message)
                }
            }
        })?;
    if latest != *provenance {
        return Err(TaskRunAdmissionRejection::InvalidParams(
            "invalid params: LLM provider failure retry provenance is stale",
        ));
    }
    Ok(true)
}

pub(super) fn verification_recovery_retry_outcome_for_replay(
    store: &BrownieStore,
    record: &TaskRecord,
) -> anyhow::Result<
    Option<(
        TaskRunAgentLoopSummary,
        Option<TaskRunVerificationCompletionGate>,
        TaskRunVerificationRecoveryRetryOutcome,
    )>,
> {
    if record.verification_recovery_retry_provenance.is_none()
        || !matches!(record.status, TaskStatus::Completed | TaskStatus::Failed)
    {
        return Ok(None);
    }
    let events = store.tasks().read_ledger_events(&record.run_id)?;
    let runtime_requirement = runtime_verification_requirement_for_record(record);
    let gate = verification_completion_gate_for_run_with_requirement(
        &events,
        runtime_requirement.as_ref(),
    );
    let Some(outcome) =
        verification_recovery_retry_outcome_for_run(store, record, gate.as_ref(), true)?
    else {
        return Ok(None);
    };
    let summary = match record.status {
        TaskStatus::Completed => {
            "Verification recovery retry already completed; replaying bounded retry outcome."
        }
        TaskStatus::Failed => {
            "Verification recovery retry already failed; replaying bounded retry outcome."
        }
        _ => "Verification recovery retry replayed.",
    };
    Ok(Some((
        TaskRunAgentLoopSummary {
            final_state: match record.status {
                TaskStatus::Completed => agent_loop_state_name(AgentLoopState::Completed),
                TaskStatus::Failed => agent_loop_state_name(AgentLoopState::Failed),
                _ => agent_loop_state_name(AgentLoopState::Failed),
            }
            .to_string(),
            completion_summary: summary.to_string(),
        },
        gate,
        outcome,
    )))
}

pub(super) fn verification_recovery_retry_outcome_for_run(
    _store: &BrownieStore,
    record: &TaskRecord,
    gate: Option<&TaskRunVerificationCompletionGate>,
    replayed: bool,
) -> anyhow::Result<Option<TaskRunVerificationRecoveryRetryOutcome>> {
    let Some(provenance) = record.verification_recovery_retry_provenance.as_ref() else {
        return Ok(None);
    };
    let passed_verifier_tool_ids = gate
        .map(|gate| gate.passed_verifier_tool_ids.clone())
        .unwrap_or_default();
    let failed_verifier_tool_ids = gate
        .map(|gate| gate.failed_verifier_tool_ids.clone())
        .unwrap_or_else(|| provenance.retried_verifier_tool_ids.clone());
    let retry_status = gate
        .map(|gate| gate.status.clone())
        .unwrap_or_else(|| VERIFICATION_COMPLETION_GATE_STATUS_FAILED.to_string());
    let next_action = if retry_status == VERIFICATION_COMPLETION_GATE_STATUS_PASSED {
        "complete_recovered_task"
    } else {
        "inspect_verification_failure_and_retry_task"
    };
    Ok(Some(TaskRunVerificationRecoveryRetryOutcome {
        source_task_id: provenance.source_task_id.clone(),
        source_run_id: provenance.source_run_id.clone(),
        recovery_task_id: provenance.recovery_task_id.clone(),
        recovery_run_id: provenance.recovery_run_id.clone(),
        retry_task_id: record.task_id.clone(),
        retry_run_id: record.run_id.clone(),
        proposal_id: provenance.proposal_id.clone(),
        apply_id: provenance.apply_id.clone(),
        failure_fingerprint: provenance.failure_fingerprint.clone(),
        apply_fingerprint: provenance.apply_fingerprint.clone(),
        retried_verifier_tool_ids: provenance.retried_verifier_tool_ids.clone(),
        passed_verifier_tool_ids,
        failed_verifier_tool_ids,
        retry_status,
        replayed,
        next_action: next_action.to_string(),
    }))
}

#[derive(Debug, Clone)]
pub(super) struct VerificationRecoveryRepairProposalEvidence {
    pub(super) proposal_id: String,
    pub(super) applicable: bool,
}

pub(super) fn verification_recovery_repair_outcome_for_replay(
    store: &BrownieStore,
    record: &TaskRecord,
) -> anyhow::Result<
    Option<(
        TaskRunAgentLoopSummary,
        TaskRunVerificationRecoveryRepairOutcome,
    )>,
> {
    if record.verification_recovery_provenance.is_none()
        || !matches!(record.status, TaskStatus::Completed | TaskStatus::Failed)
    {
        return Ok(None);
    }
    let Some(outcome) = verification_recovery_repair_outcome_for_run(store, record, true)? else {
        return Ok(None);
    };
    let final_state = match record.status {
        TaskStatus::Completed => AgentLoopState::Completed,
        TaskStatus::Failed => AgentLoopState::Failed,
        _ => AgentLoopState::Failed,
    };
    let completion_summary = if outcome.gate_status == VERIFICATION_COMPLETION_GATE_STATUS_PASSED {
        "Verification recovery repair proposal already exists; replaying bounded proposal handle."
            .to_string()
    } else {
        verification_recovery_repair_failed_summary(&outcome)
    };
    Ok(Some((
        TaskRunAgentLoopSummary {
            final_state: agent_loop_state_name(final_state).to_string(),
            completion_summary,
        },
        outcome,
    )))
}

pub(super) fn verification_recovery_repair_outcome_for_run(
    store: &BrownieStore,
    record: &TaskRecord,
    replayed: bool,
) -> anyhow::Result<Option<TaskRunVerificationRecoveryRepairOutcome>> {
    let Some(provenance) = record.verification_recovery_provenance.as_ref() else {
        return Ok(None);
    };
    let proposals = verification_recovery_repair_proposals_for_run(store, record, provenance)?;
    let invalid_proposal_seen =
        invalid_verification_recovery_repair_proposal_seen(store, record, provenance)?;
    let applicable_proposal = proposals
        .iter()
        .find(|proposal| proposal.applicable)
        .map(|proposal| proposal.proposal_id.clone());
    let proposal_count = proposals.len();
    let (gate_status, proposal_id, failure_reason, next_action) = match proposal_count {
        1 if applicable_proposal.is_some() => (
            VERIFICATION_COMPLETION_GATE_STATUS_PASSED.to_string(),
            applicable_proposal,
            None,
            "review_and_authorize_recovery_proposal".to_string(),
        ),
        1 => (
            VERIFICATION_COMPLETION_GATE_STATUS_FAILED.to_string(),
            None,
            Some("RecoveryRepairProposalNotApplicable".to_string()),
            "inspect_recovery_repair_gate_failure".to_string(),
        ),
        0 if invalid_proposal_seen => (
            VERIFICATION_COMPLETION_GATE_STATUS_FAILED.to_string(),
            None,
            Some("InvalidRecoveryRepairProvenance".to_string()),
            "inspect_recovery_repair_gate_failure".to_string(),
        ),
        0 => (
            VERIFICATION_COMPLETION_GATE_STATUS_FAILED.to_string(),
            None,
            Some("MissingRecoveryRepairProposal".to_string()),
            "inspect_recovery_repair_gate_failure".to_string(),
        ),
        _ => (
            VERIFICATION_COMPLETION_GATE_STATUS_FAILED.to_string(),
            None,
            Some("AmbiguousRecoveryRepairProposals".to_string()),
            "inspect_recovery_repair_gate_failure".to_string(),
        ),
    };
    Ok(Some(TaskRunVerificationRecoveryRepairOutcome {
        gate_status,
        source_task_id: provenance.source_task_id.clone(),
        source_run_id: provenance.source_run_id.clone(),
        recovery_task_id: record.task_id.clone(),
        recovery_run_id: record.run_id.clone(),
        failure_fingerprint: provenance.failure_fingerprint.clone(),
        failed_verifier_tool_ids: provenance.failed_verifier_tool_ids.clone(),
        proposal_id,
        proposal_count,
        failure_reason,
        replayed,
        apply_enabled: false,
        next_action,
    }))
}

pub(super) fn verification_recovery_repair_proposals_for_run(
    store: &BrownieStore,
    record: &TaskRecord,
    provenance: &VerificationRecoveryProvenance,
) -> anyhow::Result<Vec<VerificationRecoveryRepairProposalEvidence>> {
    let events = store.tasks().read_ledger_events(&record.run_id)?;
    let mut proposals = Vec::new();
    for event in events {
        if event.kind != LedgerEventKind::WorkspacePatchProposed {
            continue;
        }
        let Some(payload) = sanitize_ledger_payload(event.payload) else {
            continue;
        };
        if payload
            .get("verification_recovery_repair")
            .and_then(Value::as_bool)
            != Some(true)
        {
            continue;
        }
        if payload.get("source_task_id").and_then(Value::as_str)
            != Some(provenance.source_task_id.as_str())
            || payload.get("source_run_id").and_then(Value::as_str)
                != Some(provenance.source_run_id.as_str())
            || payload.get("recovery_task_id").and_then(Value::as_str)
                != Some(record.task_id.as_str())
            || payload.get("recovery_run_id").and_then(Value::as_str)
                != Some(record.run_id.as_str())
            || payload.get("failure_fingerprint").and_then(Value::as_str)
                != Some(provenance.failure_fingerprint.as_str())
        {
            continue;
        }
        let failed_verifier_tool_ids = payload_string_array(&payload, "failed_verifier_tool_ids");
        if failed_verifier_tool_ids.as_slice() != provenance.failed_verifier_tool_ids.as_slice() {
            continue;
        }
        let Some(proposal_id) = payload
            .get("proposal_id")
            .and_then(Value::as_str)
            .filter(|proposal_id| !proposal_id.trim().is_empty())
            .map(ToString::to_string)
        else {
            continue;
        };
        let applicable = payload.get("validation_status").and_then(Value::as_str) == Some("Valid");
        proposals.push(VerificationRecoveryRepairProposalEvidence {
            proposal_id,
            applicable,
        });
    }
    Ok(proposals)
}

fn invalid_verification_recovery_repair_proposal_seen(
    store: &BrownieStore,
    record: &TaskRecord,
    provenance: &VerificationRecoveryProvenance,
) -> anyhow::Result<bool> {
    let events = store.tasks().read_ledger_events(&record.run_id)?;
    for event in events {
        if event.kind != LedgerEventKind::WorkspacePatchProposed {
            continue;
        }
        let Some(payload) = sanitize_ledger_payload(event.payload) else {
            continue;
        };
        if payload
            .get("verification_recovery_repair")
            .and_then(Value::as_bool)
            != Some(true)
        {
            continue;
        }
        let failed_verifier_tool_ids = payload_string_array(&payload, "failed_verifier_tool_ids");
        let valid = payload.get("source_task_id").and_then(Value::as_str)
            == Some(provenance.source_task_id.as_str())
            && payload.get("source_run_id").and_then(Value::as_str)
                == Some(provenance.source_run_id.as_str())
            && payload.get("recovery_task_id").and_then(Value::as_str)
                == Some(record.task_id.as_str())
            && payload.get("recovery_run_id").and_then(Value::as_str)
                == Some(record.run_id.as_str())
            && payload.get("failure_fingerprint").and_then(Value::as_str)
                == Some(provenance.failure_fingerprint.as_str())
            && failed_verifier_tool_ids.as_slice()
                == provenance.failed_verifier_tool_ids.as_slice()
            && payload
                .get("proposal_id")
                .and_then(Value::as_str)
                .map(|proposal_id| !proposal_id.trim().is_empty())
                == Some(true);
        if !valid {
            return Ok(true);
        }
    }
    Ok(false)
}

#[derive(Debug, Clone)]
struct PatchApplyRecoveryRepairProposalEvidence {
    proposal_id: String,
    applicable: bool,
}

pub(super) fn patch_apply_recovery_repair_outcome_for_replay(
    store: &BrownieStore,
    record: &TaskRecord,
) -> anyhow::Result<
    Option<(
        TaskRunAgentLoopSummary,
        TaskRunPatchApplyRecoveryRepairOutcome,
    )>,
> {
    if record.patch_apply_recovery_provenance.is_none()
        || !matches!(record.status, TaskStatus::Completed | TaskStatus::Failed)
    {
        return Ok(None);
    }
    let Some(outcome) = patch_apply_recovery_repair_outcome_for_run(store, record, true)? else {
        return Ok(None);
    };
    let final_state = if outcome.gate_status == VERIFICATION_COMPLETION_GATE_STATUS_PASSED {
        AgentLoopState::Completed
    } else {
        AgentLoopState::Failed
    };
    let completion_summary = if outcome.gate_status == VERIFICATION_COMPLETION_GATE_STATUS_PASSED {
        "Patch apply recovery proposal already exists; replaying bounded proposal handle."
            .to_string()
    } else {
        patch_apply_recovery_repair_failed_summary(&outcome)
    };
    Ok(Some((
        TaskRunAgentLoopSummary {
            final_state: agent_loop_state_name(final_state).to_string(),
            completion_summary,
        },
        outcome,
    )))
}

pub(super) fn patch_apply_recovery_repair_outcome_for_run(
    store: &BrownieStore,
    record: &TaskRecord,
    replayed: bool,
) -> anyhow::Result<Option<TaskRunPatchApplyRecoveryRepairOutcome>> {
    let Some(provenance) = record.patch_apply_recovery_provenance.as_ref() else {
        return Ok(None);
    };
    let proposals = patch_apply_recovery_repair_proposals_for_run(store, record, provenance)?;
    let proposal_id = proposals
        .iter()
        .find(|proposal| proposal.applicable)
        .map(|proposal| proposal.proposal_id.clone());
    let proposal_count = proposals.len();
    let (gate_status, failure_reason, next_action) = match proposal_count {
        1 if proposal_id.is_some() => (
            VERIFICATION_COMPLETION_GATE_STATUS_PASSED.to_string(),
            None,
            "review_and_authorize_recovery_proposal".to_string(),
        ),
        1 => (
            VERIFICATION_COMPLETION_GATE_STATUS_FAILED.to_string(),
            Some("PatchApplyRecoveryProposalNotApplicable".to_string()),
            "inspect_recovery_repair_gate_failure".to_string(),
        ),
        0 => (
            VERIFICATION_COMPLETION_GATE_STATUS_FAILED.to_string(),
            Some("MissingPatchApplyRecoveryProposal".to_string()),
            "inspect_recovery_repair_gate_failure".to_string(),
        ),
        _ => (
            VERIFICATION_COMPLETION_GATE_STATUS_FAILED.to_string(),
            Some("AmbiguousPatchApplyRecoveryProposals".to_string()),
            "inspect_recovery_repair_gate_failure".to_string(),
        ),
    };
    Ok(Some(TaskRunPatchApplyRecoveryRepairOutcome {
        gate_status,
        source_run_id: provenance.source_run_id.clone(),
        source_proposal_id: provenance.source_proposal_id.clone(),
        source_apply_id: provenance.source_apply_id.clone(),
        recovery_task_id: record.task_id.clone(),
        recovery_run_id: record.run_id.clone(),
        source_apply_fingerprint: provenance.source_apply_fingerprint.clone(),
        failure_fingerprint: provenance.failure_fingerprint.clone(),
        failure_class: provenance.failure_class.clone(),
        proposal_id,
        proposal_count,
        failure_reason,
        replayed,
        apply_enabled: false,
        next_action,
    }))
}

fn patch_apply_recovery_repair_proposals_for_run(
    store: &BrownieStore,
    record: &TaskRecord,
    provenance: &PatchApplyRecoveryProvenance,
) -> anyhow::Result<Vec<PatchApplyRecoveryRepairProposalEvidence>> {
    let events = store.tasks().read_ledger_events(&record.run_id)?;
    let mut proposals = Vec::new();
    for event in events {
        if event.kind != LedgerEventKind::WorkspacePatchProposed {
            continue;
        }
        let Some(payload) = sanitize_ledger_payload(event.payload) else {
            continue;
        };
        if payload
            .get("patch_apply_recovery_repair")
            .and_then(Value::as_bool)
            != Some(true)
        {
            continue;
        }
        if payload.get("source_run_id").and_then(Value::as_str)
            != Some(provenance.source_run_id.as_str())
            || payload.get("source_proposal_id").and_then(Value::as_str)
                != Some(provenance.source_proposal_id.as_str())
            || payload.get("source_apply_id").and_then(Value::as_str)
                != Some(provenance.source_apply_id.as_str())
            || payload.get("recovery_task_id").and_then(Value::as_str)
                != Some(record.task_id.as_str())
            || payload.get("recovery_run_id").and_then(Value::as_str)
                != Some(record.run_id.as_str())
            || payload.get("failure_fingerprint").and_then(Value::as_str)
                != Some(provenance.failure_fingerprint.as_str())
        {
            continue;
        }
        let path_matches_source = payload
            .get("path")
            .and_then(Value::as_str)
            .and_then(patch_apply_recovery_normalized_path)
            .as_deref()
            == Some(provenance.path.as_str());
        let Some(proposal_id) = payload
            .get("proposal_id")
            .and_then(Value::as_str)
            .filter(|proposal_id| !proposal_id.trim().is_empty())
            .map(ToString::to_string)
        else {
            continue;
        };
        let applicable = path_matches_source
            && payload.get("validation_status").and_then(Value::as_str) == Some("Valid");
        proposals.push(PatchApplyRecoveryRepairProposalEvidence {
            proposal_id,
            applicable,
        });
    }
    Ok(proposals)
}

pub(super) fn patch_apply_recovery_repair_failed_summary(
    outcome: &TaskRunPatchApplyRecoveryRepairOutcome,
) -> String {
    format!(
        "Patch apply recovery repair gate failed: {}.",
        outcome
            .failure_reason
            .as_deref()
            .unwrap_or("PatchApplyRecoveryRepairGateFailed")
    )
}

pub(super) fn verification_recovery_failure_fingerprint(
    source_task: &TaskRecord,
    gate: &TaskRunVerificationCompletionGate,
) -> String {
    let canonical = json!({
        "version": "verification_recovery_failure_fingerprint_v1",
        "source_task_id": source_task.task_id,
        "source_run_id": source_task.run_id,
        "source_status": source_task.status,
        "verification_completion_gate_status": gate.status,
        "required_verifier_count": gate.required_verifier_count,
        "passed_verifier_count": gate.passed_verifier_count,
        "failed_verifier_count": gate.failed_verifier_count,
        "required_verifier_tool_ids": gate.required_verifier_tool_ids,
        "passed_verifier_tool_ids": gate.passed_verifier_tool_ids,
        "failed_verifier_tool_ids": gate.failed_verifier_tool_ids,
        "failure_reasons": gate.failure_reasons,
        "bounded_cargo_diagnostics": gate.bounded_cargo_diagnostics,
        "next_action": gate.next_action,
    });
    format!("sha256:{}", hex_sha256(canonical.to_string().as_bytes()))
}

fn has_terminal_failed_task_event_with_verification_gate(events: &[LedgerEvent]) -> bool {
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
        .map(|event| {
            event.kind == LedgerEventKind::TaskFailed
                && event
                    .payload
                    .as_ref()
                    .and_then(|payload| payload.get("verification_completion_gate_status"))
                    .and_then(Value::as_str)
                    == Some(VERIFICATION_COMPLETION_GATE_STATUS_FAILED)
        })
        .unwrap_or(false)
}

pub(super) fn verification_completion_gate_failed_summary(
    gate: &TaskRunVerificationCompletionGate,
) -> String {
    format!(
        "Verification completion gate failed: required_verifier_count={} passed_verifier_count={} failed_verifier_count={} failed_verifier_tool_ids={} next_action={}",
        gate.required_verifier_count,
        gate.passed_verifier_count,
        gate.failed_verifier_count,
        gate.failed_verifier_tool_ids.join(","),
        gate.next_action
    )
}

pub(super) fn verification_recovery_repair_failed_summary(
    repair: &TaskRunVerificationRecoveryRepairOutcome,
) -> String {
    format!(
        "Verification recovery repair gate failed: proposal_count={} failure_reason={} next_action={}",
        repair.proposal_count,
        repair
            .failure_reason
            .as_deref()
            .unwrap_or("UnknownRecoveryRepairFailure"),
        repair.next_action
    )
}
