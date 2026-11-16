//! Real public-RPC / physical-store controls for request-only proposal material.
#[path = "../src/http_test_support.rs"]
mod http_test_support;
use serde_json::{json, Value};
use sha2::Digest;
use std::ffi::OsString;
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::Mutex;

static LOCK: Mutex<()> = Mutex::new(());
const OLD: &str = "owned-original-hunk-for-request-only-control\n";
const NEW: &str = "owned-new-hunk-for-request-only-control\n";

struct Environment(Vec<(OsString, OsString)>);
impl Environment {
    fn isolated() -> Self {
        let saved = std::env::vars_os()
            .filter(|(k, _)| k.to_str().is_some_and(|k| k.starts_with("BROWNIE_")))
            .collect::<Vec<_>>();
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

fn fresh_rpc(method: &str, params: Value) -> Value {
    let request = json!({"jsonrpc":"2.0","id":7,"method":method,"params":params});
    let mut child = Command::new(env!("CARGO_BIN_EXE_brownie-runtime"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    writeln!(child.stdin.take().unwrap(), "{request}").unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(output.status.success());
    let response: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert!(response.get("error").is_none(), "{response}");
    response["result"].clone()
}

fn absent_from_store(directory: &Path) {
    for entry in std::fs::read_dir(directory).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            absent_from_store(&path);
        } else {
            let bytes = std::fs::read(&path).unwrap();
            let text = String::from_utf8_lossy(&bytes);
            assert!(
                !text.contains(OLD.trim_end()),
                "raw old material persisted at {}",
                path.display()
            );
            assert!(
                !text.contains(NEW.trim_end()),
                "raw new material persisted at {}",
                path.display()
            );
        }
    }
}

fn check(scenario: &str) {
    let operation = if scenario == "patch_occurrence" {
        "patch_file"
    } else {
        scenario
    };
    let _lock = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _env = Environment::isolated();
    let workspace = tempfile::tempdir().unwrap();
    // Small full replacements are deliberately normalized to patch_file by
    // production. A larger existing target exercises the real replace path.
    let existing = if scenario == "patch_occurrence" {
        OLD.repeat(2)
    } else if operation == "replace_file" {
        format!("{OLD}{}", "x\n".repeat(10001))
    } else {
        OLD.to_owned()
    };
    if operation != "create_file" {
        std::fs::write(workspace.path().join("fixture.txt"), &existing).unwrap();
    }
    let input = if scenario == "patch_occurrence" {
        json!({"path":"fixture.txt","operation":"patch_file","hunks":[{"old_text":OLD,"new_text":NEW,"occurrence":2}]})
    } else if operation == "patch_file" {
        json!({"path":"fixture.txt","operation":operation,"old_text":OLD,"new_text":NEW})
    } else {
        json!({"path":"fixture.txt","operation":operation,"content":NEW})
    };
    let content = format!(
        "```brownie-tool-intent\n{}\n```",
        json!({"tool_requests":[{"tool_id":"workspace.write","reason":"Prepare an owned reviewable proposal.","input":input}]})
    );
    let body = Box::leak(
        json!({"choices":[{"message":{"content":content}}]})
            .to_string()
            .into_boxed_str(),
    );
    let (url, peer) = http_test_support::spawn_mock("200 OK", body);
    std::env::set_var("BROWNIE_WORKSPACE_ROOT", workspace.path());
    for (key, value) in [
        ("BROWNIE_LLM_PROVIDER", "openai-compatible"),
        ("BROWNIE_LLM_BASE_URL", url.as_str()),
        ("BROWNIE_LLM_MODEL", "mock-model"),
        ("BROWNIE_LLM_API_KEY", "fixture-only"),
        ("BROWNIE_LLM_STRICT", "true"),
        ("BROWNIE_LLM_ALLOW_PROVIDER_ACCESS", "true"),
        ("BROWNIE_LLM_ALLOW_TASK_RUN_NETWORK", "true"),
        ("BROWNIE_LLM_SENSITIVE_GUARD", "off"),
    ] {
        std::env::set_var(key, value);
    }
    let task = rpc(
        "task.start",
        json!({"goal":"Implement fixture.txt update.","mode_id":"implementer"}),
    );
    rpc("task.run", json!({"task_id":task["task_id"]}));
    peer.join().unwrap();
    let ordinary = rpc("run.events", json!({"run_id":task["run_id"]}));
    let proposal = ordinary["events"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["kind"] == "WorkspacePatchProposed")
        .unwrap_or_else(|| panic!("No write proposal; actual events: {}", ordinary));
    assert_eq!(proposal["payload"]["validation_status"], "Valid");
    assert_eq!(proposal["payload"]["operation"], operation);
    let id = proposal["payload"]["proposal_id"].clone();
    let inspected = rpc(
        "proposal.inspect",
        json!({"run_id":task["run_id"],"proposal_id":id}),
    );
    for public in [ordinary, inspected] {
        assert!(!public.to_string().contains(OLD.trim_end()));
        assert!(!public.to_string().contains(NEW.trim_end()));
    }
    absent_from_store(&workspace.path().join(".brownie"));
    rpc(
        "proposal.approve",
        json!({"run_id":task["run_id"],"proposal_id":id,"reason":"Approve only the original owned request material."}),
    );
    let snapshot = rpc(
        "proposal.preflight",
        json!({"run_id":task["run_id"],"proposal_id":id}),
    );
    let tampered = format!("X{}", &NEW[1..]);
    assert_eq!(tampered.chars().count(), NEW.chars().count());
    let mut apply = json!({"run_id":task["run_id"],"proposal_id":id,"authorize":true});
    if operation == "create_file" {
        apply["expected_target_absent"] = json!(true);
    } else {
        apply["expected_target_sha256"] = snapshot["snapshot"]["file_sha256"].clone();
    }
    if scenario == "patch_occurrence" {
        apply["patch_hunks"] = json!([{"old_text":OLD,"new_text":tampered,"occurrence":2}]);
    } else if operation == "patch_file" {
        apply["patch_old_text"] = json!(OLD);
        apply["patch_new_text"] = json!(tampered);
    } else {
        apply["replacement_content"] = json!(tampered);
    }
    let denied = rpc("proposal.apply", apply.clone());
    assert_eq!(denied["apply_result"]["apply_status"], "Denied", "{denied}");
    assert_eq!(denied["apply_result"]["authorization_consumed"], false);
    if operation == "create_file" {
        assert!(!workspace.path().join("fixture.txt").exists());
    } else {
        assert_eq!(
            std::fs::read_to_string(workspace.path().join("fixture.txt")).unwrap(),
            existing
        );
    }
    let explicit = rpc(
        "run.events",
        json!({"run_id":task["run_id"],"include_patch_material":true}),
    );
    let payload = explicit["events"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["payload"]["proposal_id"] == id)
        .unwrap()["payload"]
        .clone();
    if scenario == "patch_occurrence" {
        assert_eq!(payload["patch_hunks"][0]["old_text"], OLD);
        assert_eq!(payload["patch_hunks"][0]["new_text"], NEW);
        assert_eq!(payload["patch_hunks"][0]["occurrence"], 2);
    } else if operation == "patch_file" {
        assert_eq!(payload["patch_old_text"], OLD);
        assert_eq!(payload["patch_new_text"], NEW);
    } else {
        assert_eq!(payload["replacement_content"], NEW);
    }
    // A separate real Runtime process cannot reconstruct request material.
    let response = fresh_rpc(
        "run.events",
        json!({"run_id":task["run_id"],"include_patch_material":true}),
    );
    assert!(!response.to_string().contains(OLD.trim_end()));
    assert!(!response.to_string().contains(NEW.trim_end()));
    if operation == "create_file" {
        assert!(!workspace.path().join("fixture.txt").exists());
    } else {
        assert_eq!(
            std::fs::read_to_string(workspace.path().join("fixture.txt")).unwrap(),
            existing
        );
    }
    absent_from_store(&workspace.path().join(".brownie"));
    if scenario == "patch_occurrence" {
        apply["patch_hunks"][0]["new_text"] = json!(NEW);
    } else if operation == "patch_file" {
        apply["patch_new_text"] = json!(NEW);
    } else {
        apply["replacement_content"] = json!(NEW);
    }
    // The approved original request can still be applied explicitly after a
    // process restart; it must not depend on the lost volatile cache.
    let applied = fresh_rpc("proposal.apply", apply);
    assert_eq!(
        applied["apply_result"]["apply_status"], "Applied",
        "{applied}"
    );
    assert_eq!(applied["apply_result"]["authorization_consumed"], true);
    let expected = if scenario == "patch_occurrence" {
        format!("{OLD}{NEW}")
    } else {
        NEW.to_owned()
    };
    assert_eq!(
        std::fs::read_to_string(workspace.path().join("fixture.txt")).unwrap(),
        expected
    );
    absent_from_store(&workspace.path().join(".brownie"));
}

#[test]
fn patch_hunks_are_request_only_and_not_recovered_from_history() {
    check("patch_file");
}
#[test]
fn short_create_content_cannot_be_reconstructed_from_inspection_or_diff() {
    check("create_file");
}
#[test]
fn short_replacement_content_cannot_be_reconstructed_from_inspection_or_diff() {
    check("replace_file");
}

#[test]
fn occurrence_hunks_remain_request_only_and_preserve_exact_approved_apply() {
    check("patch_occurrence");
}

#[test]
fn retained_raw_proposals_and_response_text_are_elided_without_rewriting_history() {
    let _lock = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _env = Environment::isolated();
    let workspace = tempfile::tempdir().unwrap();
    std::env::set_var("BROWNIE_WORKSPACE_ROOT", workspace.path());
    let task = rpc(
        "task.start",
        json!({"goal":"Inspect an owned historical fixture.","mode_id":"implementer"}),
    );
    let store = brownie_store::BrownieStore::new(workspace.path());
    let id = task["run_id"].as_str().unwrap();
    let record = store.tasks().get_task_by_run_id(id).unwrap().unwrap();
    let digest = format!("sha256:{:x}", sha2::Sha256::digest(NEW.as_bytes()));
    let diff = format!(
        "# proposed_content_sha256: {digest}\n--- a/legacy.txt\n+++ b/legacy.txt\n-{OLD}+{NEW}"
    );
    store.tasks().append_task_event_with_payload(&record,brownie_store::LedgerEventKind::WorkspacePatchProposed,Some(json!({
        "proposal_id":"legacy-owned","tool_id":"workspace.write","path":"legacy.txt","operation":"create_file",
        "content_chars":NEW.chars().count(),"content_preview":NEW,"truncated":false,"validation_status":"Valid",
        "validation_reason":null,"diff_preview":diff,"diff_truncated":false,"diff_redacted":false,
        "patch_old_text":OLD,"patch_new_text":NEW
    }))).unwrap();
    let text = format!(
        "```brownie-tool-intent\n{}\n```",
        json!({"tool_requests":[{"tool_id":"workspace.write","input":{"path":"legacy.txt","operation":"create_file","content":NEW}}]})
    );
    store
        .tasks()
        .append_task_event_with_payload(
            &record,
            brownie_store::LedgerEventKind::LlmResponseReceived,
            Some(json!({
                "provider":"Fake","response_preview_chars":4000,"content_preview":text
            })),
        )
        .unwrap();
    let ledger = store.tasks().run_dir(id).join("ledger.jsonl");
    let before = std::fs::read(&ledger).unwrap();
    assert!(String::from_utf8_lossy(&before).contains(NEW.trim_end()));
    for result in [
        rpc("run.events", json!({"run_id":id})),
        rpc(
            "run.events",
            json!({"run_id":id,"include_patch_material":true}),
        ),
        rpc(
            "proposal.inspect",
            json!({"run_id":id,"proposal_id":"legacy-owned"}),
        ),
    ] {
        assert!(!result.to_string().contains(NEW.trim_end()));
        assert!(!result.to_string().contains(OLD.trim_end()));
    }
    assert_eq!(std::fs::read(ledger).unwrap(), before);
}

#[test]
fn ordinary_response_previews_are_partial_and_keep_distinct_original_fingerprints() {
    let _lock = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _env = Environment::isolated();
    let workspace = tempfile::tempdir().unwrap();
    std::fs::write(
        workspace.path().join("README.md"),
        "Owned response preview fixture.\n",
    )
    .unwrap();
    std::env::set_var("BROWNIE_WORKSPACE_ROOT", workspace.path());
    std::env::set_var("BROWNIE_LLM_PROVIDER", "fake");
    std::env::set_var("BROWNIE_LLM_SENSITIVE_GUARD", "off");
    let parent = rpc(
        "task.start",
        json!({"goal":"Read README.md and summarize it.","mode_id":"orchestrator"}),
    );
    assert_eq!(
        rpc("task.run", json!({"task_id":parent["task_id"]}))["status"],
        "Completed"
    );
    let tasks = rpc("task.list", json!({}));
    let children = tasks["tasks"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|task| task["parent_task_id"] == parent["task_id"])
        .collect::<Vec<_>>();
    assert_eq!(children.len(), 1);
    let task = children[0].clone();
    let mut fingerprints = Vec::new();
    for (index, content) in ["Owned ordinary response A\n", "Owned ordinary response B\n"]
        .into_iter()
        .enumerate()
    {
        if index > 0 {
            // Owned fixture reset holds task/run identity constant; no public retry claim.
            let path = workspace
                .path()
                .join(".brownie/runs")
                .join(task["run_id"].as_str().unwrap())
                .join("state.json");
            let mut state: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
            assert_eq!(state["status"], "Completed");
            state["status"] = json!("Queued");
            std::fs::write(path, state.to_string()).unwrap();
        }
        let body = Box::leak(
            json!({"choices":[{"message":{"content":content}}]})
                .to_string()
                .into_boxed_str(),
        );
        let (url, peer) = http_test_support::spawn_mock("200 OK", body);
        for (key, value) in [
            ("BROWNIE_LLM_PROVIDER", "openai-compatible"),
            ("BROWNIE_LLM_BASE_URL", url.as_str()),
            ("BROWNIE_LLM_MODEL", "mock-model"),
            ("BROWNIE_LLM_API_KEY", "fixture-only"),
            ("BROWNIE_LLM_STRICT", "true"),
            ("BROWNIE_LLM_ALLOW_PROVIDER_ACCESS", "true"),
            ("BROWNIE_LLM_ALLOW_TASK_RUN_NETWORK", "true"),
            ("BROWNIE_LLM_SENSITIVE_GUARD", "off"),
        ] {
            std::env::set_var(key, value);
        }

        let run = rpc("task.run", json!({"task_id":task["task_id"]}));
        peer.join().unwrap();
        let fingerprint = run["completion_evidence"]["completion_result_fingerprint"]
            .as_str()
            .unwrap()
            .to_owned();
        assert!(fingerprint.starts_with("sha256:"));
        fingerprints.push(fingerprint);
        let path = workspace
            .path()
            .join(".brownie/runs")
            .join(task["run_id"].as_str().unwrap())
            .join("ledger.jsonl");
        assert!(!std::fs::read_to_string(path)
            .unwrap()
            .contains(content.trim_end()));
        let events = rpc("run.events", json!({"run_id":task["run_id"]}));
        assert!(!events.to_string().contains(content.trim_end()));
    }
    assert_ne!(fingerprints[0], fingerprints[1]);
}
