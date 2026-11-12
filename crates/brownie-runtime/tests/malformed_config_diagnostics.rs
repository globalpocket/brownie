use serde_json::{json, Value};
use std::{ffi::OsString, sync::Mutex};
static ENV_LOCK: Mutex<()> = Mutex::new(());
const MARKER: &str = "SYNTHETIC_DIAGNOSTIC_VALUE_NOT_A_REAL_SECRET";
struct Environment(Vec<(OsString, OsString)>);
impl Environment {
    fn isolated() -> Self {
        let saved: Vec<_> = std::env::vars_os()
            .filter(|(key, _)| key.to_str().is_some_and(|key| key.starts_with("BROWNIE_")))
            .collect();
        for (key, _) in &saved {
            std::env::remove_var(key);
        }
        Self(saved)
    }
}
impl Drop for Environment {
    fn drop(&mut self) {
        for (key, _) in std::env::vars_os()
            .filter(|(key, _)| key.to_str().is_some_and(|key| key.starts_with("BROWNIE_")))
        {
            std::env::remove_var(key);
        }
        for (key, value) in &self.0 {
            std::env::set_var(key, value);
        }
    }
}
fn diagnostics(content: Option<String>, directory: bool) -> Value {
    let workspace = tempfile::tempdir().unwrap();
    std::fs::create_dir(workspace.path().join(".brownie")).unwrap();
    let path = workspace.path().join(".brownie/config.json");
    if directory {
        std::fs::create_dir(&path).unwrap();
    } else if let Some(content) = content {
        std::fs::write(&path, content).unwrap();
    }
    std::env::set_var("BROWNIE_WORKSPACE_ROOT", workspace.path());
    let text = brownie_runtime::handle_jsonrpc_input_line(
        r#"{"jsonrpc":"2.0","id":1,"method":"runtime.diagnostics.get"}"#,
    )
    .unwrap();
    assert!(
        !text.contains(MARKER),
        "configuration values must never be reflected in diagnostics"
    );
    let response: Value = serde_json::from_str(&text).unwrap();
    assert!(response.get("error").is_none(), "{response}");
    response["result"].clone()
}
fn malformed(content: Option<String>, directory: bool, message: &str) {
    let _lock = ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let _env = Environment::isolated();
    let result = diagnostics(content, directory);
    let rows = result["diagnostics"].as_array().unwrap();
    let malformed: Vec<_> = rows
        .iter()
        .filter(|d| d["code"] == "CONFIG_MALFORMED")
        .collect();
    assert_eq!(malformed.len(), 1, "{result}");
    assert_eq!(malformed[0]["message"], message);
    assert_eq!(result["llm_status"]["provider"], "Unknown");
    assert_eq!(result["llm_status"]["enabled"], false);
    assert_eq!(result["llm_status"]["will_fallback_to_fake"], false);
}
fn profile(provider: Value, strict: Value) -> String {
    json!({"version":1,"active_profile":"fixture","llm":{"profiles":{"fixture":{"provider":provider,"base_url":"http://127.0.0.1:9/v1","model":"fixture","strict":strict}}}}).to_string()
}
#[test]
fn unknown_provider_never_reflects_schema_error_values() {
    malformed(
        Some(profile(
            json!(format!("Authorization: Bearer {MARKER}")),
            json!(true),
        )),
        false,
        "Failed to validate .brownie/config.json.",
    );
}
#[test]
fn invalid_strict_type_never_reflects_schema_error_values() {
    malformed(
        Some(profile(json!("openai-compatible"), json!(MARKER))),
        false,
        "Failed to validate .brownie/config.json.",
    );
}
#[test]
fn invalid_version_type_never_reflects_schema_error_values() {
    malformed(
        Some(json!({"version":MARKER,"active_profile":null,"llm":null}).to_string()),
        false,
        "Failed to validate .brownie/config.json.",
    );
}
#[test]
fn syntax_errors_use_fixed_sanitized_diagnostics() {
    malformed(
        Some(format!("{{\"value\":\"{MARKER}\",")),
        false,
        "Failed to parse .brownie/config.json.",
    );
}
#[test]
fn unreadable_configuration_uses_fixed_sanitized_diagnostics() {
    malformed(None, true, "Failed to read .brownie/config.json.");
}
#[test]
fn valid_workspace_configuration_retains_provider_selection() {
    let _lock = ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let _env = Environment::isolated();
    let result = diagnostics(Some(profile(json!("fake"), json!(false))), false);
    assert_eq!(result["llm_status"]["provider"], "Fake");
    assert_eq!(result["llm_status"]["enabled"], true);
    assert!(result["diagnostics"]
        .as_array()
        .unwrap()
        .iter()
        .any(|d| d["code"] == "PROVIDER_WORKSPACE_PROFILE"));
    assert!(!result["diagnostics"]
        .as_array()
        .unwrap()
        .iter()
        .any(|d| d["code"] == "CONFIG_MALFORMED"));
}
