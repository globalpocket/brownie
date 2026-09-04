use super::*;

#[derive(Debug, Clone)]
pub struct RuntimeLlmProviderStatus {
    pub(super) status: LlmProviderStatus,
    pub(super) strict: bool,
    pub(super) will_fallback_to_fake: bool,
    pub(super) config_source: RuntimeConfigSource,
    pub(super) active_profile: Option<String>,
    pub(super) task_run_network_allowed: bool,
    pub(super) budget: LlmRequestBudget,
    pub(super) sensitive_guard_mode: PromptSensitiveGuardMode,
    pub(super) sensitive_guard_invalid: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuntimeConfigSource {
    Env,
    WorkspaceConfig,
    Default,
}

impl RuntimeConfigSource {
    pub(super) fn as_str(&self) -> &'static str {
        match self {
            Self::Env => "Env",
            Self::WorkspaceConfig => "WorkspaceConfig",
            Self::Default => "Default",
        }
    }
}

#[derive(Debug, Clone)]
pub struct RuntimeLlmProviderError {
    pub(super) status: RuntimeLlmProviderStatus,
    pub(super) message: String,
}

fn task_run_network_allowed() -> bool {
    matches!(
        std::env::var("BROWNIE_LLM_ALLOW_TASK_RUN_NETWORK")
            .ok()
            .as_deref(),
        Some("true")
    )
}

pub(super) fn task_run_network_guard_reason() -> &'static str {
    "real-provider task.run requires BROWNIE_LLM_ALLOW_TASK_RUN_NETWORK=true"
}

pub(super) fn llm_status_result(selection: RuntimeLlmProviderStatus) -> LlmStatusResult {
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

pub(super) fn provider_kind_name(kind: &LlmProviderKind) -> &'static str {
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

pub(super) fn default_fake_status() -> RuntimeLlmProviderStatus {
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

#[expect(
    clippy::result_large_err,
    reason = "provider admission failures carry bounded status evidence for runtime ledgering"
)]
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

#[expect(
    clippy::result_large_err,
    reason = "provider admission failures carry bounded status evidence for runtime ledgering"
)]
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
