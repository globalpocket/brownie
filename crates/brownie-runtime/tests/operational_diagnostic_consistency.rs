//! Actual RPC, ledger and workspace controls for bounded diagnostic repairs.
use serde_json::{json, Value};
use std::{ffi::OsString, path::Path, sync::Mutex};
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
fn raw(method: &str, params: Value) -> Value {
    serde_json::from_str(
        &brownie_runtime::handle_jsonrpc_input_line(
            &json!({"jsonrpc":"2.0","id":1,"method":method,"params":params}).to_string(),
        )
        .unwrap(),
    )
    .unwrap()
}
fn rpc(method: &str, params: Value) -> Value {
    let reply = raw(method, params);
    assert!(reply.get("error").is_none(), "{reply}");
    reply["result"].clone()
}
fn workspace(guard: &str) -> tempfile::TempDir {
    let temp = tempfile::tempdir().unwrap();
    std::env::set_var("BROWNIE_WORKSPACE_ROOT", temp.path());
    std::env::set_var("BROWNIE_LLM_PROVIDER", "fake");
    std::env::set_var("BROWNIE_LLM_SENSITIVE_GUARD", guard);
    std::fs::write(temp.path().join("README.md"), "original README").unwrap();
    temp
}
fn events(root: &Path, task: &Value) -> Vec<Value> {
    std::fs::read_to_string(
        root.join(".brownie/runs")
            .join(task["run_id"].as_str().unwrap())
            .join("ledger.jsonl"),
    )
    .unwrap()
    .lines()
    .map(|line| serde_json::from_str(line).unwrap())
    .collect()
}

#[test]
fn warn_and_fail_keep_the_same_observed_scan_metadata() {
    let _lock = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _env = Environment::isolated();
    let mut scans = vec![];
    for mode in ["warn", "fail"] {
        let w = workspace(mode);
        let goal = format!(
            "Read README with api_key={} and access_token={}{}",
            "sk-".to_string() + &"a".repeat(48),
            "ghp_",
            "b".repeat(40)
        );
        let task = rpc("task.start", json!({"goal":goal,"mode_id":"verifier"}));
        let result = rpc("task.run", json!({"task_id":task["task_id"]}));
        let ledger = events(w.path(), &task);
        let scan = ledger
            .iter()
            .find(|event| {
                event["kind"]
                    == if mode == "fail" {
                        "PromptSensitiveScanFailed"
                    } else {
                        "PromptSensitiveScanCompleted"
                    }
            })
            .expect("actual scan event")["payload"]
            .clone();
        assert!(scan["finding_count"].as_u64().unwrap() > 1);
        assert!(!scan["categories"].as_array().unwrap().is_empty());
        assert!(!scan["message_indexes"].as_array().unwrap().is_empty());
        if mode == "fail" {
            assert_eq!(result["status"], "Failed");
            assert!(!ledger
                .iter()
                .any(|event| event["kind"] == "LlmRequestCreated"));
        }
        scans.push(scan);
    }
    for key in ["finding_count", "categories", "message_indexes"] {
        assert_eq!(scans[0][key], scans[1][key], "{key}");
    }
}

#[test]
fn invalid_profile_guard_reports_error_instead_of_normal_off() {
    let _lock = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _env = Environment::isolated();
    let w = workspace("off");
    std::env::remove_var("BROWNIE_LLM_PROVIDER");
    std::env::remove_var("BROWNIE_LLM_SENSITIVE_GUARD");
    std::fs::create_dir_all(w.path().join(".brownie")).unwrap();
    std::fs::write(w.path().join(".brownie/config.json"),json!({"version":1,"active_profile":"owned","llm":{"profiles":{"owned":{"provider":"fake","sensitive_guard":"fial"}}}}).to_string()).unwrap();
    assert_eq!(raw("llm.status", json!({}))["error"]["code"], -32603);
    let diagnosis = rpc("runtime.diagnostics.get", json!({}));
    let rows = diagnosis["diagnostics"].as_array().unwrap();
    assert!(rows
        .iter()
        .any(|row| row["code"] == "PROMPT_SENSITIVE_GUARD_INVALID" && row["severity"] == "Error"));
    assert!(!rows
        .iter()
        .any(|row| row["code"] == "PROMPT_SENSITIVE_GUARD_PROFILE"));
    assert_eq!(diagnosis["llm_status"]["enabled"], false);
}

#[test]
fn stale_preflight_plan_matches_snapshot_and_old_target_apply_is_refused() {
    let _lock = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _env = Environment::isolated();
    let w = workspace("off");
    let task = rpc(
        "task.start",
        json!({"goal":"Implement README update","mode_id":"implementer"}),
    );
    rpc("task.run", json!({"task_id":task["task_id"]}));
    let proposals = rpc("proposal.list", json!({"run_id":task["run_id"]}));
    assert_eq!(proposals["proposals"].as_array().unwrap().len(), 1);
    let proposal = &proposals["proposals"][0];
    let params = json!({"run_id":task["run_id"],"proposal_id":proposal["proposal_id"]});
    let mut approval = params.clone();
    approval["reason"] = json!("Owned explicit approval");
    rpc("proposal.approve", approval);
    let first = rpc("proposal.preflight", params.clone());
    assert_eq!(first["snapshot"]["stale"], false);
    assert_eq!(first["apply_plan"]["status"], "Ready");
    let target = w.path().join("README.md");
    std::fs::write(&target, "changed manually").unwrap();
    let stale = rpc("proposal.preflight", params.clone());
    assert_eq!(stale["snapshot"]["stale"], true);
    let mut apply = params.clone();
    apply["authorize"] = json!(true);
    apply["expected_target_sha256"] = first["snapshot"]["file_sha256"].clone();
    if proposal["operation"] == "patch_file" {
        apply["patch_old_text"] = json!("original README");
        apply["patch_new_text"] = json!("new README content");
    } else {
        apply["replacement_content"] = json!("new README content");
    }
    let rejected = raw("proposal.apply", apply);
    assert!(rejected.get("error").is_some() || rejected["result"]["apply_status"] != "Applied");
    assert_eq!(
        std::fs::read_to_string(&target).unwrap(),
        "changed manually"
    );
    assert_eq!(
        rpc("proposal.inspect", params)["proposal"]["approval_status"],
        "Approved"
    );
    assert_eq!(stale["apply_plan"]["status"], "Blocked");
    let check = stale["apply_plan"]["checklist"]
        .as_array()
        .unwrap()
        .iter()
        .find(|check| check["name"] == "proposal_not_stale")
        .unwrap();
    assert_eq!(check["status"], "Fail");
}

#[test]
fn conflicting_dispatch_snapshot_reason_matches_actual_guard_and_stays_blocked() {
    let _lock = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _env = Environment::isolated();
    let producer = workspace("off");
    let parent = rpc(
        "task.start",
        json!({"goal":"Read README.md and summarize it.","mode_id":"orchestrator"}),
    );
    rpc("task.run", json!({"task_id":parent["task_id"]}));
    let template = events(producer.path(), &parent)
        .into_iter()
        .find(|event| event["kind"] == "SubtaskDispatchReadinessSnapshotRecorded")
        .unwrap()["payload"]
        .clone();
    for count in [1, 2] {
        let w = workspace("off");
        let task = rpc(
            "task.start",
            json!({"goal":"Summarize the owned fixture.","mode_id":"verifier"}),
        );
        let ledger = w
            .path()
            .join(".brownie/runs")
            .join(task["run_id"].as_str().unwrap())
            .join("ledger.jsonl");
        // Explicit owned schema-valid stored-state fixture, never a public
        // tampering claim or an observed production crash.
        for i in 0..count {
            let mut payload = template.clone();
            payload["snapshot_id"] = json!(format!("owned_snapshot_{i}"));
            payload["parent_task_id"] = task["task_id"].clone();
            payload["parent_run_id"] = task["run_id"].clone();
            payload["admission_id"] = json!(format!("owned_admission_{i}"));
            payload["readiness_fingerprint"] =
                json!(format!("sha256:{}", (i + 1).to_string().repeat(64)));
            let event = json!({"event_id":format!("owned_seed_{i}"),"task_id":task["task_id"],"run_id":task["run_id"],"kind":"SubtaskDispatchReadinessSnapshotRecorded","timestamp":time::OffsetDateTime::now_utc().format(&time::format_description::well_known::Rfc3339).unwrap(),"payload":payload});
            use std::io::Write;
            writeln!(
                std::fs::OpenOptions::new()
                    .append(true)
                    .open(&ledger)
                    .unwrap(),
                "{event}"
            )
            .unwrap();
        }
        rpc("task.run", json!({"task_id":task["task_id"]}));
        let guard = events(w.path(), &task)
            .into_iter()
            .find(|event| event["kind"] == "SubtaskDispatcherGuardVerdictRecorded")
            .unwrap()["payload"]
            .clone();
        assert_eq!(guard["dispatch_enabled"], false);
        assert_eq!(guard["execution_enabled"], false);
        assert_eq!(
            guard["snapshot_validity_status"],
            if count == 1 { "Current" } else { "Blocked" }
        );
        assert_eq!(
            guard["guard_reason"]
                .as_str()
                .unwrap()
                .contains("is current"),
            count == 1
        );
    }
}
