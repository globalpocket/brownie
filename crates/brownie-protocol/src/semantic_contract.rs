use serde_json::{json, Value};

pub fn runtime_semantic_protocol_contract() -> Value {
    json!({
        "schema_version": 1,
        "contract_id": "runtime-semantic-protocol-contract-v1",
        "campaign": "runtime-release-readiness-p0-p1-finite-closure",
        "phase": "RRP-5.1",
        "owner": "runtime",
        "runtime_release_debt_id": "protocol-event-canonization",
        "runtime_release_ready": false,
        "generated_by": {
            "crate": "brownie-protocol",
            "module": "brownie_protocol::semantic_contract",
            "binary": "brownie-protocol-semantic-contract",
            "command": "cargo run -p brownie-protocol --bin brownie-protocol-semantic-contract -- --write docs/architecture/runtime-semantic-protocol-contract.json"
        },
        "sources": [
            {
                "path": "crates/brownie-protocol/src/lib.rs",
                "role": "Runtime JSON-RPC wire types and Rust serde semantics"
            },
            {
                "path": "crates/brownie-protocol/src/semantic_contract.rs",
                "role": "Runtime-owned semantic protocol contract generator"
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
                "role": "Durable ledger and schema migration coupling"
            }
        ],
        "method_contracts": [
            {
                "method": "task.start",
                "param_type": "TaskStartParams",
                "required_fields": ["goal"],
                "optional_fields": ["mode_id", "verification_recovery_source", "patch_apply_recovery_source", "verification_recovery_retry_source", "llm_provider_failure_retry_source", "product_continuation_source"],
                "nullable_fields": [],
                "enum_fields": [],
                "vsix_client_input_type": "TaskStartParams",
                "vsix_client_wire_transform": {
                    "modeId": "mode_id",
                    "verificationRecoverySource": "verification_recovery_source",
                    "patchApplyRecoverySource": "patch_apply_recovery_source",
                    "verificationRecoveryRetrySource": "verification_recovery_retry_source",
                    "llmProviderFailureRetrySource": "llm_provider_failure_retry_source",
                    "productContinuationSource": "product_continuation_source"
                },
                "unknown_field_policy": "rust_deny_unknown_fields_and_vsix_hasOnlyFields",
                "result_type": "TaskStartResult",
                "result_required_fields": ["task_id", "run_id", "status"]
            },
            {
                "method": "task.cancel",
                "param_type": "TaskCancelParams",
                "required_fields": ["task_id", "run_id", "expected_status", "expected_task_updated_at", "cancel_id", "authorize_cancel"],
                "optional_fields": [],
                "nullable_fields": [],
                "enum_fields": ["expected_status"],
                "vsix_client_input_type": "TaskCancelParams",
                "vsix_client_wire_transform": "identity",
                "unknown_field_policy": "rust_deny_unknown_fields_and_vsix_hasOnlyFields",
                "result_type": "TaskCancelResult",
                "result_required_fields": ["task_id", "run_id", "status", "replayed", "cancel_id", "cancel_fingerprint", "ledger_event_kind", "next_action"]
            },
            {
                "method": "task.run",
                "param_type": "TaskRunParams",
                "required_fields": ["task_id"],
                "optional_fields": ["selected_index_context", "verification_recovery_context_read", "context_budget", "completion_acceptance"],
                "nullable_fields": ["selected_index_context", "verification_recovery_context_read", "context_budget", "completion_acceptance"],
                "enum_fields": [],
                "vsix_client_input_type": "TaskRunParams",
                "vsix_client_wire_transform": "taskId_to_task_id_and_optional_selected_index_context",
                "unknown_field_policy": "rust_deny_unknown_fields_and_vsix_hasOnlyFields",
                "result_type": "TaskRunResult",
                "result_required_fields": ["task_id", "run_id", "status"]
            },
            {
                "method": "headless.run.drive",
                "param_type": "HeadlessRunDriveParams",
                "required_fields": ["authorize", "session_id", "drive_id"],
                "optional_fields": ["expected_start_session_sequence", "max_advances", "max_steps_per_advance"],
                "nullable_fields": [],
                "enum_fields": [],
                "vsix_client_input_type": "HeadlessRunDriveParams",
                "vsix_client_wire_transform": "identity",
                "unknown_field_policy": "rust_deny_unknown_fields_and_vsix_hasOnlyFields",
                "result_type": "HeadlessRunDriveResult",
                "result_required_fields": ["status", "session_id", "drive_id"]
            },
            {
                "method": "tool.execute",
                "param_type": "ToolExecuteParams",
                "required_fields": ["mode_id", "tool_id", "task_id", "input"],
                "optional_fields": [],
                "nullable_fields": [],
                "enum_fields": [],
                "vsix_client_input_type": "ToolExecuteParams",
                "vsix_client_wire_transform": "identity",
                "unknown_field_policy": "rust_deny_unknown_fields",
                "result_type": "ToolExecuteResult",
                "result_required_fields": ["status"]
            },
            {
                "method": "mcp.tool.approve",
                "param_type": "McpToolApprovalApproveParams",
                "required_fields": ["mode_id", "task_id", "tool_id", "input", "approve", "approval_id"],
                "optional_fields": [],
                "nullable_fields": [],
                "enum_fields": [],
                "vsix_client_input_type": "McpToolApprovalApproveParams",
                "vsix_client_wire_transform": "identity",
                "unknown_field_policy": "rust_deny_unknown_fields",
                "result_type": "McpToolApprovalApproveResult",
                "result_required_fields": ["approval_id", "status"]
            },
            {
                "method": "run.events",
                "param_type": "RunEventsParams",
                "required_fields": ["run_id"],
                "optional_fields": [],
                "nullable_fields": [],
                "enum_fields": [],
                "vsix_client_input_type": "RunEventsParams",
                "vsix_client_wire_transform": "runId_to_run_id",
                "unknown_field_policy": "rust_deny_unknown_fields",
                "result_type": "RunEventsResult",
                "result_required_fields": ["run_id", "events"]
            },
            {
                "method": "proposal.apply",
                "param_type": "ProposalApplyParams",
                "required_fields": ["run_id", "proposal_id", "authorize"],
                "optional_fields": ["expected_target_sha256", "expected_target_absent", "replacement_content", "patch_old_text", "patch_new_text", "patch_hunks", "transaction_items", "transaction_recovery_source"],
                "nullable_fields": ["expected_target_sha256", "expected_target_absent", "replacement_content"],
                "enum_fields": [],
                "vsix_client_input_type": "ProposalApplyParams",
                "vsix_client_wire_transform": "method_specific_identity_or_transaction_projection",
                "unknown_field_policy": "rust_deny_unknown_fields",
                "result_type": "ProposalApplyResult",
                "result_required_fields": ["run_id", "proposal_id", "status"]
            }
        ],
        "enum_contracts": [
            {
                "type": "TaskStatus",
                "values": ["Created", "Queued", "Running", "Completed", "Failed", "Cancelled"],
                "unknown_variant_policy": "reject"
            },
            {
                "type": "ToolExecuteStatus",
                "values": ["Completed", "Denied", "Failed"],
                "unknown_variant_policy": "reject"
            }
        ],
        "jsonrpc_error_contract": {
            "success_response": "result_only",
            "error_response": "error_only",
            "error_fields": ["code", "message"],
            "unknown_method_code": -32601,
            "invalid_params_code": -32602
        },
        "unknown_field_policy": {
            "rust_params_deny_unknown_fields": [
                "TaskStartParams",
                "TaskCancelParams",
                "TaskRunParams",
                "HeadlessRunDriveParams",
                "ToolExecuteParams",
                "McpToolApprovalApproveParams",
                "RunEventsParams",
                "ProposalApplyParams"
            ],
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
                "semantic_contract_fixtures_match_rust_serialization_semantics",
                "validates Rust semantic contract fixtures at the VSIX boundary",
                "rejects unknown fields from semantic contract fixtures"
            ]
        },
        "golden_fixtures": {
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
            "task_status_values": ["Created", "Queued", "Running", "Completed", "Failed", "Cancelled"]
        },
        "durable_event_migration_coupling": {
            "store_schema_version": 2,
            "schema_manifest_path": ".brownie/store-schema.json",
            "layout_marker_path": ".brownie/store-layout.json",
            "ledger_event_kind_source": "crates/brownie-store/src/lib.rs",
            "policy": "Durable event kind or shape changes require an explicit brownie-store schema migration or compatibility entry before Runtime release.",
            "guard": "guard:protocol-event-canonization"
        }
    })
}
