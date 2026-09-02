//! Controlled tool execution authority boundary.

use super::*;
use std::collections::{BTreeMap, BTreeSet};

pub(super) fn handle_tool_list(id: Value) -> JsonRpcResponse<Value> {
    let tools = BuiltinToolRegistry::list()
        .into_iter()
        .map(tool_summary)
        .collect();
    result_response(id, json!(ToolListResult { tools }))
}

pub(super) fn handle_tool_plan(id: Value, params: Option<Value>) -> JsonRpcResponse<Value> {
    let params: ToolPlanParams = match parse_params(params) {
        Ok(params) => params,
        Err(message) => return error_response(id, -32602, &message),
    };
    let store = match BrownieStore::from_env_or_cwd() {
        Ok(store) => store,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    let record = match store.tasks().get_task(&params.task_id) {
        Ok(Some(record)) => record,
        Ok(None) => return error_response(id, -32602, "invalid params: task not found"),
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    let policy = match resolve_policy_for_task_run(&record, &store) {
        Ok(policy) => policy,
        Err(message) => return error_response(id, -32603, &format!("internal error: {message}")),
    };
    let result = build_tool_plan_result(&record, &policy);
    result_response(id, json!(result))
}

pub(super) fn handle_tool_intent_parse(id: Value, params: Option<Value>) -> JsonRpcResponse<Value> {
    let params: ToolIntentParseParams = match parse_params(params) {
        Ok(params) => params,
        Err(message) => return error_response(id, -32602, &message),
    };
    let store = match BrownieStore::from_env_or_cwd() {
        Ok(store) => store,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    let (policy, dynamic_tools) = match params.task_id.as_deref() {
        Some(task_id) => {
            let record = match store.tasks().get_task(task_id) {
                Ok(Some(record)) => record,
                Ok(None) => return error_response(id, -32602, "invalid params: task not found"),
                Err(error) => {
                    return error_response(id, -32603, &format!("internal error: {error}"))
                }
            };
            let policy = match resolve_policy_for_task_run(&record, &store) {
                Ok(policy) => policy,
                Err(message) => {
                    return error_response(id, -32603, &format!("internal error: {message}"))
                }
            };
            if policy.mode_id != params.mode_id {
                return error_response(
                    id,
                    -32602,
                    "invalid params: mode_id does not match task policy",
                );
            }
            let dynamic_tools = match pinned_mcp_dynamic_tool_definitions(&store, &record) {
                Ok(tools) => tools,
                Err(error) => {
                    return error_response(id, -32603, &format!("internal error: {error}"))
                }
            };
            (policy, dynamic_tools)
        }
        None => {
            let policy = match BuiltinModeRegistry::get(&params.mode_id) {
                Some(policy) => policy,
                None => return error_response(id, -32602, "invalid params: unknown mode_id"),
            };
            (policy, Vec::new())
        }
    };
    let parsed = ToolIntentParser::parse_assistant_content(&params.assistant_content);
    let parser_summary = parsed.summary.clone();
    let evaluation =
        ToolIntentEvaluator::evaluate_with_dynamic_tools(&policy, parsed, &dynamic_tools);
    result_response(
        id,
        json!(ToolIntentParseResult {
            mode_id: policy.mode_id,
            parser: tool_intent_parser_summary(parser_summary),
            items: evaluation
                .items
                .into_iter()
                .map(tool_intent_decision_summary)
                .collect(),
            rejected: evaluation
                .rejected
                .into_iter()
                .map(tool_intent_rejected_summary)
                .collect(),
        }),
    )
}

pub(super) fn handle_tool_execute(id: Value, params: Option<Value>) -> JsonRpcResponse<Value> {
    let params: ToolExecuteParams = match parse_params(params) {
        Ok(params) => params,
        Err(message) => return error_response(id, -32602, &message),
    };
    if mcp_client::split_normalized_tool_id(&params.tool_id).is_some() {
        return match execute_mcp_tool(params) {
            Ok(result) => result_response(id, json!(result)),
            Err(error) => error_response(id, -32603, &format!("internal error: {error}")),
        };
    }
    let Some(definition) = BuiltinToolRegistry::get(&params.tool_id) else {
        return result_response(
            id,
            json!(ToolExecuteResult {
                tool_id: params.tool_id,
                status: ToolExecuteStatus::Failed,
                output: json!({ "reason": "Unknown tool id." }),
            }),
        );
    };
    let store = match BrownieStore::from_env_or_cwd() {
        Ok(store) => store,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    let policy = match resolve_workspace_mode_policy(&store, &params.mode_id) {
        Ok(Some(policy)) => policy,
        Ok(None) => return error_response(id, -32602, "invalid params: unknown mode_id"),
        Err(message) => return error_response(id, -32603, &format!("internal error: {message}")),
    };
    let decision = RuntimePermissionGate::check(&policy, definition.required_action.clone());
    if !decision.allowed {
        return result_response(
            id,
            json!(ToolExecuteResult {
                tool_id: definition.tool_id,
                status: ToolExecuteStatus::Denied,
                output: json!({ "reason": decision.reason }),
            }),
        );
    }

    if definition.tool_id == CODEBASE_INDEX_SELECTION_READ_TOOL_ID {
        return match execute_codebase_index_selection_read(
            &store,
            &policy,
            &params.mode_id,
            params.input,
        ) {
            Ok(result) => result_response(id, json!(result)),
            Err(error) => error_response(id, -32603, &format!("internal error: {error}")),
        };
    }
    let input = if definition.tool_id == GIT_COMMIT_TOOL_ID {
        let Some(task_id) = params.task_id.as_deref() else {
            return result_response(
                id,
                json!(ToolExecuteResult {
                    tool_id: definition.tool_id,
                    status: ToolExecuteStatus::Denied,
                    output: json!({ "reason": "git.commit requires task-pinned runtime authorization evidence." }),
                }),
            );
        };
        let record = match store.tasks().get_task(task_id) {
            Ok(Some(record)) => record,
            Ok(None) => {
                return result_response(
                    id,
                    json!(ToolExecuteResult {
                        tool_id: definition.tool_id,
                        status: ToolExecuteStatus::Denied,
                        output: json!({ "reason": "git.commit requires a known task." }),
                    }),
                )
            }
            Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
        };
        let policy = match resolve_policy_for_task_run(&record, &store) {
            Ok(policy) => policy,
            Err(message) => {
                return result_response(
                    id,
                    json!(ToolExecuteResult {
                        tool_id: definition.tool_id,
                        status: ToolExecuteStatus::Denied,
                        output: json!({ "reason": message }),
                    }),
                )
            }
        };
        let decision = RuntimePermissionGate::check(&policy, definition.required_action.clone());
        if !decision.allowed {
            return result_response(
                id,
                json!(ToolExecuteResult {
                    tool_id: definition.tool_id,
                    status: ToolExecuteStatus::Denied,
                    output: json!({ "reason": decision.reason }),
                }),
            );
        }
        match runtime_git_commit_execution_input(&store, &record, &policy, &params.input, 0) {
            Ok(Ok(input)) => input,
            Ok(Err(reason)) => {
                return result_response(
                    id,
                    json!(ToolExecuteResult {
                        tool_id: definition.tool_id,
                        status: ToolExecuteStatus::Failed,
                        output: git_commit_authorization_failed_payload(reason),
                    }),
                )
            }
            Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
        }
    } else {
        params.input
    };
    match ToolExecutor::execute_controlled(
        store.workspace_root(),
        ToolExecutionRequest {
            tool_id: definition.tool_id,
            input,
        },
    ) {
        Ok(result) => result_response(id, json!(tool_execute_result(result))),
        Err(error) => error_response(id, -32603, &format!("internal error: {error}")),
    }
}

fn execute_mcp_tool(params: ToolExecuteParams) -> anyhow::Result<ToolExecuteResult> {
    let Some(task_id) = params.task_id.as_deref() else {
        return Ok(ToolExecuteResult {
            tool_id: params.tool_id,
            status: ToolExecuteStatus::Denied,
            output: json!({ "reason": "MCP tool execution requires task-pinned policy evidence." }),
        });
    };
    let store = BrownieStore::from_env_or_cwd()?;
    let Some(record) = store.tasks().get_task(task_id)? else {
        return Ok(ToolExecuteResult {
            tool_id: params.tool_id,
            status: ToolExecuteStatus::Denied,
            output: json!({ "reason": "MCP tool execution requires a known task." }),
        });
    };
    let policy = match resolve_policy_for_task_run(&record, &store) {
        Ok(policy) => policy,
        Err(message) => {
            return Ok(ToolExecuteResult {
                tool_id: params.tool_id,
                status: ToolExecuteStatus::Denied,
                output: json!({ "reason": message }),
            })
        }
    };
    execute_mcp_tool_for_record(&store, &record, &policy, params.tool_id, params.input)
}

fn execute_mcp_tool_for_record(
    store: &BrownieStore,
    record: &TaskRecord,
    policy: &CompiledModePolicy,
    tool_id: String,
    input: Value,
) -> anyhow::Result<ToolExecuteResult> {
    let request_fingerprint = mcp_tool_execution_request_fingerprint(&tool_id, &input);
    let Some((server_id, tool_name)) = mcp_client::split_normalized_tool_id(&tool_id) else {
        return Ok(ToolExecuteResult {
            tool_id,
            status: ToolExecuteStatus::Failed,
            output: json!({ "reason": "Malformed MCP tool id." }),
        });
    };
    let server_id = server_id.to_string();
    let tool_name = tool_name.to_string();
    let decision = mcp_tool_runtime_permission_decision(&policy, &server_id, &tool_name);
    if !decision.allowed {
        return Ok(ToolExecuteResult {
            tool_id,
            status: ToolExecuteStatus::Denied,
            output: json!({ "reason": decision.reason }),
        });
    }
    let Some(tool_policy) = compiled_mcp_tool_policy(policy, &server_id, &tool_name) else {
        return Ok(ToolExecuteResult {
            tool_id,
            status: ToolExecuteStatus::Denied,
            output: json!({ "reason": "MCP tool has no structured Brownie safety policy." }),
        });
    };
    let mcp_safety_policy = mcp_tool_safety_policy_payload(tool_policy);
    let Some(config) = mcp_server_config_for_policy(&store, &record, &server_id)? else {
        return Ok(ToolExecuteResult {
            tool_id,
            status: ToolExecuteStatus::Denied,
            output: json!({ "reason": "MCP server is not configured by structured Mode Pack policy." }),
        });
    };
    let catalog = match mcp_client::list_tools(&config) {
        Ok(catalog) => catalog,
        Err(error) => {
            return Ok(ToolExecuteResult {
                tool_id,
                status: ToolExecuteStatus::Failed,
                output: json!({ "reason": format!("MCP tools/list failed: {error}") }),
            })
        }
    };
    let Some(catalog_entry) = catalog
        .tools
        .iter()
        .find(|entry| entry.tool_name == tool_name && entry.tool_id == tool_id)
    else {
        return Ok(ToolExecuteResult {
            tool_id,
            status: ToolExecuteStatus::Denied,
            output: json!({ "reason": "MCP tool is outside the validated server catalog." }),
        });
    };
    if !pinned_mcp_catalog_allows(&store, &record, &catalog, catalog_entry)? {
        return Ok(ToolExecuteResult {
            tool_id,
            status: ToolExecuteStatus::Denied,
            output: json!({ "reason": "MCP tool catalog does not match task-pinned provenance." }),
        });
    }
    if let Some(reason) = mcp_annotation_safety_denial(tool_policy, catalog_entry) {
        return Ok(ToolExecuteResult {
            tool_id,
            status: ToolExecuteStatus::Denied,
            output: json!({
                "reason": reason,
                "catalog_provenance": mcp_catalog_provenance_payload(&catalog, catalog_entry),
                "mcp_safety_policy": mcp_safety_policy,
            }),
        });
    }
    let approval_binding = mcp_tool_approval_binding_payload(
        record,
        &tool_id,
        &request_fingerprint,
        &catalog,
        catalog_entry,
        &mcp_safety_policy,
    );
    if tool_policy.permits_runtime_approval_binding()
        && !matching_mcp_tool_approval_bound(store, record, &approval_binding)?
    {
        return Ok(ToolExecuteResult {
            tool_id,
            status: ToolExecuteStatus::Denied,
            output: json!({
                "reason": "MCP tool requires a matching runtime approval fingerprint before tools/call.",
                "mcp_approval_binding": approval_binding,
                "catalog_provenance": mcp_catalog_provenance_payload(&catalog, catalog_entry),
                "mcp_safety_policy": mcp_safety_policy,
            }),
        });
    }
    let schema_validation = match mcp_client::validate_tool_input_against_schema(
        catalog_entry,
        &input,
    ) {
        Ok(evidence) => evidence,
        Err(error) => {
            return Ok(ToolExecuteResult {
                tool_id,
                status: ToolExecuteStatus::Denied,
                output: json!({
                    "reason": format!("MCP tool input schema validation failed: {error}"),
                    "catalog_provenance": mcp_catalog_provenance_payload(&catalog, catalog_entry),
                    "mcp_safety_policy": mcp_safety_policy,
                    "mcp_approval_binding": approval_binding,
                }),
            })
        }
    };
    match mcp_client::call_tool(&config, catalog_entry, input) {
        Ok(call_result) if call_result.status.is_success() => {
            let output_schema_validation = call_result
                .output
                .get("output_schema_validation")
                .cloned()
                .unwrap_or(Value::Null);
            Ok(ToolExecuteResult {
                tool_id,
                status: ToolExecuteStatus::Completed,
                output: json!({
                    "mcp": with_mcp_request_fingerprint(call_result.output, &request_fingerprint),
                    "catalog_provenance": mcp_catalog_provenance_payload(&catalog, catalog_entry),
                    "mcp_safety_policy": mcp_safety_policy,
                    "mcp_approval_binding": approval_binding,
                    "mcp_schema_validation": {
                        "input": schema_validation,
                        "output": output_schema_validation,
                    },
                }),
            })
        }
        Ok(call_result) => {
            let output_schema_validation = call_result
                .output
                .get("output_schema_validation")
                .cloned()
                .unwrap_or(Value::Null);
            Ok(ToolExecuteResult {
                tool_id,
                status: ToolExecuteStatus::Failed,
                output: json!({
                    "reason": "MCP tool returned error.",
                    "mcp": with_mcp_request_fingerprint(call_result.output, &request_fingerprint),
                    "catalog_provenance": mcp_catalog_provenance_payload(&catalog, catalog_entry),
                    "mcp_safety_policy": mcp_safety_policy,
                    "mcp_approval_binding": approval_binding,
                    "mcp_schema_validation": {
                        "input": schema_validation,
                        "output": output_schema_validation,
                    },
                }),
            })
        }
        Err(error) => {
            let mut mcp = mcp_call_failure_metadata(
                &config,
                &tool_name,
                &request_fingerprint,
                error.kind,
                tool_policy.retry_policy_name(),
            );
            if let Some(metadata) = error.metadata {
                merge_object_fields(&mut mcp, metadata);
            }
            Ok(ToolExecuteResult {
                tool_id,
                status: ToolExecuteStatus::Failed,
                output: json!({
                    "reason": format!("MCP tools/call {}.", error.kind.as_str()),
                    "mcp": mcp,
                    "mcp_safety_policy": mcp_safety_policy,
                    "mcp_approval_binding": approval_binding,
                    "mcp_schema_validation": {
                        "input": schema_validation,
                    },
                }),
            })
        }
    }
}

fn merge_object_fields(target: &mut Value, extra: Value) {
    if let (Some(target), Some(extra)) = (target.as_object_mut(), extra.as_object()) {
        for (key, value) in extra {
            target.insert(key.clone(), value.clone());
        }
    }
}

fn mcp_tool_runtime_permission_decision(
    policy: &CompiledModePolicy,
    server_id: &str,
    tool_name: &str,
) -> PermissionDecision {
    let base = RuntimePermissionGate::check(policy, RuntimeAction::UseMcpTool);
    if !base.allowed {
        return base;
    }
    let Some(server) = policy
        .mcp_access
        .iter()
        .find(|server| server.server_id == server_id)
    else {
        return PermissionDecision {
            action: RuntimeAction::UseMcpTool,
            allowed: false,
            reason: format!(
                "Mode {} does not allow MCP server {server_id}.",
                policy.mode_id
            ),
        };
    };
    if !server.tools.iter().any(|tool| tool == tool_name) {
        return PermissionDecision {
            action: RuntimeAction::UseMcpTool,
            allowed: false,
            reason: format!(
                "Mode {} does not allow MCP tool mcp.{server_id}.{tool_name}.",
                policy.mode_id
            ),
        };
    }
    let Some(tool_policy) = server.tool_policy(tool_name) else {
        return PermissionDecision {
            action: RuntimeAction::UseMcpTool,
            allowed: false,
            reason: format!(
                "Mode {} MCP tool mcp.{server_id}.{tool_name} has no structured Brownie safety policy.",
                policy.mode_id
            ),
        };
    };
    if tool_policy.permits_unapproved_runtime_execution() {
        return PermissionDecision {
            action: RuntimeAction::UseMcpTool,
            allowed: true,
            reason: format!(
                "Mode {} allows MCP tool mcp.{server_id}.{tool_name} through structured read-only Brownie safety policy.",
                policy.mode_id
            ),
        };
    }
    if tool_policy.permits_runtime_approval_binding() {
        return PermissionDecision {
            action: RuntimeAction::UseMcpTool,
            allowed: true,
            reason: format!(
                "Mode {} allows MCP tool mcp.{server_id}.{tool_name} only with matching runtime approval binding.",
                policy.mode_id
            ),
        };
    }
    let reason = if tool_policy.legacy_unclassified {
        format!(
            "Mode {} MCP tool mcp.{server_id}.{tool_name} uses legacy unclassified MCP policy and fails closed.",
            policy.mode_id
        )
    } else {
        format!(
            "Mode {} MCP tool mcp.{server_id}.{tool_name} requires unsupported or prohibited Brownie safety handling.",
            policy.mode_id
        )
    };
    PermissionDecision {
        action: RuntimeAction::UseMcpTool,
        allowed: false,
        reason,
    }
}

fn compiled_mcp_tool_policy<'a>(
    policy: &'a CompiledModePolicy,
    server_id: &str,
    tool_name: &str,
) -> Option<&'a CompiledMcpToolPolicy> {
    policy
        .mcp_access
        .iter()
        .find(|server| server.server_id == server_id)
        .and_then(|server| server.tool_policy(tool_name))
}

fn mcp_tool_safety_policy_payload(policy: &CompiledMcpToolPolicy) -> Value {
    json!({
        "side_effect": policy.side_effect,
        "approval": policy.approval,
        "idempotency": policy.idempotency,
        "retry": policy.retry,
        "legacy_unclassified": policy.legacy_unclassified,
    })
}

fn mcp_annotation_safety_denial(
    policy: &CompiledMcpToolPolicy,
    entry: &mcp_client::McpToolCatalogEntry,
) -> Option<String> {
    let annotations = &entry.annotations;
    if policy.side_effect == brownie_agentmodes::McpToolSideEffect::ReadOnly {
        if annotations.read_only_hint == Some(false) {
            return Some(format!(
                "MCP tool mcp.{}.{} annotation readOnlyHint=false conflicts with Brownie read_only policy and fails closed.",
                entry.server_id, entry.tool_name
            ));
        }
        if annotations.destructive_hint == Some(true) {
            return Some(format!(
                "MCP tool mcp.{}.{} annotation destructiveHint=true conflicts with Brownie read_only policy and fails closed.",
                entry.server_id, entry.tool_name
            ));
        }
        if annotations.open_world_hint == Some(true) {
            return Some(format!(
                "MCP tool mcp.{}.{} annotation openWorldHint=true requires later approval binding and fails closed for autonomous read-only execution.",
                entry.server_id, entry.tool_name
            ));
        }
    }
    if policy.idempotency == brownie_agentmodes::McpToolIdempotency::Safe
        && annotations.idempotent_hint == Some(false)
    {
        return Some(format!(
            "MCP tool mcp.{}.{} annotation idempotentHint=false conflicts with Brownie safe idempotency and fails closed.",
            entry.server_id, entry.tool_name
        ));
    }
    None
}

fn mcp_catalog_provenance_payload(
    catalog: &mcp_client::McpToolCatalog,
    entry: &mcp_client::McpToolCatalogEntry,
) -> Value {
    json!({
        "server_id": entry.server_id,
        "tool_name": entry.tool_name,
        "input_schema_fingerprint": entry.input_schema_fingerprint,
        "output_schema_fingerprint": entry.output_schema_fingerprint,
        "annotations": entry.annotations,
        "annotation_fingerprint": entry.annotation_fingerprint,
        "server_config_identity_fingerprint": entry.server_config_identity_fingerprint,
        "protocol_version": entry.protocol_version,
        "catalog_fingerprint": catalog.catalog_fingerprint,
    })
}

fn mcp_tool_approval_binding_payload(
    record: &TaskRecord,
    tool_id: &str,
    request_fingerprint: &str,
    catalog: &mcp_client::McpToolCatalog,
    entry: &mcp_client::McpToolCatalogEntry,
    mcp_safety_policy: &Value,
) -> Value {
    let mut payload = json!({
        "approval_schema_version": 1,
        "task_id": record.task_id,
        "run_id": record.run_id,
        "tool_id": tool_id,
        "server_id": entry.server_id,
        "tool_name": entry.tool_name,
        "request_fingerprint": request_fingerprint,
        "catalog_provenance": mcp_catalog_provenance_payload(catalog, entry),
        "mcp_safety_policy": mcp_safety_policy,
    });
    let approval_fingerprint =
        runtime_sha256_fingerprint(canonical_json_value(&payload).to_string().as_bytes());
    if let Some(object) = payload.as_object_mut() {
        object.insert(
            "approval_fingerprint".to_string(),
            json!(approval_fingerprint),
        );
    }
    payload
}

fn matching_mcp_tool_approval_bound(
    store: &BrownieStore,
    record: &TaskRecord,
    approval_binding: &Value,
) -> anyhow::Result<bool> {
    let events = store.tasks().read_ledger_events(&record.run_id)?;
    let expected_fingerprint = approval_binding
        .get("approval_fingerprint")
        .and_then(Value::as_str);
    Ok(expected_fingerprint.is_some_and(|fingerprint| {
        events
            .iter()
            .rev()
            .filter(|event| event.kind == LedgerEventKind::McpToolExecutionApproved)
            .filter_map(|event| event.payload.as_ref())
            .any(|payload| {
                payload.get("status").and_then(Value::as_str) == Some("approved")
                    && payload.get("approval_fingerprint").and_then(Value::as_str)
                        == Some(fingerprint)
                    && payload.get("task_id") == approval_binding.get("task_id")
                    && payload.get("run_id") == approval_binding.get("run_id")
                    && payload.get("tool_id") == approval_binding.get("tool_id")
                    && payload.get("server_id") == approval_binding.get("server_id")
                    && payload.get("tool_name") == approval_binding.get("tool_name")
                    && payload.get("request_fingerprint")
                        == approval_binding.get("request_fingerprint")
                    && payload.get("catalog_provenance")
                        == approval_binding.get("catalog_provenance")
                    && payload.get("mcp_safety_policy") == approval_binding.get("mcp_safety_policy")
            })
    }))
}

fn mcp_call_failure_metadata(
    config: &brownie_modepack::ModePackMcpServerConfig,
    tool_name: &str,
    request_fingerprint: &str,
    kind: mcp_client::McpToolCallFailureKind,
    retry_policy: &str,
) -> Value {
    let execution_status = kind.as_str();
    json!({
        "server_id": config.server_id,
        "tool_name": tool_name,
        "protocol_version": mcp_client::MCP_PROTOCOL_VERSION,
        "server_config_identity_fingerprint": config.config_identity_fingerprint,
        "request_fingerprint": request_fingerprint,
        "protocol_status": match kind {
            mcp_client::McpToolCallFailureKind::ProtocolFailed => "ProtocolFailed",
            mcp_client::McpToolCallFailureKind::TimedOut => "TimedOut",
            mcp_client::McpToolCallFailureKind::Failed => "ProtocolSucceeded",
            mcp_client::McpToolCallFailureKind::InputRequiredUnsupported => "InputRequired",
        },
        "tool_status": Value::Null,
        "execution_status": execution_status,
        "retry_policy": retry_policy,
    })
}

fn pinned_mcp_catalog_allows(
    store: &BrownieStore,
    record: &TaskRecord,
    current_catalog: &mcp_client::McpToolCatalog,
    entry: &mcp_client::McpToolCatalogEntry,
) -> anyhow::Result<bool> {
    let events = store.tasks().read_ledger_events(&record.run_id)?;
    let Some(payload) = events
        .iter()
        .rev()
        .find(|event| event.kind == LedgerEventKind::ModeResolved)
        .and_then(|event| event.payload.as_ref())
    else {
        return Ok(false);
    };
    let Some(catalogs) = payload.get("mcp_tool_catalogs").and_then(Value::as_array) else {
        return Ok(false);
    };
    Ok(catalogs.iter().any(|catalog| {
        catalog.get("server_id").and_then(Value::as_str) == Some(entry.server_id.as_str())
            && catalog
                .get("server_config_identity_fingerprint")
                .and_then(Value::as_str)
                == Some(entry.server_config_identity_fingerprint.as_str())
            && catalog.get("protocol_version").and_then(Value::as_str)
                == Some(entry.protocol_version.as_str())
            && catalog.get("catalog_fingerprint").and_then(Value::as_str)
                == Some(current_catalog.catalog_fingerprint.as_str())
            && catalog
                .get("tools")
                .and_then(Value::as_array)
                .map(|tools| {
                    tools.iter().any(|tool| {
                        tool.get("tool_id").and_then(Value::as_str) == Some(entry.tool_id.as_str())
                            && tool.get("tool_name").and_then(Value::as_str)
                                == Some(entry.tool_name.as_str())
                            && tool.get("input_schema_fingerprint").and_then(Value::as_str)
                                == Some(entry.input_schema_fingerprint.as_str())
                            && tool
                                .get("output_schema_fingerprint")
                                .and_then(Value::as_str)
                                == entry.output_schema_fingerprint.as_deref()
                            && tool.get("annotation_fingerprint").and_then(Value::as_str)
                                == Some(entry.annotation_fingerprint.as_str())
                            && tool.get("annotations") == Some(&json!(entry.annotations))
                    })
                })
                .unwrap_or(false)
    }))
}

fn pinned_mcp_dynamic_tool_definitions(
    store: &BrownieStore,
    record: &TaskRecord,
) -> anyhow::Result<Vec<ToolDefinition>> {
    let events = store.tasks().read_ledger_events(&record.run_id)?;
    let Some(payload) = events
        .iter()
        .rev()
        .find(|event| event.kind == LedgerEventKind::ModeResolved)
        .and_then(|event| event.payload.as_ref())
    else {
        return Ok(Vec::new());
    };
    Ok(mcp_dynamic_tool_definitions_from_payload(payload))
}

fn mcp_dynamic_tool_definitions_from_payload(payload: &Value) -> Vec<ToolDefinition> {
    payload
        .get("mcp_tool_catalogs")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|catalog| catalog.get("tools").and_then(Value::as_array))
        .flatten()
        .filter_map(|tool| {
            let tool_id = tool.get("tool_id")?.as_str()?.to_string();
            let server_id = tool.get("server_id")?.as_str()?.to_string();
            let tool_name = tool.get("tool_name")?.as_str()?.to_string();
            let description = tool
                .get("description")
                .and_then(Value::as_str)
                .unwrap_or("Task-pinned MCP tool from bounded runtime catalog.")
                .to_string();
            let fields = tool
                .get("input_schema_summary")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|field| {
                    let name = field.get("name")?.as_str()?.to_string();
                    let required = field
                        .get("required")
                        .and_then(Value::as_bool)
                        .unwrap_or(false);
                    let value_type = field
                        .get("type")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown");
                    Some(ToolInputField {
                        name,
                        required,
                        description: format!("MCP input field type={value_type}."),
                    })
                })
                .collect::<Vec<_>>();
            Some(ToolDefinition {
                tool_id,
                display_name: format!("MCP {server_id}.{tool_name}"),
                description,
                required_action: RuntimeAction::UseMcpTool,
                input_schema: ToolInputSchema { fields },
            })
        })
        .collect()
}

fn mcp_server_config_for_policy(
    store: &BrownieStore,
    record: &TaskRecord,
    server_id: &str,
) -> anyhow::Result<Option<brownie_modepack::ModePackMcpServerConfig>> {
    let events = store.tasks().read_ledger_events(&record.run_id)?;
    let expected_activation_fingerprint = events
        .iter()
        .rev()
        .find(|event| event.kind == LedgerEventKind::ModeResolved)
        .and_then(|event| event.payload.as_ref())
        .and_then(|payload| payload.get("external_modepack_task_provenance"))
        .and_then(|provenance| provenance.get("activation_fingerprint"))
        .and_then(Value::as_str);
    let Some(expected_activation_fingerprint) = expected_activation_fingerprint else {
        return Ok(None);
    };
    let Some(snapshot) =
        store.read_active_modepack_snapshot_by_fingerprint(expected_activation_fingerprint)?
    else {
        return Ok(None);
    };
    Ok(snapshot
        .mcp_servers
        .into_iter()
        .filter_map(|server| {
            serde_json::from_value::<brownie_modepack::ModePackMcpServerConfig>(server).ok()
        })
        .find(|server| server.server_id == server_id))
}

pub(super) fn tool_summary(tool: brownie_tools::ToolDefinition) -> ToolSummary {
    ToolSummary {
        tool_id: tool.tool_id,
        display_name: tool.display_name,
        description: tool.description,
        required_action: runtime_action_name(&tool.required_action),
    }
}

pub(super) fn build_tool_plan_result(
    record: &brownie_protocol::TaskRecord,
    policy: &CompiledModePolicy,
) -> ToolPlanResult {
    let plan = ToolPlanner::plan(ToolPlanningInput {
        task_id: record.task_id.clone(),
        goal: record.goal.clone(),
        mode_id: policy.mode_id.clone(),
    });
    let evaluation = ToolPlanEvaluator::evaluate(policy, plan);
    ToolPlanResult {
        task_id: record.task_id.clone(),
        run_id: record.run_id.clone(),
        mode_id: policy.mode_id.clone(),
        items: evaluation
            .items
            .into_iter()
            .map(tool_plan_decision_summary)
            .collect(),
    }
}

pub(super) fn tool_plan_decision_summary(decision: ToolPlanDecision) -> ToolPlanDecisionSummary {
    ToolPlanDecisionSummary {
        tool_id: decision.tool_id,
        required_action: runtime_action_name(&decision.required_action),
        allowed: decision.allowed,
        reason: decision.reason,
    }
}

pub(super) fn tool_intent_decision_summary(
    decision: ToolIntentDecision,
) -> ToolIntentDecisionSummary {
    ToolIntentDecisionSummary {
        tool_id: decision.tool_id,
        required_action: runtime_action_name(&decision.required_action),
        allowed: decision.allowed,
        reason: decision.reason,
        request_reason: decision.request_reason,
        input_summary: tool_intent_input_summary(&decision.input),
    }
}

pub(super) fn tool_intent_rejected_summary(
    rejected: RejectedToolIntent,
) -> ToolIntentRejectedSummary {
    ToolIntentRejectedSummary {
        tool_id: rejected.tool_id,
        reason: rejected.reason,
        code: rejected.code,
    }
}

pub(super) fn tool_intent_parser_summary(
    summary: brownie_tools::ToolIntentParserSummary,
) -> ToolIntentParserSummary {
    ToolIntentParserSummary {
        found_blocks: summary.found_blocks,
        accepted_blocks: summary.accepted_blocks,
        accepted_requests: summary.accepted_requests,
        rejected_requests: summary.rejected_requests,
        max_blocks: summary.max_blocks,
        max_block_bytes: summary.max_block_bytes,
        max_tool_requests: summary.max_tool_requests,
        max_input_bytes: summary.max_input_bytes,
        max_reason_chars: summary.max_reason_chars,
        max_workspace_write_content_chars: summary.max_workspace_write_content_chars,
    }
}

pub(super) fn tool_intent_parser_config_summary() -> ToolIntentParserConfigSummary {
    let config = ToolIntentParser::config();
    ToolIntentParserConfigSummary {
        max_blocks: config.max_blocks,
        max_block_bytes: config.max_block_bytes,
        max_tool_requests: config.max_tool_requests,
        max_input_bytes: config.max_input_bytes,
        max_reason_chars: config.max_reason_chars,
        max_workspace_write_content_chars: config.max_workspace_write_content_chars,
    }
}

pub(super) fn tool_intent_input_summary(input: &Value) -> ToolIntentInputSummary {
    ToolIntentInputSummary {
        has_path: input.get("path").and_then(Value::as_str).is_some(),
        field_count: input.as_object().map(|object| object.len()).unwrap_or(0),
    }
}

pub(super) fn summarize_intent_input(input: &Value) -> Value {
    json!(tool_intent_input_summary(input))
}

#[derive(Debug, Clone)]
struct RuntimeGitCommitPathAuthorization {
    proposal_id: String,
    apply_id: String,
    path: String,
    operation: String,
    expected_target_sha256: Option<String>,
    expected_target_absent: Option<bool>,
    pre_write_target_sha256: Option<String>,
    pre_write_target_exists: Option<bool>,
    post_write_sha256: Option<String>,
    post_delete_target_exists: Option<bool>,
    content_bytes: u64,
}

fn runtime_git_commit_execution_input(
    store: &BrownieStore,
    record: &TaskRecord,
    policy: &CompiledModePolicy,
    input: &Value,
    intent_index: usize,
) -> anyhow::Result<Result<Value, String>> {
    let message = match validate_runtime_git_commit_public_input(input) {
        Ok(message) => message,
        Err(reason) => return Ok(Err(reason)),
    };

    let events = store.tasks().read_ledger_events(&record.run_id)?;
    let Some(journey_id) = latest_headless_journey_id(&events) else {
        return Ok(Err(
            "git.commit requires runtime-owned journey provenance.".to_string()
        ));
    };
    let paths = match collect_runtime_git_commit_path_authorizations(&events) {
        Ok(paths) => paths,
        Err(reason) => return Ok(Err(reason)),
    };
    if paths.is_empty() {
        return Ok(Err(
            "git.commit requires prior authorized workspace mutation evidence.".to_string(),
        ));
    }

    let authorized_change_set_fingerprint =
        runtime_git_commit_change_set_fingerprint(record, &journey_id, &paths);
    let workspace_write_scope_fingerprint =
        runtime_git_commit_workspace_scope_fingerprint(policy, &paths);
    let message_fingerprint = runtime_sha256_fingerprint(message.as_bytes());
    let expected_parent_head = latest_completed_git_commit_expected_parent(
        &events,
        &message_fingerprint,
        &authorized_change_set_fingerprint,
    )
    .map(Ok)
    .unwrap_or_else(|| {
        brownie_tools::GitCommandExecutor::current_head(store.workspace_root())?
            .ok_or_else(|| anyhow::anyhow!("git.commit requires an existing parent HEAD."))
    })?;
    let logical_invocation_id = runtime_git_commit_logical_invocation_id(
        record,
        &journey_id,
        intent_index,
        &authorized_change_set_fingerprint,
    );
    let apply_ids = paths
        .iter()
        .map(|path| path.apply_id.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let proposal_ids = paths
        .iter()
        .map(|path| path.proposal_id.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let path_payloads = paths
        .iter()
        .map(|path| {
            json!({
                "path": path.path,
                "operation": path.operation,
                "post_write_sha256": path.post_write_sha256,
                "expected_target_absent": path.expected_target_absent,
                "post_delete_target_exists": path.post_delete_target_exists,
            })
        })
        .collect::<Vec<_>>();

    Ok(Ok(json!({
        "message": message,
        "commit_authorization": {
            "version": "brownie_git_commit_authorization_v1",
            "task_id": record.task_id,
            "run_id": record.run_id,
            "journey_id": journey_id,
            "apply_ids": apply_ids,
            "proposal_ids": proposal_ids,
            "paths": path_payloads,
            "expected_parent_head": expected_parent_head,
            "authorized_change_set_fingerprint": authorized_change_set_fingerprint,
            "workspace_write_scope_fingerprint": workspace_write_scope_fingerprint,
            "logical_invocation_id": logical_invocation_id,
        },
    })))
}

fn validate_runtime_git_commit_public_input(input: &Value) -> Result<String, String> {
    let Some(object) = input.as_object() else {
        return Err("git capability input must be an object.".to_string());
    };
    for key in object.keys() {
        match key.as_str() {
            "message" => {}
            "commit_authorization" => {
                return Err(
                    "git.commit commit_authorization is runtime-private and cannot be caller-supplied."
                        .to_string(),
                );
            }
            "command" | "argv" | "args" | "cwd" | "env" | "stdin" | "shell" | "timeout"
            | "timeout_ms" | "remote" | "path" | "paths" | "branch" | "ref" | "revision" => {
                return Err("git capability does not accept command, argv, cwd, env, stdin, shell, timeout, remote, path, branch, ref, or revision input.".to_string());
            }
            _ => return Err("git.commit does not accept unknown input fields.".to_string()),
        }
    }
    let Some(message) = object.get("message").and_then(Value::as_str) else {
        return Err("git.commit input.message must be a string.".to_string());
    };
    let message = message.trim();
    if message.is_empty() {
        return Err("git.commit input.message must not be empty.".to_string());
    }
    if message.chars().count() > MAX_GIT_COMMIT_MESSAGE_CHARS {
        return Err("git.commit input.message exceeds the maximum length.".to_string());
    }
    if message
        .chars()
        .any(|ch| ch.is_control() && ch != '\n' && ch != '\t')
    {
        return Err(
            "git.commit input.message contains unsupported control characters.".to_string(),
        );
    }
    Ok(message.to_string())
}

fn latest_headless_journey_id(events: &[LedgerEvent]) -> Option<String> {
    events.iter().rev().find_map(|event| {
        event
            .payload
            .as_ref()
            .and_then(|payload| payload.get("journey_id"))
            .and_then(Value::as_str)
            .filter(|journey_id| !journey_id.trim().is_empty())
            .map(ToString::to_string)
    })
}

fn collect_runtime_git_commit_path_authorizations(
    events: &[LedgerEvent],
) -> Result<Vec<RuntimeGitCommitPathAuthorization>, String> {
    let mut by_path = BTreeMap::new();
    for event in events {
        if event.kind != LedgerEventKind::WorkspacePatchApplyResultRecorded {
            continue;
        }
        let Some(payload) = event.payload.as_ref() else {
            continue;
        };
        if let Some(items) = payload.get("transaction_items").and_then(Value::as_array) {
            let Some(apply_id) = payload.get("apply_id").and_then(Value::as_str) else {
                return Err(
                    "git.commit transaction apply evidence is missing apply_id.".to_string()
                );
            };
            for item in items {
                if let Some(path) =
                    runtime_git_commit_path_authorization_from_payload(item, Some(apply_id))?
                {
                    by_path.insert(path.path.clone(), path);
                }
            }
            continue;
        }
        if let Some(path) = runtime_git_commit_path_authorization_from_payload(payload, None)? {
            by_path.insert(path.path.clone(), path);
        }
    }
    Ok(by_path.into_values().collect())
}

fn runtime_git_commit_path_authorization_from_payload(
    payload: &Value,
    transaction_apply_id: Option<&str>,
) -> Result<Option<RuntimeGitCommitPathAuthorization>, String> {
    if payload.get("applied").and_then(Value::as_bool) != Some(true)
        || payload.get("apply_status").and_then(Value::as_str) != Some("Applied")
    {
        return Ok(None);
    }
    let proposal_id = payload
        .get("proposal_id")
        .and_then(Value::as_str)
        .ok_or_else(|| "git.commit apply evidence is missing proposal_id.".to_string())?
        .to_string();
    let apply_id = transaction_apply_id
        .map(ToString::to_string)
        .or_else(|| {
            payload
                .get("apply_id")
                .and_then(Value::as_str)
                .map(ToString::to_string)
        })
        .ok_or_else(|| "git.commit apply evidence is missing apply_id.".to_string())?;
    let path = payload
        .get("path")
        .and_then(Value::as_str)
        .ok_or_else(|| "git.commit apply evidence is missing path.".to_string())?
        .to_string();
    brownie_tools::preflight_workspace_write_path(&path)
        .map_err(|reason| format!("git.commit apply evidence path is invalid: {reason}"))?;
    let operation = payload
        .get("operation")
        .and_then(Value::as_str)
        .ok_or_else(|| "git.commit apply evidence is missing operation.".to_string())?
        .to_string();
    let post_write_sha256 = optional_sha256_payload(payload, "post_write_sha256")?;
    let post_delete_target_exists = payload
        .get("post_delete_target_exists")
        .and_then(Value::as_bool);
    if operation == WorkspacePatchOperation::DeleteFile.as_str() {
        if post_delete_target_exists != Some(false) {
            return Err("git.commit delete evidence must prove the path is absent.".to_string());
        }
    } else if post_write_sha256.is_none() {
        return Err("git.commit write evidence is missing post_write_sha256.".to_string());
    }
    Ok(Some(RuntimeGitCommitPathAuthorization {
        proposal_id,
        apply_id,
        path,
        operation,
        expected_target_sha256: optional_sha256_payload(payload, "expected_target_sha256")?,
        expected_target_absent: payload
            .get("expected_target_absent")
            .and_then(Value::as_bool),
        pre_write_target_sha256: optional_sha256_payload(payload, "pre_write_target_sha256")?,
        pre_write_target_exists: payload
            .get("pre_write_target_exists")
            .and_then(Value::as_bool),
        post_write_sha256,
        post_delete_target_exists,
        content_bytes: payload
            .get("content_bytes")
            .and_then(Value::as_u64)
            .unwrap_or(0),
    }))
}

fn optional_sha256_payload(payload: &Value, key: &str) -> Result<Option<String>, String> {
    match payload.get(key) {
        Some(Value::String(value)) => {
            if !is_sha256_fingerprint(value) {
                return Err(format!("git.commit apply evidence {key} is malformed."));
            }
            Ok(Some(value.clone()))
        }
        Some(Value::Null) | None => Ok(None),
        _ => Err(format!(
            "git.commit apply evidence {key} must be a string or null."
        )),
    }
}

fn runtime_git_commit_change_set_fingerprint(
    record: &TaskRecord,
    journey_id: &str,
    paths: &[RuntimeGitCommitPathAuthorization],
) -> String {
    let canonical_paths = paths
        .iter()
        .map(|path| {
            json!({
                "proposal_id": path.proposal_id,
                "apply_id": path.apply_id,
                "path": path.path,
                "operation": path.operation,
                "expected_target_sha256": path.expected_target_sha256,
                "expected_target_absent": path.expected_target_absent,
                "pre_write_target_sha256": path.pre_write_target_sha256,
                "pre_write_target_exists": path.pre_write_target_exists,
                "post_write_sha256": path.post_write_sha256,
                "post_delete_target_exists": path.post_delete_target_exists,
                "content_bytes": path.content_bytes,
            })
        })
        .collect::<Vec<_>>();
    let canonical = json!({
        "version": "brownie_runtime_git_commit_change_set_v1",
        "task_id": record.task_id,
        "run_id": record.run_id,
        "journey_id": journey_id,
        "paths": canonical_paths,
    });
    runtime_sha256_fingerprint(canonical.to_string().as_bytes())
}

fn runtime_git_commit_workspace_scope_fingerprint(
    policy: &CompiledModePolicy,
    paths: &[RuntimeGitCommitPathAuthorization],
) -> String {
    let canonical = json!({
        "version": "brownie_runtime_git_commit_workspace_scope_v1",
        "mode_id": policy.mode_id,
        "workspace_write_scope_count": policy.workspace_write_scopes.len(),
        "workspace_write_scopes": policy.workspace_write_scopes,
        "authorized_paths": paths.iter().map(|path| &path.path).collect::<Vec<_>>(),
    });
    runtime_sha256_fingerprint(canonical.to_string().as_bytes())
}

fn runtime_git_commit_logical_invocation_id(
    record: &TaskRecord,
    journey_id: &str,
    intent_index: usize,
    authorized_change_set_fingerprint: &str,
) -> String {
    let canonical = json!({
        "version": "brownie_runtime_git_commit_tool_invocation_v1",
        "task_id": record.task_id,
        "run_id": record.run_id,
        "journey_id": journey_id,
        "tool_id": GIT_COMMIT_TOOL_ID,
        "intent_index": intent_index,
        "authorized_change_set_fingerprint": authorized_change_set_fingerprint,
    });
    runtime_sha256_fingerprint(canonical.to_string().as_bytes())
}

fn latest_completed_git_commit_expected_parent(
    events: &[LedgerEvent],
    message_fingerprint: &str,
    authorized_change_set_fingerprint: &str,
) -> Option<String> {
    events.iter().rev().find_map(|event| {
        if event.kind != LedgerEventKind::ToolExecutionCompleted {
            return None;
        }
        let payload = event.payload.as_ref()?;
        if payload.get("tool_id").and_then(Value::as_str) != Some(GIT_COMMIT_TOOL_ID)
            || payload.get("message_fingerprint").and_then(Value::as_str)
                != Some(message_fingerprint)
            || payload
                .get("authorized_change_set_fingerprint")
                .and_then(Value::as_str)
                != Some(authorized_change_set_fingerprint)
        {
            return None;
        }
        payload
            .get("expected_parent_head")
            .and_then(Value::as_str)
            .filter(|head| !head.trim().is_empty())
            .map(ToString::to_string)
    })
}

fn git_commit_authorization_failed_payload(reason: String) -> Value {
    json!({
        "reason": reason,
        "operation": "commit",
        "runtime_authorization_required": true,
        "process_launched": false,
        "mutation_process_launched": false,
        "raw_diff_redacted": true,
        "raw_file_content_redacted": true,
        "raw_message_redacted": true,
        "absolute_paths_redacted": true,
    })
}

fn runtime_sha256_fingerprint(bytes: &[u8]) -> String {
    format!("sha256:{}", hex_sha256(bytes))
}

pub(super) fn normalized_subtask_spawn_goal_preview(input: &Value) -> Option<String> {
    input
        .get("goal")
        .and_then(Value::as_str)
        .map(|goal| goal.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|goal| !goal.is_empty())
        .map(|goal| preview_with_limit(&goal, MAX_SUBTASK_SPAWN_GOAL_CHARS))
}

pub(super) fn normalized_subtask_spawn_mode_id(input: &Value) -> Option<String> {
    input
        .get("mode_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|mode_id| !mode_id.is_empty())
        .map(ToString::to_string)
}

pub(super) fn subtask_spawn_input_runtime_rejection_reason(
    store: &BrownieStore,
    policy: &CompiledModePolicy,
    input: &Value,
) -> anyhow::Result<Option<&'static str>> {
    let Some(mode_id) = normalized_subtask_spawn_mode_id(input) else {
        return Ok(None);
    };
    if resolve_workspace_mode_policy(store, &mode_id)
        .map_err(anyhow::Error::msg)?
        .is_none()
    {
        return Ok(Some("subtask.spawn input.mode_id is unknown."));
    }
    if let Some(allowed_handoff_targets) = policy.allowed_handoff_targets.as_ref() {
        if allowed_handoff_targets
            .iter()
            .any(|allowed_mode_id| allowed_mode_id == HANDOFF_TARGET_ALL_MODEPACK_MODES)
        {
            if mode_id == policy.mode_id {
                return Ok(Some(
                    "subtask.spawn input.mode_id cannot target the active mode through the all-modepack handoff selector.",
                ));
            }
            return Ok(None);
        }
        if !allowed_handoff_targets
            .iter()
            .any(|allowed_mode_id| allowed_mode_id == &mode_id)
        {
            return Ok(Some(
                "subtask.spawn input.mode_id is not allowed by active mode handoff policy.",
            ));
        }
    }
    Ok(None)
}

pub(super) fn tool_execute_result(result: brownie_tools::ToolExecutionResult) -> ToolExecuteResult {
    ToolExecuteResult {
        tool_id: result.tool_id,
        status: match result.status {
            ToolExecutionStatus::Completed => ToolExecuteStatus::Completed,
            ToolExecutionStatus::Denied => ToolExecuteStatus::Denied,
            ToolExecutionStatus::Failed => ToolExecuteStatus::Failed,
        },
        output: result.output,
    }
}

pub(super) const VERIFICATION_COMPLETION_GATE_STATUS_PASSED: &str = "Passed";
pub(super) const VERIFICATION_COMPLETION_GATE_STATUS_FAILED: &str = "Failed";

pub(super) struct RequiredVerificationIntent {
    tool_id: String,
    event_index: usize,
    rejected: bool,
    requirement_fingerprint: Option<String>,
}

#[derive(Debug, Clone)]
pub(super) struct RuntimeVerificationRequirement {
    pub(super) requirement_id: String,
    pub(super) source_kind: String,
    pub(super) source_apply_id: String,
    pub(super) requirement_fingerprint: String,
    pub(super) required_verifier_tool_ids: Vec<String>,
}

pub(super) fn verification_completion_gate_for_run(
    events: &[LedgerEvent],
) -> Option<TaskRunVerificationCompletionGate> {
    verification_completion_gate_for_run_with_requirement(events, None)
}

pub(super) fn verification_completion_gate_for_run_with_requirement(
    events: &[LedgerEvent],
    runtime_requirement: Option<&RuntimeVerificationRequirement>,
) -> Option<TaskRunVerificationCompletionGate> {
    let mut required = required_verification_intents(events);
    if let Some(requirement) = runtime_requirement {
        for tool_id in &requirement.required_verifier_tool_ids {
            if required.iter().any(|intent| intent.tool_id == *tool_id) {
                continue;
            }
            required.push(RequiredVerificationIntent {
                tool_id: tool_id.clone(),
                event_index: 0,
                rejected: false,
                requirement_fingerprint: Some(requirement.requirement_fingerprint.clone()),
            });
        }
    }
    if required.is_empty() {
        return None;
    }

    let mut passed_verifier_tool_ids = Vec::new();
    let mut failed_verifier_tool_ids = Vec::new();
    let mut missing_verifier_tool_ids = Vec::new();
    let mut failure_reasons = Vec::new();
    let mut bounded_cargo_diagnostics = Vec::new();

    for intent in &required {
        if intent.rejected {
            failed_verifier_tool_ids.push(intent.tool_id.clone());
            failure_reasons.push(format!("{}:RejectedToolIntent", intent.tool_id));
            continue;
        }

        match terminal_verification_event_after(events, intent.event_index, &intent.tool_id) {
            Some(event)
                if intent.requirement_fingerprint.as_deref().is_some()
                    && !event_matches_requirement(
                        event,
                        intent.requirement_fingerprint.as_deref(),
                    ) =>
            {
                failed_verifier_tool_ids.push(intent.tool_id.clone());
                missing_verifier_tool_ids.push(intent.tool_id.clone());
                failure_reasons.push(format!("{}:RequirementFingerprintMismatch", intent.tool_id));
            }
            Some(event) if event.kind == LedgerEventKind::ToolExecutionCompleted => {
                let verification_status = event
                    .payload
                    .as_ref()
                    .and_then(|payload| payload.get("verification_status"))
                    .and_then(Value::as_str);
                if verification_status == Some(VERIFICATION_COMPLETION_GATE_STATUS_PASSED) {
                    passed_verifier_tool_ids.push(intent.tool_id.clone());
                } else {
                    push_bounded_cargo_diagnostics(
                        &mut bounded_cargo_diagnostics,
                        bounded_cargo_diagnostics_from_event(event),
                    );
                    failed_verifier_tool_ids.push(intent.tool_id.clone());
                    failure_reasons.push(format!(
                        "{}:{}",
                        intent.tool_id,
                        verification_status.unwrap_or("MalformedTerminalEvidence")
                    ));
                }
            }
            Some(event) if event.kind == LedgerEventKind::ToolExecutionDenied => {
                failed_verifier_tool_ids.push(intent.tool_id.clone());
                failure_reasons.push(format!("{}:Denied", intent.tool_id));
            }
            Some(event) if event.kind == LedgerEventKind::ToolExecutionFailed => {
                let verification_status = event
                    .payload
                    .as_ref()
                    .and_then(|payload| payload.get("verification_status"))
                    .and_then(Value::as_str)
                    .unwrap_or("Failed");
                push_bounded_cargo_diagnostics(
                    &mut bounded_cargo_diagnostics,
                    bounded_cargo_diagnostics_from_event(event),
                );
                failed_verifier_tool_ids.push(intent.tool_id.clone());
                failure_reasons.push(format!("{}:{verification_status}", intent.tool_id));
            }
            Some(_) => {
                failed_verifier_tool_ids.push(intent.tool_id.clone());
                failure_reasons.push(format!("{}:MalformedTerminalEvidence", intent.tool_id));
            }
            None => {
                failed_verifier_tool_ids.push(intent.tool_id.clone());
                missing_verifier_tool_ids.push(intent.tool_id.clone());
                let reason = if stale_verification_event_before(
                    events,
                    intent.event_index,
                    &intent.tool_id,
                    intent.requirement_fingerprint.as_deref(),
                ) {
                    "StaleTerminalEvidence"
                } else {
                    "MissingTerminalEvidence"
                };
                failure_reasons.push(format!("{}:{reason}", intent.tool_id));
            }
        }
    }

    let required_verifier_tool_ids = required
        .iter()
        .map(|intent| intent.tool_id.clone())
        .collect::<Vec<_>>();
    let status = if failed_verifier_tool_ids.is_empty() {
        VERIFICATION_COMPLETION_GATE_STATUS_PASSED
    } else {
        VERIFICATION_COMPLETION_GATE_STATUS_FAILED
    };
    let next_action = if failed_verifier_tool_ids.is_empty() {
        "complete_task"
    } else {
        "inspect_verification_failure_and_retry_task"
    };

    Some(TaskRunVerificationCompletionGate {
        status: status.to_string(),
        requirement_id: runtime_requirement.map(|requirement| requirement.requirement_id.clone()),
        requirement_source_kind: runtime_requirement
            .map(|requirement| requirement.source_kind.clone()),
        source_apply_id: runtime_requirement.map(|requirement| requirement.source_apply_id.clone()),
        requirement_fingerprint: runtime_requirement
            .map(|requirement| requirement.requirement_fingerprint.clone()),
        required_verifier_count: required_verifier_tool_ids.len(),
        passed_verifier_count: passed_verifier_tool_ids.len(),
        failed_verifier_count: failed_verifier_tool_ids.len(),
        required_verifier_tool_ids,
        passed_verifier_tool_ids,
        failed_verifier_tool_ids,
        missing_verifier_tool_ids,
        failure_reasons,
        bounded_cargo_diagnostics,
        next_action: next_action.to_string(),
    })
}

pub(super) fn required_verification_intents(
    events: &[LedgerEvent],
) -> Vec<RequiredVerificationIntent> {
    let mut required: Vec<RequiredVerificationIntent> = Vec::new();
    for (event_index, event) in events.iter().enumerate() {
        if !matches!(
            event.kind,
            LedgerEventKind::ToolIntentPermissionChecked | LedgerEventKind::ToolIntentRejected
        ) {
            continue;
        }
        let Some(tool_id) = event
            .payload
            .as_ref()
            .and_then(|payload| payload.get("tool_id"))
            .and_then(Value::as_str)
        else {
            continue;
        };
        if !is_verification_tool_id(tool_id) {
            continue;
        }
        let rejected = event.kind == LedgerEventKind::ToolIntentRejected;
        if let Some(position) = required.iter().position(|intent| intent.tool_id == tool_id) {
            required[position].event_index = event_index;
            required[position].rejected = rejected;
            required[position].requirement_fingerprint = event
                .payload
                .as_ref()
                .and_then(|payload| payload.get("verification_requirement_fingerprint"))
                .and_then(Value::as_str)
                .map(ToString::to_string);
        } else {
            required.push(RequiredVerificationIntent {
                tool_id: tool_id.to_string(),
                event_index,
                rejected,
                requirement_fingerprint: event
                    .payload
                    .as_ref()
                    .and_then(|payload| payload.get("verification_requirement_fingerprint"))
                    .and_then(Value::as_str)
                    .map(ToString::to_string),
            });
        }
    }
    required
}

pub(super) fn terminal_verification_event_after<'a>(
    events: &'a [LedgerEvent],
    required_event_index: usize,
    tool_id: &str,
) -> Option<&'a LedgerEvent> {
    events
        .iter()
        .enumerate()
        .rev()
        .filter(|(event_index, _)| *event_index > required_event_index)
        .map(|(_, event)| event)
        .find(|event| is_terminal_verification_event_for_tool(event, tool_id))
}

pub(super) fn stale_verification_event_before(
    events: &[LedgerEvent],
    required_event_index: usize,
    tool_id: &str,
    requirement_fingerprint: Option<&str>,
) -> bool {
    events.iter().enumerate().any(|(event_index, event)| {
        event_index < required_event_index
            && is_terminal_verification_event_for_tool(event, tool_id)
            && event_matches_requirement(event, requirement_fingerprint)
    })
}

pub(super) fn is_terminal_verification_event_for_tool(event: &LedgerEvent, tool_id: &str) -> bool {
    matches!(
        event.kind,
        LedgerEventKind::ToolExecutionCompleted
            | LedgerEventKind::ToolExecutionDenied
            | LedgerEventKind::ToolExecutionFailed
    ) && event
        .payload
        .as_ref()
        .and_then(|payload| payload.get("tool_id"))
        .and_then(Value::as_str)
        == Some(tool_id)
}

pub(super) fn event_matches_requirement(
    event: &LedgerEvent,
    requirement_fingerprint: Option<&str>,
) -> bool {
    match requirement_fingerprint {
        Some(requirement_fingerprint) => {
            event
                .payload
                .as_ref()
                .and_then(|payload| payload.get("verification_requirement_fingerprint"))
                .and_then(Value::as_str)
                == Some(requirement_fingerprint)
        }
        None => true,
    }
}

pub(super) fn is_verification_tool_id(tool_id: &str) -> bool {
    matches!(
        tool_id,
        VERIFICATION_CARGO_FMT_CHECK_TOOL_ID
            | VERIFICATION_CARGO_CHECK_TOOL_ID
            | VERIFICATION_CARGO_TEST_TOOL_ID
    )
}

pub(super) fn append_tool_intent_events(
    store: &BrownieStore,
    record: &brownie_protocol::TaskRecord,
    policy: &CompiledModePolicy,
    assistant_content: &str,
) -> anyhow::Result<()> {
    let parsed = ToolIntentParser::parse_assistant_content(assistant_content);
    store.tasks().append_task_event_with_payload(
        record,
        LedgerEventKind::ToolIntentParsed,
        Some(json!({
            "tool_ids": parsed.requests.iter().map(|request| request.tool_id.as_str()).collect::<Vec<_>>(),
            "parser": parsed.summary,
        })),
    )?;
    let dynamic_tools = pinned_mcp_dynamic_tool_definitions(store, record)?;
    let evaluation =
        ToolIntentEvaluator::evaluate_with_dynamic_tools(policy, parsed, &dynamic_tools);
    for rejected in evaluation.rejected {
        store.tasks().append_task_event_with_payload(
            record,
            LedgerEventKind::ToolIntentRejected,
            Some(json!({ "tool_id": rejected.tool_id, "reason": rejected.reason, "code": rejected.code })),
        )?;
    }
    for decision in evaluation.items {
        let runtime_rejection_reason =
            if decision.allowed && decision.tool_id == SUBTASK_SPAWN_TOOL_ID {
                subtask_spawn_input_runtime_rejection_reason(store, policy, &decision.input)?
            } else {
                None
            };
        let allowed = decision.allowed && runtime_rejection_reason.is_none();
        let reason = runtime_rejection_reason.unwrap_or(decision.reason.as_str());
        let mut payload = json!({
            "tool_id": decision.tool_id,
            "required_action": runtime_action_name(&decision.required_action),
            "allowed": allowed,
            "reason": reason,
            "request_reason": decision.request_reason,
            "input_summary": summarize_intent_input(&decision.input),
        });
        if runtime_rejection_reason.is_some() {
            payload["mode_id"] = json!(policy.mode_id);
            if let Some(mode_id) = normalized_subtask_spawn_mode_id(&decision.input) {
                payload["requested_mode_id"] = json!(mode_id);
            }
        }
        store.tasks().append_task_event_with_payload(
            record,
            LedgerEventKind::ToolIntentPermissionChecked,
            Some(payload.clone()),
        )?;
        store.tasks().append_task_event_with_payload(
            record,
            if allowed {
                LedgerEventKind::ToolIntentApproved
            } else {
                LedgerEventKind::ToolIntentDenied
            },
            Some(payload),
        )?;
    }
    Ok(())
}

pub(super) fn handle_approved_workspace_intents(
    store: &BrownieStore,
    record: &brownie_protocol::TaskRecord,
    policy: &CompiledModePolicy,
    assistant_content: &str,
) -> anyhow::Result<()> {
    let dynamic_tools = pinned_mcp_dynamic_tool_definitions(store, record)?;
    let evaluation = ToolIntentEvaluator::evaluate_with_dynamic_tools(
        policy,
        ToolIntentParser::parse_assistant_content(assistant_content),
        &dynamic_tools,
    );
    let is_verification_recovery_task = record.verification_recovery_provenance.is_some();
    let mut verification_recovery_proposal_seen =
        match record.verification_recovery_provenance.as_ref() {
            Some(provenance) => {
                !verification_recovery_repair_proposals_for_run(store, record, provenance)?
                    .is_empty()
            }
            None => false,
        };
    for (intent_index, decision) in evaluation.items.into_iter().enumerate() {
        let builtin_controlled_execution_tool = matches!(
            decision.tool_id.as_str(),
            WORKSPACE_READ_TOOL_ID
                | VERIFICATION_CARGO_FMT_CHECK_TOOL_ID
                | VERIFICATION_CARGO_CHECK_TOOL_ID
                | VERIFICATION_CARGO_TEST_TOOL_ID
                | GIT_STATUS_TOOL_ID
                | GIT_DIFF_TOOL_ID
                | GIT_COMMIT_TOOL_ID
        );
        let mcp_execution_tool = mcp_client::split_normalized_tool_id(&decision.tool_id).is_some();
        if !decision.allowed {
            if builtin_controlled_execution_tool {
                append_controlled_tool_execution_denied(store, record, policy, &decision)?;
            }
            continue;
        }
        if decision.tool_id == WORKSPACE_WRITE_TOOL_ID {
            if is_verification_recovery_task && verification_recovery_proposal_seen {
                continue;
            }
            append_workspace_patch_proposal(store, record, policy, &decision)?;
            if is_verification_recovery_task {
                verification_recovery_proposal_seen = true;
            }
            continue;
        }
        if decision.tool_id == SUBTASK_SPAWN_TOOL_ID {
            if subtask_spawn_input_runtime_rejection_reason(store, policy, &decision.input)?
                .is_some()
            {
                continue;
            }
            append_subtask_orchestration_queued(store, record, policy, &decision)?;
            continue;
        }
        if mcp_execution_tool {
            append_approved_mcp_tool_execution(store, record, policy, decision)?;
            continue;
        }
        if !builtin_controlled_execution_tool {
            continue;
        }
        store.tasks().append_task_event_with_payload(
            record,
            LedgerEventKind::ToolExecutionRequested,
            Some(json!({
                "tool_id": decision.tool_id,
                "input_summary": summarize_intent_input(&decision.input),
            })),
        )?;
        let permission = RuntimePermissionGate::check(policy, decision.required_action.clone());
        store.tasks().append_task_event_with_payload(
            record,
            LedgerEventKind::ToolExecutionPermissionChecked,
            Some(json!({
                "tool_id": decision.tool_id,
                "required_action": runtime_action_name(&permission.action),
                "allowed": permission.allowed,
                "reason": permission.reason,
            })),
        )?;
        if !permission.allowed {
            store.tasks().append_task_event_with_payload(
                record,
                LedgerEventKind::ToolExecutionDenied,
                Some(json!({ "tool_id": decision.tool_id, "status": "Denied", "reason": permission.reason })),
            )?;
            continue;
        }
        let execution_input = if decision.tool_id == GIT_COMMIT_TOOL_ID {
            match runtime_git_commit_execution_input(
                store,
                record,
                policy,
                &decision.input,
                intent_index,
            )? {
                Ok(input) => input,
                Err(reason) => {
                    store.tasks().append_task_event_with_payload(
                        record,
                        LedgerEventKind::ToolExecutionFailed,
                        Some(json!({
                            "tool_id": decision.tool_id,
                            "status": "Failed",
                            "reason": reason,
                            "operation": "commit",
                            "runtime_authorization_required": true,
                            "raw_diff_redacted": true,
                            "raw_file_content_redacted": true,
                            "raw_message_redacted": true,
                            "absolute_paths_redacted": true,
                        })),
                    )?;
                    continue;
                }
            }
        } else {
            decision.input
        };
        let result = ToolExecutor::execute_controlled(
            store.workspace_root(),
            ToolExecutionRequest {
                tool_id: decision.tool_id,
                input: execution_input,
            },
        )?;
        let kind = match result.status {
            ToolExecutionStatus::Completed => LedgerEventKind::ToolExecutionCompleted,
            ToolExecutionStatus::Denied => LedgerEventKind::ToolExecutionDenied,
            ToolExecutionStatus::Failed => LedgerEventKind::ToolExecutionFailed,
        };
        store.tasks().append_task_event_with_payload(
            record,
            kind,
            Some(tool_execution_ledger_payload(&result)),
        )?;
    }
    Ok(())
}

fn append_approved_mcp_tool_execution(
    store: &BrownieStore,
    record: &brownie_protocol::TaskRecord,
    policy: &CompiledModePolicy,
    decision: ToolIntentDecision,
) -> anyhow::Result<()> {
    let request_fingerprint =
        mcp_tool_execution_request_fingerprint(&decision.tool_id, &decision.input);
    if completed_mcp_tool_execution_for_request(
        store,
        record,
        &decision.tool_id,
        &request_fingerprint,
    )?
    .is_some()
    {
        return Ok(());
    }
    store.tasks().append_task_event_with_payload(
        record,
        LedgerEventKind::ToolExecutionRequested,
        Some(json!({
            "tool_id": decision.tool_id,
            "request_fingerprint": request_fingerprint,
            "input_summary": summarize_intent_input(&decision.input),
        })),
    )?;
    let Some((server_id, tool_name)) = mcp_client::split_normalized_tool_id(&decision.tool_id)
    else {
        store.tasks().append_task_event_with_payload(
            record,
            LedgerEventKind::ToolExecutionFailed,
            Some(json!({
                "tool_id": decision.tool_id,
                "status": "Failed",
                "reason": "Malformed MCP tool id.",
            })),
        )?;
        return Ok(());
    };
    let permission = mcp_tool_runtime_permission_decision(policy, server_id, tool_name);
    let mcp_safety_policy = compiled_mcp_tool_policy(policy, server_id, tool_name)
        .map(mcp_tool_safety_policy_payload)
        .unwrap_or(Value::Null);
    store.tasks().append_task_event_with_payload(
        record,
        LedgerEventKind::ToolExecutionPermissionChecked,
        Some(json!({
            "tool_id": decision.tool_id,
            "required_action": runtime_action_name(&permission.action),
            "allowed": permission.allowed,
            "reason": permission.reason,
            "server_id": server_id,
            "tool_name": tool_name,
            "request_fingerprint": request_fingerprint,
            "mcp_safety_policy": mcp_safety_policy,
        })),
    )?;
    if !permission.allowed {
        store.tasks().append_task_event_with_payload(
            record,
            LedgerEventKind::ToolExecutionDenied,
            Some(json!({
                "tool_id": decision.tool_id,
                "status": "Denied",
                "reason": permission.reason,
            })),
        )?;
        return Ok(());
    }
    let result =
        execute_mcp_tool_for_record(store, record, policy, decision.tool_id, decision.input)?;
    let kind = match result.status {
        ToolExecuteStatus::Completed => LedgerEventKind::ToolExecutionCompleted,
        ToolExecuteStatus::Denied => LedgerEventKind::ToolExecutionDenied,
        ToolExecuteStatus::Failed => LedgerEventKind::ToolExecutionFailed,
    };
    store.tasks().append_task_event_with_payload(
        record,
        kind,
        Some(tool_execute_result_ledger_payload(&result)),
    )?;
    Ok(())
}

fn completed_mcp_tool_execution_for_request(
    store: &BrownieStore,
    record: &brownie_protocol::TaskRecord,
    tool_id: &str,
    request_fingerprint: &str,
) -> anyhow::Result<Option<Value>> {
    let events = store.tasks().read_ledger_events(&record.run_id)?;
    Ok(events
        .iter()
        .rev()
        .filter(|event| event.kind == LedgerEventKind::ToolExecutionCompleted)
        .filter_map(|event| event.payload.as_ref())
        .find(|payload| {
            payload.get("tool_id").and_then(Value::as_str) == Some(tool_id)
                && payload
                    .get("mcp")
                    .and_then(|mcp| mcp.get("request_fingerprint"))
                    .and_then(Value::as_str)
                    == Some(request_fingerprint)
        })
        .cloned())
}

pub(super) fn append_controlled_tool_execution_denied(
    store: &BrownieStore,
    record: &brownie_protocol::TaskRecord,
    policy: &CompiledModePolicy,
    decision: &ToolIntentDecision,
) -> anyhow::Result<()> {
    store.tasks().append_task_event_with_payload(
        record,
        LedgerEventKind::ToolExecutionRequested,
        Some(json!({
            "tool_id": decision.tool_id,
            "input_summary": summarize_intent_input(&decision.input),
        })),
    )?;
    let permission = RuntimePermissionGate::check(policy, decision.required_action.clone());
    store.tasks().append_task_event_with_payload(
        record,
        LedgerEventKind::ToolExecutionPermissionChecked,
        Some(json!({
            "tool_id": decision.tool_id,
            "required_action": runtime_action_name(&permission.action),
            "allowed": permission.allowed,
            "reason": permission.reason,
        })),
    )?;
    store.tasks().append_task_event_with_payload(
        record,
        LedgerEventKind::ToolExecutionDenied,
        Some(json!({
            "tool_id": decision.tool_id,
            "status": "Denied",
            "reason": permission.reason,
        })),
    )?;
    Ok(())
}

pub(super) fn append_subtask_orchestration_queued(
    store: &BrownieStore,
    record: &brownie_protocol::TaskRecord,
    policy: &CompiledModePolicy,
    decision: &ToolIntentDecision,
) -> anyhow::Result<()> {
    let requested_goal_preview = normalized_subtask_spawn_goal_preview(&decision.input);
    let requested_mode_id = normalized_subtask_spawn_mode_id(&decision.input);
    if let Some(reason) =
        subtask_spawn_input_runtime_rejection_reason(store, policy, &decision.input)?
    {
        return append_subtask_spawn_input_denied(
            store,
            record,
            policy,
            decision,
            requested_mode_id.as_deref().unwrap_or_default(),
            reason,
        );
    }

    let queue_position = next_subtask_queue_position(store, &record.run_id)?;
    let run_fragment = record
        .run_id
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect::<String>();
    let subtask_id = format!("subtask_{run_fragment}_{queue_position}");
    let mut payload = json!({
        "subtask_id": subtask_id,
        "parent_task_id": record.task_id,
        "parent_run_id": record.run_id,
        "tool_id": decision.tool_id,
        "required_action": runtime_action_name(&decision.required_action),
        "status": "Queued",
        "queue_position": queue_position,
        "request_reason": decision.request_reason,
        "input_summary": summarize_intent_input(&decision.input),
        "execution_enabled": false,
        "reason": "Subtask orchestration queued for controlled child materialization; no scheduler dispatch is performed."
    });
    if let Some(goal) = requested_goal_preview {
        payload["requested_goal_preview"] = json!(goal);
    }
    if let Some(mode_id) = requested_mode_id {
        payload["requested_mode_id"] = json!(mode_id);
    }
    store.tasks().append_task_event_with_payload(
        record,
        LedgerEventKind::SubtaskOrchestrationQueued,
        Some(payload),
    )
}

pub(super) fn append_subtask_spawn_input_denied(
    store: &BrownieStore,
    record: &brownie_protocol::TaskRecord,
    policy: &CompiledModePolicy,
    decision: &ToolIntentDecision,
    requested_mode_id: &str,
    reason: &str,
) -> anyhow::Result<()> {
    store.tasks().append_task_event_with_payload(
        record,
        LedgerEventKind::ToolIntentDenied,
        Some(json!({
            "tool_id": decision.tool_id,
            "required_action": runtime_action_name(&decision.required_action),
            "allowed": false,
            "mode_id": policy.mode_id,
            "reason": reason,
            "request_reason": decision.request_reason,
            "requested_mode_id": requested_mode_id,
            "input_summary": summarize_intent_input(&decision.input),
        })),
    )
}

pub(super) fn next_subtask_queue_position(
    store: &BrownieStore,
    run_id: &str,
) -> anyhow::Result<usize> {
    Ok(store
        .tasks()
        .read_ledger_events(run_id)?
        .iter()
        .filter(|event| event.kind == LedgerEventKind::SubtaskOrchestrationQueued)
        .count()
        + 1)
}

pub(super) fn append_subtask_handoff_prepared(
    store: &BrownieStore,
    record: &brownie_protocol::TaskRecord,
) -> anyhow::Result<()> {
    let events = store.tasks().read_ledger_events(&record.run_id)?;
    if events
        .iter()
        .any(|event| event.kind == LedgerEventKind::SubtaskHandoffPrepared)
    {
        return Ok(());
    }
    let queued_subtask_ids = events
        .iter()
        .filter(|event| event.kind == LedgerEventKind::SubtaskOrchestrationQueued)
        .filter_map(|event| {
            event
                .payload
                .as_ref()
                .and_then(|payload| payload.get("subtask_id"))
                .and_then(Value::as_str)
                .map(ToString::to_string)
        })
        .collect::<Vec<_>>();
    if queued_subtask_ids.is_empty() {
        return Ok(());
    }
    let run_fragment = record
        .run_id
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect::<String>();
    let queued_count = queued_subtask_ids.len();
    store.tasks().append_task_event_with_payload(
        record,
        LedgerEventKind::SubtaskHandoffPrepared,
        Some(json!({
            "handoff_id": format!("subtask_handoff_{run_fragment}_1"),
            "parent_task_id": record.task_id,
            "parent_run_id": record.run_id,
            "status": "Prepared",
            "queued_count": queued_count,
            "queued_subtask_ids": queued_subtask_ids,
            "source_event_count": queued_count,
            "execution_enabled": false,
            "next_action": "await_future_runtime_scheduler",
            "reason": "Queued subtask evidence consumed into parent-run handoff state; no subtask was spawned in M5.1."
        })),
    )
}

pub(super) fn append_subtask_scheduler_readiness_recorded(
    store: &BrownieStore,
    record: &brownie_protocol::TaskRecord,
) -> anyhow::Result<()> {
    let events = store.tasks().read_ledger_events(&record.run_id)?;
    if events
        .iter()
        .any(|event| event.kind == LedgerEventKind::SubtaskSchedulerReadinessRecorded)
    {
        return Ok(());
    }

    let handoffs = events
        .iter()
        .filter(|event| event.kind == LedgerEventKind::SubtaskHandoffPrepared)
        .filter_map(|event| {
            let payload = event.payload.as_ref()?;
            let handoff_id = payload.get("handoff_id")?.as_str()?.to_string();
            let queued_count = payload
                .get("queued_count")
                .and_then(Value::as_u64)
                .unwrap_or(0);
            Some((handoff_id, queued_count))
        })
        .collect::<Vec<_>>();
    if handoffs.is_empty() {
        return Ok(());
    }

    let run_fragment = record
        .run_id
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect::<String>();
    let handoff_ids = handoffs
        .iter()
        .map(|(handoff_id, _)| handoff_id.clone())
        .collect::<Vec<_>>();
    let handoff_count = handoffs.len();
    let queued_count = handoffs
        .iter()
        .map(|(_, queued_count)| *queued_count)
        .sum::<u64>();
    let blocked_checks = vec![
        "child_task_execution_disabled",
        "runtime_scheduler_not_implemented",
    ];
    store.tasks().append_task_event_with_payload(
        record,
        LedgerEventKind::SubtaskSchedulerReadinessRecorded,
        Some(json!({
            "readiness_id": format!("subtask_scheduler_readiness_{run_fragment}_1"),
            "parent_task_id": record.task_id,
            "parent_run_id": record.run_id,
            "handoff_id": handoff_ids[0],
            "handoff_count": handoff_count,
            "queued_count": queued_count,
            "source_event_count": handoff_count,
            "status": "Blocked",
            "readiness_status": "Blocked",
            "readiness_reason": "Prepared subtask handoff is not dispatch-ready until a runtime scheduler exists.",
            "check_count": blocked_checks.len(),
            "blocked_checks": blocked_checks,
            "execution_enabled": false,
            "dispatch_enabled": false,
            "next_action": "await_runtime_scheduler_dispatch",
            "reason": "Prepared handoff evidence evaluated for scheduler readiness; no subtask was spawned in M5.2."
        })),
    )
}

pub(super) fn append_subtask_dispatch_plan_prepared(
    store: &BrownieStore,
    record: &brownie_protocol::TaskRecord,
) -> anyhow::Result<()> {
    let events = store.tasks().read_ledger_events(&record.run_id)?;
    if events
        .iter()
        .any(|event| event.kind == LedgerEventKind::SubtaskDispatchPlanPrepared)
    {
        return Ok(());
    }

    let readiness_entries = events
        .iter()
        .filter(|event| event.kind == LedgerEventKind::SubtaskSchedulerReadinessRecorded)
        .filter_map(|event| {
            let payload = event.payload.as_ref()?;
            let readiness_id = payload.get("readiness_id")?.as_str()?.to_string();
            let queued_count = payload
                .get("queued_count")
                .and_then(Value::as_u64)
                .unwrap_or(0);
            Some((readiness_id, queued_count))
        })
        .collect::<Vec<_>>();
    if readiness_entries.is_empty() {
        return Ok(());
    }

    let run_fragment = record
        .run_id
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect::<String>();
    let readiness_ids = readiness_entries
        .iter()
        .map(|(readiness_id, _)| readiness_id.clone())
        .collect::<Vec<_>>();
    let readiness_count = readiness_entries.len();
    let queued_count = readiness_entries
        .iter()
        .map(|(_, queued_count)| *queued_count)
        .sum::<u64>();
    let blocked_checks = vec![
        "child_task_execution_disabled",
        "runtime_dispatcher_not_implemented",
    ];
    store.tasks().append_task_event_with_payload(
        record,
        LedgerEventKind::SubtaskDispatchPlanPrepared,
        Some(json!({
            "plan_id": format!("subtask_dispatch_plan_{run_fragment}_1"),
            "parent_task_id": record.task_id,
            "parent_run_id": record.run_id,
            "readiness_id": readiness_ids[0],
            "readiness_count": readiness_count,
            "queued_count": queued_count,
            "source_event_count": readiness_count,
            "status": "Blocked",
            "dispatch_plan_status": "Blocked",
            "dispatch_reason": "Scheduler readiness is blocked, so dispatch plan is recorded as blocked without execution.",
            "required_capability": "runtime_subtask_dispatcher",
            "check_count": blocked_checks.len(),
            "blocked_checks": blocked_checks,
            "execution_enabled": false,
            "dispatch_enabled": false,
            "next_action": "await_runtime_subtask_dispatcher",
            "reason": "Scheduler readiness evidence converted into a dispatch plan; no subtask was spawned in M5.3."
        })),
    )
}

pub(super) fn append_subtask_dispatch_contract_prepared(
    store: &BrownieStore,
    record: &brownie_protocol::TaskRecord,
) -> anyhow::Result<()> {
    let events = store.tasks().read_ledger_events(&record.run_id)?;
    if events
        .iter()
        .any(|event| event.kind == LedgerEventKind::SubtaskDispatchContractPrepared)
    {
        return Ok(());
    }

    let dispatch_plans = events
        .iter()
        .filter(|event| event.kind == LedgerEventKind::SubtaskDispatchPlanPrepared)
        .filter_map(|event| {
            let payload = event.payload.as_ref()?;
            let plan_id = payload.get("plan_id")?.as_str()?.to_string();
            let queued_count = payload
                .get("queued_count")
                .and_then(Value::as_u64)
                .unwrap_or(0);
            Some((plan_id, queued_count))
        })
        .collect::<Vec<_>>();
    if dispatch_plans.is_empty() {
        return Ok(());
    }

    let run_fragment = record
        .run_id
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect::<String>();
    let plan_ids = dispatch_plans
        .iter()
        .map(|(plan_id, _)| plan_id.clone())
        .collect::<Vec<_>>();
    let plan_count = dispatch_plans.len();
    let queued_count = dispatch_plans
        .iter()
        .map(|(_, queued_count)| *queued_count)
        .sum::<u64>();
    let required_preconditions = vec![
        "runtime_subtask_dispatcher_implemented",
        "child_task_execution_guard_enabled",
        "dispatch_audit_ledger_ready",
    ];
    let blocked_checks = vec![
        "runtime_dispatcher_not_implemented",
        "dispatch_contract_not_executable",
        "child_task_execution_disabled",
    ];
    store.tasks().append_task_event_with_payload(
        record,
        LedgerEventKind::SubtaskDispatchContractPrepared,
        Some(json!({
            "contract_id": format!("subtask_dispatch_contract_{run_fragment}_1"),
            "parent_task_id": record.task_id,
            "parent_run_id": record.run_id,
            "plan_id": plan_ids[0],
            "plan_count": plan_count,
            "queued_count": queued_count,
            "source_event_count": plan_count,
            "status": "Blocked",
            "dispatch_contract_status": "Blocked",
            "eligibility_status": "Blocked",
            "dispatch_contract_reason": "Dispatch contract is blocked until the runtime dispatcher can honor required preconditions.",
            "required_capability": "runtime_subtask_dispatcher",
            "required_preconditions": required_preconditions,
            "check_count": blocked_checks.len(),
            "blocked_checks": blocked_checks,
            "execution_enabled": false,
            "dispatch_enabled": false,
            "next_action": "await_dispatch_contract_implementation",
            "reason": "Dispatch plan evidence converted into a dispatch contract and eligibility gate; no subtask was spawned in M5.4."
        })),
    )
}

pub(super) fn append_subtask_dispatch_admission_evaluated(
    store: &BrownieStore,
    record: &brownie_protocol::TaskRecord,
) -> anyhow::Result<()> {
    let events = store.tasks().read_ledger_events(&record.run_id)?;
    if events
        .iter()
        .any(|event| event.kind == LedgerEventKind::SubtaskDispatchAdmissionEvaluated)
    {
        return Ok(());
    }

    let dispatch_contracts = events
        .iter()
        .filter(|event| event.kind == LedgerEventKind::SubtaskDispatchContractPrepared)
        .filter_map(|event| {
            let payload = event.payload.as_ref()?;
            let contract_id = payload.get("contract_id")?.as_str()?.to_string();
            let queued_count = payload
                .get("queued_count")
                .and_then(Value::as_u64)
                .unwrap_or(0);
            let required_preconditions = payload
                .get("required_preconditions")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(ToString::to_string)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            Some((contract_id, queued_count, required_preconditions))
        })
        .collect::<Vec<_>>();
    if dispatch_contracts.is_empty() {
        return Ok(());
    }

    let run_fragment = record
        .run_id
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect::<String>();
    let contract_ids = dispatch_contracts
        .iter()
        .map(|(contract_id, _, _)| contract_id.clone())
        .collect::<Vec<_>>();
    let contract_count = dispatch_contracts.len();
    let queued_count = dispatch_contracts
        .iter()
        .map(|(_, queued_count, _)| *queued_count)
        .sum::<u64>();
    let blocked_preconditions = dispatch_contracts
        .iter()
        .flat_map(|(_, _, required_preconditions)| required_preconditions.iter().cloned())
        .collect::<Vec<_>>();
    let blocked_checks = vec![
        "dispatch_admission_blocked",
        "runtime_dispatcher_not_implemented",
        "child_task_execution_disabled",
    ];
    store.tasks().append_task_event_with_payload(
        record,
        LedgerEventKind::SubtaskDispatchAdmissionEvaluated,
        Some(json!({
            "admission_id": format!("subtask_dispatch_admission_{run_fragment}_1"),
            "parent_task_id": record.task_id,
            "parent_run_id": record.run_id,
            "contract_id": contract_ids[0],
            "contract_count": contract_count,
            "queued_count": queued_count,
            "source_event_count": contract_count,
            "status": "Blocked",
            "admission_status": "Blocked",
            "execution_gate_status": "Blocked",
            "admission_reason": "Dispatch contract cannot be admitted until required preconditions are satisfied by a runtime dispatcher.",
            "required_capability": "runtime_subtask_dispatcher",
            "precondition_count": blocked_preconditions.len(),
            "satisfied_precondition_count": 0,
            "blocked_preconditions": blocked_preconditions,
            "check_count": blocked_checks.len(),
            "blocked_checks": blocked_checks,
            "execution_enabled": false,
            "dispatch_enabled": false,
            "next_action": "await_dispatch_admission_preconditions",
            "reason": "Dispatch contract evidence evaluated into an admission decision and execution gate; no subtask was spawned in M5.5."
        })),
    )
}

pub(super) fn append_subtask_dispatch_readiness_snapshot_recorded(
    store: &BrownieStore,
    record: &brownie_protocol::TaskRecord,
) -> anyhow::Result<()> {
    let events = store.tasks().read_ledger_events(&record.run_id)?;
    if events
        .iter()
        .any(|event| event.kind == LedgerEventKind::SubtaskDispatchReadinessSnapshotRecorded)
    {
        return Ok(());
    }

    let dispatch_admissions = events
        .iter()
        .filter(|event| event.kind == LedgerEventKind::SubtaskDispatchAdmissionEvaluated)
        .filter_map(|event| {
            let payload = event.payload.as_ref()?;
            let admission_id = payload.get("admission_id")?.as_str()?.to_string();
            let queued_count = payload
                .get("queued_count")
                .and_then(Value::as_u64)
                .unwrap_or(0);
            let blocked_preconditions = payload
                .get("blocked_preconditions")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(ToString::to_string)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            let blocked_checks = payload
                .get("blocked_checks")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(ToString::to_string)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            Some((
                admission_id,
                queued_count,
                blocked_preconditions,
                blocked_checks,
            ))
        })
        .collect::<Vec<_>>();
    if dispatch_admissions.is_empty() {
        return Ok(());
    }

    let run_fragment = record
        .run_id
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect::<String>();
    let admission_ids = dispatch_admissions
        .iter()
        .map(|(admission_id, _, _, _)| admission_id.clone())
        .collect::<Vec<_>>();
    let admission_count = dispatch_admissions.len();
    let queued_count = dispatch_admissions
        .iter()
        .map(|(_, queued_count, _, _)| *queued_count)
        .sum::<u64>();
    let mut blocked_preconditions = dispatch_admissions
        .iter()
        .flat_map(|(_, _, blocked_preconditions, _)| blocked_preconditions.iter().cloned())
        .collect::<Vec<_>>();
    blocked_preconditions.sort();
    blocked_preconditions.dedup();
    let mut blocked_checks = vec![
        "dispatch_readiness_snapshot_blocked".to_string(),
        "scheduler_handoff_not_ready".to_string(),
    ];
    blocked_checks.extend(
        dispatch_admissions
            .iter()
            .flat_map(|(_, _, _, checks)| checks.iter().cloned()),
    );
    blocked_checks.sort();
    blocked_checks.dedup();

    let mut fingerprint_inputs = vec![
        "snapshot_version=m5.6_dispatch_readiness_v1".to_string(),
        format!("parent_task_id={}", record.task_id),
        format!("parent_run_id={}", record.run_id),
        format!("admission_count={admission_count}"),
        format!("queued_count={queued_count}"),
    ];
    for admission_id in &admission_ids {
        fingerprint_inputs.push(format!("admission_id={admission_id}"));
    }
    for precondition in &blocked_preconditions {
        fingerprint_inputs.push(format!("blocked_precondition={precondition}"));
    }
    for check in &blocked_checks {
        fingerprint_inputs.push(format!("blocked_check={check}"));
    }
    let fingerprint_input_count = fingerprint_inputs.len();
    let readiness_fingerprint = format!(
        "sha256:{}",
        hex_sha256(fingerprint_inputs.join("\n").as_bytes())
    );

    store.tasks().append_task_event_with_payload(
        record,
        LedgerEventKind::SubtaskDispatchReadinessSnapshotRecorded,
        Some(json!({
            "snapshot_id": format!("subtask_dispatch_readiness_snapshot_{run_fragment}_1"),
            "parent_task_id": record.task_id,
            "parent_run_id": record.run_id,
            "admission_id": admission_ids[0],
            "admission_count": admission_count,
            "queued_count": queued_count,
            "source_event_count": admission_count,
            "status": "Blocked",
            "readiness_status": "Blocked",
            "scheduler_handoff_status": "Blocked",
            "readiness_reason": "Dispatch admission is not ready for scheduler handoff until every blocked precondition is satisfied.",
            "required_capability": "runtime_subtask_dispatcher",
            "precondition_count": blocked_preconditions.len(),
            "satisfied_precondition_count": 0,
            "blocked_preconditions": blocked_preconditions,
            "check_count": blocked_checks.len(),
            "blocked_checks": blocked_checks,
            "readiness_fingerprint": readiness_fingerprint,
            "fingerprint_input_count": fingerprint_input_count,
            "execution_enabled": false,
            "dispatch_enabled": false,
            "next_action": "await_dispatch_readiness_snapshot_handoff",
            "reason": "Dispatch admission evidence snapshotted into a stable dispatcher-readiness guard; no subtask was spawned in M5.6."
        })),
    )
}

pub(super) fn append_subtask_dispatcher_guard_verdict_recorded(
    store: &BrownieStore,
    record: &brownie_protocol::TaskRecord,
) -> anyhow::Result<()> {
    let events = store.tasks().read_ledger_events(&record.run_id)?;
    if events
        .iter()
        .any(|event| event.kind == LedgerEventKind::SubtaskDispatcherGuardVerdictRecorded)
    {
        return Ok(());
    }

    let readiness_snapshots = events
        .iter()
        .filter(|event| event.kind == LedgerEventKind::SubtaskDispatchReadinessSnapshotRecorded)
        .filter_map(|event| {
            let payload = event.payload.as_ref()?;
            let snapshot_id = payload.get("snapshot_id")?.as_str()?.to_string();
            let queued_count = payload
                .get("queued_count")
                .and_then(Value::as_u64)
                .unwrap_or(0);
            let readiness_fingerprint = payload
                .get("readiness_fingerprint")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let fingerprint_input_count = payload
                .get("fingerprint_input_count")
                .and_then(Value::as_u64)
                .unwrap_or(0);
            let blocked_preconditions = payload
                .get("blocked_preconditions")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(ToString::to_string)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            let blocked_checks = payload
                .get("blocked_checks")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(ToString::to_string)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            Some((
                snapshot_id,
                queued_count,
                readiness_fingerprint,
                fingerprint_input_count,
                blocked_preconditions,
                blocked_checks,
            ))
        })
        .collect::<Vec<_>>();
    if readiness_snapshots.is_empty() {
        return Ok(());
    }

    let run_fragment = record
        .run_id
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect::<String>();
    let snapshot_ids = readiness_snapshots
        .iter()
        .map(|(snapshot_id, _, _, _, _, _)| snapshot_id.clone())
        .collect::<Vec<_>>();
    let snapshot_count = readiness_snapshots.len();
    let queued_count = readiness_snapshots
        .iter()
        .map(|(_, queued_count, _, _, _, _)| *queued_count)
        .sum::<u64>();
    let mut blocked_preconditions = readiness_snapshots
        .iter()
        .flat_map(|(_, _, _, _, blocked_preconditions, _)| blocked_preconditions.iter().cloned())
        .collect::<Vec<_>>();
    blocked_preconditions.push("runtime_subtask_dispatcher_implemented".to_string());
    blocked_preconditions.push("child_task_execution_guard_enabled".to_string());
    blocked_preconditions.sort();
    blocked_preconditions.dedup();

    let mut snapshot_fingerprints = readiness_snapshots
        .iter()
        .filter_map(|(_, _, fingerprint, _, _, _)| {
            if fingerprint.is_empty() {
                None
            } else {
                Some(fingerprint.clone())
            }
        })
        .collect::<Vec<_>>();
    snapshot_fingerprints.sort();
    snapshot_fingerprints.dedup();
    let snapshot_fingerprint_count = snapshot_fingerprints.len();
    let snapshot_fingerprint = snapshot_fingerprints
        .first()
        .cloned()
        .unwrap_or_else(|| "<missing>".to_string());
    let snapshot_validity_status = if snapshot_fingerprint_count == 1 {
        "Current"
    } else {
        "Blocked"
    };

    let mut blocked_checks = vec![
        "dispatcher_guard_blocked".to_string(),
        "handoff_preflight_blocked".to_string(),
        "runtime_dispatcher_not_implemented".to_string(),
        "child_task_execution_disabled".to_string(),
    ];
    if snapshot_fingerprint_count != 1 {
        blocked_checks.push("dispatch_readiness_snapshot_fingerprint_invalid".to_string());
    }
    blocked_checks.extend(
        readiness_snapshots
            .iter()
            .flat_map(|(_, _, _, _, _, checks)| checks.iter().cloned()),
    );
    blocked_checks.sort();
    blocked_checks.dedup();
    let fingerprint_input_count = readiness_snapshots
        .iter()
        .map(|(_, _, _, count, _, _)| *count)
        .max()
        .unwrap_or(0);

    store.tasks().append_task_event_with_payload(
        record,
        LedgerEventKind::SubtaskDispatcherGuardVerdictRecorded,
        Some(json!({
            "guard_id": format!("subtask_dispatcher_guard_{run_fragment}_1"),
            "parent_task_id": record.task_id,
            "parent_run_id": record.run_id,
            "snapshot_id": snapshot_ids[0],
            "snapshot_count": snapshot_count,
            "queued_count": queued_count,
            "source_event_count": snapshot_count,
            "status": "Blocked",
            "guard_status": "Blocked",
            "scheduler_handoff_status": "Blocked",
            "handoff_preflight_status": "Blocked",
            "snapshot_validity_status": snapshot_validity_status,
            "snapshot_fingerprint": snapshot_fingerprint,
            "snapshot_fingerprint_count": snapshot_fingerprint_count,
            "fingerprint_input_count": fingerprint_input_count,
            "guard_reason": "Dispatch readiness snapshot is current, but scheduler handoff remains blocked until dispatcher guard preconditions are satisfied.",
            "required_capability": "runtime_subtask_dispatcher",
            "precondition_count": blocked_preconditions.len(),
            "satisfied_precondition_count": 0,
            "blocked_preconditions": blocked_preconditions,
            "check_count": blocked_checks.len(),
            "blocked_checks": blocked_checks,
            "execution_enabled": false,
            "dispatch_enabled": false,
            "next_action": "await_dispatcher_guard_preconditions",
            "reason": "Dispatch readiness snapshot evaluated into a dispatcher guard verdict and handoff preflight blocker; no subtask was spawned in M5.7."
        })),
    )
}

struct SubtaskDispatchDecisionSource {
    guard_id: String,
    snapshot_id: String,
    queued_count: u64,
    handoff_preflight_status: String,
    guard_status: String,
    snapshot_validity_status: String,
    snapshot_fingerprint: String,
    fingerprint_input_count: u64,
    blocked_preconditions: Vec<String>,
    blocked_checks: Vec<String>,
}

pub(super) fn append_subtask_dispatch_decision_recorded(
    store: &BrownieStore,
    record: &brownie_protocol::TaskRecord,
) -> anyhow::Result<()> {
    let events = store.tasks().read_ledger_events(&record.run_id)?;
    if events
        .iter()
        .any(|event| event.kind == LedgerEventKind::SubtaskDispatchDecisionRecorded)
    {
        return Ok(());
    }

    let dispatcher_guards = events
        .iter()
        .filter(|event| event.kind == LedgerEventKind::SubtaskDispatcherGuardVerdictRecorded)
        .filter_map(|event| {
            let payload = event.payload.as_ref()?;
            let guard_id = payload.get("guard_id")?.as_str()?.to_string();
            let snapshot_id = payload.get("snapshot_id")?.as_str()?.to_string();
            let queued_count = payload
                .get("queued_count")
                .and_then(Value::as_u64)
                .unwrap_or(0);
            let handoff_preflight_status = payload
                .get("handoff_preflight_status")
                .and_then(Value::as_str)
                .unwrap_or("Blocked")
                .to_string();
            let guard_status = payload
                .get("guard_status")
                .and_then(Value::as_str)
                .unwrap_or("Blocked")
                .to_string();
            let snapshot_validity_status = payload
                .get("snapshot_validity_status")
                .and_then(Value::as_str)
                .unwrap_or("Blocked")
                .to_string();
            let snapshot_fingerprint = payload
                .get("snapshot_fingerprint")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let fingerprint_input_count = payload
                .get("fingerprint_input_count")
                .and_then(Value::as_u64)
                .unwrap_or(0);
            let blocked_preconditions = payload
                .get("blocked_preconditions")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(ToString::to_string)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            let blocked_checks = payload
                .get("blocked_checks")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(ToString::to_string)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            Some(SubtaskDispatchDecisionSource {
                guard_id,
                snapshot_id,
                queued_count,
                handoff_preflight_status,
                guard_status,
                snapshot_validity_status,
                snapshot_fingerprint,
                fingerprint_input_count,
                blocked_preconditions,
                blocked_checks,
            })
        })
        .collect::<Vec<_>>();
    if dispatcher_guards.is_empty() {
        return Ok(());
    }

    let run_fragment = record
        .run_id
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect::<String>();
    let guard_ids = dispatcher_guards
        .iter()
        .map(|source| source.guard_id.clone())
        .collect::<Vec<_>>();
    let snapshot_ids = dispatcher_guards
        .iter()
        .map(|source| source.snapshot_id.clone())
        .collect::<Vec<_>>();
    let guard_count = dispatcher_guards.len();
    let queued_count = dispatcher_guards
        .iter()
        .map(|source| source.queued_count)
        .sum::<u64>();
    let handoff_preflight_status = dispatcher_guards
        .first()
        .map(|source| source.handoff_preflight_status.as_str())
        .unwrap_or("Blocked");
    let guard_status = if dispatcher_guards
        .iter()
        .any(|source| source.guard_status == "Blocked")
    {
        "Blocked"
    } else {
        dispatcher_guards
            .first()
            .map(|source| source.guard_status.as_str())
            .unwrap_or("Blocked")
    };

    let mut snapshot_fingerprints = dispatcher_guards
        .iter()
        .filter_map(|source| {
            if source.snapshot_fingerprint.is_empty() {
                None
            } else {
                Some(source.snapshot_fingerprint.clone())
            }
        })
        .collect::<Vec<_>>();
    snapshot_fingerprints.sort();
    snapshot_fingerprints.dedup();
    let snapshot_fingerprint_count = snapshot_fingerprints.len();
    let snapshot_fingerprint = snapshot_fingerprints
        .first()
        .cloned()
        .unwrap_or_else(|| "<missing>".to_string());
    let snapshot_validity_status = if snapshot_fingerprint_count == 1 {
        dispatcher_guards
            .first()
            .map(|source| source.snapshot_validity_status.as_str())
            .unwrap_or("Current")
    } else {
        "Blocked"
    };

    let mut blocked_preconditions = dispatcher_guards
        .iter()
        .flat_map(|source| source.blocked_preconditions.iter().cloned())
        .collect::<Vec<_>>();
    blocked_preconditions.push("runtime_subtask_dispatcher_implemented".to_string());
    blocked_preconditions.push("child_task_execution_guard_enabled".to_string());
    blocked_preconditions.sort();
    blocked_preconditions.dedup();

    let mut blocked_checks = vec![
        "dispatch_decision_blocked".to_string(),
        "dispatch_candidate_not_eligible".to_string(),
        "dispatcher_guard_verdict_blocked".to_string(),
        "runtime_dispatcher_not_implemented".to_string(),
        "child_task_execution_disabled".to_string(),
    ];
    if snapshot_fingerprint_count != 1 {
        blocked_checks.push("dispatch_decision_snapshot_fingerprint_invalid".to_string());
    }
    blocked_checks.extend(
        dispatcher_guards
            .iter()
            .flat_map(|source| source.blocked_checks.iter().cloned()),
    );
    blocked_checks.sort();
    blocked_checks.dedup();
    let fingerprint_input_count = dispatcher_guards
        .iter()
        .map(|source| source.fingerprint_input_count)
        .max()
        .unwrap_or(0);

    store.tasks().append_task_event_with_payload(
        record,
        LedgerEventKind::SubtaskDispatchDecisionRecorded,
        Some(json!({
            "decision_id": format!("subtask_dispatch_decision_{run_fragment}_1"),
            "parent_task_id": record.task_id,
            "parent_run_id": record.run_id,
            "guard_id": guard_ids[0],
            "guard_count": guard_count,
            "snapshot_id": snapshot_ids[0],
            "queued_count": queued_count,
            "source_event_count": guard_count,
            "status": "Blocked",
            "decision_status": "Blocked",
            "candidate_status": "Blocked",
            "dispatch_decision": "Denied",
            "dispatch_denial_reason": "Dispatcher guard verdict blocks dispatch until preconditions are satisfied.",
            "handoff_preflight_status": handoff_preflight_status,
            "guard_status": guard_status,
            "snapshot_validity_status": snapshot_validity_status,
            "snapshot_fingerprint": snapshot_fingerprint,
            "snapshot_fingerprint_count": snapshot_fingerprint_count,
            "fingerprint_input_count": fingerprint_input_count,
            "dispatch_candidate_count": queued_count,
            "eligible_candidate_count": 0,
            "blocked_candidate_count": queued_count,
            "required_capability": "runtime_subtask_dispatcher",
            "precondition_count": blocked_preconditions.len(),
            "satisfied_precondition_count": 0,
            "blocked_preconditions": blocked_preconditions,
            "check_count": blocked_checks.len(),
            "blocked_checks": blocked_checks,
            "execution_enabled": false,
            "dispatch_enabled": false,
            "next_action": "await_dispatch_decision_preconditions",
            "reason": "Dispatcher guard verdict evaluated into a dispatch decision and per-candidate denial state; no subtask was spawned in M5.8."
        })),
    )
}

struct SubtaskDispatchCandidateManifestSource {
    decision_id: String,
    guard_id: String,
    snapshot_id: String,
    dispatch_decision: String,
    candidate_status: String,
    snapshot_fingerprint: String,
    dispatch_denial_reason: String,
    blocked_preconditions: Vec<String>,
    blocked_checks: Vec<String>,
}

pub(super) fn append_subtask_dispatch_candidate_manifest_recorded(
    store: &BrownieStore,
    record: &brownie_protocol::TaskRecord,
) -> anyhow::Result<()> {
    let events = store.tasks().read_ledger_events(&record.run_id)?;
    if events
        .iter()
        .any(|event| event.kind == LedgerEventKind::SubtaskDispatchCandidateManifestRecorded)
    {
        return Ok(());
    }

    let queued_subtask_ids = events
        .iter()
        .filter(|event| event.kind == LedgerEventKind::SubtaskOrchestrationQueued)
        .filter_map(|event| {
            event
                .payload
                .as_ref()
                .and_then(|payload| payload.get("subtask_id"))
                .and_then(Value::as_str)
                .map(ToString::to_string)
        })
        .collect::<Vec<_>>();
    if queued_subtask_ids.is_empty() {
        return Ok(());
    }

    let dispatch_decisions = events
        .iter()
        .filter(|event| event.kind == LedgerEventKind::SubtaskDispatchDecisionRecorded)
        .filter_map(|event| {
            let payload = event.payload.as_ref()?;
            let decision_id = payload.get("decision_id")?.as_str()?.to_string();
            let guard_id = payload.get("guard_id")?.as_str()?.to_string();
            let snapshot_id = payload.get("snapshot_id")?.as_str()?.to_string();
            let dispatch_decision = payload
                .get("dispatch_decision")
                .and_then(Value::as_str)
                .unwrap_or("Denied")
                .to_string();
            let candidate_status = payload
                .get("candidate_status")
                .and_then(Value::as_str)
                .unwrap_or("Blocked")
                .to_string();
            let snapshot_fingerprint = payload
                .get("snapshot_fingerprint")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let dispatch_denial_reason = payload
                .get("dispatch_denial_reason")
                .and_then(Value::as_str)
                .unwrap_or("Dispatch decision denied all queued candidates.")
                .to_string();
            let blocked_preconditions = payload
                .get("blocked_preconditions")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(ToString::to_string)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            let blocked_checks = payload
                .get("blocked_checks")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(ToString::to_string)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            Some(SubtaskDispatchCandidateManifestSource {
                decision_id,
                guard_id,
                snapshot_id,
                dispatch_decision,
                candidate_status,
                snapshot_fingerprint,
                dispatch_denial_reason,
                blocked_preconditions,
                blocked_checks,
            })
        })
        .collect::<Vec<_>>();
    if dispatch_decisions.is_empty() {
        return Ok(());
    }

    let run_fragment = record
        .run_id
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect::<String>();
    let decision_ids = dispatch_decisions
        .iter()
        .map(|source| source.decision_id.clone())
        .collect::<Vec<_>>();
    let decision_count = dispatch_decisions.len();
    let candidate_count = queued_subtask_ids.len();
    let eligible_candidate_ids: Vec<String> = Vec::new();
    let blocked_candidate_ids = queued_subtask_ids.clone();
    let dispatch_decision = if dispatch_decisions
        .iter()
        .any(|source| source.dispatch_decision == "Denied")
    {
        "Denied"
    } else {
        dispatch_decisions
            .first()
            .map(|source| source.dispatch_decision.as_str())
            .unwrap_or("Denied")
    };
    let candidate_status = if dispatch_decisions
        .iter()
        .any(|source| source.candidate_status == "Blocked")
    {
        "Blocked"
    } else {
        dispatch_decisions
            .first()
            .map(|source| source.candidate_status.as_str())
            .unwrap_or("Blocked")
    };

    let mut blocked_preconditions = dispatch_decisions
        .iter()
        .flat_map(|source| source.blocked_preconditions.iter().cloned())
        .collect::<Vec<_>>();
    blocked_preconditions.push("runtime_subtask_dispatcher_implemented".to_string());
    blocked_preconditions.push("child_task_execution_guard_enabled".to_string());
    blocked_preconditions.sort();
    blocked_preconditions.dedup();

    let mut blocked_checks = vec![
        "dispatch_candidate_manifest_blocked".to_string(),
        "dispatch_candidate_manifest_not_eligible".to_string(),
        "dispatch_decision_denied".to_string(),
        "runtime_dispatcher_not_implemented".to_string(),
        "child_task_execution_disabled".to_string(),
    ];
    blocked_checks.extend(
        dispatch_decisions
            .iter()
            .flat_map(|source| source.blocked_checks.iter().cloned()),
    );
    blocked_checks.sort();
    blocked_checks.dedup();

    let snapshot_fingerprint = dispatch_decisions
        .iter()
        .find_map(|source| {
            if source.snapshot_fingerprint.is_empty() {
                None
            } else {
                Some(source.snapshot_fingerprint.clone())
            }
        })
        .unwrap_or_else(|| "<missing>".to_string());
    let candidate_denial_reason = dispatch_decisions
        .first()
        .map(|source| source.dispatch_denial_reason.as_str())
        .unwrap_or("Dispatch decision denied all queued candidates.");

    let mut fingerprint_inputs = vec![
        "manifest_version=m5.9_dispatch_candidate_manifest_v1".to_string(),
        format!("parent_task_id={}", record.task_id),
        format!("parent_run_id={}", record.run_id),
        format!("decision_count={decision_count}"),
        format!("candidate_count={candidate_count}"),
        format!("dispatch_decision={dispatch_decision}"),
        format!("candidate_status={candidate_status}"),
        format!("snapshot_fingerprint={snapshot_fingerprint}"),
    ];
    for decision_id in &decision_ids {
        fingerprint_inputs.push(format!("decision_id={decision_id}"));
    }
    for candidate_id in &queued_subtask_ids {
        fingerprint_inputs.push(format!("candidate_id={candidate_id}"));
    }
    for check in &blocked_checks {
        fingerprint_inputs.push(format!("blocked_check={check}"));
    }
    let fingerprint_input_count = fingerprint_inputs.len();
    let candidate_manifest_fingerprint = format!(
        "sha256:{}",
        hex_sha256(fingerprint_inputs.join("\n").as_bytes())
    );

    store.tasks().append_task_event_with_payload(
        record,
        LedgerEventKind::SubtaskDispatchCandidateManifestRecorded,
        Some(json!({
            "manifest_id": format!("subtask_dispatch_candidate_manifest_{run_fragment}_1"),
            "parent_task_id": record.task_id,
            "parent_run_id": record.run_id,
            "decision_id": decision_ids[0],
            "decision_count": decision_count,
            "guard_id": dispatch_decisions[0].guard_id,
            "snapshot_id": dispatch_decisions[0].snapshot_id,
            "queued_count": candidate_count,
            "source_event_count": decision_count,
            "status": "Blocked",
            "manifest_status": "Blocked",
            "candidate_status": candidate_status,
            "dispatch_decision": dispatch_decision,
            "candidate_denial_reason": candidate_denial_reason,
            "candidate_count": candidate_count,
            "dispatch_candidate_count": candidate_count,
            "eligible_candidate_count": eligible_candidate_ids.len(),
            "blocked_candidate_count": blocked_candidate_ids.len(),
            "candidate_ids": queued_subtask_ids,
            "eligible_candidate_ids": eligible_candidate_ids,
            "blocked_candidate_ids": blocked_candidate_ids,
            "candidate_manifest_fingerprint": candidate_manifest_fingerprint,
            "snapshot_fingerprint": snapshot_fingerprint,
            "fingerprint_input_count": fingerprint_input_count,
            "required_capability": "runtime_subtask_dispatcher",
            "precondition_count": blocked_preconditions.len(),
            "satisfied_precondition_count": 0,
            "blocked_preconditions": blocked_preconditions,
            "check_count": blocked_checks.len(),
            "blocked_checks": blocked_checks,
            "execution_enabled": false,
            "dispatch_enabled": false,
            "next_action": "await_dispatch_candidate_manifest_preconditions",
            "reason": "Dispatch decision evidence mapped to a per-queued-subtask candidate manifest and denial blocker; no subtask was spawned in M5.9."
        })),
    )
}

struct SubtaskDispatchHandoffEnvelopeSource {
    manifest_id: String,
    decision_id: String,
    dispatch_decision: String,
    candidate_status: String,
    candidate_denial_reason: String,
    candidate_manifest_fingerprint: String,
    candidate_ids: Vec<String>,
    eligible_candidate_ids: Vec<String>,
    blocked_candidate_ids: Vec<String>,
    blocked_preconditions: Vec<String>,
    blocked_checks: Vec<String>,
}

pub(super) fn payload_string_array(payload: &Value, key: &str) -> Vec<String> {
    payload
        .get(key)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

pub(super) fn append_subtask_dispatch_handoff_envelope_recorded(
    store: &BrownieStore,
    record: &brownie_protocol::TaskRecord,
) -> anyhow::Result<()> {
    let events = store.tasks().read_ledger_events(&record.run_id)?;
    if events
        .iter()
        .any(|event| event.kind == LedgerEventKind::SubtaskDispatchHandoffEnvelopeRecorded)
    {
        return Ok(());
    }

    let candidate_manifests = events
        .iter()
        .filter(|event| event.kind == LedgerEventKind::SubtaskDispatchCandidateManifestRecorded)
        .filter_map(|event| {
            let payload = event.payload.as_ref()?;
            let manifest_id = payload.get("manifest_id")?.as_str()?.to_string();
            let decision_id = payload.get("decision_id")?.as_str()?.to_string();
            let dispatch_decision = payload
                .get("dispatch_decision")
                .and_then(Value::as_str)
                .unwrap_or("Denied")
                .to_string();
            let candidate_status = payload
                .get("candidate_status")
                .and_then(Value::as_str)
                .unwrap_or("Blocked")
                .to_string();
            let candidate_denial_reason = payload
                .get("candidate_denial_reason")
                .and_then(Value::as_str)
                .unwrap_or("Candidate manifest blocks scheduler handoff.")
                .to_string();
            let candidate_manifest_fingerprint = payload
                .get("candidate_manifest_fingerprint")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            Some(SubtaskDispatchHandoffEnvelopeSource {
                manifest_id,
                decision_id,
                dispatch_decision,
                candidate_status,
                candidate_denial_reason,
                candidate_manifest_fingerprint,
                candidate_ids: payload_string_array(payload, "candidate_ids"),
                eligible_candidate_ids: payload_string_array(payload, "eligible_candidate_ids"),
                blocked_candidate_ids: payload_string_array(payload, "blocked_candidate_ids"),
                blocked_preconditions: payload_string_array(payload, "blocked_preconditions"),
                blocked_checks: payload_string_array(payload, "blocked_checks"),
            })
        })
        .collect::<Vec<_>>();
    if candidate_manifests.is_empty() {
        return Ok(());
    }

    let run_fragment = record
        .run_id
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect::<String>();
    let manifest_count = candidate_manifests.len();
    let manifest_ids = candidate_manifests
        .iter()
        .map(|source| source.manifest_id.clone())
        .collect::<Vec<_>>();
    let decision_ids = candidate_manifests
        .iter()
        .map(|source| source.decision_id.clone())
        .collect::<Vec<_>>();
    let mut candidate_ids = candidate_manifests
        .iter()
        .flat_map(|source| source.candidate_ids.iter().cloned())
        .collect::<Vec<_>>();
    candidate_ids.sort();
    candidate_ids.dedup();
    let mut eligible_candidate_ids = candidate_manifests
        .iter()
        .flat_map(|source| source.eligible_candidate_ids.iter().cloned())
        .collect::<Vec<_>>();
    eligible_candidate_ids.sort();
    eligible_candidate_ids.dedup();
    let mut blocked_candidate_ids = candidate_manifests
        .iter()
        .flat_map(|source| source.blocked_candidate_ids.iter().cloned())
        .collect::<Vec<_>>();
    blocked_candidate_ids.sort();
    blocked_candidate_ids.dedup();
    let candidate_count = candidate_ids.len();
    let dispatch_decision = if candidate_manifests
        .iter()
        .any(|source| source.dispatch_decision == "Denied")
    {
        "Denied"
    } else {
        candidate_manifests
            .first()
            .map(|source| source.dispatch_decision.as_str())
            .unwrap_or("Denied")
    };
    let candidate_status = if candidate_manifests
        .iter()
        .any(|source| source.candidate_status == "Blocked")
    {
        "Blocked"
    } else {
        candidate_manifests
            .first()
            .map(|source| source.candidate_status.as_str())
            .unwrap_or("Blocked")
    };
    let candidate_denial_reason = candidate_manifests
        .first()
        .map(|source| source.candidate_denial_reason.as_str())
        .unwrap_or("Candidate manifest blocks scheduler handoff.");
    let candidate_manifest_fingerprint = candidate_manifests
        .iter()
        .find_map(|source| {
            if source.candidate_manifest_fingerprint.is_empty() {
                None
            } else {
                Some(source.candidate_manifest_fingerprint.clone())
            }
        })
        .unwrap_or_else(|| "<missing>".to_string());

    let mut blocked_preconditions = candidate_manifests
        .iter()
        .flat_map(|source| source.blocked_preconditions.iter().cloned())
        .collect::<Vec<_>>();
    blocked_preconditions.push("runtime_subtask_dispatcher_implemented".to_string());
    blocked_preconditions.push("runtime_scheduler_handoff_envelope_admitted".to_string());
    blocked_preconditions.push("child_task_execution_guard_enabled".to_string());
    blocked_preconditions.sort();
    blocked_preconditions.dedup();

    let mut blocked_checks = vec![
        "dispatch_handoff_envelope_blocked".to_string(),
        "handoff_ticket_preflight_blocked".to_string(),
        "candidate_replay_guard_blocked".to_string(),
        "candidate_manifest_blocked".to_string(),
        "runtime_scheduler_handoff_not_available".to_string(),
        "child_task_execution_disabled".to_string(),
    ];
    blocked_checks.extend(
        candidate_manifests
            .iter()
            .flat_map(|source| source.blocked_checks.iter().cloned()),
    );
    blocked_checks.sort();
    blocked_checks.dedup();

    let mut fingerprint_inputs = vec![
        "envelope_version=m5.10_dispatch_handoff_envelope_v1".to_string(),
        format!("parent_task_id={}", record.task_id),
        format!("parent_run_id={}", record.run_id),
        format!("manifest_count={manifest_count}"),
        format!("candidate_count={candidate_count}"),
        format!("dispatch_decision={dispatch_decision}"),
        format!("candidate_status={candidate_status}"),
        format!("candidate_manifest_fingerprint={candidate_manifest_fingerprint}"),
    ];
    for manifest_id in &manifest_ids {
        fingerprint_inputs.push(format!("manifest_id={manifest_id}"));
    }
    for decision_id in &decision_ids {
        fingerprint_inputs.push(format!("decision_id={decision_id}"));
    }
    for candidate_id in &candidate_ids {
        fingerprint_inputs.push(format!("candidate_id={candidate_id}"));
    }
    for check in &blocked_checks {
        fingerprint_inputs.push(format!("blocked_check={check}"));
    }
    let fingerprint_input_count = fingerprint_inputs.len();
    let handoff_envelope_fingerprint = format!(
        "sha256:{}",
        hex_sha256(fingerprint_inputs.join("\n").as_bytes())
    );

    store.tasks().append_task_event_with_payload(
        record,
        LedgerEventKind::SubtaskDispatchHandoffEnvelopeRecorded,
        Some(json!({
            "handoff_envelope_id": format!("subtask_dispatch_handoff_envelope_{run_fragment}_1"),
            "parent_task_id": record.task_id,
            "parent_run_id": record.run_id,
            "manifest_id": manifest_ids[0],
            "manifest_count": manifest_count,
            "decision_id": decision_ids[0],
            "queued_count": candidate_count,
            "source_event_count": manifest_count,
            "status": "Accepted",
            "handoff_envelope_status": "Accepted",
            "handoff_ticket_status": "Blocked",
            "replay_guard_status": "Blocked",
            "scheduler_handoff_status": "Blocked",
            "candidate_status": candidate_status,
            "dispatch_decision": dispatch_decision,
            "candidate_denial_reason": candidate_denial_reason,
            "replay_guard_reason": "Candidate manifest is blocked; handoff envelope cannot replay or dispatch queued candidates.",
            "candidate_count": candidate_count,
            "dispatch_candidate_count": candidate_count,
            "eligible_candidate_count": eligible_candidate_ids.len(),
            "blocked_candidate_count": blocked_candidate_ids.len(),
            "handoff_ticket_count": 0,
            "candidate_ids": candidate_ids,
            "eligible_candidate_ids": eligible_candidate_ids,
            "blocked_candidate_ids": blocked_candidate_ids,
            "candidate_manifest_fingerprint": candidate_manifest_fingerprint,
            "handoff_envelope_fingerprint": handoff_envelope_fingerprint,
            "fingerprint_input_count": fingerprint_input_count,
            "required_capability": "runtime_subtask_dispatcher",
            "precondition_count": blocked_preconditions.len(),
            "satisfied_precondition_count": 0,
            "blocked_preconditions": blocked_preconditions,
            "check_count": blocked_checks.len(),
            "blocked_checks": blocked_checks,
            "execution_enabled": false,
            "dispatch_enabled": false,
            "next_action": "materialize_controlled_child_task",
            "reason": "Candidate manifest evidence accepted for controlled child TaskRecord materialization; scheduler dispatch remains disabled."
        })),
    )
}

pub(super) fn fragment_for_identifier(value: &str) -> String {
    value
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect::<String>()
}

pub(super) fn queued_subtask_id_from_event(event: &LedgerEvent) -> Option<String> {
    if event.kind != LedgerEventKind::SubtaskOrchestrationQueued {
        return None;
    }
    event
        .payload
        .as_ref()
        .and_then(|payload| payload.get("subtask_id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|subtask_id| !subtask_id.is_empty())
        .map(ToString::to_string)
}

pub(super) fn parent_join_continuation_window(
    events: &[LedgerEvent],
    consumption_index: usize,
) -> &[LedgerEvent] {
    let start_index = consumption_index + 1;
    let end_index = events
        .iter()
        .enumerate()
        .skip(start_index)
        .find_map(|(index, event)| {
            if event.kind == LedgerEventKind::ParentJoinContinuationFingerprintConsumed
                || matches!(
                    event.kind,
                    LedgerEventKind::TaskCompleted
                        | LedgerEventKind::TaskFailed
                        | LedgerEventKind::TaskCancelled
                )
            {
                Some(index)
            } else {
                None
            }
        })
        .unwrap_or(events.len());
    &events[start_index..end_index]
}

pub(super) fn queued_subtask_ids_from_events(events: &[LedgerEvent]) -> Vec<String> {
    let mut candidate_ids = events
        .iter()
        .filter_map(queued_subtask_id_from_event)
        .collect::<Vec<_>>();
    candidate_ids.sort();
    candidate_ids.dedup();
    candidate_ids
}

pub(super) fn source_intent_summary_fingerprint_inputs(
    source_candidate_id: &str,
    source_intent_summary: Option<&ChildTaskSourceIntentSummary>,
) -> Vec<String> {
    let Some(summary) = source_intent_summary else {
        return vec![
            format!("candidate_id={source_candidate_id}"),
            "source_intent_summary=<missing>".to_string(),
        ];
    };
    vec![
        format!("candidate_id={source_candidate_id}"),
        format!("tool_id={}", summary.tool_id),
        format!("required_action={:?}", summary.required_action),
        format!("request_reason={}", summary.request_reason),
        format!(
            "requested_goal_preview={}",
            summary
                .requested_goal_preview
                .as_deref()
                .unwrap_or("<none>")
        ),
        format!(
            "requested_mode_id={}",
            summary.requested_mode_id.as_deref().unwrap_or("<none>")
        ),
        format!("input_summary.has_path={}", summary.input_summary.has_path),
        format!(
            "input_summary.field_count={}",
            summary.input_summary.field_count
        ),
    ]
}

pub(super) fn append_parent_join_continuation_handoff_envelope_recorded(
    store: &BrownieStore,
    record: &brownie_protocol::TaskRecord,
    continuation: &ParentJoinContinuationMaterialization,
) -> anyhow::Result<()> {
    if continuation.admission_id.trim().is_empty() {
        return Ok(());
    }

    let events = store.tasks().read_ledger_events(&record.run_id)?;
    if events.iter().any(|event| {
        event.kind == LedgerEventKind::SubtaskDispatchHandoffEnvelopeRecorded
            && event
                .payload
                .as_ref()
                .and_then(|payload| payload.get("parent_join_admission_id"))
                .and_then(Value::as_str)
                == Some(continuation.admission_id.as_str())
    }) {
        return Ok(());
    }

    let Some(consumption_index) = events.iter().position(|event| {
        event.kind == LedgerEventKind::ParentJoinContinuationFingerprintConsumed
            && event
                .payload
                .as_ref()
                .and_then(|payload| payload.get("admission_id"))
                .and_then(Value::as_str)
                == Some(continuation.admission_id.as_str())
    }) else {
        return Ok(());
    };

    let continuation_events = parent_join_continuation_window(&events, consumption_index);
    let candidate_ids = queued_subtask_ids_from_events(continuation_events);
    if candidate_ids.is_empty() {
        return Ok(());
    }
    if recovery_cycle_depth_exceeds_budget(continuation.child_recovery_cycle_depth) {
        return append_recovery_cycle_budget_blocked_handoff_envelope(
            store,
            record,
            continuation,
            &candidate_ids,
        );
    }

    let mut fingerprint_inputs = vec![
        "envelope_version=m5.20_parent_join_continuation_handoff_envelope_v1".to_string(),
        format!("parent_task_id={}", record.task_id),
        format!("parent_run_id={}", record.run_id),
        format!("parent_join_admission_id={}", continuation.admission_id),
        format!(
            "parent_join_child_completion_fingerprint={}",
            continuation.child_completion_fingerprint
        ),
        format!(
            "parent_join_child_completion_child_count={}",
            continuation.child_completion_child_count
        ),
        format!(
            "parent_join_terminal_completed_child_count={}",
            continuation.child_terminal_completed_count
        ),
        format!(
            "parent_join_terminal_failed_child_count={}",
            continuation.child_terminal_failed_count
        ),
        format!(
            "parent_join_recovery_cycle_depth={}",
            continuation.child_recovery_cycle_depth
        ),
        format!("candidate_count={}", candidate_ids.len()),
    ];
    for candidate_id in &candidate_ids {
        let source_intent_summary =
            queued_subtask_source_intent_summary(continuation_events, candidate_id);
        fingerprint_inputs.extend(source_intent_summary_fingerprint_inputs(
            candidate_id,
            source_intent_summary.as_ref(),
        ));
    }
    let fingerprint_input_count = fingerprint_inputs.len();
    let handoff_envelope_fingerprint = format!(
        "sha256:{}",
        hex_sha256(fingerprint_inputs.join("\n").as_bytes())
    );
    let run_fragment = fragment_for_identifier(&record.run_id);
    let admission_fragment = fragment_for_identifier(&continuation.admission_id);
    let candidate_count = candidate_ids.len();
    let eligible_candidate_ids = candidate_ids.clone();
    let mut payload = json!({
        "handoff_envelope_id": format!("subtask_dispatch_handoff_envelope_{run_fragment}_{admission_fragment}"),
        "parent_task_id": record.task_id,
        "parent_run_id": record.run_id,
        "parent_join_admission_id": continuation.admission_id,
        "parent_join_child_completion_fingerprint": continuation.child_completion_fingerprint,
        "parent_join_child_completion_child_count": continuation.child_completion_child_count,
        "parent_join_terminal_completed_child_count": continuation.child_terminal_completed_count,
        "parent_join_terminal_failed_child_count": continuation.child_terminal_failed_count,
        "parent_join_fingerprint_input_count": continuation.child_completion_fingerprint_input_count,
        "parent_join_recovery_cycle": continuation.child_terminal_failed_count > 0 && continuation.child_terminal_completed_count > 0,
        "queued_count": candidate_count,
        "source_event_count": candidate_count,
        "status": "Accepted",
        "handoff_envelope_status": "Accepted",
        "handoff_ticket_status": "Blocked",
        "replay_guard_status": "Accepted",
        "scheduler_handoff_status": "Blocked",
        "candidate_status": "Accepted",
        "dispatch_decision": "MaterializeControlledChildTask",
        "candidate_count": candidate_count,
        "dispatch_candidate_count": candidate_count,
        "eligible_candidate_count": candidate_count,
        "blocked_candidate_count": 0,
        "handoff_ticket_count": 0,
        "candidate_ids": candidate_ids,
        "eligible_candidate_ids": eligible_candidate_ids,
        "blocked_candidate_ids": [],
        "handoff_envelope_fingerprint": handoff_envelope_fingerprint,
        "fingerprint_input_count": fingerprint_input_count,
        "required_capability": "continuation_subtask_materialization",
        "precondition_count": 0,
        "satisfied_precondition_count": 0,
        "blocked_preconditions": [],
        "check_count": 2,
        "blocked_checks": [
            "scheduler_handoff_not_available",
            "child_task_auto_run_disabled"
        ],
        "execution_enabled": false,
        "dispatch_enabled": false,
        "continuation_materialization": true,
        "continuation_source": "parent_join_continuation",
        "next_action": "explicit_child_task_run",
        "reason": "Approved subtask intents emitted during an atomic parent join continuation were accepted for controlled queued child TaskRecord materialization; child execution remains explicit."
    });
    if let Some(payload) = payload.as_object_mut() {
        payload.insert(
            "parent_join_recovery_cycle_depth".to_string(),
            json!(continuation.child_recovery_cycle_depth),
        );
    }

    store.tasks().append_task_event_with_payload(
        record,
        LedgerEventKind::SubtaskDispatchHandoffEnvelopeRecorded,
        Some(payload),
    )
}

pub(super) fn append_recovery_cycle_budget_blocked_handoff_envelope(
    store: &BrownieStore,
    record: &brownie_protocol::TaskRecord,
    continuation: &ParentJoinContinuationMaterialization,
    candidate_ids: &[String],
) -> anyhow::Result<()> {
    let candidate_count = candidate_ids.len();
    let mut fingerprint_inputs = vec![
        "envelope_version=m5.27_recovery_cycle_budget_block_v1".to_string(),
        format!("parent_task_id={}", record.task_id),
        format!("parent_run_id={}", record.run_id),
        format!("parent_join_admission_id={}", continuation.admission_id),
        format!(
            "parent_join_child_completion_fingerprint={}",
            continuation.child_completion_fingerprint
        ),
        format!(
            "parent_join_recovery_cycle_depth={}",
            continuation.child_recovery_cycle_depth
        ),
        format!("max_recovery_cycle_depth={MAX_RECOVERY_CYCLE_DEPTH}"),
        format!("candidate_count={candidate_count}"),
    ];
    for candidate_id in candidate_ids {
        fingerprint_inputs.push(format!("candidate_id={candidate_id}"));
    }
    let fingerprint_input_count = fingerprint_inputs.len();
    let handoff_envelope_fingerprint = format!(
        "sha256:{}",
        hex_sha256(fingerprint_inputs.join("\n").as_bytes())
    );
    let run_fragment = fragment_for_identifier(&record.run_id);
    let admission_fragment = fragment_for_identifier(&continuation.admission_id);
    let candidate_ids = candidate_ids.to_vec();
    let blocked_candidate_ids = candidate_ids.clone();
    store.tasks().append_task_event_with_payload(
        record,
        LedgerEventKind::SubtaskDispatchHandoffEnvelopeRecorded,
        Some(json!({
            "handoff_envelope_id": format!("subtask_dispatch_handoff_envelope_{run_fragment}_{admission_fragment}_budget_blocked"),
            "parent_task_id": record.task_id,
            "parent_run_id": record.run_id,
            "parent_join_admission_id": continuation.admission_id,
            "parent_join_child_completion_fingerprint": continuation.child_completion_fingerprint,
            "parent_join_child_completion_child_count": continuation.child_completion_child_count,
            "parent_join_terminal_completed_child_count": continuation.child_terminal_completed_count,
            "parent_join_terminal_failed_child_count": continuation.child_terminal_failed_count,
            "parent_join_fingerprint_input_count": continuation.child_completion_fingerprint_input_count,
            "parent_join_recovery_cycle": continuation.child_terminal_failed_count > 0 && continuation.child_terminal_completed_count > 0,
            "parent_join_recovery_cycle_depth": continuation.child_recovery_cycle_depth,
            "max_recovery_cycle_depth": MAX_RECOVERY_CYCLE_DEPTH,
            "recovery_cycle_budget_status": "Exceeded",
            "status": "Blocked",
            "handoff_envelope_status": "Blocked",
            "scheduler_handoff_status": "Blocked",
            "candidate_status": "Blocked",
            "dispatch_decision": "RecoveryCycleBudgetExceeded",
            "candidate_count": candidate_count,
            "eligible_candidate_count": 0,
            "blocked_candidate_count": candidate_count,
            "candidate_ids": candidate_ids,
            "eligible_candidate_ids": [],
            "blocked_candidate_ids": blocked_candidate_ids,
            "handoff_envelope_fingerprint": handoff_envelope_fingerprint,
            "fingerprint_input_count": fingerprint_input_count,
            "required_capability": "recovery_cycle_budget_admission_guard",
            "execution_enabled": false,
            "dispatch_enabled": false,
            "continuation_materialization": true,
            "continuation_source": "parent_join_continuation",
            "next_action": "stop_recovery_cycle_materialization",
            "reason": "Recovery-cycle continuation exceeded runtime budget; no child TaskRecord was materialized."
        })),
    )
}

pub(super) fn normalize_source_intent_reason(reason: &str) -> String {
    const SOURCE_INTENT_REASON_CHARS: usize = 1000;
    let normalized = reason.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        "Materialized from approved subtask intent.".to_string()
    } else {
        preview_with_limit(&normalized, SOURCE_INTENT_REASON_CHARS)
    }
}

pub(super) fn child_goal_from_source_intent(
    source_candidate_id: &str,
    source_intent_summary: Option<&ChildTaskSourceIntentSummary>,
) -> String {
    if let Some(goal) = source_intent_summary
        .and_then(|summary| summary.requested_goal_preview.as_deref())
        .map(|goal| goal.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|goal| !goal.is_empty())
    {
        return preview_with_limit(&goal, MAX_SUBTASK_SPAWN_GOAL_CHARS);
    }

    const CHILD_SOURCE_INTENT_GOAL_CHARS: usize = 240;
    let reason = source_intent_summary
        .map(|summary| summary.request_reason.as_str())
        .unwrap_or("Materialized from approved subtask intent.");
    let reason = preview_with_limit(reason, CHILD_SOURCE_INTENT_GOAL_CHARS);
    format!("Subtask {source_candidate_id}: {reason}")
}

pub(super) fn queued_subtask_source_intent_summary(
    events: &[LedgerEvent],
    source_candidate_id: &str,
) -> Option<ChildTaskSourceIntentSummary> {
    events
        .iter()
        .filter(|event| event.kind == LedgerEventKind::SubtaskOrchestrationQueued)
        .find_map(|event| {
            let payload = event.payload.as_ref()?;
            if payload.get("subtask_id").and_then(Value::as_str) != Some(source_candidate_id) {
                return None;
            }
            let tool_id = payload
                .get("tool_id")
                .and_then(Value::as_str)
                .unwrap_or(SUBTASK_SPAWN_TOOL_ID)
                .to_string();
            let required_action = payload
                .get("required_action")
                .cloned()
                .and_then(|value| serde_json::from_value(value).ok())
                .unwrap_or(RuntimeActionName::SpawnSubtask);
            let request_reason = payload
                .get("request_reason")
                .and_then(Value::as_str)
                .map(normalize_source_intent_reason)
                .unwrap_or_else(|| "Materialized from approved subtask intent.".to_string());
            let input_summary = payload
                .get("input_summary")
                .cloned()
                .and_then(|value| serde_json::from_value(value).ok())
                .unwrap_or(ToolIntentInputSummary {
                    has_path: false,
                    field_count: 0,
                });
            let requested_goal_preview = payload
                .get("requested_goal_preview")
                .and_then(Value::as_str)
                .map(normalize_source_intent_reason);
            let requested_mode_id = payload
                .get("requested_mode_id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|mode_id| !mode_id.is_empty())
                .map(ToString::to_string);

            Some(ChildTaskSourceIntentSummary {
                tool_id,
                required_action,
                request_reason,
                requested_goal_preview,
                requested_mode_id,
                input_summary,
            })
        })
}

pub(super) fn handoff_envelope_candidate_ids(envelope_payload: &Value) -> Vec<String> {
    let mut candidate_ids = Vec::new();
    for key in ["candidate_ids", "blocked_candidate_ids"] {
        for candidate_id in payload_string_array(envelope_payload, key) {
            if candidate_id.trim().is_empty() || candidate_ids.contains(&candidate_id) {
                continue;
            }
            candidate_ids.push(candidate_id);
        }
    }
    candidate_ids
}

pub(super) fn materialize_controlled_child_task_from_handoff_envelope(
    store: &BrownieStore,
    record: &brownie_protocol::TaskRecord,
) -> anyhow::Result<Option<brownie_protocol::TaskRecord>> {
    let events = store.tasks().read_ledger_events(&record.run_id)?;
    let envelope_payloads = events
        .iter()
        .filter(|event| event.kind == LedgerEventKind::SubtaskDispatchHandoffEnvelopeRecorded)
        .filter_map(|event| event.payload.as_ref())
        .collect::<Vec<_>>();

    let mut first_child = None;
    for envelope_payload in envelope_payloads {
        if envelope_payload
            .get("handoff_envelope_status")
            .and_then(Value::as_str)
            != Some("Accepted")
        {
            continue;
        }

        let Some(source_handoff_envelope_fingerprint) = envelope_payload
            .get("handoff_envelope_fingerprint")
            .and_then(Value::as_str)
            .map(ToString::to_string)
        else {
            continue;
        };
        let Some(source_handoff_envelope_id) = envelope_payload
            .get("handoff_envelope_id")
            .and_then(Value::as_str)
            .map(ToString::to_string)
        else {
            continue;
        };
        let recovery_cycle_provenance =
            recovery_cycle_child_provenance_from_handoff_envelope(envelope_payload)?;

        for source_candidate_id in handoff_envelope_candidate_ids(envelope_payload) {
            let child = if let Some(existing) = store
                .tasks()
                .find_child_task_by_candidate_and_handoff_fingerprint(
                    &record.run_id,
                    &source_candidate_id,
                    &source_handoff_envelope_fingerprint,
                )? {
                existing
            } else {
                let source_intent_summary =
                    queued_subtask_source_intent_summary(&events, &source_candidate_id);
                let goal = child_goal_from_source_intent(
                    &source_candidate_id,
                    source_intent_summary.as_ref(),
                );
                let mode_id = source_intent_summary
                    .as_ref()
                    .and_then(|summary| summary.requested_mode_id.clone())
                    .or_else(|| record.mode_id.clone());
                let external_modepack_child_provenance = match mode_id.as_deref() {
                    Some(child_mode_id) => external_modepack_child_provenance_payload(
                        store,
                        child_mode_id,
                        &record.run_id,
                        &source_handoff_envelope_id,
                        &source_handoff_envelope_fingerprint,
                    )
                    .map_err(anyhow::Error::msg)?,
                    None => None,
                };

                store.tasks().start_child_task(ChildTaskStartParams {
                    goal,
                    mode_id,
                    parent_task_id: record.task_id.clone(),
                    parent_run_id: record.run_id.clone(),
                    source_candidate_id,
                    source_handoff_envelope_id: source_handoff_envelope_id.clone(),
                    source_handoff_envelope_fingerprint: source_handoff_envelope_fingerprint
                        .clone(),
                    source_intent_summary,
                    recovery_cycle_provenance: recovery_cycle_provenance.clone(),
                    external_modepack_child_provenance,
                })?
            };
            if first_child.is_none() {
                first_child = Some(child);
            }
        }
    }
    Ok(first_child)
}

pub(super) fn recovery_cycle_child_provenance_from_handoff_envelope(
    envelope_payload: &Value,
) -> anyhow::Result<Option<RecoveryCycleChildProvenance>> {
    let Some(parent_join_admission_id) =
        optional_non_empty_payload_string(envelope_payload, "parent_join_admission_id")?
    else {
        return Ok(None);
    };
    let parent_join_child_completion_fingerprint = required_non_empty_payload_string(
        envelope_payload,
        "parent_join_child_completion_fingerprint",
    )?;
    if !is_sha256_fingerprint(&parent_join_child_completion_fingerprint) {
        anyhow::bail!(
            "invalid recovery-cycle child provenance: parent_join_child_completion_fingerprint must be sha256:<64 lowercase hex>"
        );
    }

    let parent_join_child_completion_child_count =
        required_usize_payload(envelope_payload, "parent_join_child_completion_child_count")?;
    let parent_join_terminal_failed_child_count =
        required_usize_payload(envelope_payload, "parent_join_terminal_failed_child_count")?;
    let parent_join_terminal_completed_child_count = required_usize_payload(
        envelope_payload,
        "parent_join_terminal_completed_child_count",
    )?;
    if parent_join_terminal_failed_child_count + parent_join_terminal_completed_child_count
        != parent_join_child_completion_child_count
    {
        anyhow::bail!(
            "invalid recovery-cycle child provenance: terminal failed/completed counts must sum to child completion child count"
        );
    }

    let parent_join_recovery_cycle =
        required_bool_payload(envelope_payload, "parent_join_recovery_cycle")?;
    let parent_join_recovery_cycle_depth =
        required_usize_payload(envelope_payload, "parent_join_recovery_cycle_depth")?;
    if parent_join_recovery_cycle {
        if parent_join_recovery_cycle_depth == 0 {
            anyhow::bail!(
                "invalid recovery-cycle child provenance: recovery-cycle depth must be at least 1 when parent_join_recovery_cycle is true"
            );
        }
        if recovery_cycle_depth_exceeds_budget(parent_join_recovery_cycle_depth) {
            anyhow::bail!(
                "invalid recovery-cycle child provenance: recovery-cycle depth exceeds runtime budget"
            );
        }
    } else {
        if parent_join_recovery_cycle_depth != 0 {
            anyhow::bail!(
                "invalid recovery-cycle child provenance: recovery-cycle depth must be 0 when parent_join_recovery_cycle is false"
            );
        }
        return Ok(None);
    }

    Ok(Some(RecoveryCycleChildProvenance {
        parent_join_admission_id,
        parent_join_child_completion_fingerprint,
        parent_join_child_completion_child_count,
        parent_join_terminal_failed_child_count,
        parent_join_terminal_completed_child_count,
        parent_join_recovery_cycle,
        parent_join_recovery_cycle_depth,
    }))
}

pub(super) fn optional_non_empty_payload_string(
    payload: &Value,
    key: &str,
) -> anyhow::Result<Option<String>> {
    let Some(value) = payload.get(key) else {
        return Ok(None);
    };
    let Some(value) = value.as_str() else {
        anyhow::bail!("invalid recovery-cycle child provenance: {key} must be a string");
    };
    if value.trim().is_empty() {
        anyhow::bail!("invalid recovery-cycle child provenance: {key} must be non-empty");
    }
    Ok(Some(value.to_string()))
}

pub(super) fn required_non_empty_payload_string(
    payload: &Value,
    key: &str,
) -> anyhow::Result<String> {
    optional_non_empty_payload_string(payload, key)?.ok_or_else(|| {
        anyhow::anyhow!("invalid recovery-cycle child provenance: missing required {key}")
    })
}

pub(super) fn required_bool_payload(payload: &Value, key: &str) -> anyhow::Result<bool> {
    payload.get(key).and_then(Value::as_bool).ok_or_else(|| {
        anyhow::anyhow!("invalid recovery-cycle child provenance: {key} must be a boolean")
    })
}

pub(super) fn required_usize_payload(payload: &Value, key: &str) -> anyhow::Result<usize> {
    usize::try_from(payload.get(key).and_then(Value::as_u64).ok_or_else(|| {
        anyhow::anyhow!(
            "invalid recovery-cycle child provenance: {key} must be a non-negative integer"
        )
    })?)
    .map_err(|_| anyhow::anyhow!("invalid recovery-cycle child provenance: {key} is too large"))
}

pub(super) fn is_sha256_fingerprint(value: &str) -> bool {
    let Some(hex) = value.strip_prefix("sha256:") else {
        return false;
    };
    hex.len() == 64
        && hex
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

pub(super) fn tool_execution_ledger_payload(result: &brownie_tools::ToolExecutionResult) -> Value {
    let mut payload = serde_json::Map::new();
    payload.insert("tool_id".to_string(), json!(result.tool_id));
    payload.insert(
        "status".to_string(),
        json!(match result.status {
            ToolExecutionStatus::Completed => "Completed",
            ToolExecutionStatus::Denied => "Denied",
            ToolExecutionStatus::Failed => "Failed",
        }),
    );
    if let Some(content) = result.output.get("content").and_then(Value::as_str) {
        payload.insert(
            "output_preview".to_string(),
            json!(preview_tool_output(content)),
        );
    }
    if let Some(bytes_read) = result.output.get("bytes_read") {
        payload.insert("bytes_read".to_string(), bytes_read.clone());
    }
    if let Some(truncated) = result.output.get("truncated") {
        payload.insert("truncated".to_string(), truncated.clone());
    }
    for key in [
        "check_id",
        "verification_status",
        "process_launched",
        "exit_code",
        "timed_out",
        "duration_ms",
        "standard_output_bytes",
        "standard_error_bytes",
        "standard_output_truncated",
        "standard_error_truncated",
        "output_redacted",
        "target_dir_isolated",
        "cleanup_succeeded",
        "cargo_dependency_fetch_offline",
        "os_network_isolated",
        "compile_time_code_sandboxed",
        "test_code_executed",
        "trusted_workspace_required",
        "process_tree_timeout_supported",
        "process_tree_kill_attempted",
        "process_tree_kill_succeeded",
        "process_tree_kill_reason",
        "operation",
        "line_count",
        "captured_bytes",
        "output_truncated",
        "output_oversized",
        "reader_thread_joined",
        "git_environment_hardened",
        "git_prompts_disabled",
        "git_optional_locks_disabled",
        "raw_diff_redacted",
        "raw_file_content_redacted",
        "absolute_paths_redacted",
        "raw_message_redacted",
        "message_fingerprint",
        "expected_parent_head",
        "authorized_change_set_fingerprint",
        "workspace_write_scope_fingerprint",
        "logical_invocation_fingerprint",
        "authorized_path_count",
        "committed_tree_fingerprint",
        "commit_id",
        "replayed",
        "mutation_process_launched",
        "git_process_count",
        "git_processes_bounded",
        "ambient_index_ignored",
        "used_temporary_index",
        "temporary_index_cleaned",
        "used_git_plumbing",
        "repository_hooks_bypassed",
        "runtime_authorization_required",
        "failed_git_operation",
    ] {
        if let Some(value) = result.output.get(key) {
            payload.insert(key.to_string(), value.clone());
        }
    }
    if let Some(value) = result.output.get("bounded_cargo_diagnostics") {
        let diagnostics = bounded_cargo_diagnostics_from_value(value);
        if !diagnostics.is_empty() {
            payload.insert("bounded_cargo_diagnostics".to_string(), json!(diagnostics));
        }
    }
    if let Some(git) = result.output.get("git").and_then(Value::as_object) {
        let mut git_payload = serde_json::Map::new();
        for key in [
            "operation",
            "result_fingerprint",
            "summary_line_count",
            "materialized_summary_line_count",
            "output_truncated",
            "max_summary_lines",
            "max_summary_line_chars",
            "raw_diff_redacted",
            "raw_file_content_redacted",
            "absolute_paths_redacted",
        ] {
            if let Some(value) = git.get(key) {
                git_payload.insert(key.to_string(), value.clone());
            }
        }
        if let Some(lines) = git.get("summary_lines").and_then(Value::as_array) {
            let bounded_lines = lines
                .iter()
                .filter_map(Value::as_str)
                .take(MAX_GIT_SUMMARY_LINES)
                .map(|line| {
                    line.chars()
                        .take(MAX_GIT_SUMMARY_LINE_CHARS)
                        .collect::<String>()
                })
                .collect::<Vec<_>>();
            git_payload.insert("summary_lines".to_string(), json!(bounded_lines));
        }
        payload.insert("git".to_string(), Value::Object(git_payload));
    }
    if let Some(reason) = result.output.get("reason") {
        payload.insert("reason".to_string(), reason.clone());
    }
    Value::Object(payload)
}

pub(super) fn tool_execute_result_ledger_payload(result: &ToolExecuteResult) -> Value {
    let mut payload = serde_json::Map::new();
    payload.insert("tool_id".to_string(), json!(result.tool_id));
    payload.insert(
        "status".to_string(),
        json!(match result.status {
            ToolExecuteStatus::Completed => "Completed",
            ToolExecuteStatus::Denied => "Denied",
            ToolExecuteStatus::Failed => "Failed",
        }),
    );
    if let Some(reason) = result.output.get("reason").and_then(Value::as_str) {
        payload.insert("reason".to_string(), json!(preview_tool_output(reason)));
    }
    if let Some(mcp) = result.output.get("mcp").and_then(Value::as_object) {
        let mut mcp_payload = serde_json::Map::new();
        for key in [
            "server_id",
            "tool_name",
            "protocol_version",
            "server_config_identity_fingerprint",
            "request_fingerprint",
            "result_fingerprint",
            "is_error",
            "protocol_status",
            "tool_status",
            "execution_status",
            "retry_policy",
            "content_item_count",
            "materialized_content_item_count",
            "content_truncated",
            "text_chars",
            "materialized_text_chars",
            "max_content_items",
            "max_text_item_chars",
            "max_total_text_chars",
        ] {
            if let Some(value) = mcp.get(key) {
                mcp_payload.insert(key.to_string(), value.clone());
            }
        }
        if let Some(items) = mcp.get("content_items").and_then(Value::as_array) {
            let bounded_items = items.iter().take(8).cloned().collect::<Vec<_>>();
            mcp_payload.insert("content_items".to_string(), json!(bounded_items));
        }
        payload.insert("mcp".to_string(), Value::Object(mcp_payload));
    }
    if let Some(provenance) = result
        .output
        .get("catalog_provenance")
        .and_then(Value::as_object)
    {
        let mut provenance_payload = serde_json::Map::new();
        for key in [
            "server_id",
            "tool_name",
            "input_schema_fingerprint",
            "output_schema_fingerprint",
            "annotations",
            "annotation_fingerprint",
            "server_config_identity_fingerprint",
            "protocol_version",
            "catalog_fingerprint",
        ] {
            if let Some(value) = provenance.get(key) {
                provenance_payload.insert(key.to_string(), value.clone());
            }
        }
        payload.insert(
            "catalog_provenance".to_string(),
            Value::Object(provenance_payload),
        );
    }
    if let Some(policy) = result.output.get("mcp_safety_policy") {
        payload.insert("mcp_safety_policy".to_string(), policy.clone());
    }
    if let Some(binding) = result.output.get("mcp_approval_binding") {
        payload.insert("mcp_approval_binding".to_string(), binding.clone());
    }
    Value::Object(payload)
}

fn with_mcp_request_fingerprint(mut output: Value, request_fingerprint: &str) -> Value {
    if let Some(object) = output.as_object_mut() {
        object.insert(
            "request_fingerprint".to_string(),
            json!(request_fingerprint),
        );
    }
    output
}

fn mcp_tool_execution_request_fingerprint(tool_id: &str, input: &Value) -> String {
    let seed = json!({
        "version": "mcp_tool_execution_request_v1",
        "tool_id": tool_id,
        "input": canonical_json_value(input),
    });
    format!("sha256:{}", hex_sha256(seed.to_string().as_bytes()))
}

fn canonical_json_value(value: &Value) -> Value {
    match value {
        Value::Object(object) => {
            let mut sorted = serde_json::Map::new();
            let mut keys = object.keys().collect::<Vec<_>>();
            keys.sort();
            for key in keys {
                sorted.insert(key.clone(), canonical_json_value(&object[key]));
            }
            Value::Object(sorted)
        }
        Value::Array(items) => Value::Array(items.iter().map(canonical_json_value).collect()),
        other => other.clone(),
    }
}

pub(super) fn append_tool_plan_events(
    store: &BrownieStore,
    record: &brownie_protocol::TaskRecord,
    policy: &CompiledModePolicy,
) -> anyhow::Result<()> {
    let plan = ToolPlanner::plan(ToolPlanningInput {
        task_id: record.task_id.clone(),
        goal: record.goal.clone(),
        mode_id: policy.mode_id.clone(),
    });
    store.tasks().append_task_event_with_payload(
        record,
        LedgerEventKind::ToolPlanned,
        Some(json!({
            "tool_ids": plan.items.iter().map(|item| item.tool_id.as_str()).collect::<Vec<_>>(),
        })),
    )?;
    let evaluation = ToolPlanEvaluator::evaluate(policy, plan);
    for decision in evaluation.items {
        let payload = json!({
            "tool_id": decision.tool_id,
            "required_action": runtime_action_name(&decision.required_action),
            "allowed": decision.allowed,
            "reason": decision.reason,
        });
        store.tasks().append_task_event_with_payload(
            record,
            LedgerEventKind::ToolPermissionChecked,
            Some(payload.clone()),
        )?;
        store.tasks().append_task_event_with_payload(
            record,
            if decision.allowed {
                LedgerEventKind::ToolPlanApproved
            } else {
                LedgerEventKind::ToolPlanDenied
            },
            Some(payload),
        )?;
    }
    Ok(())
}

pub(super) const DEFAULT_MODE_ID_FOR_RUN: &str = "orchestrator";
