//! Workspace-local Brownie runtime configuration.

use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

use anyhow::{bail, Context, Result};
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
    },
    #[serde(rename = "openai-compatible")]
    OpenAiCompatible {
        base_url: String,
        model: String,
        api_key_env: Option<String>,
        strict: Option<bool>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
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
}
