//! Public RPC and physical-ledger regressions for recognized secret metadata.
#[path = "../src/http_test_support.rs"]
mod http_test_support;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{ffi::OsString, path::Path, sync::Mutex};

static ENV_LOCK: Mutex<()> = Mutex::new(());
const TOKEN: &str = "sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

#[test]
fn redacted_mode_instructions_remain_in_materialized_prompt() {
    let _lock = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _env = Environment::isolated();
    let w = workspace("off");
    let instruction = "Always run verification before completing";
    let config = w.path().join(".brownie/modepack.json");
    std::fs::create_dir_all(config.parent().unwrap()).unwrap();
    std::fs::write(
        &config,
        json!({"name":"instruction-privacy","schema_version":1,"modes":[{
        "mode_id":"instruction-privacy","display_name":"Instruction fixture",
        "role_definition":format!("password=example-password. {instruction}. Use flask-router."),
        "permissions":{"read_only":true,"workspace_write":false,"process_exec":false,
            "network_access":false,"service_control":false,"destructive":false,
            "llm_provider_access":true,"can_spawn_subtasks":false},
        "completion_rules":["Return a bounded summary."]}]})
        .to_string(),
    )
    .unwrap();
    let task = start("instruction-privacy");
    let store = brownie_store::BrownieStore::new(w.path());
    let task_record = store
        .tasks()
        .get_task(task["task_id"].as_str().unwrap())
        .unwrap()
        .unwrap();
    let events = store
        .tasks()
        .read_ledger_events(task["run_id"].as_str().unwrap())
        .unwrap();
    let prompt = brownie_context::ContextMaterializer::materialize(
        brownie_context::ContextMaterializerInput {
            task: task_record,
            ledger_events: events,
            child_completion_summaries: vec![],
            selected_index_context: None,
            verification_recovery_context: None,
            context_budget: None,
        },
    );
    let instructions = prompt.mode_instruction_material.unwrap();
    assert!(
        instructions.contains(instruction),
        "unrelated executable instruction was removed"
    );
    assert!(instructions.contains("flask-router"));
    let physical = serde_json::to_string(&ledger(w.path(), &task)).unwrap();
    assert!(!physical.contains("example-password"));
    assert!(physical.contains(instruction));
}

#[test]
fn assignment_heavy_response_redaction_keeps_task_completion_bounded() {
    let _lock = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _env = Environment::isolated();
    let w = workspace("off");
    let task = start("verifier");
    let content = format!(
        "api_key={TOKEN} {}",
        "assignment=benign-value ".repeat(3500)
    );
    assert!(content.len() > 16_000);
    let handle = provider(reply(&content));
    let started = std::time::Instant::now();
    let result = rpc("task.run", json!({"task_id":task["task_id"]}));
    let elapsed = started.elapsed();
    handle.join().unwrap();
    assert_eq!(result["status"], "Completed");
    no_secret(&serde_json::to_string(&ledger(w.path(), &task)).unwrap());
    eprintln!("actual assignment-heavy task elapsed={elapsed:?}");
    assert!(
        elapsed < std::time::Duration::from_secs(5),
        "metadata completion exceeded five seconds: {elapsed:?}"
    );
}
struct Environment(Vec<(OsString, OsString)>);
impl Environment {
    fn isolated() -> Self {
        let saved: Vec<_> = std::env::vars_os()
            .filter(|(k, _)| k.to_str().is_some_and(|k| k.starts_with("BROWNIE_")))
            .collect();
        for (k, _) in &saved {
            std::env::remove_var(k);
        }
        Self(saved)
    }
}
impl Drop for Environment {
    fn drop(&mut self) {
        for (k, _) in std::env::vars_os()
            .filter(|(k, _)| k.to_str().is_some_and(|k| k.starts_with("BROWNIE_")))
        {
            std::env::remove_var(k);
        }
        for (k, v) in &self.0 {
            std::env::set_var(k, v);
        }
    }
}
fn rpc(method: &str, params: Value) -> Value {
    let request = json!({"jsonrpc":"2.0","id":1,"method":method,"params":params});
    let response: Value = serde_json::from_str(
        &brownie_runtime::handle_jsonrpc_input_line(&request.to_string()).unwrap(),
    )
    .unwrap();
    assert!(response.get("error").is_none(), "{response}");
    response["result"].clone()
}
fn workspace(guard: &str) -> tempfile::TempDir {
    let w = tempfile::tempdir().unwrap();
    std::env::set_var("BROWNIE_WORKSPACE_ROOT", w.path());
    std::env::set_var("BROWNIE_LLM_PROVIDER", "fake");
    std::env::set_var("BROWNIE_LLM_SENSITIVE_GUARD", guard);
    std::fs::write(w.path().join("README.md"), "Owned metadata fixture.\n").unwrap();
    w
}
fn start(mode: &str) -> Value {
    rpc(
        "task.start",
        json!({"goal":"Read README.md and summarize it.","mode_id":mode}),
    )
}
fn ledger_path(root: &Path, task: &Value) -> std::path::PathBuf {
    root.join(".brownie/runs")
        .join(task["run_id"].as_str().unwrap())
        .join("ledger.jsonl")
}
fn ledger(root: &Path, task: &Value) -> Vec<Value> {
    std::fs::read_to_string(ledger_path(root, task))
        .unwrap()
        .lines()
        .map(|s| serde_json::from_str(s).unwrap())
        .collect()
}
fn no_secret(text: &str) {
    assert!(
        !text.contains(TOKEN),
        "recognized synthetic secret survived metadata redaction"
    );
}
fn provider(body: String) -> std::thread::JoinHandle<Value> {
    let body = Box::leak(body.into_boxed_str());
    let (url, handle) = http_test_support::spawn_mock("200 OK", body);
    for (k, v) in [
        ("BROWNIE_LLM_PROVIDER", "openai-compatible"),
        ("BROWNIE_LLM_BASE_URL", url.as_str()),
        ("BROWNIE_LLM_MODEL", "mock-model"),
        ("BROWNIE_LLM_API_KEY", "synthetic-only"),
        ("BROWNIE_LLM_STRICT", "true"),
        ("BROWNIE_LLM_ALLOW_PROVIDER_ACCESS", "true"),
        ("BROWNIE_LLM_ALLOW_TASK_RUN_NETWORK", "true"),
    ] {
        std::env::set_var(k, v);
    }
    handle
}
fn reply(content: &str) -> String {
    json!({"choices":[{"message":{"role":"assistant","content":content},"finish_reason":"stop"}]})
        .to_string()
}
fn child_fixture() -> (Value, Value) {
    let parent = start("orchestrator");
    assert_eq!(
        rpc("task.run", json!({"task_id":parent["task_id"]}))["status"],
        "Completed"
    );
    let tasks = rpc("task.list", json!({}));
    let kids: Vec<_> = tasks["tasks"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|t| t["parent_task_id"] == parent["task_id"])
        .collect();
    assert_eq!(kids.len(), 1);
    (parent, kids[0].clone())
}
fn child_summary(parent: &Value) -> Value {
    rpc("run.inspect", json!({"run_id":parent["run_id"]}))["run"]["child_tasks"][0].clone()
}

#[test]
fn tool_intent_reasons_and_response_metadata_redact_in_every_guard_mode() {
    let _lock = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _env = Environment::isolated();
    for guard in ["off", "warn", "fail"] {
        let w = workspace(guard);
        let intent = format!(
            "```brownie-tool-intent\n{}\n```",
            json!({"tool_requests":[{"tool_id":"workspace.read","reason":format!("api_key={TOKEN}"),"input":{"path":"README.md"}}]})
        );
        let task = start("orchestrator");
        let handle = provider(reply(&intent));
        // The one-response fixture closes before a second provider pass. Privacy
        // must hold on that real failure path, as well as successful child runs.
        let _ = rpc("task.run", json!({"task_id":task["task_id"]}));
        handle.join().unwrap();
        let events = ledger(w.path(), &task);
        assert!(events
            .iter()
            .any(|e| e["kind"] == "ToolIntentPermissionChecked"));
        no_secret(&serde_json::to_string(&events).unwrap());
        no_secret(&rpc("run.events", json!({"run_id":task["run_id"]})).to_string());
        let parsed = rpc(
            "tool.intent.parse",
            json!({"mode_id":"orchestrator","assistant_content":intent}),
        );
        no_secret(&parsed.to_string());
    }
}

#[test]
fn mode_metadata_redacts_free_text_and_preserves_pinned_permissions() {
    let _lock = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _env = Environment::isolated();
    for guard in ["off", "warn", "fail"] {
        let w = workspace(guard);
        let config = w.path().join(".brownie/modepack.json");
        std::fs::create_dir_all(config.parent().unwrap()).unwrap();
        let mode = |role: String, write: bool| json!({"name":"privacy-pack","schema_version":1,"modes":[{"mode_id":"privacy-audit","display_name":"Privacy fixture","role_definition":role,"permissions":{"read_only":!write,"workspace_write":write,"process_exec":false,"network_access":false,"service_control":false,"destructive":false,"can_spawn_subtasks":false},"completion_rules":["Return a bounded summary."]}]});
        std::fs::write(
            &config,
            mode(format!("Read only. api_key={TOKEN}"), false).to_string(),
        )
        .unwrap();
        no_secret(&rpc("mode.get", json!({"mode_id":"privacy-audit"})).to_string());
        let task = start("privacy-audit");
        let before = ledger(w.path(), &task);
        no_secret(&serde_json::to_string(&before).unwrap());
        let pinned =
            before.iter().find(|e| e["kind"] == "ModeResolved").unwrap()["payload"].clone();
        let pending = start("privacy-audit");
        let ran = rpc("task.run", json!({"task_id":task["task_id"]}));
        let expected = if guard == "fail" {
            "Failed"
        } else {
            "Completed"
        };
        assert_eq!(ran["status"], expected, "guard={guard}, result={ran}");
        std::fs::write(
            &config,
            mode("Changed workspace instructions.".into(), true).to_string(),
        )
        .unwrap();
        let before_replay = std::fs::read(ledger_path(w.path(), &task)).unwrap();
        if expected == "Completed" {
            assert_eq!(
                rpc("task.run", json!({"task_id":task["task_id"]}))["status"],
                "Completed"
            );
        } else {
            assert_eq!(
                rpc("task.get", json!({"task_id":task["task_id"]}))["status"],
                "Failed"
            );
        }
        assert_eq!(
            std::fs::read(ledger_path(w.path(), &task)).unwrap(),
            before_replay
        );
        let request = json!({"jsonrpc":"2.0","id":1,"method":"task.run","params":{"task_id":pending["task_id"]}});
        let stale: Value = serde_json::from_str(
            &brownie_runtime::handle_jsonrpc_input_line(&request.to_string()).unwrap(),
        )
        .unwrap();
        assert_eq!(stale["error"]["code"], -32602);
        assert!(stale["error"]["message"]
            .as_str()
            .unwrap()
            .contains("external Mode Pack task provenance is stale"));
        assert!(!ledger(w.path(), &pending)
            .iter()
            .any(|e| e["kind"] == "TaskRunning"));
        let events = ledger(w.path(), &task);
        no_secret(&serde_json::to_string(&events).unwrap());
        for e in events.iter().filter(|e| e["kind"] == "ModeResolved") {
            assert_eq!(e["payload"]["permissions"], pinned["permissions"]);
            assert_eq!(
                e["payload"]["instruction_fingerprint"],
                pinned["instruction_fingerprint"]
            );
        }
        assert_eq!(pinned["permissions"]["read_only"], true);
        assert_eq!(pinned["permissions"]["workspace_write"], false);
        no_secret(&rpc("run.events", json!({"run_id":task["run_id"]})).to_string());
    }
}

#[test]
fn successful_child_preview_redacts_in_every_guard_mode() {
    let _lock = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _env = Environment::isolated();
    for guard in ["off", "warn", "fail"] {
        let w = workspace(guard);
        let (parent, child) = child_fixture();
        let handle = provider(reply(&format!("Owned response api_key={TOKEN}")));
        assert_eq!(
            rpc("task.run", json!({"task_id":child["task_id"]}))["status"],
            "Completed"
        );
        handle.join().unwrap();
        no_secret(&serde_json::to_string(&ledger(w.path(), &child)).unwrap());
        let summary = child_summary(&parent);
        no_secret(&summary.to_string());
        assert!(summary["final_response_preview"]
            .as_str()
            .unwrap()
            .contains("Owned response"));
    }
}

#[test]
fn distinct_original_responses_keep_distinct_completion_fingerprints() {
    let _lock = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _env = Environment::isolated();
    let w = workspace("off");
    let (parent, child) = child_fixture();
    let mut fingerprints = Vec::new();
    for (index, token) in [TOKEN, "sk-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"]
        .iter()
        .enumerate()
    {
        if index > 0 {
            let path = w
                .path()
                .join(".brownie/runs")
                .join(child["run_id"].as_str().unwrap())
                .join("state.json");
            let mut state: Value =
                serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
            assert_eq!(state["status"], "Completed");
            state["status"] = json!("Queued");
            std::fs::write(path, state.to_string()).unwrap();
        }
        let handle = provider(reply(&format!("Owned response api_key={token}")));
        let run = rpc("task.run", json!({"task_id":child["task_id"]}));
        assert_eq!(run["status"], "Completed");
        handle.join().unwrap();
        let fingerprint = run["completion_evidence"]["completion_result_fingerprint"]
            .as_str()
            .unwrap()
            .to_string();
        assert!(fingerprint.starts_with("sha256:"));
        fingerprints.push(fingerprint);
        no_secret(&child_summary(&parent).to_string());
    }
    assert_ne!(
        fingerprints[0], fingerprints[1],
        "redacted previews must not collapse actual response identity"
    );
}

#[test]
fn legacy_read_surfaces_redact_without_rewriting_or_collapsing_identity() {
    let _lock = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _env = Environment::isolated();
    let w = workspace("off");
    let (parent, child) = child_fixture();
    let handle = provider(reply("Owned ordinary response."));
    assert_eq!(
        rpc("task.run", json!({"task_id":child["task_id"]}))["status"],
        "Completed"
    );
    handle.join().unwrap();
    let path = ledger_path(w.path(), &child);
    let mut events = ledger(w.path(), &child);
    let raw_preview = format!("Old response api_key={TOKEN}");
    let mut completion_summary = String::new();
    for e in &mut events {
        if e["kind"] == "LlmResponseReceived" {
            e["payload"]["content_preview"] = json!(raw_preview);
            e.as_object_mut().unwrap().remove("payload_envelope");
        }
        if e["kind"] == "AgentLoopCompleted" {
            completion_summary = e["payload"]["completion_summary"]
                .as_str()
                .unwrap()
                .to_string();
            e["payload"]
                .as_object_mut()
                .unwrap()
                .remove("completion_result_fingerprint");
            e.as_object_mut().unwrap().remove("payload_envelope");
        }
    }
    let encoded = events
        .iter()
        .map(|e| e.to_string() + "\n")
        .collect::<String>();
    std::fs::write(&path, &encoded).unwrap();
    let sha = |s: &str| format!("sha256:{:x}", Sha256::digest(s.as_bytes()));
    let canonical = json!({"version":"completion_result_fingerprint_legacy_v1","final_state":"Completed","completion_summary_chars":completion_summary.chars().count(),"completion_summary_sha256":sha(&completion_summary),"final_response_preview_chars":raw_preview.chars().count(),"final_response_preview_sha256":sha(&raw_preview)});
    let summary = child_summary(&parent);
    no_secret(&summary.to_string());
    assert_eq!(
        summary["completion_result_fingerprint"],
        sha(&canonical.to_string())
    );
    no_secret(&rpc("run.events", json!({"run_id":child["run_id"]})).to_string());
    assert_eq!(
        std::fs::read_to_string(path).unwrap(),
        encoded,
        "inspection must preserve retained history bytes"
    );
}

#[test]
fn ordinary_tool_reason_remains_useful() {
    let _lock = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _env = Environment::isolated();
    let _w = workspace("off");
    let text = "Read README using flask-router and token_bucket for the overview.";
    let intent = format!(
        "```brownie-tool-intent\n{}\n```",
        json!({"tool_requests":[{"tool_id":"workspace.read","reason":text,"input":{"path":"README.md"}}]})
    );
    let parsed = rpc(
        "tool.intent.parse",
        json!({"mode_id":"orchestrator","assistant_content":intent}),
    );
    assert!(parsed.to_string().contains(text));
}

#[test]
fn recognized_secret_forms_are_removed_without_erasing_benign_words() {
    let _lock = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _env = Environment::isolated();
    let _w = workspace("off");
    for (text, value) in [
        (
            "Authorization: Bearer synthetic-header-value".to_string(),
            "synthetic-header-value",
        ),
        (format!("Bearer {TOKEN}"), TOKEN),
        (
            format!("-----BEGIN {}-----\napi_key=\"fixture-private-body\n-----END {}-----\nUse flask-router.", "PRIVATE KEY", "PRIVATE KEY"),
            "fixture-private-body",
        ),

        (
            "API_KEY = 'synthetic-assignment-value'".to_string(),
            "synthetic-assignment-value",
        ),
        (
            "access-token: owned-access-value".to_string(),
            "owned-access-value",
        ),
        (
            concat!(
                "-----BEGIN ",
                "PRIVATE KEY-----\nowned-private-key-body\n-----END ",
                "PRIVATE KEY-----"
            )
            .to_string(),
            "owned-private-key-body",
        ),
        (
            concat!(
                "-----BEGIN ",
                "OPENSSH PRIVATE KEY-----\nowned-ssh-key-body\n-----END ",
                "OPENSSH PRIVATE KEY-----"
            )
            .to_string(),
            "owned-ssh-key-body",
        ),
        (
            "password=owned-password-value".to_string(),
            "owned-password-value",
        ),
        (
            concat!("ghp_", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb").to_string(),
            concat!("ghp_", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
        ),
        (format!("Use flask-router. api_key={TOKEN}"), TOKEN),
        (
            format!("api_key={TOKEN} PASSWORD=other-owned-secret"),
            "other-owned-secret",
        ),
    ] {
        let intent = format!(
            "```brownie-tool-intent\n{}\n```",
            json!({"tool_requests":[{"tool_id":"workspace.read","reason":text,"input":{"path":"README.md"}}]})
        );
        let parsed = rpc(
            "tool.intent.parse",
            json!({"mode_id":"orchestrator","assistant_content":intent}),
        );
        let output = parsed.to_string();
        assert!(
            !output.contains(value),
            "recognized form survived its public metadata boundary"
        );
        no_secret(&output);
        if text.contains("flask-router") {
            assert!(output.contains("flask-router"));
        }
    }
    for prefix in ["SK-", "GHP_", "GITHUB_PAT_", "ſk-"] {
        for body in [
            "a".repeat(24),
            format!("{}K{}", "a".repeat(12), "a".repeat(12)),
        ] {
            let token = format!("{prefix}{body}");
            let text = format!(
                "{}=fixture-secret-value\nBearer {token}\nUse flask-router.",
                "api_key"
            );
            assert!(brownie_llm::scan_text_for_sensitive_content(&text)
                .findings
                .iter()
                .any(|finding| finding.category == "bearer_token"));
            let intent = format!(
                "```brownie-tool-intent\n{}\n```",
                json!({"tool_requests":[{"tool_id":"workspace.read","reason":text,"input":{"path":"README.md"}}]})
            );
            let output = rpc(
                "tool.intent.parse",
                json!({"mode_id":"orchestrator","assistant_content":intent}),
            )
            .to_string();
            assert!(
                !output.contains(&token),
                "case-folded token survived public metadata: {output}"
            );
            assert!(!output.contains("fixture-secret-value"));
            assert!(output.contains("flask-router"));
        }
    }
}

#[test]
fn response_secret_is_redacted_before_preview_truncation() {
    let _lock = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _env = Environment::isolated();
    let w = workspace("off");
    let (_parent, child) = child_fixture();
    std::env::set_var("BROWNIE_LLM_RESPONSE_PREVIEW_CHARS", "100");
    let prefix = "X".repeat(80);
    let handle = provider(reply(&format!("{prefix}api_key={TOKEN}")));
    assert_eq!(
        rpc("task.run", json!({"task_id":child["task_id"]}))["status"],
        "Completed"
    );
    handle.join().unwrap();
    let events = ledger(w.path(), &child);
    let payload = &events
        .iter()
        .find(|e| e["kind"] == "LlmResponseReceived")
        .unwrap()["payload"];
    let preview = payload["content_preview"].as_str().unwrap();
    assert_eq!(preview, format!("{prefix}api_key=[REDACTED]"));
}
