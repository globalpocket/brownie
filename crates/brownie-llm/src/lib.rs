//! LLM client abstraction crate.

use std::{
    env,
    time::{Duration, Instant},
};

use anyhow::anyhow;
use serde::{Deserialize, Serialize};

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
        let content = message.content.as_str();
        let lower = content.to_ascii_lowercase();
        let checks = [
            (
                "authorization_header",
                lower.contains("authorization: bearer "),
            ),
            (
                "bearer_token",
                lower.contains("bearer sk-")
                    || lower.contains("bearer ghp_")
                    || lower.contains("bearer github_pat_"),
            ),
            (
                "api_key_assignment",
                contains_assignment(&lower, &["api_key", "apikey", "api-key"]),
            ),
            (
                "access_token_assignment",
                contains_assignment(&lower, &["access_token", "access-token"]),
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
                contains_assignment(
                    &lower,
                    &[
                        "aws_secret_access_key",
                        "secret_key",
                        "client_secret",
                        "password",
                    ],
                ),
            ),
            (
                "github_token_like",
                content.contains("ghp_") || content.contains("github_pat_"),
            ),
            ("openai_key_like", content.contains("sk-")),
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
    PromptSensitiveScanResult { findings }
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

fn contains_assignment(lower: &str, names: &[&str]) -> bool {
    names.iter().any(|name| {
        lower.contains(&format!("{name}="))
            || lower.contains(&format!("{name}:"))
            || lower.contains(&format!("{name} ="))
            || lower.contains(&format!("{name}: "))
    })
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
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OpenAiCompatibleConfigFromEnv {
    Enabled(OpenAiCompatibleConfig),
    Disabled(LlmProviderStatus),
}

pub struct FakeLlm;

impl FakeLlm {
    pub fn complete(request: &LlmRequest) -> LlmResponse {
        let prompt = request
            .messages
            .iter()
            .map(|message| message.content.as_str())
            .collect::<Vec<_>>()
            .join("\n")
            .to_lowercase();
        if prompt.contains("tool execution:")
            && prompt.contains("workspace.read")
            && (prompt.contains("completed") || prompt.contains("bytes_read="))
        {
            return LlmResponse {
                content: "Fake LLM final response after reading workspace context.".to_string(),
            };
        }

        let mut requests = vec![(
            "workspace.read",
            "Inspect workspace context before proceeding.",
        )];
        if contains_any(&prompt, &["implement", "edit", "修正", "実装"]) {
            requests.push(("workspace.write", "Need to edit workspace files."));
        }
        if contains_any(
            &prompt,
            &["test", "check", "verify", "検証", "テスト", "実行"],
        ) {
            requests.push(("process.exec", "Need to run verification commands."));
        }
        if prompt.contains("orchestrator") {
            requests.push((
                "subtask.spawn",
                "Orchestrator mode may coordinate subtasks.",
            ));
        }
        let tool_requests = requests
            .into_iter()
            .map(|(tool_id, reason)| {
                if tool_id == "workspace.read" {
                    serde_json::json!({ "tool_id": tool_id, "reason": reason, "input": { "path": "README.md" } })
                } else if tool_id == "workspace.write" {
                    serde_json::json!({ "tool_id": tool_id, "reason": reason, "input": { "path": "README.md", "operation": "replace_file", "content": "new README content" } })
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
        OpenAiCompatibleConfigFromEnv::Enabled(OpenAiCompatibleConfig {
            base_url: base_url.expect("checked"),
            model: model.expect("checked"),
            api_key_env,
        })
    }

    pub fn probe_models(&self, timeout: Duration) -> LlmHealthProbeResult {
        let started = Instant::now();
        let url = format!("{}/models", self.config.base_url.trim_end_matches('/'));
        let client = match reqwest::blocking::Client::builder()
            .no_proxy()
            .timeout(timeout)
            .build()
        {
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
        match client.get(url).bearer_auth(&self.api_key).send() {
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
            "{}/chat/completions",
            self.config.base_url.trim_end_matches('/')
        );
        let client = reqwest::blocking::Client::builder()
            .no_proxy()
            .timeout(Duration::from_millis(budget.request_timeout_ms))
            .build()
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
            .json(&serde_json::json!({ "model": request.model, "messages": request.messages }))
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

#[cfg(test)]
mod tests {
    use super::*;

    fn clear_env() {
        for key in [
            "BROWNIE_LLM_PROVIDER",
            "BROWNIE_LLM_BASE_URL",
            "BROWNIE_LLM_MODEL",
            "BROWNIE_LLM_API_KEY_ENV",
            "BROWNIE_LLM_API_KEY",
        ] {
            env::remove_var(key);
        }
    }

    #[test]
    fn sensitive_scanner_detects_secret_like_content_without_values() {
        let messages = vec![
            LlmMessage {
                role: "user".into(),
                content: "Authorization: Bearer sk-secretvalue".into(),
            },
            LlmMessage {
                role: "user".into(),
                content: "api_key=supersecret\n-----BEGIN PRIVATE KEY-----\nghp_secret".into(),
            },
        ];
        let result = scan_prompt_for_sensitive_content(&messages);
        let categories: Vec<_> = result
            .findings
            .iter()
            .map(|f| f.category.as_str())
            .collect();
        assert!(categories.contains(&"authorization_header"));
        assert!(categories.contains(&"api_key_assignment"));
        assert!(categories.contains(&"private_key_block"));
        assert!(categories.contains(&"github_token_like"));
        let serialized = serde_json::to_string(&result).unwrap();
        assert!(!serialized.contains("supersecret"));
        assert!(!serialized.contains("sk-secretvalue"));
        assert!(!serialized.contains("ghp_secret"));
    }

    #[test]
    fn sensitive_guard_fail_blocks_and_warn_allows() {
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
