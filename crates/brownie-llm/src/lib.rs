//! LLM client abstraction crate.

use std::{env, time::Duration};

use anyhow::anyhow;
use serde::{Deserialize, Serialize};

pub const OPENAI_COMPATIBLE_API_VERSION: &str = "v1";
pub const FAKE_LLM_MODEL: &str = "brownie-fake-llm";

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
    fn complete(&self, request: &LlmRequest) -> anyhow::Result<LlmResponse>;
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

    fn complete(&self, request: &LlmRequest) -> anyhow::Result<LlmResponse> {
        Ok(FakeLlm::complete(request))
    }
}

#[derive(Debug, Clone)]
pub struct OpenAiCompatibleLlmProvider {
    config: OpenAiCompatibleConfig,
    api_key: String,
    timeout: Duration,
}

impl OpenAiCompatibleLlmProvider {
    pub fn new(config: OpenAiCompatibleConfig, api_key: String) -> Self {
        Self {
            config,
            api_key,
            timeout: Duration::from_secs(30),
        }
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

    fn complete(&self, request: &LlmRequest) -> anyhow::Result<LlmResponse> {
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
            .timeout(self.timeout)
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
        let content = provider.complete(&request).unwrap().content;
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
