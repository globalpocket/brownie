//! LLM client abstraction crate.

use std::{
    env,
    net::{SocketAddr, ToSocketAddrs},
    sync::OnceLock,
    time::{Duration, Instant},
};

use anyhow::anyhow;
use regex::Regex;
use serde::{Deserialize, Serialize};
use url::Url;

pub const OPENAI_COMPATIBLE_API_VERSION: &str = "v1";
pub const FAKE_LLM_MODEL: &str = "brownie-fake-llm";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum PromptSensitiveGuardMode {
    Off,
    Warn,
    Fail,
}

impl PromptSensitiveGuardMode {
    pub fn as_config_str(&self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::Warn => "warn",
            Self::Fail => "fail",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "off" => Some(Self::Off),
            "warn" => Some(Self::Warn),
            "fail" => Some(Self::Fail),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PromptSensitiveGuardConfig {
    pub mode: PromptSensitiveGuardMode,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PromptSensitiveFinding {
    pub category: String,
    pub message_index: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PromptSensitiveScanResult {
    pub findings: Vec<PromptSensitiveFinding>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PromptSensitiveGuardError {
    finding_count: usize,
    message_count: usize,
    categories: Vec<String>,
}

impl std::fmt::Display for PromptSensitiveGuardError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Prompt sensitive-content guard failed: {} findings across {} messages.",
            self.finding_count, self.message_count
        )?;
        if !self.categories.is_empty() {
            write!(f, " categories={}", self.categories.join(","))?;
        }
        Ok(())
    }
}

impl std::error::Error for PromptSensitiveGuardError {}

pub fn scan_prompt_for_sensitive_content(messages: &[LlmMessage]) -> PromptSensitiveScanResult {
    let mut findings = Vec::new();
    for (message_index, message) in messages.iter().enumerate() {
        append_sensitive_findings(&message.content, message_index, &mut findings);
    }
    PromptSensitiveScanResult { findings }
}

pub fn scan_text_for_sensitive_content(content: &str) -> PromptSensitiveScanResult {
    let mut findings = Vec::new();
    append_sensitive_findings(content, 0, &mut findings);
    PromptSensitiveScanResult { findings }
}

fn append_sensitive_findings(
    content: &str,
    message_index: usize,
    findings: &mut Vec<PromptSensitiveFinding>,
) {
    let checks = [
        (
            "authorization_header",
            authorization_header_re().is_match(content),
        ),
        ("bearer_token", bearer_token_re().is_match(content)),
        (
            "api_key_assignment",
            assignment_re().is_match(content)
                && assignment_name_re(&["api_key", "apikey", "api-key"]).is_match(content),
        ),
        (
            "access_token_assignment",
            assignment_re().is_match(content)
                && assignment_name_re(&["access_token", "access-token"]).is_match(content),
        ),
        (
            "private_key_block",
            content.contains("-----BEGIN PRIVATE KEY-----"),
        ),
        (
            "ssh_private_key_block",
            content.contains("-----BEGIN OPENSSH PRIVATE KEY-----"),
        ),
        (
            "env_file_secret",
            assignment_re().is_match(content)
                && assignment_name_re(&[
                    "aws_secret_access_key",
                    "secret_key",
                    "client_secret",
                    "password",
                ])
                .is_match(content),
        ),
        ("github_token_like", github_token_re().is_match(content)),
        ("openai_key_like", openai_key_re().is_match(content)),
    ];
    for (category, matched) in checks {
        if matched {
            findings.push(PromptSensitiveFinding {
                category: category.to_string(),
                message_index,
            });
        }
    }
}

pub fn enforce_prompt_sensitive_guard(
    messages: &[LlmMessage],
    mode: PromptSensitiveGuardMode,
) -> Result<PromptSensitiveScanResult, PromptSensitiveGuardError> {
    let result = scan_prompt_for_sensitive_content(messages);
    if mode == PromptSensitiveGuardMode::Fail && !result.findings.is_empty() {
        let mut categories = result
            .findings
            .iter()
            .map(|f| f.category.clone())
            .collect::<Vec<_>>();
        categories.sort();
        categories.dedup();
        let mut indexes = result
            .findings
            .iter()
            .map(|f| f.message_index)
            .collect::<Vec<_>>();
        indexes.sort_unstable();
        indexes.dedup();
        return Err(PromptSensitiveGuardError {
            finding_count: result.findings.len(),
            message_count: indexes.len(),
            categories,
        });
    }
    Ok(result)
}

fn authorization_header_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)(^|\n)\s*authorization\s*:\s*bearer\s+\S+").unwrap())
}

fn bearer_token_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?i)\bbearer\s+(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})")
            .unwrap()
    })
}

fn github_token_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"\b(ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})").unwrap()
    })
}

fn openai_key_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\bsk-[A-Za-z0-9_-]{16,}").unwrap())
}

fn assignment_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"(?i)\b[A-Za-z0-9_-]{3,}\s*[:=]\s*["']?[^"'\s]{6,}"#).unwrap())
}

fn assignment_name_re(names: &[&str]) -> Regex {
    let alternates = names
        .iter()
        .map(|name| regex::escape(name))
        .collect::<Vec<_>>()
        .join("|");
    Regex::new(&format!(r"(?i)\b({alternates})\s*[:=]")).unwrap()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LlmRequestBudget {
    pub max_prompt_chars: usize,
    pub max_messages: usize,
    pub request_timeout_ms: u64,
    pub response_preview_chars: usize,
}

impl Default for LlmRequestBudget {
    fn default() -> Self {
        Self {
            max_prompt_chars: 120_000,
            max_messages: 64,
            request_timeout_ms: 30_000,
            response_preview_chars: 2_000,
        }
    }
}

pub fn validate_llm_request_budget(budget: &LlmRequestBudget) -> Result<(), String> {
    if !(1_000..=1_000_000).contains(&budget.max_prompt_chars) {
        return Err("max_prompt_chars must be between 1000 and 1000000".to_string());
    }
    if !(1..=256).contains(&budget.max_messages) {
        return Err("max_messages must be between 1 and 256".to_string());
    }
    if !(1_000..=300_000).contains(&budget.request_timeout_ms) {
        return Err("request_timeout_ms must be between 1000 and 300000".to_string());
    }
    if !(100..=20_000).contains(&budget.response_preview_chars) {
        return Err("response_preview_chars must be between 100 and 20000".to_string());
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LlmRequest {
    pub model: String,
    pub messages: Vec<LlmMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LlmMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LlmResponse {
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum LlmProviderKind {
    Fake,
    OpenAiCompatible,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LlmProviderStatus {
    pub provider: LlmProviderKind,
    pub enabled: bool,
    pub model: String,
    pub base_url: Option<String>,
    pub reason: Option<String>,
}

pub trait LlmProvider {
    fn status(&self) -> LlmProviderStatus;
    fn complete(
        &self,
        request: &LlmRequest,
        budget: &LlmRequestBudget,
    ) -> anyhow::Result<LlmResponse>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenAiCompatibleConfig {
    pub base_url: String,
    pub model: String,
    pub api_key_env: String,
    pub max_tokens: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OpenAiCompatibleConfigFromEnv {
    Enabled(OpenAiCompatibleConfig),
    Disabled(LlmProviderStatus),
}

pub const OPENAI_COMPATIBLE_DEFAULT_MAX_TOKENS: u32 = 4_096;
pub const OPENAI_COMPATIBLE_MAX_TOKENS_UPPER_BOUND: u32 = 262_144;

pub fn validate_openai_compatible_max_tokens(max_tokens: u32) -> Result<(), String> {
    if !(1..=OPENAI_COMPATIBLE_MAX_TOKENS_UPPER_BOUND).contains(&max_tokens) {
        return Err(format!(
            "max_tokens must be between 1 and {}",
            OPENAI_COMPATIBLE_MAX_TOKENS_UPPER_BOUND
        ));
    }
    Ok(())
}

pub struct FakeLlm;

impl FakeLlm {
    pub fn complete(request: &LlmRequest) -> LlmResponse {
        let prompt_text = request
            .messages
            .iter()
            .map(|message| message.content.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        let prompt = prompt_text.to_lowercase();
        let request_signal = extract_goal_signal(&prompt_text)
            .unwrap_or(prompt_text.as_str())
            .to_lowercase();
        if prompt.contains("completed_child")
            && prompt.contains("agentmodes_orchestrated_coding_e2e")
            && prompt.contains("orchestrator")
        {
            return LlmResponse {
                content:
                    "Fake LLM final response after AgentModes orchestrated coding child completion."
                        .to_string(),
            };
        }
        if prompt.contains("failed_child")
            && prompt.matches("completed_child").count() >= 2
            && prompt.contains("orchestrator")
        {
            let intent = serde_json::json!({
                "tool_requests": [{
                    "tool_id": "subtask.spawn",
                    "reason": "Continue repeated recovery cycle after second explicit recovery child completion."
                }]
            });
            return LlmResponse {
                content: format!(
                    "Fake LLM repeated recovery-cycle continuation request with {} messages.\n\n```brownie-tool-intent\n{}\n```",
                    request.messages.len(),
                    serde_json::to_string_pretty(&intent).expect("fake intent serializes")
                ),
            };
        }
        if prompt.contains("failed_child")
            && prompt.contains("completed_child")
            && prompt.contains("orchestrator")
        {
            let intent = serde_json::json!({
                "tool_requests": [{
                    "tool_id": "subtask.spawn",
                    "reason": "Continue recovery after explicit recovery child completion."
                }]
            });
            return LlmResponse {
                content: format!(
                    "Fake LLM recovery-child completion continuation request with {} messages.\n\n```brownie-tool-intent\n{}\n```",
                    request.messages.len(),
                    serde_json::to_string_pretty(&intent).expect("fake intent serializes")
                ),
            };
        }
        if prompt.contains("failed_child") && prompt.contains("orchestrator") {
            let intent = serde_json::json!({
                "tool_requests": [{
                    "tool_id": "subtask.spawn",
                    "reason": "Recover failed controlled child task."
                }]
            });
            return LlmResponse {
                content: format!(
                    "Fake LLM failed-child recovery request with {} messages.\n\n```brownie-tool-intent\n{}\n```",
                    request.messages.len(),
                    serde_json::to_string_pretty(&intent).expect("fake intent serializes")
                ),
            };
        }
        if prompt.contains("completed_child") && prompt.contains("orchestrator") {
            let intent = serde_json::json!({
                "tool_requests": [{
                    "tool_id": "subtask.spawn",
                    "reason": "Orchestrator mode may coordinate subtasks."
                }]
            });
            return LlmResponse {
                content: format!(
                    "Fake LLM parent continuation request with {} messages.\n\n```brownie-tool-intent\n{}\n```",
                    request.messages.len(),
                    serde_json::to_string_pretty(&intent).expect("fake intent serializes")
                ),
            };
        }
        if !prompt.contains("completed_child")
            && !prompt.contains("failed_child")
            && prompt.contains("agentmodes_orchestrated_coding_e2e")
            && prompt.contains("orchestrator")
        {
            if let Some(mode_id) = extract_agentmodes_orchestrated_coding_mode_id(&prompt_text) {
                let intent = serde_json::json!({
                    "tool_requests": [{
                        "tool_id": "subtask.spawn",
                        "reason": "Delegate this coding objective through the real AgentModes orchestrator policy.",
                        "input": {
                            "mode_id": mode_id,
                            "goal": "Implement README update"
                        }
                    }]
                });
                return LlmResponse {
                    content: format!(
                        "Fake LLM AgentModes orchestrated coding request with {} messages.\n\n```brownie-tool-intent\n{}\n```",
                        request.messages.len(),
                        serde_json::to_string_pretty(&intent).expect("fake intent serializes")
                    ),
                };
            }
        }
        if prompt.contains("tool execution:")
            && prompt.contains("mcp.github.search_code")
            && prompt.contains("completed")
        {
            if prompt_text.contains("MCP_RESULT_7f91c2") {
                return LlmResponse {
                    content:
                        "Fake LLM final response after using MCP search_code result: MCP_RESULT_7f91c2."
                            .to_string(),
                };
            }
            let intent = serde_json::json!({
                "tool_requests": [{
                    "tool_id": "mcp.github.search_code",
                    "reason": "MCP result context did not contain the required bounded result token.",
                    "input": { "query": "bounded" }
                }]
            });
            return LlmResponse {
                content: format!(
                    "Fake LLM missing MCP result context with {} messages.\n\n```brownie-tool-intent\n{}\n```",
                    request.messages.len(),
                    serde_json::to_string_pretty(&intent).expect("fake intent serializes")
                ),
            };
        }
        if prompt.contains("tool execution:")
            && (prompt.contains("git.status: completed")
                || prompt.contains("git.diff: completed")
                || prompt.contains("untrusted_git_result_context"))
            && prompt.contains("duplicate workspace.read")
            && (request_signal.contains("release evidence") || request_signal.contains("todo.md"))
        {
            let intent = serde_json::json!({
                "tool_requests": [{
                    "tool_id": "workspace.write",
                    "reason": "Record the concrete release-evidence blocker in todo.md instead of looping on duplicate reads.",
                    "input": {
                        "path": "todo.md",
                        "operation": "replace_file",
                        "content": "- [ ] E-03a: Add a dedicated release evidence collector for workflow run ID and artifact SHA-256 before populating runtime-release-contract.json.\n"
                    }
                }]
            });
            return LlmResponse {
                content: format!(
                    "Fake LLM duplicate-read blocker refinement with {} messages.\n\n```brownie-tool-intent\n{}\n```",
                    request.messages.len(),
                    serde_json::to_string_pretty(&intent).expect("fake intent serializes")
                ),
            };
        }
        if prompt.contains("tool execution:")
            && (prompt.contains("git.status: completed")
                || prompt.contains("git.diff: completed")
                || prompt.contains("untrusted_git_result_context"))
        {
            if prompt_text.contains("MP7_RESULT_91c7.rs")
                || contains_any(
                    &request_signal,
                    &["git status", "git inspection", "git result context"],
                )
            {
                return LlmResponse {
                    content:
                        "Fake LLM final response after using Git result context: MP7_RESULT_91c7.rs."
                            .to_string(),
                };
            }
            let intent = serde_json::json!({
                "tool_requests": [{
                    "tool_id": "git.status",
                    "reason": "Git result context did not contain the required bounded status token.",
                    "input": {}
                }]
            });
            return LlmResponse {
                content: format!(
                    "Fake LLM missing Git result context with {} messages.\n\n```brownie-tool-intent\n{}\n```",
                    request.messages.len(),
                    serde_json::to_string_pretty(&intent).expect("fake intent serializes")
                ),
            };
        }
        if prompt.contains("tool execution:")
            && (prompt.contains("workspace.read: completed") || prompt.contains("bytes_read="))
            && prompt.contains("workspacepatchproposed")
            && contains_any(
                &request_signal,
                &["implement", "edit", "modify", "update", "修正", "実装"],
            )
        {
            return LlmResponse {
                content: "Fake LLM final response after preparing workspace proposal.".to_string(),
            };
        }
        if prompt.contains("tool execution:")
            && (prompt.contains("workspace.read: completed") || prompt.contains("bytes_read="))
            && !contains_any(
                &request_signal,
                &[
                    "cargo test",
                    "test suite",
                    "run tests",
                    "verify tests",
                    "cargo check",
                    "typecheck",
                    "type-check",
                    "type check",
                    "compile",
                    "compilation",
                    "cargo fmt",
                    "fmt",
                    "format",
                    "formatting",
                    "implement",
                    "edit",
                    "modify",
                    "update",
                    "修正",
                    "実装",
                ],
            )
        {
            return LlmResponse {
                content: "Fake LLM final response after reading workspace context.".to_string(),
            };
        }
        if prompt.contains("mcp.github.search_code")
            && contains_any(&request_signal, &["mcp", "search_code"])
        {
            let intent = serde_json::json!({
                "tool_requests": [{
                    "tool_id": "mcp.github.search_code",
                    "reason": "Use the task-pinned MCP search tool.",
                    "input": { "query": "bounded" }
                }]
            });
            return LlmResponse {
                content: format!(
                    "Fake LLM MCP tool request with {} messages.\n\n```brownie-tool-intent\n{}\n```",
                    request.messages.len(),
                    serde_json::to_string_pretty(&intent).expect("fake intent serializes")
                ),
            };
        }

        let mut requests = vec![(
            "workspace.read",
            "Inspect workspace context before proceeding.",
        )];
        if contains_any(&request_signal, &["implement", "edit", "修正", "実装"]) {
            requests.push(("workspace.write", "Need to edit workspace files."));
        }
        if contains_any(
            &request_signal,
            &["cargo test", "test suite", "run tests", "verify tests"],
        ) {
            requests.push((
                "verification.cargo_test",
                "Need to run the controlled cargo test verifier.",
            ));
        } else if contains_any(
            &request_signal,
            &[
                "cargo check",
                "typecheck",
                "type-check",
                "type check",
                "compile",
                "compilation",
            ],
        ) {
            requests.push((
                "verification.cargo_check",
                "Need to run the controlled cargo check verifier.",
            ));
        } else if contains_any(
            &request_signal,
            &["cargo fmt", "fmt", "format", "formatting"],
        ) {
            requests.push((
                "verification.cargo_fmt_check",
                "Need to run the controlled cargo fmt verifier.",
            ));
        }
        if contains_any(
            &request_signal,
            &["git status", "git inspection", "git result context"],
        ) {
            requests.push(("git.status", "Need bounded Git status context."));
        } else if contains_any(&request_signal, &["git diff"]) {
            requests.push(("git.diff", "Need bounded Git diff context."));
        }
        if prompt.contains("orchestrator") {
            requests.push((
                "subtask.spawn",
                "Orchestrator mode may coordinate subtasks.",
            ));
        }
        let patch_file_requested =
            contains_any(&request_signal, &["patch_file", "patch file", "patch hunk"]);
        let tool_requests = requests
            .into_iter()
            .map(|(tool_id, reason)| {
                if tool_id == "workspace.read" {
                    serde_json::json!({ "tool_id": tool_id, "reason": reason, "input": { "path": "README.md" } })
                } else if tool_id == "workspace.write" {
                    if patch_file_requested {
                        serde_json::json!({ "tool_id": tool_id, "reason": reason, "input": { "path": "README.md", "operation": "patch_file", "old_text": "beta\n", "new_text": "delta\n" } })
                    } else {
                        serde_json::json!({ "tool_id": tool_id, "reason": reason, "input": { "path": "README.md", "operation": "replace_file", "content": "new README content" } })
                    }
                } else if tool_id == "git.status" || tool_id == "git.diff" {
                    serde_json::json!({ "tool_id": tool_id, "reason": reason, "input": {} })
                } else {
                    serde_json::json!({ "tool_id": tool_id, "reason": reason })
                }
            })
            .collect::<Vec<_>>();
        let intent = serde_json::json!({ "tool_requests": tool_requests });
        LlmResponse {
            content: format!(
                "Fake LLM completed request with {} messages.\n\n```brownie-tool-intent\n{}\n```",
                request.messages.len(),
                serde_json::to_string_pretty(&intent).expect("fake intent serializes")
            ),
        }
    }
}

fn extract_agentmodes_orchestrated_coding_mode_id(prompt_text: &str) -> Option<String> {
    let marker = "AGENTMODES_ORCHESTRATED_CODING_E2E_MODE=";
    let start = prompt_text.find(marker)? + marker.len();
    let rest = &prompt_text[start..];
    let mode_id = rest
        .split(|ch: char| ch.is_whitespace() || matches!(ch, '"' | '\'' | ',' | ';'))
        .next()?;
    if mode_id.is_empty()
        || mode_id.len() > 128
        || !mode_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        return None;
    }
    Some(mode_id.to_string())
}

#[derive(Debug, Default, Clone, Copy)]
pub struct FakeLlmProvider;

impl LlmProvider for FakeLlmProvider {
    fn status(&self) -> LlmProviderStatus {
        LlmProviderStatus {
            provider: LlmProviderKind::Fake,
            enabled: true,
            model: FAKE_LLM_MODEL.to_string(),
            base_url: None,
            reason: None,
        }
    }

    fn complete(
        &self,
        request: &LlmRequest,
        _budget: &LlmRequestBudget,
    ) -> anyhow::Result<LlmResponse> {
        Ok(FakeLlm::complete(request))
    }
}

#[derive(Debug, Clone)]
pub struct OpenAiCompatibleLlmProvider {
    config: OpenAiCompatibleConfig,
    api_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LlmHealthProbeResult {
    pub attempted: bool,
    pub healthy: bool,
    pub latency_ms: Option<u64>,
    pub status_code: Option<u16>,
    pub reason: Option<String>,
}

impl OpenAiCompatibleLlmProvider {
    pub fn new(config: OpenAiCompatibleConfig, api_key: String) -> Self {
        Self { config, api_key }
    }

    pub fn from_env() -> OpenAiCompatibleConfigFromEnv {
        let base_url = env::var("BROWNIE_LLM_BASE_URL")
            .ok()
            .filter(|v| !v.trim().is_empty());
        let model = env::var("BROWNIE_LLM_MODEL")
            .ok()
            .filter(|v| !v.trim().is_empty());
        let api_key_env = env::var("BROWNIE_LLM_API_KEY_ENV")
            .ok()
            .filter(|v| !v.trim().is_empty())
            .unwrap_or_else(|| "BROWNIE_LLM_API_KEY".to_string());
        let api_key_present = env::var(&api_key_env)
            .ok()
            .filter(|v| !v.trim().is_empty())
            .is_some();
        let max_tokens = match env::var("BROWNIE_LLM_MAX_TOKENS")
            .ok()
            .filter(|v| !v.trim().is_empty())
        {
            Some(value) => match value.trim().parse::<u32>() {
                Ok(parsed) if validate_openai_compatible_max_tokens(parsed).is_ok() => parsed,
                _ => {
                    return OpenAiCompatibleConfigFromEnv::Disabled(LlmProviderStatus {
                        provider: LlmProviderKind::OpenAiCompatible,
                        enabled: false,
                        model: model.unwrap_or_default(),
                        base_url: base_url.map(|v| redact_secret(&v)),
                        reason: Some("invalid BROWNIE_LLM_MAX_TOKENS".to_string()),
                    });
                }
            },
            None => OPENAI_COMPATIBLE_DEFAULT_MAX_TOKENS,
        };

        let mut missing = Vec::new();
        if base_url.is_none() {
            missing.push("BROWNIE_LLM_BASE_URL");
        }
        if model.is_none() {
            missing.push("BROWNIE_LLM_MODEL");
        }
        if !api_key_present {
            missing.push(api_key_env.as_str());
        }

        if !missing.is_empty() {
            return OpenAiCompatibleConfigFromEnv::Disabled(LlmProviderStatus {
                provider: LlmProviderKind::OpenAiCompatible,
                enabled: false,
                model: model.unwrap_or_default(),
                base_url: base_url.map(|v| redact_secret(&v)),
                reason: Some(format!("missing config: {}", missing.join(", "))),
            });
        }
        let checked_base_url =
            match validate_openai_compatible_base_url(base_url.as_deref().expect("checked")) {
                Ok(url) => url,
                Err(reason) => {
                    return OpenAiCompatibleConfigFromEnv::Disabled(LlmProviderStatus {
                        provider: LlmProviderKind::OpenAiCompatible,
                        enabled: false,
                        model: model.unwrap_or_default(),
                        base_url: base_url.map(|v| redact_secret(&v)),
                        reason: Some(reason),
                    });
                }
            };
        OpenAiCompatibleConfigFromEnv::Enabled(OpenAiCompatibleConfig {
            base_url: checked_base_url,
            model: model.expect("checked"),
            api_key_env,
            max_tokens,
        })
    }

    pub fn probe_models(&self, timeout: Duration) -> LlmHealthProbeResult {
        let started = Instant::now();
        let endpoint = match openai_compatible_endpoint(&self.config.base_url, "models") {
            Ok(endpoint) => endpoint,
            Err(error) => {
                return LlmHealthProbeResult {
                    attempted: false,
                    healthy: false,
                    latency_ms: None,
                    status_code: None,
                    reason: Some(redact_secret(&error.to_string())),
                };
            }
        };
        let client = match openai_compatible_client_for_endpoint(&endpoint, timeout) {
            Ok(client) => client,
            Err(error) => {
                return LlmHealthProbeResult {
                    attempted: false,
                    healthy: false,
                    latency_ms: None,
                    status_code: None,
                    reason: Some(redact_secret(&error.to_string())),
                };
            }
        };
        match client.get(endpoint).bearer_auth(&self.api_key).send() {
            Ok(response) => {
                let status = response.status();
                LlmHealthProbeResult {
                    attempted: true,
                    healthy: status.is_success(),
                    latency_ms: Some(started.elapsed().as_millis().try_into().unwrap_or(u64::MAX)),
                    status_code: Some(status.as_u16()),
                    reason: if status.is_success() {
                        None
                    } else {
                        Some(format!("non-2xx HTTP status {}", status.as_u16()))
                    },
                }
            }
            Err(error) => LlmHealthProbeResult {
                attempted: true,
                healthy: false,
                latency_ms: Some(started.elapsed().as_millis().try_into().unwrap_or(u64::MAX)),
                status_code: error.status().map(|status| status.as_u16()),
                reason: Some(redact_secret(&error.to_string())),
            },
        }
    }
}

impl LlmProvider for OpenAiCompatibleLlmProvider {
    fn status(&self) -> LlmProviderStatus {
        LlmProviderStatus {
            provider: LlmProviderKind::OpenAiCompatible,
            enabled: true,
            model: self.config.model.clone(),
            base_url: Some(redact_secret(&self.config.base_url)),
            reason: None,
        }
    }

    fn complete(
        &self,
        request: &LlmRequest,
        budget: &LlmRequestBudget,
    ) -> anyhow::Result<LlmResponse> {
        let base_url = redact_secret(&self.config.base_url);
        let failure_prefix = || {
            format!(
                "OpenAI-compatible request failed: provider=OpenAiCompatible base_url={} model={}",
                base_url, self.config.model
            )
        };
        let url = format!(
            "{}",
            openai_compatible_endpoint(&self.config.base_url, "chat/completions").map_err(|e| {
                anyhow!(
                    "{} reason={}",
                    failure_prefix(),
                    redact_secret(&e.to_string())
                )
            })?
        );
        let client = openai_compatible_client_for_endpoint(
            &url,
            Duration::from_millis(budget.request_timeout_ms),
        )
        .map_err(|e| {
            anyhow!(
                "{} reason={}",
                failure_prefix(),
                redact_secret(&e.to_string())
            )
        })?;
        let response = client
            .post(url)
            .bearer_auth(&self.api_key)
            .json(&serde_json::json!({
                "model": request.model,
                "messages": request.messages,
                "max_tokens": self.config.max_tokens,
                "temperature": 0,
                "stream": false,
            }))
            .send()
            .map_err(|e| {
                anyhow!(
                    "{} reason={}",
                    failure_prefix(),
                    redact_secret(&e.to_string())
                )
            })?;
        let status = response.status();
        if !status.is_success() {
            return Err(anyhow!(
                "{} reason=non-2xx HTTP status {}",
                failure_prefix(),
                status.as_u16()
            ));
        }
        let response: ChatCompletionResponse = response.json().map_err(|e| {
            anyhow!(
                "{} reason=invalid JSON: {}",
                failure_prefix(),
                redact_secret(&e.to_string())
            )
        })?;
        let choice = response
            .choices
            .into_iter()
            .next()
            .ok_or_else(|| anyhow!("{} reason=missing choices", failure_prefix()))?;
        let content = choice
            .message
            .content
            .filter(|content| !content.trim().is_empty())
            .ok_or_else(|| anyhow!("{} reason=missing message content", failure_prefix()))?;
        Ok(LlmResponse { content })
    }
}

pub fn validate_openai_compatible_base_url(raw: &str) -> Result<String, String> {
    let mut url = Url::parse(raw).map_err(|_| "invalid OpenAI-compatible base_url".to_string())?;
    match url.scheme() {
        "http" | "https" => {}
        _ => return Err("invalid OpenAI-compatible base_url: scheme must be http or https".into()),
    }
    if url.host_str().is_none() {
        return Err("invalid OpenAI-compatible base_url: host is required".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("invalid OpenAI-compatible base_url: userinfo is not allowed".into());
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err(
            "invalid OpenAI-compatible base_url: query and fragment are not allowed".into(),
        );
    }
    if !url.path().ends_with('/') {
        url.set_path(&format!("{}/", url.path()));
    }
    Ok(url.to_string().trim_end_matches('/').to_string())
}

fn openai_compatible_endpoint(base_url: &str, suffix: &str) -> anyhow::Result<String> {
    let checked = validate_openai_compatible_base_url(base_url).map_err(anyhow::Error::msg)?;
    let base = Url::parse(&format!("{}/", checked.trim_end_matches('/')))?;
    let endpoint = base.join(suffix)?;
    if endpoint.scheme() != base.scheme()
        || endpoint.host_str() != base.host_str()
        || endpoint.port_or_known_default() != base.port_or_known_default()
    {
        anyhow::bail!("OpenAI-compatible endpoint escaped configured origin");
    }
    Ok(endpoint.to_string())
}

fn openai_compatible_client_for_endpoint(
    endpoint: &str,
    timeout: Duration,
) -> anyhow::Result<reqwest::blocking::Client> {
    let url = Url::parse(endpoint)?;
    let host = url
        .host_str()
        .ok_or_else(|| anyhow!("OpenAI-compatible endpoint host is required"))?;
    let port = url
        .port_or_known_default()
        .ok_or_else(|| anyhow!("OpenAI-compatible endpoint port is required"))?;
    let addrs = resolve_openai_compatible_host(host, port)?;
    let mut builder = reqwest::blocking::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(timeout);
    builder = builder.resolve_to_addrs(host, &addrs);
    builder.build().map_err(anyhow::Error::from)
}

fn resolve_openai_compatible_host(host: &str, port: u16) -> anyhow::Result<Vec<SocketAddr>> {
    let mut addrs = (host, port).to_socket_addrs()?.collect::<Vec<_>>();
    addrs.sort();
    addrs.dedup();
    if addrs.is_empty() {
        anyhow::bail!("OpenAI-compatible endpoint DNS resolution returned no addresses");
    }
    Ok(addrs)
}

#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<ChatChoice>,
}
#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatMessage,
}
#[derive(Debug, Deserialize)]
struct ChatMessage {
    content: Option<String>,
}

pub fn redact_secret(value: &str) -> String {
    let mut redacted = value.to_string();
    if let Some(query_start) = redacted.find('?') {
        let end = redacted[query_start..]
            .find(|c: char| c.is_whitespace() || c == '\'' || c == '"')
            .map(|i| query_start + i)
            .unwrap_or(redacted.len());
        redacted.replace_range(query_start..end, "?[REDACTED]");
    }
    for marker in ["Authorization:", "authorization:", "API key", "api key"] {
        while let Some(start) = redacted.find(marker) {
            let end = redacted[start..]
                .find('\n')
                .map(|i| start + i)
                .unwrap_or(redacted.len());
            redacted.replace_range(start..end, "[REDACTED]");
        }
    }
    for marker in ["Bearer ", "bearer "] {
        while let Some(start) = redacted.find(marker) {
            let token_start = start + marker.len();
            let token_end = redacted[token_start..]
                .find(|c: char| c.is_whitespace() || c == '\'' || c == '"' || c == ',' || c == '&')
                .map(|i| token_start + i)
                .unwrap_or(redacted.len());
            redacted.replace_range(start..token_end, "[REDACTED]");
        }
    }
    for key in ["api_key", "access_token", "token", "key"] {
        for sep in ["=", ":"] {
            let marker = format!("{key}{sep}");
            let mut offset = 0;
            while offset < redacted.len() {
                let Some(relative_start) = redacted[offset..].find(&marker) else {
                    break;
                };
                let start = offset + relative_start;
                let value_start = start + marker.len();
                let value_end = redacted[value_start..]
                    .find(|c: char| {
                        c.is_whitespace() || c == '\'' || c == '"' || c == ',' || c == '&'
                    })
                    .map(|i| value_start + i)
                    .unwrap_or(redacted.len());
                redacted.replace_range(value_start..value_end, "[REDACTED]");
                offset = value_start + "[REDACTED]".len();
            }
        }
    }
    redacted
}

fn contains_any(haystack: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| haystack.contains(needle))
}

fn extract_goal_signal(prompt: &str) -> Option<&str> {
    let marker = "Goal:\n";
    let start = prompt.rfind(marker)? + marker.len();
    let rest = &prompt[start..];
    Some(rest.split("\n\nLedger:").next().unwrap_or(rest).trim()).filter(|goal| !goal.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env_lock() -> std::sync::MutexGuard<'static, ()> {
        static ENV_LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
        ENV_LOCK
            .get_or_init(|| std::sync::Mutex::new(()))
            .lock()
            .unwrap()
    }

    fn clear_env() {
        for key in [
            "BROWNIE_LLM_PROVIDER",
            "BROWNIE_LLM_BASE_URL",
            "BROWNIE_LLM_MODEL",
            "BROWNIE_LLM_API_KEY_ENV",
            "BROWNIE_LLM_API_KEY",
            "BROWNIE_LLM_MAX_TOKENS",
        ] {
            env::remove_var(key);
        }
    }

    #[test]
    fn sensitive_scanner_classifies_prompt_content_without_serializing_values() {
        let github_token_like = format!("ghp_{}", "123456789012345678901234567890123456");
        let messages = vec![
            LlmMessage {
                role: "user".into(),
                content: "Authorization: Bearer sk-secretvalue".into(),
            },
            LlmMessage {
                role: "user".into(),
                content: format!(
                    "api_key=supersecret\n-----BEGIN PRIVATE KEY-----\n{github_token_like}\nsk-testkeywithsufficientlength"
                ),
            },
        ];
        let result = scan_prompt_for_sensitive_content(&messages);
        let categories: Vec<_> = result
            .findings
            .iter()
            .map(|f| (f.category.as_str(), f.message_index))
            .collect();
        assert!(categories.contains(&("authorization_header", 0)));
        assert!(categories.contains(&("api_key_assignment", 1)));
        assert!(categories.contains(&("private_key_block", 1)));
        assert!(categories.contains(&("github_token_like", 1)));
        assert!(categories.contains(&("openai_key_like", 1)));
        let serialized = serde_json::to_string(&result).unwrap();
        assert!(!serialized.contains("supersecret"));
        assert!(!serialized.contains("sk-secretvalue"));
        assert!(!serialized.contains(&github_token_like));
    }

    #[test]
    fn sensitive_scanner_does_not_treat_words_ending_in_sk_dash_as_openai_keys() {
        let messages = vec![LlmMessage {
            role: "user".into(),
            content:
                "Task-pinned ModePack policy remains authoritative; disk-full checks stay open."
                    .into(),
        }];
        let result = scan_prompt_for_sensitive_content(&messages);
        assert!(
            !result
                .findings
                .iter()
                .any(|finding| finding.category == "openai_key_like"),
            "ordinary words containing sk- must not be treated as OpenAI API keys"
        );
    }

    #[test]
    fn non_prompt_text_scanner_still_detects_sensitive_like_file_content() {
        let result = scan_text_for_sensitive_content(
            "Authorization: Bearer sk-secretvalue\napi_key=supersecret\n-----BEGIN PRIVATE KEY-----",
        );
        let categories: Vec<_> = result
            .findings
            .iter()
            .map(|f| f.category.as_str())
            .collect();
        assert!(categories.contains(&"authorization_header"));
        assert!(categories.contains(&"api_key_assignment"));
        assert!(categories.contains(&"private_key_block"));
        let serialized = serde_json::to_string(&result).unwrap();
        assert!(!serialized.contains("supersecret"));
        assert!(!serialized.contains("sk-secretvalue"));
    }

    #[test]
    fn sensitive_guard_fail_blocks_prompt_findings_before_provider_calls() {
        let messages = vec![LlmMessage {
            role: "user".into(),
            content: "access_token=secret".into(),
        }];
        assert!(enforce_prompt_sensitive_guard(&messages, PromptSensitiveGuardMode::Fail).is_err());
        assert!(enforce_prompt_sensitive_guard(&messages, PromptSensitiveGuardMode::Warn).is_ok());
        assert!(enforce_prompt_sensitive_guard(&messages, PromptSensitiveGuardMode::Off).is_ok());
    }

    #[test]
    fn fake_provider_returns_status_and_deterministic_response() {
        let provider = FakeLlmProvider;
        assert_eq!(provider.status().provider, LlmProviderKind::Fake);
        let request = LlmRequest {
            model: FAKE_LLM_MODEL.into(),
            messages: vec![LlmMessage {
                role: "user".into(),
                content: "user".into(),
            }],
        };
        let content = provider
            .complete(&request, &LlmRequestBudget::default())
            .unwrap()
            .content;
        assert!(content.starts_with("Fake LLM completed request with 1 messages."));
    }

    #[test]
    fn fake_llm_returns_deterministic_response() {
        let request = LlmRequest {
            model: FAKE_LLM_MODEL.into(),
            messages: vec![
                LlmMessage {
                    role: "system".into(),
                    content: "system".into(),
                },
                LlmMessage {
                    role: "user".into(),
                    content: "user".into(),
                },
            ],
        };
        let content = FakeLlm::complete(&request).content;
        assert!(content.starts_with("Fake LLM completed request with 2 messages."));
        assert!(content.contains("```brownie-tool-intent"));
        assert!(content.contains("workspace.read"));
        assert!(content.contains(r#""path": "README.md""#));
    }

    #[test]
    fn fake_llm_requests_controlled_fmt_verifier_for_formatting_goals() {
        let request = LlmRequest {
            model: FAKE_LLM_MODEL.into(),
            messages: vec![LlmMessage {
                role: "user".into(),
                content: "Please verify formatting.".into(),
            }],
        };
        let content = FakeLlm::complete(&request).content;
        assert!(content.contains("verification.cargo_fmt_check"));
        assert!(!content.contains("process.exec"));
    }

    #[test]
    fn fake_llm_requests_controlled_cargo_check_verifier_for_compile_goals() {
        let request = LlmRequest {
            model: FAKE_LLM_MODEL.into(),
            messages: vec![LlmMessage {
                role: "user".into(),
                content: "Please compile and type-check the Rust workspace.".into(),
            }],
        };
        let content = FakeLlm::complete(&request).content;
        assert!(content.contains("verification.cargo_check"));
        assert!(!content.contains("verification.cargo_fmt_check"));
        assert!(!content.contains("process.exec"));
    }

    #[test]
    fn fake_llm_requests_controlled_cargo_test_verifier_for_test_goals() {
        let request = LlmRequest {
            model: FAKE_LLM_MODEL.into(),
            messages: vec![LlmMessage {
                role: "user".into(),
                content: "Please run tests for the Rust workspace.".into(),
            }],
        };
        let content = FakeLlm::complete(&request).content;
        assert!(content.contains("verification.cargo_test"));
        assert!(!content.contains("verification.cargo_check"));
        assert!(!content.contains("process.exec"));
    }

    #[test]
    fn fake_llm_second_pass_returns_final_response_without_tool_intent() {
        let request = LlmRequest {
            model: FAKE_LLM_MODEL.into(),
            messages: vec![LlmMessage {
                role: "user".into(),
                content:
                    "Tool Execution:\n- workspace.read: Completed bytes_read=42 truncated=false"
                        .into(),
            }],
        };
        let content = FakeLlm::complete(&request).content;
        assert_eq!(
            content,
            "Fake LLM final response after reading workspace context."
        );
        assert!(!content.contains("brownie-tool-intent"));
    }

    #[test]
    fn openai_config_disabled_when_required_env_missing() {
        let _env = env_lock();
        clear_env();
        env::set_var("BROWNIE_LLM_PROVIDER", "openai-compatible");
        match OpenAiCompatibleLlmProvider::from_env() {
            OpenAiCompatibleConfigFromEnv::Disabled(status) => {
                assert_eq!(status.provider, LlmProviderKind::OpenAiCompatible);
                assert!(!status.enabled);
                assert!(status.reason.unwrap().contains("missing config"));
            }
            OpenAiCompatibleConfigFromEnv::Enabled(_) => panic!("expected disabled config"),
        }
        clear_env();
    }

    #[test]
    fn openai_config_uses_bounded_default_and_env_max_tokens() {
        let _env = env_lock();
        clear_env();
        env::set_var("BROWNIE_LLM_PROVIDER", "openai-compatible");
        env::set_var("BROWNIE_LLM_BASE_URL", "http://127.0.0.1:1/v1");
        env::set_var("BROWNIE_LLM_MODEL", "qwen35-MTP");
        env::set_var("BROWNIE_LLM_API_KEY", "local");
        match OpenAiCompatibleLlmProvider::from_env() {
            OpenAiCompatibleConfigFromEnv::Enabled(config) => {
                assert_eq!(config.max_tokens, OPENAI_COMPATIBLE_DEFAULT_MAX_TOKENS);
            }
            OpenAiCompatibleConfigFromEnv::Disabled(status) => {
                panic!("expected enabled config: {:?}", status.reason)
            }
        }

        env::set_var("BROWNIE_LLM_MAX_TOKENS", "512");
        match OpenAiCompatibleLlmProvider::from_env() {
            OpenAiCompatibleConfigFromEnv::Enabled(config) => {
                assert_eq!(config.max_tokens, 512);
            }
            OpenAiCompatibleConfigFromEnv::Disabled(status) => {
                panic!("expected enabled config: {:?}", status.reason)
            }
        }

        env::set_var("BROWNIE_LLM_MAX_TOKENS", "0");
        match OpenAiCompatibleLlmProvider::from_env() {
            OpenAiCompatibleConfigFromEnv::Disabled(status) => {
                assert_eq!(
                    status.reason.as_deref(),
                    Some("invalid BROWNIE_LLM_MAX_TOKENS")
                );
            }
            OpenAiCompatibleConfigFromEnv::Enabled(_) => panic!("expected disabled config"),
        }
        clear_env();
    }

    #[test]
    fn openai_config_rejects_unsafe_base_url_components() {
        let _env = env_lock();
        for base_url in [
            "ftp://127.0.0.1:1/v1",
            "http://user:pass@127.0.0.1:1/v1",
            "http://127.0.0.1:1/v1?api_key=secret",
            "http://127.0.0.1:1/v1#fragment",
        ] {
            clear_env();
            env::set_var("BROWNIE_LLM_PROVIDER", "openai-compatible");
            env::set_var("BROWNIE_LLM_BASE_URL", base_url);
            env::set_var("BROWNIE_LLM_MODEL", "qwen35-MTP");
            env::set_var("BROWNIE_LLM_API_KEY", "local");
            assert!(matches!(
                OpenAiCompatibleLlmProvider::from_env(),
                OpenAiCompatibleConfigFromEnv::Disabled(_)
            ));
        }
        clear_env();
    }

    #[test]
    fn openai_endpoint_preserves_configured_origin() {
        let endpoint =
            openai_compatible_endpoint("http://127.0.0.1:4141/base/v1", "chat/completions")
                .unwrap();
        assert_eq!(endpoint, "http://127.0.0.1:4141/base/v1/chat/completions");
        assert!(
            openai_compatible_endpoint("http://user@127.0.0.1:4141/v1", "chat/completions")
                .is_err()
        );
    }

    #[test]
    fn openai_request_does_not_follow_redirects() {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        use std::thread;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buf = [0_u8; 1024];
            let _ = stream.read(&mut buf).unwrap();
            stream
                .write_all(
                    b"HTTP/1.1 302 Found\r\nlocation: http://example.invalid/v1/chat/completions\r\ncontent-length: 0\r\n\r\n",
                )
                .unwrap();
        });
        let provider = OpenAiCompatibleLlmProvider::new(
            OpenAiCompatibleConfig {
                base_url: format!("http://{addr}/v1"),
                model: "qwen35-MTP".into(),
                api_key_env: "BROWNIE_LLM_API_KEY".into(),
                max_tokens: 512,
            },
            "local".into(),
        );
        let request = LlmRequest {
            model: "qwen35-MTP".into(),
            messages: vec![LlmMessage {
                role: "user".into(),
                content: "Hello".into(),
            }],
        };
        let error = provider
            .complete(&request, &LlmRequestBudget::default())
            .expect_err("redirect must not be followed as a successful provider response");
        assert!(error.to_string().contains("non-2xx HTTP status 302"));
        server.join().unwrap();
    }

    #[test]
    fn openai_request_includes_generation_parameters() {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        use std::sync::mpsc;
        use std::thread;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let (tx, rx) = mpsc::channel();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buffer = Vec::new();
            let mut temp = [0_u8; 1024];
            let header_end = loop {
                let read = stream.read(&mut temp).unwrap();
                assert!(read > 0, "client closed before request body");
                buffer.extend_from_slice(&temp[..read]);
                if let Some(index) = buffer.windows(4).position(|w| w == b"\r\n\r\n") {
                    break index + 4;
                }
            };
            let headers = String::from_utf8_lossy(&buffer[..header_end]).to_string();
            let content_length = headers
                .lines()
                .find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    name.eq_ignore_ascii_case("content-length")
                        .then(|| value.trim().parse::<usize>().unwrap())
                })
                .unwrap();
            while buffer.len() < header_end + content_length {
                let read = stream.read(&mut temp).unwrap();
                assert!(read > 0, "client closed before full request body");
                buffer.extend_from_slice(&temp[..read]);
            }
            let body = String::from_utf8(buffer[header_end..header_end + content_length].to_vec())
                .unwrap();
            tx.send((headers, body)).unwrap();
            let response_body = r#"{"choices":[{"message":{"content":"Hello from local model"}}]}"#;
            write!(
                stream,
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\r\n{}",
                response_body.len(),
                response_body
            )
            .unwrap();
        });

        let provider = OpenAiCompatibleLlmProvider::new(
            OpenAiCompatibleConfig {
                base_url: format!("http://{addr}/v1"),
                model: "qwen35-MTP".to_string(),
                api_key_env: "BROWNIE_LLM_API_KEY".to_string(),
                max_tokens: 4_096,
            },
            "local".to_string(),
        );
        let request = LlmRequest {
            model: "qwen35-MTP".to_string(),
            messages: vec![LlmMessage {
                role: "user".to_string(),
                content: "Hello".to_string(),
            }],
        };

        let response = provider
            .complete(&request, &LlmRequestBudget::default())
            .unwrap();
        assert_eq!(response.content, "Hello from local model");
        let (headers, body) = rx.recv().unwrap();
        assert!(headers.starts_with("POST /v1/chat/completions "));
        assert!(headers.contains("authorization: Bearer local"));
        let body: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(body["model"], "qwen35-MTP");
        assert_eq!(body["messages"][0]["role"], "user");
        assert_eq!(body["messages"][0]["content"], "Hello");
        assert_eq!(body["max_tokens"], 4_096);
        assert_eq!(body["temperature"], 0);
        assert_eq!(body["stream"], false);
        server.join().unwrap();
    }

    #[test]
    fn redacts_bearer_tokens() {
        let redacted = redact_secret("Authorization: Bearer secret-token-123 failed");
        assert!(!redacted.contains("secret-token-123"));
        assert!(redacted.contains("[REDACTED"));
    }

    #[test]
    fn redacts_common_secret_patterns() {
        assert_eq!(redact_secret("Authorization: Bearer abc123"), "[REDACTED]");
        assert_eq!(redact_secret("Bearer abc123"), "[REDACTED]");
        assert_eq!(redact_secret("api_key=abc123"), "api_key=[REDACTED]");
        assert_eq!(redact_secret("token=abc123"), "token=[REDACTED]");
        assert_eq!(redact_secret("key=abc123"), "key=[REDACTED]");
        assert_eq!(
            redact_secret("https://example.test/v1?api_key=abc123"),
            "https://example.test/v1?[REDACTED]"
        );
    }
}
