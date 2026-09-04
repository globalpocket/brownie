use super::*;

pub(super) fn append_headless_product_evidence_matrix_event_if_missing(
    store: &BrownieStore,
    matrix: &HeadlessRunProductEvidenceMatrix,
) -> anyhow::Result<()> {
    let Some(record) = store.tasks().get_task(&matrix.task_id)? else {
        return Ok(());
    };
    if record.run_id != matrix.run_id {
        return Ok(());
    }
    let events = store.tasks().read_ledger_events(&matrix.run_id)?;
    for event in events {
        if event.kind != LedgerEventKind::HeadlessRunProductEvidenceMatrixDerived {
            continue;
        }
        let Some(payload) = event.payload.as_ref() else {
            continue;
        };
        let same_boundary = payload.get("task_id").and_then(Value::as_str)
            == Some(matrix.task_id.as_str())
            && payload.get("run_id").and_then(Value::as_str) == Some(matrix.run_id.as_str())
            && payload
                .get("accepted_completion_fingerprint")
                .and_then(Value::as_str)
                == Some(matrix.accepted_completion_fingerprint.as_str())
            && payload
                .get("terminal_completion_fingerprint")
                .and_then(Value::as_str)
                == Some(matrix.terminal_completion_fingerprint.as_str())
            && payload
                .get("completion_closure_fingerprint")
                .and_then(Value::as_str)
                == Some(matrix.completion_closure_fingerprint.as_str())
            && payload.get("phase_id").and_then(Value::as_str) == Some(matrix.phase_id.as_str());
        if !same_boundary {
            continue;
        }
        if payload
            .get("product_evidence_matrix_fingerprint")
            .and_then(Value::as_str)
            == Some(matrix.product_evidence_matrix_fingerprint.as_str())
        {
            return Ok(());
        }
        anyhow::bail!(
            "product evidence matrix conflicts with persisted completion boundary matrix"
        );
    }
    store.tasks().append_task_event_with_payload(
        &record,
        LedgerEventKind::HeadlessRunProductEvidenceMatrixDerived,
        Some(headless_product_evidence_matrix_payload(matrix)),
    )?;
    Ok(())
}

pub(super) fn append_headless_selected_product_gap_closure_event_if_missing(
    store: &BrownieStore,
    closure: &HeadlessRunSelectedProductGapClosureEvidence,
) -> anyhow::Result<()> {
    let Some(record) = store.tasks().get_task(&closure.task_id)? else {
        return Ok(());
    };
    if record.run_id != closure.run_id {
        return Ok(());
    }
    match headless_selected_product_gap_closure_event_status(store, closure)? {
        HeadlessSelectedProductGapClosureEventStatus::ExactReplay => return Ok(()),
        HeadlessSelectedProductGapClosureEventStatus::ConflictingBoundaryClosure => {
            anyhow::bail!("selected product gap closure conflicts with persisted closure boundary");
        }
        HeadlessSelectedProductGapClosureEventStatus::Missing => {}
    }
    store.tasks().append_task_event_with_payload(
        &record,
        LedgerEventKind::HeadlessRunSelectedProductGapClosureRecorded,
        Some(headless_selected_product_gap_closure_payload(closure)),
    )?;
    Ok(())
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum HeadlessSelectedProductGapClosureEventStatus {
    Missing,
    ExactReplay,
    ConflictingBoundaryClosure,
}

fn headless_selected_product_gap_closure_event_status(
    store: &BrownieStore,
    closure: &HeadlessRunSelectedProductGapClosureEvidence,
) -> anyhow::Result<HeadlessSelectedProductGapClosureEventStatus> {
    let events = store.tasks().read_ledger_events(&closure.run_id)?;
    let mut has_conflict = false;
    for event in events {
        if event.kind != LedgerEventKind::HeadlessRunSelectedProductGapClosureRecorded {
            continue;
        }
        let Some(payload) = event.payload.as_ref() else {
            continue;
        };
        let same_boundary = payload.get("closure_id").and_then(Value::as_str)
            == Some(closure.closure_id.as_str())
            || (payload
                .get("selected_remaining_gap")
                .and_then(|gap| gap.get("selection_fingerprint"))
                .and_then(Value::as_str)
                == Some(
                    closure
                        .selected_remaining_gap
                        .selection_fingerprint
                        .as_str(),
                )
                && payload
                    .get("accepted_completion_fingerprint")
                    .and_then(Value::as_str)
                    == Some(closure.accepted_completion_fingerprint.as_str())
                && payload
                    .get("completion_closure_fingerprint")
                    .and_then(Value::as_str)
                    == Some(closure.completion_closure_fingerprint.as_str()));
        if !same_boundary {
            continue;
        }
        if payload
            .get("closure_evidence_fingerprint")
            .and_then(Value::as_str)
            == Some(closure.closure_evidence_fingerprint.as_str())
        {
            return Ok(HeadlessSelectedProductGapClosureEventStatus::ExactReplay);
        }
        has_conflict = true;
    }
    if has_conflict {
        Ok(HeadlessSelectedProductGapClosureEventStatus::ConflictingBoundaryClosure)
    } else {
        Ok(HeadlessSelectedProductGapClosureEventStatus::Missing)
    }
}

pub(super) fn headless_run_selected_product_gap_closure(
    store: &BrownieStore,
    result: &HeadlessRunDriveResult,
    request: Option<&HeadlessRunSelectedProductGapClosureRequest>,
) -> Result<Option<HeadlessRunSelectedProductGapClosureEvidence>, String> {
    if let Some(existing) = result.selected_product_gap_closure.as_ref() {
        if let Some(request) = request {
            validate_selected_product_gap_closure_request(request)?;
            if existing.closure_id != request.closure_id
                || existing.source_decision_id != request.source_decision_id
                || existing.source_decision_fingerprint
                    != request.expected_source_decision_fingerprint
                || existing.product_evidence_fingerprint
                    != request.expected_product_evidence_fingerprint
                || existing.selected_remaining_gap.selection_fingerprint
                    != request.expected_selected_remaining_gap_fingerprint
                || existing.product_objective_fingerprint
                    != request.expected_product_objective_fingerprint
                || existing.accepted_completion_fingerprint
                    != request.expected_accepted_completion_fingerprint
                || existing.terminal_completion_fingerprint
                    != request.expected_terminal_completion_fingerprint
                || existing.completion_closure_fingerprint
                    != request.expected_completion_closure_fingerprint
            {
                return Err(
                    "invalid params: selected product gap closure replay target conflicts with persisted closure"
                        .to_string(),
                );
            }
        }
        return Ok(Some(HeadlessRunSelectedProductGapClosureEvidence {
            replayed: true,
            ..existing.clone()
        }));
    }
    let Some(request) = request else {
        return Ok(None);
    };
    validate_selected_product_gap_closure_request(request)?;
    let accepted = result.accepted_completion.as_ref().ok_or_else(|| {
        "invalid params: selected product gap closure requires accepted_completion evidence"
            .to_string()
    })?;
    let terminal = result
        .terminal_completion_evidence
        .as_ref()
        .ok_or_else(|| {
            "invalid params: selected product gap closure requires terminal completion evidence"
                .to_string()
        })?;
    if accepted.acceptance_fingerprint != request.expected_accepted_completion_fingerprint {
        return Err(
            "invalid params: selected product gap closure accepted-completion fingerprint mismatch"
                .to_string(),
        );
    }
    if accepted.terminal_completion_fingerprint != request.expected_terminal_completion_fingerprint
        || terminal.completion_result_fingerprint
            != request.expected_terminal_completion_fingerprint
    {
        return Err(
            "invalid params: selected product gap closure terminal completion fingerprint mismatch"
                .to_string(),
        );
    }
    if result.completion_closure.closure_fingerprint
        != request.expected_completion_closure_fingerprint
    {
        return Err(
            "invalid params: selected product gap closure completion-closure fingerprint mismatch"
                .to_string(),
        );
    }
    let record = store
        .tasks()
        .get_task(&accepted.task_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| {
            "invalid params: selected product gap closure task is missing".to_string()
        })?;
    if record.run_id != accepted.run_id {
        return Err(
            "invalid params: selected product gap closure run identity mismatch".to_string(),
        );
    }
    let provenance = record.product_objective_continuation_provenance.ok_or_else(|| {
        "invalid params: selected product gap closure requires product objective continuation provenance"
            .to_string()
    })?;
    if provenance.source_decision_id != request.source_decision_id {
        return Err(
            "invalid params: selected product gap closure source decision id mismatch".to_string(),
        );
    }
    if provenance.decision_fingerprint != request.expected_source_decision_fingerprint {
        return Err(
            "invalid params: selected product gap closure source decision fingerprint mismatch"
                .to_string(),
        );
    }
    if provenance.product_evidence_fingerprint != request.expected_product_evidence_fingerprint {
        return Err(
            "invalid params: selected product gap closure product evidence fingerprint mismatch"
                .to_string(),
        );
    }
    if provenance.derived_objective_fingerprint != request.expected_product_objective_fingerprint {
        return Err(
            "invalid params: selected product gap closure product objective fingerprint mismatch"
                .to_string(),
        );
    }
    let selected_remaining_gap = provenance.selected_remaining_gap.ok_or_else(|| {
        "invalid params: selected product gap closure source has no selected remaining gap"
            .to_string()
    })?;
    if selected_remaining_gap.selection_fingerprint
        != request.expected_selected_remaining_gap_fingerprint
    {
        return Err(
            "invalid params: selected product gap closure selected gap fingerprint mismatch"
                .to_string(),
        );
    }
    if selected_remaining_gap.status != "open" || !selected_remaining_gap.required {
        return Err(
            "invalid params: selected product gap closure source gap is not open and required"
                .to_string(),
        );
    }
    let closure_evidence_fingerprint = headless_selected_product_gap_closure_fingerprint(
        request,
        accepted,
        terminal,
        &result.completion_closure,
        &selected_remaining_gap,
    );
    let mut closure = HeadlessRunSelectedProductGapClosureEvidence {
        closure_id: request.closure_id.clone(),
        task_id: accepted.task_id.clone(),
        run_id: accepted.run_id.clone(),
        acceptance_id: accepted.acceptance_id.clone(),
        source_decision_id: request.source_decision_id.clone(),
        source_decision_fingerprint: provenance.decision_fingerprint,
        product_evidence_fingerprint: provenance.product_evidence_fingerprint,
        product_objective_fingerprint: provenance.derived_objective_fingerprint,
        selected_remaining_gap,
        accepted_completion_fingerprint: accepted.acceptance_fingerprint.clone(),
        terminal_completion_fingerprint: terminal.completion_result_fingerprint.clone(),
        completion_closure_fingerprint: result.completion_closure.closure_fingerprint.clone(),
        closure_evidence_fingerprint,
        status: "closed".to_string(),
        next_action: "derive_product_evidence_matrix_with_closed_gap".to_string(),
        replayed: false,
    };
    closure.replayed = match headless_selected_product_gap_closure_event_status(store, &closure)
        .map_err(|error| error.to_string())?
    {
        HeadlessSelectedProductGapClosureEventStatus::ExactReplay => true,
        HeadlessSelectedProductGapClosureEventStatus::ConflictingBoundaryClosure => {
            return Err(
                "invalid params: selected product gap closure conflicts with persisted closure boundary"
                    .to_string(),
            );
        }
        HeadlessSelectedProductGapClosureEventStatus::Missing => false,
    };
    append_headless_selected_product_gap_closure_event_if_missing(store, &closure)
        .map_err(|error| error.to_string())?;
    Ok(Some(closure))
}

fn validate_selected_product_gap_closure_request(
    request: &HeadlessRunSelectedProductGapClosureRequest,
) -> Result<(), String> {
    if !request.authorize_selected_product_gap_closure {
        return Err(
            "invalid params: selected product gap closure requires explicit authorization"
                .to_string(),
        );
    }
    if !is_valid_headless_run_id(&request.closure_id)
        || !is_valid_headless_run_id(&request.source_decision_id)
    {
        return Err(
            "invalid params: selected product gap closure ids must be bounded identifiers"
                .to_string(),
        );
    }
    for (field, value) in [
        (
            "expected_source_decision_fingerprint",
            &request.expected_source_decision_fingerprint,
        ),
        (
            "expected_product_evidence_fingerprint",
            &request.expected_product_evidence_fingerprint,
        ),
        (
            "expected_selected_remaining_gap_fingerprint",
            &request.expected_selected_remaining_gap_fingerprint,
        ),
        (
            "expected_product_objective_fingerprint",
            &request.expected_product_objective_fingerprint,
        ),
        (
            "expected_accepted_completion_fingerprint",
            &request.expected_accepted_completion_fingerprint,
        ),
        (
            "expected_terminal_completion_fingerprint",
            &request.expected_terminal_completion_fingerprint,
        ),
        (
            "expected_completion_closure_fingerprint",
            &request.expected_completion_closure_fingerprint,
        ),
    ] {
        if !is_sha256_fingerprint(value) {
            return Err(format!(
                "invalid params: selected product gap closure {field} must be sha256"
            ));
        }
    }
    Ok(())
}

fn headless_selected_product_gap_closure_payload(
    closure: &HeadlessRunSelectedProductGapClosureEvidence,
) -> Value {
    json!({
        "closure_id": closure.closure_id,
        "task_id": closure.task_id,
        "run_id": closure.run_id,
        "acceptance_id": closure.acceptance_id,
        "source_decision_id": closure.source_decision_id,
        "source_decision_fingerprint": closure.source_decision_fingerprint,
        "product_evidence_fingerprint": closure.product_evidence_fingerprint,
        "product_objective_fingerprint": closure.product_objective_fingerprint,
        "selected_remaining_gap": closure.selected_remaining_gap,
        "accepted_completion_fingerprint": closure.accepted_completion_fingerprint,
        "terminal_completion_fingerprint": closure.terminal_completion_fingerprint,
        "completion_closure_fingerprint": closure.completion_closure_fingerprint,
        "closure_evidence_fingerprint": closure.closure_evidence_fingerprint,
        "status": closure.status,
        "next_action": closure.next_action,
        "replayed": false,
    })
}

fn headless_selected_product_gap_closure_fingerprint(
    request: &HeadlessRunSelectedProductGapClosureRequest,
    accepted: &HeadlessRunAcceptedCompletion,
    terminal: &brownie_protocol::TaskRunCompletionEvidence,
    closure: &HeadlessRunCompletionClosure,
    selected_remaining_gap: &HeadlessRunProductRemainingGapSelection,
) -> String {
    let canonical = json!({
        "version": "headless_selected_product_gap_closure_v1",
        "closure_id": request.closure_id,
        "task_id": accepted.task_id,
        "run_id": accepted.run_id,
        "acceptance_id": accepted.acceptance_id,
        "source_decision_id": request.source_decision_id,
        "source_decision_fingerprint": request.expected_source_decision_fingerprint,
        "product_evidence_fingerprint": request.expected_product_evidence_fingerprint,
        "product_objective_fingerprint": request.expected_product_objective_fingerprint,
        "selected_remaining_gap": selected_remaining_gap,
        "accepted_completion_fingerprint": accepted.acceptance_fingerprint,
        "terminal_completion_fingerprint": terminal.completion_result_fingerprint,
        "completion_closure_fingerprint": closure.closure_fingerprint,
        "status": "closed",
    });
    format!("sha256:{}", hex_sha256(canonical.to_string().as_bytes()))
}

fn selected_product_gap_closure_evidence_by_gap(
    store: &BrownieStore,
    result: &HeadlessRunDriveResult,
) -> Result<BTreeMap<String, HeadlessRunSelectedProductGapClosureEvidence>, String> {
    let mut closures = BTreeMap::new();
    if let Some(closure) = result.selected_product_gap_closure.as_ref() {
        closures.insert(
            closure.selected_remaining_gap.selection_fingerprint.clone(),
            closure.clone(),
        );
    }
    let tasks = store
        .tasks()
        .list_tasks()
        .map_err(|error| error.to_string())?;
    for task in tasks {
        let events = store
            .tasks()
            .read_ledger_events(&task.run_id)
            .map_err(|error| error.to_string())?;
        for event in events {
            if event.kind != LedgerEventKind::HeadlessRunSelectedProductGapClosureRecorded {
                continue;
            }
            let Some(payload) = event.payload else {
                continue;
            };
            let closure: HeadlessRunSelectedProductGapClosureEvidence =
                serde_json::from_value(payload).map_err(|_| {
                    "invalid params: selected product gap closure event payload is malformed"
                        .to_string()
                })?;
            if closure.status != "closed"
                || !is_sha256_fingerprint(&closure.closure_evidence_fingerprint)
                || !is_sha256_fingerprint(&closure.selected_remaining_gap.selection_fingerprint)
            {
                return Err(
                    "invalid params: selected product gap closure event payload is malformed"
                        .to_string(),
                );
            }
            closures.insert(
                closure.selected_remaining_gap.selection_fingerprint.clone(),
                closure,
            );
        }
    }
    Ok(closures)
}

pub(super) fn headless_run_product_evidence_matrix(
    store: &BrownieStore,
    result: &HeadlessRunDriveResult,
    request: Option<&HeadlessRunProductEvidenceDerivationRequest>,
) -> Result<Option<HeadlessRunProductEvidenceMatrix>, String> {
    if let Some(existing) = result.product_evidence_matrix.as_ref() {
        if let Some(request) = request {
            validate_product_evidence_derivation_request(request)?;
            if existing.derivation_id != request.derivation_id
                || existing.accepted_completion_fingerprint
                    != request.expected_accepted_completion_fingerprint
                || existing.terminal_completion_fingerprint
                    != request.expected_terminal_completion_fingerprint
                || existing.completion_closure_fingerprint
                    != request.expected_completion_closure_fingerprint
            {
                return Err(
                    "invalid params: product evidence matrix replay target conflicts with persisted matrix"
                        .to_string(),
                );
            }
        }
        return Ok(Some(HeadlessRunProductEvidenceMatrix {
            replayed: true,
            ..existing.clone()
        }));
    }
    let Some(request) = request else {
        return Ok(None);
    };
    validate_product_evidence_derivation_request(request)?;
    let accepted = result.accepted_completion.as_ref().ok_or_else(|| {
        "invalid params: product evidence derivation requires accepted_completion route evidence"
            .to_string()
    })?;
    let terminal = result
        .terminal_completion_evidence
        .as_ref()
        .ok_or_else(|| {
            "invalid params: product evidence derivation requires terminal completion evidence"
                .to_string()
        })?;
    if accepted.acceptance_fingerprint != request.expected_accepted_completion_fingerprint {
        return Err(
            "invalid params: product evidence derivation accepted-completion fingerprint mismatch"
                .to_string(),
        );
    }
    if accepted.terminal_completion_fingerprint != request.expected_terminal_completion_fingerprint
        || terminal.completion_result_fingerprint
            != request.expected_terminal_completion_fingerprint
    {
        return Err(
            "invalid params: product evidence derivation terminal completion fingerprint mismatch"
                .to_string(),
        );
    }
    if result.completion_closure.closure_fingerprint
        != request.expected_completion_closure_fingerprint
    {
        return Err(
            "invalid params: product evidence derivation completion-closure fingerprint mismatch"
                .to_string(),
        );
    }
    let (policy_text, artifacts) = read_product_evidence_artifacts(store, request)?;
    let policy_json: Value = serde_json::from_str(&policy_text)
        .map_err(|_| "invalid params: project completion policy must be JSON".to_string())?;
    let selected_gap_closures = selected_product_gap_closure_evidence_by_gap(store, result)?;
    let policy = parse_project_completion_policy(&policy_json, request, &selected_gap_closures)?;
    validate_project_completion_policy_artifacts(&policy.evidence_artifact_paths, request)?;
    let matrix_fingerprint = headless_product_evidence_matrix_fingerprint(
        request,
        accepted,
        terminal,
        &result.completion_closure,
        &policy.target_capability,
        &policy.concrete_capability_transition,
        policy.product_completion_claim,
        &policy.validated_gate_categories,
        policy.behavior_evidence_count,
        policy.rejected_alternatives_count,
        policy.safety_boundary_reviewed,
        policy.non_goals_reviewed,
        policy.technical_debt_reviewed,
        policy.selected_remaining_gap.as_ref(),
        policy.selected_gap_closure_evidence.as_ref(),
        &policy.selected_gap_closure_evidence_set,
        policy.selected_gap_closure_set_fingerprint.as_deref(),
        &artifacts,
    );
    let replayed = headless_product_evidence_matrix_was_persisted(
        store,
        &HeadlessRunProductEvidenceMatrix {
            derivation_id: request.derivation_id.clone(),
            task_id: accepted.task_id.clone(),
            run_id: accepted.run_id.clone(),
            acceptance_id: accepted.acceptance_id.clone(),
            phase_id: request.phase_id.clone(),
            milestone: request.milestone.clone(),
            target_capability: policy.target_capability.clone(),
            concrete_capability_transition: policy.concrete_capability_transition.clone(),
            accepted_completion_fingerprint: accepted.acceptance_fingerprint.clone(),
            terminal_completion_fingerprint: terminal.completion_result_fingerprint.clone(),
            completion_closure_fingerprint: result.completion_closure.closure_fingerprint.clone(),
            product_evidence_matrix_fingerprint: matrix_fingerprint.clone(),
            product_completion_claim: policy.product_completion_claim,
            artifact_count: artifacts.len(),
            artifact_hashes: artifacts.clone(),
            validated_gate_categories: policy.validated_gate_categories.clone(),
            behavior_evidence_count: policy.behavior_evidence_count,
            rejected_alternatives_count: policy.rejected_alternatives_count,
            safety_boundary_reviewed: policy.safety_boundary_reviewed,
            non_goals_reviewed: policy.non_goals_reviewed,
            technical_debt_reviewed: policy.technical_debt_reviewed,
            selected_remaining_gap: policy.selected_remaining_gap.clone(),
            selected_gap_closure_evidence: policy.selected_gap_closure_evidence.clone(),
            selected_gap_closure_evidence_set: policy.selected_gap_closure_evidence_set.clone(),
            selected_gap_closure_set_fingerprint: policy
                .selected_gap_closure_set_fingerprint
                .clone(),
            next_action: "record_product_completion_decision_with_runtime_evidence".to_string(),
            replayed: false,
        },
    )
    .map_err(|error| error.to_string())?;
    let matrix = HeadlessRunProductEvidenceMatrix {
        derivation_id: request.derivation_id.clone(),
        task_id: accepted.task_id.clone(),
        run_id: accepted.run_id.clone(),
        acceptance_id: accepted.acceptance_id.clone(),
        phase_id: request.phase_id.clone(),
        milestone: request.milestone.clone(),
        target_capability: policy.target_capability,
        concrete_capability_transition: policy.concrete_capability_transition,
        accepted_completion_fingerprint: accepted.acceptance_fingerprint.clone(),
        terminal_completion_fingerprint: terminal.completion_result_fingerprint.clone(),
        completion_closure_fingerprint: result.completion_closure.closure_fingerprint.clone(),
        product_evidence_matrix_fingerprint: matrix_fingerprint,
        product_completion_claim: policy.product_completion_claim,
        artifact_count: artifacts.len(),
        artifact_hashes: artifacts,
        validated_gate_categories: policy.validated_gate_categories,
        behavior_evidence_count: policy.behavior_evidence_count,
        rejected_alternatives_count: policy.rejected_alternatives_count,
        safety_boundary_reviewed: policy.safety_boundary_reviewed,
        non_goals_reviewed: policy.non_goals_reviewed,
        technical_debt_reviewed: policy.technical_debt_reviewed,
        selected_remaining_gap: policy.selected_remaining_gap,
        selected_gap_closure_evidence: policy.selected_gap_closure_evidence,
        selected_gap_closure_evidence_set: policy.selected_gap_closure_evidence_set,
        selected_gap_closure_set_fingerprint: policy.selected_gap_closure_set_fingerprint,
        next_action: "record_product_completion_decision_with_runtime_evidence".to_string(),
        replayed,
    };
    append_headless_product_evidence_matrix_event_if_missing(store, &matrix)
        .map_err(|error| error.to_string())?;
    Ok(Some(matrix))
}

#[derive(Debug, Clone)]
struct ProjectCompletionPolicy {
    target_capability: String,
    concrete_capability_transition: String,
    product_completion_claim: bool,
    validated_gate_categories: Vec<String>,
    behavior_evidence_count: usize,
    rejected_alternatives_count: usize,
    safety_boundary_reviewed: bool,
    non_goals_reviewed: bool,
    technical_debt_reviewed: bool,
    selected_remaining_gap: Option<HeadlessRunProductRemainingGapSelection>,
    selected_gap_closure_evidence: Option<HeadlessRunSelectedProductGapClosureEvidence>,
    selected_gap_closure_evidence_set: Vec<HeadlessRunSelectedProductGapClosureEvidence>,
    selected_gap_closure_set_fingerprint: Option<String>,
    evidence_artifact_paths: Vec<String>,
}

fn validate_product_evidence_derivation_request(
    request: &HeadlessRunProductEvidenceDerivationRequest,
) -> Result<(), String> {
    if !request.authorize_product_evidence_derivation {
        return Err(
            "invalid params: product evidence derivation requires explicit authorization"
                .to_string(),
        );
    }
    if !is_valid_headless_run_id(&request.derivation_id) {
        return Err("invalid params: product evidence derivation derivation_id must be 1-48 ASCII alphanumeric, dash, underscore, colon, or dot characters".to_string());
    }
    if !is_bounded_product_completion_text(&request.phase_id, 32)
        || !is_bounded_product_completion_text(&request.milestone, 120)
    {
        return Err("invalid params: product evidence derivation phase_id and milestone must be bounded ASCII metadata".to_string());
    }
    for (field, value) in [
        (
            "expected_accepted_completion_fingerprint",
            &request.expected_accepted_completion_fingerprint,
        ),
        (
            "expected_terminal_completion_fingerprint",
            &request.expected_terminal_completion_fingerprint,
        ),
        (
            "expected_completion_closure_fingerprint",
            &request.expected_completion_closure_fingerprint,
        ),
    ] {
        if !is_sha256_fingerprint(value) {
            return Err(format!(
                "invalid params: product evidence derivation {field} must be sha256"
            ));
        }
    }
    if !is_safe_product_evidence_policy_path(&request.project_completion_policy.path) {
        return Err(
            "invalid params: project completion policy path is unsafe or not JSON".to_string(),
        );
    }
    if !is_sha256_fingerprint(&request.project_completion_policy.expected_sha256) {
        return Err(
            "invalid params: project completion policy expected_sha256 must be sha256".to_string(),
        );
    }
    if request.artifacts.is_empty() || request.artifacts.len() > 32 {
        return Err(
            "invalid params: product evidence derivation requires 1-32 policy-declared artifacts"
                .to_string(),
        );
    }
    let mut paths = vec![request.project_completion_policy.path.as_str()];
    for artifact in &request.artifacts {
        if !is_safe_product_evidence_artifact_path(&artifact.path) {
            return Err("invalid params: product evidence artifact path is unsafe".to_string());
        }
        if !is_sha256_fingerprint(&artifact.expected_sha256) {
            return Err(
                "invalid params: product evidence artifact expected_sha256 must be sha256"
                    .to_string(),
            );
        }
        if paths.iter().any(|path| *path == artifact.path) {
            return Err(
                "invalid params: product evidence derivation artifact paths must be unique"
                    .to_string(),
            );
        }
        paths.push(artifact.path.as_str());
    }
    Ok(())
}

fn is_safe_product_evidence_policy_path(path: &str) -> bool {
    path.ends_with(".json") && is_safe_codebase_index_path(path, false)
}

fn is_safe_product_evidence_artifact_path(path: &str) -> bool {
    is_safe_codebase_index_path(path, false)
}

fn read_product_evidence_artifacts(
    store: &BrownieStore,
    request: &HeadlessRunProductEvidenceDerivationRequest,
) -> Result<(String, Vec<HeadlessRunProductEvidenceArtifact>), String> {
    let (policy_artifact, policy_text) = read_product_evidence_artifact_source(
        store,
        &request.project_completion_policy,
        "project completion policy",
    )?;
    let mut artifacts = request.artifacts.clone();
    artifacts.sort_by(|left, right| left.path.cmp(&right.path));
    let mut result = Vec::with_capacity(artifacts.len() + 1);
    result.push(policy_artifact);
    for artifact in artifacts {
        let (artifact, _) =
            read_product_evidence_artifact_source(store, &artifact, "product evidence artifact")?;
        result.push(artifact);
    }
    Ok((policy_text, result))
}

fn read_product_evidence_artifact_source(
    store: &BrownieStore,
    artifact: &brownie_protocol::HeadlessRunProductEvidenceArtifactSource,
    label: &str,
) -> Result<(HeadlessRunProductEvidenceArtifact, String), String> {
    let full_path = store.workspace_root().join(&artifact.path);
    let metadata = fs::symlink_metadata(&full_path)
        .map_err(|_| format!("invalid params: {label} is missing"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(format!(
            "invalid params: {label} must be an existing regular file and not a symlink"
        ));
    }
    let bytes =
        fs::read(&full_path).map_err(|_| format!("invalid params: {label} cannot be read"))?;
    let text = std::str::from_utf8(&bytes)
        .map_err(|_| format!("invalid params: {label} must be UTF-8"))?
        .to_string();
    let sha256 = format!("sha256:{}", hex_sha256(&bytes));
    if sha256 != artifact.expected_sha256 {
        return Err(format!("invalid params: {label} hash mismatch"));
    }
    Ok((
        HeadlessRunProductEvidenceArtifact {
            path: artifact.path.clone(),
            sha256,
        },
        text,
    ))
}

fn parse_project_completion_policy(
    policy: &Value,
    request: &HeadlessRunProductEvidenceDerivationRequest,
    selected_gap_closures: &BTreeMap<String, HeadlessRunSelectedProductGapClosureEvidence>,
) -> Result<ProjectCompletionPolicy, String> {
    if !policy.is_object() {
        return Err("invalid params: project completion policy must be a JSON object".to_string());
    }
    let phase_id =
        project_completion_policy_string(policy, &["phase_id", "phase"], 32, "phase_id")?;
    if phase_id != request.phase_id {
        return Err(
            "invalid params: product evidence phase_id does not match project completion policy"
                .to_string(),
        );
    }
    let milestone = project_completion_policy_string(policy, &["milestone"], 120, "milestone")?;
    if milestone != request.milestone {
        return Err(
            "invalid params: product evidence milestone does not match project completion policy"
                .to_string(),
        );
    }
    let target_capability =
        project_completion_policy_string(policy, &["target_capability"], 96, "target_capability")?;
    let concrete_capability_transition = project_completion_policy_string(
        policy,
        &["concrete_capability_transition"],
        120,
        "concrete_capability_transition",
    )?;
    let gate = policy.get("product_completion_gate").unwrap_or(policy);
    if gate.get("required").and_then(Value::as_bool) == Some(false) {
        return Err(
            "invalid params: project completion policy gate must not be disabled".to_string(),
        );
    }
    let requested_product_completion_claim = policy
        .get("product_completion_claim")
        .or_else(|| gate.get("product_completion_claim"))
        .and_then(Value::as_bool)
        .ok_or_else(|| {
            "invalid params: project completion policy product_completion_claim is required"
                .to_string()
        })?;
    let validated_gate_categories = project_completion_policy_string_array(
        policy
            .get("validated_gate_categories")
            .or_else(|| gate.get("validated_gate_categories")),
        "validated_gate_categories",
        16,
        96,
    )?;
    if !product_completion_evidence_categories_are_complete(&validated_gate_categories) {
        return Err(
            "invalid params: project completion policy gate categories are incomplete".to_string(),
        );
    }
    let behavior_evidence_count = project_completion_policy_string_array(
        gate.get("behavior_evidence"),
        "behavior_evidence",
        64,
        160,
    )?
    .len();
    let rejected_alternatives_count = project_completion_policy_string_array(
        gate.get("rejected_alternatives"),
        "rejected_alternatives",
        32,
        160,
    )?
    .len();
    let safety_boundary_reviewed = !project_completion_policy_string_array(
        gate.get("safety_boundary"),
        "safety_boundary",
        32,
        160,
    )?
    .is_empty();
    let non_goals_reviewed =
        !project_completion_policy_string_array(gate.get("non_goals"), "non_goals", 32, 160)?
            .is_empty();
    let technical_debt_reviewed = !project_completion_policy_string_array(
        gate.get("technical_debt"),
        "technical_debt",
        32,
        160,
    )?
    .is_empty();
    let evidence_artifact_paths = project_completion_policy_path_array(
        policy
            .get("evidence_artifacts")
            .or_else(|| gate.get("evidence_artifacts")),
    )?;
    let (
        selected_remaining_gap,
        selected_gap_closure_evidence,
        selected_gap_closure_evidence_set,
        selected_gap_closure_set_fingerprint,
        product_completion_claim,
    ) = project_completion_policy_remaining_gap_selection(
        policy
            .get("product_dod_remaining_gaps")
            .or_else(|| gate.get("product_dod_remaining_gaps")),
        requested_product_completion_claim,
        selected_gap_closures,
    )?;

    Ok(ProjectCompletionPolicy {
        target_capability,
        concrete_capability_transition,
        product_completion_claim,
        validated_gate_categories,
        behavior_evidence_count,
        rejected_alternatives_count,
        safety_boundary_reviewed,
        non_goals_reviewed,
        technical_debt_reviewed,
        selected_remaining_gap,
        selected_gap_closure_evidence,
        selected_gap_closure_evidence_set,
        selected_gap_closure_set_fingerprint,
        evidence_artifact_paths,
    })
}

fn project_completion_policy_string(
    policy: &Value,
    keys: &[&str],
    max_len: usize,
    field: &str,
) -> Result<String, String> {
    for key in keys {
        if let Some(value) = policy.get(*key).and_then(Value::as_str) {
            if is_bounded_product_completion_text(value, max_len) {
                return Ok(value.to_string());
            }
            return Err(format!(
                "invalid params: project completion policy {field} must be bounded ASCII metadata"
            ));
        }
    }
    Err(format!(
        "invalid params: project completion policy {field} is required"
    ))
}

fn project_completion_policy_string_array(
    value: Option<&Value>,
    field: &str,
    max_items: usize,
    max_item_len: usize,
) -> Result<Vec<String>, String> {
    let items = value
        .and_then(Value::as_array)
        .ok_or_else(|| format!("invalid params: project completion policy {field} is required"))?;
    if items.is_empty() || items.len() > max_items {
        return Err(format!(
            "invalid params: project completion policy {field} must contain 1-{max_items} items"
        ));
    }
    items
        .iter()
        .map(|item| {
            let text = item.as_str().ok_or_else(|| {
                format!("invalid params: project completion policy {field} items must be strings")
            })?;
            if !is_bounded_product_completion_text(text, max_item_len) {
                return Err(format!(
                    "invalid params: project completion policy {field} items must be bounded ASCII metadata"
                ));
            }
            Ok(text.to_string())
        })
        .collect()
}

fn project_completion_policy_path_array(value: Option<&Value>) -> Result<Vec<String>, String> {
    let items = value.and_then(Value::as_array).ok_or_else(|| {
        "invalid params: project completion policy evidence_artifacts is required".to_string()
    })?;
    if items.is_empty() || items.len() > 32 {
        return Err(
            "invalid params: project completion policy evidence_artifacts must contain 1-32 paths"
                .to_string(),
        );
    }
    let mut paths = Vec::with_capacity(items.len());
    for item in items {
        let path = item.as_str().ok_or_else(|| {
            "invalid params: project completion policy evidence_artifacts items must be strings"
                .to_string()
        })?;
        if !is_safe_product_evidence_artifact_path(path) {
            return Err(
                "invalid params: project completion policy evidence artifact path is unsafe"
                    .to_string(),
            );
        }
        if paths.iter().any(|existing| existing == path) {
            return Err(
                "invalid params: project completion policy evidence_artifacts must be unique"
                    .to_string(),
            );
        }
        paths.push(path.to_string());
    }
    Ok(paths)
}

#[expect(
    clippy::type_complexity,
    reason = "existing policy parser returns the complete bounded product-gap decision tuple"
)]
pub(super) fn project_completion_policy_remaining_gap_selection(
    value: Option<&Value>,
    product_completion_claim: bool,
    selected_gap_closures: &BTreeMap<String, HeadlessRunSelectedProductGapClosureEvidence>,
) -> Result<
    (
        Option<HeadlessRunProductRemainingGapSelection>,
        Option<HeadlessRunSelectedProductGapClosureEvidence>,
        Vec<HeadlessRunSelectedProductGapClosureEvidence>,
        Option<String>,
        bool,
    ),
    String,
> {
    let Some(value) = value else {
        if product_completion_claim {
            return Ok((None, None, Vec::new(), None, true));
        }
        return Err(
            "invalid params: project completion policy incomplete claim requires product_dod_remaining_gaps"
                .to_string(),
        );
    };
    let items = value.as_array().ok_or_else(|| {
        "invalid params: project completion policy product_dod_remaining_gaps must be an array"
            .to_string()
    })?;
    if items.is_empty() || items.len() > 32 {
        return Err(
            "invalid params: project completion policy product_dod_remaining_gaps must contain 1-32 items"
                .to_string(),
        );
    }
    let mut seen = BTreeSet::new();
    let mut selected: Option<HeadlessRunProductRemainingGapSelection> = None;
    let mut consumed_closures: Vec<HeadlessRunSelectedProductGapClosureEvidence> = Vec::new();
    let mut saw_open_required_gap = false;
    for item in items {
        let gap = parse_project_completion_policy_remaining_gap(item)?;
        if !seen.insert(gap.gap_id.clone()) {
            return Err(
                "invalid params: project completion policy product_dod_remaining_gaps gap_id must be unique"
                    .to_string(),
            );
        }
        if gap.required && gap.status == "open" {
            saw_open_required_gap = true;
            if let Some(closure) = selected_gap_closures.get(&gap.selection_fingerprint) {
                if closure.selected_remaining_gap != gap {
                    return Err(
                        "invalid params: selected product gap closure conflicts with project completion policy gap"
                            .to_string(),
                    );
                }
                consumed_closures.push(closure.clone());
                continue;
            }
            match selected.as_ref() {
                Some(current)
                    if current.priority > gap.priority
                        || (current.priority == gap.priority && current.gap_id <= gap.gap_id) => {}
                _ => selected = Some(gap),
            }
        }
    }
    if selected.is_none()
        && !product_completion_claim
        && (!saw_open_required_gap || consumed_closures.is_empty())
    {
        return Err(
                "invalid params: project completion policy incomplete claim requires one open required product DoD gap"
                    .to_string(),
            );
    }
    consumed_closures.sort_by(|left, right| {
        left.selected_remaining_gap
            .selection_fingerprint
            .cmp(&right.selected_remaining_gap.selection_fingerprint)
            .then_with(|| {
                left.closure_evidence_fingerprint
                    .cmp(&right.closure_evidence_fingerprint)
            })
    });
    let consumed_closure = consumed_closures.first().cloned();
    let consumed_closure_set_fingerprint =
        headless_selected_gap_closure_set_fingerprint(&consumed_closures);
    let effective_product_completion_claim =
        product_completion_claim || (saw_open_required_gap && selected.is_none());
    Ok((
        selected,
        consumed_closure,
        consumed_closures,
        consumed_closure_set_fingerprint,
        effective_product_completion_claim,
    ))
}

fn headless_selected_gap_closure_set_fingerprint(
    closures: &[HeadlessRunSelectedProductGapClosureEvidence],
) -> Option<String> {
    if closures.is_empty() {
        return None;
    }
    let canonical_closures: Vec<Value> = closures
        .iter()
        .map(|closure| {
            json!({
                "selected_remaining_gap_fingerprint": closure.selected_remaining_gap.selection_fingerprint,
                "closure_evidence_fingerprint": closure.closure_evidence_fingerprint,
                "source_decision_fingerprint": closure.source_decision_fingerprint,
                "product_evidence_fingerprint": closure.product_evidence_fingerprint,
                "product_objective_fingerprint": closure.product_objective_fingerprint,
                "accepted_completion_fingerprint": closure.accepted_completion_fingerprint,
                "terminal_completion_fingerprint": closure.terminal_completion_fingerprint,
                "completion_closure_fingerprint": closure.completion_closure_fingerprint,
            })
        })
        .collect();
    let canonical = json!({
        "version": "headless_selected_gap_closure_set_v1",
        "closures": canonical_closures,
    });
    Some(format!(
        "sha256:{}",
        hex_sha256(canonical.to_string().as_bytes())
    ))
}

fn parse_project_completion_policy_remaining_gap(
    item: &Value,
) -> Result<HeadlessRunProductRemainingGapSelection, String> {
    let object = item.as_object().ok_or_else(|| {
        "invalid params: project completion policy product_dod_remaining_gaps items must be objects"
            .to_string()
    })?;
    if !object.keys().all(|key| {
        matches!(
            key.as_str(),
            "gap_id"
                | "capability"
                | "transition"
                | "status"
                | "responsibility_domain"
                | "required"
                | "priority"
                | "next_action"
        )
    }) {
        return Err(
            "invalid params: project completion policy product_dod_remaining_gaps contains unsupported fields"
                .to_string(),
        );
    }
    let gap_id = project_completion_policy_string(item, &["gap_id"], 48, "gap_id")?;
    if !is_valid_headless_run_id(&gap_id) {
        return Err(
            "invalid params: project completion policy product_dod_remaining_gaps gap_id must be bounded identifier metadata"
                .to_string(),
        );
    }
    let capability = project_completion_policy_string(item, &["capability"], 120, "capability")?;
    let transition = project_completion_policy_string(item, &["transition"], 120, "transition")?;
    let status = project_completion_policy_string(item, &["status"], 48, "status")?;
    if !matches!(status.as_str(), "open" | "deferred" | "closed") {
        return Err(
            "invalid params: project completion policy product_dod_remaining_gaps status is unsupported"
                .to_string(),
        );
    }
    let responsibility_domain = item
        .get("responsibility_domain")
        .and_then(Value::as_str)
        .unwrap_or("runtime")
        .to_string();
    if !is_bounded_product_completion_text(&responsibility_domain, 48)
        || !release_responsibility_domain_is_valid(&responsibility_domain)
    {
        return Err(
            "invalid params: project completion policy product_dod_remaining_gaps responsibility_domain is unsupported"
                .to_string(),
        );
    }
    let required = item.get("required").and_then(Value::as_bool).ok_or_else(|| {
        "invalid params: project completion policy product_dod_remaining_gaps required is required"
            .to_string()
    })?;
    if required && responsibility_domain != "runtime" {
        return Err(
            "invalid params: external responsibilities must not be required Runtime release Product DoD gaps"
                .to_string(),
        );
    }
    let priority_u64 = item.get("priority").and_then(Value::as_u64).ok_or_else(|| {
        "invalid params: project completion policy product_dod_remaining_gaps priority is required"
            .to_string()
    })?;
    if priority_u64 > u16::MAX as u64 {
        return Err(
            "invalid params: project completion policy product_dod_remaining_gaps priority is too large"
                .to_string(),
        );
    }
    let next_action = project_completion_policy_string(item, &["next_action"], 120, "next_action")?;
    let mut gap = HeadlessRunProductRemainingGapSelection {
        gap_id,
        capability,
        transition,
        status,
        responsibility_domain,
        required,
        priority: priority_u64 as u16,
        next_action,
        selection_fingerprint: String::new(),
    };
    gap.selection_fingerprint = headless_product_remaining_gap_selection_fingerprint(&gap);
    Ok(gap)
}

fn validate_project_completion_policy_artifacts(
    policy_artifact_paths: &[String],
    request: &HeadlessRunProductEvidenceDerivationRequest,
) -> Result<(), String> {
    let mut expected = policy_artifact_paths.to_vec();
    expected.sort();
    let mut actual: Vec<String> = request
        .artifacts
        .iter()
        .map(|artifact| artifact.path.clone())
        .collect();
    actual.sort();
    if actual != expected {
        return Err(
            "invalid params: product evidence artifacts must match project completion policy"
                .to_string(),
        );
    }
    Ok(())
}

fn headless_product_evidence_matrix_was_persisted(
    store: &BrownieStore,
    matrix: &HeadlessRunProductEvidenceMatrix,
) -> anyhow::Result<bool> {
    Ok(store
        .tasks()
        .read_ledger_events(&matrix.run_id)?
        .iter()
        .any(|event| {
            event.kind == LedgerEventKind::HeadlessRunProductEvidenceMatrixDerived
                && event
                    .payload
                    .as_ref()
                    .and_then(|payload| payload.get("product_evidence_matrix_fingerprint"))
                    .and_then(Value::as_str)
                    == Some(matrix.product_evidence_matrix_fingerprint.as_str())
        }))
}

fn headless_product_evidence_matrix_payload(matrix: &HeadlessRunProductEvidenceMatrix) -> Value {
    json!({
        "derivation_id": matrix.derivation_id,
        "task_id": matrix.task_id,
        "run_id": matrix.run_id,
        "acceptance_id": matrix.acceptance_id,
        "phase_id": matrix.phase_id,
        "milestone": matrix.milestone,
        "target_capability": matrix.target_capability,
        "concrete_capability_transition": matrix.concrete_capability_transition,
        "accepted_completion_fingerprint": matrix.accepted_completion_fingerprint,
        "terminal_completion_fingerprint": matrix.terminal_completion_fingerprint,
        "completion_closure_fingerprint": matrix.completion_closure_fingerprint,
        "product_evidence_matrix_fingerprint": matrix.product_evidence_matrix_fingerprint,
        "product_completion_claim": matrix.product_completion_claim,
        "artifact_count": matrix.artifact_count,
        "artifact_hashes": matrix.artifact_hashes,
        "validated_gate_categories": matrix.validated_gate_categories,
        "behavior_evidence_count": matrix.behavior_evidence_count,
        "rejected_alternatives_count": matrix.rejected_alternatives_count,
        "safety_boundary_reviewed": matrix.safety_boundary_reviewed,
        "non_goals_reviewed": matrix.non_goals_reviewed,
        "technical_debt_reviewed": matrix.technical_debt_reviewed,
        "selected_remaining_gap": matrix.selected_remaining_gap,
        "selected_gap_closure_evidence": matrix.selected_gap_closure_evidence,
        "selected_gap_closure_evidence_set": matrix.selected_gap_closure_evidence_set,
        "selected_gap_closure_set_fingerprint": matrix.selected_gap_closure_set_fingerprint,
        "next_action": matrix.next_action,
        "replayed": false,
    })
}

pub(super) fn headless_product_remaining_gap_selection_fingerprint(
    gap: &HeadlessRunProductRemainingGapSelection,
) -> String {
    let canonical = json!({
        "version": "headless_product_remaining_gap_selection_v1",
        "gap_id": gap.gap_id,
        "capability": gap.capability,
        "transition": gap.transition,
        "status": gap.status,
        "required": gap.required,
        "priority": gap.priority,
        "next_action": gap.next_action,
    });
    format!("sha256:{}", hex_sha256(canonical.to_string().as_bytes()))
}

#[expect(
    clippy::too_many_arguments,
    reason = "fingerprint intentionally names every release-product evidence input"
)]
fn headless_product_evidence_matrix_fingerprint(
    request: &HeadlessRunProductEvidenceDerivationRequest,
    accepted: &HeadlessRunAcceptedCompletion,
    terminal: &brownie_protocol::TaskRunCompletionEvidence,
    closure: &HeadlessRunCompletionClosure,
    target_capability: &str,
    concrete_capability_transition: &str,
    product_completion_claim: bool,
    validated_gate_categories: &[String],
    behavior_evidence_count: usize,
    rejected_alternatives_count: usize,
    safety_boundary_reviewed: bool,
    non_goals_reviewed: bool,
    technical_debt_reviewed: bool,
    selected_remaining_gap: Option<&HeadlessRunProductRemainingGapSelection>,
    selected_gap_closure_evidence: Option<&HeadlessRunSelectedProductGapClosureEvidence>,
    selected_gap_closure_evidence_set: &[HeadlessRunSelectedProductGapClosureEvidence],
    selected_gap_closure_set_fingerprint: Option<&str>,
    artifacts: &[HeadlessRunProductEvidenceArtifact],
) -> String {
    let canonical = json!({
        "version": "headless_product_evidence_matrix_v1",
        "derivation_id": request.derivation_id,
        "phase_id": request.phase_id,
        "milestone": request.milestone,
        "task_id": accepted.task_id,
        "run_id": accepted.run_id,
        "acceptance_id": accepted.acceptance_id,
        "accepted_completion_fingerprint": accepted.acceptance_fingerprint,
        "terminal_completion_fingerprint": terminal.completion_result_fingerprint,
        "completion_closure_fingerprint": closure.closure_fingerprint,
        "target_capability": target_capability,
        "concrete_capability_transition": concrete_capability_transition,
        "product_completion_claim": product_completion_claim,
        "validated_gate_categories": validated_gate_categories,
        "behavior_evidence_count": behavior_evidence_count,
        "rejected_alternatives_count": rejected_alternatives_count,
        "safety_boundary_reviewed": safety_boundary_reviewed,
        "non_goals_reviewed": non_goals_reviewed,
        "technical_debt_reviewed": technical_debt_reviewed,
        "selected_remaining_gap": selected_remaining_gap,
        "selected_gap_closure_evidence": selected_gap_closure_evidence,
        "selected_gap_closure_evidence_set": selected_gap_closure_evidence_set,
        "selected_gap_closure_set_fingerprint": selected_gap_closure_set_fingerprint,
        "artifact_hashes": artifacts,
    });
    format!("sha256:{}", hex_sha256(canonical.to_string().as_bytes()))
}

pub(super) fn append_headless_product_completion_decision_event_if_missing(
    store: &BrownieStore,
    decision: &HeadlessRunProductCompletionDecision,
) -> anyhow::Result<()> {
    let Some(record) = store.tasks().get_task(&decision.task_id)? else {
        return Ok(());
    };
    if record.run_id != decision.run_id {
        return Ok(());
    }
    match headless_product_completion_decision_event_status(store, decision)? {
        HeadlessProductCompletionDecisionEventStatus::ExactReplay => return Ok(()),
        HeadlessProductCompletionDecisionEventStatus::ConflictingBoundaryDecision => {
            anyhow::bail!(
                "product completion decision conflicts with persisted accepted-completion boundary decision"
            );
        }
        HeadlessProductCompletionDecisionEventStatus::Missing => {}
    }
    store.tasks().append_task_event_with_payload(
        &record,
        LedgerEventKind::HeadlessRunProductCompletionDecisionRecorded,
        Some(headless_product_completion_decision_payload(decision)),
    )?;
    Ok(())
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum HeadlessProductCompletionDecisionEventStatus {
    Missing,
    ExactReplay,
    ConflictingBoundaryDecision,
}

fn product_completion_decision_selected_remaining_gap(
    result: &HeadlessRunDriveResult,
    request: &HeadlessRunProductCompletionDecisionRequest,
) -> Result<Option<HeadlessRunProductRemainingGapSelection>, String> {
    if request
        .derived_product_evidence_matrix_fingerprint
        .as_ref()
        .is_none()
    {
        return Ok(None);
    }
    let matrix = result.product_evidence_matrix.as_ref().ok_or_else(|| {
        "invalid params: derived product evidence matrix is required for product decision"
            .to_string()
    })?;
    let Some(gap) = matrix.selected_remaining_gap.as_ref() else {
        return Ok(None);
    };
    if let Some(remaining_capability) = request.remaining_capability.as_deref() {
        if remaining_capability != gap.capability {
            return Err(
                "invalid params: product completion decision remaining_capability conflicts with derived product DoD gap"
                    .to_string(),
            );
        }
    }
    Ok(Some(gap.clone()))
}

fn headless_product_completion_decision_event_status(
    store: &BrownieStore,
    decision: &HeadlessRunProductCompletionDecision,
) -> anyhow::Result<HeadlessProductCompletionDecisionEventStatus> {
    let events = store.tasks().read_ledger_events(&decision.run_id)?;
    let mut has_conflicting_boundary_decision = false;
    for event in events {
        if event.kind != LedgerEventKind::HeadlessRunProductCompletionDecisionRecorded {
            continue;
        }
        let Some(payload) = event.payload.as_ref() else {
            continue;
        };
        let same_boundary = payload.get("task_id").and_then(Value::as_str)
            == Some(decision.task_id.as_str())
            && payload.get("run_id").and_then(Value::as_str) == Some(decision.run_id.as_str())
            && payload
                .get("accepted_completion_fingerprint")
                .and_then(Value::as_str)
                == Some(decision.accepted_completion_fingerprint.as_str())
            && payload
                .get("terminal_completion_fingerprint")
                .and_then(Value::as_str)
                == Some(decision.terminal_completion_fingerprint.as_str())
            && payload
                .get("completion_closure_fingerprint")
                .and_then(Value::as_str)
                == Some(decision.completion_closure_fingerprint.as_str());
        if !same_boundary {
            continue;
        }
        if payload.get("decision_fingerprint").and_then(Value::as_str)
            == Some(decision.decision_fingerprint.as_str())
        {
            return Ok(HeadlessProductCompletionDecisionEventStatus::ExactReplay);
        }
        has_conflicting_boundary_decision = true;
    }
    if has_conflicting_boundary_decision {
        Ok(HeadlessProductCompletionDecisionEventStatus::ConflictingBoundaryDecision)
    } else {
        Ok(HeadlessProductCompletionDecisionEventStatus::Missing)
    }
}

pub(super) fn headless_run_product_completion_decision(
    store: &BrownieStore,
    result: &HeadlessRunDriveResult,
    request: Option<&HeadlessRunProductCompletionDecisionRequest>,
) -> Result<Option<HeadlessRunProductCompletionDecision>, String> {
    if let Some(existing) = result.product_completion_decision.as_ref() {
        if let Some(request) = request {
            validate_product_completion_decision_request(request)?;
            let requested_carry_forward = technical_debt_carry_forward_for_decision(
                store, result, request,
            )
            .map_err(|error| format!("invalid params: product completion decision {error}"))?;
            let requested_selected_remaining_gap =
                product_completion_decision_selected_remaining_gap(result, request)?;
            let requested_remaining_capability = requested_selected_remaining_gap
                .as_ref()
                .map(|gap| gap.capability.clone())
                .or_else(|| request.remaining_capability.clone());
            if existing.decision_id != request.decision_id
                || existing.accepted_completion_fingerprint
                    != request.expected_accepted_completion_fingerprint
                || existing.terminal_completion_fingerprint
                    != request.expected_terminal_completion_fingerprint
                || existing.completion_closure_fingerprint
                    != request.expected_completion_closure_fingerprint
                || existing.product_evidence_fingerprint
                    != request.expected_product_evidence_fingerprint
                || existing.technical_debt_carry_forward != requested_carry_forward
                || existing.remaining_capability != requested_remaining_capability
                || existing.selected_remaining_gap != requested_selected_remaining_gap
            {
                return Err(
                    "invalid params: product completion decision replay target conflicts with persisted decision"
                        .to_string(),
                );
            }
        }
        return Ok(Some(HeadlessRunProductCompletionDecision {
            replayed: true,
            ..existing.clone()
        }));
    }

    let Some(request) = request else {
        return Ok(None);
    };
    validate_product_completion_decision_request(request)?;
    let accepted = result.accepted_completion.as_ref().ok_or_else(|| {
        "invalid params: product completion decision requires accepted_completion route evidence"
            .to_string()
    })?;
    let terminal = result
        .terminal_completion_evidence
        .as_ref()
        .ok_or_else(|| {
            "invalid params: product completion decision requires terminal completion evidence"
                .to_string()
        })?;
    if accepted.acceptance_fingerprint != request.expected_accepted_completion_fingerprint {
        return Err(
            "invalid params: product completion decision accepted-completion fingerprint mismatch"
                .to_string(),
        );
    }
    if accepted.terminal_completion_fingerprint != request.expected_terminal_completion_fingerprint
        || terminal.completion_result_fingerprint
            != request.expected_terminal_completion_fingerprint
    {
        return Err(
            "invalid params: product completion decision terminal completion fingerprint mismatch"
                .to_string(),
        );
    }
    if result.completion_closure.closure_fingerprint
        != request.expected_completion_closure_fingerprint
    {
        return Err(
            "invalid params: product completion decision completion-closure fingerprint mismatch"
                .to_string(),
        );
    }
    let mut evidence_request = request.clone();
    let mut selected_remaining_gap: Option<HeadlessRunProductRemainingGapSelection> = None;
    if let Some(matrix_fingerprint) = request
        .derived_product_evidence_matrix_fingerprint
        .as_deref()
    {
        if matrix_fingerprint != request.expected_product_evidence_fingerprint {
            return Err(
                "invalid params: derived product evidence matrix fingerprint must match expected product evidence fingerprint"
                    .to_string(),
            );
        }
        let matrix = result.product_evidence_matrix.as_ref().ok_or_else(|| {
            "invalid params: derived product evidence matrix is required for product decision"
                .to_string()
        })?;
        if matrix.product_evidence_matrix_fingerprint != matrix_fingerprint {
            return Err(
                "invalid params: product decision derived product evidence matrix fingerprint mismatch"
                    .to_string(),
            );
        }
        if matrix.accepted_completion_fingerprint != accepted.acceptance_fingerprint
            || matrix.terminal_completion_fingerprint != terminal.completion_result_fingerprint
            || matrix.completion_closure_fingerprint
                != result.completion_closure.closure_fingerprint
        {
            return Err(
                "invalid params: product decision derived product evidence matrix boundary mismatch"
                .to_string(),
            );
        }
        if request.evidence_status == "product_complete" && !matrix.product_completion_claim {
            return Err(
                "invalid params: product completion claim is false for derived product evidence matrix"
                    .to_string(),
            );
        }
        if request.evidence_status == "product_complete" && matrix.selected_remaining_gap.is_some()
        {
            return Err(
                "invalid params: product completion decision cannot be product_complete while derived product evidence matrix has an open required product DoD gap"
                    .to_string(),
            );
        }
        if let Some(gap) = matrix.selected_remaining_gap.as_ref() {
            if let Some(remaining_capability) = request.remaining_capability.as_deref() {
                if remaining_capability != gap.capability {
                    return Err(
                        "invalid params: product completion decision remaining_capability conflicts with derived product DoD gap"
                            .to_string(),
                    );
                }
            }
            evidence_request.remaining_capability = Some(gap.capability.clone());
            selected_remaining_gap = Some(gap.clone());
        }
        evidence_request.target_capability = matrix.target_capability.clone();
        evidence_request.concrete_capability_transition =
            matrix.concrete_capability_transition.clone();
        evidence_request.validated_gate_categories = matrix.validated_gate_categories.clone();
        evidence_request.behavior_evidence_count = matrix.behavior_evidence_count;
        evidence_request.rejected_alternatives_count = matrix.rejected_alternatives_count;
        evidence_request.safety_boundary_reviewed = matrix.safety_boundary_reviewed;
        evidence_request.non_goals_reviewed = matrix.non_goals_reviewed;
        evidence_request.technical_debt_reviewed = matrix.technical_debt_reviewed;
        evidence_request.expected_product_evidence_fingerprint =
            matrix.product_evidence_matrix_fingerprint.clone();
    }
    let current_product_evidence_fingerprint =
        headless_product_completion_evidence_fingerprint(&evidence_request);
    if request
        .derived_product_evidence_matrix_fingerprint
        .is_none()
        && current_product_evidence_fingerprint != request.expected_product_evidence_fingerprint
    {
        return Err(
            "invalid params: product completion decision product-evidence fingerprint mismatch"
                .to_string(),
        );
    }
    let derived_technical_debt_state =
        technical_debt_carry_forward_for_decision(store, result, request)
            .map_err(|error| format!("invalid params: product completion decision {error}"))?;
    if request.evidence_status == "product_complete"
        && technical_debt_has_release_blocking_active_items(derived_technical_debt_state.as_ref())
    {
        return Err(
            "invalid params: product completion decision cannot be product_complete while blocking or required-before-release technical debt is open or deferred"
                .to_string(),
        );
    }

    let mut missing_or_invalid_evidence = !product_completion_evidence_categories_are_complete(
        &evidence_request.validated_gate_categories,
    ) || evidence_request.behavior_evidence_count == 0
        || evidence_request.rejected_alternatives_count == 0
        || !evidence_request.safety_boundary_reviewed
        || !evidence_request.non_goals_reviewed
        || !evidence_request.technical_debt_reviewed
        || evidence_request.target_capability.trim().is_empty()
        || evidence_request
            .concrete_capability_transition
            .trim()
            .is_empty();

    let (status, next_action) = match request.evidence_status.as_str() {
        "product_complete"
            if !missing_or_invalid_evidence
                && evidence_request.remaining_capability.is_none()
                && !request
                    .milestone_exit_rationale
                    .as_deref()
                    .unwrap_or("")
                    .trim()
                    .is_empty() =>
        {
            ("product_complete", "stop_autonomous_development")
        }
        "continue_development"
            if !missing_or_invalid_evidence
                && !evidence_request
                    .remaining_capability
                    .as_deref()
                    .unwrap_or("")
                    .trim()
                    .is_empty() =>
        {
            ("continue_development", "plan_next_phase")
        }
        "blocked_by_product_evidence" => {
            missing_or_invalid_evidence = true;
            (
                "blocked_by_product_evidence",
                "repair_product_completion_evidence",
            )
        }
        _ => {
            missing_or_invalid_evidence = true;
            (
                "blocked_by_product_evidence",
                "repair_product_completion_evidence",
            )
        }
    };
    let technical_debt_carry_forward = if status == "continue_development"
        || (status == "product_complete" && derived_technical_debt_state.is_some())
    {
        derived_technical_debt_state
    } else {
        None
    };
    let decision_fingerprint = headless_product_completion_decision_fingerprint(
        &evidence_request,
        accepted,
        terminal,
        &result.completion_closure,
        status,
        next_action,
        missing_or_invalid_evidence,
        technical_debt_carry_forward.as_ref(),
        selected_remaining_gap.as_ref(),
    );
    let mut decision = HeadlessRunProductCompletionDecision {
        decision_id: request.decision_id.clone(),
        task_id: accepted.task_id.clone(),
        run_id: accepted.run_id.clone(),
        acceptance_id: accepted.acceptance_id.clone(),
        status: status.to_string(),
        next_action: next_action.to_string(),
        target_capability: evidence_request.target_capability.clone(),
        concrete_capability_transition: evidence_request.concrete_capability_transition.clone(),
        accepted_completion_fingerprint: accepted.acceptance_fingerprint.clone(),
        terminal_completion_fingerprint: terminal.completion_result_fingerprint.clone(),
        completion_closure_fingerprint: result.completion_closure.closure_fingerprint.clone(),
        product_evidence_fingerprint: evidence_request
            .expected_product_evidence_fingerprint
            .clone(),
        decision_fingerprint,
        validated_gate_categories: evidence_request.validated_gate_categories.clone(),
        derived_product_evidence_matrix_fingerprint: request
            .derived_product_evidence_matrix_fingerprint
            .clone(),
        behavior_evidence_count: evidence_request.behavior_evidence_count,
        rejected_alternatives_count: evidence_request.rejected_alternatives_count,
        safety_boundary_reviewed: evidence_request.safety_boundary_reviewed,
        non_goals_reviewed: evidence_request.non_goals_reviewed,
        technical_debt_reviewed: evidence_request.technical_debt_reviewed,
        remaining_capability: evidence_request.remaining_capability.clone(),
        selected_remaining_gap,
        milestone_exit_rationale: request.milestone_exit_rationale.clone(),
        technical_debt_carry_forward,
        replayed: false,
    };
    decision.replayed = match headless_product_completion_decision_event_status(store, &decision)
        .map_err(|error| error.to_string())?
    {
        HeadlessProductCompletionDecisionEventStatus::ExactReplay => true,
        HeadlessProductCompletionDecisionEventStatus::ConflictingBoundaryDecision => {
            return Err(
                "invalid params: product completion decision conflicts with persisted accepted-completion boundary decision"
                    .to_string(),
            );
        }
        HeadlessProductCompletionDecisionEventStatus::Missing => false,
    };
    append_headless_product_completion_decision_event_if_missing(store, &decision)
        .map_err(|error| error.to_string())?;
    Ok(Some(decision))
}

fn validate_product_completion_decision_request(
    request: &HeadlessRunProductCompletionDecisionRequest,
) -> Result<(), String> {
    if !request.authorize_product_completion_decision {
        return Err(
            "invalid params: product completion decision requires explicit authorization"
                .to_string(),
        );
    }
    if !is_valid_headless_run_id(&request.decision_id) {
        return Err(
            "invalid params: product completion decision decision_id must be 1-48 ASCII alphanumeric, dash, underscore, colon, or dot characters"
                .to_string(),
        );
    }
    for (field, value) in [
        (
            "expected_accepted_completion_fingerprint",
            &request.expected_accepted_completion_fingerprint,
        ),
        (
            "expected_terminal_completion_fingerprint",
            &request.expected_terminal_completion_fingerprint,
        ),
        (
            "expected_completion_closure_fingerprint",
            &request.expected_completion_closure_fingerprint,
        ),
        (
            "expected_product_evidence_fingerprint",
            &request.expected_product_evidence_fingerprint,
        ),
    ] {
        if !is_sha256_fingerprint(value) {
            return Err(format!(
                "invalid params: product completion decision {field} must be sha256"
            ));
        }
    }
    if !is_bounded_product_completion_text(&request.evidence_status, 64)
        || !is_bounded_product_completion_text(&request.target_capability, 96)
        || !is_bounded_product_completion_text(&request.concrete_capability_transition, 120)
        || request.validated_gate_categories.len() > 16
        || request
            .validated_gate_categories
            .iter()
            .any(|category| !is_bounded_product_completion_text(category, 96))
        || request
            .derived_product_evidence_matrix_fingerprint
            .as_ref()
            .map(|value| !is_sha256_fingerprint(value))
            .unwrap_or(false)
        || request
            .remaining_capability
            .as_ref()
            .map(|value| !is_bounded_product_completion_text(value, 120))
            .unwrap_or(false)
        || request
            .milestone_exit_rationale
            .as_ref()
            .map(|value| !is_bounded_product_completion_text(value, 160))
            .unwrap_or(false)
    {
        return Err(
            "invalid params: product completion decision evidence fields must be bounded ASCII metadata"
                .to_string(),
        );
    }
    Ok(())
}

pub(super) fn technical_debt_carry_forward_for_decision(
    store: &BrownieStore,
    result: &HeadlessRunDriveResult,
    request: &HeadlessRunProductCompletionDecisionRequest,
) -> Result<Option<TechnicalDebtCarryForward>, String> {
    let previous = previous_technical_debt_carry_forward(store, result)?;
    let mut next_items: BTreeMap<String, TechnicalDebtCarryForwardItem> = BTreeMap::new();
    if let Some(previous) = previous {
        for item in previous.items {
            if technical_debt_status_is_active(&item.status) {
                next_items.insert(item.debt_id.clone(), item);
            }
        }
    }

    if let Some(new_items) = request.technical_debt_carry_forward.as_ref() {
        let new_carry_forward = technical_debt_carry_forward_from_items(new_items)?;
        for item in new_carry_forward.items {
            if item.status != "open" {
                return Err(
                    "technical_debt_carry_forward new items must use status open".to_string(),
                );
            }
            if next_items.contains_key(&item.debt_id) {
                return Err(
                    "technical_debt_carry_forward cannot replace existing technical debt without an explicit transition"
                        .to_string(),
                );
            }
            next_items.insert(item.debt_id.clone(), item);
        }
    }

    if let Some(transitions) = request.technical_debt_transitions.as_ref() {
        validate_technical_debt_transitions(transitions)?;
        for transition in transitions {
            match transition.status.as_str() {
                "resolved" | "superseded" => {
                    if next_items.remove(&transition.debt_id).is_none() {
                        return Err("technical_debt_transitions debt_id is unknown".to_string());
                    }
                }
                "deferred" => {
                    let Some(item) = next_items.get_mut(&transition.debt_id) else {
                        return Err("technical_debt_transitions debt_id is unknown".to_string());
                    };
                    item.status = "deferred".to_string();
                    item.next_action = transition.next_action.clone();
                    item.closure_evidence_fingerprint =
                        transition.closure_evidence_fingerprint.clone();
                }
                _ => unreachable!("validated transition status"),
            }
        }
    }

    if next_items.is_empty() {
        return Ok(None);
    }
    let items: Vec<_> = next_items.into_values().collect();
    technical_debt_carry_forward_from_items(&items).map(Some)
}

fn previous_technical_debt_carry_forward(
    store: &BrownieStore,
    result: &HeadlessRunDriveResult,
) -> Result<Option<TechnicalDebtCarryForward>, String> {
    let Some(accepted) = result.accepted_completion.as_ref() else {
        return Ok(None);
    };
    let Some(record) = store
        .tasks()
        .get_task(&accepted.task_id)
        .map_err(|error| error.to_string())?
    else {
        return Ok(None);
    };
    Ok(record
        .product_continuation_provenance
        .and_then(|provenance| provenance.technical_debt_carry_forward))
}

pub(super) fn technical_debt_carry_forward_from_items(
    items: &[TechnicalDebtCarryForwardItem],
) -> Result<TechnicalDebtCarryForward, String> {
    if items.is_empty() || items.len() > 8 {
        return Err("technical_debt_carry_forward must contain 1-8 items".to_string());
    }
    let mut sorted_items = items.to_vec();
    sorted_items.sort_by(|left, right| left.debt_id.cmp(&right.debt_id));

    let mut debt_ids = BTreeSet::new();
    for item in &sorted_items {
        if !debt_ids.insert(item.debt_id.clone()) {
            return Err("technical_debt_carry_forward.debt_id values must be unique".to_string());
        }
        if !is_valid_headless_run_id(&item.debt_id)
            || !is_bounded_product_completion_text(&item.summary, 160)
            || !is_bounded_product_completion_text(&item.source_milestone, 96)
            || !is_bounded_product_completion_text(&item.source_phase, 96)
            || !is_bounded_product_completion_text(&item.target_capability, 96)
            || !is_bounded_product_completion_text(&item.responsibility_domain, 48)
            || !is_bounded_product_completion_text(&item.status, 48)
            || !is_bounded_product_completion_text(&item.next_action, 120)
            || !technical_debt_classification_is_valid(&item.classification)
            || !release_responsibility_domain_is_valid(&item.responsibility_domain)
            || !technical_debt_status_is_active(&item.status)
            || item
                .source_pr
                .as_ref()
                .map(|value| !is_bounded_product_completion_text(value, 32))
                .unwrap_or(false)
            || item
                .closure_evidence_fingerprint
                .as_ref()
                .map(|value| !is_sha256_fingerprint(value))
                .unwrap_or(false)
        {
            return Err(
                "technical_debt_carry_forward items must be bounded ASCII metadata".to_string(),
            );
        }
        if item.responsibility_domain != "runtime"
            && matches!(
                item.classification.as_str(),
                "blocking" | "required_before_release"
            )
        {
            return Err(
                "technical_debt_carry_forward external responsibility items must not be blocking or required_before_release"
                    .to_string(),
            );
        }
    }

    let canonical = json!({
        "version": "technical_debt_carry_forward_v2",
        "items": sorted_items,
    });
    Ok(TechnicalDebtCarryForward {
        fingerprint: format!("sha256:{}", hex_sha256(canonical.to_string().as_bytes())),
        items: sorted_items,
    })
}

pub(super) fn technical_debt_carry_forward_v1_fingerprint(
    items: &[TechnicalDebtCarryForwardItem],
) -> Result<String, String> {
    if items.is_empty() || items.len() > 8 {
        return Err("technical_debt_carry_forward must contain 1-8 items".to_string());
    }
    let mut sorted_items = items.to_vec();
    sorted_items.sort_by(|left, right| left.debt_id.cmp(&right.debt_id));
    let legacy_items: Vec<Value> = sorted_items
        .iter()
        .map(|item| {
            let mut legacy_item = serde_json::Map::new();
            legacy_item.insert("debt_id".to_string(), json!(item.debt_id));
            legacy_item.insert("summary".to_string(), json!(item.summary));
            legacy_item.insert("source_milestone".to_string(), json!(item.source_milestone));
            legacy_item.insert("source_phase".to_string(), json!(item.source_phase));
            if let Some(source_pr) = item.source_pr.as_ref() {
                legacy_item.insert("source_pr".to_string(), json!(source_pr));
            }
            legacy_item.insert(
                "target_capability".to_string(),
                json!(item.target_capability),
            );
            legacy_item.insert("classification".to_string(), json!(item.classification));
            legacy_item.insert("status".to_string(), json!(item.status));
            legacy_item.insert("next_action".to_string(), json!(item.next_action));
            if let Some(fingerprint) = item.closure_evidence_fingerprint.as_ref() {
                legacy_item.insert(
                    "closure_evidence_fingerprint".to_string(),
                    json!(fingerprint),
                );
            }
            Value::Object(legacy_item)
        })
        .collect();
    let canonical = json!({
        "version": "technical_debt_carry_forward_v1",
        "items": legacy_items,
    });
    Ok(format!(
        "sha256:{}",
        hex_sha256(canonical.to_string().as_bytes())
    ))
}

fn validate_technical_debt_transitions(
    transitions: &[TechnicalDebtTransition],
) -> Result<(), String> {
    if transitions.is_empty() || transitions.len() > 8 {
        return Err("technical_debt_transitions must contain 1-8 items".to_string());
    }
    let mut debt_ids = BTreeSet::new();
    for transition in transitions {
        if !debt_ids.insert(transition.debt_id.clone()) {
            return Err("technical_debt_transitions debt_id values must be unique".to_string());
        }
        if !is_valid_headless_run_id(&transition.debt_id)
            || !is_bounded_product_completion_text(&transition.status, 48)
            || !is_bounded_product_completion_text(&transition.next_action, 120)
            || !matches!(
                transition.status.as_str(),
                "resolved" | "superseded" | "deferred"
            )
        {
            return Err(
                "technical_debt_transitions items must be bounded runtime debt transitions"
                    .to_string(),
            );
        }
        match transition.status.as_str() {
            "resolved" | "superseded" => {
                if !transition
                    .closure_evidence_fingerprint
                    .as_ref()
                    .map(|value| is_sha256_fingerprint(value))
                    .unwrap_or(false)
                {
                    return Err(
                        "technical_debt_transitions closing transitions require closure_evidence_fingerprint"
                            .to_string(),
                    );
                }
            }
            "deferred"
                if transition
                    .closure_evidence_fingerprint
                    .as_ref()
                    .map(|value| !is_sha256_fingerprint(value))
                    .unwrap_or(false) =>
            {
                return Err(
                    "technical_debt_transitions deferred evidence fingerprint is malformed"
                        .to_string(),
                );
            }
            _ => {}
        }
    }
    Ok(())
}

fn technical_debt_classification_is_valid(classification: &str) -> bool {
    matches!(
        classification,
        "blocking" | "required_before_release" | "post_v0"
    )
}

fn release_responsibility_domain_is_valid(responsibility_domain: &str) -> bool {
    matches!(
        responsibility_domain,
        "runtime" | "external_control_plane" | "external_adapter" | "commercial_solution"
    )
}

fn technical_debt_status_is_active(status: &str) -> bool {
    matches!(status, "open" | "deferred")
}

fn technical_debt_has_release_blocking_active_items(
    carry_forward: Option<&TechnicalDebtCarryForward>,
) -> bool {
    carry_forward
        .map(|carry_forward| {
            carry_forward.items.iter().any(|item| {
                technical_debt_status_is_active(&item.status)
                    && item.responsibility_domain == "runtime"
                    && matches!(
                        item.classification.as_str(),
                        "blocking" | "required_before_release"
                    )
            })
        })
        .unwrap_or(false)
}

pub(super) fn is_bounded_product_completion_text(value: &str, max_len: usize) -> bool {
    !value.trim().is_empty()
        && value.len() <= max_len
        && value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.' | b':' | b' ')
        })
}

fn product_completion_evidence_categories_are_complete(categories: &[String]) -> bool {
    PRODUCT_COMPLETION_DECISION_REQUIRED_CATEGORIES
        .iter()
        .all(|required| categories.iter().any(|category| category == required))
}

pub(super) fn headless_product_completion_decision_payload(
    decision: &HeadlessRunProductCompletionDecision,
) -> Value {
    json!({
        "decision_id": decision.decision_id,
        "task_id": decision.task_id,
        "run_id": decision.run_id,
        "acceptance_id": decision.acceptance_id,
        "status": decision.status,
        "next_action": decision.next_action,
        "target_capability": decision.target_capability,
        "concrete_capability_transition": decision.concrete_capability_transition,
        "accepted_completion_fingerprint": decision.accepted_completion_fingerprint,
        "terminal_completion_fingerprint": decision.terminal_completion_fingerprint,
        "completion_closure_fingerprint": decision.completion_closure_fingerprint,
        "product_evidence_fingerprint": decision.product_evidence_fingerprint,
        "decision_fingerprint": decision.decision_fingerprint,
        "validated_gate_categories": decision.validated_gate_categories,
        "derived_product_evidence_matrix_fingerprint": decision.derived_product_evidence_matrix_fingerprint,
        "behavior_evidence_count": decision.behavior_evidence_count,
        "rejected_alternatives_count": decision.rejected_alternatives_count,
        "safety_boundary_reviewed": decision.safety_boundary_reviewed,
        "non_goals_reviewed": decision.non_goals_reviewed,
        "technical_debt_reviewed": decision.technical_debt_reviewed,
        "remaining_capability": decision.remaining_capability,
        "selected_remaining_gap": decision.selected_remaining_gap,
        "milestone_exit_rationale": decision.milestone_exit_rationale,
        "technical_debt_carry_forward": decision.technical_debt_carry_forward,
        "replayed": false,
    })
}

#[expect(
    clippy::too_many_arguments,
    reason = "fingerprint intentionally names every completion-decision evidence input"
)]
fn headless_product_completion_decision_fingerprint(
    request: &HeadlessRunProductCompletionDecisionRequest,
    accepted: &HeadlessRunAcceptedCompletion,
    terminal: &brownie_protocol::TaskRunCompletionEvidence,
    closure: &HeadlessRunCompletionClosure,
    status: &str,
    next_action: &str,
    missing_or_invalid_evidence: bool,
    technical_debt_carry_forward: Option<&TechnicalDebtCarryForward>,
    selected_remaining_gap: Option<&HeadlessRunProductRemainingGapSelection>,
) -> String {
    let canonical = json!({
        "version": "headless_product_completion_decision_v1",
        "decision_id": request.decision_id,
        "task_id": accepted.task_id,
        "run_id": accepted.run_id,
        "acceptance_id": accepted.acceptance_id,
        "accepted_completion_fingerprint": accepted.acceptance_fingerprint,
        "terminal_completion_fingerprint": terminal.completion_result_fingerprint,
        "completion_closure_fingerprint": closure.closure_fingerprint,
        "product_evidence_fingerprint": request.expected_product_evidence_fingerprint,
        "evidence_status": request.evidence_status,
        "derived_status": status,
        "next_action": next_action,
        "target_capability": request.target_capability,
        "concrete_capability_transition": request.concrete_capability_transition,
        "validated_gate_categories": request.validated_gate_categories,
        "derived_product_evidence_matrix_fingerprint": request.derived_product_evidence_matrix_fingerprint,
        "behavior_evidence_count": request.behavior_evidence_count,
        "rejected_alternatives_count": request.rejected_alternatives_count,
        "safety_boundary_reviewed": request.safety_boundary_reviewed,
        "non_goals_reviewed": request.non_goals_reviewed,
        "technical_debt_reviewed": request.technical_debt_reviewed,
        "remaining_capability": request.remaining_capability,
        "milestone_exit_rationale": request.milestone_exit_rationale,
        "missing_or_invalid_evidence": missing_or_invalid_evidence,
        "technical_debt_carry_forward_fingerprint": technical_debt_carry_forward.map(|carry_forward| carry_forward.fingerprint.as_str()),
        "selected_remaining_gap": selected_remaining_gap,
    });
    format!("sha256:{}", hex_sha256(canonical.to_string().as_bytes()))
}

pub(super) fn headless_product_completion_evidence_fingerprint(
    request: &HeadlessRunProductCompletionDecisionRequest,
) -> String {
    if let Some(fingerprint) = request.derived_product_evidence_matrix_fingerprint.as_ref() {
        return fingerprint.clone();
    }
    let canonical = json!({
        "version": "headless_product_completion_evidence_v1",
        "evidence_status": request.evidence_status,
        "target_capability": request.target_capability,
        "concrete_capability_transition": request.concrete_capability_transition,
        "validated_gate_categories": request.validated_gate_categories,
        "behavior_evidence_count": request.behavior_evidence_count,
        "rejected_alternatives_count": request.rejected_alternatives_count,
        "safety_boundary_reviewed": request.safety_boundary_reviewed,
        "non_goals_reviewed": request.non_goals_reviewed,
        "technical_debt_reviewed": request.technical_debt_reviewed,
        "remaining_capability": request.remaining_capability,
        "milestone_exit_rationale": request.milestone_exit_rationale,
        "technical_debt_carry_forward": request.technical_debt_carry_forward,
        "technical_debt_transitions": request.technical_debt_transitions,
    });
    format!("sha256:{}", hex_sha256(canonical.to_string().as_bytes()))
}
