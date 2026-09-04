//! Workspace-local Brownie runtime configuration.

use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

use anyhow::{bail, Context, Result};
use brownie_llm::{
    validate_llm_request_budget, validate_openai_compatible_max_tokens, LlmRequestBudget,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const CONFIG_RELATIVE_PATH: &str = ".brownie/config.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BrownieConfig {
    pub version: u32,
    pub active_profile: Option<String>,
    pub llm: Option<LlmConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LlmConfig {
    pub profiles: BTreeMap<String, LlmProfile>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "provider", rename_all = "kebab-case")]
pub enum LlmProfile {
    Fake {
        model: Option<String>,
        budget: Option<LlmRequestBudgetConfig>,
        sensitive_guard: Option<String>,
    },
    #[serde(rename = "openai-compatible")]
    OpenAiCompatible {
        base_url: String,
        model: String,
        api_key_env: Option<String>,
        strict: Option<bool>,
        #[serde(default, alias = "maxTokens")]
        max_tokens: Option<u32>,
        budget: Option<LlmRequestBudgetConfig>,
        sensitive_guard: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct LlmRequestBudgetConfig {
    pub max_prompt_chars: Option<usize>,
    pub max_messages: Option<usize>,
    pub request_timeout_ms: Option<u64>,
    pub response_preview_chars: Option<usize>,
}

impl LlmRequestBudgetConfig {
    pub fn apply_to(&self, mut budget: LlmRequestBudget) -> LlmRequestBudget {
        if let Some(v) = self.max_prompt_chars {
            budget.max_prompt_chars = v;
        }
        if let Some(v) = self.max_messages {
            budget.max_messages = v;
        }
        if let Some(v) = self.request_timeout_ms {
            budget.request_timeout_ms = v;
        }
        if let Some(v) = self.response_preview_chars {
            budget.response_preview_chars = v;
        }
        budget
    }
}

pub struct RuntimeConfigLoadResult {
    pub config: Option<BrownieConfig>,
    pub path: PathBuf,
}

pub struct RuntimeConfigLoader;

impl RuntimeConfigLoader {
    pub fn load_from_workspace(workspace_root: &Path) -> Result<Option<BrownieConfig>> {
        let path = workspace_root.join(CONFIG_RELATIVE_PATH);
        if !path.exists() {
            return Ok(None);
        }
        let content = fs::read_to_string(&path)
            .with_context(|| format!("failed to read {}", CONFIG_RELATIVE_PATH))?;
        let value: Value = serde_json::from_str(&content)
            .with_context(|| format!("failed to parse {}", CONFIG_RELATIVE_PATH))?;
        reject_direct_api_key(&value)?;
        let config: BrownieConfig = serde_json::from_value(value)
            .with_context(|| format!("failed to validate {}", CONFIG_RELATIVE_PATH))?;
        validate_config(&config)?;
        Ok(Some(config))
    }
}

pub fn validate_config(config: &BrownieConfig) -> Result<()> {
    if config.version != 1 {
        bail!("unsupported runtime config version: {}", config.version);
    }
    if let Some(active) = config.active_profile.as_deref() {
        let Some(llm) = &config.llm else {
            bail!("active_profile references missing llm profiles");
        };
        if !llm.profiles.contains_key(active) {
            bail!("active_profile references unknown profile: {active}");
        }
    }
    if let Some(llm) = &config.llm {
        for (name, profile) in &llm.profiles {
            let budget = match profile {
                LlmProfile::Fake {
                    budget,
                    sensitive_guard,
                    ..
                } => {
                    if let Some(value) = sensitive_guard {
                        if brownie_llm::PromptSensitiveGuardMode::parse(value).is_none() {
                            anyhow::bail!("invalid sensitive_guard for profile {name}: expected off, warn, or fail");
                        }
                    }
                    budget
                }
                LlmProfile::OpenAiCompatible {
                    budget,
                    sensitive_guard,
                    max_tokens,
                    ..
                } => {
                    if let Some(value) = sensitive_guard {
                        if brownie_llm::PromptSensitiveGuardMode::parse(value).is_none() {
                            anyhow::bail!("invalid sensitive_guard for profile {name}: expected off, warn, or fail");
                        }
                    }
                    if let Some(max_tokens) = max_tokens {
                        validate_openai_compatible_max_tokens(*max_tokens).map_err(|e| {
                            anyhow::anyhow!(
                                "invalid openai-compatible max_tokens for profile {name}: {e}"
                            )
                        })?;
                    }
                    budget
                }
            };
            if let Some(budget) = budget {
                let resolved = budget.apply_to(LlmRequestBudget::default());
                validate_llm_request_budget(&resolved)
                    .map_err(|e| anyhow::anyhow!("invalid llm budget for profile {name}: {e}"))?;
            }
        }
    }
    Ok(())
}

fn reject_direct_api_key(value: &Value) -> Result<()> {
    match value {
        Value::Object(map) => {
            if map.contains_key("api_key") {
                bail!("direct api_key fields are not allowed; use api_key_env");
            }
            for child in map.values() {
                reject_direct_api_key(child)?;
            }
        }
        Value::Array(items) => {
            for child in items {
                reject_direct_api_key(child)?;
            }
        }
        _ => {}
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_direct_api_key_without_secret_value() {
        let err = reject_direct_api_key(&serde_json::json!({"api_key":"DO_NOT_ALLOW"}))
            .unwrap_err()
            .to_string();
        assert!(err.contains("api_key"));
        assert!(!err.contains("DO_NOT_ALLOW"));
    }

    #[test]
    fn openai_profile_accepts_max_tokens_alias_and_rejects_out_of_bounds() {
        let config: BrownieConfig = serde_json::from_value(serde_json::json!({
            "version": 1,
            "active_profile": "qwen-lan",
            "llm": {
                "profiles": {
                    "qwen-lan": {
                        "provider": "openai-compatible",
                        "base_url": "http://127.0.0.1:8080/v1",
                        "model": "qwen35-MTP",
                        "api_key_env": "BROWNIE_LLM_API_KEY",
                        "strict": true,
                        "maxTokens": 4096
                    }
                }
            }
        }))
        .unwrap();
        validate_config(&config).unwrap();
        let profile = config
            .llm
            .as_ref()
            .unwrap()
            .profiles
            .get("qwen-lan")
            .unwrap();
        let LlmProfile::OpenAiCompatible { max_tokens, .. } = profile else {
            panic!("expected openai-compatible profile");
        };
        assert_eq!(*max_tokens, Some(4096));

        let invalid: BrownieConfig = serde_json::from_value(serde_json::json!({
            "version": 1,
            "active_profile": "bad",
            "llm": {
                "profiles": {
                    "bad": {
                        "provider": "openai-compatible",
                        "base_url": "http://127.0.0.1:8080/v1",
                        "model": "qwen35-MTP",
                        "api_key_env": "BROWNIE_LLM_API_KEY",
                        "max_tokens": 0
                    }
                }
            }
        }))
        .unwrap();
        let error = validate_config(&invalid).unwrap_err().to_string();
        assert!(error.contains("max_tokens"));
    }
}
