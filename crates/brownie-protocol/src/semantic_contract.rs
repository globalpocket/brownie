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
    let method_contracts = METHOD_SPECS
        .iter()
        .map(|spec| method_contract_json(spec, &struct_schemas))
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

    json!({
        "schema_version": 2,
        "contract_id": "runtime-semantic-protocol-contract-v1",
        "campaign": "runtime-release-readiness-p0-p1-finite-closure",
        "phase": "RRP-5.2",
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
            "ledger_payload_shape_version_source": "LEDGER_PAYLOAD_SHAPE_VERSION",
            "policy": "Durable event kind or typed payload shape changes require an explicit brownie-store schema migration or compatibility entry before Runtime release.",
            "guard": "guard:protocol-event-canonization",
            "event_shape_fingerprint_count": ledger_event_kinds.len(),
            "event_shape_fingerprints": ledger_event_kinds
                .iter()
                .map(|kind| {
                    let shape_id = format!("ledger_payload.{kind}.v1");
                    json!({
                        "ledger_event_kind": kind,
                        "payload_shape_id": shape_id,
                        "payload_shape_version": 1,
                        "payload_shape_fingerprint": stable_fingerprint(&format!("{}:{}", kind, "payload_shape_v1")),
                        "store_schema_version": 2
                    })
                })
                .collect::<Vec<_>>()
        }
    })
}

fn method_contract_json(spec: &MethodSpec, structs: &BTreeMap<String, StructSchema>) -> Value {
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
        "schema_fingerprint": stable_fingerprint(&format!(
            "{}:{}:{}",
            spec.method,
            spec.param_type.unwrap_or("NoParams"),
            spec.result_type
        ))
    })
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
    let task_completed_payload_shape_fingerprint =
        stable_fingerprint("TaskCompleted:payload_shape_v1");
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
            "payload": {"status": "Completed"},
            "payload_envelope": {
                "schema_version": 1,
                "shape_id": "ledger_payload.TaskCompleted.v1",
                "shape_fingerprint": task_completed_payload_shape_fingerprint
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
