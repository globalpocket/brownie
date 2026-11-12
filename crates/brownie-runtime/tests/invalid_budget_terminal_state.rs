use serde_json::{json, Value};
use std::{ffi::OsString, sync::Mutex};

static ENV_LOCK: Mutex<()> = Mutex::new(());
const KEYS: &[&str] = &[
    "BROWNIE_WORKSPACE_ROOT",
    "BROWNIE_LLM_PROVIDER",
    "BROWNIE_LLM_MODEL",
    "BROWNIE_LLM_BASE_URL",
    "BROWNIE_LLM_API_KEY_ENV",
    "BROWNIE_LLM_API_KEY",
    "BROWNIE_LLM_STRICT",
    "BROWNIE_LLM_MAX_PROMPT_CHARS",
    "BROWNIE_LLM_MAX_MESSAGES",
    "BROWNIE_LLM_REQUEST_TIMEOUT_MS",
    "BROWNIE_LLM_RESPONSE_PREVIEW_CHARS",
    "BROWNIE_LLM_ALLOW_TASK_RUN_NETWORK",
    "BROWNIE_LLM_ALLOW_PROVIDER_ACCESS",
    "BROWNIE_LLM_SENSITIVE_GUARD",
];

struct Environment(Vec<(&'static str, Option<OsString>)>);
impl Environment {
    fn isolated() -> Self {
        let saved = KEYS
            .iter()
            .map(|&key| (key, std::env::var_os(key)))
            .collect();
        for key in KEYS {
            std::env::remove_var(key);
        }
        Self(saved)
    }
}
impl Drop for Environment {
    fn drop(&mut self) {
        for (key, value) in &self.0 {
            if let Some(value) = value {
                std::env::set_var(key, value);
            } else {
                std::env::remove_var(key);
            }
        }
    }
}
fn rpc(method: &str, params: Value) -> Value {
    let input = json!({"jsonrpc":"2.0","id":1,"method":method,"params":params}).to_string();
    serde_json::from_str(&brownie_runtime::handle_jsonrpc_input_line(&input).expect("RPC response"))
        .unwrap()
}
fn workspace(source: &str) -> tempfile::TempDir {
    let workspace = tempfile::tempdir().unwrap();
    std::env::set_var("BROWNIE_WORKSPACE_ROOT", workspace.path());
    if source == "env" {
        std::env::set_var("BROWNIE_LLM_PROVIDER", "fake");
    } else {
        std::fs::create_dir(workspace.path().join(".brownie")).unwrap();
        std::fs::write(workspace.path().join(".brownie/config.json"),
            json!({"version":1,"active_profile":"audit","llm":{"profiles":{"audit":{"provider":"fake"}}}}).to_string()).unwrap();
    }
    workspace
}
fn started_task() -> Value {
    let start = rpc(
        "task.start",
        json!({"goal":"Audit synthetic provider and invalid-budget state only","mode_id":"orchestrator"}),
    );
    assert!(start.get("error").is_none(), "{start}");
    start["result"].clone()
}
fn check_invalid(source: &str, invalid: &str) {
    let _lock = ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let _env = Environment::isolated();
    let _workspace = workspace(source);
    let start = started_task();
    std::env::set_var("BROWNIE_LLM_MAX_PROMPT_CHARS", invalid);
    let run = rpc("task.run", json!({"task_id":start["task_id"]}));
    assert!(
        run.get("error").is_none(),
        "use the canonical failed-task result: {run}"
    );
    assert_eq!(run["result"]["status"], "Failed", "{run}");
    assert_eq!(
        run["result"]["agent_loop"]["final_state"], "Failed",
        "{run}"
    );
    assert_eq!(
        run["result"]["llm_provider_failure"]["failure_class"], "configuration_invalid",
        "{run}"
    );
    assert_eq!(
        run["result"]["llm_provider_failure"]["retryable"], false,
        "invalid budgets require correction rather than provider retry"
    );
    assert_eq!(
        run["result"]["llm_provider_failure"]["reason"], "invalid runtime configuration",
        "configuration values must not be copied into failure results"
    );
    let task = rpc("task.get", json!({"task_id":start["task_id"]}));
    assert_eq!(
        task["result"]["status"], "Failed",
        "invalid budget must not strand Running: {task}"
    );
    let events = rpc("run.events", json!({"run_id":start["run_id"]}));
    let events = events["result"]["events"].as_array().unwrap();
    for kind in ["LlmRequestFailed", "TaskFailed"] {
        assert_eq!(
            events.iter().filter(|event| event["kind"] == kind).count(),
            1,
            "one durable {kind}"
        );
    }
    let failure = events
        .iter()
        .find(|event| event["kind"] == "LlmRequestFailed")
        .unwrap();
    assert_eq!(failure["payload"]["provider"], "Unknown");
    assert_eq!(failure["payload"]["model"], "");
    assert_eq!(
        failure["payload"]["reason"],
        "invalid runtime configuration"
    );
    assert!(
        !events.iter().any(
            |event| ["LlmRequestCreated", "LlmResponseReceived", "TaskCompleted"]
                .iter()
                .any(|kind| event["kind"] == *kind)
        ),
        "no provider call or successful completion may be fabricated"
    );
}

#[test]
fn invalid_env_budget_syntax_terminalizes_env_provider_task() {
    check_invalid("env", "not-an-integer");
}
#[test]
fn invalid_env_budget_range_terminalizes_env_provider_task() {
    check_invalid("env", "999");
}
#[test]
fn invalid_env_budget_syntax_terminalizes_workspace_provider_task() {
    check_invalid("workspace", "not-an-integer");
}
#[test]
fn invalid_env_budget_range_terminalizes_workspace_provider_task() {
    check_invalid("workspace", "999");
}
#[test]
fn valid_budget_controls_preserve_normal_provider_execution() {
    let _lock = ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    for source in ["env", "workspace"] {
        let _env = Environment::isolated();
        let _workspace = workspace(source);
        let start = started_task();
        let run = rpc("task.run", json!({"task_id":start["task_id"]}));
        assert!(run.get("error").is_none(), "{run}");
        assert_eq!(
            rpc("task.get", json!({"task_id":start["task_id"]}))["result"]["status"],
            "Completed"
        );
        let events = rpc("run.events", json!({"run_id":start["run_id"]}));
        assert!(events["result"]["events"]
            .as_array()
            .unwrap()
            .iter()
            .any(|event| event["kind"] == "LlmRequestCreated"));
    }
}
