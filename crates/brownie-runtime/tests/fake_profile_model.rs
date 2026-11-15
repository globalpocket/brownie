use brownie_llm::FAKE_LLM_MODEL;
use serde_json::{json, Value};
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
fn rpc(method: &str, params: Value) -> Value {
    let request = json!({"jsonrpc":"2.0","id":1,"method":method,"params":params});
    serde_json::from_str(&brownie_runtime::handle_jsonrpc_input_line(&request.to_string()).unwrap())
        .unwrap()
}

fn check(
    profile: Option<Value>,
    provider_override: Option<&str>,
    expected_model: &str,
    expected_source: &str,
    configured_provider: &str,
) {
    let _lock = ENV_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    let _environment = Environment::isolated();
    let workspace = tempfile::tempdir().unwrap();
    std::env::set_var("BROWNIE_WORKSPACE_ROOT", workspace.path());
    std::fs::write(
        workspace.path().join("README.md"),
        "Synthetic Fake metadata fixture.\n",
    )
    .unwrap();
    if let Some(profile) = profile {
        std::fs::create_dir_all(workspace.path().join(".brownie")).unwrap();
        std::fs::write(workspace.path().join(".brownie/config.json"), json!({
            "version":1,"active_profile":"model-fixture","llm":{"profiles":{"model-fixture":profile}}
        }).to_string()).unwrap();
    }
    if let Some(value) = provider_override {
        std::env::set_var("BROWNIE_LLM_PROVIDER", value);
    }
    let status = rpc("llm.status", json!({}));
    assert!(status.get("error").is_none(), "{status}");
    assert_eq!(status["result"]["provider"], configured_provider);
    assert_eq!(status["result"]["config_source"], expected_source);
    let config = rpc("runtime.config.get", json!({}));
    assert_eq!(
        config["result"]["llm_status"]["model"],
        status["result"]["model"]
    );
    let diagnostics = rpc("runtime.diagnostics.get", json!({}));
    assert_eq!(
        diagnostics["result"]["llm_status"]["model"],
        status["result"]["model"]
    );
    if configured_provider == "Fake" {
        assert_eq!(status["result"]["model"], expected_model);
        assert_eq!(status["result"]["enabled"], true);
        assert_eq!(status["result"]["will_fallback_to_fake"], false);
    } else {
        assert_eq!(status["result"]["will_fallback_to_fake"], true);
        assert_ne!(status["result"]["model"], expected_model);
    }
    let modes = rpc("mode.list", json!({}));
    let readonly = modes["result"]["modes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|mode| {
            mode["permissions"]["read_only"] == true
                && mode["permissions"]["workspace_write"] == false
        })
        .unwrap();
    let started = rpc(
        "task.start",
        json!({"goal":"Read README.md and summarize it.","mode_id":readonly["mode_id"]}),
    );
    assert!(started.get("error").is_none(), "{started}");
    let task = &started["result"];
    let run = rpc("task.run", json!({"task_id":task["task_id"]}));
    assert_eq!(run["result"]["status"], "Completed", "{run}");
    let events = rpc("run.events", json!({"run_id":task["run_id"]}));
    let requests: Vec<_> = events["result"]["events"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|event| {
            event["kind"] == "LlmRequestCreated" || event["kind"] == "SecondPassLlmRequestCreated"
        })
        .collect();
    assert_eq!(requests.len(), 2, "both actual request passes are required");
    for event in requests {
        assert_eq!(event["payload"]["provider"], "Fake");
        assert_eq!(
            event["payload"]["model"], expected_model,
            "persisted request metadata must identify the effective Fake model"
        );
    }
}

#[test]
fn default_fake_model_is_preserved() {
    check(None, None, FAKE_LLM_MODEL, "Default", "Fake");
}
#[test]
fn workspace_fake_without_model_retains_default() {
    check(
        Some(json!({"provider":"fake"})),
        None,
        FAKE_LLM_MODEL,
        "WorkspaceConfig",
        "Fake",
    );
}
#[test]
fn workspace_custom_fake_model_reaches_both_actual_requests() {
    check(
        Some(json!({"provider":"fake","model":"custom-fake-model"})),
        None,
        "custom-fake-model",
        "WorkspaceConfig",
        "Fake",
    );
}
#[test]
fn explicit_fake_environment_override_keeps_its_default_model() {
    check(
        Some(json!({"provider":"fake","model":"custom-fake-model"})),
        Some("fake"),
        FAKE_LLM_MODEL,
        "Env",
        "Fake",
    );
}
#[test]
fn blank_environment_override_keeps_workspace_model() {
    check(
        Some(json!({"provider":"fake","model":"custom-fake-model"})),
        Some(" \t "),
        "custom-fake-model",
        "WorkspaceConfig",
        "Fake",
    );
}
#[test]
fn nonstrict_real_provider_fallback_retains_default_fake_metadata() {
    check(
        Some(
            json!({"provider":"openai-compatible","base_url":"http://127.0.0.1:9/v1",
        "model":"configured-real-model","strict":false}),
        ),
        None,
        FAKE_LLM_MODEL,
        "WorkspaceConfig",
        "OpenAiCompatible",
    );
}
