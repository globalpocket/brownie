use crate::*;
use schemars::{schema_for, JsonSchema};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

const PROTOCOL_SOURCE: &str = include_str!("lib.rs");
const STORE_SOURCE: &str = include_str!("../../brownie-store/src/lib.rs");

#[derive(Debug, Clone)]
struct StructSchema {
    name: String,
    deny_unknown_fields: bool,
    fields: Vec<FieldSchema>,
}

#[derive(Debug, Clone)]
struct FieldSchema {
    name: String,
    rust_type: String,
    required: bool,
    nullable: bool,
    repeated: bool,
    semantic_type: String,
}

#[derive(Debug, Clone)]
struct EnumSchema {
    name: String,
    values: Vec<String>,
    serde_policy: String,
}

#[derive(Debug, Clone, Copy)]
struct MethodSpec {
    method: &'static str,
    group_id: &'static str,
    param_type: Option<&'static str>,
    result_type: &'static str,
    client_surfaces: &'static [&'static str],
    wire_transform: &'static str,
    request_semantics: &'static str,
    result_semantics: &'static str,
}

const METHOD_SPECS: &[MethodSpec] = &[
    method(
        "runtime.status",
        "runtime-observability",
        None,
        "RuntimeStatus",
        &["runtime", "cli", "vsix"],
        "no_params",
        "Runtime readiness projection",
        "RuntimeStatus",
    ),
    method(
        "llm.status",
        "runtime-observability",
        None,
        "LlmStatusResult",
        &["runtime", "vsix"],
        "no_params",
        "LLM provider status projection",
        "LlmStatusResult",
    ),
    method(
        "llm.health",
        "runtime-observability",
        Some("LlmHealthParams"),
        "LlmHealthResult",
        &["runtime", "vsix"],
        "identity",
        "Bounded optional network health check",
        "LlmHealthResult",
    ),
    method(
        "runtime.config.get",
        "runtime-observability",
        None,
        "RuntimeConfigGetResult",
        &["runtime", "vsix"],
        "no_params",
        "Runtime config projection",
        "RuntimeConfigGetResult",
    ),
    method(
        "runtime.diagnostics.get",
        "runtime-observability",
        None,
        "RuntimeDiagnosticsResult",
        &["runtime", "vsix"],
        "no_params",
        "Runtime diagnostics projection",
        "RuntimeDiagnosticsResult",
    ),
    method(
        "task.start",
        "task-lifecycle",
        Some("TaskStartParams"),
        "TaskStartResult",
        &["runtime", "vsix"],
        "vsix_camel_case_to_rust_snake_case_for_optional_sources",
        "Start root task with optional Runtime-owned recovery provenance",
        "TaskStartResult",
    ),
    method(
        "task.get",
        "task-lifecycle",
        Some("TaskGetParams"),
        "TaskRecord",
        &["runtime", "vsix"],
        "identity",
        "Read one task by Runtime task id",
        "TaskRecord",
    ),
    method(
        "task.cancel",
        "task-lifecycle",
        Some("TaskCancelParams"),
        "TaskCancelResult",
        &["runtime", "vsix"],
        "identity",
        "Authorized freshness-checked cancellation",
        "TaskCancelResult",
    ),
    method(
        "task.run",
        "task-lifecycle",
        Some("TaskRunParams"),
        "TaskRunResult",
        &["runtime", "cli", "vsix"],
        "cli_task_id_projection_or_identity",
        "Run an admitted task with bounded optional context",
        "TaskRunResult",
    ),
    method(
        "task.inspect",
        "task-lifecycle",
        Some("TaskInspectParams"),
        "TaskInspectResult",
        &["runtime", "cli", "vsix"],
        "identity",
        "Inspect task plus run state",
        "TaskInspectResult",
    ),
    method(
        "task.list",
        "task-lifecycle",
        Some("TaskListParams"),
        "TaskListResult",
        &["runtime", "cli", "vsix"],
        "identity_with_optional_bounds",
        "List bounded task progress overview",
        "TaskListResult",
    ),
    method(
        "headless.continue_once",
        "headless-control",
        Some("HeadlessContinueOnceParams"),
        "HeadlessContinueOnceResult",
        &["runtime", "cli"],
        "identity",
        "Advance one explicit headless continuation decision",
        "HeadlessContinueOnceResult",
    ),
    method(
        "headless.run.advance",
        "headless-control",
        Some("HeadlessRunAdvanceParams"),
        "HeadlessRunAdvanceResult",
        &["runtime", "cli"],
        "identity",
        "Advance one bounded headless run session",
        "HeadlessRunAdvanceResult",
    ),
    method(
        "headless.run.drive",
        "headless-control",
        Some("HeadlessRunDriveParams"),
        "HeadlessRunDriveResult",
        &["runtime", "cli"],
        "identity",
        "Drive a bounded headless run session",
        "HeadlessRunDriveResult",
    ),
    method(
        "headless.run.recovery_probe",
        "headless-control",
        Some("HeadlessRunRecoveryProbeParams"),
        "HeadlessRunRecoveryProbeResult",
        &["runtime", "cli"],
        "identity",
        "Probe headless recovery admission state",
        "HeadlessRunRecoveryProbeResult",
    ),
    method(
        "mode.list",
        "mode-and-modepack",
        None,
        "ModeListResult",
        &["runtime", "cli", "vsix"],
        "no_params",
        "List active Runtime mode summaries",
        "ModeListResult",
    ),
    method(
        "mode.get",
        "mode-and-modepack",
        Some("ModeGetParams"),
        "ModeSummary",
        &["runtime", "vsix"],
        "identity",
        "Resolve one active Runtime mode",
        "ModeSummary",
    ),
    method(
        "modepack.activate",
        "mode-and-modepack",
        Some("ModePackActivateParams"),
        "ModePackActivateResult",
        &["runtime", "vsix"],
        "identity",
        "Authorize activation of the current Mode Pack",
        "ModePackActivateResult",
    ),
    method(
        "modepack.fetchCandidate",
        "mode-and-modepack",
        Some("ModePackFetchCandidateParams"),
        "ModePackFetchCandidateResult",
        &["runtime", "vsix"],
        "identity",
        "Fetch bounded Mode Pack candidate",
        "ModePackFetchCandidateResult",
    ),
    method(
        "modepack.selectRegistryUpdate",
        "mode-and-modepack",
        Some("ModePackSelectRegistryUpdateParams"),
        "ModePackSelectRegistryUpdateResult",
        &["runtime", "vsix"],
        "identity",
        "Select signed registry update candidate",
        "ModePackSelectRegistryUpdateResult",
    ),
    method(
        "modepack.approveCandidate",
        "mode-and-modepack",
        Some("ModePackApproveCandidateParams"),
        "ModePackApproveCandidateResult",
        &["runtime", "vsix"],
        "identity",
        "Approve verified Mode Pack candidate",
        "ModePackApproveCandidateResult",
    ),
    method(
        "modepack.trustSigner",
        "mode-and-modepack",
        Some("ModePackTrustSignerParams"),
        "ModePackTrustSignerResult",
        &["runtime", "vsix"],
        "identity",
        "Trust a Mode Pack signer fingerprint",
        "ModePackTrustSignerResult",
    ),
    method(
        "modepack.revokeSigner",
        "mode-and-modepack",
        Some("ModePackRevokeSignerParams"),
        "ModePackRevokeSignerResult",
        &["runtime", "vsix"],
        "identity",
        "Revoke a trusted signer",
        "ModePackRevokeSignerResult",
    ),
    method(
        "modepack.verifyCandidateProvenance",
        "mode-and-modepack",
        Some("ModePackVerifyCandidateProvenanceParams"),
        "ModePackVerifyCandidateProvenanceResult",
        &["runtime", "vsix"],
        "identity",
        "Verify candidate provenance statement/signature",
        "ModePackVerifyCandidateProvenanceResult",
    ),
    method(
        "modepack.replaceActive",
        "mode-and-modepack",
        Some("ModePackReplaceActiveParams"),
        "ModePackReplaceActiveResult",
        &["runtime", "vsix"],
        "identity",
        "Replace active Mode Pack with approved candidate",
        "ModePackReplaceActiveResult",
    ),
    method(
        "modepack.rollbackActive",
        "mode-and-modepack",
        Some("ModePackRollbackActiveParams"),
        "ModePackRollbackActiveResult",
        &["runtime", "vsix"],
        "identity",
        "Rollback active Mode Pack to prior activation",
        "ModePackRollbackActiveResult",
    ),
    method(
        "permission.check",
        "permission-and-tools",
        Some("PermissionCheckParams"),
        "PermissionCheckResult",
        &["runtime"],
        "identity",
        "Evaluate Runtime permission policy",
        "PermissionCheckResult",
    ),
    method(
        "tool.list",
        "permission-and-tools",
        None,
        "ToolListResult",
        &["runtime"],
        "no_params",
        "List Runtime controlled tools",
        "ToolListResult",
    ),
    method(
        "tool.plan",
        "permission-and-tools",
        Some("ToolPlanParams"),
        "ToolPlanResult",
        &["runtime"],
        "identity",
        "Plan tool admission for a task",
        "ToolPlanResult",
    ),
    method(
        "tool.intent.parse",
        "permission-and-tools",
        Some("ToolIntentParseParams"),
        "ToolIntentParseResult",
        &["runtime"],
        "identity",
        "Parse bounded assistant tool intents",
        "ToolIntentParseResult",
    ),
    method(
        "tool.execute",
        "permission-and-tools",
        Some("ToolExecuteParams"),
        "ToolExecuteResult",
        &["runtime"],
        "identity",
        "Execute Runtime-controlled tool request",
        "ToolExecuteResult",
    ),
    method(
        "mcp.tool.approve",
        "permission-and-tools",
        Some("McpToolApprovalApproveParams"),
        "McpToolApprovalApproveResult",
        &["runtime"],
        "identity",
        "Approve exact MCP tool invocation binding",
        "McpToolApprovalApproveResult",
    ),
    method(
        "run.events",
        "run-and-codebase-inspection",
        Some("RunEventsParams"),
        "RunEventsResult",
        &["runtime"],
        "identity",
        "Read versioned run ledger events",
        "RunEventsResult",
    ),
    method(
        "run.inspect",
        "run-and-codebase-inspection",
        Some("RunInspectParams"),
        "RunInspectResult",
        &["runtime", "cli"],
        "identity",
        "Inspect run summary and artifacts",
        "RunInspectResult",
    ),
    method(
        "codebase.index.build",
        "run-and-codebase-inspection",
        Some("CodebaseIndexBuildParams"),
        "CodebaseIndexBuildResult",
        &["runtime"],
        "identity",
        "Build bounded codebase index",
        "CodebaseIndexBuildResult",
    ),
    method(
        "codebase.index.query",
        "run-and-codebase-inspection",
        Some("CodebaseIndexQueryParams"),
        "CodebaseIndexQueryResult",
        &["runtime"],
        "identity",
        "Query bounded codebase index",
        "CodebaseIndexQueryResult",
    ),
    method(
        "proposal.list",
        "proposal-and-review",
        Some("ProposalListParams"),
        "ProposalListResult",
        &["runtime", "vsix"],
        "identity",
        "List workspace proposals for a run",
        "ProposalListResult",
    ),
    method(
        "proposal.inspect",
        "proposal-and-review",
        Some("ProposalInspectParams"),
        "ProposalInspectResult",
        &["runtime", "cli", "vsix"],
        "identity",
        "Inspect a workspace proposal",
        "ProposalInspectResult",
    ),
    method(
        "proposal.approve",
        "proposal-and-review",
        Some("ProposalApproveParams"),
        "ProposalApproveResult",
        &["runtime", "vsix"],
        "identity",
        "Approve workspace proposal",
        "ProposalApproveResult",
    ),
    method(
        "proposal.reject",
        "proposal-and-review",
        Some("ProposalRejectParams"),
        "ProposalRejectResult",
        &["runtime", "vsix"],
        "identity",
        "Reject workspace proposal",
        "ProposalRejectResult",
    ),
    method(
        "proposal.preflight",
        "proposal-and-review",
        Some("ProposalPreflightParams"),
        "ProposalPreflightResult",
        &["runtime", "vsix"],
        "identity",
        "Create proposal preflight snapshot",
        "ProposalPreflightResult",
    ),
    method(
        "proposal.readiness",
        "proposal-and-review",
        Some("ProposalReadinessParams"),
        "ProposalReadinessResult",
        &["runtime", "vsix"],
        "identity",
        "Read proposal readiness report",
        "ProposalReadinessResult",
    ),
    method(
        "proposal.applyCapability",
        "proposal-and-review",
        Some("ProposalApplyCapabilityParams"),
        "ProposalApplyCapabilityResult",
        &["runtime", "vsix"],
        "identity",
        "Check proposal apply capability",
        "ProposalApplyCapabilityResult",
    ),
    method(
        "proposal.applyDryRun",
        "proposal-and-review",
        Some("ProposalApplyDryRunParams"),
        "ProposalApplyDryRunResult",
        &["runtime", "vsix"],
        "identity",
        "Dry-run proposal apply",
        "ProposalApplyDryRunResult",
    ),
    method(
        "proposal.apply",
        "proposal-and-review",
        Some("ProposalApplyParams"),
        "ProposalApplyResult",
        &["runtime", "vsix"],
        "identity_or_transaction_projection",
        "Apply approved workspace proposal",
        "ProposalApplyResult",
    ),
    method(
        "proposal.applyDryRunHistory",
        "proposal-and-review",
        Some("ProposalApplyDryRunHistoryParams"),
        "ProposalApplyDryRunHistoryResult",
        &["runtime", "vsix"],
        "identity",
        "Read proposal dry-run history",
        "ProposalApplyDryRunHistoryResult",
    ),
    method(
        "proposal.auditTrail",
        "proposal-and-review",
        Some("ProposalAuditTrailParams"),
        "ProposalAuditTrailResult",
        &["runtime", "vsix"],
        "identity",
        "Read proposal audit trail",
        "ProposalAuditTrailResult",
    ),
    method(
        "proposal.reviewBundle",
        "proposal-and-review",
        Some("ProposalReviewBundleParams"),
        "ProposalReviewBundleResult",
        &["runtime", "vsix"],
        "identity",
        "Read proposal review bundle",
        "ProposalReviewBundleResult",
    ),
    method(
        "proposal.reviewVerdict",
        "proposal-and-review",
        Some("ProposalReviewVerdictParams"),
        "ProposalReviewVerdictResult",
        &["runtime", "vsix"],
        "identity",
        "Read proposal review verdict",
        "ProposalReviewVerdictResult",
    ),
    method(
        "proposal.reviewReport",
        "proposal-and-review",
        Some("ProposalReviewReportParams"),
        "ProposalReviewReportResult",
        &["runtime", "vsix"],
        "identity",
        "Read proposal review report",
        "ProposalReviewReportResult",
    ),
    method(
        "proposal.reviewQueue",
        "proposal-and-review",
        Some("ProposalReviewQueueParams"),
        "ProposalReviewQueueResult",
        &["runtime", "vsix"],
        "identity",
        "Read proposal review queue",
        "ProposalReviewQueueResult",
    ),
];

const fn method(
    method: &'static str,
    group_id: &'static str,
    param_type: Option<&'static str>,
    result_type: &'static str,
    client_surfaces: &'static [&'static str],
    wire_transform: &'static str,
    request_semantics: &'static str,
    result_semantics: &'static str,
) -> MethodSpec {
    MethodSpec {
        method,
        group_id,
        param_type,
        result_type,
        client_surfaces,
        wire_transform,
        request_semantics,
        result_semantics,
    }
}

pub fn runtime_semantic_protocol_contract() -> Value {
    let struct_schemas = parse_public_struct_schemas(PROTOCOL_SOURCE);
    let enum_schemas = parse_public_enum_schemas(PROTOCOL_SOURCE);
    let ledger_event_kinds = parse_public_enum_values(STORE_SOURCE, "LedgerEventKind", false);
    let type_schemas = method_type_schemas();
    let method_contracts = METHOD_SPECS
        .iter()
        .map(|spec| method_contract_json(spec, &struct_schemas, &type_schemas))
        .collect::<Vec<_>>();
    let params_policy = struct_schemas
        .values()
        .filter(|schema| schema.name.ends_with("Params"))
        .map(|schema| {
            json!({
                "type": schema.name,
                "deny_unknown_fields": schema.deny_unknown_fields,
                "field_count": schema.fields.len(),
                "required_fields": required_field_names(schema),
                "optional_fields": optional_field_names(schema)
            })
        })
        .collect::<Vec<_>>();
    let task_completed_payload = json!({"status": "Completed"});
    let task_completed_late_response_payload =
        json!({"status": "Completed", "late_tool_response": true});
    let task_failed_payload = json!({
        "status": "Failed",
        "verification_completion_gate_status": "Failed",
        "required_verifier_count": 1,
        "passed_verifier_count": 0,
        "failed_verifier_count": 1,
        "required_verifier_tool_ids": ["verification.cargo_check"],
        "passed_verifier_tool_ids": [],
        "failed_verifier_tool_ids": ["verification.cargo_check"],
        "failure_reasons": ["cargo check failed"],
        "requirement_fingerprint": "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
    });
    let task_cancelled_payload = json!({
        "cancel_status": "Cancelled",
        "cancel_id": "cancel_001",
        "cancel_fingerprint": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        "request_fingerprint_version": "v1",
        "task_id": "task_1",
        "run_id": "run_1",
        "previous_status": "Running",
        "expected_task_updated_at": "2026-09-03T00:00:00Z",
        "caller_authorized": true,
        "terminal_evidence": true,
        "reason": "Runtime admitted an explicit caller-authorized cancel command for this task/run."
    });
    let permission_checked_payload = json!({
        "mode_id": "default",
        "action": "ReadWorkspace",
        "allowed": true,
        "reason": "allowed by policy"
    });
    let permission_denied_payload = json!({
        "scope": "workspace.write",
        "tool_id": "workspace.write",
        "path": "src/lib.rs",
        "operation": "replace_file",
        "mode_id": "default",
        "required_action": "WriteWorkspace",
        "workspace_write_scope_count": 0,
        "allowed": false,
        "reason": "path outside allowed workspace write scopes"
    });
    let tool_plan_payload = json!({
        "tool_id": "workspace.read",
        "required_action": "ReadWorkspace",
        "allowed": true,
        "reason": "allowed by policy"
    });
    let tool_planned_payload = json!({
        "tool_ids": ["workspace.read", "git.status"]
    });
    let tool_intent_parsed_payload = json!({
        "tool_ids": ["workspace.write"],
        "parser": {
            "found_blocks": 1,
            "accepted_blocks": 1,
            "accepted_requests": 1,
            "rejected_requests": 0,
            "max_blocks": 4,
            "max_block_bytes": 8192,
            "max_tool_requests": 8,
            "max_input_bytes": 65536,
            "max_reason_chars": 512,
            "max_workspace_write_content_chars": 200000
        }
    });
    let tool_intent_rejected_payload = json!({
        "tool_id": "unsafe.tool",
        "reason": "tool is not available in the task-pinned mode policy",
        "code": "tool_not_allowed"
    });
    let tool_intent_payload = json!({
        "tool_id": "workspace.read",
        "required_action": "ReadWorkspace",
        "allowed": true,
        "reason": "allowed by policy",
        "request_reason": "Need context.",
        "input_summary": {
            "summary_schema": "tool_intent_input_v1",
            "field_count": 1,
            "string_field_count": 1,
            "object_field_count": 0,
            "array_field_count": 0,
            "bool_field_count": 0,
            "numeric_field_count": 0,
            "null_field_count": 0,
            "other_field_count": 0,
            "fingerprint": format!("sha256:{}", "a".repeat(64))
        }
    });
    let tool_execution_requested_payload = json!({
        "tool_id": "workspace.read",
        "request_fingerprint": format!("sha256:{}", "b".repeat(64)),
        "input_summary": {
            "summary_schema": "tool_intent_input_v1",
            "field_count": 1,
            "string_field_count": 1,
            "object_field_count": 0,
            "array_field_count": 0,
            "bool_field_count": 0,
            "numeric_field_count": 0,
            "null_field_count": 0,
            "other_field_count": 0,
            "fingerprint": format!("sha256:{}", "c".repeat(64))
        }
    });
    let tool_execution_permission_payload = json!({
        "tool_id": "mcp.server.tool",
        "required_action": "ReadWorkspace",
        "allowed": true,
        "reason": "allowed by policy",
        "server_id": "server",
        "tool_name": "tool",
        "request_fingerprint": format!("sha256:{}", "d".repeat(64)),
        "mcp_safety_policy": null
    });
    let tool_execution_denied_payload = json!({
        "tool_id": "workspace.write",
        "status": "Denied",
        "reason": "denied by policy"
    });
    let mcp_tool_execution_approved_payload = json!({
        "approval_schema_version": 1,
        "task_id": "task_1",
        "run_id": "run_1",
        "tool_id": "mcp.server.tool",
        "server_id": "server",
        "tool_name": "tool",
        "request_fingerprint": format!("sha256:{}", "e".repeat(64)),
        "catalog_provenance": {
            "server_id": "server",
            "tool_name": "tool",
            "catalog_fingerprint": format!("sha256:{}", "f".repeat(64))
        },
        "mcp_safety_policy": null,
        "approval_fingerprint": format!("sha256:{}", "1".repeat(64)),
        "status": "approved",
        "approval_state_fingerprint": format!("sha256:{}", "2".repeat(64))
    });
    let tool_execution_completed_payload = json!({
        "tool_id": "workspace.read",
        "status": "Completed",
        "output_preview": "bounded output",
        "bytes_read": 14,
        "truncated": false
    });
    let tool_execution_failed_payload = json!({
        "tool_id": "mcp.server.tool",
        "status": "Failed",
        "reason": "MCP tool returned error.",
        "mcp": {
            "server_id": "server",
            "tool_name": "tool",
            "request_fingerprint": format!("sha256:{}", "3".repeat(64)),
            "result_fingerprint": format!("sha256:{}", "4".repeat(64)),
            "execution_status": "tool_returned_error"
        },
        "catalog_provenance": {
            "server_id": "server",
            "tool_name": "tool",
            "catalog_fingerprint": format!("sha256:{}", "5".repeat(64))
        },
        "mcp_safety_policy": null,
        "mcp_approval_binding": {
            "approval_schema_version": 1,
            "task_id": "task_1",
            "run_id": "run_1",
            "tool_id": "mcp.server.tool",
            "server_id": "server",
            "tool_name": "tool",
            "request_fingerprint": format!("sha256:{}", "3".repeat(64)),
            "catalog_provenance": {},
            "mcp_safety_policy": null,
            "approval_fingerprint": format!("sha256:{}", "6".repeat(64)),
            "status": "consumed",
            "approval_state_fingerprint": format!("sha256:{}", "7".repeat(64)),
            "outcome": "tool_returned_error",
            "outcome_fingerprint": format!("sha256:{}", "4".repeat(64))
        }
    });
    let codebase_index_permission_payload = json!({
        "mode_id": "orchestrator",
        "action": "IndexCodebase",
        "allowed": true,
        "reason": "mode permits bounded codebase indexing",
        "request_kind": "query",
        "query_fingerprint": format!("sha256:{}", "8".repeat(64)),
        "query_length_chars": 7,
        "query_token_count": 1,
        "max_results": 10,
        "file_kind_filter": "Rust"
    });
    let codebase_index_snapshot_payload = json!({
        "index_id": "idx_1234567890abcdef",
        "mode_id": "orchestrator",
        "root": ".",
        "workspace_fingerprint": format!("sha256:{}", "9".repeat(64)),
        "snapshot_fingerprint": format!("sha256:{}", "a".repeat(64)),
        "built_at": "2026-09-04T00:00:00Z",
        "indexed_files": 1,
        "walked_directories": 1,
        "skipped_protected": 0,
        "skipped_ignored": 0,
        "skipped_sensitive": 0,
        "skipped_symlink": 0,
        "skipped_too_large": 0,
        "skipped_binary_like": 0,
        "skipped_unreadable": 0,
        "skipped_unsafe_path": 0,
        "skipped_other": 0,
        "truncated_entries": 0,
        "visited_entries": 1,
        "truncated_directories": 0,
        "ignore_rule_files_loaded": 0,
        "ignore_rule_count": 0,
        "sensitive_finding_count": 0,
        "truncated": false,
        "max_files": 1000,
        "max_directories": 100,
        "max_path_chars": 1024,
        "max_file_bytes": 32768,
        "max_visited_entries": 2000,
        "max_directory_entries": 200,
        "requested_force_refresh": false,
        "next_action": "build_bounded_index_query_file_selection"
    });
    let codebase_index_query_payload = json!({
        "mode_id": "orchestrator",
        "query_id": "query_1234567890abcdef",
        "selection_id": "selection_1234567890abcdef",
        "query_fingerprint": format!("sha256:{}", "b".repeat(64)),
        "selection_fingerprint": format!("sha256:{}", "c".repeat(64)),
        "index_id": "idx_1234567890abcdef",
        "workspace_fingerprint": format!("sha256:{}", "d".repeat(64)),
        "snapshot_fingerprint": format!("sha256:{}", "e".repeat(64)),
        "snapshot_truncated": false,
        "matched_entry_count": 2,
        "returned_entry_count": 1,
        "skipped_entry_count": 1,
        "max_results": 10,
        "file_kind_filter": "Rust",
        "match_reason_counts": {"file_name": 1},
        "next_action": "read_selected_files_with_controlled_workspace_read"
    });
    let codebase_index_selection_read_payload = json!({
        "mode_id": "orchestrator",
        "tool_id": "codebase.index.selection.read",
        "query_id": "query_1234567890abcdef",
        "selection_id": "selection_1234567890abcdef",
        "query_fingerprint": format!("sha256:{}", "f".repeat(64)),
        "selection_fingerprint": format!("sha256:{}", "0".repeat(64)),
        "index_id": "idx_1234567890abcdef",
        "workspace_fingerprint": format!("sha256:{}", "1".repeat(64)),
        "snapshot_fingerprint": format!("sha256:{}", "2".repeat(64)),
        "snapshot_truncated": false,
        "read_path_fingerprint": format!("sha256:{}", "3".repeat(64)),
        "file_kind": "Rust",
        "byte_length": 42,
        "bytes_read": 42,
        "truncated": false,
        "content_sha256": format!("sha256:{}", "4".repeat(64)),
        "content_hash_verified": true,
        "entry_count": 1,
        "max_results": 10,
        "file_kind_filter": "Rust",
        "next_action": "use_selected_file_context_for_prompt_materialization"
    });
    let codebase_index_prompt_context_payload = json!({
        "mode_id": "orchestrator",
        "task_id": "task_1",
        "run_id": "run_1",
        "prompt_context_id": "ctx_1234567890abcdef",
        "source_event_id": "event_1234567890abcdef",
        "source_event_kind": "CodebaseIndexSelectionReadCompleted",
        "query_id": "query_1234567890abcdef",
        "selection_id": "selection_1234567890abcdef",
        "query_fingerprint": format!("sha256:{}", "5".repeat(64)),
        "selection_fingerprint": format!("sha256:{}", "6".repeat(64)),
        "index_id": "idx_1234567890abcdef",
        "workspace_fingerprint": format!("sha256:{}", "7".repeat(64)),
        "snapshot_fingerprint": format!("sha256:{}", "8".repeat(64)),
        "read_path_fingerprint": format!("sha256:{}", "9".repeat(64)),
        "file_kind": "Rust",
        "bytes_read": 42,
        "content_char_count": 42,
        "content_sha256": format!("sha256:{}", "a".repeat(64)),
        "content_hash_verified": true,
        "prompt_preview_redacted": true,
        "next_action": "continue_task_execution_with_materialized_context"
    });
    let verification_recovery_context_payload = json!({
        "verification_recovery_context_read": true,
        "context_read_id": "ctx_abcdef1234567890",
        "source_task_id": "task_source",
        "source_run_id": "run_source",
        "recovery_task_id": "task_recovery",
        "recovery_run_id": "run_recovery",
        "failure_fingerprint": format!("sha256:{}", "b".repeat(64)),
        "diagnostic_index": 0,
        "tool_id": "verification.recovery.context.read",
        "check_id": "check_cargo_test",
        "diagnostic_kind": "compile_error",
        "severity": "error",
        "test_name_hash": null,
        "read_path_fingerprint": format!("sha256:{}", "c".repeat(64)),
        "line": 12,
        "column": null,
        "excerpt_start_line": 10,
        "excerpt_end_line": 14,
        "excerpt_bytes": 120,
        "excerpt_sha256": format!("sha256:{}", "d".repeat(64)),
        "excerpt_truncated": false,
        "prompt_preview_redacted": true,
        "mode_id": "orchestrator",
        "required_action": "ReadWorkspace",
        "next_action": "run_recovery_task_with_context"
    });
    let agent_loop_started_payload = json!({
        "entrypoint": "task.run",
        "state": "BuildingContext"
    });
    let agent_loop_completed_payload = json!({
        "final_state": "Completed",
        "completion_summary": "Bounded task run completed.",
        "completion_result_fingerprint": format!("sha256:{}", "e".repeat(64)),
        "final_response_present": true,
        "final_response_chars": 42
    });
    let task_completion_accepted_payload = json!({
        "acceptance_id": "acceptance_1234567890abcdef",
        "task_id": "task_1",
        "run_id": "run_1",
        "status": "AcceptedComplete",
        "terminal_completion_fingerprint": format!("sha256:{}", "f".repeat(64)),
        "acceptance_fingerprint": format!("sha256:{}", "0".repeat(64)),
        "verifier_gate_status": "NotRequired",
        "replayed": false,
        "next_action": "inspect_accepted_completion"
    });
    let prompt_built_payload = json!({
        "message_count": 2,
        "max_prompt_chars": 32000,
        "context_total_events": 5,
        "context_included_events": 5,
        "context_omitted_events": 0,
        "context_max_events": 120,
        "context_window_bounded": false,
        "prompt_preview_redacted": true,
        "prompt_preview_redaction_reason": "selected_index_context_present"
    });
    let prompt_sensitive_scan_payload = json!({
        "mode": "warn",
        "sensitive_guard": "warn",
        "finding_count": 1,
        "categories": ["secret"],
        "message_indexes": [0]
    });
    let llm_request_created_payload = json!({
        "provider": "OpenAiCompatible",
        "model": "mock-model",
        "message_count": 2,
        "base_url": null,
        "strict": true
    });
    let llm_request_failed_payload = json!({
        "provider": "OpenAiCompatible",
        "model": "mock-model",
        "reason": "bounded provider failure",
        "reason_chars": 24,
        "reason_sha256": format!("sha256:{}", "1".repeat(64)),
        "reason_truncated": false,
        "base_url": null,
        "strict": true,
        "sensitive_guard": "deny",
        "llm_provider_failure": {
            "request_phase": "initial",
            "retryable": true
        }
    });
    let llm_response_received_payload = json!({
        "provider": "OpenAiCompatible",
        "response_preview_chars": 2000,
        "content_preview": "bounded model response"
    });
    let task_started_payload = json!({
        "status": "Queued",
        "parent_task_id": "task_parent",
        "parent_run_id": "run_parent",
        "source_candidate_id": "subtask_candidate_1",
        "source_handoff_envelope_id": "handoff_envelope_1",
        "source_handoff_envelope_fingerprint": format!("sha256:{}", "2".repeat(64)),
        "source_intent_summary": {
            "tool_id": "subtask.spawn",
            "required_action": "SpawnSubtask"
        },
        "external_modepack_child_provenance": null,
        "execution_enabled": false,
        "scheduler_handoff_enabled": false,
        "reason": "Controlled child task materialized from bounded handoff evidence."
    });
    let task_running_payload = json!({
        "runtime_deadline": {
            "deadline_unix_ms": 1780000000000u64,
            "budget_ms": 120000u64
        },
        "deadline_scope": "task_run",
        "deadline_persisted": true
    });
    let mode_resolved_payload = json!({
        "mode_id": "orchestrator",
        "display_name": "Orchestrator",
        "role_definition": "Coordinate bounded runtime work.",
        "when_to_use": null,
        "description": null,
        "prompt_sections": [],
        "verification_responsibility": null,
        "instruction_fingerprint": format!("sha256:{}", "3".repeat(64)),
        "workspace_write_scopes": [],
        "allowed_handoff_targets": null,
        "mcp_access": [],
        "completion_rules": [],
        "permissions": {
            "read_only": true,
            "workspace_write": false,
            "process_exec": false,
            "git_inspect": false,
            "git_commit": false,
            "network_access": false,
            "service_control": false,
            "destructive": false,
            "can_spawn_subtasks": false,
            "codebase_index": false,
            "mcp_tool_access": false
        }
    });
    let external_modepack_child_denied_payload = json!({
        "status": "Denied",
        "reason": "stale_external_modepack_child_policy_mismatch",
        "task_id": "task_child",
        "run_id": "run_child",
        "parent_run_id": "run_parent",
        "source_candidate_id": "subtask_candidate_1",
        "source_handoff_envelope_id": "handoff_envelope_1",
        "source_handoff_envelope_fingerprint": format!("sha256:{}", "4".repeat(64)),
        "mode_id": "reviewer-lite"
    });
    let external_modepack_task_denied_payload = json!({
        "status": "Denied",
        "reason": "stale_external_modepack_task_policy_missing",
        "task_id": "task_1",
        "run_id": "run_1",
        "mode_id": "reviewer-lite",
        "source_kind": "workspace_modepack",
        "source_path": ".brownie/modepack.json"
    });
    let subtask_orchestration_queued_payload = json!({
        "subtask_id": "subtask_1",
        "parent_task_id": "task_parent",
        "parent_run_id": "run_parent",
        "tool_id": "subtask.spawn",
        "required_action": "SpawnSubtask",
        "status": "Queued",
        "queue_position": 1,
        "request_reason": "split work",
        "input_summary": {},
        "execution_enabled": false,
        "reason": "queued",
        "requested_goal_preview": "child goal",
        "requested_mode_id": "implementer"
    });
    let subtask_handoff_prepared_payload = json!({
        "handoff_id": "handoff_1",
        "parent_task_id": "task_parent",
        "parent_run_id": "run_parent",
        "status": "Prepared",
        "queued_count": 1,
        "queued_subtask_ids": ["subtask_1"],
        "source_event_count": 1,
        "execution_enabled": false,
        "next_action": "await_future_runtime_scheduler",
        "reason": "prepared"
    });
    let subtask_scheduler_readiness_payload = json!({
        "readiness_id": "readiness_1",
        "parent_task_id": "task_parent",
        "parent_run_id": "run_parent",
        "handoff_id": "handoff_1",
        "handoff_count": 1,
        "queued_count": 1,
        "source_event_count": 1,
        "status": "Blocked",
        "readiness_status": "Blocked",
        "readiness_reason": "not ready",
        "check_count": 1,
        "blocked_checks": ["runtime_scheduler_not_implemented"],
        "execution_enabled": false,
        "dispatch_enabled": false,
        "next_action": "await_runtime_scheduler_dispatch",
        "reason": "blocked"
    });
    let subtask_dispatch_plan_payload = json!({
        "plan_id": "plan_1",
        "parent_task_id": "task_parent",
        "parent_run_id": "run_parent",
        "readiness_id": "readiness_1",
        "readiness_count": 1,
        "queued_count": 1,
        "source_event_count": 1,
        "status": "Blocked",
        "dispatch_plan_status": "Blocked",
        "dispatch_reason": "blocked",
        "required_capability": "runtime_subtask_dispatcher",
        "check_count": 1,
        "blocked_checks": ["runtime_dispatcher_not_implemented"],
        "execution_enabled": false,
        "dispatch_enabled": false,
        "next_action": "await_runtime_subtask_dispatcher",
        "reason": "blocked"
    });
    let subtask_dispatch_contract_payload = json!({
        "contract_id": "contract_1",
        "parent_task_id": "task_parent",
        "parent_run_id": "run_parent",
        "plan_id": "plan_1",
        "plan_count": 1,
        "queued_count": 1,
        "source_event_count": 1,
        "status": "Blocked",
        "dispatch_contract_status": "Blocked",
        "eligibility_status": "Blocked",
        "dispatch_contract_reason": "blocked",
        "required_capability": "runtime_subtask_dispatcher",
        "required_preconditions": ["runtime_subtask_dispatcher_implemented"],
        "check_count": 1,
        "blocked_checks": ["dispatch_contract_not_executable"],
        "execution_enabled": false,
        "dispatch_enabled": false,
        "next_action": "await_dispatch_contract_implementation",
        "reason": "blocked"
    });
    let subtask_dispatch_admission_payload = json!({
        "admission_id": "admission_1",
        "parent_task_id": "task_parent",
        "parent_run_id": "run_parent",
        "contract_id": "contract_1",
        "contract_count": 1,
        "queued_count": 1,
        "source_event_count": 1,
        "status": "Blocked",
        "admission_status": "Blocked",
        "execution_gate_status": "Blocked",
        "admission_reason": "blocked",
        "required_capability": "runtime_subtask_dispatcher",
        "precondition_count": 1,
        "satisfied_precondition_count": 0,
        "blocked_preconditions": ["runtime_subtask_dispatcher_implemented"],
        "check_count": 1,
        "blocked_checks": ["dispatch_admission_blocked"],
        "execution_enabled": false,
        "dispatch_enabled": false,
        "next_action": "await_dispatch_admission_preconditions",
        "reason": "blocked"
    });
    let subtask_dispatch_readiness_snapshot_payload = json!({
        "snapshot_id": "snapshot_1",
        "parent_task_id": "task_parent",
        "parent_run_id": "run_parent",
        "admission_id": "admission_1",
        "admission_count": 1,
        "queued_count": 1,
        "source_event_count": 1,
        "status": "Blocked",
        "readiness_status": "Blocked",
        "scheduler_handoff_status": "Blocked",
        "readiness_reason": "blocked",
        "required_capability": "runtime_subtask_dispatcher",
        "precondition_count": 1,
        "satisfied_precondition_count": 0,
        "blocked_preconditions": ["runtime_subtask_dispatcher_implemented"],
        "check_count": 1,
        "blocked_checks": ["dispatch_readiness_snapshot_blocked"],
        "readiness_fingerprint": format!("sha256:{}", "b".repeat(64)),
        "fingerprint_input_count": 8,
        "execution_enabled": false,
        "dispatch_enabled": false,
        "next_action": "await_dispatch_readiness_snapshot_handoff",
        "reason": "blocked"
    });
    let subtask_dispatcher_guard_verdict_payload = json!({
        "guard_id": "guard_1",
        "parent_task_id": "task_parent",
        "parent_run_id": "run_parent",
        "snapshot_id": "snapshot_1",
        "snapshot_count": 1,
        "queued_count": 1,
        "source_event_count": 1,
        "status": "Blocked",
        "guard_status": "Blocked",
        "scheduler_handoff_status": "Blocked",
        "handoff_preflight_status": "Blocked",
        "snapshot_validity_status": "Current",
        "snapshot_fingerprint": format!("sha256:{}", "b".repeat(64)),
        "snapshot_fingerprint_count": 1,
        "fingerprint_input_count": 8,
        "guard_reason": "blocked",
        "required_capability": "runtime_subtask_dispatcher",
        "precondition_count": 1,
        "satisfied_precondition_count": 0,
        "blocked_preconditions": ["runtime_subtask_dispatcher_implemented"],
        "check_count": 1,
        "blocked_checks": ["dispatcher_guard_blocked"],
        "execution_enabled": false,
        "dispatch_enabled": false,
        "next_action": "await_dispatcher_guard_preconditions",
        "reason": "blocked"
    });
    let subtask_dispatch_decision_payload = json!({
        "decision_id": "decision_1",
        "parent_task_id": "task_parent",
        "parent_run_id": "run_parent",
        "guard_id": "guard_1",
        "guard_count": 1,
        "snapshot_id": "snapshot_1",
        "queued_count": 1,
        "source_event_count": 1,
        "status": "Blocked",
        "decision_status": "Blocked",
        "candidate_status": "Blocked",
        "dispatch_decision": "Denied",
        "dispatch_denial_reason": "blocked",
        "handoff_preflight_status": "Blocked",
        "guard_status": "Blocked",
        "snapshot_validity_status": "Current",
        "snapshot_fingerprint": format!("sha256:{}", "b".repeat(64)),
        "snapshot_fingerprint_count": 1,
        "fingerprint_input_count": 8,
        "dispatch_candidate_count": 1,
        "eligible_candidate_count": 0,
        "blocked_candidate_count": 1,
        "required_capability": "runtime_subtask_dispatcher",
        "precondition_count": 1,
        "satisfied_precondition_count": 0,
        "blocked_preconditions": ["runtime_subtask_dispatcher_implemented"],
        "check_count": 1,
        "blocked_checks": ["dispatch_decision_blocked"],
        "execution_enabled": false,
        "dispatch_enabled": false,
        "next_action": "await_dispatch_decision_preconditions",
        "reason": "blocked"
    });
    let subtask_dispatch_candidate_manifest_payload = json!({
        "manifest_id": "manifest_1",
        "parent_task_id": "task_parent",
        "parent_run_id": "run_parent",
        "decision_id": "decision_1",
        "decision_count": 1,
        "guard_id": "guard_1",
        "snapshot_id": "snapshot_1",
        "queued_count": 1,
        "source_event_count": 1,
        "status": "Blocked",
        "manifest_status": "Blocked",
        "candidate_status": "Blocked",
        "dispatch_decision": "Denied",
        "candidate_denial_reason": "blocked",
        "candidate_count": 1,
        "dispatch_candidate_count": 1,
        "eligible_candidate_count": 0,
        "blocked_candidate_count": 1,
        "candidate_ids": ["subtask_1"],
        "eligible_candidate_ids": [],
        "blocked_candidate_ids": ["subtask_1"],
        "candidate_manifest_fingerprint": format!("sha256:{}", "c".repeat(64)),
        "snapshot_fingerprint": format!("sha256:{}", "b".repeat(64)),
        "fingerprint_input_count": 8,
        "required_capability": "runtime_subtask_dispatcher",
        "precondition_count": 1,
        "satisfied_precondition_count": 0,
        "blocked_preconditions": ["runtime_subtask_dispatcher_implemented"],
        "check_count": 1,
        "blocked_checks": ["dispatch_candidate_manifest_blocked"],
        "execution_enabled": false,
        "dispatch_enabled": false,
        "next_action": "await_dispatch_candidate_manifest_preconditions",
        "reason": "blocked"
    });
    let subtask_dispatch_handoff_envelope_payload = json!({
        "handoff_envelope_id": "envelope_1",
        "parent_task_id": "task_parent",
        "parent_run_id": "run_parent",
        "manifest_id": "manifest_1",
        "manifest_count": 1,
        "decision_id": "decision_1",
        "queued_count": 1,
        "source_event_count": 1,
        "status": "Accepted",
        "handoff_envelope_status": "Accepted",
        "handoff_ticket_status": "Blocked",
        "replay_guard_status": "Blocked",
        "scheduler_handoff_status": "Blocked",
        "candidate_status": "Blocked",
        "dispatch_decision": "Denied",
        "candidate_denial_reason": "blocked",
        "candidate_count": 1,
        "dispatch_candidate_count": 1,
        "eligible_candidate_count": 0,
        "blocked_candidate_count": 1,
        "handoff_ticket_count": 0,
        "candidate_ids": ["subtask_1"],
        "eligible_candidate_ids": [],
        "blocked_candidate_ids": ["subtask_1"],
        "candidate_manifest_fingerprint": format!("sha256:{}", "c".repeat(64)),
        "handoff_envelope_fingerprint": format!("sha256:{}", "d".repeat(64)),
        "fingerprint_input_count": 8,
        "required_capability": "runtime_subtask_dispatcher",
        "precondition_count": 1,
        "satisfied_precondition_count": 0,
        "blocked_preconditions": ["runtime_subtask_dispatcher_implemented"],
        "check_count": 1,
        "blocked_checks": ["dispatch_handoff_envelope_blocked"],
        "execution_enabled": false,
        "dispatch_enabled": false,
        "next_action": "materialize_controlled_child_task",
        "reason": "blocked"
    });
    let parent_join_continuation_consumed_payload = json!({
        "parent_join_continuation_status": "Consumed",
        "admission_id": "parent_join_admission_1",
        "child_completion_fingerprint": format!("sha256:{}", "a".repeat(64)),
        "child_completion_child_count": 1,
        "child_terminal_completed_count": 1,
        "child_terminal_failed_count": 0,
        "child_recovery_cycle_depth": 0,
        "fingerprint_input_count": 5,
        "reason": "consumed"
    });
    let event_payload_schema_classifications = ledger_event_kinds
        .iter()
        .map(|kind| {
            let classification = ledger_payload_schema_classification(kind);
            json!({
                "ledger_event_kind": kind,
                "payload_schema_classification": classification,
                "payload_schema_contract_status": ledger_payload_schema_contract_status(classification),
                "release_blocking_until_typed": ledger_payload_schema_release_blocking(classification)
            })
        })
        .collect::<Vec<_>>();
    let release_blocking_open_payload_count = event_payload_schema_classifications
        .iter()
        .filter(|entry| {
            entry
                .get("release_blocking_until_typed")
                .and_then(Value::as_bool)
                .unwrap_or(false)
        })
        .count();
    let payload_schema_fixtures = vec![
        json!({
            "ledger_event_kind": "TaskCompleted",
            "payload": task_completed_payload,
            "payload_schema_classification": ledger_payload_schema_classification("TaskCompleted"),
            "payload_schema_contract_status": ledger_payload_schema_contract_status(ledger_payload_schema_classification("TaskCompleted")),
            "payload_schema_id": ledger_payload_schema_id("TaskCompleted"),
            "payload_schema_fingerprint": ledger_payload_schema_fingerprint("TaskCompleted"),
            "payload_instance_shape_descriptor": ledger_payload_shape_descriptor(&task_completed_payload),
            "payload_instance_shape_fingerprint": ledger_payload_instance_shape_fingerprint_for_value("TaskCompleted", &task_completed_payload)
        }),
        json!({
            "ledger_event_kind": "TaskCompleted",
            "payload": task_completed_late_response_payload,
            "payload_schema_classification": ledger_payload_schema_classification("TaskCompleted"),
            "payload_schema_contract_status": ledger_payload_schema_contract_status(ledger_payload_schema_classification("TaskCompleted")),
            "payload_schema_id": ledger_payload_schema_id("TaskCompleted"),
            "payload_schema_fingerprint": ledger_payload_schema_fingerprint("TaskCompleted"),
            "payload_instance_shape_descriptor": ledger_payload_shape_descriptor(&task_completed_late_response_payload),
            "payload_instance_shape_fingerprint": ledger_payload_instance_shape_fingerprint_for_value("TaskCompleted", &task_completed_late_response_payload)
        }),
        json!({
            "ledger_event_kind": "TaskFailed",
            "payload": task_failed_payload,
            "payload_schema_classification": ledger_payload_schema_classification("TaskFailed"),
            "payload_schema_contract_status": ledger_payload_schema_contract_status(ledger_payload_schema_classification("TaskFailed")),
            "payload_schema_id": ledger_payload_schema_id("TaskFailed"),
            "payload_schema_fingerprint": ledger_payload_schema_fingerprint("TaskFailed"),
            "payload_instance_shape_descriptor": ledger_payload_shape_descriptor(&task_failed_payload),
            "payload_instance_shape_fingerprint": ledger_payload_instance_shape_fingerprint_for_value("TaskFailed", &task_failed_payload)
        }),
        json!({
            "ledger_event_kind": "TaskCancelled",
            "payload": task_cancelled_payload,
            "payload_schema_classification": ledger_payload_schema_classification("TaskCancelled"),
            "payload_schema_contract_status": ledger_payload_schema_contract_status(ledger_payload_schema_classification("TaskCancelled")),
            "payload_schema_id": ledger_payload_schema_id("TaskCancelled"),
            "payload_schema_fingerprint": ledger_payload_schema_fingerprint("TaskCancelled"),
            "payload_instance_shape_descriptor": ledger_payload_shape_descriptor(&task_cancelled_payload),
            "payload_instance_shape_fingerprint": ledger_payload_instance_shape_fingerprint_for_value("TaskCancelled", &task_cancelled_payload)
        }),
        json!({
            "ledger_event_kind": "PermissionChecked",
            "payload": permission_checked_payload,
            "payload_schema_classification": ledger_payload_schema_classification("PermissionChecked"),
            "payload_schema_contract_status": ledger_payload_schema_contract_status(ledger_payload_schema_classification("PermissionChecked")),
            "payload_schema_id": ledger_payload_schema_id("PermissionChecked"),
            "payload_schema_fingerprint": ledger_payload_schema_fingerprint("PermissionChecked"),
            "payload_instance_shape_descriptor": ledger_payload_shape_descriptor(&permission_checked_payload),
            "payload_instance_shape_fingerprint": ledger_payload_instance_shape_fingerprint_for_value("PermissionChecked", &permission_checked_payload)
        }),
        json!({
            "ledger_event_kind": "PermissionDenied",
            "payload": permission_denied_payload,
            "payload_schema_classification": ledger_payload_schema_classification("PermissionDenied"),
            "payload_schema_contract_status": ledger_payload_schema_contract_status(ledger_payload_schema_classification("PermissionDenied")),
            "payload_schema_id": ledger_payload_schema_id("PermissionDenied"),
            "payload_schema_fingerprint": ledger_payload_schema_fingerprint("PermissionDenied"),
            "payload_instance_shape_descriptor": ledger_payload_shape_descriptor(&permission_denied_payload),
            "payload_instance_shape_fingerprint": ledger_payload_instance_shape_fingerprint_for_value("PermissionDenied", &permission_denied_payload)
        }),
        payload_schema_fixture("ToolPlanned", &tool_planned_payload),
        json!({
            "ledger_event_kind": "ToolPermissionChecked",
            "payload": tool_plan_payload,
            "payload_schema_classification": ledger_payload_schema_classification("ToolPermissionChecked"),
            "payload_schema_contract_status": ledger_payload_schema_contract_status(ledger_payload_schema_classification("ToolPermissionChecked")),
            "payload_schema_id": ledger_payload_schema_id("ToolPermissionChecked"),
            "payload_schema_fingerprint": ledger_payload_schema_fingerprint("ToolPermissionChecked"),
            "payload_instance_shape_descriptor": ledger_payload_shape_descriptor(&tool_plan_payload),
            "payload_instance_shape_fingerprint": ledger_payload_instance_shape_fingerprint_for_value("ToolPermissionChecked", &tool_plan_payload)
        }),
        payload_schema_fixture("ToolIntentParsed", &tool_intent_parsed_payload),
        payload_schema_fixture("ToolIntentRejected", &tool_intent_rejected_payload),
        json!({
            "ledger_event_kind": "ToolIntentPermissionChecked",
            "payload": tool_intent_payload,
            "payload_schema_classification": ledger_payload_schema_classification("ToolIntentPermissionChecked"),
            "payload_schema_contract_status": ledger_payload_schema_contract_status(ledger_payload_schema_classification("ToolIntentPermissionChecked")),
            "payload_schema_id": ledger_payload_schema_id("ToolIntentPermissionChecked"),
            "payload_schema_fingerprint": ledger_payload_schema_fingerprint("ToolIntentPermissionChecked"),
            "payload_instance_shape_descriptor": ledger_payload_shape_descriptor(&tool_intent_payload),
            "payload_instance_shape_fingerprint": ledger_payload_instance_shape_fingerprint_for_value("ToolIntentPermissionChecked", &tool_intent_payload)
        }),
        json!({
            "ledger_event_kind": "ToolExecutionRequested",
            "payload": tool_execution_requested_payload,
            "payload_schema_classification": ledger_payload_schema_classification("ToolExecutionRequested"),
            "payload_schema_contract_status": ledger_payload_schema_contract_status(ledger_payload_schema_classification("ToolExecutionRequested")),
            "payload_schema_id": ledger_payload_schema_id("ToolExecutionRequested"),
            "payload_schema_fingerprint": ledger_payload_schema_fingerprint("ToolExecutionRequested"),
            "payload_instance_shape_descriptor": ledger_payload_shape_descriptor(&tool_execution_requested_payload),
            "payload_instance_shape_fingerprint": ledger_payload_instance_shape_fingerprint_for_value("ToolExecutionRequested", &tool_execution_requested_payload)
        }),
        json!({
            "ledger_event_kind": "ToolExecutionPermissionChecked",
            "payload": tool_execution_permission_payload,
            "payload_schema_classification": ledger_payload_schema_classification("ToolExecutionPermissionChecked"),
            "payload_schema_contract_status": ledger_payload_schema_contract_status(ledger_payload_schema_classification("ToolExecutionPermissionChecked")),
            "payload_schema_id": ledger_payload_schema_id("ToolExecutionPermissionChecked"),
            "payload_schema_fingerprint": ledger_payload_schema_fingerprint("ToolExecutionPermissionChecked"),
            "payload_instance_shape_descriptor": ledger_payload_shape_descriptor(&tool_execution_permission_payload),
            "payload_instance_shape_fingerprint": ledger_payload_instance_shape_fingerprint_for_value("ToolExecutionPermissionChecked", &tool_execution_permission_payload)
        }),
        json!({
            "ledger_event_kind": "ToolExecutionDenied",
            "payload": tool_execution_denied_payload,
            "payload_schema_classification": ledger_payload_schema_classification("ToolExecutionDenied"),
            "payload_schema_contract_status": ledger_payload_schema_contract_status(ledger_payload_schema_classification("ToolExecutionDenied")),
            "payload_schema_id": ledger_payload_schema_id("ToolExecutionDenied"),
            "payload_schema_fingerprint": ledger_payload_schema_fingerprint("ToolExecutionDenied"),
            "payload_instance_shape_descriptor": ledger_payload_shape_descriptor(&tool_execution_denied_payload),
            "payload_instance_shape_fingerprint": ledger_payload_instance_shape_fingerprint_for_value("ToolExecutionDenied", &tool_execution_denied_payload)
        }),
        json!({
            "ledger_event_kind": "McpToolExecutionApproved",
            "payload": mcp_tool_execution_approved_payload,
            "payload_schema_classification": ledger_payload_schema_classification("McpToolExecutionApproved"),
            "payload_schema_contract_status": ledger_payload_schema_contract_status(ledger_payload_schema_classification("McpToolExecutionApproved")),
            "payload_schema_id": ledger_payload_schema_id("McpToolExecutionApproved"),
            "payload_schema_fingerprint": ledger_payload_schema_fingerprint("McpToolExecutionApproved"),
            "payload_instance_shape_descriptor": ledger_payload_shape_descriptor(&mcp_tool_execution_approved_payload),
            "payload_instance_shape_fingerprint": ledger_payload_instance_shape_fingerprint_for_value("McpToolExecutionApproved", &mcp_tool_execution_approved_payload)
        }),
        json!({
            "ledger_event_kind": "ToolExecutionCompleted",
            "payload": tool_execution_completed_payload,
            "payload_schema_classification": ledger_payload_schema_classification("ToolExecutionCompleted"),
            "payload_schema_contract_status": ledger_payload_schema_contract_status(ledger_payload_schema_classification("ToolExecutionCompleted")),
            "payload_schema_id": ledger_payload_schema_id("ToolExecutionCompleted"),
            "payload_schema_fingerprint": ledger_payload_schema_fingerprint("ToolExecutionCompleted"),
            "payload_instance_shape_descriptor": ledger_payload_shape_descriptor(&tool_execution_completed_payload),
            "payload_instance_shape_fingerprint": ledger_payload_instance_shape_fingerprint_for_value("ToolExecutionCompleted", &tool_execution_completed_payload)
        }),
        json!({
            "ledger_event_kind": "ToolExecutionFailed",
            "payload": tool_execution_failed_payload,
            "payload_schema_classification": ledger_payload_schema_classification("ToolExecutionFailed"),
            "payload_schema_contract_status": ledger_payload_schema_contract_status(ledger_payload_schema_classification("ToolExecutionFailed")),
            "payload_schema_id": ledger_payload_schema_id("ToolExecutionFailed"),
            "payload_schema_fingerprint": ledger_payload_schema_fingerprint("ToolExecutionFailed"),
            "payload_instance_shape_descriptor": ledger_payload_shape_descriptor(&tool_execution_failed_payload),
            "payload_instance_shape_fingerprint": ledger_payload_instance_shape_fingerprint_for_value("ToolExecutionFailed", &tool_execution_failed_payload)
        }),
        payload_schema_fixture(
            "CodebaseIndexPermissionChecked",
            &codebase_index_permission_payload,
        ),
        payload_schema_fixture(
            "CodebaseIndexSnapshotBuilt",
            &codebase_index_snapshot_payload,
        ),
        payload_schema_fixture("CodebaseIndexQueryCompleted", &codebase_index_query_payload),
        payload_schema_fixture(
            "CodebaseIndexSelectionReadCompleted",
            &codebase_index_selection_read_payload,
        ),
        payload_schema_fixture(
            "CodebaseIndexPromptContextMaterialized",
            &codebase_index_prompt_context_payload,
        ),
        payload_schema_fixture(
            "VerificationRecoveryContextReadMaterialized",
            &verification_recovery_context_payload,
        ),
        payload_schema_fixture("AgentLoopStarted", &agent_loop_started_payload),
        payload_schema_fixture("AgentLoopCompleted", &agent_loop_completed_payload),
        payload_schema_fixture("TaskCompletionAccepted", &task_completion_accepted_payload),
        payload_schema_fixture("PromptBuilt", &prompt_built_payload),
        payload_schema_fixture("SecondPassPromptBuilt", &prompt_built_payload),
        payload_schema_fixture(
            "PromptSensitiveScanCompleted",
            &prompt_sensitive_scan_payload,
        ),
        payload_schema_fixture("PromptSensitiveScanFailed", &prompt_sensitive_scan_payload),
        payload_schema_fixture("LlmRequestCreated", &llm_request_created_payload),
        payload_schema_fixture("SecondPassLlmRequestCreated", &llm_request_created_payload),
        payload_schema_fixture("LlmRequestFailed", &llm_request_failed_payload),
        payload_schema_fixture("SecondPassLlmRequestFailed", &llm_request_failed_payload),
        payload_schema_fixture("LlmResponseReceived", &llm_response_received_payload),
        payload_schema_fixture(
            "SecondPassLlmResponseReceived",
            &llm_response_received_payload,
        ),
        payload_schema_fixture("TaskStarted", &task_started_payload),
        payload_schema_fixture("TaskRunning", &task_running_payload),
        payload_schema_fixture("ModeResolved", &mode_resolved_payload),
        payload_schema_fixture(
            "ExternalModePackChildProvenanceDenied",
            &external_modepack_child_denied_payload,
        ),
        payload_schema_fixture(
            "ExternalModePackTaskProvenanceDenied",
            &external_modepack_task_denied_payload,
        ),
        payload_schema_fixture(
            "SubtaskOrchestrationQueued",
            &subtask_orchestration_queued_payload,
        ),
        payload_schema_fixture("SubtaskHandoffPrepared", &subtask_handoff_prepared_payload),
        payload_schema_fixture(
            "SubtaskSchedulerReadinessRecorded",
            &subtask_scheduler_readiness_payload,
        ),
        payload_schema_fixture(
            "SubtaskDispatchPlanPrepared",
            &subtask_dispatch_plan_payload,
        ),
        payload_schema_fixture(
            "SubtaskDispatchContractPrepared",
            &subtask_dispatch_contract_payload,
        ),
        payload_schema_fixture(
            "SubtaskDispatchAdmissionEvaluated",
            &subtask_dispatch_admission_payload,
        ),
        payload_schema_fixture(
            "SubtaskDispatchReadinessSnapshotRecorded",
            &subtask_dispatch_readiness_snapshot_payload,
        ),
        payload_schema_fixture(
            "SubtaskDispatcherGuardVerdictRecorded",
            &subtask_dispatcher_guard_verdict_payload,
        ),
        payload_schema_fixture(
            "SubtaskDispatchDecisionRecorded",
            &subtask_dispatch_decision_payload,
        ),
        payload_schema_fixture(
            "SubtaskDispatchCandidateManifestRecorded",
            &subtask_dispatch_candidate_manifest_payload,
        ),
        payload_schema_fixture(
            "SubtaskDispatchHandoffEnvelopeRecorded",
            &subtask_dispatch_handoff_envelope_payload,
        ),
        payload_schema_fixture(
            "ParentJoinContinuationFingerprintConsumed",
            &parent_join_continuation_consumed_payload,
        ),
    ];

    json!({
        "schema_version": 10,
        "contract_id": "runtime-semantic-protocol-contract-v1",
        "campaign": "runtime-release-readiness-p0-p1-finite-closure",
        "phase": "RRP-5.15",
        "owner": "runtime",
        "runtime_release_debt_id": "protocol-event-canonization",
        "runtime_release_ready": false,
        "generated_by": {
            "crate": "brownie-protocol",
            "module": "brownie_protocol::semantic_contract",
            "binary": "brownie-protocol-semantic-contract",
            "command": "cargo run -p brownie-protocol --bin brownie-protocol-semantic-contract -- --write docs/architecture/runtime-semantic-protocol-contract.json",
            "source_introspection": [
                "crates/brownie-protocol/src/lib.rs",
                "crates/brownie-store/src/lib.rs"
            ]
        },
        "sources": [
            {
                "path": "crates/brownie-protocol/src/lib.rs",
                "role": "Runtime JSON-RPC wire types, public params, results, and serde semantics"
            },
            {
                "path": "crates/brownie-protocol/src/semantic_contract.rs",
                "role": "Runtime-owned source-introspecting semantic protocol contract generator"
            },
            {
                "path": "extensions/brownie-vsix/src/runtime/protocol.ts",
                "role": "VSIX client-side validator semantics"
            },
            {
                "path": "extensions/brownie-vsix/src/runtime/runtimeClient.ts",
                "role": "VSIX JSON-RPC request projection semantics"
            },
            {
                "path": "extensions/brownie-vsix/src/test/semanticProtocolContract.test.ts",
                "role": "VSIX golden fixture and unknown-field contract tests"
            },
            {
                "path": "crates/brownie-store/src/lib.rs",
                "role": "Durable ledger payload envelope, event kind, and schema migration coupling"
            }
        ],
        "method_contracts": method_contracts,
        "type_schemas": type_schemas,
        "recursive_json_schema_coverage": {
            "generator": "schemars",
            "definition_keyword": "$defs",
            "type_schema_count": method_type_names().len(),
            "coverage": "Every method param/result type has a recursive Rust-derived JSON Schema document with nested struct and enum definitions.",
            "method_reference_policy": "Each method contract records request_schema_ref/result_schema_ref and request/result recursive schema fingerprints derived from type_schemas.",
            "drift_detection": "Nested field, enum, required, nullable, array, object, and referenced type shape changes alter the recursive schema fingerprint and require artifact regeneration."
        },
        "method_coverage": {
            "explicit_runtime_method_count": METHOD_SPECS.len(),
            "coverage_source": "docs/architecture/runtime-protocol-event-canonical-map.json protocol_method_groups[].methods",
            "policy": "Every explicit Runtime method in the canonical map must have a semantic method contract."
        },
        "enum_contracts": enum_schemas
            .values()
            .map(enum_contract_json)
            .collect::<Vec<_>>(),
        "jsonrpc_error_contract": {
            "success_response": "result_only",
            "error_response": "error_only",
            "error_fields": ["code", "message"],
            "unknown_method_code": -32601,
            "invalid_params_code": -32602,
            "invalid_request_code": -32600,
            "internal_error_code": -32603
        },
        "unknown_field_policy": {
            "rust_public_params": params_policy,
            "policy": "Every public Runtime *Params type must use serde deny_unknown_fields; no-param methods accept no semantic request fields.",
            "vsix_validators_use_hasOnlyFields": [
                "isTaskStartParams",
                "isTaskCancelParams",
                "isTaskRunParams",
                "isHeadlessRunDriveParams",
                "isTaskCancelResult"
            ],
            "tests": [
                "semantic_contract_artifact_matches_rust_generator",
                "public_runtime_params_reject_unknown_fields",
                "semantic_contract_covers_all_explicit_runtime_methods",
                "semantic_contract_fixtures_match_rust_serialization_semantics",
                "validates Rust semantic contract fixtures at the VSIX boundary",
                "rejects unknown fields from semantic contract fixtures"
            ]
        },
        "golden_fixtures": golden_fixtures(),
        "durable_event_migration_coupling": {
            "store_schema_version": 2,
            "schema_manifest_path": ".brownie/store-schema.json",
            "layout_marker_path": ".brownie/store-layout.json",
            "ledger_event_kind_source": "crates/brownie-store/src/lib.rs",
            "ledger_payload_envelope_type": "LedgerPayloadEnvelope",
            "ledger_payload_envelope_field": "payload_envelope",
            "ledger_payload_schema_version_source": "LEDGER_PAYLOAD_SCHEMA_VERSION",
            "ledger_payload_shape_version_source": "LEDGER_PAYLOAD_SHAPE_VERSION",
            "ledger_payload_schema_fingerprint_basis": "LedgerEventKind plus the fixed Runtime-owned payload schema descriptor for that event-kind/version. It is stable across optional field presence, null-vs-value choices, and other individual payload instance variation.",
            "ledger_payload_instance_shape_fingerprint_basis": "LedgerEventKind plus the canonical structural shape of the actual persisted payload value. This is diagnostic instance evidence, not the durable contract schema fingerprint.",
            "ledger_payload_contract_scope": {
                "jsonrpc_request_result_contract": "closed",
                "schema_and_instance_fingerprint_split": "closed",
                "ledger_event_payload_inventory": "closed",
                "ledger_event_payload_typed_schema_coverage": "partial"
            },
            "ledger_payload_schema_classification_policy": "Every LedgerEventKind must carry an explicit payload schema classification. versioned_open and typed_known_fields_open are allowed only as required-before-release debt evidence and must not be treated as fully typed ledger payload schemas. TaskCompleted, TaskFailed, TaskCancelled, PermissionChecked, PermissionDenied, ToolPermissionChecked, ToolPlanApproved, ToolPlanDenied, ToolIntentPermissionChecked, ToolIntentApproved, ToolIntentDenied, ToolExecutionRequested, McpToolExecutionApproved, ToolExecutionPermissionChecked, ToolExecutionCompleted, ToolExecutionDenied, ToolExecutionFailed, CodebaseIndexPermissionChecked, CodebaseIndexSnapshotBuilt, CodebaseIndexQueryCompleted, CodebaseIndexSelectionReadCompleted, CodebaseIndexPromptContextMaterialized, VerificationRecoveryContextReadMaterialized, AgentLoopStarted, AgentLoopCompleted, TaskCompletionAccepted, PromptBuilt, PromptSensitiveScanCompleted, PromptSensitiveScanFailed, LlmRequestCreated, LlmRequestFailed, LlmResponseReceived, SecondPassPromptBuilt, SecondPassLlmRequestCreated, SecondPassLlmRequestFailed, and SecondPassLlmResponseReceived are strict typed payload families.",
            "policy": "Durable event kind or typed payload schema changes require an explicit brownie-store schema migration or compatibility entry before Runtime release. Runtime payload envelopes carry both a fixed schema_fingerprint and a separate diagnostic instance_shape_fingerprint. Versioned-open payload classifications keep protocol-event-canonization partial until every payload-bearing event has a strict typed schema, an explicit payload_absent contract, or a legacy-only compatibility entry. Current v10 terminal task, permission, selected tool, MCP approval, tool terminal, codebase index, verification recovery context, agent loop, prompt, LLM request/response/failure, completion-acceptance, task admission, mode-resolution, tool planning, and intent parsing payload schemas preserve v1 through v9 read compatibility while requiring strict field validation for new appends.",
            "guard": "guard:protocol-event-canonization",
            "event_payload_schema_classification_count": event_payload_schema_classifications.len(),
            "event_payload_schema_classifications": event_payload_schema_classifications,
            "release_blocking_open_payload_count": release_blocking_open_payload_count,
            "event_payload_schema_fingerprint_count": ledger_event_kinds.len(),
            "event_payload_schema_fingerprints": ledger_event_kinds
                .iter()
                .map(|kind| {
                    let schema_id = ledger_payload_schema_id(kind);
                    let classification = ledger_payload_schema_classification(kind);
                    json!({
                        "ledger_event_kind": kind,
                        "payload_schema_id": schema_id,
                        "payload_schema_classification": classification,
                        "payload_schema_contract_status": ledger_payload_schema_contract_status(classification),
                        "release_blocking_until_typed": ledger_payload_schema_release_blocking(classification),
                        "payload_schema_version": LEDGER_PAYLOAD_SCHEMA_VERSION,
                        "payload_schema_fingerprint": ledger_payload_schema_fingerprint(kind),
                        "payload_schema_descriptor": ledger_payload_schema_descriptor(kind),
                        "store_schema_version": 2
                    })
                })
                .collect::<Vec<_>>(),
            "payload_schema_fixtures": payload_schema_fixtures
        }
    })
}

fn payload_schema_fixture(kind: &str, payload: &Value) -> Value {
    json!({
        "ledger_event_kind": kind,
        "payload": payload,
        "payload_schema_classification": ledger_payload_schema_classification(kind),
        "payload_schema_contract_status": ledger_payload_schema_contract_status(ledger_payload_schema_classification(kind)),
        "payload_schema_id": ledger_payload_schema_id(kind),
        "payload_schema_fingerprint": ledger_payload_schema_fingerprint(kind),
        "payload_instance_shape_descriptor": ledger_payload_shape_descriptor(payload),
        "payload_instance_shape_fingerprint": ledger_payload_instance_shape_fingerprint_for_value(kind, payload)
    })
}

fn method_contract_json(
    spec: &MethodSpec,
    structs: &BTreeMap<String, StructSchema>,
    type_schemas: &BTreeMap<String, Value>,
) -> Value {
    let param_schema = spec.param_type.and_then(|name| structs.get(name));
    let request_schema = match spec.param_type {
        Some(name) => struct_schema_json(
            param_schema.unwrap_or_else(|| panic!("missing semantic params schema for {name}")),
        ),
        None => json!({
            "kind": "no_params",
            "fields": [],
            "required_fields": [],
            "optional_fields": [],
            "unknown_field_policy": "no request params type"
        }),
    };
    let result_schema = struct_schema_json(
        structs
            .get(spec.result_type)
            .unwrap_or_else(|| panic!("missing semantic result schema for {}", spec.result_type)),
    );
    let request_schema_ref = spec.param_type.map(|name| format!("#/type_schemas/{name}"));
    let request_recursive_schema_fingerprint = spec
        .param_type
        .map(|name| type_schema_fingerprint(type_schemas, name));
    let result_schema_ref = format!("#/type_schemas/{}", spec.result_type);
    let result_recursive_schema_fingerprint =
        type_schema_fingerprint(type_schemas, spec.result_type);
    json!({
        "method": spec.method,
        "group_id": spec.group_id,
        "param_type": spec.param_type,
        "result_type": spec.result_type,
        "request_semantics": spec.request_semantics,
        "result_semantics": spec.result_semantics,
        "client_surfaces": spec.client_surfaces,
        "wire_transform": spec.wire_transform,
        "unknown_field_policy": if spec.param_type.is_some() { "rust_deny_unknown_fields" } else { "no_params" },
        "required_fields": param_schema.map(required_field_names).unwrap_or_default(),
        "optional_fields": param_schema.map(optional_field_names).unwrap_or_default(),
        "request_schema": request_schema,
        "result_schema": result_schema,
        "request_schema_ref": request_schema_ref,
        "result_schema_ref": result_schema_ref,
        "request_recursive_schema_fingerprint": request_recursive_schema_fingerprint,
        "result_recursive_schema_fingerprint": result_recursive_schema_fingerprint,
        "schema_fingerprint": stable_fingerprint(&format!(
            "{}:{}:{}:{}:{}",
            spec.method,
            spec.param_type.unwrap_or("NoParams"),
            spec.result_type,
            request_recursive_schema_fingerprint.unwrap_or_else(|| "no_params".to_string()),
            result_recursive_schema_fingerprint
        ))
    })
}

macro_rules! insert_method_type_schema {
    ($schemas:ident, $ty:ty) => {
        insert_type_schema::<$ty>(&mut $schemas, stringify!($ty));
    };
}

fn method_type_schemas() -> BTreeMap<String, Value> {
    let mut schemas = BTreeMap::new();
    insert_method_type_schema!(schemas, CodebaseIndexBuildParams);
    insert_method_type_schema!(schemas, CodebaseIndexBuildResult);
    insert_method_type_schema!(schemas, CodebaseIndexQueryParams);
    insert_method_type_schema!(schemas, CodebaseIndexQueryResult);
    insert_method_type_schema!(schemas, HeadlessContinueOnceParams);
    insert_method_type_schema!(schemas, HeadlessContinueOnceResult);
    insert_method_type_schema!(schemas, HeadlessRunAdvanceParams);
    insert_method_type_schema!(schemas, HeadlessRunAdvanceResult);
    insert_method_type_schema!(schemas, HeadlessRunDriveParams);
    insert_method_type_schema!(schemas, HeadlessRunDriveResult);
    insert_method_type_schema!(schemas, HeadlessRunRecoveryProbeParams);
    insert_method_type_schema!(schemas, HeadlessRunRecoveryProbeResult);
    insert_method_type_schema!(schemas, LlmHealthParams);
    insert_method_type_schema!(schemas, LlmHealthResult);
    insert_method_type_schema!(schemas, LlmStatusResult);
    insert_method_type_schema!(schemas, McpToolApprovalApproveParams);
    insert_method_type_schema!(schemas, McpToolApprovalApproveResult);
    insert_method_type_schema!(schemas, ModeGetParams);
    insert_method_type_schema!(schemas, ModeListResult);
    insert_method_type_schema!(schemas, ModePackActivateParams);
    insert_method_type_schema!(schemas, ModePackActivateResult);
    insert_method_type_schema!(schemas, ModePackApproveCandidateParams);
    insert_method_type_schema!(schemas, ModePackApproveCandidateResult);
    insert_method_type_schema!(schemas, ModePackFetchCandidateParams);
    insert_method_type_schema!(schemas, ModePackFetchCandidateResult);
    insert_method_type_schema!(schemas, ModePackReplaceActiveParams);
    insert_method_type_schema!(schemas, ModePackReplaceActiveResult);
    insert_method_type_schema!(schemas, ModePackRevokeSignerParams);
    insert_method_type_schema!(schemas, ModePackRevokeSignerResult);
    insert_method_type_schema!(schemas, ModePackRollbackActiveParams);
    insert_method_type_schema!(schemas, ModePackRollbackActiveResult);
    insert_method_type_schema!(schemas, ModePackSelectRegistryUpdateParams);
    insert_method_type_schema!(schemas, ModePackSelectRegistryUpdateResult);
    insert_method_type_schema!(schemas, ModePackTrustSignerParams);
    insert_method_type_schema!(schemas, ModePackTrustSignerResult);
    insert_method_type_schema!(schemas, ModePackVerifyCandidateProvenanceParams);
    insert_method_type_schema!(schemas, ModePackVerifyCandidateProvenanceResult);
    insert_method_type_schema!(schemas, ModeSummary);
    insert_method_type_schema!(schemas, PermissionCheckParams);
    insert_method_type_schema!(schemas, PermissionCheckResult);
    insert_method_type_schema!(schemas, ProposalApplyCapabilityParams);
    insert_method_type_schema!(schemas, ProposalApplyCapabilityResult);
    insert_method_type_schema!(schemas, ProposalApplyDryRunHistoryParams);
    insert_method_type_schema!(schemas, ProposalApplyDryRunHistoryResult);
    insert_method_type_schema!(schemas, ProposalApplyDryRunParams);
    insert_method_type_schema!(schemas, ProposalApplyDryRunResult);
    insert_method_type_schema!(schemas, ProposalApplyParams);
    insert_method_type_schema!(schemas, ProposalApplyResult);
    insert_method_type_schema!(schemas, ProposalApproveParams);
    insert_method_type_schema!(schemas, ProposalApproveResult);
    insert_method_type_schema!(schemas, ProposalAuditTrailParams);
    insert_method_type_schema!(schemas, ProposalAuditTrailResult);
    insert_method_type_schema!(schemas, ProposalInspectParams);
    insert_method_type_schema!(schemas, ProposalInspectResult);
    insert_method_type_schema!(schemas, ProposalListParams);
    insert_method_type_schema!(schemas, ProposalListResult);
    insert_method_type_schema!(schemas, ProposalPreflightParams);
    insert_method_type_schema!(schemas, ProposalPreflightResult);
    insert_method_type_schema!(schemas, ProposalReadinessParams);
    insert_method_type_schema!(schemas, ProposalReadinessResult);
    insert_method_type_schema!(schemas, ProposalRejectParams);
    insert_method_type_schema!(schemas, ProposalRejectResult);
    insert_method_type_schema!(schemas, ProposalReviewBundleParams);
    insert_method_type_schema!(schemas, ProposalReviewBundleResult);
    insert_method_type_schema!(schemas, ProposalReviewQueueParams);
    insert_method_type_schema!(schemas, ProposalReviewQueueResult);
    insert_method_type_schema!(schemas, ProposalReviewReportParams);
    insert_method_type_schema!(schemas, ProposalReviewReportResult);
    insert_method_type_schema!(schemas, ProposalReviewVerdictParams);
    insert_method_type_schema!(schemas, ProposalReviewVerdictResult);
    insert_method_type_schema!(schemas, RunEventsParams);
    insert_method_type_schema!(schemas, RunEventsResult);
    insert_method_type_schema!(schemas, RunInspectParams);
    insert_method_type_schema!(schemas, RunInspectResult);
    insert_method_type_schema!(schemas, RuntimeConfigGetResult);
    insert_method_type_schema!(schemas, RuntimeDiagnosticsResult);
    insert_method_type_schema!(schemas, RuntimeStatus);
    insert_method_type_schema!(schemas, TaskCancelParams);
    insert_method_type_schema!(schemas, TaskCancelResult);
    insert_method_type_schema!(schemas, TaskGetParams);
    insert_method_type_schema!(schemas, TaskInspectParams);
    insert_method_type_schema!(schemas, TaskInspectResult);
    insert_method_type_schema!(schemas, TaskListParams);
    insert_method_type_schema!(schemas, TaskListResult);
    insert_method_type_schema!(schemas, TaskRecord);
    insert_method_type_schema!(schemas, TaskRunParams);
    insert_method_type_schema!(schemas, TaskRunResult);
    insert_method_type_schema!(schemas, TaskStartParams);
    insert_method_type_schema!(schemas, TaskStartResult);
    insert_method_type_schema!(schemas, ToolExecuteParams);
    insert_method_type_schema!(schemas, ToolExecuteResult);
    insert_method_type_schema!(schemas, ToolIntentParseParams);
    insert_method_type_schema!(schemas, ToolIntentParseResult);
    insert_method_type_schema!(schemas, ToolListResult);
    insert_method_type_schema!(schemas, ToolPlanParams);
    insert_method_type_schema!(schemas, ToolPlanResult);
    schemas
}

fn method_type_names() -> BTreeSet<String> {
    METHOD_SPECS
        .iter()
        .flat_map(|spec| [spec.param_type, Some(spec.result_type)])
        .flatten()
        .map(str::to_string)
        .collect()
}

fn insert_type_schema<T: JsonSchema>(schemas: &mut BTreeMap<String, Value>, name: &str) {
    schemas.insert(name.to_string(), normalized_json_schema::<T>());
}

fn normalized_json_schema<T: JsonSchema>() -> Value {
    let mut value = serde_json::to_value(schema_for!(T)).expect("serialize JSON Schema");
    normalize_json_schema_refs(&mut value);
    value
}

fn normalize_json_schema_refs(value: &mut Value) {
    match value {
        Value::Object(object) => {
            if let Some(definitions) = object.remove("definitions") {
                object.insert("$defs".to_string(), definitions);
            }
            for nested in object.values_mut() {
                normalize_json_schema_refs(nested);
            }
        }
        Value::Array(values) => {
            for nested in values {
                normalize_json_schema_refs(nested);
            }
        }
        Value::String(value) => {
            if let Some(rest) = value.strip_prefix("#/definitions/") {
                *value = format!("#/$defs/{rest}");
            }
        }
        _ => {}
    }
}

fn type_schema_fingerprint(type_schemas: &BTreeMap<String, Value>, type_name: &str) -> String {
    let schema = type_schemas
        .get(type_name)
        .unwrap_or_else(|| panic!("missing recursive JSON Schema for {type_name}"));
    stable_fingerprint(&canonical_json(schema))
}

fn struct_schema_json(schema: &StructSchema) -> Value {
    json!({
        "type": schema.name,
        "deny_unknown_fields": schema.deny_unknown_fields,
        "required_fields": required_field_names(schema),
        "optional_fields": optional_field_names(schema),
        "nullable_fields": schema.fields.iter().filter(|field| field.nullable).map(|field| field.name.clone()).collect::<Vec<_>>(),
        "fields": schema.fields.iter().map(field_schema_json).collect::<Vec<_>>(),
        "field_shape_fingerprint": stable_fingerprint(&schema
            .fields
            .iter()
            .map(|field| format!("{}:{}:{}:{}", field.name, field.rust_type, field.required, field.nullable))
            .collect::<Vec<_>>()
            .join("|"))
    })
}

fn field_schema_json(field: &FieldSchema) -> Value {
    json!({
        "name": field.name,
        "rust_type": field.rust_type,
        "required": field.required,
        "nullable": field.nullable,
        "repeated": field.repeated,
        "semantic_type": field.semantic_type
    })
}

fn enum_contract_json(schema: &EnumSchema) -> Value {
    json!({
        "type": schema.name,
        "values": schema.values,
        "serde_policy": schema.serde_policy,
        "unknown_variant_policy": "reject"
    })
}

fn required_field_names(schema: &StructSchema) -> Vec<String> {
    schema
        .fields
        .iter()
        .filter(|field| field.required)
        .map(|field| field.name.clone())
        .collect()
}

fn optional_field_names(schema: &StructSchema) -> Vec<String> {
    schema
        .fields
        .iter()
        .filter(|field| !field.required)
        .map(|field| field.name.clone())
        .collect()
}

fn golden_fixtures() -> Value {
    let task_completed_payload = json!({"status": "Completed"});
    let task_completed_payload_schema_fingerprint =
        ledger_payload_schema_fingerprint("TaskCompleted");
    let task_completed_payload_instance_shape_fingerprint =
        ledger_payload_instance_shape_fingerprint_for_value(
            "TaskCompleted",
            &task_completed_payload,
        );
    json!({
        "task_start_vsix_client_input": {
            "goal": "ship bounded release evidence",
            "modeId": "orchestrator"
        },
        "task_start_wire_params": {
            "goal": "ship bounded release evidence",
            "mode_id": "orchestrator"
        },
        "task_start_result": {
            "task_id": "task_1",
            "run_id": "run_1",
            "status": "Created"
        },
        "task_cancel_params": {
            "task_id": "task_1",
            "run_id": "run_1",
            "expected_status": "Running",
            "expected_task_updated_at": "2026-09-03T00:00:00Z",
            "cancel_id": "cancel_1",
            "authorize_cancel": true
        },
        "task_cancel_result": {
            "task_id": "task_1",
            "run_id": "run_1",
            "status": "Cancelled",
            "replayed": false,
            "cancel_id": "cancel_1",
            "cancel_fingerprint": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "ledger_event_kind": "TaskCancelled",
            "next_action": "inspect_cancelled_task"
        },
        "task_run_minimal_params": {
            "task_id": "task_1"
        },
        "task_run_explicit_null_params": {
            "task_id": "task_1",
            "selected_index_context": null,
            "verification_recovery_context_read": null,
            "context_budget": null,
            "completion_acceptance": null
        },
        "run_events_params": {
            "run_id": "run_1"
        },
        "ledger_event_summary": {
            "event_id": "evt_1",
            "task_id": "task_1",
            "run_id": "run_1",
            "kind": "TaskCancelled",
            "timestamp": "2026-09-03T00:00:00Z",
            "payload": null
        },
        "ledger_event_with_payload_envelope": {
            "event_id": "evt_2",
            "task_id": "task_1",
            "run_id": "run_1",
            "kind": "TaskCompleted",
            "timestamp": "2026-09-03T00:00:01Z",
            "payload": task_completed_payload,
            "payload_envelope": {
                "schema_version": LEDGER_PAYLOAD_SCHEMA_VERSION,
                "shape_id": ledger_payload_schema_id("TaskCompleted"),
                "shape_fingerprint": task_completed_payload_schema_fingerprint,
                "schema_id": ledger_payload_schema_id("TaskCompleted"),
                "schema_fingerprint": task_completed_payload_schema_fingerprint,
                "instance_shape_fingerprint": task_completed_payload_instance_shape_fingerprint
            }
        },
        "task_status_values": ["Created", "Queued", "Running", "Completed", "Failed", "Cancelled"]
    })
}

fn parse_public_struct_schemas(source: &str) -> BTreeMap<String, StructSchema> {
    let mut schemas = BTreeMap::new();
    let lines = source.lines().collect::<Vec<_>>();
    let mut index = 0;
    let mut attrs = Vec::new();
    while index < lines.len() {
        let trimmed = lines[index].trim();
        if trimmed.starts_with("#[") {
            attrs.push(trimmed.to_string());
            index += 1;
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("pub struct ") {
            let name = rest
                .split(|ch: char| ch == '{' || ch.is_whitespace())
                .next()
                .unwrap_or_default()
                .to_string();
            let struct_attrs = attrs.clone();
            attrs.clear();
            let mut body = Vec::new();
            let mut depth = brace_delta(trimmed);
            index += 1;
            while index < lines.len() && depth > 0 {
                let line = lines[index];
                depth += brace_delta(line);
                if depth > 0 {
                    body.push(line.to_string());
                }
                index += 1;
            }
            schemas.insert(
                name.clone(),
                StructSchema {
                    name,
                    deny_unknown_fields: struct_attrs
                        .iter()
                        .any(|attr| attr.contains("deny_unknown_fields")),
                    fields: parse_struct_fields(&body),
                },
            );
            continue;
        }
        if !trimmed.is_empty() {
            attrs.clear();
        }
        index += 1;
    }
    schemas
}

fn parse_struct_fields(lines: &[String]) -> Vec<FieldSchema> {
    let mut fields = Vec::new();
    let mut attrs = Vec::new();
    let mut index = 0;
    while index < lines.len() {
        let trimmed = lines[index].trim();
        if trimmed.starts_with("#[") {
            attrs.push(trimmed.to_string());
            index += 1;
            continue;
        }
        if trimmed.starts_with("pub ") {
            let mut declaration = trimmed.to_string();
            index += 1;
            while !declaration.trim_end().ends_with(',') && index < lines.len() {
                declaration.push(' ');
                declaration.push_str(lines[index].trim());
                index += 1;
            }
            if let Some(field) = parse_field_declaration(&declaration, &attrs) {
                fields.push(field);
            }
            attrs.clear();
            continue;
        }
        if !trimmed.is_empty() {
            attrs.clear();
        }
        index += 1;
    }
    fields
}

fn parse_field_declaration(declaration: &str, attrs: &[String]) -> Option<FieldSchema> {
    let declaration = declaration
        .trim()
        .trim_end_matches(',')
        .strip_prefix("pub ")?;
    let (field_name, rust_type) = declaration.split_once(':')?;
    let name = serde_rename(attrs).unwrap_or_else(|| field_name.trim().to_string());
    let rust_type = rust_type.trim().to_string();
    let nullable = rust_type.starts_with("Option<");
    let repeated = rust_type.starts_with("Vec<") || rust_type.contains("Vec<");
    let has_default = attrs.iter().any(|attr| attr.contains("default"));
    Some(FieldSchema {
        name,
        rust_type: rust_type.clone(),
        required: !nullable && !has_default,
        nullable,
        repeated,
        semantic_type: semantic_type(&rust_type),
    })
}

fn parse_public_enum_schemas(source: &str) -> BTreeMap<String, EnumSchema> {
    let mut schemas = BTreeMap::new();
    let lines = source.lines().collect::<Vec<_>>();
    let mut index = 0;
    let mut attrs = Vec::new();
    while index < lines.len() {
        let trimmed = lines[index].trim();
        if trimmed.starts_with("#[") {
            attrs.push(trimmed.to_string());
            index += 1;
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("pub enum ") {
            let name = rest
                .split(|ch: char| ch == '{' || ch.is_whitespace())
                .next()
                .unwrap_or_default()
                .to_string();
            let rename_snake = attrs
                .iter()
                .any(|attr| attr.contains("rename_all = \"snake_case\""));
            attrs.clear();
            let mut body = Vec::new();
            let mut depth = brace_delta(trimmed);
            index += 1;
            while index < lines.len() && depth > 0 {
                let line = lines[index];
                depth += brace_delta(line);
                if depth > 0 {
                    body.push(line.to_string());
                }
                index += 1;
            }
            let values = body
                .iter()
                .filter_map(|line| {
                    let token = line
                        .split("//")
                        .next()
                        .unwrap_or_default()
                        .trim()
                        .trim_end_matches(',');
                    if token.chars().next().is_some_and(char::is_uppercase)
                        && token
                            .chars()
                            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
                    {
                        Some(if rename_snake {
                            to_snake_case(token)
                        } else {
                            token.to_string()
                        })
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>();
            schemas.insert(
                name.clone(),
                EnumSchema {
                    name,
                    values,
                    serde_policy: if rename_snake {
                        "rename_all_snake_case".to_string()
                    } else {
                        "variant_names".to_string()
                    },
                },
            );
            continue;
        }
        if !trimmed.is_empty() {
            attrs.clear();
        }
        index += 1;
    }
    schemas
}

fn parse_public_enum_values(source: &str, enum_name: &str, rename_snake: bool) -> Vec<String> {
    let Some(start) = source.find(&format!("pub enum {enum_name}")) else {
        return Vec::new();
    };
    let Some(open_offset) = source[start..].find('{') else {
        return Vec::new();
    };
    let body_start = start + open_offset + 1;
    let mut depth = 1i32;
    let mut end = body_start;
    for (offset, ch) in source[body_start..].char_indices() {
        match ch {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    end = body_start + offset;
                    break;
                }
            }
            _ => {}
        }
    }
    source[body_start..end]
        .lines()
        .filter_map(|line| {
            let token = line
                .split("//")
                .next()
                .unwrap_or_default()
                .trim()
                .trim_end_matches(',');
            if token.chars().next().is_some_and(char::is_uppercase)
                && token
                    .chars()
                    .all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
            {
                Some(if rename_snake {
                    to_snake_case(token)
                } else {
                    token.to_string()
                })
            } else {
                None
            }
        })
        .collect()
}

fn brace_delta(line: &str) -> i32 {
    line.chars()
        .map(|ch| match ch {
            '{' => 1,
            '}' => -1,
            _ => 0,
        })
        .sum()
}

fn serde_rename(attrs: &[String]) -> Option<String> {
    for attr in attrs {
        if let Some(index) = attr.find("rename = \"") {
            let rest = &attr[index + "rename = \"".len()..];
            if let Some(end) = rest.find('"') {
                return Some(rest[..end].to_string());
            }
        }
    }
    None
}

fn semantic_type(rust_type: &str) -> String {
    let inner = rust_type
        .strip_prefix("Option<")
        .and_then(|value| value.strip_suffix('>'))
        .unwrap_or(rust_type)
        .trim();
    if inner == "String" || inner == "&str" {
        "string".to_string()
    } else if inner == "bool" {
        "boolean".to_string()
    } else if matches!(
        inner,
        "usize" | "u64" | "u32" | "u16" | "u8" | "i64" | "i32"
    ) {
        "integer".to_string()
    } else if inner.starts_with("Vec<") {
        "array".to_string()
    } else if inner == "serde_json::Value" || inner == "Value" {
        "json_value".to_string()
    } else {
        "object_or_enum_ref".to_string()
    }
}

fn to_snake_case(value: &str) -> String {
    let mut out = String::new();
    for (index, ch) in value.chars().enumerate() {
        if ch.is_ascii_uppercase() {
            if index > 0 {
                out.push('_');
            }
            out.push(ch.to_ascii_lowercase());
        } else {
            out.push(ch);
        }
    }
    out
}

fn stable_fingerprint(input: &str) -> String {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in input.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("shape-fnv1a64:{hash:016x}")
}

fn canonical_json(value: &Value) -> String {
    serde_json::to_string(&canonical_value(value)).expect("serialize canonical JSON")
}

fn canonical_value(value: &Value) -> Value {
    match value {
        Value::Object(object) => Value::Object(
            object
                .iter()
                .map(|(key, value)| (key.clone(), canonical_value(value)))
                .collect(),
        ),
        Value::Array(values) => Value::Array(values.iter().map(canonical_value).collect()),
        _ => value.clone(),
    }
}

const LEDGER_PAYLOAD_SCHEMA_VERSION: u64 = 11;

fn ledger_payload_schema_id(kind: &str) -> String {
    format!("ledger_payload.{kind}.v{LEDGER_PAYLOAD_SCHEMA_VERSION}")
}

fn ledger_payload_schema_fingerprint(kind: &str) -> String {
    stable_fingerprint(&format!(
        "{kind}:payload_schema_v{LEDGER_PAYLOAD_SCHEMA_VERSION}:descriptor:{}",
        ledger_payload_schema_descriptor(kind)
    ))
}

fn ledger_payload_schema_classification(kind: &str) -> &'static str {
    match kind {
        "TaskCompleted"
        | "TaskFailed"
        | "TaskCancelled"
        | "PermissionChecked"
        | "PermissionDenied"
        | "ToolPlanned"
        | "ToolPermissionChecked"
        | "ToolPlanApproved"
        | "ToolPlanDenied"
        | "ToolIntentParsed"
        | "ToolIntentRejected"
        | "ToolIntentPermissionChecked"
        | "ToolIntentApproved"
        | "ToolIntentDenied"
        | "ToolExecutionRequested"
        | "McpToolExecutionApproved"
        | "ToolExecutionPermissionChecked"
        | "ToolExecutionCompleted"
        | "ToolExecutionDenied"
        | "ToolExecutionFailed"
        | "CodebaseIndexPermissionChecked"
        | "CodebaseIndexSnapshotBuilt"
        | "CodebaseIndexQueryCompleted"
        | "CodebaseIndexSelectionReadCompleted"
        | "CodebaseIndexPromptContextMaterialized"
        | "VerificationRecoveryContextReadMaterialized"
        | "AgentLoopStarted"
        | "AgentLoopCompleted"
        | "TaskCompletionAccepted"
        | "PromptBuilt"
        | "PromptSensitiveScanCompleted"
        | "PromptSensitiveScanFailed"
        | "LlmRequestCreated"
        | "LlmRequestFailed"
        | "LlmResponseReceived"
        | "SecondPassPromptBuilt"
        | "SecondPassLlmRequestCreated"
        | "SecondPassLlmRequestFailed"
        | "SecondPassLlmResponseReceived"
        | "TaskStarted"
        | "TaskRunning"
        | "ModeResolved"
        | "ExternalModePackChildProvenanceDenied"
        | "ExternalModePackTaskProvenanceDenied"
        | "SubtaskOrchestrationQueued"
        | "SubtaskHandoffPrepared"
        | "SubtaskSchedulerReadinessRecorded"
        | "SubtaskDispatchPlanPrepared"
        | "SubtaskDispatchContractPrepared"
        | "SubtaskDispatchAdmissionEvaluated"
        | "SubtaskDispatchReadinessSnapshotRecorded"
        | "SubtaskDispatcherGuardVerdictRecorded"
        | "SubtaskDispatchDecisionRecorded"
        | "SubtaskDispatchCandidateManifestRecorded"
        | "SubtaskDispatchHandoffEnvelopeRecorded"
        | "ParentJoinContinuationFingerprintConsumed" => "strict_typed",
        _ => "versioned_open",
    }
}

fn ledger_payload_schema_contract_status(classification: &str) -> &'static str {
    match classification {
        "payload_absent" | "strict_typed" => "closed",
        "typed_known_fields_open" | "versioned_open" => "partial",
        "legacy_compatibility_only" => "legacy_only",
        _ => "unknown",
    }
}

fn ledger_payload_schema_release_blocking(classification: &str) -> bool {
    matches!(classification, "typed_known_fields_open" | "versioned_open")
}

fn ledger_payload_schema_descriptor(kind: &str) -> String {
    match kind {
        "TaskCompleted" => terminal_task_payload_schema_descriptor("Completed"),
        "TaskFailed" => terminal_task_payload_schema_descriptor("Failed"),
        "TaskCancelled" => terminal_task_payload_schema_descriptor("Cancelled"),
        "PermissionChecked" | "PermissionDenied" => permission_payload_schema_descriptor(),
        "ToolPlanned" => tool_planned_payload_schema_descriptor(),
        "ToolPermissionChecked" | "ToolPlanApproved" | "ToolPlanDenied" => {
            tool_plan_payload_schema_descriptor()
        }
        "ToolIntentParsed" => tool_intent_parsed_payload_schema_descriptor(),
        "ToolIntentRejected" => tool_intent_rejected_payload_schema_descriptor(),
        "ToolIntentPermissionChecked" | "ToolIntentApproved" | "ToolIntentDenied" => {
            tool_intent_payload_schema_descriptor()
        }
        "ToolExecutionRequested" => tool_execution_requested_payload_schema_descriptor(),
        "McpToolExecutionApproved" => mcp_tool_execution_approved_payload_schema_descriptor(),
        "ToolExecutionPermissionChecked" => tool_execution_permission_payload_schema_descriptor(),
        "ToolExecutionCompleted" => tool_execution_terminal_payload_schema_descriptor("Completed"),
        "ToolExecutionDenied" => tool_execution_terminal_payload_schema_descriptor("Denied"),
        "ToolExecutionFailed" => tool_execution_terminal_payload_schema_descriptor("Failed"),
        "CodebaseIndexPermissionChecked" => codebase_index_permission_payload_schema_descriptor(),
        "CodebaseIndexSnapshotBuilt" => codebase_index_snapshot_built_payload_schema_descriptor(),
        "CodebaseIndexQueryCompleted" => codebase_index_query_completed_payload_schema_descriptor(),
        "CodebaseIndexSelectionReadCompleted" => {
            codebase_index_selection_read_completed_payload_schema_descriptor()
        }
        "CodebaseIndexPromptContextMaterialized" => {
            codebase_index_prompt_context_materialized_payload_schema_descriptor()
        }
        "VerificationRecoveryContextReadMaterialized" => {
            verification_recovery_context_read_payload_schema_descriptor()
        }
        "AgentLoopStarted" => agent_loop_started_payload_schema_descriptor(),
        "AgentLoopCompleted" => agent_loop_completed_payload_schema_descriptor(),
        "TaskCompletionAccepted" => task_completion_accepted_payload_schema_descriptor(),
        "PromptBuilt" | "SecondPassPromptBuilt" => prompt_built_payload_schema_descriptor(),
        "PromptSensitiveScanCompleted" | "PromptSensitiveScanFailed" => {
            prompt_sensitive_scan_payload_schema_descriptor()
        }
        "LlmRequestCreated" | "SecondPassLlmRequestCreated" => {
            llm_request_created_payload_schema_descriptor()
        }
        "LlmRequestFailed" | "SecondPassLlmRequestFailed" => {
            llm_request_failed_payload_schema_descriptor()
        }
        "LlmResponseReceived" | "SecondPassLlmResponseReceived" => {
            llm_response_received_payload_schema_descriptor()
        }
        "TaskStarted" => task_started_payload_schema_descriptor(),
        "TaskRunning" => task_running_payload_schema_descriptor(),
        "ModeResolved" => mode_resolved_payload_schema_descriptor(),
        "ExternalModePackChildProvenanceDenied" => {
            external_modepack_child_denied_payload_schema_descriptor()
        }
        "ExternalModePackTaskProvenanceDenied" => {
            external_modepack_task_denied_payload_schema_descriptor()
        }
        "SubtaskOrchestrationQueued" => subtask_orchestration_queued_payload_schema_descriptor(),
        "SubtaskHandoffPrepared" => subtask_handoff_prepared_payload_schema_descriptor(),
        "SubtaskSchedulerReadinessRecorded" => {
            subtask_scheduler_readiness_payload_schema_descriptor()
        }
        "SubtaskDispatchPlanPrepared" => subtask_dispatch_plan_payload_schema_descriptor(),
        "SubtaskDispatchContractPrepared" => subtask_dispatch_contract_payload_schema_descriptor(),
        "SubtaskDispatchAdmissionEvaluated" => subtask_dispatch_admission_payload_schema_descriptor(),
        "SubtaskDispatchReadinessSnapshotRecorded" => {
            subtask_dispatch_readiness_snapshot_payload_schema_descriptor()
        }
        "SubtaskDispatcherGuardVerdictRecorded" => {
            subtask_dispatcher_guard_verdict_payload_schema_descriptor()
        }
        "SubtaskDispatchDecisionRecorded" => subtask_dispatch_decision_payload_schema_descriptor(),
        "SubtaskDispatchCandidateManifestRecorded" => {
            subtask_dispatch_candidate_manifest_payload_schema_descriptor()
        }
        "SubtaskDispatchHandoffEnvelopeRecorded" => {
            subtask_dispatch_handoff_envelope_payload_schema_descriptor()
        }
        "ParentJoinContinuationFingerprintConsumed" => {
            parent_join_continuation_consumed_payload_schema_descriptor()
        }
        _ => "versioned_open{schema_contract:event-kind-versioned-payload;typed_schema_required_before_release:true}".to_string(),
    }
}

fn terminal_task_payload_schema_descriptor(status: &str) -> String {
    format!(
        "strict_typed{{payload_optional:true;known_optional_fields:apply_enabled:boolean,bounded_cargo_diagnostics:array,caller_authorized:boolean,cancel_fingerprint:string,cancel_id:string,cancel_status:string,completion_evidence:object,expected_task_updated_at:string,failed_verifier_count:u64,failed_verifier_tool_ids:array<string>,failure_fingerprint:string,failure_reason:string,failure_reasons:array<string>,git:object,late_tool_response:boolean,mcp:object,missing_verifier_tool_ids:array<string>,next_action:string,passed_verifier_count:u64,passed_verifier_tool_ids:array<string>,previous_status:string,proposal_count:u64,proposal_id:string,reason:string,recovery_run_id:string,recovery_task_id:string,request_fingerprint_version:string,required_verifier_count:u64,required_verifier_tool_ids:array<string>,requirement_fingerprint:string,run_id:string,runtime_deadline:object,source_apply_id:string,source_run_id:string,source_task_id:string,status:string,task_id:string,terminal_evidence:boolean,terminal_process_loss:boolean,terminal_race_candidate:string,verification_completion_gate_status:string,verification_recovery_repair:boolean,verification_recovery_repair_gate_status:string,verification_requirement_fingerprint:string,verification_requirement_id:string,verification_requirement_source_kind:string;known_field_required:true;additional_fields:false;terminal_status:{status}}}"
    )
}

fn permission_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:allowed:boolean,mode_id:string,reason:string;one_of_required:action:string|required_action:string;known_optional_fields:action:string,apply_id:string,operation:string,path:string,proposal_id:string,required_action:string,scope:string,tool_id:string,workspace_write_scope_count:u64;additional_fields:false;permission_decision_payload:true}".to_string()
}

fn tool_plan_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:allowed:boolean,reason:string,required_action:string,tool_id:string;additional_fields:false;tool_plan_decision_payload:true}".to_string()
}

fn tool_planned_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:tool_ids:array<string>;additional_fields:false;tool_planned_inventory_payload:true}".to_string()
}

fn tool_intent_parsed_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:parser:object,tool_ids:array<string>;additional_fields:false;tool_intent_parsed_payload:true}".to_string()
}

fn tool_intent_rejected_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:code:string,reason:string,tool_id:string;additional_fields:false;tool_intent_rejected_payload:true}".to_string()
}

fn tool_intent_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:allowed:boolean,input_summary:object,reason:string,request_reason:string,required_action:string,tool_id:string;known_optional_fields:mode_id:string,requested_mode_id:string,source_apply_id:string,source_run_id:string,source_task_id:string,verification_recovery_retry:boolean,verification_requirement_fingerprint:string,verification_requirement_id:string,verification_requirement_source_kind:string;additional_fields:false;tool_intent_decision_payload:true}".to_string()
}

fn tool_execution_requested_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:input_summary:object,tool_id:string;known_optional_fields:request_fingerprint:string,source_apply_id:string,verification_recovery_retry:boolean,verification_requirement_fingerprint:string,verification_requirement_id:string,verification_requirement_source_kind:string;additional_fields:false;tool_execution_request_payload:true}".to_string()
}

fn tool_execution_permission_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:allowed:boolean,reason:string,required_action:string,tool_id:string;known_optional_fields:mcp_safety_policy:object_or_null,request_fingerprint:string,server_id:string,source_apply_id:string,tool_name:string,verification_recovery_retry:boolean,verification_requirement_fingerprint:string,verification_requirement_id:string,verification_requirement_source_kind:string;additional_fields:false;tool_execution_permission_payload:true}".to_string()
}

fn mcp_tool_execution_approved_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:approval_fingerprint:string,approval_schema_version:u64,approval_state_fingerprint:string,catalog_provenance:object,mcp_safety_policy:object_or_null,request_fingerprint:string,run_id:string,server_id:string,status:string,task_id:string,tool_id:string,tool_name:string;known_optional_fields:approval_id_fingerprint:string,outcome:string,outcome_fingerprint:string,recovery_fingerprint:string,recovery_reason:string,recovery_source_state_fingerprint:string;additional_fields:false;mcp_tool_execution_approval_payload:true}".to_string()
}

fn tool_execution_terminal_payload_schema_descriptor(status: &str) -> String {
    let required_fields = match status {
        "Completed" => "required_fields:status:string,tool_id:string",
        _ => "required_fields:reason:string,status:string,tool_id:string",
    };
    format!(
        "strict_typed{{payload_optional:false;{required_fields};known_optional_fields:absolute_paths_redacted:boolean,ambient_index_ignored:boolean,authorized_change_set_fingerprint:string,authorized_path_count:u64,bounded_cargo_diagnostics:array,bytes_read:u64,captured_bytes:u64,cargo_dependency_fetch_offline:boolean,catalog_provenance:object,check_id:string,cleanup_succeeded:boolean,commit_id:string,committed_tree_fingerprint:string,compile_time_code_sandboxed:boolean,duration_ms:u64,exit_code:integer_or_null,expected_parent_head:string,failed_git_operation:string,git:object,git_environment_hardened:boolean,git_optional_locks_disabled:boolean,git_process_count:u64,git_processes_bounded:boolean,git_prompts_disabled:boolean,line_count:u64,logical_invocation_fingerprint:string,mcp:object,mcp_approval_binding:object,mcp_safety_policy:object_or_null,message_fingerprint:string,mutation_process_launched:boolean,operation:string,os_network_isolated:boolean,output_oversized:boolean,output_preview:string,output_redacted:boolean,output_truncated:boolean,process_launched:boolean,process_tree_kill_attempted:boolean,process_tree_kill_reason:string,process_tree_kill_succeeded:boolean,process_tree_timeout_supported:boolean,raw_diff_redacted:boolean,raw_file_content_redacted:boolean,raw_message_redacted:boolean,reason:string,reader_thread_joined:boolean,replayed:boolean,repository_hooks_bypassed:boolean,runtime_authorization_required:boolean,source_apply_id:string,standard_error_bytes:u64,standard_error_truncated:boolean,standard_output_bytes:u64,standard_output_truncated:boolean,target_dir_isolated:boolean,temporary_index_cleaned:boolean,test_code_executed:boolean,timed_out:boolean,truncated:boolean,trusted_workspace_required:boolean,used_git_plumbing:boolean,used_temporary_index:boolean,verification_recovery_retry:boolean,verification_requirement_fingerprint:string,verification_requirement_id:string,verification_requirement_source_kind:string,verification_status:string,workspace_write_scope_fingerprint:string;additional_fields:false;tool_execution_terminal_payload:true;terminal_status:{status}}}"
    )
}

fn codebase_index_permission_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:action:string,allowed:boolean,mode_id:string,reason:string;known_optional_fields:entry_count:u64,file_kind_filter:string,index_id:string,max_results:u64,query_fingerprint:string,query_id:string,query_length_chars:u64,query_token_count:u64,request_kind:string,requested_force_refresh:boolean,requested_root_present:boolean,selection_fingerprint:string,selection_id:string,snapshot_fingerprint:string,workspace_fingerprint:string;additional_fields:false;codebase_index_permission_payload:true;action:IndexCodebase}".to_string()
}

fn codebase_index_snapshot_built_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:built_at:string,ignore_rule_count:u64,ignore_rule_files_loaded:u64,index_id:string,indexed_files:u64,max_directories:u64,max_directory_entries:u64,max_file_bytes:u64,max_files:u64,max_path_chars:u64,max_visited_entries:u64,mode_id:string,next_action:string,requested_force_refresh:boolean,root:string,sensitive_finding_count:u64,skipped_binary_like:u64,skipped_ignored:u64,skipped_other:u64,skipped_protected:u64,skipped_sensitive:u64,skipped_symlink:u64,skipped_too_large:u64,skipped_unreadable:u64,skipped_unsafe_path:u64,snapshot_fingerprint:string,truncated:boolean,truncated_directories:u64,truncated_entries:u64,visited_entries:u64,walked_directories:u64,workspace_fingerprint:string;additional_fields:false;codebase_index_snapshot_payload:true;next_action:build_bounded_index_query_file_selection}".to_string()
}

fn codebase_index_query_completed_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:file_kind_filter:string,index_id:string,match_reason_counts:object,matched_entry_count:u64,max_results:u64,mode_id:string,next_action:string,query_fingerprint:string,query_id:string,returned_entry_count:u64,selection_fingerprint:string,selection_id:string,skipped_entry_count:u64,snapshot_fingerprint:string,snapshot_truncated:boolean,workspace_fingerprint:string;additional_fields:false;codebase_index_query_payload:true;next_action:read_selected_files_with_controlled_workspace_read}".to_string()
}

fn codebase_index_selection_read_completed_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:byte_length:u64,bytes_read:u64,content_hash_verified:boolean,content_sha256:string,entry_count:u64,file_kind:string,file_kind_filter:string,index_id:string,max_results:u64,mode_id:string,next_action:string,query_fingerprint:string,query_id:string,read_path_fingerprint:string,selection_fingerprint:string,selection_id:string,snapshot_fingerprint:string,snapshot_truncated:boolean,tool_id:string,truncated:boolean,workspace_fingerprint:string;additional_fields:false;codebase_index_selection_read_payload:true;tool_id:codebase.index.selection.read;content_hash_verified:true;next_action:use_selected_file_context_for_prompt_materialization}".to_string()
}

fn codebase_index_prompt_context_materialized_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:bytes_read:u64,content_char_count:u64,content_hash_verified:boolean,content_sha256:string,file_kind:string,index_id:string,mode_id:string,next_action:string,prompt_context_id:string,prompt_preview_redacted:boolean,query_fingerprint:string,query_id:string,read_path_fingerprint:string,run_id:string,selection_fingerprint:string,selection_id:string,snapshot_fingerprint:string,source_event_id:string,source_event_kind:string,task_id:string,workspace_fingerprint:string;additional_fields:false;codebase_index_prompt_context_payload:true;source_event_kind:CodebaseIndexSelectionReadCompleted;content_hash_verified:true;prompt_preview_redacted:true;next_action:continue_task_execution_with_materialized_context}".to_string()
}

fn verification_recovery_context_read_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:check_id:string,column:u64_or_null,context_read_id:string,diagnostic_index:u64,diagnostic_kind:string,excerpt_bytes:u64,excerpt_end_line:u64,excerpt_sha256:string,excerpt_start_line:u64,excerpt_truncated:boolean,failure_fingerprint:string,line:u64_or_null,mode_id:string,next_action:string,prompt_preview_redacted:boolean,read_path_fingerprint:string,recovery_run_id:string,recovery_task_id:string,required_action:string,severity:string,source_run_id:string,source_task_id:string,test_name_hash:string_or_null,tool_id:string,verification_recovery_context_read:boolean;additional_fields:false;verification_recovery_context_read_payload:true;required_action:ReadWorkspace;verification_recovery_context_read:true;prompt_preview_redacted:true;next_action:run_recovery_task_with_context}".to_string()
}

fn agent_loop_started_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:entrypoint:string,state:string;known_optional_fields:verification_recovery_retry:boolean;additional_fields:false;agent_loop_started_payload:true}".to_string()
}

fn agent_loop_completed_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:completion_summary:string,final_state:string;known_optional_fields:completion_result_fingerprint:string,final_response_chars:u64,final_response_present:boolean,verification_recovery_retry:boolean;additional_fields:false;agent_loop_completed_payload:true}".to_string()
}

fn task_completion_accepted_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:acceptance_fingerprint:string,acceptance_id:string,next_action:string,replayed:boolean,run_id:string,status:string,task_id:string,terminal_completion_fingerprint:string,verifier_gate_status:string;additional_fields:false;task_completion_accepted_payload:true;status:AcceptedComplete;next_action:inspect_accepted_completion}".to_string()
}

fn prompt_built_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;known_optional_fields:context_budget_max_ledger_events:u64,context_budget_max_prompt_chars:u64,context_budget_max_selected_index_chars:u64,context_budget_prompt_chars:u64,context_budget_prompt_within_budget:boolean,context_budget_protected_context_chars:u64,context_budget_requested:boolean,context_budget_selected_index_content_chars:u64,context_budget_selected_index_context_present:boolean,context_budget_selected_index_materialized_chars:u64,context_budget_selected_index_truncated:boolean,context_first_included_event:string,context_included_events:u64,context_last_included_event:string,context_max_events:u64,context_omitted_events:u64,context_total_events:u64,context_window_bounded:boolean,max_prompt_chars:u64,message_count:u64,prompt_preview:string,prompt_preview_redacted:boolean,prompt_preview_redaction_reason:string;known_field_required:true;additional_fields:false;prompt_built_payload:true}".to_string()
}

fn prompt_sensitive_scan_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:categories:array<string>,finding_count:u64,message_indexes:array<u64>,mode:string,sensitive_guard:string;additional_fields:false;prompt_sensitive_scan_payload:true}".to_string()
}

fn llm_request_created_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:base_url:string_or_null,message_count:u64,model:string,provider:string,strict:boolean;additional_fields:false;llm_request_created_payload:true}".to_string()
}

fn llm_request_failed_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;known_optional_fields:base_url:string_or_null,llm_provider_failure:object,model:string,provider:string,reason:string,reason_chars:u64,reason_sha256:string,reason_truncated:boolean,sensitive_guard:string,strict:boolean;known_field_required:true;additional_fields:false;llm_request_failed_payload:true}".to_string()
}

fn llm_response_received_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:provider:string;one_of_required:content_preview:string|content_preview_redacted:boolean;known_optional_fields:content_preview:string,content_preview_redacted:boolean,content_preview_redaction_reason:string,response_preview_chars:u64;additional_fields:false;llm_response_received_payload:true}".to_string()
}

fn task_started_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:true;known_optional_fields:apply_fingerprint:string_or_null,apply_id:string_or_null,decision_fingerprint:string_or_null,derived_goal_fingerprint:string_or_null,derived_objective_fingerprint:string_or_null,drive_fingerprint:string_or_null,end_session_sequence:u64_or_null,execution_enabled:boolean,external_modepack_child_provenance:object_or_null,failure_class:string_or_null,failure_fingerprint:string_or_null,llm_provider_failure_retry_provenance:object_or_null,next_action:string,next_route_fingerprint:string_or_null,parent_run_id:string_or_null,parent_task_id:string_or_null,patch_apply_recovery_provenance:object_or_null,product_continuation_provenance:object_or_null,product_continuation_running_enabled:boolean,product_evidence_fingerprint:string_or_null,product_loop_stop_recovery_provenance:object_or_null,product_loop_stop_recovery_running_enabled:boolean,product_objective_continuation_provenance:object_or_null,proposal_id:string_or_null,reason:string,recovery_boundary_fingerprint:string_or_null,recovery_cycle_provenance:object_or_null,recovery_run_id:string_or_null,recovery_running_enabled:boolean,recovery_task_id:string_or_null,retried_verifier_tool_ids:array_or_null,retry_running_enabled:boolean,retryable:boolean_or_null,scheduler_handoff_enabled:boolean,source_apply_id:string_or_null,source_candidate_id:string_or_null,source_decision_id:string_or_null,source_drive_id:string_or_null,source_handoff_envelope_fingerprint:string_or_null,source_handoff_envelope_id:string_or_null,source_intent_summary:object_or_null,source_progress_fingerprint:string_or_null,source_proposal_id:string_or_null,source_run_id:string_or_null,source_session_id:string_or_null,source_task_id:string_or_null,status:string,stop_class:string_or_null,stop_reason:string_or_null,verification_recovery_provenance:object_or_null,verification_recovery_retry_provenance:object_or_null;known_field_required:true;additional_fields:false;task_started_payload:true}".to_string()
}

fn task_running_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:true;known_optional_fields:admission_id:string,admission_kind:string,deadline_persisted:boolean,deadline_scope:string,reason:string,runtime_deadline:object;known_field_required:true;conditional_required:runtime_deadline=>deadline_scope+deadline_persisted,admission_id|admission_kind=>admission_id+admission_kind+reason;additional_fields:false;task_running_payload:true}".to_string()
}

fn mode_resolved_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:completion_rules:array,display_name:string,instruction_fingerprint:string_or_null,mcp_access:array,mode_id:string,permissions:object,prompt_sections:array,role_definition:string,workspace_write_scopes:array;known_optional_fields:allowed_handoff_targets:array_or_null,description:string_or_null,external_modepack_task_provenance:object,mcp_tool_catalogs:array,verification_responsibility:string_or_null,when_to_use:string_or_null;additional_fields:false;mode_resolved_payload:true}".to_string()
}

fn external_modepack_child_denied_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:reason:string,run_id:string,status:string,task_id:string;known_optional_fields:mode_id:string_or_null,parent_run_id:string_or_null,source_candidate_id:string_or_null,source_handoff_envelope_fingerprint:string_or_null,source_handoff_envelope_id:string_or_null;additional_fields:false;external_modepack_child_provenance_denied_payload:true;status:Denied}".to_string()
}

fn external_modepack_task_denied_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:reason:string,run_id:string,source_kind:string,source_path:string,status:string,task_id:string;known_optional_fields:mode_id:string_or_null;additional_fields:false;external_modepack_task_provenance_denied_payload:true;status:Denied}".to_string()
}

fn subtask_orchestration_queued_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:execution_enabled:boolean,input_summary:object,parent_run_id:string,parent_task_id:string,queue_position:u64,reason:string,request_reason:string,required_action:string,status:string,subtask_id:string,tool_id:string;known_optional_fields:requested_goal_preview:string,requested_mode_id:string;additional_fields:false;subtask_orchestration_payload:true}".to_string()
}

fn subtask_handoff_prepared_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:execution_enabled:boolean,handoff_id:string,next_action:string,parent_run_id:string,parent_task_id:string,queued_count:u64,queued_subtask_ids:array<string>,reason:string,source_event_count:u64,status:string;additional_fields:false;subtask_handoff_prepared_payload:true}".to_string()
}

fn subtask_scheduler_readiness_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:blocked_checks:array<string>,check_count:u64,dispatch_enabled:boolean,execution_enabled:boolean,handoff_count:u64,handoff_id:string,next_action:string,parent_run_id:string,parent_task_id:string,queued_count:u64,readiness_id:string,readiness_reason:string,readiness_status:string,reason:string,source_event_count:u64,status:string;additional_fields:false;subtask_scheduler_readiness_payload:true}".to_string()
}

fn subtask_dispatch_plan_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:blocked_checks:array<string>,check_count:u64,dispatch_enabled:boolean,dispatch_plan_status:string,dispatch_reason:string,execution_enabled:boolean,next_action:string,parent_run_id:string,parent_task_id:string,plan_id:string,queued_count:u64,readiness_count:u64,readiness_id:string,reason:string,required_capability:string,source_event_count:u64,status:string;additional_fields:false;subtask_dispatch_plan_payload:true}".to_string()
}

fn subtask_dispatch_contract_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:blocked_checks:array<string>,check_count:u64,contract_id:string,dispatch_contract_reason:string,dispatch_contract_status:string,dispatch_enabled:boolean,eligibility_status:string,execution_enabled:boolean,next_action:string,parent_run_id:string,parent_task_id:string,plan_count:u64,plan_id:string,queued_count:u64,reason:string,required_capability:string,required_preconditions:array<string>,source_event_count:u64,status:string;additional_fields:false;subtask_dispatch_contract_payload:true}".to_string()
}

fn subtask_dispatch_admission_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:admission_id:string,admission_reason:string,admission_status:string,blocked_checks:array<string>,blocked_preconditions:array<string>,check_count:u64,contract_count:u64,contract_id:string,dispatch_enabled:boolean,execution_enabled:boolean,execution_gate_status:string,next_action:string,parent_run_id:string,parent_task_id:string,precondition_count:u64,queued_count:u64,reason:string,required_capability:string,satisfied_precondition_count:u64,source_event_count:u64,status:string;additional_fields:false;subtask_dispatch_admission_payload:true}".to_string()
}

fn subtask_dispatch_readiness_snapshot_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:admission_count:u64,admission_id:string,blocked_checks:array<string>,blocked_preconditions:array<string>,check_count:u64,dispatch_enabled:boolean,execution_enabled:boolean,fingerprint_input_count:u64,next_action:string,parent_run_id:string,parent_task_id:string,precondition_count:u64,queued_count:u64,readiness_fingerprint:string,readiness_reason:string,readiness_status:string,reason:string,required_capability:string,satisfied_precondition_count:u64,scheduler_handoff_status:string,snapshot_id:string,source_event_count:u64,status:string;additional_fields:false;subtask_dispatch_readiness_snapshot_payload:true}".to_string()
}

fn subtask_dispatcher_guard_verdict_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:blocked_checks:array<string>,blocked_preconditions:array<string>,check_count:u64,dispatch_enabled:boolean,execution_enabled:boolean,fingerprint_input_count:u64,guard_id:string,guard_reason:string,guard_status:string,handoff_preflight_status:string,next_action:string,parent_run_id:string,parent_task_id:string,precondition_count:u64,queued_count:u64,reason:string,required_capability:string,satisfied_precondition_count:u64,scheduler_handoff_status:string,snapshot_count:u64,snapshot_fingerprint:string,snapshot_fingerprint_count:u64,snapshot_id:string,snapshot_validity_status:string,source_event_count:u64,status:string;additional_fields:false;subtask_dispatcher_guard_verdict_payload:true}".to_string()
}

fn subtask_dispatch_decision_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:blocked_candidate_count:u64,blocked_checks:array<string>,blocked_preconditions:array<string>,candidate_status:string,check_count:u64,decision_id:string,decision_status:string,dispatch_candidate_count:u64,dispatch_decision:string,dispatch_denial_reason:string,dispatch_enabled:boolean,eligible_candidate_count:u64,execution_enabled:boolean,fingerprint_input_count:u64,guard_count:u64,guard_id:string,guard_status:string,handoff_preflight_status:string,next_action:string,parent_run_id:string,parent_task_id:string,precondition_count:u64,queued_count:u64,reason:string,required_capability:string,satisfied_precondition_count:u64,snapshot_fingerprint:string,snapshot_fingerprint_count:u64,snapshot_id:string,snapshot_validity_status:string,source_event_count:u64,status:string;additional_fields:false;subtask_dispatch_decision_payload:true}".to_string()
}

fn subtask_dispatch_candidate_manifest_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:blocked_candidate_count:u64,blocked_candidate_ids:array<string>,blocked_checks:array<string>,blocked_preconditions:array<string>,candidate_count:u64,candidate_denial_reason:string,candidate_ids:array<string>,candidate_manifest_fingerprint:string,candidate_status:string,check_count:u64,decision_count:u64,decision_id:string,dispatch_candidate_count:u64,dispatch_decision:string,dispatch_enabled:boolean,eligible_candidate_count:u64,eligible_candidate_ids:array<string>,execution_enabled:boolean,fingerprint_input_count:u64,guard_id:string,manifest_id:string,manifest_status:string,next_action:string,parent_run_id:string,parent_task_id:string,precondition_count:u64,queued_count:u64,reason:string,required_capability:string,satisfied_precondition_count:u64,snapshot_fingerprint:string,snapshot_id:string,source_event_count:u64,status:string;additional_fields:false;subtask_dispatch_candidate_manifest_payload:true}".to_string()
}

fn subtask_dispatch_handoff_envelope_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:blocked_candidate_count:u64,blocked_candidate_ids:array<string>,candidate_count:u64,candidate_ids:array<string>,candidate_status:string,dispatch_decision:string,dispatch_enabled:boolean,eligible_candidate_count:u64,eligible_candidate_ids:array<string>,execution_enabled:boolean,fingerprint_input_count:u64,handoff_envelope_fingerprint:string,handoff_envelope_id:string,handoff_envelope_status:string,next_action:string,parent_run_id:string,parent_task_id:string,reason:string,required_capability:string,scheduler_handoff_status:string,status:string;known_optional_fields:blocked_checks:array<string>,blocked_preconditions:array<string>,candidate_denial_reason:string,candidate_manifest_fingerprint:string,check_count:u64,continuation_materialization:boolean,continuation_source:string,decision_id:string,dispatch_candidate_count:u64,handoff_ticket_count:u64,handoff_ticket_status:string,manifest_count:u64,manifest_id:string,max_recovery_cycle_depth:u64,parent_join_admission_id:string,parent_join_child_completion_child_count:u64,parent_join_child_completion_fingerprint:string,parent_join_fingerprint_input_count:u64,parent_join_recovery_cycle:boolean,parent_join_recovery_cycle_depth:u64,parent_join_terminal_completed_child_count:u64,parent_join_terminal_failed_child_count:u64,precondition_count:u64,queued_count:u64,recovery_cycle_budget_status:string,replay_guard_reason:string,replay_guard_status:string,satisfied_precondition_count:u64,source_event_count:u64;additional_fields:false;subtask_dispatch_handoff_envelope_payload:true}".to_string()
}

fn parent_join_continuation_consumed_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:admission_id:string,child_completion_child_count:u64,child_completion_fingerprint:string,child_recovery_cycle_depth:u64,child_terminal_completed_count:u64,child_terminal_failed_count:u64,fingerprint_input_count:u64,parent_join_continuation_status:string,reason:string;additional_fields:false;parent_join_continuation_consumed_payload:true}".to_string()
}

fn ledger_payload_instance_shape_fingerprint_for_value(kind: &str, payload: &Value) -> String {
    stable_fingerprint(&format!(
        "{kind}:payload_instance_shape_v{LEDGER_PAYLOAD_SCHEMA_VERSION}:descriptor:{}",
        ledger_payload_shape_descriptor(payload)
    ))
}

fn ledger_payload_shape_descriptor(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(_) => "boolean".to_string(),
        Value::Number(number) if number.is_i64() || number.is_u64() => "integer".to_string(),
        Value::Number(_) => "number".to_string(),
        Value::String(_) => "string".to_string(),
        Value::Array(values) => {
            if values.is_empty() {
                "array<empty>".to_string()
            } else {
                let item_shapes = values
                    .iter()
                    .map(ledger_payload_shape_descriptor)
                    .collect::<BTreeSet<_>>()
                    .into_iter()
                    .collect::<Vec<_>>()
                    .join("|");
                format!("array<{item_shapes}>")
            }
        }
        Value::Object(object) => {
            let fields = object
                .iter()
                .map(|(key, value)| format!("{key}:{}", ledger_payload_shape_descriptor(value)))
                .collect::<Vec<_>>()
                .join(",");
            format!("object{{{fields}}}")
        }
    }
}

pub fn explicit_runtime_methods() -> Vec<&'static str> {
    METHOD_SPECS.iter().map(|spec| spec.method).collect()
}

pub fn public_param_types() -> Vec<String> {
    parse_public_struct_schemas(PROTOCOL_SOURCE)
        .values()
        .filter(|schema| schema.name.ends_with("Params"))
        .map(|schema| schema.name.clone())
        .collect()
}

pub fn public_param_types_without_deny_unknown_fields() -> Vec<String> {
    parse_public_struct_schemas(PROTOCOL_SOURCE)
        .values()
        .filter(|schema| schema.name.ends_with("Params") && !schema.deny_unknown_fields)
        .map(|schema| schema.name.clone())
        .collect()
}

pub fn explicit_runtime_method_set() -> BTreeSet<String> {
    METHOD_SPECS
        .iter()
        .map(|spec| spec.method.to_string())
        .collect()
}
