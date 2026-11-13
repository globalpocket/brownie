use serde_json::Value;
use std::{ffi::OsString, sync::Mutex};

static ENV_LOCK: Mutex<()> = Mutex::new(());
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

use serde_json::json;
fn rpc(method: &str, params: Value) -> Value {
    let input = json!({"jsonrpc":"2.0", "id":1, "method":method, "params":params});
    let text = brownie_runtime::handle_jsonrpc_input_line(&input.to_string()).unwrap();
    serde_json::from_str(&text).unwrap()
}
fn check(source: &str, strict: bool, allowed: bool, configured_fake: bool) {
    let _lock = ENV_LOCK.lock().unwrap_or_else(|poison| poison.into_inner());
    let _environment = Environment::isolated();
    let workspace = tempfile::tempdir().unwrap();
    std::env::set_var("BROWNIE_WORKSPACE_ROOT", workspace.path());
    std::env::set_var(
        "BROWNIE_LLM_ALLOW_TASK_RUN_NETWORK",
        if allowed { "true" } else { "false" },
    );
    std::env::set_var(
        "BROWNIE_LLM_ALLOW_PROVIDER_ACCESS",
        if allowed { "true" } else { "false" },
    );
    std::env::set_var(
        "BROWNIE_LLM_API_KEY",
        "SYNTHETIC_STATUS_FIXTURE_NOT_A_CREDENTIAL",
    );
    if source == "env" {
        std::env::set_var(
            "BROWNIE_LLM_PROVIDER",
            if configured_fake {
                "fake"
            } else {
                "openai-compatible"
            },
        );
        std::env::set_var("BROWNIE_LLM_BASE_URL", "http://127.0.0.1:9/v1");
        std::env::set_var("BROWNIE_LLM_MODEL", "status-fixture-no-network");
        std::env::set_var("BROWNIE_LLM_STRICT", if strict { "true" } else { "false" });
    } else {
        std::fs::create_dir_all(workspace.path().join(".brownie")).unwrap();
        let profile = if configured_fake {
            json!({"provider":"fake"})
        } else {
            json!({"provider":"openai-compatible", "base_url":"http://127.0.0.1:9/v1", "model":"status-fixture-no-network", "strict":strict})
        };
        std::fs::write(
            workspace.path().join(".brownie/config.json"),
            json!({"version":1,"active_profile":"fixture","llm":{"profiles":{"fixture":profile}}})
                .to_string(),
        )
        .unwrap();
    }
    let expected_fallback = !configured_fake && !strict;
    let status = rpc("llm.status", json!({}));
    assert!(status.get("error").is_none(), "{status}");
    assert_eq!(status["result"]["enabled"], true, "{status}");
    assert_eq!(
        status["result"]["will_fallback_to_fake"], expected_fallback,
        "{status}"
    );
    let diagnostics = rpc("runtime.diagnostics.get", json!({}));
    assert_eq!(
        diagnostics["result"]["llm_status"]["will_fallback_to_fake"], expected_fallback,
        "{diagnostics}"
    );
    let start = rpc(
        "task.start",
        json!({"goal":"Check status against the actual fixture request provider", "mode_id":"orchestrator"}),
    );
    assert!(start.get("error").is_none(), "{start}");
    let run = rpc("task.run", json!({"task_id":start["result"]["task_id"]}));
    let events = rpc("run.events", json!({"run_id":start["result"]["run_id"]}));
    let providers: Vec<_> = events["result"]["events"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|event| event["kind"] == "LlmRequestCreated")
        .map(|event| &event["payload"]["provider"])
        .collect();
    if configured_fake || !strict {
        assert!(!providers.is_empty(), "{events}");
        assert!(
            providers.iter().all(|provider| **provider == "Fake"),
            "{events}"
        );
        assert_ne!(run["result"]["status"], "Failed", "{run}");
    } else {
        assert!(!allowed);
        assert_eq!(run["result"]["status"], "Failed", "{run}");
        assert!(
            providers.is_empty(),
            "strict denied access cannot silently use Fake: {events}"
        );
    }
    assert!(!workspace.path().join("README.md").exists());
}
#[test]
fn env_non_strict_with_access_denied_reports_actual_fallback() {
    check("env", false, false, false);
}
#[test]
fn env_non_strict_with_access_allowed_reports_actual_fallback() {
    check("env", false, true, false);
}
#[test]
fn workspace_non_strict_with_access_denied_reports_actual_fallback() {
    check("workspace", false, false, false);
}
#[test]
fn workspace_non_strict_with_access_allowed_reports_actual_fallback() {
    check("workspace", false, true, false);
}
#[test]
fn env_strict_denied_access_never_falls_back() {
    check("env", true, false, false);
}
#[test]
fn workspace_strict_denied_access_never_falls_back() {
    check("workspace", true, false, false);
}
#[test]
fn explicitly_configured_env_fake_is_not_a_fallback() {
    check("env", false, false, true);
}
#[test]
fn explicitly_configured_workspace_fake_is_not_a_fallback() {
    check("workspace", false, false, true);
}
