#[path = "../src/json_privacy_assertions.rs"]
mod json_privacy_assertions;

use json_privacy_assertions::JsonForbiddenLiteral;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

#[test]
fn actual_public_proposal_events_and_inspection_exclude_raw_fields() {
    struct Environment(Vec<(std::ffi::OsString, std::ffi::OsString)>);
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
    let saved: Vec<_> = std::env::vars_os()
        .filter(|(key, _)| key.to_str().is_some_and(|key| key.starts_with("BROWNIE_")))
        .collect();
    for (key, _) in &saved {
        std::env::remove_var(key);
    }
    let _environment = Environment(saved);
    let workspace = tempfile::tempdir().unwrap();
    std::fs::write(workspace.path().join("README.md"), "original README").unwrap();
    std::env::set_var("BROWNIE_WORKSPACE_ROOT", workspace.path());
    fn rpc(method: &str, params: Value) -> Value {
        let input = json!({"jsonrpc":"2.0", "id":1, "method":method, "params":params});
        let output = brownie_runtime::handle_jsonrpc_input_line(&input.to_string()).unwrap();
        let response: Value = serde_json::from_str(&output).unwrap();
        assert!(response.get("error").is_none(), "{response}");
        response["result"].clone()
    }
    let start = rpc(
        "task.start",
        json!({"goal":"Implement README update", "mode_id":"implementer"}),
    );
    rpc("task.run", json!({"task_id":start["task_id"]}));
    let events = rpc("run.events", json!({"run_id":start["run_id"]}));
    let proposal = events["events"]
        .as_array()
        .unwrap()
        .iter()
        .find(|event| event["kind"] == "WorkspacePatchProposed")
        .unwrap();
    assert_eq!(proposal["payload"]["validation_status"], "Valid");
    let inspected = rpc(
        "proposal.inspect",
        json!({"run_id":start["run_id"], "proposal_id":proposal["payload"]["proposal_id"]}),
    );
    for result in [events, inspected] {
        let serialized = result.to_string();
        for forbidden in ["raw_input", "raw_content", "full_content", "canonical_path"] {
            assert!(!serialized.contains_forbidden_json_literal(forbidden));
            let injected = json!({"actual":result, "injection":[{forbidden:"SYNTHETIC"}]});
            assert!(injected
                .to_string()
                .contains_forbidden_json_literal(forbidden));
        }
    }
    assert_eq!(
        std::fs::read_to_string(workspace.path().join("README.md")).unwrap(),
        "original README"
    );

    let create = rpc(
        "task.start",
        json!({
            "goal":"Implement this task.\n\n## Selected TODO\n\n- [ ] privacy-preview-fixture: Create only `new.txt`:\n  Route: implementation.",
            "mode_id":"implementer"
        }),
    );
    rpc("task.run", json!({"task_id":create["task_id"]}));
    let events = rpc("run.events", json!({"run_id":create["run_id"]}));
    let payload = events["events"]
        .as_array()
        .unwrap()
        .iter()
        .find(|event| event["kind"] == "WorkspacePatchProposed")
        .map(|event| &event["payload"])
        .expect("real Runtime created a proposal from the fixture provider");
    let proposed = "// Brownie bounded Create-only proposal.\n";
    assert_eq!(payload["validation_status"], "Valid");
    assert_eq!(payload["operation"], "create_file");
    assert_eq!(payload["content_chars"], proposed.chars().count());
    assert!(payload["diff_preview"]
        .as_str()
        .unwrap()
        .starts_with(&format!(
            "# proposed_content_sha256: sha256:{:x}\n",
            Sha256::digest(proposed.as_bytes())
        )));
    assert_eq!(payload["truncated"], true);
    let preview = payload["content_preview"].as_str().unwrap();
    assert!(proposed.starts_with(preview));
    assert_ne!(preview, proposed);
    assert_ne!(preview, proposed.trim_end());
    assert!(!workspace.path().join("new.txt").exists());
}
