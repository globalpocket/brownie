//! Brownie runtime entry points.

use brownie_agent_loop::{AgentLoop, AgentLoopState};
use brownie_agentmodes::{
    BuiltinModeRegistry, CompiledModePolicy, RuntimeAction, RuntimePermissionGate,
};
use brownie_config::{
    BrownieConfig, LlmProfile, LlmRequestBudgetConfig, RuntimeConfigLoader, CONFIG_RELATIVE_PATH,
};
use brownie_context::{ContextMaterializer, ContextMaterializerInput};
use brownie_llm::{
    redact_secret, scan_prompt_for_sensitive_content, validate_llm_request_budget, FakeLlmProvider,
    LlmMessage, LlmProvider, LlmProviderKind, LlmProviderStatus, LlmRequestBudget,
    OpenAiCompatibleConfig, OpenAiCompatibleConfigFromEnv, OpenAiCompatibleLlmProvider,
    PromptSensitiveGuardMode, PromptSensitiveScanResult,
};
use brownie_protocol::{
    DiagnosticSeverity, JsonRpcError, JsonRpcRequest, JsonRpcResponse, LedgerEventSummary,
    LlmHealthParams, LlmHealthResult, LlmRequestBudgetSummary, LlmStatusResult, ModeGetParams,
    ModeListResult, ModePermissionsSummary, ModeSummary, PermissionCheckParams,
    PermissionCheckResult, ProposalApplyCapabilityParams, ProposalApplyCapabilityResult,
    ProposalApplyDryRunHistoryParams, ProposalApplyDryRunHistoryResult, ProposalApplyDryRunParams,
    ProposalApplyDryRunResult, ProposalApproveParams, ProposalApproveResult,
    ProposalAuditTrailParams, ProposalAuditTrailResult, ProposalInspectParams,
    ProposalInspectResult, ProposalListParams, ProposalListResult, ProposalPreflightParams,
    ProposalPreflightResult, ProposalReadinessParams, ProposalReadinessResult,
    ProposalRejectParams, ProposalRejectResult, RunEventsParams, RunEventsResult, RunInspectParams,
    RunInspectResult, RunInspectSummary, RuntimeActionName, RuntimeConfigGetResult,
    RuntimeDiagnostic, RuntimeDiagnosticsResult, RuntimeState, RuntimeStatus, TaskGetParams,
    TaskInspectParams, TaskInspectResult, TaskListResult, TaskRunParams, TaskRunResult,
    TaskStartParams, TaskStartResult, TaskStatus, ToolExecuteParams, ToolExecuteResult,
    ToolExecuteStatus, ToolIntentDecisionSummary, ToolIntentInputSummary, ToolIntentParseParams,
    ToolIntentParseResult, ToolIntentParserConfigSummary, ToolIntentParserSummary,
    ToolIntentRejectedSummary, ToolListResult, ToolPlanDecisionSummary, ToolPlanParams,
    ToolPlanResult, ToolSummary, WorkspacePatchApplyCapabilityCheckSummary,
    WorkspacePatchApplyCapabilitySummary, WorkspacePatchApplyCheckSummary,
    WorkspacePatchApplyDryRunCheckSummary, WorkspacePatchApplyDryRunHistoryEntry,
    WorkspacePatchApplyDryRunHistorySummary, WorkspacePatchApplyDryRunSummary,
    WorkspacePatchApplyPlanSummary, WorkspacePatchAuditTrailEntry, WorkspacePatchAuditTrailSummary,
    WorkspacePatchPreflightSnapshotSummary, WorkspacePatchProposalSummary,
    WorkspacePatchReadinessCheckSummary, WorkspacePatchReadinessReportSummary,
};
use brownie_store::{BrownieStore, LedgerEvent, LedgerEventKind};
use brownie_tools::{
    BuiltinToolRegistry, RejectedToolIntent, ToolExecutionRequest, ToolExecutionStatus,
    ToolExecutor, ToolIntentDecision, ToolIntentEvaluator, ToolIntentParser, ToolPlanDecision,
    ToolPlanEvaluator, ToolPlanner, ToolPlanningInput, WorkspacePatchOperation,
    DEFAULT_PROPOSAL_PREVIEW_CHARS, WORKSPACE_READ_TOOL_ID, WORKSPACE_WRITE_TOOL_ID,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::Component;

const JSONRPC_VERSION: &str = "2.0";
const METHOD_RUNTIME_STATUS: &str = "runtime.status";
const METHOD_LLM_STATUS: &str = "llm.status";
const METHOD_LLM_HEALTH: &str = "llm.health";
const METHOD_RUNTIME_CONFIG_GET: &str = "runtime.config.get";
const METHOD_RUNTIME_DIAGNOSTICS_GET: &str = "runtime.diagnostics.get";
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
const METHOD_PROPOSAL_LIST: &str = "proposal.list";
const METHOD_PROPOSAL_INSPECT: &str = "proposal.inspect";
const METHOD_PROPOSAL_APPROVE: &str = "proposal.approve";
const METHOD_PROPOSAL_REJECT: &str = "proposal.reject";
const METHOD_PROPOSAL_PREFLIGHT: &str = "proposal.preflight";
const METHOD_PROPOSAL_READINESS: &str = "proposal.readiness";
const METHOD_PROPOSAL_APPLY_CAPABILITY: &str = "proposal.applyCapability";
const METHOD_PROPOSAL_APPLY_DRY_RUN: &str = "proposal.applyDryRun";
const METHOD_PROPOSAL_APPLY_DRY_RUN_HISTORY: &str = "proposal.applyDryRunHistory";
const METHOD_PROPOSAL_AUDIT_TRAIL: &str = "proposal.auditTrail";
const DEFAULT_DIFF_PREVIEW_CHARS: usize = 4000;
const MAX_DIFF_PREVIEW_CHARS: usize = 20000;
const MAX_DRY_RUN_HISTORY_ENTRIES: usize = 10;
const MAX_PROPOSAL_AUDIT_EVENTS: usize = 50;

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
        METHOD_LLM_HEALTH => handle_llm_health(request.id, request.params),
        METHOD_RUNTIME_CONFIG_GET => handle_runtime_config_get(request.id),
        METHOD_RUNTIME_DIAGNOSTICS_GET => handle_runtime_diagnostics_get(request.id),
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
        METHOD_PROPOSAL_LIST => handle_proposal_list(request.id, request.params),
        METHOD_PROPOSAL_INSPECT => handle_proposal_inspect(request.id, request.params),
        METHOD_PROPOSAL_APPROVE => handle_proposal_approve(request.id, request.params),
        METHOD_PROPOSAL_REJECT => handle_proposal_reject(request.id, request.params),
        METHOD_PROPOSAL_PREFLIGHT => handle_proposal_preflight(request.id, request.params),
        METHOD_PROPOSAL_READINESS => handle_proposal_readiness(request.id, request.params),
        METHOD_PROPOSAL_APPLY_CAPABILITY => {
            handle_proposal_apply_capability(request.id, request.params)
        }
        METHOD_PROPOSAL_APPLY_DRY_RUN => handle_proposal_apply_dry_run(request.id, request.params),
        METHOD_PROPOSAL_APPLY_DRY_RUN_HISTORY => {
            handle_proposal_apply_dry_run_history(request.id, request.params)
        }
        METHOD_PROPOSAL_AUDIT_TRAIL => handle_proposal_audit_trail(request.id, request.params),
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
    task_run_network_allowed: bool,
    budget: LlmRequestBudget,
    sensitive_guard_mode: PromptSensitiveGuardMode,
    sensitive_guard_invalid: Option<String>,
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

fn task_run_network_allowed() -> bool {
    matches!(
        std::env::var("BROWNIE_LLM_ALLOW_TASK_RUN_NETWORK")
            .ok()
            .as_deref(),
        Some("true")
    )
}

fn task_run_network_guard_reason() -> &'static str {
    "real-provider task.run requires BROWNIE_LLM_ALLOW_TASK_RUN_NETWORK=true"
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
        task_run_network_allowed: selection.task_run_network_allowed,
        budget: budget_summary(&selection.budget),
        sensitive_guard: selection.sensitive_guard_mode.as_config_str().to_string(),
    }
}

fn budget_summary(budget: &LlmRequestBudget) -> LlmRequestBudgetSummary {
    LlmRequestBudgetSummary {
        max_prompt_chars: budget.max_prompt_chars,
        max_messages: budget.max_messages,
        request_timeout_ms: budget.request_timeout_ms,
        response_preview_chars: budget.response_preview_chars,
    }
}

fn budget_from_profile(
    profile_budget: Option<&LlmRequestBudgetConfig>,
) -> Result<LlmRequestBudget, String> {
    let mut budget = LlmRequestBudget::default();
    if let Some(profile_budget) = profile_budget {
        budget = profile_budget.apply_to(budget);
    }
    apply_env_budget_overrides(budget)
}

fn provider_default_sensitive_guard(kind: &LlmProviderKind) -> PromptSensitiveGuardMode {
    match kind {
        LlmProviderKind::OpenAiCompatible => PromptSensitiveGuardMode::Fail,
        _ => PromptSensitiveGuardMode::Warn,
    }
}

fn resolve_sensitive_guard(
    provider: &LlmProviderKind,
    profile_value: Option<&String>,
) -> (PromptSensitiveGuardMode, Option<String>) {
    if let Ok(value) = std::env::var("BROWNIE_LLM_SENSITIVE_GUARD") {
        if !value.trim().is_empty() {
            return PromptSensitiveGuardMode::parse(&value)
                .map(|mode| (mode, None))
                .unwrap_or_else(|| {
                    (
                        provider_default_sensitive_guard(provider),
                        Some("BROWNIE_LLM_SENSITIVE_GUARD".to_string()),
                    )
                });
        }
    }
    if let Some(value) = profile_value {
        return PromptSensitiveGuardMode::parse(value)
            .map(|mode| (mode, None))
            .unwrap_or_else(|| {
                (
                    provider_default_sensitive_guard(provider),
                    Some("sensitive_guard".to_string()),
                )
            });
    }
    (provider_default_sensitive_guard(provider), None)
}

fn env_sensitive_guard_override_present() -> bool {
    std::env::var("BROWNIE_LLM_SENSITIVE_GUARD")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .is_some()
}

fn env_budget_override_present() -> bool {
    [
        "BROWNIE_LLM_MAX_PROMPT_CHARS",
        "BROWNIE_LLM_MAX_MESSAGES",
        "BROWNIE_LLM_REQUEST_TIMEOUT_MS",
        "BROWNIE_LLM_RESPONSE_PREVIEW_CHARS",
    ]
    .iter()
    .any(|key| {
        std::env::var(key)
            .ok()
            .filter(|v| !v.trim().is_empty())
            .is_some()
    })
}

fn apply_env_budget_overrides(mut budget: LlmRequestBudget) -> Result<LlmRequestBudget, String> {
    if let Ok(v) = std::env::var("BROWNIE_LLM_MAX_PROMPT_CHARS") {
        if !v.trim().is_empty() {
            budget.max_prompt_chars = v
                .parse()
                .map_err(|_| "invalid BROWNIE_LLM_MAX_PROMPT_CHARS".to_string())?;
        }
    }
    if let Ok(v) = std::env::var("BROWNIE_LLM_MAX_MESSAGES") {
        if !v.trim().is_empty() {
            budget.max_messages = v
                .parse()
                .map_err(|_| "invalid BROWNIE_LLM_MAX_MESSAGES".to_string())?;
        }
    }
    if let Ok(v) = std::env::var("BROWNIE_LLM_REQUEST_TIMEOUT_MS") {
        if !v.trim().is_empty() {
            budget.request_timeout_ms = v
                .parse()
                .map_err(|_| "invalid BROWNIE_LLM_REQUEST_TIMEOUT_MS".to_string())?;
        }
    }
    if let Ok(v) = std::env::var("BROWNIE_LLM_RESPONSE_PREVIEW_CHARS") {
        if !v.trim().is_empty() {
            budget.response_preview_chars = v
                .parse()
                .map_err(|_| "invalid BROWNIE_LLM_RESPONSE_PREVIEW_CHARS".to_string())?;
        }
    }
    validate_llm_request_budget(&budget)?;
    Ok(budget)
}

fn provider_kind_name(kind: &LlmProviderKind) -> &'static str {
    match kind {
        LlmProviderKind::Fake => "Fake",
        LlmProviderKind::OpenAiCompatible => "OpenAiCompatible",
        LlmProviderKind::Unknown => "Unknown",
    }
}

pub fn llm_provider_status_from_workspace(
    workspace_root: &std::path::Path,
) -> Result<RuntimeLlmProviderStatus, String> {
    if env_budget_override_present() {
        budget_from_profile(None)?;
    }
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
                task_run_network_allowed: task_run_network_allowed(),
                budget: budget_from_profile(None).unwrap_or_default(),
                sensitive_guard_mode: resolve_sensitive_guard(
                    &LlmProviderKind::OpenAiCompatible,
                    None,
                )
                .0,
                sensitive_guard_invalid: resolve_sensitive_guard(
                    &LlmProviderKind::OpenAiCompatible,
                    None,
                )
                .1,
            },
            OpenAiCompatibleConfigFromEnv::Disabled(status) => RuntimeLlmProviderStatus {
                status,
                strict,
                will_fallback_to_fake: !strict,
                config_source: RuntimeConfigSource::Env,
                active_profile: None,
                task_run_network_allowed: task_run_network_allowed(),
                budget: budget_from_profile(None).unwrap_or_default(),
                sensitive_guard_mode: resolve_sensitive_guard(
                    &LlmProviderKind::OpenAiCompatible,
                    None,
                )
                .0,
                sensitive_guard_invalid: resolve_sensitive_guard(
                    &LlmProviderKind::OpenAiCompatible,
                    None,
                )
                .1,
            },
        },
        Some("fake") | None => RuntimeLlmProviderStatus {
            config_source: RuntimeConfigSource::Env,
            ..fake_status_with_profile(None, false)
        },
        Some(value) => RuntimeLlmProviderStatus {
            status: LlmProviderStatus {
                provider: LlmProviderKind::Unknown,
                enabled: false,
                model: String::new(),
                base_url: None,
                reason: Some(format!("unknown provider: {}", redact_secret(value))),
            },
            strict,
            will_fallback_to_fake: !strict,
            config_source: RuntimeConfigSource::Env,
            active_profile: None,
            task_run_network_allowed: task_run_network_allowed(),
            budget: budget_from_profile(None).unwrap_or_default(),
            sensitive_guard_mode: resolve_sensitive_guard(&LlmProviderKind::Unknown, None).0,
            sensitive_guard_invalid: resolve_sensitive_guard(&LlmProviderKind::Unknown, None).1,
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
        task_run_network_allowed: task_run_network_allowed(),
        budget: budget_from_profile(None).unwrap_or_default(),
        sensitive_guard_mode: resolve_sensitive_guard(&LlmProviderKind::Fake, None).0,
        sensitive_guard_invalid: resolve_sensitive_guard(&LlmProviderKind::Fake, None).1,
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
        LlmProfile::Fake {
            model,
            budget,
            sensitive_guard,
        } => {
            let mut s = fake_status_with_profile(Some(profile_name), false);
            s.budget = budget_from_profile(budget.as_ref())?;
            let (mode, invalid) =
                resolve_sensitive_guard(&LlmProviderKind::Fake, sensitive_guard.as_ref());
            s.sensitive_guard_mode = mode;
            s.sensitive_guard_invalid = invalid;
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
            budget,
            sensitive_guard,
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
                task_run_network_allowed: task_run_network_allowed(),
                budget: budget_from_profile(budget.as_ref())?,
                sensitive_guard_mode: resolve_sensitive_guard(
                    &LlmProviderKind::OpenAiCompatible,
                    sensitive_guard.as_ref(),
                )
                .0,
                sensitive_guard_invalid: resolve_sensitive_guard(
                    &LlmProviderKind::OpenAiCompatible,
                    sensitive_guard.as_ref(),
                )
                .1,
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
    if !selection.strict {
        return Ok(Box::new(FakeLlmProvider));
    }
    if !selection.task_run_network_allowed {
        return Err(RuntimeLlmProviderError {
            message: task_run_network_guard_reason().to_string(),
            status: selection,
        });
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
                let selection = llm_provider_status_from_env();
                if !selection.strict {
                    return Ok(Box::new(FakeLlmProvider));
                }
                if !selection.task_run_network_allowed {
                    return Err(RuntimeLlmProviderError {
                        message: task_run_network_guard_reason().to_string(),
                        status: selection,
                    });
                }
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
        Some("fake") | None => Ok(Box::new(FakeLlmProvider)),
        Some(value) => {
            let selection = llm_provider_status_from_env();
            if selection.strict {
                Err(RuntimeLlmProviderError {
                    message: format!("unknown provider: {}", redact_secret(value)),
                    status: selection,
                })
            } else {
                Ok(Box::new(FakeLlmProvider))
            }
        }
    }
}

fn diagnostic(
    severity: DiagnosticSeverity,
    code: &str,
    message: impl Into<String>,
    subject: Option<&str>,
) -> RuntimeDiagnostic {
    RuntimeDiagnostic {
        severity,
        code: code.to_string(),
        message: message.into(),
        subject: subject.map(str::to_string),
    }
}

pub fn runtime_diagnostics_from_workspace(
    workspace_root: &std::path::Path,
) -> RuntimeDiagnosticsResult {
    let mut diagnostics = Vec::new();
    let mut status = match llm_provider_status_from_workspace(workspace_root) {
        Ok(status) => status,
        Err(error) => RuntimeLlmProviderStatus {
            status: LlmProviderStatus {
                provider: LlmProviderKind::Unknown,
                enabled: false,
                model: String::new(),
                base_url: None,
                reason: Some(redact_secret(&error)),
            },
            strict: false,
            will_fallback_to_fake: false,
            config_source: RuntimeConfigSource::WorkspaceConfig,
            active_profile: None,
            task_run_network_allowed: task_run_network_allowed(),
            budget: budget_from_profile(None).unwrap_or_default(),
            sensitive_guard_mode: resolve_sensitive_guard(&LlmProviderKind::Unknown, None).0,
            sensitive_guard_invalid: resolve_sensitive_guard(&LlmProviderKind::Unknown, None).1,
        },
    };

    match llm_provider_status_from_workspace(workspace_root) {
        Ok(selection) => {
            let code = if env_budget_override_present() {
                "LLM_BUDGET_ENV_OVERRIDE"
            } else if selection.config_source == RuntimeConfigSource::WorkspaceConfig {
                "LLM_BUDGET_PROFILE"
            } else {
                "LLM_BUDGET_DEFAULT"
            };
            diagnostics.push(diagnostic(
                DiagnosticSeverity::Info,
                code,
                format!(
                    "LLM request budget: max_prompt_chars={} max_messages={} request_timeout_ms={} response_preview_chars={}",
                    selection.budget.max_prompt_chars, selection.budget.max_messages, selection.budget.request_timeout_ms, selection.budget.response_preview_chars
                ),
                None,
            ));
        }
        Err(error)
            if error.contains("BROWNIE_LLM_")
                || error.contains("budget")
                || error.contains("max_")
                || error.contains("request_timeout_ms")
                || error.contains("response_preview_chars") =>
        {
            diagnostics.push(diagnostic(
                DiagnosticSeverity::Error,
                "LLM_BUDGET_INVALID",
                format!("Invalid LLM request budget: {}.", redact_secret(&error)),
                None,
            ));
            status.status.enabled = false;
            status.status.reason = Some("invalid LLM request budget".to_string());
        }
        Err(_) => {}
    }

    if let Some(subject) = status.sensitive_guard_invalid.clone() {
        diagnostics.push(diagnostic(
            DiagnosticSeverity::Error,
            "PROMPT_SENSITIVE_GUARD_INVALID",
            "Invalid prompt sensitive guard value; expected off, warn, or fail.",
            Some(&subject),
        ));
        status.status.enabled = false;
        status.status.reason = Some("invalid prompt sensitive guard".to_string());
    } else {
        let (code, subject) = if env_sensitive_guard_override_present() {
            (
                "PROMPT_SENSITIVE_GUARD_ENV_OVERRIDE",
                Some("BROWNIE_LLM_SENSITIVE_GUARD"),
            )
        } else if status.config_source == RuntimeConfigSource::WorkspaceConfig {
            (
                "PROMPT_SENSITIVE_GUARD_PROFILE",
                status.active_profile.as_deref(),
            )
        } else {
            ("PROMPT_SENSITIVE_GUARD_DEFAULT", None)
        };
        diagnostics.push(diagnostic(
            DiagnosticSeverity::Info,
            code,
            format!(
                "Prompt sensitive guard mode: {}.",
                status.sensitive_guard_mode.as_config_str()
            ),
            subject,
        ));
    }

    let strict_env = matches!(
        std::env::var("BROWNIE_LLM_STRICT").ok().as_deref(),
        Some("true")
    );
    let env_provider = std::env::var("BROWNIE_LLM_PROVIDER")
        .ok()
        .filter(|v| !v.trim().is_empty());
    if let Some(provider) = env_provider.as_deref() {
        diagnostics.push(diagnostic(
            DiagnosticSeverity::Info,
            "PROVIDER_ENV_OVERRIDE",
            format!(
                "Using LLM provider override from BROWNIE_LLM_PROVIDER: {}.",
                redact_secret(provider)
            ),
            Some("BROWNIE_LLM_PROVIDER"),
        ));
        if !matches!(provider, "fake" | "openai-compatible") {
            diagnostics.push(diagnostic(
                DiagnosticSeverity::Error,
                "PROVIDER_UNKNOWN",
                format!("Unknown LLM provider: {}.", redact_secret(provider)),
                Some("BROWNIE_LLM_PROVIDER"),
            ));
            if strict_env {
                diagnostics.push(diagnostic(
                    DiagnosticSeverity::Error,
                    "PROVIDER_STRICT_FAILURE",
                    "Strict mode will fail task.run for this provider configuration.",
                    Some("BROWNIE_LLM_STRICT"),
                ));
            } else {
                diagnostics.push(diagnostic(
                    DiagnosticSeverity::Warning,
                    "PROVIDER_FALLBACK_TO_FAKE",
                    "Unknown provider will fall back to Fake because strict mode is disabled.",
                    Some("BROWNIE_LLM_PROVIDER"),
                ));
            }
        }
    } else {
        let path = workspace_root.join(CONFIG_RELATIVE_PATH);
        if !path.exists() {
            diagnostics.push(diagnostic(
                DiagnosticSeverity::Info,
                "CONFIG_NOT_FOUND",
                "No .brownie/config.json found; using default Fake provider.",
                Some(CONFIG_RELATIVE_PATH),
            ));
            diagnostics.push(diagnostic(
                DiagnosticSeverity::Info,
                "PROVIDER_DEFAULT_FAKE",
                "Using default Fake LLM provider.",
                None,
            ));
        } else {
            match std::fs::read_to_string(&path) {
                Err(e) => diagnostics.push(diagnostic(
                    DiagnosticSeverity::Error,
                    "CONFIG_MALFORMED",
                    format!("Failed to read .brownie/config.json: {e}"),
                    Some(CONFIG_RELATIVE_PATH),
                )),
                Ok(content) => match serde_json::from_str::<serde_json::Value>(&content) {
                    Err(e) => diagnostics.push(diagnostic(
                        DiagnosticSeverity::Error,
                        "CONFIG_MALFORMED",
                        format!("Failed to parse .brownie/config.json: {e}"),
                        Some(CONFIG_RELATIVE_PATH),
                    )),
                    Ok(value) => {
                        if contains_key_recursive(&value, "api_key") {
                            diagnostics.push(diagnostic(
                                DiagnosticSeverity::Error,
                                "CONFIG_DIRECT_API_KEY_REJECTED",
                                "Direct api_key fields are not allowed; use api_key_env.",
                                Some(CONFIG_RELATIVE_PATH),
                            ));
                        }
                        match serde_json::from_value::<BrownieConfig>(value) {
                            Err(e) => diagnostics.push(diagnostic(
                                DiagnosticSeverity::Error,
                                "CONFIG_MALFORMED",
                                format!("Failed to validate .brownie/config.json: {e}"),
                                Some(CONFIG_RELATIVE_PATH),
                            )),
                            Ok(config) => {
                                if config.version != 1 {
                                    diagnostics.push(diagnostic(
                                        DiagnosticSeverity::Error,
                                        "CONFIG_UNSUPPORTED_VERSION",
                                        format!(
                                            "Unsupported runtime config version: {}.",
                                            config.version
                                        ),
                                        Some(CONFIG_RELATIVE_PATH),
                                    ));
                                }
                                match config.active_profile.as_deref() {
                                    None => diagnostics.push(diagnostic(
                                        DiagnosticSeverity::Error,
                                        "ACTIVE_PROFILE_MISSING",
                                        "active_profile is required when config exists.",
                                        Some(CONFIG_RELATIVE_PATH),
                                    )),
                                    Some(active) => {
                                        let profile = config
                                            .llm
                                            .as_ref()
                                            .and_then(|l| l.profiles.get(active));
                                        if profile.is_none() {
                                            diagnostics.push(diagnostic(DiagnosticSeverity::Error, "ACTIVE_PROFILE_UNKNOWN", format!("active_profile references unknown profile: {active}."), Some("active_profile")));
                                        } else {
                                            diagnostics.push(diagnostic(
                                                DiagnosticSeverity::Info,
                                                "PROVIDER_WORKSPACE_PROFILE",
                                                format!("Using workspace LLM profile {active}."),
                                                Some(active),
                                            ));
                                            if let Some(LlmProfile::OpenAiCompatible {
                                                api_key_env,
                                                strict,
                                                ..
                                            }) = profile
                                            {
                                                let key_env =
                                                    api_key_env.clone().unwrap_or_else(|| {
                                                        "BROWNIE_LLM_API_KEY".to_string()
                                                    });
                                                let key_present = std::env::var(&key_env)
                                                    .ok()
                                                    .filter(|v| !v.trim().is_empty())
                                                    .is_some();
                                                if !key_present {
                                                    diagnostics.push(diagnostic(DiagnosticSeverity::Warning, "API_KEY_ENV_MISSING", format!("API key environment variable is not set: {key_env}."), Some(&key_env)));
                                                    if strict.unwrap_or(false) {
                                                        diagnostics.push(diagnostic(DiagnosticSeverity::Error, "PROVIDER_STRICT_FAILURE", "Strict mode will fail task.run for this provider configuration.", Some("strict")));
                                                    } else {
                                                        diagnostics.push(diagnostic(DiagnosticSeverity::Warning, "PROVIDER_FALLBACK_TO_FAKE", "OpenAI-compatible provider will fall back to Fake because strict mode is disabled.", Some(active)));
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
            }
        }
    }

    if status.status.provider == LlmProviderKind::OpenAiCompatible
        && status.status.enabled
        && status.strict
    {
        if status.task_run_network_allowed {
            diagnostics.push(diagnostic(
                DiagnosticSeverity::Info,
                "TASK_RUN_NETWORK_ALLOWED",
                "OpenAI-compatible task.run network calls are explicitly allowed.",
                Some("BROWNIE_LLM_ALLOW_TASK_RUN_NETWORK"),
            ));
        } else {
            diagnostics.push(diagnostic(
                DiagnosticSeverity::Warning,
                "TASK_RUN_NETWORK_NOT_ALLOWED",
                task_run_network_guard_reason(),
                Some("BROWNIE_LLM_ALLOW_TASK_RUN_NETWORK"),
            ));
        }
    }

    if diagnostics.iter().any(|d| {
        d.code == "CONFIG_DIRECT_API_KEY_REJECTED"
            || d.code == "CONFIG_MALFORMED"
            || d.code == "CONFIG_UNSUPPORTED_VERSION"
            || d.code == "ACTIVE_PROFILE_UNKNOWN"
            || d.code == "ACTIVE_PROFILE_MISSING"
    }) {
        status.status.provider = LlmProviderKind::Unknown;
        status.status.enabled = false;
        status.status.model.clear();
        status.status.base_url = None;
        status.will_fallback_to_fake = false;
    }

    RuntimeDiagnosticsResult {
        config_source: status.config_source.as_str().to_string(),
        active_profile: status.active_profile.clone(),
        llm_status: llm_status_result(status),
        parser_config: tool_intent_parser_config_summary(),
        diagnostics,
    }
}

pub fn llm_health_from_workspace(
    workspace_root: &std::path::Path,
    allow_network: bool,
    timeout: std::time::Duration,
) -> Result<LlmHealthResult, String> {
    let selection = llm_provider_status_from_workspace(workspace_root)?;
    let checked_at = time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|e| e.to_string())?;
    let mut result = LlmHealthResult {
        provider: provider_kind_name(&selection.status.provider).to_string(),
        config_source: selection.config_source.as_str().to_string(),
        active_profile: selection.active_profile.clone(),
        enabled: selection.status.enabled,
        attempted: false,
        healthy: false,
        model: selection.status.model.clone(),
        base_url: selection.status.base_url.clone(),
        checked_at,
        latency_ms: None,
        status_code: None,
        reason: selection.status.reason.clone().map(|v| redact_secret(&v)),
        diagnostics: Vec::new(),
    };

    match selection.status.provider {
        LlmProviderKind::Fake => {
            result.enabled = true;
            result.healthy = true;
            result.reason = None;
            result.diagnostics.push(diagnostic(
                DiagnosticSeverity::Info,
                "PROVIDER_FAKE_HEALTHY",
                "Fake provider is healthy without network access.",
                None,
            ));
            Ok(result)
        }
        LlmProviderKind::OpenAiCompatible if !selection.status.enabled => {
            result.diagnostics.push(diagnostic(
                DiagnosticSeverity::Error,
                "HEALTH_PROVIDER_DISABLED",
                selection
                    .status
                    .reason
                    .clone()
                    .unwrap_or_else(|| "OpenAI-compatible provider is disabled.".to_string()),
                None,
            ));
            Ok(result)
        }
        LlmProviderKind::OpenAiCompatible if !allow_network => {
            result.diagnostics.push(diagnostic(
                DiagnosticSeverity::Warning,
                "HEALTH_NETWORK_NOT_ALLOWED",
                "Network probe was not attempted because allow_network=false.",
                None,
            ));
            Ok(result)
        }
        LlmProviderKind::OpenAiCompatible => {
            let provider = openai_provider_from_workspace_for_health(workspace_root, &selection)?;
            let probe = provider.probe_models(timeout);
            result.attempted = probe.attempted;
            result.healthy = probe.healthy;
            result.latency_ms = probe.latency_ms;
            result.status_code = probe.status_code;
            result.reason = probe.reason.map(|v| redact_secret(&v));
            result.diagnostics.push(diagnostic(
                if result.healthy {
                    DiagnosticSeverity::Info
                } else {
                    DiagnosticSeverity::Error
                },
                if result.healthy {
                    "HEALTH_PROBE_OK"
                } else {
                    "HEALTH_PROBE_FAILED"
                },
                if result.healthy {
                    "OpenAI-compatible /models probe returned a 2xx status.".to_string()
                } else {
                    result
                        .reason
                        .clone()
                        .unwrap_or_else(|| "OpenAI-compatible /models probe failed.".to_string())
                },
                result.base_url.as_deref(),
            ));
            Ok(result)
        }
        LlmProviderKind::Unknown => {
            result.diagnostics.push(diagnostic(
                DiagnosticSeverity::Error,
                "HEALTH_PROVIDER_UNSUPPORTED",
                selection
                    .status
                    .reason
                    .clone()
                    .unwrap_or_else(|| "Unsupported LLM provider.".to_string()),
                None,
            ));
            Ok(result)
        }
    }
}

fn openai_provider_from_workspace_for_health(
    workspace_root: &std::path::Path,
    selection: &RuntimeLlmProviderStatus,
) -> Result<OpenAiCompatibleLlmProvider, String> {
    if selection.config_source == RuntimeConfigSource::Env {
        return match OpenAiCompatibleLlmProvider::from_env() {
            OpenAiCompatibleConfigFromEnv::Enabled(config) => {
                let api_key = std::env::var(&config.api_key_env).unwrap_or_default();
                Ok(OpenAiCompatibleLlmProvider::new(config, api_key))
            }
            OpenAiCompatibleConfigFromEnv::Disabled(status) => Err(status
                .reason
                .unwrap_or_else(|| "OpenAI-compatible provider disabled".to_string())),
        };
    }
    let config =
        RuntimeConfigLoader::load_from_workspace(workspace_root).map_err(|e| e.to_string())?;
    let config = config.ok_or_else(|| "workspace config missing".to_string())?;
    let profile_name = selection.active_profile.clone().unwrap_or_default();
    let profile = config
        .llm
        .as_ref()
        .and_then(|llm| llm.profiles.get(&profile_name))
        .ok_or_else(|| "active_profile references unknown profile".to_string())?;
    let LlmProfile::OpenAiCompatible {
        base_url,
        model,
        api_key_env,
        ..
    } = profile
    else {
        return Err("active provider is not OpenAI-compatible".to_string());
    };
    let api_key_env = api_key_env
        .clone()
        .unwrap_or_else(|| "BROWNIE_LLM_API_KEY".to_string());
    let api_key =
        std::env::var(&api_key_env).map_err(|_| format!("missing config: {api_key_env}"))?;
    Ok(OpenAiCompatibleLlmProvider::new(
        OpenAiCompatibleConfig {
            base_url: base_url.clone(),
            model: model.clone(),
            api_key_env,
        },
        api_key,
    ))
}

fn contains_key_recursive(value: &serde_json::Value, key: &str) -> bool {
    match value {
        serde_json::Value::Object(map) => map
            .iter()
            .any(|(k, v)| k == key || contains_key_recursive(v, key)),
        serde_json::Value::Array(items) => items.iter().any(|v| contains_key_recursive(v, key)),
        _ => false,
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

fn handle_runtime_diagnostics_get(id: Value) -> JsonRpcResponse<Value> {
    let store = match BrownieStore::from_env_or_cwd() {
        Ok(store) => store,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    result_response(
        id,
        json!(runtime_diagnostics_from_workspace(store.workspace_root())),
    )
}

fn handle_llm_health(id: Value, params: Option<Value>) -> JsonRpcResponse<Value> {
    let params: LlmHealthParams = match parse_params(params) {
        Ok(params) => params,
        Err(message) => return error_response(id, -32602, &message),
    };
    let store = match BrownieStore::from_env_or_cwd() {
        Ok(store) => store,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    let default_timeout_ms = llm_provider_status_from_workspace(store.workspace_root())
        .map(|selection| selection.budget.request_timeout_ms)
        .unwrap_or(30_000);
    let timeout_ms = params.timeout_ms.unwrap_or(default_timeout_ms);
    if !(1000..=300000).contains(&timeout_ms) {
        return error_response(
            id,
            -32602,
            "invalid params: timeout_ms must be between 1000 and 300000",
        );
    }
    match llm_health_from_workspace(
        store.workspace_root(),
        params.allow_network,
        std::time::Duration::from_millis(timeout_ms),
    ) {
        Ok(result) => result_response(id, json!(result)),
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
    let result = match AgentLoop::run_with_llm(
        prompt_input,
        provider.as_ref(),
        &provider_selection.budget,
        provider_selection.sensitive_guard_mode.clone(),
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
                    task_run_network_allowed: provider_selection.task_run_network_allowed,
                    budget: provider_selection.budget.clone(),
                    sensitive_guard_mode: provider_selection.sensitive_guard_mode.clone(),
                    sensitive_guard_invalid: provider_selection.sensitive_guard_invalid.clone(),
                },
                &error.to_string(),
                LedgerEventKind::LlmRequestFailed,
            );
        }
    };

    if let Err(error) = append_sensitive_scan_event(
        &store,
        &running,
        &result.sensitive_scan,
        &provider_selection.sensitive_guard_mode,
        false,
    ) {
        return error_response(id, -32603, &format!("internal error: {error}"));
    }

    if let Err(error) = store.tasks().append_task_event_with_payload(
        &running,
        LedgerEventKind::PromptBuilt,
        Some(prompt_built_payload(
            result.prompt.messages.len(),
            &result.prompt,
            provider_selection.budget.response_preview_chars,
            provider_selection.budget.max_prompt_chars,
            &result.sensitive_scan,
        )),
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
    if let Err(error) =
        handle_approved_workspace_intents(&store, &running, &policy, &result.llm_response.content)
    {
        return error_response(id, -32603, &format!("internal error: {error}"));
    }

    if let Err(error) = store.tasks().append_task_event_with_payload(
        &running,
        LedgerEventKind::LlmResponseReceived,
        Some(json!({
            "provider": provider_kind_name(&provider_status.provider),
            "content_preview": preview_with_limit(&result.llm_response.content, provider_selection.budget.response_preview_chars),
            "response_preview_chars": provider_selection.budget.response_preview_chars,
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
            &provider_selection.budget,
            provider_selection.sensitive_guard_mode.clone(),
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
                        task_run_network_allowed: provider_selection.task_run_network_allowed,
                        budget: provider_selection.budget.clone(),
                        sensitive_guard_mode: provider_selection.sensitive_guard_mode.clone(),
                        sensitive_guard_invalid: provider_selection.sensitive_guard_invalid.clone(),
                    },
                    &error.to_string(),
                    LedgerEventKind::SecondPassLlmRequestFailed,
                );
            }
        };
        if let Err(error) = append_sensitive_scan_event(
            &store,
            &running,
            &second_pass.sensitive_scan,
            &provider_selection.sensitive_guard_mode,
            false,
        ) {
            return error_response(id, -32603, &format!("internal error: {error}"));
        }

        if let Err(error) = store.tasks().append_task_event_with_payload(
            &running,
            LedgerEventKind::SecondPassPromptBuilt,
            Some(prompt_built_payload(
                second_pass.prompt.messages.len(),
                &second_pass.prompt,
                provider_selection.budget.response_preview_chars,
                provider_selection.budget.max_prompt_chars,
                &second_pass.sensitive_scan,
            )),
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
                "content_preview": preview_with_limit(&second_pass.llm_response.content, provider_selection.budget.response_preview_chars),
                "response_preview_chars": provider_selection.budget.response_preview_chars,
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

fn append_sensitive_scan_event(
    store: &BrownieStore,
    running: &brownie_protocol::TaskRecord,
    scan: &PromptSensitiveScanResult,
    mode: &PromptSensitiveGuardMode,
    failed: bool,
) -> anyhow::Result<()> {
    if !failed && scan.findings.is_empty() {
        return Ok(());
    }
    let mut categories = scan
        .findings
        .iter()
        .map(|f| f.category.clone())
        .collect::<Vec<_>>();
    categories.sort();
    categories.dedup();
    let mut message_indexes = scan
        .findings
        .iter()
        .map(|f| f.message_index)
        .collect::<Vec<_>>();
    message_indexes.sort_unstable();
    message_indexes.dedup();
    store.tasks().append_task_event_with_payload(
        running,
        if failed {
            LedgerEventKind::PromptSensitiveScanFailed
        } else {
            LedgerEventKind::PromptSensitiveScanCompleted
        },
        Some(json!({
            "mode": mode.as_config_str(),
            "sensitive_guard": mode.as_config_str(),
            "finding_count": scan.findings.len(),
            "categories": categories,
            "message_indexes": message_indexes,
        })),
    )
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
    if reason.contains("Prompt sensitive-content guard failed") {
        let _ = store.tasks().append_task_event_with_payload(
            running,
            LedgerEventKind::PromptSensitiveScanFailed,
            Some(json!({
                "mode": selection.sensitive_guard_mode.as_config_str(),
                "sensitive_guard": selection.sensitive_guard_mode.as_config_str(),
                "finding_count": 1,
                "categories": [],
                "message_indexes": [],
            })),
        );
    }
    let _ = store.tasks().append_task_event_with_payload(
        running,
        kind,
        Some(json!({
            "provider": provider_kind_name(&selection.status.provider),
            "model": selection.status.model,
            "reason": reason,
            "base_url": selection.status.base_url.as_deref().map(redact_secret),
            "strict": selection.strict,
            "sensitive_guard": selection.sensitive_guard_mode.as_config_str(),
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

fn handle_proposal_list(id: Value, params: Option<Value>) -> JsonRpcResponse<Value> {
    let params: ProposalListParams = match parse_params(params) {
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
    match list_proposals(&store, &params.run_id) {
        Ok(proposals) => result_response(
            id,
            json!(ProposalListResult {
                run_id: params.run_id,
                proposals
            }),
        ),
        Err(message) => error_response(id, -32602, &message),
    }
}

fn handle_proposal_inspect(id: Value, params: Option<Value>) -> JsonRpcResponse<Value> {
    let params: ProposalInspectParams = match parse_params(params) {
        Ok(params) => params,
        Err(message) => return error_response(id, -32602, &message),
    };
    if params.run_id.trim().is_empty() {
        return error_response(id, -32602, "invalid params: run_id must not be empty");
    }
    if params.proposal_id.trim().is_empty() {
        return error_response(id, -32602, "invalid params: proposal_id must not be empty");
    }
    let store = match BrownieStore::from_env_or_cwd() {
        Ok(store) => store,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    match inspect_proposal(&store, &params.run_id, &params.proposal_id) {
        Ok(proposal) => result_response(id, json!(ProposalInspectResult { proposal })),
        Err(message) => error_response(id, -32602, &message),
    }
}

fn handle_proposal_approve(id: Value, params: Option<Value>) -> JsonRpcResponse<Value> {
    let params: ProposalApproveParams = match parse_params(params) {
        Ok(params) => params,
        Err(message) => return error_response(id, -32602, &message),
    };
    if params.run_id.trim().is_empty() || params.proposal_id.trim().is_empty() {
        return error_response(
            id,
            -32602,
            "invalid params: run_id and proposal_id must not be empty",
        );
    }
    let store = match BrownieStore::from_env_or_cwd() {
        Ok(store) => store,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    match approve_proposal(&store, &params.run_id, &params.proposal_id, params.reason) {
        Ok((proposal, apply_plan)) => result_response(
            id,
            json!(ProposalApproveResult {
                proposal,
                apply_plan
            }),
        ),
        Err(message) => error_response(id, -32602, &message),
    }
}

fn handle_proposal_reject(id: Value, params: Option<Value>) -> JsonRpcResponse<Value> {
    let params: ProposalRejectParams = match parse_params(params) {
        Ok(params) => params,
        Err(message) => return error_response(id, -32602, &message),
    };
    if params.run_id.trim().is_empty() || params.proposal_id.trim().is_empty() {
        return error_response(
            id,
            -32602,
            "invalid params: run_id and proposal_id must not be empty",
        );
    }
    let store = match BrownieStore::from_env_or_cwd() {
        Ok(store) => store,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    match reject_proposal(&store, &params.run_id, &params.proposal_id, params.reason) {
        Ok(proposal) => result_response(id, json!(ProposalRejectResult { proposal })),
        Err(message) => error_response(id, -32602, &message),
    }
}

fn handle_proposal_preflight(id: Value, params: Option<Value>) -> JsonRpcResponse<Value> {
    let params: ProposalPreflightParams = match parse_params(params) {
        Ok(params) => params,
        Err(message) => return error_response(id, -32602, &message),
    };
    if params.run_id.trim().is_empty() || params.proposal_id.trim().is_empty() {
        return error_response(
            id,
            -32602,
            "invalid params: run_id and proposal_id are required",
        );
    }
    let store = match BrownieStore::from_env_or_cwd() {
        Ok(store) => store,
        Err(error) => return error_response(id, -32602, &format!("invalid params: {error}")),
    };
    match preflight_proposal(&store, &params.run_id, &params.proposal_id) {
        Ok((proposal, snapshot, apply_plan)) => result_response(
            id,
            json!(ProposalPreflightResult {
                proposal,
                snapshot,
                apply_plan
            }),
        ),
        Err(message) => error_response(id, -32602, &message),
    }
}

fn handle_proposal_readiness(id: Value, params: Option<Value>) -> JsonRpcResponse<Value> {
    let params: ProposalReadinessParams = match parse_params(params) {
        Ok(params) => params,
        Err(message) => return error_response(id, -32602, &message),
    };
    if params.run_id.trim().is_empty() || params.proposal_id.trim().is_empty() {
        return error_response(
            id,
            -32602,
            "invalid params: run_id and proposal_id are required",
        );
    }
    let store = match BrownieStore::from_env_or_cwd() {
        Ok(store) => store,
        Err(error) => return error_response(id, -32602, &format!("invalid params: {error}")),
    };
    match readiness_proposal(&store, &params.run_id, &params.proposal_id) {
        Ok((proposal, report)) => {
            result_response(id, json!(ProposalReadinessResult { proposal, report }))
        }
        Err(message) => error_response(id, -32602, &message),
    }
}

fn handle_proposal_apply_capability(id: Value, params: Option<Value>) -> JsonRpcResponse<Value> {
    let params: ProposalApplyCapabilityParams = match parse_params(params) {
        Ok(params) => params,
        Err(message) => return error_response(id, -32602, &message),
    };
    if params.run_id.trim().is_empty() || params.proposal_id.trim().is_empty() {
        return error_response(
            id,
            -32602,
            "invalid params: run_id and proposal_id are required",
        );
    }
    let store = match BrownieStore::from_env_or_cwd() {
        Ok(store) => store,
        Err(error) => return error_response(id, -32602, &format!("invalid params: {error}")),
    };
    match inspect_apply_capability(&store, &params.run_id, &params.proposal_id) {
        Ok((proposal, capability)) => result_response(
            id,
            json!(ProposalApplyCapabilityResult {
                proposal,
                capability
            }),
        ),
        Err(message) => error_response(id, -32602, &message),
    }
}

fn handle_proposal_apply_dry_run(id: Value, params: Option<Value>) -> JsonRpcResponse<Value> {
    let params: ProposalApplyDryRunParams = match parse_params(params) {
        Ok(params) => params,
        Err(message) => return error_response(id, -32602, &message),
    };
    if params.run_id.trim().is_empty() || params.proposal_id.trim().is_empty() {
        return error_response(
            id,
            -32602,
            "invalid params: run_id and proposal_id are required",
        );
    }
    let store = match BrownieStore::from_env_or_cwd() {
        Ok(store) => store,
        Err(error) => return error_response(id, -32602, &format!("invalid params: {error}")),
    };
    match inspect_apply_dry_run(&store, &params.run_id, &params.proposal_id) {
        Ok((proposal, dry_run)) => {
            result_response(id, json!(ProposalApplyDryRunResult { proposal, dry_run }))
        }
        Err(message) => error_response(id, -32602, &message),
    }
}

fn handle_proposal_apply_dry_run_history(
    id: Value,
    params: Option<Value>,
) -> JsonRpcResponse<Value> {
    let params: ProposalApplyDryRunHistoryParams = match parse_params(params) {
        Ok(params) => params,
        Err(message) => return error_response(id, -32602, &message),
    };
    if params.run_id.trim().is_empty() || params.proposal_id.trim().is_empty() {
        return error_response(
            id,
            -32602,
            "invalid params: run_id and proposal_id are required",
        );
    }
    let store = match BrownieStore::from_env_or_cwd() {
        Ok(store) => store,
        Err(error) => return error_response(id, -32602, &format!("invalid params: {error}")),
    };
    match inspect_apply_dry_run_history(&store, &params.run_id, &params.proposal_id) {
        Ok((proposal, history)) => result_response(
            id,
            json!(ProposalApplyDryRunHistoryResult { proposal, history }),
        ),
        Err(message) => error_response(id, -32602, &message),
    }
}

fn handle_proposal_audit_trail(id: Value, params: Option<Value>) -> JsonRpcResponse<Value> {
    let params: ProposalAuditTrailParams = match parse_params(params) {
        Ok(params) => params,
        Err(message) => return error_response(id, -32602, &message),
    };
    if params.run_id.trim().is_empty() || params.proposal_id.trim().is_empty() {
        return error_response(
            id,
            -32602,
            "invalid params: run_id and proposal_id are required",
        );
    }
    let store = match BrownieStore::from_env_or_cwd() {
        Ok(store) => store,
        Err(error) => return error_response(id, -32602, &format!("invalid params: {error}")),
    };
    match inspect_proposal_audit_trail(&store, &params.run_id, &params.proposal_id) {
        Ok((proposal, audit_trail)) => result_response(
            id,
            json!(ProposalAuditTrailResult {
                proposal,
                audit_trail
            }),
        ),
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
    let parser_summary = parsed.summary.clone();
    let evaluation = ToolIntentEvaluator::evaluate(&policy, parsed);
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

fn list_proposals(
    store: &BrownieStore,
    run_id: &str,
) -> Result<Vec<WorkspacePatchProposalSummary>, String> {
    let events = read_existing_run_events(store, run_id)?;
    let all_events = events.clone();
    Ok(events
        .into_iter()
        .filter(|event| event.kind == LedgerEventKind::WorkspacePatchProposed)
        .filter_map(|event| {
            let payload = sanitize_ledger_payload(event.payload)?;
            let proposal_id = payload.get("proposal_id")?.as_str()?.to_string();
            let approval = approval_state(&all_events, &proposal_id);
            Some(WorkspacePatchProposalSummary {
                proposal_id,
                path: payload.get("path")?.as_str()?.to_string(),
                operation: payload.get("operation")?.as_str()?.to_string(),
                content_preview: payload.get("content_preview")?.as_str()?.to_string(),
                content_chars: payload.get("content_chars")?.as_u64()? as usize,
                truncated: payload.get("truncated")?.as_bool()?,
                validation_status: payload.get("validation_status")?.as_str()?.to_string(),
                validation_reason: payload
                    .get("validation_reason")
                    .and_then(Value::as_str)
                    .map(ToString::to_string),
                diff_preview: payload
                    .get("diff_preview")
                    .and_then(Value::as_str)
                    .map(ToString::to_string),
                diff_truncated: payload.get("diff_truncated")?.as_bool()?,
                diff_redacted: payload.get("diff_redacted")?.as_bool()?,
                approval_status: approval.approval_status,
                approval_reason: approval.approval_reason,
                approval_reason_redacted: approval.approval_reason_redacted,
                approved_at: approval.approved_at,
                rejected_at: approval.rejected_at,
                latest_apply_plan: latest_apply_plan(
                    &all_events,
                    payload.get("proposal_id")?.as_str()?,
                ),
                latest_snapshot: latest_snapshot(
                    &all_events,
                    payload.get("proposal_id")?.as_str()?,
                ),
            })
        })
        .collect())
}

struct ApprovalState {
    approval_status: String,
    approval_reason: Option<String>,
    approval_reason_redacted: bool,
    approved_at: Option<String>,
    rejected_at: Option<String>,
}

fn approval_state(events: &[LedgerEvent], proposal_id: &str) -> ApprovalState {
    let mut state = ApprovalState {
        approval_status: "Pending".to_string(),
        approval_reason: None,
        approval_reason_redacted: false,
        approved_at: None,
        rejected_at: None,
    };
    for event in events {
        if !matches!(
            event.kind,
            LedgerEventKind::WorkspacePatchApproved | LedgerEventKind::WorkspacePatchRejected
        ) {
            continue;
        }
        let Some(payload) = sanitize_ledger_payload(event.payload.clone()) else {
            continue;
        };
        if payload.get("proposal_id").and_then(Value::as_str) != Some(proposal_id) {
            continue;
        }
        state.approval_status = payload
            .get("approval_status")
            .and_then(Value::as_str)
            .unwrap_or("Pending")
            .to_string();
        state.approval_reason = payload
            .get("approval_reason")
            .and_then(Value::as_str)
            .map(ToString::to_string);
        state.approval_reason_redacted = payload
            .get("approval_reason_redacted")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        state.approved_at = payload
            .get("approved_at")
            .and_then(Value::as_str)
            .map(ToString::to_string);
        state.rejected_at = payload
            .get("rejected_at")
            .and_then(Value::as_str)
            .map(ToString::to_string);
    }
    state
}

fn latest_apply_plan(
    events: &[LedgerEvent],
    proposal_id: &str,
) -> Option<WorkspacePatchApplyPlanSummary> {
    events.iter().rev().find_map(|event| {
        if event.kind != LedgerEventKind::WorkspacePatchApplyPlanCreated {
            return None;
        }
        let payload = sanitize_ledger_payload(event.payload.clone())?;
        if payload.get("proposal_id").and_then(Value::as_str) != Some(proposal_id) {
            return None;
        }
        Some(build_apply_plan_summary(
            proposal_id,
            payload.get("plan_id")?.as_str()?,
            payload.get("status")?.as_str()?,
        ))
    })
}

fn latest_snapshot(
    events: &[LedgerEvent],
    proposal_id: &str,
) -> Option<WorkspacePatchPreflightSnapshotSummary> {
    events.iter().rev().find_map(|event| {
        if event.kind != LedgerEventKind::WorkspacePatchPreflightSnapshotCreated {
            return None;
        }
        let payload = sanitize_ledger_payload(event.payload.clone())?;
        if payload.get("proposal_id").and_then(Value::as_str) != Some(proposal_id) {
            return None;
        }
        Some(WorkspacePatchPreflightSnapshotSummary {
            proposal_id: proposal_id.to_string(),
            snapshot_id: payload.get("snapshot_id")?.as_str()?.to_string(),
            path: payload.get("path")?.as_str()?.to_string(),
            canonical_path_hash: payload.get("canonical_path_hash")?.as_str()?.to_string(),
            file_exists: payload.get("file_exists")?.as_bool()?,
            file_kind: payload.get("file_kind")?.as_str()?.to_string(),
            file_size_bytes: payload.get("file_size_bytes").and_then(Value::as_u64),
            file_modified_unix_ms: payload.get("file_modified_unix_ms").and_then(Value::as_i64),
            file_sha256: payload
                .get("file_sha256")
                .and_then(Value::as_str)
                .map(ToString::to_string),
            captured_at: payload.get("captured_at")?.as_str()?.to_string(),
            stale: payload.get("stale")?.as_bool()?,
            stale_reason: payload
                .get("stale_reason")
                .and_then(Value::as_str)
                .map(ToString::to_string),
        })
    })
}

fn build_apply_plan_summary(
    proposal_id: &str,
    plan_id: &str,
    status: &str,
) -> WorkspacePatchApplyPlanSummary {
    let pass = |name: &str| WorkspacePatchApplyCheckSummary {
        name: name.to_string(),
        status: "Pass".to_string(),
        reason: None,
    };
    WorkspacePatchApplyPlanSummary {
        proposal_id: proposal_id.to_string(),
        plan_id: plan_id.to_string(),
        status: status.to_string(),
        checklist: vec![
            pass("proposal_exists"),
            pass("proposal_is_valid"),
            pass("proposal_is_approved"),
            pass("target_path_safe"),
            pass("target_file_exists"),
            pass("target_file_regular"),
            pass("target_file_utf8"),
            pass("target_file_hash_captured"),
            pass("proposal_not_stale"),
            pass("diff_preview_available"),
            pass("sensitive_content_not_detected"),
            WorkspacePatchApplyCheckSummary {
                name: "apply_not_enabled".to_string(),
                status: "Fail".to_string(),
                reason: Some("Patch apply is not implemented in Phase 3.3.".to_string()),
            },
        ],
    }
}

fn now_rfc3339() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

fn sanitize_approval_reason(reason: Option<String>) -> (Option<String>, bool) {
    let Some(reason) = reason else {
        return (None, false);
    };
    let bounded = preview_with_limit(&reason, 1000);
    if scan_text_for_sensitive_content(&bounded) || bounded.contains("sk-") {
        (Some("[redacted]".to_string()), true)
    } else {
        (Some(bounded), false)
    }
}

fn approve_proposal(
    store: &BrownieStore,
    run_id: &str,
    proposal_id: &str,
    reason: Option<String>,
) -> Result<
    (
        WorkspacePatchProposalSummary,
        WorkspacePatchApplyPlanSummary,
    ),
    String,
> {
    let task = store
        .tasks()
        .get_task_by_run_id(run_id)
        .map_err(|e| format!("invalid params: {e}"))?
        .ok_or_else(|| "invalid params: run not found".to_string())?;
    let proposal = inspect_proposal(store, run_id, proposal_id)?;
    if proposal.validation_status != "Valid" {
        return Err("invalid params: only valid proposals can be approved".to_string());
    }
    if proposal.approval_status != "Pending" {
        return Err("invalid params: proposal is not pending".to_string());
    }
    let approved_at = now_rfc3339();
    let (reason, reason_redacted) = sanitize_approval_reason(reason);
    store
        .tasks()
        .append_task_event_with_payload(
            &task,
            LedgerEventKind::WorkspacePatchApproved,
            Some(json!({
                "proposal_id": proposal_id,
                "approval_status": "Approved",
                "approval_reason": reason,
                "approval_reason_redacted": reason_redacted,
                "approved_at": approved_at,
            })),
        )
        .map_err(|e| format!("invalid params: {e}"))?;
    let plan_id = format!("plan_{}", uuid::Uuid::new_v4().simple());
    let apply_plan = build_apply_plan_summary(proposal_id, &plan_id, "Blocked");
    store
        .tasks()
        .append_task_event_with_payload(
            &task,
            LedgerEventKind::WorkspacePatchApplyPlanCreated,
            Some(json!({
                "proposal_id": proposal_id,
                "plan_id": plan_id,
                "status": "Blocked",
                "check_count": apply_plan.checklist.len(),
                "failed_checks": ["apply_not_enabled"],
            })),
        )
        .map_err(|e| format!("invalid params: {e}"))?;
    Ok((inspect_proposal(store, run_id, proposal_id)?, apply_plan))
}

fn reject_proposal(
    store: &BrownieStore,
    run_id: &str,
    proposal_id: &str,
    reason: Option<String>,
) -> Result<WorkspacePatchProposalSummary, String> {
    let task = store
        .tasks()
        .get_task_by_run_id(run_id)
        .map_err(|e| format!("invalid params: {e}"))?
        .ok_or_else(|| "invalid params: run not found".to_string())?;
    let proposal = inspect_proposal(store, run_id, proposal_id)?;
    if proposal.approval_status != "Pending" {
        return Err("invalid params: proposal is not pending".to_string());
    }
    let rejected_at = now_rfc3339();
    let (reason, reason_redacted) = sanitize_approval_reason(reason);
    store
        .tasks()
        .append_task_event_with_payload(
            &task,
            LedgerEventKind::WorkspacePatchRejected,
            Some(json!({
                "proposal_id": proposal_id,
                "approval_status": "Rejected",
                "approval_reason": reason,
                "approval_reason_redacted": reason_redacted,
                "rejected_at": rejected_at,
            })),
        )
        .map_err(|e| format!("invalid params: {e}"))?;
    inspect_proposal(store, run_id, proposal_id)
}

fn readiness_check(
    name: &str,
    status: &str,
    reason: Option<&str>,
) -> WorkspacePatchReadinessCheckSummary {
    WorkspacePatchReadinessCheckSummary {
        name: name.to_string(),
        status: status.to_string(),
        reason: reason.map(ToString::to_string),
    }
}

fn apply_capability_check(
    name: &str,
    status: &str,
    reason: Option<&str>,
) -> WorkspacePatchApplyCapabilityCheckSummary {
    WorkspacePatchApplyCapabilityCheckSummary {
        name: name.to_string(),
        status: status.to_string(),
        reason: reason.map(ToString::to_string),
    }
}

fn apply_dry_run_check(
    name: &str,
    status: &str,
    reason: Option<&str>,
) -> WorkspacePatchApplyDryRunCheckSummary {
    WorkspacePatchApplyDryRunCheckSummary {
        name: name.to_string(),
        status: status.to_string(),
        reason: reason.map(ToString::to_string),
    }
}

fn inspect_apply_capability(
    store: &BrownieStore,
    run_id: &str,
    proposal_id: &str,
) -> Result<
    (
        WorkspacePatchProposalSummary,
        WorkspacePatchApplyCapabilitySummary,
    ),
    String,
> {
    let task = store
        .tasks()
        .get_task_by_run_id(run_id)
        .map_err(|e| format!("invalid params: {e}"))?
        .ok_or_else(|| "invalid params: run not found".to_string())?;
    let proposal = inspect_proposal(store, run_id, proposal_id)?;
    let snapshot = proposal.latest_snapshot.as_ref();
    let mut checklist = vec![apply_capability_check("proposal_exists", "Pass", None)];

    if proposal.validation_status == "Blocked" {
        checklist.push(apply_capability_check(
            "proposal_is_valid",
            "Blocked",
            proposal.validation_reason.as_deref(),
        ));
    } else if proposal.validation_status == "Valid" {
        checklist.push(apply_capability_check("proposal_is_valid", "Pass", None));
    } else {
        checklist.push(apply_capability_check(
            "proposal_is_valid",
            "Fail",
            proposal
                .validation_reason
                .as_deref()
                .or(Some("Proposal validation status is not Valid.")),
        ));
    }

    checklist.push(if proposal.approval_status == "Approved" {
        apply_capability_check("proposal_is_approved", "Pass", None)
    } else {
        apply_capability_check(
            "proposal_is_approved",
            "Fail",
            Some("Proposal is not approved."),
        )
    });
    checklist.push(if snapshot.is_some() {
        apply_capability_check("proposal_has_preflight_snapshot", "Pass", None)
    } else {
        apply_capability_check(
            "proposal_has_preflight_snapshot",
            "Fail",
            Some("Run proposal.preflight before final review."),
        )
    });
    checklist.push(match snapshot {
        Some(snapshot) if !snapshot.stale => {
            apply_capability_check("proposal_not_stale", "Pass", None)
        }
        Some(snapshot) => apply_capability_check(
            "proposal_not_stale",
            "Fail",
            snapshot
                .stale_reason
                .as_deref()
                .or(Some("Latest preflight snapshot is stale.")),
        ),
        None => apply_capability_check(
            "proposal_not_stale",
            "Skipped",
            Some("No preflight snapshot is available."),
        ),
    });
    checklist.push(if proposal.diff_preview.is_some() {
        apply_capability_check("sanitized_diff_preview_available", "Pass", None)
    } else {
        apply_capability_check(
            "sanitized_diff_preview_available",
            "Fail",
            Some("Sanitized diff preview is unavailable."),
        )
    });
    checklist.push(
        if proposal.diff_redacted || proposal.content_preview == "[redacted]" {
            apply_capability_check(
                "sensitive_content_not_detected",
                "Blocked",
                Some("Sensitive-like content was detected or redacted."),
            )
        } else {
            apply_capability_check("sensitive_content_not_detected", "Pass", None)
        },
    );
    checklist.push(apply_capability_check(
        "no_raw_content_exposed",
        "Pass",
        None,
    ));
    checklist.push(apply_capability_check(
        "apply_execution_disabled",
        "Blocked",
        Some("Patch apply execution is not enabled in Phase 3.5."),
    ));

    let blocked_checks: Vec<String> = checklist
        .iter()
        .filter(|c| c.status == "Blocked")
        .map(|c| c.name.clone())
        .collect();
    let failed_checks: Vec<String> = checklist
        .iter()
        .filter(|c| c.status == "Fail")
        .map(|c| c.name.clone())
        .collect();
    let checked_at = now_rfc3339();
    let capability_id = format!("apply_capability_{}", uuid::Uuid::new_v4().simple());
    let reason = "Patch apply is not implemented in Phase 3.5.".to_string();
    let required_gates = vec![
        "proposal_valid".to_string(),
        "proposal_approved".to_string(),
        "preflight_snapshot_exists".to_string(),
        "proposal_not_stale".to_string(),
        "readiness_ready".to_string(),
        "operator_apply_enabled".to_string(),
        "runtime_apply_supported".to_string(),
    ];
    let capability = WorkspacePatchApplyCapabilitySummary {
        proposal_id: proposal_id.to_string(),
        capability_id: capability_id.clone(),
        apply_supported: false,
        apply_enabled: false,
        mode: "dry_run_only".to_string(),
        reason,
        required_gates,
        can_apply_now: false,
        checked_at: checked_at.clone(),
        check_count: checklist.len(),
        failed_checks,
        blocked_checks,
        checklist,
    };
    store
        .tasks()
        .append_task_event_with_payload(
            &task,
            LedgerEventKind::WorkspacePatchApplyCapabilityChecked,
            Some(json!({
                "proposal_id": proposal_id,
                "capability_id": capability_id,
                "apply_supported": capability.apply_supported,
                "apply_enabled": capability.apply_enabled,
                "mode": &capability.mode,
                "reason": &capability.reason,
                "required_gates": &capability.required_gates,
                "can_apply_now": capability.can_apply_now,
                "checked_at": checked_at,
                "check_count": capability.check_count,
                "failed_checks": &capability.failed_checks,
                "blocked_checks": &capability.blocked_checks,
            })),
        )
        .map_err(|e| format!("invalid params: {e}"))?;
    Ok((inspect_proposal(store, run_id, proposal_id)?, capability))
}

fn latest_readiness_status(
    events: &[LedgerEvent],
    proposal_id: &str,
) -> Option<(String, Option<String>)> {
    events.iter().rev().find_map(|event| {
        if event.kind != LedgerEventKind::WorkspacePatchReadinessReportCreated {
            return None;
        }
        let payload = sanitize_ledger_payload(event.payload.clone())?;
        if payload.get("proposal_id").and_then(Value::as_str) != Some(proposal_id) {
            return None;
        }
        Some((
            payload.get("readiness_status")?.as_str()?.to_string(),
            payload
                .get("readiness_reason")
                .and_then(Value::as_str)
                .map(ToString::to_string),
        ))
    })
}

fn inspect_apply_dry_run(
    store: &BrownieStore,
    run_id: &str,
    proposal_id: &str,
) -> Result<
    (
        WorkspacePatchProposalSummary,
        WorkspacePatchApplyDryRunSummary,
    ),
    String,
> {
    let task = store
        .tasks()
        .get_task_by_run_id(run_id)
        .map_err(|e| format!("invalid params: {e}"))?
        .ok_or_else(|| "invalid params: run not found".to_string())?;
    let proposal = inspect_proposal(store, run_id, proposal_id)?;
    let events = read_existing_run_events(store, run_id)?;
    let latest_readiness = latest_readiness_status(&events, proposal_id);
    let snapshot = proposal.latest_snapshot.as_ref();
    let mut checklist = vec![apply_dry_run_check("proposal_exists", "Pass", None)];

    if proposal.validation_status == "Blocked" {
        checklist.push(apply_dry_run_check(
            "proposal_is_valid",
            "Blocked",
            proposal.validation_reason.as_deref(),
        ));
    } else if proposal.validation_status == "Valid" {
        checklist.push(apply_dry_run_check("proposal_is_valid", "Pass", None));
    } else {
        checklist.push(apply_dry_run_check(
            "proposal_is_valid",
            "Fail",
            proposal
                .validation_reason
                .as_deref()
                .or(Some("Proposal validation status is not Valid.")),
        ));
    }

    checklist.push(if proposal.approval_status == "Approved" {
        apply_dry_run_check("proposal_is_approved", "Pass", None)
    } else {
        apply_dry_run_check(
            "proposal_is_approved",
            "Fail",
            Some("Proposal is not approved."),
        )
    });
    checklist.push(if snapshot.is_some() {
        apply_dry_run_check("proposal_has_preflight_snapshot", "Pass", None)
    } else {
        apply_dry_run_check(
            "proposal_has_preflight_snapshot",
            "Fail",
            Some("Run proposal.preflight before dry-run inspection."),
        )
    });
    checklist.push(match snapshot {
        Some(snapshot) if !snapshot.stale => {
            apply_dry_run_check("proposal_not_stale", "Pass", None)
        }
        Some(snapshot) => apply_dry_run_check(
            "proposal_not_stale",
            "Fail",
            snapshot
                .stale_reason
                .as_deref()
                .or(Some("Latest preflight snapshot is stale.")),
        ),
        None => apply_dry_run_check(
            "proposal_not_stale",
            "Skipped",
            Some("No preflight snapshot is available."),
        ),
    });
    checklist.push(if proposal.diff_preview.is_some() {
        apply_dry_run_check("sanitized_diff_preview_available", "Pass", None)
    } else {
        apply_dry_run_check(
            "sanitized_diff_preview_available",
            "Fail",
            Some("Sanitized diff preview is unavailable."),
        )
    });
    checklist.push(match latest_readiness.as_ref() {
        Some((status, _)) if status == "Ready" => {
            apply_dry_run_check("readiness_ready", "Pass", None)
        }
        Some((status, reason)) if status == "Blocked" => apply_dry_run_check(
            "readiness_ready",
            "Blocked",
            reason
                .as_deref()
                .or(Some("Latest readiness report is blocked.")),
        ),
        Some((_, reason)) => apply_dry_run_check(
            "readiness_ready",
            "Fail",
            reason
                .as_deref()
                .or(Some("Latest readiness report is not ready.")),
        ),
        None => apply_dry_run_check(
            "readiness_ready",
            "Fail",
            Some("Run proposal.readiness before apply dry-run inspection."),
        ),
    });
    checklist.push(apply_dry_run_check("no_raw_content_exposed", "Pass", None));
    checklist.push(apply_dry_run_check(
        "apply_execution_disabled",
        "Blocked",
        Some("Patch apply execution is not enabled in Phase 3.6 dry-run mode."),
    ));
    checklist.push(apply_dry_run_check(
        "workspace_files_unchanged",
        "Pass",
        Some("Dry-run inspection does not write workspace files."),
    ));

    let blocked_checks: Vec<String> = checklist
        .iter()
        .filter(|c| c.status == "Blocked")
        .map(|c| c.name.clone())
        .collect();
    let failed_checks: Vec<String> = checklist
        .iter()
        .filter(|c| c.status == "Fail")
        .map(|c| c.name.clone())
        .collect();
    let checked_at = now_rfc3339();
    let dry_run_id = format!("apply_dry_run_{}", uuid::Uuid::new_v4().simple());
    let required_gates = vec![
        "proposal_valid".to_string(),
        "proposal_approved".to_string(),
        "preflight_snapshot_exists".to_string(),
        "proposal_not_stale".to_string(),
        "readiness_ready".to_string(),
        "operator_dry_run_requested".to_string(),
        "runtime_apply_supported".to_string(),
    ];
    let dry_run = WorkspacePatchApplyDryRunSummary {
        proposal_id: proposal_id.to_string(),
        dry_run_id: dry_run_id.clone(),
        dry_run_status: "Completed".to_string(),
        dry_run_reason: "Dry run completed without applying a patch or changing workspace files."
            .to_string(),
        checked_at: checked_at.clone(),
        required_gates,
        check_count: checklist.len(),
        failed_checks,
        blocked_checks,
        no_patch_applied: true,
        apply_executed: false,
        workspace_files_changed: false,
        checklist,
    };
    store
        .tasks()
        .append_task_event_with_payload(
            &task,
            LedgerEventKind::WorkspacePatchApplyDryRunChecked,
            Some(json!({
                "proposal_id": proposal_id,
                "dry_run_id": dry_run_id,
                "dry_run_status": &dry_run.dry_run_status,
                "dry_run_reason": &dry_run.dry_run_reason,
                "checked_at": checked_at,
                "required_gates": &dry_run.required_gates,
                "check_count": dry_run.check_count,
                "failed_checks": &dry_run.failed_checks,
                "blocked_checks": &dry_run.blocked_checks,
                "no_patch_applied": dry_run.no_patch_applied,
                "apply_executed": dry_run.apply_executed,
                "workspace_files_changed": dry_run.workspace_files_changed,
            })),
        )
        .map_err(|e| format!("invalid params: {e}"))?;
    Ok((inspect_proposal(store, run_id, proposal_id)?, dry_run))
}

fn inspect_apply_dry_run_history(
    store: &BrownieStore,
    run_id: &str,
    proposal_id: &str,
) -> Result<
    (
        WorkspacePatchProposalSummary,
        WorkspacePatchApplyDryRunHistorySummary,
    ),
    String,
> {
    let proposal = inspect_proposal(store, run_id, proposal_id)?;
    let events = read_existing_run_events(store, run_id)?;
    let entries: Vec<WorkspacePatchApplyDryRunHistoryEntry> = events
        .iter()
        .filter(|event| event.kind == LedgerEventKind::WorkspacePatchApplyDryRunChecked)
        .filter_map(|event| sanitize_ledger_payload(event.payload.clone()))
        .filter_map(|payload| dry_run_history_entry_from_payload(&payload))
        .filter(|entry| entry.proposal_id == proposal_id)
        .collect();
    let dry_run_count = entries.len();
    let latest_dry_run = entries.last().cloned();
    let dry_runs = entries
        .iter()
        .rev()
        .take(MAX_DRY_RUN_HISTORY_ENTRIES)
        .cloned()
        .collect();
    let history = WorkspacePatchApplyDryRunHistorySummary {
        proposal_id: proposal_id.to_string(),
        dry_run_count,
        latest_dry_run,
        dry_runs,
        generated_at: now_rfc3339(),
    };
    Ok((proposal, history))
}

fn dry_run_history_entry_from_payload(
    payload: &Value,
) -> Option<WorkspacePatchApplyDryRunHistoryEntry> {
    let no_patch_applied = payload.get("no_patch_applied")?.as_bool()?;
    let apply_executed = payload.get("apply_executed")?.as_bool()?;
    let workspace_files_changed = payload.get("workspace_files_changed")?.as_bool()?;
    if !no_patch_applied || apply_executed || workspace_files_changed {
        return None;
    }
    Some(WorkspacePatchApplyDryRunHistoryEntry {
        proposal_id: payload.get("proposal_id")?.as_str()?.to_string(),
        dry_run_id: payload.get("dry_run_id")?.as_str()?.to_string(),
        dry_run_status: payload.get("dry_run_status")?.as_str()?.to_string(),
        dry_run_reason: payload.get("dry_run_reason")?.as_str()?.to_string(),
        checked_at: payload.get("checked_at")?.as_str()?.to_string(),
        required_gates: string_array_field(payload, "required_gates")?,
        check_count: usize::try_from(payload.get("check_count")?.as_u64()?).ok()?,
        failed_checks: string_array_field(payload, "failed_checks")?,
        blocked_checks: string_array_field(payload, "blocked_checks")?,
        no_patch_applied,
        apply_executed,
        workspace_files_changed,
    })
}

fn string_array_field(payload: &Value, key: &str) -> Option<Vec<String>> {
    payload
        .get(key)?
        .as_array()?
        .iter()
        .map(|value| value.as_str().map(ToString::to_string))
        .collect()
}

fn inspect_proposal_audit_trail(
    store: &BrownieStore,
    run_id: &str,
    proposal_id: &str,
) -> Result<
    (
        WorkspacePatchProposalSummary,
        WorkspacePatchAuditTrailSummary,
    ),
    String,
> {
    let proposal = inspect_proposal(store, run_id, proposal_id)?;
    let events = read_existing_run_events(store, run_id)?;
    let entries: Vec<WorkspacePatchAuditTrailEntry> = events
        .iter()
        .filter_map(|event| audit_entry_from_event(event, proposal_id))
        .collect();
    let event_count = entries.len();
    let latest_event = entries.last().cloned();
    let skip_count = entries.len().saturating_sub(MAX_PROPOSAL_AUDIT_EVENTS);
    let events = entries.into_iter().skip(skip_count).collect();
    let audit_trail = WorkspacePatchAuditTrailSummary {
        proposal_id: proposal_id.to_string(),
        event_count,
        latest_event,
        events,
        generated_at: now_rfc3339(),
    };
    Ok((proposal, audit_trail))
}

fn audit_entry_from_event(
    event: &LedgerEvent,
    proposal_id: &str,
) -> Option<WorkspacePatchAuditTrailEntry> {
    let payload = sanitize_ledger_payload(event.payload.clone())?;
    if payload.get("proposal_id").and_then(Value::as_str) != Some(proposal_id) {
        return None;
    }
    let (audit_event, summary, metadata_keys): (&str, &str, &[&str]) = match event.kind {
        LedgerEventKind::WorkspacePatchProposed => (
            "proposal_created",
            "Proposal created for workspace patch.",
            &[
                "path",
                "operation",
                "content_chars",
                "truncated",
                "validation_status",
                "validation_reason",
                "diff_truncated",
                "diff_redacted",
            ],
        ),
        LedgerEventKind::WorkspacePatchApproved => (
            "proposal_approved",
            "Proposal approved; no patch was applied.",
            &[
                "approval_status",
                "approval_reason",
                "approval_reason_redacted",
                "approved_at",
            ],
        ),
        LedgerEventKind::WorkspacePatchRejected => (
            "proposal_rejected",
            "Proposal rejected; no patch was applied.",
            &[
                "approval_status",
                "approval_reason",
                "approval_reason_redacted",
                "rejected_at",
            ],
        ),
        LedgerEventKind::WorkspacePatchPreflightSnapshotCreated => (
            "preflight_snapshot_created",
            "Preflight snapshot captured for proposal review.",
            &[
                "snapshot_id",
                "path",
                "canonical_path_hash",
                "file_exists",
                "file_kind",
                "file_size_bytes",
                "file_modified_unix_ms",
                "file_sha256",
                "captured_at",
                "stale",
                "stale_reason",
            ],
        ),
        LedgerEventKind::WorkspacePatchApplyPlanCreated => (
            "apply_plan_created",
            "Apply plan summarized without enabling patch application.",
            &["plan_id", "status", "check_count", "failed_checks"],
        ),
        LedgerEventKind::WorkspacePatchReadinessReportCreated => (
            "readiness_checked",
            "Proposal readiness checked.",
            &[
                "report_id",
                "readiness_status",
                "readiness_reason",
                "generated_at",
                "check_count",
                "failed_checks",
                "blocked_checks",
            ],
        ),
        LedgerEventKind::WorkspacePatchApplyCapabilityChecked => (
            "apply_capability_checked",
            "Apply capability checked without enabling patch application.",
            &[
                "capability_id",
                "apply_supported",
                "apply_enabled",
                "mode",
                "required_gates",
                "can_apply_now",
                "checked_at",
                "check_count",
                "failed_checks",
                "blocked_checks",
            ],
        ),
        LedgerEventKind::WorkspacePatchApplyDryRunChecked => (
            "apply_dry_run_checked",
            "Apply dry-run checked without applying a patch or changing workspace files.",
            &[
                "dry_run_id",
                "dry_run_status",
                "dry_run_reason",
                "checked_at",
                "required_gates",
                "check_count",
                "failed_checks",
                "blocked_checks",
                "no_patch_applied",
                "apply_executed",
                "workspace_files_changed",
            ],
        ),
        _ => return None,
    };
    Some(WorkspacePatchAuditTrailEntry {
        proposal_id: proposal_id.to_string(),
        event_id: event.event_id.clone(),
        event_kind: format!("{:?}", event.kind),
        audit_event: audit_event.to_string(),
        timestamp: event.timestamp.clone(),
        summary: summary.to_string(),
        metadata: metadata_from_payload(&payload, metadata_keys),
    })
}

fn metadata_from_payload(payload: &Value, keys: &[&str]) -> Value {
    let mut metadata = serde_json::Map::new();
    for key in keys {
        if let Some(value) = payload.get(*key) {
            metadata.insert((*key).to_string(), value.clone());
        }
    }
    Value::Object(metadata)
}

fn readiness_proposal(
    store: &BrownieStore,
    run_id: &str,
    proposal_id: &str,
) -> Result<
    (
        WorkspacePatchProposalSummary,
        WorkspacePatchReadinessReportSummary,
    ),
    String,
> {
    let task = store
        .tasks()
        .get_task_by_run_id(run_id)
        .map_err(|e| format!("invalid params: {e}"))?
        .ok_or_else(|| "invalid params: run not found".to_string())?;
    let proposal = inspect_proposal(store, run_id, proposal_id)?;
    let snapshot = proposal.latest_snapshot.as_ref();
    let mut checklist = vec![readiness_check("proposal_exists", "Pass", None)];

    if proposal.validation_status == "Blocked" {
        checklist.push(readiness_check(
            "proposal_is_valid",
            "Blocked",
            proposal.validation_reason.as_deref(),
        ));
    } else if proposal.validation_status == "Valid" {
        checklist.push(readiness_check("proposal_is_valid", "Pass", None));
    } else {
        checklist.push(readiness_check(
            "proposal_is_valid",
            "Fail",
            proposal
                .validation_reason
                .as_deref()
                .or(Some("Proposal validation status is not Valid.")),
        ));
    }

    checklist.push(if proposal.approval_status == "Approved" {
        readiness_check("proposal_is_approved", "Pass", None)
    } else {
        readiness_check(
            "proposal_is_approved",
            "Fail",
            Some("Proposal is not approved."),
        )
    });
    checklist.push(if snapshot.is_some() {
        readiness_check("proposal_has_preflight_snapshot", "Pass", None)
    } else {
        readiness_check(
            "proposal_has_preflight_snapshot",
            "Fail",
            Some("Run proposal.preflight before final review."),
        )
    });
    checklist.push(match snapshot {
        Some(snapshot) if !snapshot.stale => readiness_check("proposal_not_stale", "Pass", None),
        Some(snapshot) => readiness_check(
            "proposal_not_stale",
            "Fail",
            snapshot
                .stale_reason
                .as_deref()
                .or(Some("Latest preflight snapshot is stale.")),
        ),
        None => readiness_check(
            "proposal_not_stale",
            "Skipped",
            Some("No preflight snapshot is available."),
        ),
    });
    checklist.push(match snapshot {
        Some(snapshot) if snapshot.file_exists => {
            readiness_check("target_file_exists", "Pass", None)
        }
        Some(_) => readiness_check(
            "target_file_exists",
            "Fail",
            Some("Target file was missing at preflight."),
        ),
        None => readiness_check(
            "target_file_exists",
            "Skipped",
            Some("No preflight snapshot is available."),
        ),
    });
    checklist.push(match snapshot {
        Some(snapshot) if snapshot.file_kind == "File" => {
            readiness_check("target_file_regular", "Pass", None)
        }
        Some(snapshot) if snapshot.file_kind == "Unreadable" => readiness_check(
            "target_file_regular",
            "Blocked",
            Some("Target file was unreadable at preflight."),
        ),
        Some(_) => readiness_check(
            "target_file_regular",
            "Fail",
            Some("Target path is not a regular file."),
        ),
        None => readiness_check(
            "target_file_regular",
            "Skipped",
            Some("No preflight snapshot is available."),
        ),
    });
    checklist.push(match snapshot {
        Some(snapshot) if snapshot.file_sha256.is_some() => {
            readiness_check("target_file_hash_available", "Pass", None)
        }
        Some(_) => readiness_check(
            "target_file_hash_available",
            "Fail",
            Some("Target file hash is unavailable."),
        ),
        None => readiness_check(
            "target_file_hash_available",
            "Skipped",
            Some("No preflight snapshot is available."),
        ),
    });
    checklist.push(if proposal.diff_preview.is_some() {
        readiness_check("diff_preview_available", "Pass", None)
    } else {
        readiness_check(
            "diff_preview_available",
            "Fail",
            Some("Sanitized diff preview is unavailable."),
        )
    });
    checklist.push(if proposal.diff_redacted {
        readiness_check(
            "diff_not_redacted",
            "Blocked",
            Some("Diff preview was redacted."),
        )
    } else {
        readiness_check("diff_not_redacted", "Pass", None)
    });
    let sensitive = proposal.validation_status == "Blocked"
        || proposal.diff_redacted
        || proposal.content_preview == "[redacted]";
    checklist.push(if sensitive {
        readiness_check(
            "no_sensitive_content_detected",
            "Blocked",
            Some("Sensitive-like content was detected or redacted."),
        )
    } else {
        readiness_check("no_sensitive_content_detected", "Pass", None)
    });
    checklist.push(readiness_check("no_raw_content_exposed", "Pass", None));
    checklist.push(readiness_check(
        "apply_not_implemented",
        "Skipped",
        Some("Patch apply is not implemented in Phase 3.4."),
    ));

    let blocked_checks: Vec<String> = checklist
        .iter()
        .filter(|c| c.status == "Blocked")
        .map(|c| c.name.clone())
        .collect();
    let failed_checks: Vec<String> = checklist
        .iter()
        .filter(|c| c.status == "Fail")
        .map(|c| c.name.clone())
        .collect();
    let (readiness_status, readiness_reason, summary) = if !blocked_checks.is_empty() {
        ("Blocked", Some("Proposal or target file contains sensitive-like content; sanitized preview is unavailable."), "Blocked. Proposal or target file contains sensitive-like content; sanitized preview is unavailable.")
    } else if !failed_checks.is_empty() {
        let stale = failed_checks
            .iter()
            .any(|name| name == "proposal_not_stale");
        let reason = if stale {
            "Latest preflight snapshot is stale; rerun proposal.preflight before review."
        } else {
            "Proposal is missing required approval, validation, preflight, target hash, or sanitized diff preview."
        };
        (
            "NotReady",
            Some(reason),
            if stale {
                "Not ready for final human review. Latest preflight snapshot is stale; rerun proposal.preflight before review."
            } else {
                "Not ready for final human review. Proposal is missing required approval, validation, preflight, target hash, or sanitized diff preview."
            },
        )
    } else {
        ("Ready", None, "Ready for final human review. Proposal is approved, latest preflight is fresh, target file hash is captured, and a sanitized diff preview is available. Patch apply is not implemented in Phase 3.4.")
    };
    let generated_at = now_rfc3339();
    let report_id = format!("report_{}", uuid::Uuid::new_v4().simple());
    let report = WorkspacePatchReadinessReportSummary {
        proposal_id: proposal_id.to_string(),
        report_id: report_id.clone(),
        readiness_status: readiness_status.to_string(),
        readiness_reason: readiness_reason.map(ToString::to_string),
        generated_at: generated_at.clone(),
        checklist,
        summary: summary.to_string(),
    };
    store
        .tasks()
        .append_task_event_with_payload(
            &task,
            LedgerEventKind::WorkspacePatchReadinessReportCreated,
            Some(json!({
                "proposal_id": proposal_id,
                "report_id": report_id,
                "readiness_status": readiness_status,
                "readiness_reason": report.readiness_reason,
                "generated_at": generated_at,
                "check_count": report.checklist.len(),
                "failed_checks": failed_checks,
                "blocked_checks": blocked_checks,
            })),
        )
        .map_err(|e| format!("invalid params: {e}"))?;
    Ok((inspect_proposal(store, run_id, proposal_id)?, report))
}

fn preflight_proposal(
    store: &BrownieStore,
    run_id: &str,
    proposal_id: &str,
) -> Result<
    (
        WorkspacePatchProposalSummary,
        WorkspacePatchPreflightSnapshotSummary,
        WorkspacePatchApplyPlanSummary,
    ),
    String,
> {
    let task = store
        .tasks()
        .get_task_by_run_id(run_id)
        .map_err(|e| format!("invalid params: {e}"))?
        .ok_or_else(|| "invalid params: run not found".to_string())?;
    let proposal = inspect_proposal(store, run_id, proposal_id)?;
    if proposal.approval_status != "Approved" {
        return Err("invalid params: proposal must be approved".to_string());
    }
    if proposal.validation_status != "Valid" {
        return Err("invalid params: proposal must be valid".to_string());
    }
    let events = read_existing_run_events(store, run_id)?;
    let previous = latest_snapshot(&events, proposal_id);
    let snapshot = capture_preflight_snapshot(store, &proposal, previous.as_ref())?;
    let plan_id = format!("plan_{}", uuid::Uuid::new_v4().simple());
    let apply_plan = build_apply_plan_summary(proposal_id, &plan_id, "Blocked");
    store
        .tasks()
        .append_task_event_with_payload(
            &task,
            LedgerEventKind::WorkspacePatchPreflightSnapshotCreated,
            Some(json!(snapshot)),
        )
        .map_err(|e| format!("invalid params: {e}"))?;
    store
        .tasks()
        .append_task_event_with_payload(
            &task,
            LedgerEventKind::WorkspacePatchApplyPlanCreated,
            Some(json!({
                "proposal_id": proposal_id,
                "plan_id": plan_id,
                "status": "Blocked",
                "check_count": apply_plan.checklist.len(),
                "failed_checks": ["apply_not_enabled"],
            })),
        )
        .map_err(|e| format!("invalid params: {e}"))?;
    Ok((
        inspect_proposal(store, run_id, proposal_id)?,
        snapshot,
        apply_plan,
    ))
}

fn capture_preflight_snapshot(
    store: &BrownieStore,
    proposal: &WorkspacePatchProposalSummary,
    previous: Option<&WorkspacePatchPreflightSnapshotSummary>,
) -> Result<WorkspacePatchPreflightSnapshotSummary, String> {
    brownie_tools::preflight_workspace_write_path(&proposal.path)
        .map_err(|_| "invalid params: target path is not safe".to_string())?;
    let root = store
        .workspace_root()
        .canonicalize()
        .map_err(|_| "invalid params: workspace root is not accessible".to_string())?;
    if std::path::Path::new(&proposal.path)
        .components()
        .any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err("invalid params: target path is not safe".to_string());
    }
    let target = root.join(&proposal.path);
    let canonical_for_hash = target.canonicalize().unwrap_or(target.clone());
    if canonical_for_hash.exists() && !canonical_for_hash.starts_with(&root) {
        return Err("invalid params: target path escapes workspace root".to_string());
    }
    let canonical_path_hash = format!(
        "sha256:{}",
        hex_sha256(canonical_for_hash.to_string_lossy().as_bytes())
    );
    let captured_at = now_rfc3339();
    let snapshot_id = format!("snapshot_{}", uuid::Uuid::new_v4().simple());
    let metadata = std::fs::metadata(&target);
    let (file_exists, mut file_kind, file_size_bytes, file_modified_unix_ms, mut file_sha256) =
        match metadata {
            Ok(metadata) => {
                let kind = if metadata.is_file() {
                    "File"
                } else if metadata.is_dir() {
                    "Directory"
                } else {
                    "Other"
                };
                let modified = metadata.modified().ok().and_then(system_time_unix_ms);
                let hash = if metadata.is_file() {
                    std::fs::read(&target)
                        .ok()
                        .map(|bytes| format!("sha256:{}", hex_sha256(&bytes)))
                } else {
                    None
                };
                (true, kind.to_string(), Some(metadata.len()), modified, hash)
            }
            Err(_) => (false, "Missing".to_string(), None, None, None),
        };
    if file_exists && file_kind == "File" && file_sha256.is_none() {
        file_kind = "Unreadable".to_string();
    }
    if file_sha256
        .as_deref()
        .is_some_and(|hash| scan_text_for_sensitive_content(hash))
    {
        file_sha256 = None;
    }
    let stale = previous.is_some_and(|prev| {
        prev.file_sha256 != file_sha256
            || prev.file_size_bytes != file_size_bytes
            || prev.file_modified_unix_ms != file_modified_unix_ms
    });
    Ok(WorkspacePatchPreflightSnapshotSummary {
        proposal_id: proposal.proposal_id.clone(),
        snapshot_id,
        path: proposal.path.clone(),
        canonical_path_hash,
        file_exists,
        file_kind,
        file_size_bytes,
        file_modified_unix_ms,
        file_sha256,
        captured_at,
        stale,
        stale_reason: stale
            .then(|| "target file metadata changed since previous preflight".to_string()),
    })
}

fn hex_sha256(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn system_time_unix_ms(time: std::time::SystemTime) -> Option<i64> {
    time.duration_since(std::time::UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
}

fn inspect_proposal(
    store: &BrownieStore,
    run_id: &str,
    proposal_id: &str,
) -> Result<WorkspacePatchProposalSummary, String> {
    list_proposals(store, run_id)?
        .into_iter()
        .find(|proposal| proposal.proposal_id == proposal_id)
        .ok_or_else(|| "invalid params: proposal not found".to_string())
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
        "finding_count",
        "categories",
        "message_indexes",
        "sensitive_guard",
        "prompt_preview_redacted",
        "parser",
        "code",
        "input_summary",
        "proposal_id",
        "operation",
        "path",
        "content_chars",
        "validation_status",
        "validation_reason",
        "diff_preview",
        "diff_truncated",
        "diff_redacted",
        "approval_status",
        "approval_reason",
        "approval_reason_redacted",
        "approved_at",
        "rejected_at",
        "snapshot_id",
        "canonical_path_hash",
        "file_exists",
        "file_kind",
        "file_size_bytes",
        "file_modified_unix_ms",
        "file_sha256",
        "captured_at",
        "stale",
        "stale_reason",
        "plan_id",
        "capability_id",
        "apply_supported",
        "apply_enabled",
        "mode",
        "required_gates",
        "can_apply_now",
        "checked_at",
        "dry_run_id",
        "dry_run_status",
        "dry_run_reason",
        "no_patch_applied",
        "apply_executed",
        "workspace_files_changed",
        "report_id",
        "readiness_status",
        "readiness_reason",
        "generated_at",
        "check_count",
        "failed_checks",
        "blocked_checks",
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
            "proposal_id",
            "operation",
            "path",
            "content_chars",
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
        input_summary: tool_intent_input_summary(&decision.input),
    }
}

fn tool_intent_rejected_summary(rejected: RejectedToolIntent) -> ToolIntentRejectedSummary {
    ToolIntentRejectedSummary {
        tool_id: rejected.tool_id,
        reason: rejected.reason,
        code: rejected.code,
    }
}

fn tool_intent_parser_summary(
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

fn tool_intent_parser_config_summary() -> ToolIntentParserConfigSummary {
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

fn tool_intent_input_summary(input: &Value) -> ToolIntentInputSummary {
    ToolIntentInputSummary {
        has_path: input.get("path").and_then(Value::as_str).is_some(),
        field_count: input.as_object().map(|object| object.len()).unwrap_or(0),
    }
}

fn summarize_intent_input(input: &Value) -> Value {
    json!(tool_intent_input_summary(input))
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
            "parser": parsed.summary,
        })),
    )?;
    let evaluation = ToolIntentEvaluator::evaluate(policy, parsed);
    for rejected in evaluation.rejected {
        store.tasks().append_task_event_with_payload(
            record,
            LedgerEventKind::ToolIntentRejected,
            Some(json!({ "tool_id": rejected.tool_id, "reason": rejected.reason, "code": rejected.code })),
        )?;
    }
    for decision in evaluation.items {
        let payload = json!({
            "tool_id": decision.tool_id,
            "required_action": runtime_action_name(&decision.required_action),
            "allowed": decision.allowed,
            "reason": decision.reason,
            "request_reason": decision.request_reason,
            "input_summary": summarize_intent_input(&decision.input),
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

fn handle_approved_workspace_intents(
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
        if !decision.allowed {
            continue;
        }
        if decision.tool_id == WORKSPACE_WRITE_TOOL_ID {
            append_workspace_patch_proposal(store, record, &decision)?;
            continue;
        }
        if decision.tool_id != WORKSPACE_READ_TOOL_ID {
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

fn append_workspace_patch_proposal(
    store: &BrownieStore,
    record: &brownie_protocol::TaskRecord,
    decision: &ToolIntentDecision,
) -> anyhow::Result<()> {
    let path = decision
        .input
        .get("path")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let content = decision
        .input
        .get("content")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let proposal = build_workspace_patch_proposal(store, path, content);
    store.tasks().append_task_event_with_payload(
        record,
        LedgerEventKind::WorkspacePatchProposed,
        Some(json!({
            "proposal_id": format!("proposal_{}", uuid::Uuid::new_v4().simple()),
            "tool_id": WORKSPACE_WRITE_TOOL_ID,
            "path": path,
            "operation": WorkspacePatchOperation::ReplaceFile.as_str(),
            "content_preview": proposal.content_preview,
            "content_chars": proposal.content_chars,
            "truncated": proposal.truncated,
            "validation_status": proposal.validation_status,
            "validation_reason": proposal.validation_reason,
            "diff_preview": proposal.diff_preview,
            "diff_truncated": proposal.diff_truncated,
            "diff_redacted": proposal.diff_redacted,
        })),
    )?;
    Ok(())
}

struct ProposalBuildResult {
    content_preview: String,
    content_chars: usize,
    truncated: bool,
    validation_status: &'static str,
    validation_reason: Option<&'static str>,
    diff_preview: Option<String>,
    diff_truncated: bool,
    diff_redacted: bool,
}

fn build_workspace_patch_proposal(
    store: &BrownieStore,
    path: &str,
    content: &str,
) -> ProposalBuildResult {
    let content_chars = content.chars().count();
    let mut result = ProposalBuildResult {
        content_preview: preview_with_limit(content, DEFAULT_PROPOSAL_PREVIEW_CHARS),
        content_chars,
        truncated: content_chars
            > preview_with_limit(content, DEFAULT_PROPOSAL_PREVIEW_CHARS)
                .chars()
                .count(),
        validation_status: "Valid",
        validation_reason: None,
        diff_preview: None,
        diff_truncated: false,
        diff_redacted: false,
    };
    if scan_text_for_sensitive_content(content) {
        result.content_preview = "[redacted]".to_string();
        result.validation_status = "Blocked";
        result.validation_reason = Some("proposal content contains sensitive-like data");
        result.diff_preview = None;
        result.diff_redacted = true;
        return result;
    }
    if brownie_tools::preflight_workspace_write_path(path).is_err() {
        result.validation_status = "Invalid";
        result.validation_reason = Some("path is not a safe workspace-relative path");
        return result;
    }
    let Ok(root) = store.workspace_root().canonicalize() else {
        result.validation_status = "Invalid";
        result.validation_reason = Some("workspace root is not accessible");
        return result;
    };
    let target = root.join(path);
    let Ok(canonical_target) = target.canonicalize() else {
        result.validation_status = "Invalid";
        result.validation_reason = Some("target file does not exist");
        return result;
    };
    if !canonical_target.starts_with(&root) {
        result.validation_status = "Invalid";
        result.validation_reason = Some("target path escapes workspace root");
        return result;
    }
    let Ok(metadata) = std::fs::metadata(&canonical_target) else {
        result.validation_status = "Invalid";
        result.validation_reason = Some("target file does not exist");
        return result;
    };
    if !metadata.is_file() {
        result.validation_status = "Invalid";
        result.validation_reason = Some("target path is not a file");
        return result;
    }
    let Ok(existing) = std::fs::read_to_string(&canonical_target) else {
        result.validation_status = "Invalid";
        result.validation_reason = Some("target file is not UTF-8");
        return result;
    };
    if scan_text_for_sensitive_content(&existing) {
        result.validation_status = "Blocked";
        result.validation_reason = Some("target file contains sensitive-like data");
        result.diff_redacted = true;
        return result;
    }
    let diff = synthetic_unified_diff(path, &existing, content);
    result.diff_truncated =
        diff.chars().count() > DEFAULT_DIFF_PREVIEW_CHARS.min(MAX_DIFF_PREVIEW_CHARS);
    result.diff_preview = Some(preview_with_limit(
        &diff,
        DEFAULT_DIFF_PREVIEW_CHARS.min(MAX_DIFF_PREVIEW_CHARS),
    ));
    result
}

fn scan_text_for_sensitive_content(content: &str) -> bool {
    !scan_prompt_for_sensitive_content(&[LlmMessage {
        role: "user".to_string(),
        content: content.to_string(),
    }])
    .findings
    .is_empty()
}

fn synthetic_unified_diff(path: &str, old: &str, new: &str) -> String {
    let old_lines: Vec<&str> = old.lines().collect();
    let new_lines: Vec<&str> = new.lines().collect();
    let mut diff = format!(
        "--- a/{path}\n+++ b/{path}\n@@ -1,{} +1,{} @@\n",
        old_lines.len(),
        new_lines.len()
    );
    for line in old_lines {
        diff.push('-');
        diff.push_str(line);
        diff.push('\n');
    }
    for line in new_lines {
        diff.push('+');
        diff.push_str(line);
        diff.push('\n');
    }
    diff
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

fn prompt_built_payload(
    message_count: usize,
    prompt: &brownie_context::PromptView,
    response_preview_chars: usize,
    max_prompt_chars: usize,
    sensitive_scan: &PromptSensitiveScanResult,
) -> Value {
    let mut payload = serde_json::Map::new();
    payload.insert("message_count".to_string(), json!(message_count));
    payload.insert("max_prompt_chars".to_string(), json!(max_prompt_chars));
    if sensitive_scan.findings.is_empty() {
        payload.insert(
            "prompt_preview".to_string(),
            json!(preview_prompt(prompt, response_preview_chars)),
        );
    } else {
        payload.insert("prompt_preview_redacted".to_string(), json!(true));
    }
    Value::Object(payload)
}

fn preview_prompt(prompt: &brownie_context::PromptView, max_chars: usize) -> String {
    let joined = prompt
        .messages
        .iter()
        .map(|message| message.content.as_str())
        .collect::<Vec<_>>()
        .join("\n---\n");
    preview_with_limit(&joined, max_chars)
}

fn preview_with_limit(content: &str, max_chars: usize) -> String {
    content.chars().take(max_chars).collect()
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

    pub(super) fn parse_line(line: &str) -> JsonRpcResponse<Value> {
        serde_json::from_str(&handle_jsonrpc_input_line(line).expect("response line"))
            .expect("valid response")
    }

    fn append_test_patch_proposal(
        store: &BrownieStore,
        record: &TaskRecord,
        proposal_id: &str,
        validation_status: &str,
        diff_preview: Option<&str>,
        diff_redacted: bool,
    ) {
        store
            .tasks()
            .append_task_event_with_payload(
                record,
                LedgerEventKind::WorkspacePatchProposed,
                Some(json!({
                    "proposal_id": proposal_id,
                    "tool_id": WORKSPACE_WRITE_TOOL_ID,
                    "path": "README.md",
                    "operation": WorkspacePatchOperation::ReplaceFile.as_str(),
                    "content_preview": if validation_status == "Blocked" { "[redacted]" } else { "updated README" },
                    "content_chars": 14,
                    "truncated": false,
                    "validation_status": validation_status,
                    "validation_reason": if validation_status == "Blocked" { Some("proposed content contains sensitive-like data") } else { None },
                    "diff_preview": diff_preview,
                    "diff_truncated": false,
                    "diff_redacted": diff_redacted,
                })),
            )
            .expect("append proposal");
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
        std::env::remove_var("BROWNIE_LLM_ALLOW_TASK_RUN_NETWORK");
        let response =
            handle_jsonrpc_input_line(r#"{"jsonrpc":"2.0","id":1,"method":"llm.status"}"#).unwrap();
        assert!(response.contains(r#""provider":"Fake""#));
        assert!(response.contains(r#""enabled":true"#));
        assert!(response.contains(r#""model":"brownie-fake-llm""#));
        assert!(response.contains(r#""strict":false"#));
        assert!(response.contains(r#""will_fallback_to_fake":false"#));
        assert!(response.contains(r#""task_run_network_allowed":false"#));
    }

    #[test]
    fn llm_status_reports_task_run_network_allowed_when_guard_true() {
        let _guard = ENV_LOCK.lock().expect("env lock");
        std::env::remove_var("BROWNIE_LLM_PROVIDER");
        std::env::set_var("BROWNIE_LLM_ALLOW_TASK_RUN_NETWORK", "true");
        let response =
            handle_jsonrpc_input_line(r#"{"jsonrpc":"2.0","id":1,"method":"llm.status"}"#).unwrap();
        assert!(response.contains(r#""task_run_network_allowed":true"#));
        std::env::remove_var("BROWNIE_LLM_ALLOW_TASK_RUN_NETWORK");
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
    fn implementer_workspace_write_creates_proposal_without_modifying_file() {
        let _guard = ENV_LOCK.lock().expect("env lock");
        let temp = tempfile::tempdir().expect("tempdir");
        std::fs::write(temp.path().join("README.md"), "original README").expect("write readme");
        std::env::set_var("BROWNIE_WORKSPACE_ROOT", temp.path());
        std::env::remove_var("BROWNIE_LLM_PROVIDER");
        std::env::remove_var("BROWNIE_LLM_STRICT");

        let start = parse_line(
            r#"{"jsonrpc":"2.0","id":1,"method":"task.start","params":{"goal":"Implement README update","mode_id":"implementer"}}"#,
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
        assert_eq!(
            std::fs::read_to_string(temp.path().join("README.md")).unwrap(),
            "original README"
        );

        let events = parse_line(&format!(
            r#"{{"jsonrpc":"2.0","id":3,"method":"run.events","params":{{"run_id":"{run_id}"}}}}"#
        ));
        let events = events.result.expect("events result")["events"]
            .as_array()
            .unwrap()
            .clone();
        let proposal = events
            .iter()
            .find(|event| event["kind"] == "WorkspacePatchProposed")
            .expect("proposal event");
        let payload = &proposal["payload"];
        assert_eq!(payload["tool_id"], "workspace.write");
        assert_eq!(payload["path"], "README.md");
        assert_eq!(payload["operation"], "replace_file");
        assert!(payload.get("content_preview").is_some());
        assert!(payload.get("content_chars").is_some());
        assert_eq!(payload["validation_status"], "Valid");
        assert!(payload["diff_preview"]
            .as_str()
            .unwrap()
            .contains("--- a/README.md"));
        assert_eq!(payload["diff_truncated"], false);
        assert_eq!(payload["diff_redacted"], false);
        assert!(payload.get("content").is_none());
        assert!(payload.get("raw_content").is_none());
        assert!(payload.get("patch").is_none());
        assert!(payload.get("diff").is_none());
        assert!(payload.get("raw_input").is_none());

        let list = parse_line(&format!(
            r#"{{"jsonrpc":"2.0","id":4,"method":"proposal.list","params":{{"run_id":"{run_id}"}}}}"#
        ));
        let proposals = list.result.expect("proposal result")["proposals"]
            .as_array()
            .unwrap()
            .clone();
        assert_eq!(proposals.len(), 1);
        assert_eq!(proposals[0]["approval_status"], "Pending");
        let proposal_id = proposals[0]["proposal_id"].as_str().unwrap();
        let inspect = parse_line(&format!(
            r#"{{"jsonrpc":"2.0","id":5,"method":"proposal.inspect","params":{{"run_id":"{run_id}","proposal_id":"{proposal_id}"}}}}"#
        ));
        assert_eq!(
            inspect.result.expect("inspect result")["proposal"]["proposal_id"],
            proposal_id
        );
        let approve = parse_line(&format!(
            r#"{{"jsonrpc":"2.0","id":6,"method":"proposal.approve","params":{{"run_id":"{run_id}","proposal_id":"{proposal_id}","reason":"looks correct sk-test-secret"}}}}"#
        ));
        let approve_result = approve.result.expect("approve result");
        assert_eq!(approve_result["proposal"]["approval_status"], "Approved");
        assert_eq!(approve_result["proposal"]["approval_reason"], "[redacted]");
        assert_eq!(approve_result["proposal"]["approval_reason_redacted"], true);
        assert_eq!(
            approve_result["apply_plan"]["checklist"]
                .as_array()
                .unwrap()
                .iter()
                .find(|check| check["name"] == "apply_not_enabled")
                .unwrap()["status"],
            "Fail"
        );
        assert_eq!(
            std::fs::read_to_string(temp.path().join("README.md")).unwrap(),
            "original README"
        );
        let preflight = parse_line(&format!(
            r#"{{"jsonrpc":"2.0","id":7,"method":"proposal.preflight","params":{{"run_id":"{run_id}","proposal_id":"{proposal_id}"}}}}"#
        ));
        let preflight_result = preflight.result.expect("preflight result");
        assert_eq!(preflight_result["snapshot"]["path"], "README.md");
        assert_eq!(preflight_result["snapshot"]["file_kind"], "File");
        assert!(preflight_result["snapshot"]["file_sha256"]
            .as_str()
            .unwrap()
            .starts_with("sha256:"));
        assert!(preflight_result["snapshot"]["canonical_path_hash"]
            .as_str()
            .unwrap()
            .starts_with("sha256:"));
        assert_eq!(preflight_result["snapshot"]["stale"], false);
        assert_eq!(
            preflight_result["proposal"]["latest_snapshot"]["snapshot_id"],
            preflight_result["snapshot"]["snapshot_id"]
        );
        let ready = parse_line(&format!(
            r#"{{"jsonrpc":"2.0","id":71,"method":"proposal.readiness","params":{{"run_id":"{run_id}","proposal_id":"{proposal_id}"}}}}"#
        ));
        let ready_result = ready.result.expect("ready result");
        assert_eq!(ready_result["report"]["readiness_status"], "Ready");
        assert_eq!(
            ready_result["report"]["checklist"]
                .as_array()
                .unwrap()
                .iter()
                .find(|check| check["name"] == "apply_not_implemented")
                .unwrap()["status"],
            "Skipped"
        );
        assert_eq!(
            std::fs::read_to_string(temp.path().join("README.md")).unwrap(),
            "original README"
        );
        let capability = parse_line(&format!(
            r#"{{"jsonrpc":"2.0","id":72,"method":"proposal.applyCapability","params":{{"run_id":"{run_id}","proposal_id":"{proposal_id}"}}}}"#
        ));
        let capability_result = capability.result.expect("capability result");
        assert_eq!(capability_result["capability"]["apply_supported"], false);
        assert_eq!(capability_result["capability"]["apply_enabled"], false);
        assert_eq!(capability_result["capability"]["mode"], "dry_run_only");
        assert_eq!(
            capability_result["capability"]["reason"],
            "Patch apply is not implemented in Phase 3.5."
        );
        assert_eq!(capability_result["capability"]["can_apply_now"], false);
        assert!(capability_result["capability"]["required_gates"]
            .as_array()
            .unwrap()
            .iter()
            .any(|gate| gate == "runtime_apply_supported"));
        assert_eq!(
            capability_result["capability"]["check_count"],
            capability_result["capability"]["checklist"]
                .as_array()
                .unwrap()
                .len()
        );
        assert_eq!(
            capability_result["capability"]["checklist"]
                .as_array()
                .unwrap()
                .iter()
                .find(|check| check["name"] == "apply_execution_disabled")
                .unwrap()["status"],
            "Blocked"
        );
        assert!(capability_result["capability"]["blocked_checks"]
            .as_array()
            .unwrap()
            .iter()
            .any(|check| check == "apply_execution_disabled"));
        let serialized_capability =
            serde_json::to_string(&capability_result["capability"]).unwrap();
        for forbidden in [
            "content",
            "raw_content",
            "full_content",
            "patch",
            "diff",
            "raw_input",
            "canonical_path",
            "absolute_path",
            "file_content",
            "original README",
        ] {
            assert!(!serialized_capability.contains(&format!(r#"\"{forbidden}\""#)));
        }
        assert_eq!(
            std::fs::read_to_string(temp.path().join("README.md")).unwrap(),
            "original README"
        );
        let dry_run = parse_line(&format!(
            r#"{{"jsonrpc":"2.0","id":73,"method":"proposal.applyDryRun","params":{{"run_id":"{run_id}","proposal_id":"{proposal_id}"}}}}"#
        ));
        let dry_run_result = dry_run.result.expect("apply dry-run result");
        assert_eq!(dry_run_result["dry_run"]["dry_run_status"], "Completed");
        assert_eq!(
            dry_run_result["dry_run"]["dry_run_reason"],
            "Dry run completed without applying a patch or changing workspace files."
        );
        assert_eq!(dry_run_result["dry_run"]["no_patch_applied"], true);
        assert_eq!(dry_run_result["dry_run"]["apply_executed"], false);
        assert_eq!(dry_run_result["dry_run"]["workspace_files_changed"], false);
        assert!(dry_run_result["dry_run"]["required_gates"]
            .as_array()
            .unwrap()
            .iter()
            .any(|gate| gate == "readiness_ready"));
        assert_eq!(
            dry_run_result["dry_run"]["check_count"],
            dry_run_result["dry_run"]["checklist"]
                .as_array()
                .unwrap()
                .len()
        );
        assert_eq!(
            dry_run_result["dry_run"]["checklist"]
                .as_array()
                .unwrap()
                .iter()
                .find(|check| check["name"] == "readiness_ready")
                .unwrap()["status"],
            "Pass"
        );
        assert_eq!(
            dry_run_result["dry_run"]["checklist"]
                .as_array()
                .unwrap()
                .iter()
                .find(|check| check["name"] == "apply_execution_disabled")
                .unwrap()["status"],
            "Blocked"
        );
        assert!(dry_run_result["dry_run"]["blocked_checks"]
            .as_array()
            .unwrap()
            .iter()
            .any(|check| check == "apply_execution_disabled"));
        let serialized_dry_run = serde_json::to_string(&dry_run_result["dry_run"]).unwrap();
        for forbidden in [
            "content",
            "raw_content",
            "full_content",
            "patch",
            "diff",
            "raw_input",
            "canonical_path",
            "absolute_path",
            "file_content",
            "original README",
        ] {
            assert!(!serialized_dry_run.contains(&format!(r#"\"{forbidden}\""#)));
        }
        assert_eq!(
            std::fs::read_to_string(temp.path().join("README.md")).unwrap(),
            "original README"
        );
        let second_dry_run = parse_line(&format!(
            r#"{{"jsonrpc":"2.0","id":731,"method":"proposal.applyDryRun","params":{{"run_id":"{run_id}","proposal_id":"{proposal_id}"}}}}"#
        ));
        let second_dry_run_result = second_dry_run.result.expect("second apply dry-run result");
        assert_ne!(
            second_dry_run_result["dry_run"]["dry_run_id"],
            dry_run_result["dry_run"]["dry_run_id"]
        );
        assert_eq!(second_dry_run_result["dry_run"]["no_patch_applied"], true);
        assert_eq!(second_dry_run_result["dry_run"]["apply_executed"], false);
        assert_eq!(
            second_dry_run_result["dry_run"]["workspace_files_changed"],
            false
        );
        let events_before_history = parse_line(&format!(
            r#"{{"jsonrpc":"2.0","id":732,"method":"run.events","params":{{"run_id":"{run_id}"}}}}"#
        ));
        let events_before_history = events_before_history.result.expect("events before history")
            ["events"]
            .as_array()
            .unwrap()
            .clone();
        let history = parse_line(&format!(
            r#"{{"jsonrpc":"2.0","id":733,"method":"proposal.applyDryRunHistory","params":{{"run_id":"{run_id}","proposal_id":"{proposal_id}"}}}}"#
        ));
        let history_result = history.result.expect("apply dry-run history result");
        assert_eq!(history_result["history"]["proposal_id"], proposal_id);
        assert_eq!(history_result["history"]["dry_run_count"], 2);
        assert_eq!(
            history_result["history"]["latest_dry_run"]["dry_run_id"],
            second_dry_run_result["dry_run"]["dry_run_id"]
        );
        let dry_run_history = history_result["history"]["dry_runs"].as_array().unwrap();
        assert_eq!(dry_run_history.len(), 2);
        assert_eq!(
            dry_run_history[0]["dry_run_id"],
            second_dry_run_result["dry_run"]["dry_run_id"]
        );
        assert_eq!(
            dry_run_history[1]["dry_run_id"],
            dry_run_result["dry_run"]["dry_run_id"]
        );
        for entry in dry_run_history {
            assert_eq!(entry["no_patch_applied"], true);
            assert_eq!(entry["apply_executed"], false);
            assert_eq!(entry["workspace_files_changed"], false);
            assert!(entry["required_gates"]
                .as_array()
                .unwrap()
                .iter()
                .any(|gate| gate == "runtime_apply_supported"));
        }
        let serialized_history = serde_json::to_string(&history_result["history"]).unwrap();
        for forbidden in [
            "content",
            "raw_content",
            "full_content",
            "patch",
            "diff",
            "raw_input",
            "canonical_path",
            "absolute_path",
            "file_content",
            "original README",
        ] {
            assert!(!serialized_history.contains(&format!(r#"\"{forbidden}\""#)));
        }
        assert_eq!(
            std::fs::read_to_string(temp.path().join("README.md")).unwrap(),
            "original README"
        );
        let events_after_history = parse_line(&format!(
            r#"{{"jsonrpc":"2.0","id":734,"method":"run.events","params":{{"run_id":"{run_id}"}}}}"#
        ));
        let events_after_history = events_after_history.result.expect("events after history")
            ["events"]
            .as_array()
            .unwrap()
            .clone();
        assert_eq!(events_after_history.len(), events_before_history.len());
        assert_eq!(
            events_after_history
                .iter()
                .filter(|event| event["kind"] == "WorkspacePatchApplyDryRunChecked")
                .count(),
            2
        );
        let audit = parse_line(&format!(
            r#"{{"jsonrpc":"2.0","id":735,"method":"proposal.auditTrail","params":{{"run_id":"{run_id}","proposal_id":"{proposal_id}"}}}}"#
        ));
        let audit_result = audit.result.expect("proposal audit trail result");
        assert_eq!(audit_result["audit_trail"]["proposal_id"], proposal_id);
        assert_eq!(audit_result["audit_trail"]["event_count"], 9);
        assert_eq!(
            audit_result["audit_trail"]["latest_event"]["audit_event"],
            "apply_dry_run_checked"
        );
        assert_eq!(
            audit_result["audit_trail"]["latest_event"]["metadata"]["dry_run_id"],
            second_dry_run_result["dry_run"]["dry_run_id"]
        );
        let audit_events = audit_result["audit_trail"]["events"].as_array().unwrap();
        assert_eq!(audit_events.len(), 9);
        let audit_kinds: Vec<&str> = audit_events
            .iter()
            .map(|event| event["audit_event"].as_str().unwrap())
            .collect();
        assert_eq!(
            audit_kinds,
            vec![
                "proposal_created",
                "proposal_approved",
                "apply_plan_created",
                "preflight_snapshot_created",
                "apply_plan_created",
                "readiness_checked",
                "apply_capability_checked",
                "apply_dry_run_checked",
                "apply_dry_run_checked",
            ]
        );
        assert_eq!(
            audit_events
                .iter()
                .find(|event| event["audit_event"] == "proposal_created")
                .unwrap()["metadata"]["path"],
            "README.md"
        );
        assert_eq!(
            audit_events
                .iter()
                .find(|event| event["audit_event"] == "readiness_checked")
                .unwrap()["metadata"]["readiness_status"],
            "Ready"
        );
        assert_eq!(
            audit_events
                .iter()
                .find(|event| event["audit_event"] == "apply_capability_checked")
                .unwrap()["metadata"]["apply_enabled"],
            false
        );
        let serialized_audit = serde_json::to_string(&audit_result["audit_trail"]).unwrap();
        for forbidden in [
            "content",
            "raw_content",
            "full_content",
            "patch",
            "diff",
            "raw_input",
            "canonical_path",
            "absolute_path",
            "file_content",
            "original README",
        ] {
            assert!(!serialized_audit.contains(&format!(r#"\"{forbidden}\""#)));
        }
        assert_eq!(
            std::fs::read_to_string(temp.path().join("README.md")).unwrap(),
            "original README"
        );
        let events_after_audit = parse_line(&format!(
            r#"{{"jsonrpc":"2.0","id":736,"method":"run.events","params":{{"run_id":"{run_id}"}}}}"#
        ));
        let events_after_audit = events_after_audit.result.expect("events after audit")["events"]
            .as_array()
            .unwrap()
            .clone();
        assert_eq!(events_after_audit.len(), events_after_history.len());
        std::fs::write(temp.path().join("README.md"), "changed manually").expect("manual change");
        let second_preflight = parse_line(&format!(
            r#"{{"jsonrpc":"2.0","id":8,"method":"proposal.preflight","params":{{"run_id":"{run_id}","proposal_id":"{proposal_id}"}}}}"#
        ));
        let second_preflight_result = second_preflight.result.expect("second preflight result");
        assert_eq!(second_preflight_result["snapshot"]["stale"], true);
        assert_eq!(
            std::fs::read_to_string(temp.path().join("README.md")).unwrap(),
            "changed manually"
        );
        let readiness = parse_line(&format!(
            r#"{{"jsonrpc":"2.0","id":9,"method":"proposal.readiness","params":{{"run_id":"{run_id}","proposal_id":"{proposal_id}"}}}}"#
        ));
        let readiness_result = readiness.result.expect("readiness result");
        assert_eq!(readiness_result["report"]["readiness_status"], "NotReady");
        assert!(readiness_result["report"]["summary"]
            .as_str()
            .unwrap()
            .contains("Latest preflight snapshot is stale"));
        let serialized_readiness = serde_json::to_string(&readiness_result["report"]).unwrap();
        for forbidden in [
            "content",
            "raw_content",
            "full_content",
            "patch",
            "diff",
            "raw_input",
            "canonical_path",
            "absolute_path",
            "file_content",
            "original README",
            "changed manually",
        ] {
            assert!(!serialized_readiness.contains(&format!(r#"\"{forbidden}\""#)));
        }
        assert_eq!(
            std::fs::read_to_string(temp.path().join("README.md")).unwrap(),
            "changed manually"
        );

        let events_after_approval = parse_line(&format!(
            r#"{{"jsonrpc":"2.0","id":10,"method":"run.events","params":{{"run_id":"{run_id}"}}}}"#
        ));
        let events_after_approval = events_after_approval.result.expect("events result")["events"]
            .as_array()
            .unwrap()
            .clone();
        assert!(events_after_approval
            .iter()
            .any(|event| event["kind"] == "WorkspacePatchApproved"));
        assert!(events_after_approval
            .iter()
            .any(|event| event["kind"] == "WorkspacePatchApplyPlanCreated"));
        assert!(events_after_approval
            .iter()
            .any(|event| event["kind"] == "WorkspacePatchPreflightSnapshotCreated"));
        assert!(events_after_approval
            .iter()
            .any(|event| event["kind"] == "WorkspacePatchReadinessReportCreated"));
        assert!(events_after_approval
            .iter()
            .any(|event| event["kind"] == "WorkspacePatchApplyCapabilityChecked"));
        assert!(events_after_approval
            .iter()
            .any(|event| event["kind"] == "WorkspacePatchApplyDryRunChecked"));
        let readiness_event = events_after_approval
            .iter()
            .find(|event| event["kind"] == "WorkspacePatchReadinessReportCreated")
            .expect("readiness report event");
        let readiness_payload = readiness_event["payload"]
            .as_object()
            .expect("readiness report payload");
        assert_eq!(
            readiness_payload["report_id"],
            ready_result["report"]["report_id"]
        );
        assert_eq!(readiness_payload["readiness_status"], "Ready");
        assert_eq!(
            readiness_payload["generated_at"],
            ready_result["report"]["generated_at"]
        );
        assert_eq!(
            readiness_payload["check_count"],
            ready_result["report"]["checklist"]
                .as_array()
                .unwrap()
                .len()
        );
        assert_eq!(
            readiness_payload["failed_checks"].as_array().unwrap().len(),
            0
        );
        assert_eq!(
            readiness_payload["blocked_checks"]
                .as_array()
                .unwrap()
                .len(),
            0
        );
        let serialized_readiness_payload = serde_json::to_string(readiness_payload).unwrap();
        for forbidden in [
            "content",
            "raw_content",
            "full_content",
            "patch",
            "diff",
            "raw_input",
            "canonical_path",
            "absolute_path",
            "file_content",
            "original README",
        ] {
            assert!(!serialized_readiness_payload.contains(&format!(r#"\"{forbidden}\""#)));
        }
        for event in events_after_approval.iter().filter(|event| {
            event["kind"] == "WorkspacePatchApproved"
                || event["kind"] == "WorkspacePatchApplyPlanCreated"
                || event["kind"] == "WorkspacePatchPreflightSnapshotCreated"
        }) {
            let serialized = serde_json::to_string(&event["payload"]).unwrap();
            for forbidden in [
                "content",
                "raw_content",
                "full_content",
                "patch",
                "diff",
                "raw_input",
                "canonical_path",
                "absolute_path",
                "original README",
            ] {
                assert!(!serialized.contains(&format!(r#"\"{forbidden}\""#)));
            }
        }
        let capability_event = events_after_approval
            .iter()
            .find(|event| event["kind"] == "WorkspacePatchApplyCapabilityChecked")
            .expect("apply capability event");
        let capability_payload = capability_event["payload"]
            .as_object()
            .expect("apply capability payload");
        assert_eq!(
            capability_payload["capability_id"],
            capability_result["capability"]["capability_id"]
        );
        assert_eq!(capability_payload["apply_supported"], false);
        assert_eq!(capability_payload["apply_enabled"], false);
        assert_eq!(capability_payload["mode"], "dry_run_only");
        assert_eq!(
            capability_payload["reason"],
            "Patch apply is not implemented in Phase 3.5."
        );
        assert_eq!(capability_payload["can_apply_now"], false);
        assert_eq!(
            capability_payload["check_count"],
            capability_result["capability"]["check_count"]
        );
        let serialized_capability_payload = serde_json::to_string(capability_payload).unwrap();
        for forbidden in [
            "content",
            "raw_content",
            "full_content",
            "patch",
            "diff",
            "raw_input",
            "canonical_path",
            "absolute_path",
            "file_content",
            "original README",
            "changed manually",
        ] {
            assert!(!serialized_capability_payload.contains(&format!(r#"\"{forbidden}\""#)));
        }
        let dry_run_event = events_after_approval
            .iter()
            .find(|event| event["kind"] == "WorkspacePatchApplyDryRunChecked")
            .expect("apply dry-run event");
        let dry_run_payload = dry_run_event["payload"]
            .as_object()
            .expect("apply dry-run payload");
        assert_eq!(
            dry_run_payload["dry_run_id"],
            dry_run_result["dry_run"]["dry_run_id"]
        );
        assert_eq!(dry_run_payload["dry_run_status"], "Completed");
        assert_eq!(
            dry_run_payload["dry_run_reason"],
            "Dry run completed without applying a patch or changing workspace files."
        );
        assert_eq!(dry_run_payload["no_patch_applied"], true);
        assert_eq!(dry_run_payload["apply_executed"], false);
        assert_eq!(dry_run_payload["workspace_files_changed"], false);
        assert_eq!(
            dry_run_payload["check_count"],
            dry_run_result["dry_run"]["check_count"]
        );
        let serialized_dry_run_payload = serde_json::to_string(dry_run_payload).unwrap();
        for forbidden in [
            "content",
            "raw_content",
            "full_content",
            "patch",
            "diff",
            "raw_input",
            "canonical_path",
            "absolute_path",
            "file_content",
            "original README",
            "changed manually",
        ] {
            assert!(!serialized_dry_run_payload.contains(&format!(r#"\"{forbidden}\""#)));
        }

        std::env::remove_var("BROWNIE_WORKSPACE_ROOT");
    }

    #[test]
    fn proposal_readiness_reports_not_ready_for_unapproved_proposal() {
        let temp = tempfile::tempdir().expect("tempdir");
        std::fs::write(temp.path().join("README.md"), "original README").expect("write readme");
        let store = BrownieStore::new(temp.path());
        let record = store
            .tasks()
            .start_task(TaskStartParams {
                goal: "review readiness".into(),
                mode_id: Some("implementer".into()),
            })
            .expect("start task");
        append_test_patch_proposal(
            &store,
            &record,
            "proposal_unapproved",
            "Valid",
            Some("--- a/README.md\n+++ b/README.md"),
            false,
        );

        let (_proposal, report) = readiness_proposal(&store, &record.run_id, "proposal_unapproved")
            .expect("readiness report");

        assert_eq!(report.readiness_status, "NotReady");
        assert_eq!(
            report
                .checklist
                .iter()
                .find(|check| check.name == "proposal_is_approved")
                .expect("approval check")
                .status,
            "Fail"
        );
    }

    #[test]
    fn proposal_readiness_reports_not_ready_without_preflight() {
        let temp = tempfile::tempdir().expect("tempdir");
        std::fs::write(temp.path().join("README.md"), "original README").expect("write readme");
        let store = BrownieStore::new(temp.path());
        let record = store
            .tasks()
            .start_task(TaskStartParams {
                goal: "review readiness".into(),
                mode_id: Some("implementer".into()),
            })
            .expect("start task");
        append_test_patch_proposal(
            &store,
            &record,
            "proposal_no_preflight",
            "Valid",
            Some("--- a/README.md\n+++ b/README.md"),
            false,
        );
        approve_proposal(&store, &record.run_id, "proposal_no_preflight", None)
            .expect("approve proposal");

        let (_proposal, report) =
            readiness_proposal(&store, &record.run_id, "proposal_no_preflight")
                .expect("readiness report");

        assert_eq!(report.readiness_status, "NotReady");
        assert_eq!(
            report
                .checklist
                .iter()
                .find(|check| check.name == "proposal_has_preflight_snapshot")
                .expect("preflight check")
                .status,
            "Fail"
        );
    }

    #[test]
    fn apply_capability_config_cannot_enable_execution() {
        let temp = tempfile::tempdir().expect("tempdir");
        std::fs::write(temp.path().join("README.md"), "original README").expect("write readme");
        std::fs::create_dir_all(temp.path().join(".brownie")).expect("config dir");
        std::fs::write(
            temp.path().join(".brownie/config.json"),
            r#"{"apply":{"enabled":true}}"#,
        )
        .expect("write config");
        let store = BrownieStore::new(temp.path());
        let record = store
            .tasks()
            .start_task(TaskStartParams {
                goal: "apply capability".into(),
                mode_id: Some("implementer".into()),
            })
            .expect("start task");
        append_test_patch_proposal(
            &store,
            &record,
            "proposal_apply_config",
            "Valid",
            Some("--- a/README.md\n+++ b/README.md"),
            false,
        );

        let (_proposal, capability) =
            inspect_apply_capability(&store, &record.run_id, "proposal_apply_config")
                .expect("apply capability");

        assert!(!capability.apply_supported);
        assert!(!capability.apply_enabled);
        assert!(!capability.can_apply_now);
        assert_eq!(capability.mode, "dry_run_only");
        assert_eq!(
            capability.reason,
            "Patch apply is not implemented in Phase 3.5."
        );
        assert_eq!(
            std::fs::read_to_string(temp.path().join("README.md")).unwrap(),
            "original README"
        );
    }

    #[test]
    fn proposal_readiness_reports_blocked_for_blocked_proposal() {
        let temp = tempfile::tempdir().expect("tempdir");
        std::fs::write(temp.path().join("README.md"), "original README").expect("write readme");
        let store = BrownieStore::new(temp.path());
        let record = store
            .tasks()
            .start_task(TaskStartParams {
                goal: "review readiness".into(),
                mode_id: Some("implementer".into()),
            })
            .expect("start task");
        append_test_patch_proposal(&store, &record, "proposal_blocked", "Blocked", None, true);

        let (_proposal, report) = readiness_proposal(&store, &record.run_id, "proposal_blocked")
            .expect("readiness report");

        assert_eq!(report.readiness_status, "Blocked");
        assert_eq!(
            report
                .checklist
                .iter()
                .find(|check| check.name == "no_sensitive_content_detected")
                .expect("sensitive check")
                .status,
            "Blocked"
        );
        assert!(!report.summary.contains("original README"));
    }

    #[test]
    fn patch_proposal_validation_blocks_invalid_and_sensitive_cases() {
        let temp = tempfile::tempdir().expect("tempdir");
        std::fs::write(
            temp.path().join("README.md"),
            "old
",
        )
        .expect("write readme");
        std::fs::create_dir(temp.path().join("docs")).expect("mkdir");
        std::fs::write(
            temp.path().join("secret.txt"),
            "api_key=sk-existing
",
        )
        .expect("secret");
        let outside = tempfile::tempdir().expect("outside tempdir");
        std::fs::write(
            outside.path().join("outside.txt"),
            "outside workspace
",
        )
        .expect("outside file");
        #[cfg(unix)]
        std::os::unix::fs::symlink(
            outside.path().join("outside.txt"),
            temp.path().join("link.txt"),
        )
        .expect("symlink");
        let store = BrownieStore::new(temp.path());

        let missing = build_workspace_patch_proposal(
            &store,
            "missing.md",
            "new
",
        );
        assert_eq!(missing.validation_status, "Invalid");
        assert_eq!(
            missing.validation_reason,
            Some("target file does not exist")
        );

        let directory = build_workspace_patch_proposal(
            &store, "docs", "new
",
        );
        assert_eq!(directory.validation_status, "Invalid");
        assert_eq!(
            directory.validation_reason,
            Some("target path is not a file")
        );

        let proposed_secret = build_workspace_patch_proposal(
            &store,
            "README.md",
            "sk-proposed
",
        );
        assert_eq!(proposed_secret.validation_status, "Blocked");
        assert_eq!(proposed_secret.content_preview, "[redacted]");
        assert!(proposed_secret.diff_preview.is_none());
        assert!(proposed_secret.diff_redacted);

        let existing_secret = build_workspace_patch_proposal(
            &store,
            "secret.txt",
            "safe
",
        );
        assert_eq!(existing_secret.validation_status, "Blocked");
        assert_eq!(
            existing_secret.validation_reason,
            Some("target file contains sensitive-like data")
        );
        assert!(existing_secret.diff_preview.is_none());
        assert!(existing_secret.diff_redacted);

        #[cfg(unix)]
        {
            let symlink_escape = build_workspace_patch_proposal(
                &store, "link.txt", "safe
",
            );
            assert_eq!(symlink_escape.validation_status, "Invalid");
            assert_eq!(
                symlink_escape.validation_reason,
                Some("target path escapes workspace root")
            );
            assert!(symlink_escape.diff_preview.is_none());
        }

        let large = build_workspace_patch_proposal(
            &store,
            "README.md",
            &"new line
"
            .repeat(1000),
        );
        assert_eq!(large.validation_status, "Valid");
        assert!(large.diff_truncated);
        assert!(large.diff_preview.unwrap().chars().count() <= DEFAULT_DIFF_PREVIEW_CHARS);
        assert_eq!(
            std::fs::read_to_string(temp.path().join("README.md")).unwrap(),
            "old
"
        );
    }

    #[test]
    fn proposal_list_unknown_run_returns_invalid_params() {
        let _guard = ENV_LOCK.lock().expect("env lock");
        let temp = tempfile::tempdir().expect("tempdir");
        std::env::set_var("BROWNIE_WORKSPACE_ROOT", temp.path());
        let response = parse_line(
            r#"{"jsonrpc":"2.0","id":1,"method":"proposal.list","params":{"run_id":"run_missing"}}"#,
        );
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
            r#"{"jsonrpc":"2.0","id":1,"method":"tool.intent.parse","params":{"mode_id":"orchestrator","assistant_content":"```brownie-tool-intent\n{\"tool_requests\":[{\"tool_id\":\"workspace.read\",\"reason\":\"Need context.\",\"input\":{\"path\":\"README.md\"}},{\"tool_id\":\"workspace.write\",\"reason\":\"Need edits.\",\"input\":{\"path\":\"README.md\",\"operation\":\"replace_file\",\"content\":\"new README content\"}}]}\n```"}}"#,
        );
        assert!(response.error.is_none());
        let result = response.result.expect("result");
        assert_eq!(result["mode_id"], "orchestrator");
        assert_eq!(result["items"][0]["tool_id"], "workspace.read");
        assert_eq!(result["items"][0]["allowed"], true);
        assert_eq!(result["items"][0]["input_summary"]["has_path"], true);
        assert_eq!(result["items"][0]["input_summary"]["field_count"], 1);
        assert!(result["items"][0].get("input").is_none());
        assert_eq!(result["items"][1]["tool_id"], "workspace.write");
        assert_eq!(result["items"][1]["allowed"], false);
    }

    #[test]
    fn tool_intent_parse_does_not_return_raw_input_or_suspicious_path() {
        let response = parse_line(
            r#"{"jsonrpc":"2.0","id":1,"method":"tool.intent.parse","params":{"mode_id":"orchestrator","assistant_content":"```brownie-tool-intent\n{\"tool_requests\":[{\"tool_id\":\"workspace.read\",\"reason\":\"Need context.\",\"input\":{\"path\":\"../secret.txt\",\"extra\":\"do-not-return\"}}]}\n```"}}"#,
        );
        assert!(response.error.is_none());
        let result = response.result.expect("result");
        assert!(result.to_string().contains("invalid_input"));
        assert!(!result.to_string().contains("../secret.txt"));
        assert!(!result.to_string().contains("do-not-return"));
        assert!(result["items"].as_array().expect("items").is_empty());
        assert_eq!(result["rejected"][0]["code"], "invalid_input");
    }

    #[test]
    fn tool_intent_parse_rejected_response_omits_raw_input_json() {
        let response = parse_line(
            r#"{"jsonrpc":"2.0","id":1,"method":"tool.intent.parse","params":{"mode_id":"orchestrator","assistant_content":"```brownie-tool-intent\n{\"tool_requests\":[{\"tool_id\":\"workspace.unknown\",\"reason\":\"Try unknown.\",\"input\":{\"path\":\"README.md\",\"secret\":\"Bearer abc123\"}}]}\n```"}}"#,
        );
        assert!(response.error.is_none());
        let result = response.result.expect("result");
        assert!(result["items"].as_array().expect("items").is_empty());
        assert_eq!(result["rejected"][0]["code"], "unknown_tool");
        let result_text = result.to_string();
        assert!(!result_text.contains("README.md"));
        assert!(!result_text.contains("Bearer abc123"));
        assert!(!result_text.contains("secret"));
        assert!(result["items"]
            .as_array()
            .expect("items")
            .iter()
            .all(|item| item.get("input").is_none()));
        assert!(result["rejected"]
            .as_array()
            .expect("rejected")
            .iter()
            .all(|item| item.get("input").is_none()));
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
                "BROWNIE_LLM_ALLOW_TASK_RUN_NETWORK",
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

    fn diagnostic_codes(result: &RuntimeDiagnosticsResult) -> Vec<&str> {
        result.diagnostics.iter().map(|d| d.code.as_str()).collect()
    }

    #[test]
    fn diagnostics_no_config_reports_default_fake() {
        let _lock = super::tests::ENV_LOCK.lock().expect("env lock");
        let _guard = EnvGuard::clear();
        let dir = tempfile::tempdir().unwrap();
        let result = runtime_diagnostics_from_workspace(dir.path());
        assert_eq!(result.llm_status.provider, "Fake");
        assert_eq!(result.config_source, "Default");
        assert!(diagnostic_codes(&result).contains(&"CONFIG_NOT_FOUND"));
    }

    #[test]
    fn diagnostics_unknown_env_provider_reports_strict_semantics() {
        let _lock = super::tests::ENV_LOCK.lock().expect("env lock");
        let _guard = EnvGuard::clear();
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("BROWNIE_LLM_PROVIDER", "mystery");
        let result = runtime_diagnostics_from_workspace(dir.path());
        let codes = diagnostic_codes(&result);
        assert_eq!(result.llm_status.provider, "Unknown");
        assert!(codes.contains(&"PROVIDER_UNKNOWN"));
        assert!(codes.contains(&"PROVIDER_FALLBACK_TO_FAKE"));

        std::env::set_var("BROWNIE_LLM_STRICT", "true");
        let result = runtime_diagnostics_from_workspace(dir.path());
        let codes = diagnostic_codes(&result);
        assert!(codes.contains(&"PROVIDER_UNKNOWN"));
        assert!(codes.contains(&"PROVIDER_STRICT_FAILURE"));
    }

    #[test]
    fn diagnostics_direct_api_key_and_malformed_config_do_not_leak_raw_content() {
        let _lock = super::tests::ENV_LOCK.lock().expect("env lock");
        let _guard = EnvGuard::clear();
        let dir = tempfile::tempdir().unwrap();
        write_config(
            dir.path(),
            r#"{"version":1,"active_profile":"bad","llm":{"profiles":{"bad":{"provider":"openai-compatible","base_url":"http://127.0.0.1:4141/v1","model":"qwen35","api_key":"DO_NOT_ALLOW"}}}}"#,
        );
        let response =
            serde_json::to_string(&runtime_diagnostics_from_workspace(dir.path())).unwrap();
        assert!(response.contains("CONFIG_DIRECT_API_KEY_REJECTED"));
        assert!(!response.contains("DO_NOT_ALLOW"));
        assert!(!response.contains("Authorization"));
        assert!(!response.contains("Bearer"));

        write_config(dir.path(), r#"{"secret":"RAW_SECRET""#);
        let response =
            serde_json::to_string(&runtime_diagnostics_from_workspace(dir.path())).unwrap();
        assert!(response.contains("CONFIG_MALFORMED"));
        assert!(!response.contains("RAW_SECRET"));
    }

    #[test]
    fn diagnostics_workspace_profiles_and_missing_key() {
        let _lock = super::tests::ENV_LOCK.lock().expect("env lock");
        let _guard = EnvGuard::clear();
        let dir = tempfile::tempdir().unwrap();
        write_config(
            dir.path(),
            r#"{"version":1,"active_profile":"fake","llm":{"profiles":{"fake":{"provider":"fake"}}}}"#,
        );
        let result = runtime_diagnostics_from_workspace(dir.path());
        assert!(diagnostic_codes(&result).contains(&"PROVIDER_WORKSPACE_PROFILE"));

        write_config(
            dir.path(),
            r#"{"version":1,"active_profile":"local","llm":{"profiles":{"local":{"provider":"openai-compatible","base_url":"http://127.0.0.1:4141/v1","model":"qwen35","api_key_env":"MISSING_BROWNIE_KEY","strict":false}}}}"#,
        );
        let result = runtime_diagnostics_from_workspace(dir.path());
        let codes = diagnostic_codes(&result);
        assert!(codes.contains(&"API_KEY_ENV_MISSING"));
        assert!(codes.contains(&"PROVIDER_FALLBACK_TO_FAKE"));

        write_config(
            dir.path(),
            r#"{"version":1,"active_profile":"missing","llm":{"profiles":{"fake":{"provider":"fake"}}}}"#,
        );
        let result = runtime_diagnostics_from_workspace(dir.path());
        assert!(diagnostic_codes(&result).contains(&"ACTIVE_PROFILE_UNKNOWN"));
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

#[cfg(test)]
mod phase_2_5_tests {
    use super::*;
    use std::{
        fs,
        io::{Read, Write},
        net::TcpListener,
        thread,
    };

    struct EnvGuard;
    impl EnvGuard {
        fn clear_env() {
            for key in [
                "BROWNIE_WORKSPACE_ROOT",
                "BROWNIE_LLM_PROVIDER",
                "BROWNIE_LLM_BASE_URL",
                "BROWNIE_LLM_MODEL",
                "BROWNIE_LLM_API_KEY_ENV",
                "BROWNIE_LLM_API_KEY",
                "BROWNIE_LLM_STRICT",
                "BROWNIE_LLM_ALLOW_TASK_RUN_NETWORK",
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

    fn mock_models_server(status: u16) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buffer = [0; 2048];
            let _ = stream.read(&mut buffer);
            let response = format!(
                "HTTP/1.1 {status} OK\r\ncontent-type: application/json\r\ncontent-length: 13\r\n\r\n{{\"data\":[]}}"
            );
            stream.write_all(response.as_bytes()).unwrap();
        });
        format!("http://{addr}/v1")
    }

    #[test]
    fn llm_health_fake_returns_healthy_without_network() {
        let _lock = super::tests::ENV_LOCK.lock().expect("env lock");
        let _guard = EnvGuard::clear();
        let dir = tempfile::tempdir().unwrap();
        let result =
            llm_health_from_workspace(dir.path(), false, std::time::Duration::from_secs(5))
                .unwrap();
        assert_eq!(result.provider, "Fake");
        assert!(!result.attempted);
        assert!(result.healthy);
        assert!(result
            .diagnostics
            .iter()
            .any(|d| d.code == "PROVIDER_FAKE_HEALTHY"));
    }

    #[test]
    fn llm_health_openai_network_not_allowed_does_not_probe() {
        let _lock = super::tests::ENV_LOCK.lock().expect("env lock");
        let _guard = EnvGuard::clear();
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("BROWNIE_LLM_PROVIDER", "openai-compatible");
        std::env::set_var("BROWNIE_LLM_BASE_URL", "http://127.0.0.1:9/v1");
        std::env::set_var("BROWNIE_LLM_MODEL", "qwen35");
        std::env::set_var("BROWNIE_LLM_API_KEY_ENV", "BROWNIE_LLM_API_KEY");
        std::env::set_var("BROWNIE_LLM_API_KEY", "local-secret");
        let result =
            llm_health_from_workspace(dir.path(), false, std::time::Duration::from_secs(5))
                .unwrap();
        assert_eq!(result.provider, "OpenAiCompatible");
        assert!(!result.attempted);
        assert!(!result.healthy);
        assert!(result
            .diagnostics
            .iter()
            .any(|d| d.code == "HEALTH_NETWORK_NOT_ALLOWED"));
    }

    #[test]
    fn llm_health_rejects_timeout_bounds() {
        let below = super::tests::parse_line(
            r#"{"jsonrpc":"2.0","id":1,"method":"llm.health","params":{"allow_network":true,"timeout_ms":999}}"#,
        );
        assert_eq!(below.error.unwrap().code, -32602);
        let above = super::tests::parse_line(
            r#"{"jsonrpc":"2.0","id":1,"method":"llm.health","params":{"allow_network":true,"timeout_ms":300001}}"#,
        );
        assert_eq!(above.error.unwrap().code, -32602);
    }

    #[test]
    fn llm_health_missing_openai_config_is_disabled() {
        let _lock = super::tests::ENV_LOCK.lock().expect("env lock");
        let _guard = EnvGuard::clear();
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("BROWNIE_LLM_PROVIDER", "openai-compatible");
        let result =
            llm_health_from_workspace(dir.path(), true, std::time::Duration::from_secs(5)).unwrap();
        assert_eq!(result.provider, "OpenAiCompatible");
        assert!(!result.attempted);
        assert!(!result.healthy);
        assert!(result.reason.unwrap().contains("missing config"));
    }

    #[test]
    fn llm_health_openai_2xx_and_500_mock_server() {
        let _lock = super::tests::ENV_LOCK.lock().expect("env lock");
        let _guard = EnvGuard::clear();
        let dir = tempfile::tempdir().unwrap();
        for (status, healthy) in [(200, true), (500, false)] {
            let base_url = mock_models_server(status);
            std::env::set_var("BROWNIE_LLM_PROVIDER", "openai-compatible");
            std::env::set_var("BROWNIE_LLM_BASE_URL", &base_url);
            std::env::set_var("BROWNIE_LLM_MODEL", "qwen35");
            std::env::set_var("BROWNIE_LLM_API_KEY_ENV", "BROWNIE_LLM_API_KEY");
            std::env::set_var("BROWNIE_LLM_API_KEY", "local-secret");
            let result =
                llm_health_from_workspace(dir.path(), true, std::time::Duration::from_secs(5))
                    .unwrap();
            assert!(result.attempted);
            assert_eq!(result.healthy, healthy);
            assert_eq!(result.status_code, Some(status));
            let serialized = serde_json::to_string(&result).unwrap();
            assert!(!serialized.contains("local-secret"));
            assert!(!serialized.contains("Authorization"));
            assert!(!serialized.contains(r#"{"data":[]}"#));
        }
    }

    #[test]
    fn llm_health_redacts_connection_failure_and_query_secret() {
        let _lock = super::tests::ENV_LOCK.lock().expect("env lock");
        let _guard = EnvGuard::clear();
        let dir = tempfile::tempdir().unwrap();
        write_config(
            dir.path(),
            r#"{"version":1,"active_profile":"local","llm":{"profiles":{"local":{"provider":"openai-compatible","base_url":"http://127.0.0.1:9/v1?api_key=secret-query","model":"qwen35","api_key_env":"BROWNIE_LLM_API_KEY","strict":true}}}}"#,
        );
        std::env::set_var("BROWNIE_LLM_API_KEY", "local-secret");
        let result =
            llm_health_from_workspace(dir.path(), true, std::time::Duration::from_millis(1000))
                .unwrap();
        assert!(result.attempted);
        assert!(!result.healthy);
        let serialized = serde_json::to_string(&result).unwrap();
        assert!(serialized.contains("?[REDACTED]"));
        assert!(!serialized.contains("secret-query"));
        assert!(!serialized.contains("local-secret"));
    }
}

#[cfg(test)]
mod phase_2_3_tests {
    use super::*;
    use std::{
        fs,
        io::{Read, Write},
        net::TcpListener,
        thread,
    };

    struct EnvGuard;
    impl EnvGuard {
        fn clear() -> Self {
            for key in [
                "BROWNIE_WORKSPACE_ROOT",
                "BROWNIE_LLM_PROVIDER",
                "BROWNIE_LLM_BASE_URL",
                "BROWNIE_LLM_MODEL",
                "BROWNIE_LLM_API_KEY_ENV",
                "BROWNIE_LLM_API_KEY",
                "BROWNIE_LLM_STRICT",
                "BROWNIE_LLM_ALLOW_TASK_RUN_NETWORK",
                "BROWNIE_TEST_LLM_API_KEY",
            ] {
                std::env::remove_var(key);
            }
            Self
        }
    }
    impl Drop for EnvGuard {
        fn drop(&mut self) {
            for key in [
                "BROWNIE_WORKSPACE_ROOT",
                "BROWNIE_LLM_PROVIDER",
                "BROWNIE_LLM_BASE_URL",
                "BROWNIE_LLM_MODEL",
                "BROWNIE_LLM_API_KEY_ENV",
                "BROWNIE_LLM_API_KEY",
                "BROWNIE_LLM_STRICT",
                "BROWNIE_LLM_ALLOW_TASK_RUN_NETWORK",
                "BROWNIE_TEST_LLM_API_KEY",
            ] {
                std::env::remove_var(key);
            }
        }
    }

    fn parse_line(line: &str) -> JsonRpcResponse<Value> {
        serde_json::from_str(&handle_jsonrpc_input_line(line).expect("response line"))
            .expect("valid response")
    }

    fn write_mock_config(root: &std::path::Path, base_url: &str) {
        fs::create_dir_all(root.join(".brownie")).unwrap();
        fs::write(root.join("README.md"), "# Brownie\n").unwrap();
        fs::write(
            root.join(".brownie/config.json"),
            format!(
                r#"{{
  "version": 1,
  "active_profile": "mock-openai",
  "llm": {{ "profiles": {{ "mock-openai": {{
    "provider": "openai-compatible",
    "base_url": "{}",
    "model": "mock-model",
    "api_key_env": "BROWNIE_TEST_LLM_API_KEY",
    "strict": true
  }} }} }}
}}"#,
                base_url
            ),
        )
        .unwrap();
    }

    fn spawn_mock(
        status: &str,
        body: &'static str,
    ) -> (String, thread::JoinHandle<serde_json::Value>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let status = status.to_string();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buf = [0_u8; 8192];
            let n = stream.read(&mut buf).unwrap();
            let req = String::from_utf8_lossy(&buf[..n]).to_string();
            let header_end = req.find("\r\n\r\n").unwrap();
            let (headers, request_body) = req.split_at(header_end + 4);
            assert!(headers.starts_with("POST /v1/chat/completions HTTP/1.1"));
            assert!(headers.lines().any(|line| line
                .to_ascii_lowercase()
                .starts_with("authorization: bearer ")));
            let json: serde_json::Value = serde_json::from_str(request_body).unwrap();
            assert_eq!(json["model"], "mock-model");
            let messages = json["messages"].as_array().expect("messages");
            assert!(messages.iter().any(|m| m["role"] == "system"));
            assert!(messages.iter().any(|m| m["role"] == "user"));
            let response = format!("HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\r\n{}", body.len(), body);
            stream.write_all(response.as_bytes()).unwrap();
            json
        });
        (format!("http://{addr}/v1"), handle)
    }

    fn spawn_mock_two(
        first_body: &'static str,
        second_body: &'static str,
    ) -> (String, thread::JoinHandle<Vec<serde_json::Value>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let handle = thread::spawn(move || {
            let mut observed = Vec::new();
            for body in [first_body, second_body] {
                let (mut stream, _) = listener.accept().unwrap();
                let mut buf = [0_u8; 8192];
                let n = stream.read(&mut buf).unwrap();
                let req = String::from_utf8_lossy(&buf[..n]).to_string();
                let header_end = req.find("\r\n\r\n").unwrap();
                let (headers, request_body) = req.split_at(header_end + 4);
                assert!(headers.starts_with("POST /v1/chat/completions HTTP/1.1"));
                assert!(headers.lines().any(|line| line
                    .to_ascii_lowercase()
                    .starts_with("authorization: bearer ")));
                let json: serde_json::Value = serde_json::from_str(request_body).unwrap();
                assert_eq!(json["model"], "mock-model");
                observed.push(json);
                let response = format!(
                    "HTTP/1.1 200 OK
content-type: application/json
content-length: {}

{}",
                    body.len(),
                    body
                );
                stream.write_all(response.as_bytes()).unwrap();
            }
            observed
        });
        (format!("http://{addr}/v1"), handle)
    }

    #[test]
    fn sensitive_prompt_findings_suppress_prompt_previews() {
        let _lock = super::tests::ENV_LOCK.lock().expect("env lock");
        let _guard = EnvGuard::clear();
        let temp = tempfile::tempdir().unwrap();
        let (base_url, handle) = spawn_mock_two(
            r#"{"choices":[{"message":{"content":"Mock LLM first pass.\n\n```brownie-tool-intent\n{\"tool_requests\":[{\"tool_id\":\"workspace.read\",\"reason\":\"Read README\",\"input\":{\"path\":\"README.md\"}}]}\n```"}}]}"#,
            r#"{"choices":[{"message":{"content":"Mock LLM final response after tool feedback."}}]}"#,
        );
        write_mock_config(temp.path(), &base_url);
        std::env::set_var("BROWNIE_WORKSPACE_ROOT", temp.path());
        std::env::set_var("BROWNIE_TEST_LLM_API_KEY", "test-key");
        std::env::set_var("BROWNIE_LLM_ALLOW_TASK_RUN_NETWORK", "true");
        std::env::set_var("BROWNIE_LLM_SENSITIVE_GUARD", "warn");

        let start = parse_line(
            r#"{"jsonrpc":"2.0","id":1,"method":"task.start","params":{"goal":"Read README with api_key=sk-test-sensitive-preview","mode_id":"orchestrator"}}"#,
        )
        .result
        .unwrap();
        let task_id = start["task_id"].as_str().unwrap();
        let run_id = start["run_id"].as_str().unwrap();
        let run = parse_line(&format!(
            r#"{{"jsonrpc":"2.0","id":2,"method":"task.run","params":{{"task_id":"{task_id}"}}}}"#
        ));
        if run.error.is_some() {
            panic!("run error: {:?}", run.error);
        }
        assert_eq!(handle.join().unwrap().len(), 2);

        let ledger = std::fs::read_to_string(
            temp.path()
                .join(".brownie/runs")
                .join(run_id)
                .join("ledger.jsonl"),
        )
        .expect("ledger");
        let events = ledger
            .lines()
            .map(|line| serde_json::from_str::<brownie_store::LedgerEvent>(line).expect("event"))
            .collect::<Vec<_>>();
        assert!(events
            .iter()
            .any(|event| event.kind == LedgerEventKind::PromptSensitiveScanCompleted));
        for kind in [
            LedgerEventKind::PromptBuilt,
            LedgerEventKind::SecondPassPromptBuilt,
        ] {
            let event = events
                .iter()
                .find(|event| event.kind == kind)
                .unwrap_or_else(|| panic!("missing {kind:?}"));
            let payload = event.payload.as_ref().expect("prompt payload");
            assert_eq!(payload["message_count"].as_u64().is_some(), true);
            assert_eq!(payload.get("prompt_preview"), None);
            assert_eq!(payload["prompt_preview_redacted"], true);
            assert!(!serde_json::to_string(payload)
                .unwrap()
                .contains("sk-test-sensitive-preview"));
        }
    }

    #[test]
    fn config_profile_openai_mock_task_run_completes_and_is_sanitized() {
        let _lock = super::tests::ENV_LOCK.lock().expect("env lock");
        let _guard = EnvGuard::clear();
        let temp = tempfile::tempdir().unwrap();
        let (base_url, handle) = spawn_mock_two(
            r#"{"choices":[{"message":{"content":"Mock LLM first pass.\n\n```brownie-tool-intent\n{\"tool_requests\":[{\"tool_id\":\"workspace.read\",\"reason\":\"Read README\",\"input\":{\"path\":\"README.md\"}}]}\n```"}}]}"#,
            r#"{"choices":[{"message":{"content":"Mock LLM final response after tool feedback."}}]}"#,
        );
        write_mock_config(temp.path(), &base_url);
        std::env::set_var("BROWNIE_WORKSPACE_ROOT", temp.path());
        std::env::set_var("BROWNIE_TEST_LLM_API_KEY", "test-key");
        std::env::set_var("BROWNIE_LLM_ALLOW_TASK_RUN_NETWORK", "true");

        let status = parse_line(r#"{"jsonrpc":"2.0","id":1,"method":"llm.status"}"#)
            .result
            .unwrap();
        assert_eq!(status["provider"], "OpenAiCompatible");
        assert_eq!(status["config_source"], "WorkspaceConfig");
        assert_eq!(status["active_profile"], "mock-openai");
        assert_eq!(status["enabled"], true);
        assert_eq!(status["strict"], true);

        let start = parse_line(r#"{"jsonrpc":"2.0","id":2,"method":"task.start","params":{"goal":"Use mock provider","mode_id":"orchestrator"}}"#).result.unwrap();
        let task_id = start["task_id"].as_str().unwrap();
        let run_id = start["run_id"].as_str().unwrap();
        let run = parse_line(&format!(
            r#"{{"jsonrpc":"2.0","id":3,"method":"task.run","params":{{"task_id":"{task_id}"}}}}"#
        ));
        if run.error.is_some() {
            panic!("run error: {:?}", run.error);
        }
        assert_eq!(run.result.unwrap()["status"], "Completed");
        let observed = handle.join().unwrap();
        assert_eq!(observed.len(), 2);
        assert_eq!(observed[0]["model"], "mock-model");

        let events = parse_line(&format!(
            r#"{{"jsonrpc":"2.0","id":4,"method":"run.events","params":{{"run_id":"{run_id}"}}}}"#
        ))
        .result
        .unwrap();
        let serialized = serde_json::to_string(&events).unwrap();
        assert!(serialized.contains("OpenAiCompatible"));
        assert!(serialized.contains("mock-model"));
        assert!(serialized.contains(&base_url));
        assert!(serialized.contains("strict"));
        assert!(!serialized.contains("test-key"));
        assert!(!serialized.contains("Authorization"));
        assert!(!serialized.contains("Bearer"));
        assert!(events["events"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["kind"] == "LlmRequestCreated"
                && e["payload"]["provider"] == "OpenAiCompatible"
                && e["payload"]["model"] == "mock-model"));
        assert!(events["events"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["kind"] == "ToolExecutionCompleted"));
        assert!(events["events"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["kind"] == "SecondPassLlmRequestCreated"));
        assert!(events["events"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["kind"] == "SecondPassLlmResponseReceived"));
        assert!(serialized.contains("Mock LLM final response after tool feedback"));
    }

    fn assert_strict_failure(status_line: &str, body: &'static str, expected_reason: &str) {
        let _guard = EnvGuard::clear();
        let temp = tempfile::tempdir().unwrap();
        let (base_url, handle) = spawn_mock(status_line, body);
        write_mock_config(temp.path(), &base_url);
        std::env::set_var("BROWNIE_WORKSPACE_ROOT", temp.path());
        std::env::set_var("BROWNIE_TEST_LLM_API_KEY", "test-key");
        std::env::set_var("BROWNIE_LLM_ALLOW_TASK_RUN_NETWORK", "true");
        let start = parse_line(r#"{"jsonrpc":"2.0","id":1,"method":"task.start","params":{"goal":"Fail strictly","mode_id":"orchestrator"}}"#).result.unwrap();
        let task_id = start["task_id"].as_str().unwrap();
        let run_id = start["run_id"].as_str().unwrap();
        let run = parse_line(&format!(
            r#"{{"jsonrpc":"2.0","id":2,"method":"task.run","params":{{"task_id":"{task_id}"}}}}"#
        ));
        assert_eq!(run.error.unwrap().code, -32603);
        handle.join().unwrap();
        let events = parse_line(&format!(
            r#"{{"jsonrpc":"2.0","id":3,"method":"run.events","params":{{"run_id":"{run_id}"}}}}"#
        ))
        .result
        .unwrap();
        let serialized = serde_json::to_string(&events).unwrap();
        assert!(serialized.contains("LlmRequestFailed"));
        assert!(serialized.contains("TaskFailed"));
        assert!(serialized.contains(expected_reason));
        assert!(!serialized.contains("test-key"));
    }

    #[test]
    fn strict_openai_task_run_without_guard_fails_before_network() {
        let _lock = super::tests::ENV_LOCK.lock().expect("env lock");
        let _guard = EnvGuard::clear();
        let temp = tempfile::tempdir().unwrap();
        write_mock_config(temp.path(), "http://127.0.0.1:9/v1");
        std::env::set_var("BROWNIE_WORKSPACE_ROOT", temp.path());
        std::env::set_var("BROWNIE_TEST_LLM_API_KEY", "test-key");

        let start = parse_line(r#"{"jsonrpc":"2.0","id":1,"method":"task.start","params":{"goal":"Guard failure","mode_id":"orchestrator"}}"#).result.unwrap();
        let task_id = start["task_id"].as_str().unwrap();
        let run_id = start["run_id"].as_str().unwrap();
        let run = parse_line(&format!(
            r#"{{"jsonrpc":"2.0","id":2,"method":"task.run","params":{{"task_id":"{task_id}"}}}}"#
        ));
        let error = run.error.unwrap();
        assert_eq!(error.code, -32603);
        assert!(error.message.contains(task_run_network_guard_reason()));
        let events = parse_line(&format!(
            r#"{{"jsonrpc":"2.0","id":3,"method":"run.events","params":{{"run_id":"{run_id}"}}}}"#
        ))
        .result
        .unwrap();
        let serialized = serde_json::to_string(&events).unwrap();
        assert!(serialized.contains("LlmRequestFailed"));
        assert!(serialized.contains("TaskFailed"));
        assert!(serialized.contains(task_run_network_guard_reason()));
        assert!(!serialized.contains("test-key"));
    }

    #[test]
    fn mock_500_strict_fails_and_records_llm_failure() {
        let _lock = super::tests::ENV_LOCK.lock().expect("env lock");
        assert_strict_failure(
            "500 Internal Server Error",
            r#"{"error":"boom"}"#,
            "non-2xx",
        );
    }

    #[test]
    fn malformed_json_strict_fails_and_records_llm_failure() {
        let _lock = super::tests::ENV_LOCK.lock().expect("env lock");
        assert_strict_failure("200 OK", "not json", "invalid JSON");
    }

    #[test]
    fn missing_choices_strict_fails_and_records_llm_failure() {
        let _lock = super::tests::ENV_LOCK.lock().expect("env lock");
        assert_strict_failure("200 OK", r#"{"choices":[]}"#, "missing choices");
    }

    #[test]
    fn unknown_env_provider_status_is_not_silent_fake() {
        let _lock = super::tests::ENV_LOCK.lock().expect("env lock");
        let _guard = EnvGuard::clear();
        std::env::set_var("BROWNIE_LLM_PROVIDER", "mystery");
        std::env::set_var("BROWNIE_LLM_STRICT", "true");
        let status = parse_line(r#"{"jsonrpc":"2.0","id":1,"method":"llm.status"}"#)
            .result
            .unwrap();
        assert_eq!(status["provider"], "Unknown");
        assert_eq!(status["enabled"], false);
        assert_eq!(status["strict"], true);
        assert!(status["reason"]
            .as_str()
            .unwrap()
            .contains("unknown provider: mystery"));
    }
}
