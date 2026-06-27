//! Brownie runtime entry points.

use brownie_agent_loop::{AgentLoop, AgentLoopState};
use brownie_agentmodes::{
    BuiltinModeRegistry, CompiledModePolicy, RuntimeAction, RuntimePermissionGate,
};
use brownie_config::{BrownieConfig, LlmProfile, RuntimeConfigLoader, CONFIG_RELATIVE_PATH};
use brownie_context::{ContextMaterializer, ContextMaterializerInput};
use brownie_llm::{
    redact_secret, FakeLlmProvider, LlmProvider, LlmProviderKind, LlmProviderStatus,
    OpenAiCompatibleConfig, OpenAiCompatibleConfigFromEnv, OpenAiCompatibleLlmProvider,
};
use brownie_protocol::{
    JsonRpcError, JsonRpcRequest, JsonRpcResponse, LedgerEventSummary, LlmStatusResult,
    ModeGetParams, ModeListResult, ModePermissionsSummary, ModeSummary, PermissionCheckParams,
    PermissionCheckResult, RunEventsParams, RunEventsResult, RunInspectParams, RunInspectResult,
    RunInspectSummary, RuntimeActionName, RuntimeConfigGetResult, RuntimeState, RuntimeStatus,
    TaskGetParams, TaskInspectParams, TaskInspectResult, TaskListResult, TaskRunParams,
    TaskRunResult, TaskStartParams, TaskStartResult, TaskStatus, ToolExecuteParams,
    ToolExecuteResult, ToolExecuteStatus, ToolIntentDecisionSummary, ToolIntentParseParams,
    ToolIntentParseResult, ToolIntentRejectedSummary, ToolListResult, ToolPlanDecisionSummary,
    ToolPlanParams, ToolPlanResult, ToolSummary,
};
use brownie_store::{BrownieStore, LedgerEvent, LedgerEventKind};
use brownie_tools::{
    BuiltinToolRegistry, RejectedToolIntent, ToolExecutionRequest, ToolExecutionStatus,
    ToolExecutor, ToolIntentDecision, ToolIntentEvaluator, ToolIntentParser, ToolPlanDecision,
    ToolPlanEvaluator, ToolPlanner, ToolPlanningInput, WORKSPACE_READ_TOOL_ID,
};
use serde_json::{json, Value};

const JSONRPC_VERSION: &str = "2.0";
const METHOD_RUNTIME_STATUS: &str = "runtime.status";
const METHOD_LLM_STATUS: &str = "llm.status";
const METHOD_RUNTIME_CONFIG_GET: &str = "runtime.config.get";
const METHOD_TASK_START: &str = "task.start";
const METHOD_TASK_GET: &str = "task.get";
const METHOD_TASK_RUN: &str = "task.run";
const METHOD_TASK_INSPECT: &str = "task.inspect";
const METHOD_TASK_LIST: &str = "task.list";
const METHOD_MODE_LIST: &str = "mode.list";
const METHOD_MODE_GET: &str = "mode.get";
const METHOD_PERMISSION_CHECK: &str = "permission.check";
const METHOD_TOOL_LIST: &str = "tool.list";
const METHOD_TOOL_PLAN: &str = "tool.plan";
const METHOD_TOOL_INTENT_PARSE: &str = "tool.intent.parse";
const METHOD_TOOL_EXECUTE: &str = "tool.execute";
const METHOD_RUN_EVENTS: &str = "run.events";
const METHOD_RUN_INSPECT: &str = "run.inspect";

pub fn runtime_status() -> RuntimeStatus {
    RuntimeStatus {
        name: "brownie-runtime".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        status: RuntimeState::Ready,
    }
}

pub fn handle_jsonrpc_input_line(line: &str) -> Option<String> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }

    let response = match serde_json::from_str::<JsonRpcRequest>(trimmed) {
        Ok(request) => handle_jsonrpc_request(request),
        Err(error) => parse_error_response(error),
    };

    Some(serde_json::to_string(&response).expect("JSON-RPC response should serialize"))
}

pub fn handle_jsonrpc_request(request: JsonRpcRequest) -> JsonRpcResponse<Value> {
    if request.jsonrpc != JSONRPC_VERSION {
        return error_response(request.id, -32600, "invalid JSON-RPC version");
    }

    match request.method.as_str() {
        METHOD_RUNTIME_STATUS => result_response(request.id, json!(runtime_status())),
        METHOD_LLM_STATUS => handle_llm_status(request.id),
        METHOD_RUNTIME_CONFIG_GET => handle_runtime_config_get(request.id),
        METHOD_TASK_START => handle_task_start(request.id, request.params),
        METHOD_TASK_GET => handle_task_get(request.id, request.params),
        METHOD_TASK_RUN => handle_task_run(request.id, request.params),
        METHOD_TASK_INSPECT => handle_task_inspect(request.id, request.params),
        METHOD_TASK_LIST => handle_task_list(request.id),
        METHOD_MODE_LIST => handle_mode_list(request.id),
        METHOD_MODE_GET => handle_mode_get(request.id, request.params),
        METHOD_PERMISSION_CHECK => handle_permission_check(request.id, request.params),
        METHOD_TOOL_LIST => handle_tool_list(request.id),
        METHOD_TOOL_PLAN => handle_tool_plan(request.id, request.params),
        METHOD_TOOL_INTENT_PARSE => handle_tool_intent_parse(request.id, request.params),
        METHOD_TOOL_EXECUTE => handle_tool_execute(request.id, request.params),
        METHOD_RUN_EVENTS => handle_run_events(request.id, request.params),
        METHOD_RUN_INSPECT => handle_run_inspect(request.id, request.params),
        _ => error_response(request.id, -32601, "method not found"),
    }
}

#[derive(Debug, Clone)]
pub struct RuntimeLlmProviderStatus {
    status: LlmProviderStatus,
    strict: bool,
    will_fallback_to_fake: bool,
    config_source: RuntimeConfigSource,
    active_profile: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuntimeConfigSource {
    Env,
    WorkspaceConfig,
    Default,
}

impl RuntimeConfigSource {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Env => "Env",
            Self::WorkspaceConfig => "WorkspaceConfig",
            Self::Default => "Default",
        }
    }
}

#[derive(Debug, Clone)]
pub struct RuntimeLlmProviderError {
    status: RuntimeLlmProviderStatus,
    message: String,
}

fn llm_status_result(selection: RuntimeLlmProviderStatus) -> LlmStatusResult {
    LlmStatusResult {
        provider: provider_kind_name(&selection.status.provider).to_string(),
        enabled: selection.status.enabled,
        model: selection.status.model,
        base_url: selection.status.base_url,
        reason: selection.status.reason,
        strict: selection.strict,
        will_fallback_to_fake: selection.will_fallback_to_fake,
        config_source: selection.config_source.as_str().to_string(),
        active_profile: selection.active_profile,
    }
}

fn provider_kind_name(kind: &LlmProviderKind) -> &'static str {
    match kind {
        LlmProviderKind::Fake => "Fake",
        LlmProviderKind::OpenAiCompatible => "OpenAiCompatible",
    }
}

pub fn llm_provider_status_from_workspace(
    workspace_root: &std::path::Path,
) -> Result<RuntimeLlmProviderStatus, String> {
    if std::env::var("BROWNIE_LLM_PROVIDER")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .is_some()
    {
        return Ok(llm_provider_status_from_env());
    }
    let config =
        RuntimeConfigLoader::load_from_workspace(workspace_root).map_err(|e| e.to_string())?;
    if let Some(config) = config {
        return status_from_config(&config);
    }
    Ok(default_fake_status())
}

pub fn llm_provider_status_from_env() -> RuntimeLlmProviderStatus {
    let strict = matches!(
        std::env::var("BROWNIE_LLM_STRICT").ok().as_deref(),
        Some("true")
    );
    match std::env::var("BROWNIE_LLM_PROVIDER").ok().as_deref() {
        Some("openai-compatible") => match OpenAiCompatibleLlmProvider::from_env() {
            OpenAiCompatibleConfigFromEnv::Enabled(config) => RuntimeLlmProviderStatus {
                status: LlmProviderStatus {
                    provider: LlmProviderKind::OpenAiCompatible,
                    enabled: true,
                    model: config.model,
                    base_url: Some(redact_secret(&config.base_url)),
                    reason: None,
                },
                strict,
                will_fallback_to_fake: false,
                config_source: RuntimeConfigSource::Env,
                active_profile: None,
            },
            OpenAiCompatibleConfigFromEnv::Disabled(status) => RuntimeLlmProviderStatus {
                status,
                strict,
                will_fallback_to_fake: !strict,
                config_source: RuntimeConfigSource::Env,
                active_profile: None,
            },
        },
        Some("fake") | _ => RuntimeLlmProviderStatus {
            config_source: RuntimeConfigSource::Env,
            ..fake_status_with_profile(None, false)
        },
    }
}

fn default_fake_status() -> RuntimeLlmProviderStatus {
    RuntimeLlmProviderStatus {
        config_source: RuntimeConfigSource::Default,
        ..fake_status_with_profile(None, false)
    }
}

fn fake_status_with_profile(
    active_profile: Option<String>,
    strict: bool,
) -> RuntimeLlmProviderStatus {
    RuntimeLlmProviderStatus {
        status: FakeLlmProvider.status(),
        strict,
        will_fallback_to_fake: false,
        config_source: RuntimeConfigSource::WorkspaceConfig,
        active_profile,
    }
}

fn status_from_config(config: &BrownieConfig) -> Result<RuntimeLlmProviderStatus, String> {
    let profile_name = config.active_profile.clone().ok_or_else(|| {
        "runtime config active_profile is required when config exists".to_string()
    })?;
    let profile = config
        .llm
        .as_ref()
        .and_then(|l| l.profiles.get(&profile_name))
        .ok_or_else(|| "active_profile references unknown profile".to_string())?;
    Ok(match profile {
        LlmProfile::Fake { model } => {
            let mut s = fake_status_with_profile(Some(profile_name), false);
            if let Some(model) = model {
                s.status.model = model.clone();
            }
            s
        }
        LlmProfile::OpenAiCompatible {
            base_url,
            model,
            api_key_env,
            strict,
        } => {
            let api_key_env = api_key_env
                .clone()
                .unwrap_or_else(|| "BROWNIE_LLM_API_KEY".to_string());
            let strict = strict.unwrap_or(false);
            let api_key_present = std::env::var(&api_key_env)
                .ok()
                .filter(|v| !v.trim().is_empty())
                .is_some();
            let enabled = api_key_present;
            RuntimeLlmProviderStatus {
                status: LlmProviderStatus {
                    provider: LlmProviderKind::OpenAiCompatible,
                    enabled,
                    model: model.clone(),
                    base_url: Some(redact_secret(base_url)),
                    reason: if enabled {
                        None
                    } else {
                        Some(format!("missing config: {api_key_env}"))
                    },
                },
                strict,
                will_fallback_to_fake: !strict && !enabled,
                config_source: RuntimeConfigSource::WorkspaceConfig,
                active_profile: Some(profile_name),
            }
        }
    })
}

pub fn llm_provider_from_workspace_for_task_run(
    workspace_root: &std::path::Path,
) -> Result<Box<dyn LlmProvider>, RuntimeLlmProviderError> {
    if std::env::var("BROWNIE_LLM_PROVIDER")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .is_some()
    {
        return llm_provider_from_env_for_task_run();
    }
    let config = RuntimeConfigLoader::load_from_workspace(workspace_root).map_err(|e| {
        RuntimeLlmProviderError {
            status: default_fake_status(),
            message: e.to_string(),
        }
    })?;
    let Some(config) = config else {
        return Ok(Box::new(FakeLlmProvider));
    };
    let selection = status_from_config(&config).map_err(|e| RuntimeLlmProviderError {
        status: default_fake_status(),
        message: e,
    })?;
    if selection.status.provider == LlmProviderKind::Fake {
        return Ok(Box::new(FakeLlmProvider));
    }
    if !selection.status.enabled {
        if selection.strict {
            return Err(RuntimeLlmProviderError {
                message: selection
                    .status
                    .reason
                    .clone()
                    .unwrap_or_else(|| "LLM provider disabled".to_string()),
                status: selection,
            });
        }
        return Ok(Box::new(FakeLlmProvider));
    }
    let profile_name = selection.active_profile.clone().unwrap_or_default();
    let profile = config
        .llm
        .as_ref()
        .and_then(|l| l.profiles.get(&profile_name))
        .expect("validated profile");
    if let LlmProfile::OpenAiCompatible {
        base_url,
        model,
        api_key_env,
        ..
    } = profile
    {
        let api_key_env = api_key_env
            .clone()
            .unwrap_or_else(|| "BROWNIE_LLM_API_KEY".to_string());
        let api_key = std::env::var(&api_key_env).unwrap_or_default();
        Ok(Box::new(OpenAiCompatibleLlmProvider::new(
            OpenAiCompatibleConfig {
                base_url: base_url.clone(),
                model: model.clone(),
                api_key_env,
            },
            api_key,
        )))
    } else {
        Ok(Box::new(FakeLlmProvider))
    }
}

pub fn llm_provider_from_env_for_task_run() -> Result<Box<dyn LlmProvider>, RuntimeLlmProviderError>
{
    match std::env::var("BROWNIE_LLM_PROVIDER").ok().as_deref() {
        Some("openai-compatible") => match OpenAiCompatibleLlmProvider::from_env() {
            OpenAiCompatibleConfigFromEnv::Enabled(config) => {
                let api_key = std::env::var(&config.api_key_env).unwrap_or_default();
                Ok(Box::new(OpenAiCompatibleLlmProvider::new(config, api_key)))
            }
            OpenAiCompatibleConfigFromEnv::Disabled(status) => {
                let selection = llm_provider_status_from_env();
                if selection.strict {
                    Err(RuntimeLlmProviderError {
                        message: status
                            .reason
                            .clone()
                            .unwrap_or_else(|| "LLM provider disabled".to_string()),
                        status: selection,
                    })
                } else {
                    Ok(Box::new(FakeLlmProvider))
                }
            }
        },
        _ => Ok(Box::new(FakeLlmProvider)),
    }
}

fn handle_llm_status(id: Value) -> JsonRpcResponse<Value> {
    let store = match BrownieStore::from_env_or_cwd() {
        Ok(store) => store,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    match llm_provider_status_from_workspace(store.workspace_root()) {
        Ok(status) => result_response(id, json!(llm_status_result(status))),
        Err(error) => error_response(
            id,
            -32603,
            &format!("internal error: {}", redact_secret(&error)),
        ),
    }
}

fn handle_runtime_config_get(id: Value) -> JsonRpcResponse<Value> {
    let store = match BrownieStore::from_env_or_cwd() {
        Ok(store) => store,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    let status = match llm_provider_status_from_workspace(store.workspace_root()) {
        Ok(status) => status,
        Err(error) => {
            return error_response(
                id,
                -32603,
                &format!("internal error: {}", redact_secret(&error)),
            )
        }
    };
    let result = RuntimeConfigGetResult {
        config_source: status.config_source.as_str().to_string(),
        config_path: if status.config_source == RuntimeConfigSource::WorkspaceConfig {
            Some(CONFIG_RELATIVE_PATH.to_string())
        } else {
            None
        },
        active_profile: status.active_profile.clone(),
        llm_status: llm_status_result(status),
    };
    result_response(id, json!(result))
}

fn handle_task_start(id: Value, params: Option<Value>) -> JsonRpcResponse<Value> {
    let params: TaskStartParams = match parse_params(params) {
        Ok(params) => params,
        Err(message) => return error_response(id, -32602, &message),
    };

    if params.goal.trim().is_empty() {
        return error_response(id, -32602, "invalid params: goal must not be empty");
    }

    let policy = match resolve_task_start_policy(params.mode_id.as_deref()) {
        Ok(policy) => policy,
        Err(message) => return error_response(id, -32602, &message),
    };
    let params = TaskStartParams {
        goal: params.goal,
        mode_id: Some(policy.mode_id.clone()),
    };

    let store = match BrownieStore::from_env_or_cwd() {
        Ok(store) => store,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };

    match store.tasks().start_task(params) {
        Ok(record) => {
            if let Err(error) = store.tasks().append_task_event_with_payload(
                &record,
                LedgerEventKind::ModeResolved,
                Some(mode_resolved_payload(&policy)),
            ) {
                return error_response(id, -32603, &format!("internal error: {error}"));
            }
            result_response(
                id,
                json!(TaskStartResult {
                    task_id: record.task_id,
                    run_id: record.run_id,
                    status: record.status,
                }),
            )
        }
        Err(error) => error_response(id, -32603, &format!("internal error: {error}")),
    }
}

fn handle_task_get(id: Value, params: Option<Value>) -> JsonRpcResponse<Value> {
    let params: TaskGetParams = match parse_params(params) {
        Ok(params) => params,
        Err(message) => return error_response(id, -32602, &message),
    };

    let store = match BrownieStore::from_env_or_cwd() {
        Ok(store) => store,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };

    match store.tasks().get_task(&params.task_id) {
        Ok(Some(record)) => result_response(id, json!(record)),
        Ok(None) => error_response(id, -32602, "invalid params: task not found"),
        Err(error) => error_response(id, -32603, &format!("internal error: {error}")),
    }
}

fn handle_task_run(id: Value, params: Option<Value>) -> JsonRpcResponse<Value> {
    let params: TaskRunParams = match parse_params(params) {
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

    if record.status != TaskStatus::Created {
        return error_response(id, -32602, "invalid params: task must be Created");
    }

    let running = match store.tasks().update_task_status(
        &record.task_id,
        TaskStatus::Running,
        LedgerEventKind::TaskRunning,
    ) {
        Ok(record) => record,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };

    let policy = match resolve_policy_for_task_run(&running, &store) {
        Ok(policy) => policy,
        Err(message) => return error_response(id, -32603, &format!("internal error: {message}")),
    };

    if let Err(error) = append_permission_checks(&store, &running, &policy) {
        return error_response(id, -32603, &format!("internal error: {error}"));
    }
    if let Err(error) = append_tool_plan_events(&store, &running, &policy) {
        return error_response(id, -32603, &format!("internal error: {error}"));
    }

    let ledger_events = match store.tasks().read_ledger_events(&running.run_id) {
        Ok(events) => events,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    let prompt_input = ContextMaterializer::materialize(ContextMaterializerInput {
        task: running.clone(),
        ledger_events,
    });
    let provider = match llm_provider_from_workspace_for_task_run(store.workspace_root()) {
        Ok(provider) => provider,
        Err(error) => {
            return fail_llm_request(
                &store,
                &running,
                id,
                error.status,
                &error.message,
                LedgerEventKind::LlmRequestFailed,
            );
        }
    };
    let provider_status = provider.status();
    let provider_selection = match llm_provider_status_from_workspace(store.workspace_root()) {
        Ok(s) => s,
        Err(error) => {
            return error_response(
                id,
                -32603,
                &format!("internal error: {}", redact_secret(&error)),
            )
        }
    };
    let provider_strict = provider_selection.strict;
    let result = match AgentLoop::run_with_llm(prompt_input, provider.as_ref()) {
        Ok(result) => result,
        Err(error) => {
            return fail_llm_request(
                &store,
                &running,
                id,
                RuntimeLlmProviderStatus {
                    status: provider_status.clone(),
                    strict: provider_strict,
                    will_fallback_to_fake: false,
                    config_source: provider_selection.config_source.clone(),
                    active_profile: provider_selection.active_profile.clone(),
                },
                &error.to_string(),
                LedgerEventKind::LlmRequestFailed,
            );
        }
    };

    if let Err(error) = store.tasks().append_task_event_with_payload(
        &running,
        LedgerEventKind::PromptBuilt,
        Some(json!({
            "message_count": result.prompt.messages.len(),
            "prompt_preview": preview_prompt(&result.prompt),
        })),
    ) {
        return error_response(id, -32603, &format!("internal error: {error}"));
    }
    if let Err(error) = store.tasks().append_task_event_with_payload(
        &running,
        LedgerEventKind::LlmRequestCreated,
        Some(json!({
            "provider": provider_kind_name(&provider_status.provider),
            "model": result.llm_request.model.clone(),
            "message_count": result.llm_request.messages.len(),
            "base_url": provider_status.base_url.as_deref().map(redact_secret),
            "strict": provider_strict,
        })),
    ) {
        return error_response(id, -32603, &format!("internal error: {error}"));
    }
    if let Err(error) =
        append_tool_intent_events(&store, &running, &policy, &result.llm_response.content)
    {
        return error_response(id, -32603, &format!("internal error: {error}"));
    }
    if let Err(error) = execute_approved_workspace_read_intents(
        &store,
        &running,
        &policy,
        &result.llm_response.content,
    ) {
        return error_response(id, -32603, &format!("internal error: {error}"));
    }

    if let Err(error) = store.tasks().append_task_event_with_payload(
        &running,
        LedgerEventKind::LlmResponseReceived,
        Some(json!({
            "provider": provider_kind_name(&provider_status.provider),
            "content_preview": preview(&result.llm_response.content),
        })),
    ) {
        return error_response(id, -32603, &format!("internal error: {error}"));
    }

    let second_pass_events = match store.tasks().read_ledger_events(&running.run_id) {
        Ok(events) => events,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    if second_pass_events
        .iter()
        .any(|event| event.kind == LedgerEventKind::ToolExecutionCompleted)
    {
        let second_pass_prompt_input = ContextMaterializer::materialize(ContextMaterializerInput {
            task: running.clone(),
            ledger_events: second_pass_events,
        });
        let second_pass = match AgentLoop::run_second_pass_with_llm(
            second_pass_prompt_input,
            provider.as_ref(),
        ) {
            Ok(result) => result,
            Err(error) => {
                return fail_llm_request(
                    &store,
                    &running,
                    id,
                    RuntimeLlmProviderStatus {
                        status: provider_status.clone(),
                        strict: provider_strict,
                        will_fallback_to_fake: false,
                        config_source: provider_selection.config_source.clone(),
                        active_profile: provider_selection.active_profile.clone(),
                    },
                    &error.to_string(),
                    LedgerEventKind::SecondPassLlmRequestFailed,
                );
            }
        };
        if let Err(error) = store.tasks().append_task_event_with_payload(
            &running,
            LedgerEventKind::SecondPassPromptBuilt,
            Some(json!({
                "message_count": second_pass.prompt.messages.len(),
                "prompt_preview": preview_prompt(&second_pass.prompt),
            })),
        ) {
            return error_response(id, -32603, &format!("internal error: {error}"));
        }
        if let Err(error) = store.tasks().append_task_event_with_payload(
            &running,
            LedgerEventKind::SecondPassLlmRequestCreated,
            Some(json!({
                "provider": provider_kind_name(&provider_status.provider),
                "model": second_pass.llm_request.model.clone(),
                "message_count": second_pass.llm_request.messages.len(),
                "base_url": provider_status.base_url.as_deref().map(redact_secret),
                "strict": provider_strict,
            })),
        ) {
            return error_response(id, -32603, &format!("internal error: {error}"));
        }
        if let Err(error) = store.tasks().append_task_event_with_payload(
            &running,
            LedgerEventKind::SecondPassLlmResponseReceived,
            Some(json!({
                "provider": provider_kind_name(&provider_status.provider),
                "content_preview": preview(&second_pass.llm_response.content),
            })),
        ) {
            return error_response(id, -32603, &format!("internal error: {error}"));
        }
    }

    let final_status = match result.final_state {
        AgentLoopState::Completed => TaskStatus::Completed,
        AgentLoopState::Cancelled => TaskStatus::Cancelled,
        AgentLoopState::Failed => TaskStatus::Failed,
        _ => TaskStatus::Failed,
    };
    let event_kind = match final_status {
        TaskStatus::Completed => LedgerEventKind::TaskCompleted,
        TaskStatus::Cancelled => LedgerEventKind::TaskCancelled,
        TaskStatus::Failed => LedgerEventKind::TaskFailed,
        TaskStatus::Created | TaskStatus::Running => LedgerEventKind::TaskFailed,
    };

    match store
        .tasks()
        .update_task_status(&running.task_id, final_status, event_kind)
    {
        Ok(record) => result_response(
            id,
            json!(TaskRunResult {
                task_id: record.task_id,
                run_id: record.run_id,
                status: record.status,
            }),
        ),
        Err(error) => error_response(id, -32603, &format!("internal error: {error}")),
    }
}

fn fail_llm_request(
    store: &BrownieStore,
    running: &brownie_protocol::TaskRecord,
    id: Value,
    selection: RuntimeLlmProviderStatus,
    reason: &str,
    kind: LedgerEventKind,
) -> JsonRpcResponse<Value> {
    let reason = redact_secret(reason);
    let _ = store.tasks().append_task_event_with_payload(
        running,
        kind,
        Some(json!({
            "provider": provider_kind_name(&selection.status.provider),
            "model": selection.status.model,
            "reason": reason,
            "base_url": selection.status.base_url.as_deref().map(redact_secret),
            "strict": selection.strict,
        })),
    );
    let _ = store.tasks().update_task_status(
        &running.task_id,
        TaskStatus::Failed,
        LedgerEventKind::TaskFailed,
    );
    error_response(
        id,
        -32603,
        &format!("internal error: LLM request failed: {}", reason),
    )
}

fn handle_run_events(id: Value, params: Option<Value>) -> JsonRpcResponse<Value> {
    let params: RunEventsParams = match parse_params(params) {
        Ok(params) => params,
        Err(message) => return error_response(id, -32602, &message),
    };
    if params.run_id.trim().is_empty() {
        return error_response(id, -32602, "invalid params: run_id must not be empty");
    }
    let store = match BrownieStore::from_env_or_cwd() {
        Ok(store) => store,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    let events = match read_existing_run_events(&store, &params.run_id) {
        Ok(events) => events,
        Err(message) => return error_response(id, -32602, &message),
    };
    result_response(
        id,
        json!(RunEventsResult {
            run_id: params.run_id,
            events: events.into_iter().map(ledger_event_summary).collect(),
        }),
    )
}

fn handle_run_inspect(id: Value, params: Option<Value>) -> JsonRpcResponse<Value> {
    let params: RunInspectParams = match parse_params(params) {
        Ok(params) => params,
        Err(message) => return error_response(id, -32602, &message),
    };
    if params.run_id.trim().is_empty() {
        return error_response(id, -32602, "invalid params: run_id must not be empty");
    }
    let store = match BrownieStore::from_env_or_cwd() {
        Ok(store) => store,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    match inspect_run(&store, &params.run_id) {
        Ok(run) => result_response(id, json!(RunInspectResult { run })),
        Err(message) => error_response(id, -32602, &message),
    }
}

fn handle_task_inspect(id: Value, params: Option<Value>) -> JsonRpcResponse<Value> {
    let params: TaskInspectParams = match parse_params(params) {
        Ok(params) => params,
        Err(message) => return error_response(id, -32602, &message),
    };
    if params.task_id.trim().is_empty() {
        return error_response(id, -32602, "invalid params: task_id must not be empty");
    }
    let store = match BrownieStore::from_env_or_cwd() {
        Ok(store) => store,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    let task = match store.tasks().get_task(&params.task_id) {
        Ok(Some(record)) => record,
        Ok(None) => return error_response(id, -32602, "invalid params: task not found"),
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    match inspect_run(&store, &task.run_id) {
        Ok(run) => result_response(id, json!(TaskInspectResult { task, run })),
        Err(message) => error_response(id, -32602, &message),
    }
}

fn handle_task_list(id: Value) -> JsonRpcResponse<Value> {
    let store = match BrownieStore::from_env_or_cwd() {
        Ok(store) => store,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };

    match store.tasks().list_tasks() {
        Ok(tasks) => result_response(id, json!(TaskListResult { tasks })),
        Err(error) => error_response(id, -32603, &format!("internal error: {error}")),
    }
}

fn handle_tool_list(id: Value) -> JsonRpcResponse<Value> {
    let tools = BuiltinToolRegistry::list()
        .into_iter()
        .map(tool_summary)
        .collect();
    result_response(id, json!(ToolListResult { tools }))
}

fn handle_tool_plan(id: Value, params: Option<Value>) -> JsonRpcResponse<Value> {
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

fn handle_tool_intent_parse(id: Value, params: Option<Value>) -> JsonRpcResponse<Value> {
    let params: ToolIntentParseParams = match parse_params(params) {
        Ok(params) => params,
        Err(message) => return error_response(id, -32602, &message),
    };
    let policy = match BuiltinModeRegistry::get(&params.mode_id) {
        Some(policy) => policy,
        None => return error_response(id, -32602, "invalid params: unknown mode_id"),
    };
    let parsed = ToolIntentParser::parse_assistant_content(&params.assistant_content);
    let evaluation = ToolIntentEvaluator::evaluate(&policy, parsed);
    result_response(
        id,
        json!(ToolIntentParseResult {
            mode_id: policy.mode_id,
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

fn handle_tool_execute(id: Value, params: Option<Value>) -> JsonRpcResponse<Value> {
    let params: ToolExecuteParams = match parse_params(params) {
        Ok(params) => params,
        Err(message) => return error_response(id, -32602, &message),
    };
    let policy = match BuiltinModeRegistry::get(&params.mode_id) {
        Some(policy) => policy,
        None => return error_response(id, -32602, "invalid params: unknown mode_id"),
    };
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
    let decision = RuntimePermissionGate::check(&policy, definition.required_action);
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

    let store = match BrownieStore::from_env_or_cwd() {
        Ok(store) => store,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    match ToolExecutor::execute_read_only(
        store.workspace_root(),
        ToolExecutionRequest {
            tool_id: definition.tool_id,
            input: params.input,
        },
    ) {
        Ok(result) => result_response(id, json!(tool_execute_result(result))),
        Err(error) => error_response(id, -32603, &format!("internal error: {error}")),
    }
}

fn handle_mode_list(id: Value) -> JsonRpcResponse<Value> {
    let modes = BuiltinModeRegistry::list()
        .into_iter()
        .map(mode_summary)
        .collect();
    result_response(id, json!(ModeListResult { modes }))
}

fn handle_permission_check(id: Value, params: Option<Value>) -> JsonRpcResponse<Value> {
    let params: PermissionCheckParams = match parse_params(params) {
        Ok(params) => params,
        Err(message) => return error_response(id, -32602, &message),
    };

    let policy = match BuiltinModeRegistry::get(&params.mode_id) {
        Some(policy) => policy,
        None => return error_response(id, -32602, "invalid params: unknown mode_id"),
    };
    let action = runtime_action_from_name(&params.action);
    let decision = RuntimePermissionGate::check(&policy, action);

    result_response(
        id,
        json!(PermissionCheckResult {
            mode_id: policy.mode_id,
            action: params.action,
            allowed: decision.allowed,
            reason: decision.reason,
        }),
    )
}

fn handle_mode_get(id: Value, params: Option<Value>) -> JsonRpcResponse<Value> {
    let params: ModeGetParams = match parse_params(params) {
        Ok(params) => params,
        Err(message) => return error_response(id, -32602, &message),
    };

    match BuiltinModeRegistry::get(&params.mode_id) {
        Some(policy) => result_response(id, json!(mode_summary(policy))),
        None => error_response(id, -32602, "invalid params: unknown mode_id"),
    }
}

fn read_existing_run_events(
    store: &BrownieStore,
    run_id: &str,
) -> Result<Vec<LedgerEvent>, String> {
    match store.tasks().get_task_by_run_id(run_id) {
        Ok(Some(_)) => {}
        Ok(None) => return Err("invalid params: run not found".to_string()),
        Err(error) => return Err(format!("invalid params: {error}")),
    }
    store
        .tasks()
        .read_ledger_events(run_id)
        .map_err(|error| format!("invalid params: {error}"))
}

fn inspect_run(store: &BrownieStore, run_id: &str) -> Result<RunInspectSummary, String> {
    let events = read_existing_run_events(store, run_id)?;
    let task = store
        .tasks()
        .get_task_by_run_id(run_id)
        .map_err(|error| format!("invalid params: {error}"))?;
    let has_tool_execution_completed = events
        .iter()
        .any(|event| event.kind == LedgerEventKind::ToolExecutionCompleted);
    let has_second_pass = events
        .iter()
        .any(|event| event.kind == LedgerEventKind::SecondPassLlmResponseReceived);
    let final_response_preview =
        latest_content_preview(&events, LedgerEventKind::SecondPassLlmResponseReceived)
            .or_else(|| latest_content_preview(&events, LedgerEventKind::LlmResponseReceived));
    Ok(RunInspectSummary {
        run_id: run_id.to_string(),
        task_id: task.as_ref().map(|task| task.task_id.clone()),
        status: task.as_ref().map(|task| task.status.clone()),
        event_count: events.len(),
        has_tool_execution_completed,
        has_second_pass,
        final_response_preview,
        timeline: events.iter().map(timeline_entry).collect(),
    })
}

fn latest_content_preview(events: &[LedgerEvent], kind: LedgerEventKind) -> Option<String> {
    events
        .iter()
        .rev()
        .find(|event| event.kind == kind)
        .and_then(|event| {
            event
                .payload
                .as_ref()
                .and_then(|payload| payload.get("content_preview"))
                .and_then(Value::as_str)
                .map(ToString::to_string)
        })
}

fn ledger_event_summary(event: LedgerEvent) -> LedgerEventSummary {
    let kind = format!("{:?}", event.kind);
    LedgerEventSummary {
        event_id: event.event_id,
        task_id: event.task_id,
        run_id: event.run_id,
        kind,
        timestamp: event.timestamp,
        payload: sanitize_ledger_payload(event.payload),
    }
}

fn sanitize_ledger_payload(payload: Option<Value>) -> Option<Value> {
    let Value::Object(map) = payload? else {
        return None;
    };
    const ALLOWED_KEYS: &[&str] = &[
        "tool_id",
        "status",
        "reason",
        "output_preview",
        "prompt_preview",
        "content_preview",
        "bytes_read",
        "truncated",
        "provider",
        "model",
        "message_count",
        "base_url",
        "strict",
        "mode_id",
        "display_name",
        "permissions",
        "required_action",
        "allowed",
        "request_reason",
        "tool_ids",
    ];
    let sanitized = map
        .into_iter()
        .filter(|(key, _)| ALLOWED_KEYS.contains(&key.as_str()))
        .collect::<serde_json::Map<_, _>>();
    if sanitized.is_empty() {
        None
    } else {
        Some(Value::Object(sanitized))
    }
}

fn timeline_entry(event: &LedgerEvent) -> String {
    let mut parts = vec![format!("{:?}", event.kind)];
    if let Some(Value::Object(payload)) = sanitize_ledger_payload(event.payload.clone()) {
        for key in [
            "tool_id",
            "status",
            "bytes_read",
            "truncated",
            "reason",
            "provider",
            "model",
            "message_count",
        ] {
            if let Some(value) = payload.get(key) {
                let value = value
                    .as_str()
                    .map(ToString::to_string)
                    .unwrap_or_else(|| value.to_string());
                parts.push(format!("{key}={value}"));
            }
        }
    }
    parts.join(" ")
}

fn resolve_task_start_policy(mode_id: Option<&str>) -> Result<CompiledModePolicy, String> {
    match mode_id {
        Some(mode_id) if !mode_id.trim().is_empty() => BuiltinModeRegistry::get(mode_id)
            .ok_or_else(|| "invalid params: unknown mode_id".to_string()),
        _ => Ok(BuiltinModeRegistry::default_policy()),
    }
}

fn mode_summary(policy: CompiledModePolicy) -> ModeSummary {
    ModeSummary {
        mode_id: policy.mode_id,
        display_name: policy.display_name,
        role_definition: policy.role_definition,
        permissions: ModePermissionsSummary {
            read_only: policy.permissions.read_only,
            workspace_write: policy.permissions.workspace_write,
            process_exec: policy.permissions.process_exec,
            network_access: policy.permissions.network_access,
            service_control: policy.permissions.service_control,
            destructive: policy.permissions.destructive,
            can_spawn_subtasks: policy.permissions.can_spawn_subtasks,
        },
    }
}

fn mode_resolved_payload(policy: &CompiledModePolicy) -> Value {
    json!({
        "mode_id": policy.mode_id,
        "display_name": policy.display_name,
        "permissions": {
            "read_only": policy.permissions.read_only,
            "workspace_write": policy.permissions.workspace_write,
            "process_exec": policy.permissions.process_exec,
            "network_access": policy.permissions.network_access,
            "service_control": policy.permissions.service_control,
            "destructive": policy.permissions.destructive,
            "can_spawn_subtasks": policy.permissions.can_spawn_subtasks,
        }
    })
}

fn resolve_policy_for_task_run(
    record: &brownie_protocol::TaskRecord,
    store: &BrownieStore,
) -> Result<CompiledModePolicy, String> {
    if let Some(mode_id) = record.mode_id.as_deref() {
        return BuiltinModeRegistry::get(mode_id)
            .ok_or_else(|| format!("stored task has unknown mode_id: {mode_id}"));
    }

    let events = store
        .tasks()
        .read_ledger_events(&record.run_id)
        .map_err(|error| error.to_string())?;
    let mode_id = events
        .iter()
        .rev()
        .find(|event| event.kind == LedgerEventKind::ModeResolved)
        .and_then(|event| event.payload.as_ref())
        .and_then(|payload| payload.get("mode_id"))
        .and_then(|value| value.as_str())
        .unwrap_or(DEFAULT_MODE_ID_FOR_RUN);
    BuiltinModeRegistry::get(mode_id)
        .ok_or_else(|| format!("ledger has unknown mode_id: {mode_id}"))
}

fn tool_summary(tool: brownie_tools::ToolDefinition) -> ToolSummary {
    ToolSummary {
        tool_id: tool.tool_id,
        display_name: tool.display_name,
        description: tool.description,
        required_action: runtime_action_name(&tool.required_action),
    }
}

fn build_tool_plan_result(
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

fn tool_plan_decision_summary(decision: ToolPlanDecision) -> ToolPlanDecisionSummary {
    ToolPlanDecisionSummary {
        tool_id: decision.tool_id,
        required_action: runtime_action_name(&decision.required_action),
        allowed: decision.allowed,
        reason: decision.reason,
    }
}

fn tool_intent_decision_summary(decision: ToolIntentDecision) -> ToolIntentDecisionSummary {
    ToolIntentDecisionSummary {
        tool_id: decision.tool_id,
        required_action: runtime_action_name(&decision.required_action),
        allowed: decision.allowed,
        reason: decision.reason,
        request_reason: decision.request_reason,
        input: decision.input,
    }
}

fn tool_intent_rejected_summary(rejected: RejectedToolIntent) -> ToolIntentRejectedSummary {
    ToolIntentRejectedSummary {
        tool_id: rejected.tool_id,
        reason: rejected.reason,
    }
}

fn tool_execute_result(result: brownie_tools::ToolExecutionResult) -> ToolExecuteResult {
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

fn append_tool_intent_events(
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
        })),
    )?;
    let evaluation = ToolIntentEvaluator::evaluate(policy, parsed);
    for rejected in evaluation.rejected {
        store.tasks().append_task_event_with_payload(
            record,
            LedgerEventKind::ToolIntentRejected,
            Some(json!({ "tool_id": rejected.tool_id, "reason": rejected.reason })),
        )?;
    }
    for decision in evaluation.items {
        let payload = json!({
            "tool_id": decision.tool_id,
            "required_action": runtime_action_name(&decision.required_action),
            "allowed": decision.allowed,
            "reason": decision.reason,
            "request_reason": decision.request_reason,
            "input": decision.input,
        });
        store.tasks().append_task_event_with_payload(
            record,
            LedgerEventKind::ToolIntentPermissionChecked,
            Some(payload.clone()),
        )?;
        store.tasks().append_task_event_with_payload(
            record,
            if decision.allowed {
                LedgerEventKind::ToolIntentApproved
            } else {
                LedgerEventKind::ToolIntentDenied
            },
            Some(payload),
        )?;
    }
    Ok(())
}

fn execute_approved_workspace_read_intents(
    store: &BrownieStore,
    record: &brownie_protocol::TaskRecord,
    policy: &CompiledModePolicy,
    assistant_content: &str,
) -> anyhow::Result<()> {
    let evaluation = ToolIntentEvaluator::evaluate(
        policy,
        ToolIntentParser::parse_assistant_content(assistant_content),
    );
    for decision in evaluation.items {
        if !decision.allowed || decision.tool_id != WORKSPACE_READ_TOOL_ID {
            continue;
        }
        store.tasks().append_task_event_with_payload(
            record,
            LedgerEventKind::ToolExecutionRequested,
            Some(json!({ "tool_id": decision.tool_id, "input": decision.input })),
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
        let result = ToolExecutor::execute_read_only(
            store.workspace_root(),
            ToolExecutionRequest {
                tool_id: decision.tool_id,
                input: decision.input,
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

fn tool_execution_ledger_payload(result: &brownie_tools::ToolExecutionResult) -> Value {
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
    if let Some(reason) = result.output.get("reason") {
        payload.insert("reason".to_string(), reason.clone());
    }
    Value::Object(payload)
}

fn append_tool_plan_events(
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

const DEFAULT_MODE_ID_FOR_RUN: &str = "orchestrator";

fn append_permission_checks(
    store: &BrownieStore,
    record: &brownie_protocol::TaskRecord,
    policy: &CompiledModePolicy,
) -> anyhow::Result<()> {
    for action in [
        RuntimeAction::ReadWorkspace,
        RuntimeAction::SpawnSubtask,
        RuntimeAction::WriteWorkspace,
        RuntimeAction::ExecuteProcess,
    ] {
        let decision = RuntimePermissionGate::check(policy, action);
        debug_assert!(
            decision.allowed || decision.action != RuntimeAction::ReadWorkspace,
            "ReadWorkspace is a required runtime permission and must always be allowed"
        );
        let payload = permission_payload(policy, &decision);
        store.tasks().append_task_event_with_payload(
            record,
            LedgerEventKind::PermissionChecked,
            Some(payload.clone()),
        )?;
        if !decision.allowed {
            store.tasks().append_task_event_with_payload(
                record,
                LedgerEventKind::PermissionDenied,
                Some(payload),
            )?;
        }
    }
    Ok(())
}

fn permission_payload(
    policy: &CompiledModePolicy,
    decision: &brownie_agentmodes::PermissionDecision,
) -> Value {
    json!({
        "mode_id": policy.mode_id,
        "action": runtime_action_name(&decision.action),
        "allowed": decision.allowed,
        "reason": decision.reason,
    })
}

fn runtime_action_from_name(action: &RuntimeActionName) -> RuntimeAction {
    match action {
        RuntimeActionName::ReadWorkspace => RuntimeAction::ReadWorkspace,
        RuntimeActionName::WriteWorkspace => RuntimeAction::WriteWorkspace,
        RuntimeActionName::ExecuteProcess => RuntimeAction::ExecuteProcess,
        RuntimeActionName::AccessNetwork => RuntimeAction::AccessNetwork,
        RuntimeActionName::ControlService => RuntimeAction::ControlService,
        RuntimeActionName::DestructiveOperation => RuntimeAction::DestructiveOperation,
        RuntimeActionName::SpawnSubtask => RuntimeAction::SpawnSubtask,
    }
}

fn runtime_action_name(action: &RuntimeAction) -> RuntimeActionName {
    match action {
        RuntimeAction::ReadWorkspace => RuntimeActionName::ReadWorkspace,
        RuntimeAction::WriteWorkspace => RuntimeActionName::WriteWorkspace,
        RuntimeAction::ExecuteProcess => RuntimeActionName::ExecuteProcess,
        RuntimeAction::AccessNetwork => RuntimeActionName::AccessNetwork,
        RuntimeAction::ControlService => RuntimeActionName::ControlService,
        RuntimeAction::DestructiveOperation => RuntimeActionName::DestructiveOperation,
        RuntimeAction::SpawnSubtask => RuntimeActionName::SpawnSubtask,
    }
}

fn preview_prompt(prompt: &brownie_context::PromptView) -> String {
    let joined = prompt
        .messages
        .iter()
        .map(|message| message.content.as_str())
        .collect::<Vec<_>>()
        .join("\n---\n");
    preview(&joined)
}

fn preview(content: &str) -> String {
    const MAX_PREVIEW_CHARS: usize = 200;
    content.chars().take(MAX_PREVIEW_CHARS).collect()
}

fn preview_tool_output(content: &str) -> String {
    const MAX_TOOL_OUTPUT_PREVIEW_CHARS: usize = 24;
    content
        .chars()
        .take(MAX_TOOL_OUTPUT_PREVIEW_CHARS)
        .collect()
}

fn parse_params<T: serde::de::DeserializeOwned>(params: Option<Value>) -> Result<T, String> {
    let params = params.ok_or_else(|| "invalid params: missing params".to_string())?;
    serde_json::from_value(params).map_err(|error| format!("invalid params: {error}"))
}

fn parse_error_response(error: serde_json::Error) -> JsonRpcResponse<Value> {
    JsonRpcResponse {
        jsonrpc: JSONRPC_VERSION.to_string(),
        id: Value::Null,
        result: None,
        error: Some(JsonRpcError {
            code: -32700,
            message: format!("parse error: {error}"),
        }),
    }
}

fn result_response(id: Value, result: Value) -> JsonRpcResponse<Value> {
    JsonRpcResponse {
        jsonrpc: JSONRPC_VERSION.to_string(),
        id,
        result: Some(result),
        error: None,
    }
}

fn error_response(id: Value, code: i64, message: &str) -> JsonRpcResponse<Value> {
    JsonRpcResponse {
        jsonrpc: JSONRPC_VERSION.to_string(),
        id,
        result: None,
        error: Some(JsonRpcError {
            code,
            message: message.to_string(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use brownie_protocol::{TaskRecord, TaskStatus};
    use std::sync::Mutex;

    pub(super) static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn parse_line(line: &str) -> JsonRpcResponse<Value> {
        serde_json::from_str(&handle_jsonrpc_input_line(line).expect("response line"))
            .expect("valid response")
    }

    #[test]
    fn runtime_status_reports_ready() {
        let status = runtime_status();
        assert_eq!(status.name, "brownie-runtime");
        assert_eq!(status.status, RuntimeState::Ready);
    }

    #[test]
    fn handles_runtime_status_input_line() {
        let response = parse_line(r#"{"jsonrpc":"2.0","id":1,"method":"runtime.status"}"#);
        assert!(response.error.is_none());
        assert_eq!(response.id, Value::from(1));
        assert_eq!(
            response.result.expect("status result")["name"],
            "brownie-runtime"
        );
    }

    #[test]
    fn tool_execute_workspace_read_returns_completed() {
        let _guard = ENV_LOCK.lock().expect("env lock");
        let temp = tempfile::tempdir().expect("tempdir");
        std::fs::write(temp.path().join("README.md"), "hello brownie").expect("write");
        std::env::set_var("BROWNIE_WORKSPACE_ROOT", temp.path());

        let response = parse_line(
            r#"{"jsonrpc":"2.0","id":1,"method":"tool.execute","params":{"mode_id":"orchestrator","tool_id":"workspace.read","input":{"path":"README.md"}}}"#,
        );

        assert!(response.error.is_none());
        let result = response.result.expect("result");
        assert_eq!(result["status"], "Completed");
        assert_eq!(result["output"]["content"], "hello brownie");
        assert_eq!(result["output"]["truncated"], false);
    }

    #[test]
    fn task_run_with_readme_records_second_pass_events() {
        let _guard = ENV_LOCK.lock().expect("env lock");
        let temp = tempfile::tempdir().expect("tempdir");
        std::fs::write(
            temp.path().join("README.md"),
            "# Brownie\n\nWorkspace read smoke content that must not appear in the second-pass response.",
        )
        .expect("write");
        std::env::set_var("BROWNIE_WORKSPACE_ROOT", temp.path());

        let start = parse_line(
            r#"{"jsonrpc":"2.0","id":1,"method":"task.start","params":{"goal":"Inspect README before final response","mode_id":"orchestrator"}}"#,
        );
        let start_result = start.result.expect("start result");
        let task_id = start_result["task_id"]
            .as_str()
            .expect("task id")
            .to_string();
        let run_id = start_result["run_id"].as_str().expect("run id").to_string();

        let run = parse_line(&format!(
            r#"{{"jsonrpc":"2.0","id":2,"method":"task.run","params":{{"task_id":"{task_id}"}}}}"#
        ));
        assert_eq!(run.result.expect("run result")["status"], "Completed");

        let ledger = std::fs::read_to_string(
            temp.path()
                .join(".brownie/runs")
                .join(&run_id)
                .join("ledger.jsonl"),
        )
        .expect("ledger");
        let events: Vec<brownie_store::LedgerEvent> = ledger
            .lines()
            .map(|line| serde_json::from_str(line).expect("event"))
            .collect();
        assert!(events
            .iter()
            .any(|event| event.kind == LedgerEventKind::ToolExecutionCompleted));
        assert!(events
            .iter()
            .any(|event| event.kind == LedgerEventKind::SecondPassPromptBuilt));
        assert!(events
            .iter()
            .any(|event| event.kind == LedgerEventKind::SecondPassLlmRequestCreated));
        let second_response = events
            .iter()
            .find(|event| event.kind == LedgerEventKind::SecondPassLlmResponseReceived)
            .expect("second pass response");
        let preview = second_response
            .payload
            .as_ref()
            .and_then(|payload| payload.get("content_preview"))
            .and_then(Value::as_str)
            .expect("preview");
        assert!(preview.contains("Fake LLM final response"));
        assert!(!preview.contains("Workspace read smoke content"));

        std::env::remove_var("BROWNIE_WORKSPACE_ROOT");
    }

    #[test]
    fn run_inspection_methods_return_sanitized_summaries() {
        let _guard = ENV_LOCK.lock().expect("env lock");
        let temp = tempfile::tempdir().expect("tempdir");
        std::fs::write(
            temp.path().join("README.md"),
            "# Brownie\n\nsecret full content",
        )
        .expect("write");
        std::env::set_var("BROWNIE_WORKSPACE_ROOT", temp.path());

        let start = parse_line(
            r#"{"jsonrpc":"2.0","id":1,"method":"task.start","params":{"goal":"Inspect README before final response","mode_id":"orchestrator"}}"#,
        );
        let start_result = start.result.expect("start result");
        let task_id = start_result["task_id"]
            .as_str()
            .expect("task id")
            .to_string();
        let run_id = start_result["run_id"].as_str().expect("run id").to_string();
        let run = parse_line(&format!(
            r#"{{"jsonrpc":"2.0","id":2,"method":"task.run","params":{{"task_id":"{task_id}"}}}}"#
        ));
        assert!(run.error.is_none());

        let events = parse_line(&format!(
            r#"{{"jsonrpc":"2.0","id":3,"method":"run.events","params":{{"run_id":"{run_id}"}}}}"#
        ));
        assert!(events.error.is_none());
        let events_result = events.result.expect("events result");
        assert_eq!(events_result["run_id"], run_id);
        let serialized = serde_json::to_string(&events_result).expect("serialize");
        assert!(serialized.contains("output_preview"));
        assert!(serialized.contains("bytes_read"));
        assert!(serialized.contains("truncated"));
        assert!(!serialized.contains("secret full content"));
        assert!(!serialized.contains("\"content\""));
        assert!(!serialized.contains("full_content"));
        assert!(!serialized.contains("file_content"));
        assert!(!serialized.contains("raw_output"));

        let inspect = parse_line(&format!(
            r#"{{"jsonrpc":"2.0","id":4,"method":"run.inspect","params":{{"run_id":"{run_id}"}}}}"#
        ));
        let summary = inspect.result.expect("inspect result")["run"].clone();
        assert!(summary["event_count"].as_u64().expect("event_count") > 0);
        assert_eq!(summary["has_tool_execution_completed"], true);
        assert_eq!(summary["has_second_pass"], true);
        assert!(summary["final_response_preview"]
            .as_str()
            .expect("preview")
            .contains("Fake LLM final response"));

        let task_inspect = parse_line(&format!(
            r#"{{"jsonrpc":"2.0","id":5,"method":"task.inspect","params":{{"task_id":"{task_id}"}}}}"#
        ));
        assert_eq!(
            task_inspect.result.expect("task inspect result")["task"]["task_id"],
            task_id
        );

        std::env::remove_var("BROWNIE_WORKSPACE_ROOT");
    }

    #[test]
    fn run_inspect_unknown_run_returns_invalid_params() {
        let _guard = ENV_LOCK.lock().expect("env lock");
        let temp = tempfile::tempdir().expect("tempdir");
        std::env::set_var("BROWNIE_WORKSPACE_ROOT", temp.path());
        let response = parse_line(
            r#"{"jsonrpc":"2.0","id":1,"method":"run.inspect","params":{"run_id":"run_missing"}}"#,
        );
        assert!(response.result.is_none());
        assert_eq!(response.error.expect("error").code, -32602);
        std::env::remove_var("BROWNIE_WORKSPACE_ROOT");
    }

    #[test]
    fn sanitizer_preserves_allowlisted_metadata_only() {
        let sanitized = sanitize_ledger_payload(Some(json!({
            "output_preview": "safe",
            "bytes_read": 42,
            "truncated": false,
            "reason": "ok",
            "content": "secret",
            "full_content": "secret",
            "file_content": "secret",
            "raw_output": "secret"
        })))
        .expect("sanitized");
        assert_eq!(sanitized["output_preview"], "safe");
        assert_eq!(sanitized["bytes_read"], 42);
        assert_eq!(sanitized["truncated"], false);
        assert_eq!(sanitized["reason"], "ok");
        assert!(sanitized.get("content").is_none());
        assert!(sanitized.get("full_content").is_none());
        assert!(sanitized.get("file_content").is_none());
        assert!(sanitized.get("raw_output").is_none());
    }

    #[test]
    fn tool_execute_workspace_read_path_traversal_fails() {
        let _guard = ENV_LOCK.lock().expect("env lock");
        let temp = tempfile::tempdir().expect("tempdir");
        std::env::set_var("BROWNIE_WORKSPACE_ROOT", temp.path());

        let response = parse_line(
            r#"{"jsonrpc":"2.0","id":2,"method":"tool.execute","params":{"mode_id":"orchestrator","tool_id":"workspace.read","input":{"path":"../secret.txt"}}}"#,
        );

        assert!(response.error.is_none());
        assert_eq!(response.result.expect("result")["status"], "Failed");
    }

    #[test]
    fn tool_execute_unknown_mode_returns_invalid_params() {
        let response = parse_line(
            r#"{"jsonrpc":"2.0","id":3,"method":"tool.execute","params":{"mode_id":"unknown","tool_id":"workspace.read","input":{"path":"README.md"}}}"#,
        );

        assert_eq!(response.error.expect("error").code, -32602);
    }

    #[test]
    fn tool_execute_workspace_write_is_denied_without_writing() {
        let _guard = ENV_LOCK.lock().expect("env lock");
        let temp = tempfile::tempdir().expect("tempdir");
        std::env::set_var("BROWNIE_WORKSPACE_ROOT", temp.path());

        let response = parse_line(
            r#"{"jsonrpc":"2.0","id":4,"method":"tool.execute","params":{"mode_id":"implementer","tool_id":"workspace.write","input":{"path":"created.txt","content":"nope"}}}"#,
        );

        assert!(response.error.is_none());
        assert_eq!(response.result.expect("result")["status"], "Denied");
        assert!(!temp.path().join("created.txt").exists());
    }

    #[test]
    fn task_start_get_and_list_through_jsonrpc() {
        let _guard = ENV_LOCK.lock().expect("env lock");
        let temp = tempfile::tempdir().expect("tempdir");
        std::env::set_var("BROWNIE_WORKSPACE_ROOT", temp.path());

        let start = parse_line(
            r#"{"jsonrpc":"2.0","id":1,"method":"task.start","params":{"goal":"Implement something","mode_id":"orchestrator"}}"#,
        );
        assert!(start.error.is_none());
        let result = start.result.expect("start result");
        assert_eq!(result["status"], "Created");
        let task_id = result["task_id"].as_str().expect("task id").to_string();
        let run_id = result["run_id"].as_str().expect("run id").to_string();
        assert!(temp
            .path()
            .join(".brownie/runs")
            .join(&run_id)
            .join("state.json")
            .exists());
        assert!(temp
            .path()
            .join(".brownie/runs")
            .join(&run_id)
            .join("ledger.jsonl")
            .exists());

        let get = parse_line(&format!(
            r#"{{"jsonrpc":"2.0","id":2,"method":"task.get","params":{{"task_id":"{task_id}"}}}}"#
        ));
        let record: TaskRecord =
            serde_json::from_value(get.result.expect("get result")).expect("task record");
        assert_eq!(record.task_id, task_id);
        assert_eq!(record.status, TaskStatus::Created);

        let list = parse_line(r#"{"jsonrpc":"2.0","id":3,"method":"task.list"}"#);
        assert_eq!(
            list.result.expect("list result")["tasks"]
                .as_array()
                .expect("tasks")
                .len(),
            1
        );

        std::env::remove_var("BROWNIE_WORKSPACE_ROOT");
    }

    #[test]
    fn llm_status_returns_fake_when_env_unset() {
        let _guard = ENV_LOCK.lock().expect("env lock");
        std::env::remove_var("BROWNIE_LLM_PROVIDER");
        std::env::remove_var("BROWNIE_LLM_BASE_URL");
        std::env::remove_var("BROWNIE_LLM_MODEL");
        std::env::remove_var("BROWNIE_LLM_API_KEY_ENV");
        std::env::remove_var("BROWNIE_LLM_API_KEY");
        std::env::remove_var("BROWNIE_LLM_STRICT");
        let response =
            handle_jsonrpc_input_line(r#"{"jsonrpc":"2.0","id":1,"method":"llm.status"}"#).unwrap();
        assert!(response.contains(r#""provider":"Fake""#));
        assert!(response.contains(r#""enabled":true"#));
        assert!(response.contains(r#""model":"brownie-fake-llm""#));
        assert!(response.contains(r#""strict":false"#));
        assert!(response.contains(r#""will_fallback_to_fake":false"#));
    }

    #[test]
    fn llm_status_does_not_expose_api_key_for_incomplete_config() {
        let _guard = ENV_LOCK.lock().expect("env lock");
        std::env::set_var("BROWNIE_LLM_PROVIDER", "openai-compatible");
        std::env::remove_var("BROWNIE_LLM_BASE_URL");
        std::env::set_var("BROWNIE_LLM_MODEL", "qwen35");
        std::env::set_var("BROWNIE_LLM_API_KEY_ENV", "BROWNIE_LLM_API_KEY");
        std::env::set_var("BROWNIE_LLM_API_KEY", "super-secret-key");
        let response =
            handle_jsonrpc_input_line(r#"{"jsonrpc":"2.0","id":1,"method":"llm.status"}"#).unwrap();
        assert!(response.contains(r#""provider":"OpenAiCompatible""#));
        assert!(response.contains(r#""enabled":false"#));
        assert!(response.contains("missing config"));
        assert!(!response.contains("super-secret-key"));
        std::env::remove_var("BROWNIE_LLM_PROVIDER");
        std::env::remove_var("BROWNIE_LLM_MODEL");
        std::env::remove_var("BROWNIE_LLM_API_KEY_ENV");
        std::env::remove_var("BROWNIE_LLM_API_KEY");
    }

    #[test]
    fn llm_status_openai_missing_strict_false_reports_fallback() {
        let _guard = ENV_LOCK.lock().expect("env lock");
        std::env::set_var("BROWNIE_LLM_PROVIDER", "openai-compatible");
        std::env::remove_var("BROWNIE_LLM_BASE_URL");
        std::env::remove_var("BROWNIE_LLM_MODEL");
        std::env::remove_var("BROWNIE_LLM_API_KEY_ENV");
        std::env::remove_var("BROWNIE_LLM_API_KEY");
        std::env::remove_var("BROWNIE_LLM_STRICT");

        let response = parse_line(r#"{"jsonrpc":"2.0","id":1,"method":"llm.status"}"#);
        let result = response.result.expect("result");
        assert_eq!(result["provider"], "OpenAiCompatible");
        assert_eq!(result["enabled"], false);
        assert_eq!(result["strict"], false);
        assert_eq!(result["will_fallback_to_fake"], true);
    }

    #[test]
    fn llm_status_openai_missing_strict_true_reports_no_fallback() {
        let _guard = ENV_LOCK.lock().expect("env lock");
        std::env::set_var("BROWNIE_LLM_PROVIDER", "openai-compatible");
        std::env::set_var("BROWNIE_LLM_STRICT", "true");
        std::env::remove_var("BROWNIE_LLM_BASE_URL");
        std::env::remove_var("BROWNIE_LLM_MODEL");
        std::env::remove_var("BROWNIE_LLM_API_KEY_ENV");
        std::env::remove_var("BROWNIE_LLM_API_KEY");

        let response = parse_line(r#"{"jsonrpc":"2.0","id":1,"method":"llm.status"}"#);
        let result = response.result.expect("result");
        assert_eq!(result["provider"], "OpenAiCompatible");
        assert_eq!(result["enabled"], false);
        assert_eq!(result["strict"], true);
        assert_eq!(result["will_fallback_to_fake"], false);
        std::env::remove_var("BROWNIE_LLM_STRICT");
    }

    #[test]
    fn task_run_changes_created_to_completed_through_jsonrpc() {
        let _guard = ENV_LOCK.lock().expect("env lock");
        let temp = tempfile::tempdir().expect("tempdir");
        std::env::set_var("BROWNIE_WORKSPACE_ROOT", temp.path());

        let start = parse_line(
            r#"{"jsonrpc":"2.0","id":1,"method":"task.start","params":{"goal":"Run no-op","mode_id":"orchestrator"}}"#,
        );
        let start_result = start.result.expect("start result");
        let task_id = start_result["task_id"]
            .as_str()
            .expect("task id")
            .to_string();
        let run_id = start_result["run_id"].as_str().expect("run id").to_string();

        let run = parse_line(&format!(
            r#"{{"jsonrpc":"2.0","id":2,"method":"task.run","params":{{"task_id":"{task_id}"}}}}"#
        ));
        assert!(run.error.is_none());
        let result = run.result.expect("run result");
        assert_eq!(result["task_id"], task_id);
        assert_eq!(result["run_id"], run_id);
        assert_eq!(result["status"], "Completed");

        let get = parse_line(&format!(
            r#"{{"jsonrpc":"2.0","id":3,"method":"task.get","params":{{"task_id":"{task_id}"}}}}"#
        ));
        let record: TaskRecord =
            serde_json::from_value(get.result.expect("get result")).expect("task record");
        assert_eq!(record.status, TaskStatus::Completed);

        let state: TaskRecord = serde_json::from_str(
            &std::fs::read_to_string(
                temp.path()
                    .join(".brownie/runs")
                    .join(&run_id)
                    .join("state.json"),
            )
            .expect("state"),
        )
        .expect("state record");
        assert_eq!(state.status, TaskStatus::Completed);

        let ledger = std::fs::read_to_string(
            temp.path()
                .join(".brownie/runs")
                .join(&run_id)
                .join("ledger.jsonl"),
        )
        .expect("ledger");
        assert!(ledger.contains("TaskStarted"));
        assert!(ledger.contains("TaskRunning"));
        assert!(ledger.contains("PromptBuilt"));
        assert!(ledger.contains("LlmRequestCreated"));
        assert!(ledger.contains("LlmResponseReceived"));
        assert!(ledger.contains("TaskCompleted"));
        let events: Vec<LedgerEventKind> = ledger
            .lines()
            .map(|line| {
                serde_json::from_str::<brownie_store::LedgerEvent>(line)
                    .expect("event")
                    .kind
            })
            .collect();
        assert_eq!(
            events,
            vec![
                LedgerEventKind::TaskStarted,
                LedgerEventKind::ModeResolved,
                LedgerEventKind::TaskRunning,
                LedgerEventKind::PermissionChecked,
                LedgerEventKind::PermissionChecked,
                LedgerEventKind::PermissionChecked,
                LedgerEventKind::PermissionDenied,
                LedgerEventKind::PermissionChecked,
                LedgerEventKind::PermissionDenied,
                LedgerEventKind::ToolPlanned,
                LedgerEventKind::ToolPermissionChecked,
                LedgerEventKind::ToolPlanApproved,
                LedgerEventKind::ToolPermissionChecked,
                LedgerEventKind::ToolPlanDenied,
                LedgerEventKind::ToolPermissionChecked,
                LedgerEventKind::ToolPlanApproved,
                LedgerEventKind::PromptBuilt,
                LedgerEventKind::LlmRequestCreated,
                LedgerEventKind::ToolIntentParsed,
                LedgerEventKind::ToolIntentPermissionChecked,
                LedgerEventKind::ToolIntentApproved,
                LedgerEventKind::ToolIntentPermissionChecked,
                LedgerEventKind::ToolIntentDenied,
                LedgerEventKind::ToolIntentPermissionChecked,
                LedgerEventKind::ToolIntentApproved,
                LedgerEventKind::ToolExecutionRequested,
                LedgerEventKind::ToolExecutionPermissionChecked,
                LedgerEventKind::ToolExecutionFailed,
                LedgerEventKind::LlmResponseReceived,
                LedgerEventKind::TaskCompleted,
            ]
        );

        std::env::remove_var("BROWNIE_WORKSPACE_ROOT");
    }

    #[test]
    fn task_run_unknown_task_returns_invalid_params() {
        let _guard = ENV_LOCK.lock().expect("env lock");
        let temp = tempfile::tempdir().expect("tempdir");
        std::env::set_var("BROWNIE_WORKSPACE_ROOT", temp.path());

        let response = parse_line(
            r#"{"jsonrpc":"2.0","id":1,"method":"task.run","params":{"task_id":"task_missing"}}"#,
        );
        assert!(response.result.is_none());
        assert_eq!(response.error.expect("error").code, -32602);

        std::env::remove_var("BROWNIE_WORKSPACE_ROOT");
    }

    #[test]
    fn task_run_completed_task_returns_invalid_params() {
        let _guard = ENV_LOCK.lock().expect("env lock");
        let temp = tempfile::tempdir().expect("tempdir");
        std::env::set_var("BROWNIE_WORKSPACE_ROOT", temp.path());

        let start = parse_line(
            r#"{"jsonrpc":"2.0","id":1,"method":"task.start","params":{"goal":"Run once","mode_id":null}}"#,
        );
        let task_id = start.result.expect("start result")["task_id"]
            .as_str()
            .expect("task id")
            .to_string();
        let first = parse_line(&format!(
            r#"{{"jsonrpc":"2.0","id":2,"method":"task.run","params":{{"task_id":"{task_id}"}}}}"#
        ));
        assert!(first.error.is_none());

        let second = parse_line(&format!(
            r#"{{"jsonrpc":"2.0","id":3,"method":"task.run","params":{{"task_id":"{task_id}"}}}}"#
        ));
        assert!(second.result.is_none());
        assert_eq!(second.error.expect("error").code, -32602);

        std::env::remove_var("BROWNIE_WORKSPACE_ROOT");
    }

    #[test]
    fn task_start_with_empty_goal_returns_invalid_params() {
        let response = parse_line(
            r#"{"jsonrpc":"2.0","id":4,"method":"task.start","params":{"goal":"   ","mode_id":null}}"#,
        );
        assert!(response.result.is_none());
        assert_eq!(response.error.expect("error").code, -32602);
    }

    #[test]
    fn task_start_with_null_mode_stores_default_and_mode_resolved() {
        let _guard = ENV_LOCK.lock().expect("env lock");
        let temp = tempfile::tempdir().expect("tempdir");
        std::env::set_var("BROWNIE_WORKSPACE_ROOT", temp.path());

        let start = parse_line(
            r#"{"jsonrpc":"2.0","id":1,"method":"task.start","params":{"goal":"Default mode","mode_id":null}}"#,
        );
        let run_id = start.result.expect("start result")["run_id"]
            .as_str()
            .expect("run id")
            .to_string();
        let state: TaskRecord = serde_json::from_str(
            &std::fs::read_to_string(
                temp.path()
                    .join(".brownie/runs")
                    .join(&run_id)
                    .join("state.json"),
            )
            .expect("state"),
        )
        .expect("state record");
        assert_eq!(state.mode_id, Some("orchestrator".into()));
        let ledger = std::fs::read_to_string(
            temp.path()
                .join(".brownie/runs")
                .join(&run_id)
                .join("ledger.jsonl"),
        )
        .expect("ledger");
        assert!(ledger.contains("ModeResolved"));

        std::env::remove_var("BROWNIE_WORKSPACE_ROOT");
    }

    #[test]
    fn task_start_with_unknown_mode_returns_invalid_params() {
        let response = parse_line(
            r#"{"jsonrpc":"2.0","id":1,"method":"task.start","params":{"goal":"Bad mode","mode_id":"unknown-mode"}}"#,
        );
        assert!(response.result.is_none());
        assert_eq!(response.error.expect("error").code, -32602);
    }

    #[test]
    fn mode_list_and_get_return_builtin_modes() {
        let list = parse_line(r#"{"jsonrpc":"2.0","id":1,"method":"mode.list"}"#);
        let modes = list.result.expect("list result")["modes"]
            .as_array()
            .expect("modes")
            .clone();
        assert_eq!(modes.len(), 3);
        assert!(modes.iter().any(|mode| mode["mode_id"] == "orchestrator"));

        let get = parse_line(
            r#"{"jsonrpc":"2.0","id":2,"method":"mode.get","params":{"mode_id":"orchestrator"}}"#,
        );
        assert_eq!(get.result.expect("get result")["mode_id"], "orchestrator");
    }

    #[test]
    fn permission_check_returns_allowed_and_denied_decisions() {
        let denied = parse_line(
            r#"{"jsonrpc":"2.0","id":1,"method":"permission.check","params":{"mode_id":"orchestrator","action":"WriteWorkspace"}}"#,
        );
        assert!(denied.error.is_none());
        let result = denied.result.expect("denied result");
        assert_eq!(result["mode_id"], "orchestrator");
        assert_eq!(result["action"], "WriteWorkspace");
        assert_eq!(result["allowed"], false);
        assert!(result["reason"]
            .as_str()
            .expect("reason")
            .contains("workspace writes"));

        let allowed = parse_line(
            r#"{"jsonrpc":"2.0","id":2,"method":"permission.check","params":{"mode_id":"implementer","action":"WriteWorkspace"}}"#,
        );
        assert_eq!(allowed.result.expect("allowed result")["allowed"], true);
    }

    #[test]
    fn permission_check_unknown_mode_returns_invalid_params() {
        let response = parse_line(
            r#"{"jsonrpc":"2.0","id":1,"method":"permission.check","params":{"mode_id":"unknown-mode","action":"WriteWorkspace"}}"#,
        );
        assert!(response.result.is_none());
        assert_eq!(response.error.expect("error").code, -32602);
    }

    #[test]
    fn task_run_appends_permission_events() {
        let _guard = ENV_LOCK.lock().expect("env lock");
        let temp = tempfile::tempdir().expect("tempdir");
        std::env::set_var("BROWNIE_WORKSPACE_ROOT", temp.path());

        let start = parse_line(
            r#"{"jsonrpc":"2.0","id":1,"method":"task.start","params":{"goal":"Permission checks","mode_id":"orchestrator"}}"#,
        );
        let start_result = start.result.expect("start result");
        let task_id = start_result["task_id"]
            .as_str()
            .expect("task id")
            .to_string();
        let run_id = start_result["run_id"].as_str().expect("run id").to_string();

        let run = parse_line(&format!(
            r#"{{"jsonrpc":"2.0","id":2,"method":"task.run","params":{{"task_id":"{task_id}"}}}}"#
        ));
        assert_eq!(run.result.expect("run result")["status"], "Completed");

        let ledger = std::fs::read_to_string(
            temp.path()
                .join(".brownie/runs")
                .join(&run_id)
                .join("ledger.jsonl"),
        )
        .expect("ledger");
        let events: Vec<brownie_store::LedgerEvent> = ledger
            .lines()
            .map(|line| serde_json::from_str(line).expect("event"))
            .collect();
        assert_eq!(
            events
                .iter()
                .filter(|event| event.kind == LedgerEventKind::PermissionChecked)
                .count(),
            4
        );
        assert_eq!(
            events
                .iter()
                .filter(|event| event.kind == LedgerEventKind::PermissionDenied)
                .count(),
            2
        );
        assert!(ledger.contains("WriteWorkspace"));
        assert!(ledger.contains("ExecuteProcess"));

        std::env::remove_var("BROWNIE_WORKSPACE_ROOT");
    }

    #[test]
    fn tool_intent_parse_returns_evaluated_decisions() {
        let response = parse_line(
            r#"{"jsonrpc":"2.0","id":1,"method":"tool.intent.parse","params":{"mode_id":"orchestrator","assistant_content":"```brownie-tool-intent\n{\"tool_requests\":[{\"tool_id\":\"workspace.read\",\"reason\":\"Need context.\"},{\"tool_id\":\"workspace.write\",\"reason\":\"Need edits.\"}]}\n```"}}"#,
        );
        assert!(response.error.is_none());
        let result = response.result.expect("result");
        assert_eq!(result["mode_id"], "orchestrator");
        assert_eq!(result["items"][0]["tool_id"], "workspace.read");
        assert_eq!(result["items"][0]["allowed"], true);
        assert_eq!(result["items"][1]["tool_id"], "workspace.write");
        assert_eq!(result["items"][1]["allowed"], false);
    }

    #[test]
    fn tool_list_returns_builtin_tools() {
        let response = parse_line(r#"{"jsonrpc":"2.0","id":1,"method":"tool.list"}"#);
        assert!(response.error.is_none());
        let tools = response.result.expect("tool list")["tools"]
            .as_array()
            .expect("tools")
            .clone();
        assert_eq!(tools.len(), 7);
        assert!(tools.iter().any(|tool| tool["tool_id"] == "workspace.read"));
    }

    #[test]
    fn tool_plan_returns_dry_run_decisions_for_task() {
        let _guard = ENV_LOCK.lock().expect("env lock");
        let temp = tempfile::tempdir().expect("tempdir");
        std::env::set_var("BROWNIE_WORKSPACE_ROOT", temp.path());

        let start = parse_line(
            r#"{"jsonrpc":"2.0","id":1,"method":"task.start","params":{"goal":"Implement and test","mode_id":"orchestrator"}}"#,
        );
        let task_id = start.result.expect("start result")["task_id"]
            .as_str()
            .expect("task id")
            .to_string();
        let plan = parse_line(&format!(
            r#"{{"jsonrpc":"2.0","id":2,"method":"tool.plan","params":{{"task_id":"{task_id}"}}}}"#
        ));
        assert!(plan.error.is_none());
        let result = plan.result.expect("plan result");
        assert_eq!(result["mode_id"], "orchestrator");
        let items = result["items"].as_array().expect("items");
        assert!(items
            .iter()
            .any(|item| item["tool_id"] == "workspace.write" && item["allowed"] == false));
        assert!(items
            .iter()
            .any(|item| item["tool_id"] == "subtask.spawn" && item["allowed"] == true));

        std::env::remove_var("BROWNIE_WORKSPACE_ROOT");
    }

    #[test]
    fn mode_get_unknown_returns_invalid_params() {
        let response = parse_line(
            r#"{"jsonrpc":"2.0","id":1,"method":"mode.get","params":{"mode_id":"unknown-mode"}}"#,
        );
        assert!(response.result.is_none());
        assert_eq!(response.error.expect("error").code, -32602);
    }

    #[test]
    fn unknown_method_returns_method_not_found() {
        let response = parse_line(r#"{"jsonrpc":"2.0","id":2,"method":"runtime.unknown"}"#);
        assert_eq!(response.error.expect("error").code, -32601);
    }

    #[test]
    fn invalid_json_returns_parse_error() {
        let response = parse_line("not json");
        assert_eq!(response.id, Value::Null);
        assert_eq!(response.error.expect("error").code, -32700);
    }

    #[test]
    fn empty_line_is_ignored() {
        assert_eq!(handle_jsonrpc_input_line("  \t "), None);
    }
}

#[cfg(test)]
mod phase_2_2_tests {
    use super::*;
    use std::fs;

    struct EnvGuard;
    impl EnvGuard {
        fn clear_env() {
            for key in [
                "BROWNIE_LLM_PROVIDER",
                "BROWNIE_LLM_BASE_URL",
                "BROWNIE_LLM_MODEL",
                "BROWNIE_LLM_API_KEY_ENV",
                "BROWNIE_LLM_API_KEY",
                "BROWNIE_LLM_STRICT",
            ] {
                std::env::remove_var(key);
            }
        }
        fn clear() -> Self {
            Self::clear_env();
            Self
        }
    }
    impl Drop for EnvGuard {
        fn drop(&mut self) {
            Self::clear_env();
        }
    }

    fn write_config(dir: &std::path::Path, body: &str) {
        fs::create_dir_all(dir.join(".brownie")).unwrap();
        fs::write(dir.join(".brownie/config.json"), body).unwrap();
    }

    #[test]
    fn no_env_and_no_config_uses_default_fake() {
        let _lock = super::tests::ENV_LOCK.lock().expect("env lock");
        let _guard = EnvGuard::clear();
        let dir = tempfile::tempdir().unwrap();
        let status = llm_provider_status_from_workspace(dir.path()).unwrap();
        assert_eq!(status.status.provider, LlmProviderKind::Fake);
        assert_eq!(status.config_source, RuntimeConfigSource::Default);
    }

    #[test]
    fn env_fake_overrides_workspace_config() {
        let _lock = super::tests::ENV_LOCK.lock().expect("env lock");
        let _guard = EnvGuard::clear();
        let dir = tempfile::tempdir().unwrap();
        write_config(
            dir.path(),
            r#"{"version":1,"active_profile":"fake","llm":{"profiles":{"fake":{"provider":"fake"}}}}"#,
        );
        std::env::set_var("BROWNIE_LLM_PROVIDER", "fake");
        let status = llm_provider_status_from_workspace(dir.path()).unwrap();
        assert_eq!(status.status.provider, LlmProviderKind::Fake);
        assert_eq!(status.config_source, RuntimeConfigSource::Env);
    }

    #[test]
    fn workspace_config_openai_status_is_sanitized() {
        let _lock = super::tests::ENV_LOCK.lock().expect("env lock");
        let _guard = EnvGuard::clear();
        let dir = tempfile::tempdir().unwrap();
        write_config(
            dir.path(),
            r#"{"version":1,"active_profile":"local","llm":{"profiles":{"local":{"provider":"openai-compatible","base_url":"http://127.0.0.1:4141/v1","model":"qwen35","api_key_env":"BROWNIE_LLM_API_KEY","strict":true}}}}"#,
        );
        let status = llm_provider_status_from_workspace(dir.path()).unwrap();
        assert_eq!(status.status.provider, LlmProviderKind::OpenAiCompatible);
        assert_eq!(status.config_source, RuntimeConfigSource::WorkspaceConfig);
        assert_eq!(status.active_profile.as_deref(), Some("local"));
        assert!(!status.status.enabled);
        assert!(status.strict);
    }

    #[test]
    fn runtime_config_get_rejects_direct_api_key_without_leaking_value() {
        let _lock = super::tests::ENV_LOCK.lock().expect("env lock");
        let _guard = EnvGuard::clear();
        let dir = tempfile::tempdir().unwrap();
        write_config(
            dir.path(),
            r#"{"version":1,"active_profile":"bad","llm":{"profiles":{"bad":{"provider":"openai-compatible","base_url":"http://127.0.0.1:4141/v1","model":"qwen35","api_key":"DO_NOT_ALLOW"}}}}"#,
        );
        std::env::set_var("BROWNIE_WORKSPACE_ROOT", dir.path());
        let response =
            handle_jsonrpc_input_line(r#"{"jsonrpc":"2.0","id":1,"method":"runtime.config.get"}"#)
                .unwrap();
        assert!(response.contains("error"));
        assert!(!response.contains("DO_NOT_ALLOW"));
        std::env::remove_var("BROWNIE_WORKSPACE_ROOT");
    }
}
