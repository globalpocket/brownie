use serde_json::{json, Value};
use std::{collections::BTreeMap, ffi::OsString, path::Path, sync::Mutex};

static ENV_LOCK: Mutex<()> = Mutex::new(());

struct Environment(Vec<(OsString, OsString)>);
impl Environment {
    fn isolated() -> Self {
        let saved: Vec<_> = std::env::vars_os()
            .filter(|(key, _)| key.to_str().is_some_and(|s| s.starts_with("BROWNIE_")))
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
            .filter(|(key, _)| key.to_str().is_some_and(|s| s.starts_with("BROWNIE_")))
        {
            std::env::remove_var(key);
        }
        for (key, value) in &self.0 {
            std::env::set_var(key, value);
        }
    }
}

type Snapshot = BTreeMap<std::path::PathBuf, (bool, Vec<u8>, std::time::SystemTime)>;
fn snapshot(root: &Path) -> Snapshot {
    fn walk(root: &Path, path: &Path, entries: &mut Snapshot) {
        let meta = std::fs::symlink_metadata(path).unwrap();
        assert!(!meta.file_type().is_symlink());
        entries.insert(
            path.strip_prefix(root).unwrap().to_path_buf(),
            (
                meta.is_dir(),
                if meta.is_dir() {
                    vec![]
                } else {
                    std::fs::read(path).unwrap()
                },
                meta.modified().unwrap(),
            ),
        );
        if meta.is_dir() {
            for entry in std::fs::read_dir(path).unwrap() {
                walk(root, &entry.unwrap().path(), entries);
            }
        }
    }
    let mut entries = BTreeMap::new();
    walk(root, root, &mut entries);
    entries
}

fn inspection_methods() -> std::collections::BTreeSet<&'static str> {
    // Exercise every published review-queue inspection contract, not a list of
    // functions copied from the implementation under test.
    include_str!("../../../docs/specifications/runtime-protocol-spec-v0.md")
        .split('`')
        .filter(|text| {
            text.starts_with("proposal.reviewQueue")
                && text.chars().all(|ch| ch.is_ascii_alphabetic() || ch == '.')
        })
        .collect()
}

fn check(kind: &str) {
    let _lock = ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let _environment = Environment::isolated();
    let workspace = tempfile::tempdir().unwrap();
    let state = workspace.path().join(".brownie");
    let store = brownie_store::BrownieStore::new(workspace.path());
    let mut run_id = "missing_inspection_fixture".to_string();
    if matches!(
        kind,
        "initialized" | "legacy" | "pending-terminal" | "schema-lock"
    ) {
        store.ensure_durable_schema().unwrap();
        let params =
            serde_json::from_value(json!({"goal":"inspection fixture","mode_id":null})).unwrap();
        run_id = store.tasks().start_task(params).unwrap().run_id;
    }
    if kind == "user-owned" || kind == "corrupt" {
        std::fs::create_dir(&state).unwrap();
        std::fs::write(state.join("user-owned.bin"), b"preserve\0\xff").unwrap();
    }
    if kind == "corrupt" {
        std::fs::write(state.join("store-schema.json"), b"invalid schema").unwrap();
    }
    if kind == "legacy" {
        let path = state.join("store-schema.json");
        let mut value: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        value["store_schema_version"] = json!(1);
        std::fs::write(path, serde_json::to_vec(&value).unwrap()).unwrap();
    }
    if kind == "pending-terminal" {
        std::fs::write(
            store
                .tasks()
                .run_dir(&run_id)
                .join("terminal-transition.json"),
            b"pending recovery fixture",
        )
        .unwrap();
    }
    if kind == "schema-lock" {
        std::fs::write(
            state.join("store-schema.lock"),
            b"owner-controlled pending schema lock",
        )
        .unwrap();
    }
    std::env::set_var("BROWNIE_WORKSPACE_ROOT", workspace.path());
    let before = snapshot(workspace.path());
    let methods = inspection_methods();
    assert!(
        methods.len() >= 40,
        "published inspection contracts were omitted"
    );
    for method in methods {
        let request = json!({"jsonrpc":"2.0","id":81,"method":method,"params":{"run_id":run_id}});
        let text = brownie_runtime::handle_jsonrpc_input_line(&request.to_string()).unwrap();
        let response: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(
            snapshot(workspace.path()),
            before,
            "{kind}: {method} changed bytes or mtimes: {response}"
        );
        if kind == "initialized" {
            assert!(
                response.get("error").is_none(),
                "valid initialized data must remain readable: {method}: {response}"
            );
        } else if matches!(kind, "empty" | "user-owned") && response.get("error").is_none() {
            // Some published history contracts return an explicitly empty,
            // unauthorized summary for a missing run instead of an RPC error.
            let summary = response["result"]
                .as_object()
                .unwrap()
                .values()
                .next()
                .unwrap();
            assert_eq!(summary["apply_authorized"], false);
            for (field, value) in summary.as_object().unwrap() {
                if field.ends_with("_count") {
                    assert_eq!(value, 0, "missing data acquired a count: {field}");
                }
                if let Some(values) = value.as_array() {
                    assert!(values.is_empty(), "missing data acquired entries: {field}");
                }
            }
        } else {
            assert!(response.get("error").is_some(), "missing/invalid/recovery-pending data must fail closed: {kind}: {method}: {response}");
        }
    }
}

#[test]
fn fresh_workspace_stays_empty() {
    check("empty");
}
#[test]
fn user_files_without_schema_stay_unchanged() {
    check("user-owned");
}
#[test]
fn corrupt_schema_is_not_repaired_by_inspection() {
    check("corrupt");
}
#[test]
fn legacy_schema_is_not_migrated_by_inspection() {
    check("legacy");
}
#[test]
fn initialized_task_data_remain_readable_without_writes() {
    check("initialized");
}
#[test]
fn terminal_recovery_is_not_performed_by_inspection() {
    check("pending-terminal");
}
#[test]
fn schema_migration_lock_is_not_reclaimed_by_inspection() {
    check("schema-lock");
}
#[test]
fn normal_mutating_constructor_still_initializes_the_schema() {
    let _lock = ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let _environment = Environment::isolated();
    let workspace = tempfile::tempdir().unwrap();
    std::env::set_var("BROWNIE_WORKSPACE_ROOT", workspace.path());
    brownie_store::BrownieStore::from_env_or_cwd().unwrap();
    assert!(workspace
        .path()
        .join(".brownie/store-schema.json")
        .is_file());
    assert!(workspace
        .path()
        .join(".brownie/store-layout.json")
        .is_file());
}

fn copy_fixture_tree(source: &std::path::Path, destination: &std::path::Path) {
    std::fs::create_dir_all(destination).unwrap();
    for entry in std::fs::read_dir(source).unwrap() {
        let entry = entry.unwrap();
        let target = destination.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_fixture_tree(&entry.path(), &target);
        } else {
            assert!(entry.file_type().unwrap().is_file());
            std::fs::copy(entry.path(), target).unwrap();
        }
    }
}

#[test]
fn read_only_rpc_matrix_preserves_store_and_current_reads() {
    let _lock = ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let _environment = Environment::isolated();
    let run = "run_historical_v1_running_task";
    let task = "task_historical_v1_running_task";
    let mut cases = vec![
        ("run.inspect", serde_json::json!({"run_id":run}), true),
        ("run.events", serde_json::json!({"run_id":run}), true),
        ("task.inspect", serde_json::json!({"task_id":task}), true),
        ("task.get", serde_json::json!({"task_id":task}), true),
        ("proposal.list", serde_json::json!({"run_id":run}), true),
        ("llm.status", serde_json::json!({}), true),
        (
            "llm.health",
            serde_json::json!({"allow_network":false,"timeout_ms":1000}),
            true,
        ),
        ("runtime.config.get", serde_json::json!({}), true),
        ("runtime.diagnostics.get", serde_json::json!({}), true),
        ("mode.list", serde_json::json!({}), true),
        (
            "mode.get",
            serde_json::json!({"mode_id":"implementer"}),
            true,
        ),
        (
            "permission.check",
            serde_json::json!({"mode_id":"implementer","action":"ReadWorkspace"}),
            true,
        ),
    ];
    for method in [
        "proposal.inspect",
        "proposal.applyDryRunHistory",
        "proposal.auditTrail",
        "proposal.reviewBundle",
        "proposal.reviewVerdict",
        "proposal.reviewReport",
    ] {
        cases.push((
            method,
            serde_json::json!({"run_id":run,"proposal_id":"absent-proposal"}),
            false,
        ));
    }
    let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../brownie-store/tests/fixtures/historical-ledger/v1-running-task/.brownie");
    for seed in ["empty", "v1", "unversioned", "corrupt", "current"] {
        for (method, params, current_success) in &cases {
            let workspace = tempfile::tempdir().unwrap();
            std::env::set_var("BROWNIE_WORKSPACE_ROOT", workspace.path());
            if seed != "empty" {
                copy_fixture_tree(&fixture, &workspace.path().join(".brownie"));
                let schema = workspace.path().join(".brownie/store-schema.json");
                match seed {
                    "unversioned" => std::fs::remove_file(schema).unwrap(),
                    "corrupt" => std::fs::write(schema, b"invalid schema").unwrap(),
                    "current" => {
                        brownie_store::BrownieStore::from_env_or_cwd().unwrap();
                    }
                    _ => {}
                }
            }
            let before = snapshot(workspace.path());
            let request =
                serde_json::json!({"jsonrpc":"2.0","id":1,"method":method,"params":params});
            let response: Value = serde_json::from_str(
                &brownie_runtime::handle_jsonrpc_input_line(&request.to_string()).unwrap(),
            )
            .unwrap();
            assert_eq!(
                snapshot(workspace.path()),
                before,
                "{seed} {method}: read changed workspace"
            );
            if seed == "current" {
                assert_eq!(
                    response.get("error").is_none(),
                    *current_success,
                    "{seed} {method}: {response}"
                );
            }
            if [
                "llm.status",
                "llm.health",
                "runtime.config.get",
                "runtime.diagnostics.get",
            ]
            .contains(method)
            {
                assert!(
                    response.get("error").is_none(),
                    "configuration reads must not require task schema: {seed} {method}: {response}"
                );
            }
            println!("read-only matrix: {seed} {method} preserved bytes, directories and mtimes");
        }
    }
}

#[test]
fn existing_proposal_reads_preserve_payload_and_workspace() {
    let _lock = ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let _environment = Environment::isolated();
    let workspace = tempfile::tempdir().unwrap();
    std::env::set_var("BROWNIE_WORKSPACE_ROOT", workspace.path());
    std::env::set_var("BROWNIE_LLM_PROVIDER", "fake");
    std::env::set_var("BROWNIE_LLM_SENSITIVE_GUARD", "off");
    std::fs::write(workspace.path().join("README.md"), "original README").unwrap();
    let rpc = |method: &str, params: Value| -> Value {
        let request = json!({"jsonrpc":"2.0","id":1,"method":method,"params":params});
        let response: Value = serde_json::from_str(
            &brownie_runtime::handle_jsonrpc_input_line(&request.to_string()).unwrap(),
        )
        .unwrap();
        assert!(response.get("error").is_none(), "{method}: {response}");
        assert!(response["result"].is_object(), "{method}: {response}");
        response["result"].clone()
    };
    let task = rpc(
        "task.start",
        json!({"goal":"Implement README update","mode_id":"implementer"}),
    );
    rpc("task.run", json!({"task_id":task["task_id"]}));
    let listed = rpc("proposal.list", json!({"run_id":task["run_id"]}));
    assert_eq!(listed["proposals"].as_array().unwrap().len(), 1);
    let params =
        json!({"run_id":task["run_id"],"proposal_id":listed["proposals"][0]["proposal_id"]});
    let proposal = rpc("proposal.inspect", params.clone())["proposal"].clone();
    assert_eq!(proposal["proposal_id"], params["proposal_id"]);
    let before = snapshot(workspace.path());
    for method in [
        "proposal.inspect",
        "proposal.applyDryRunHistory",
        "proposal.auditTrail",
        "proposal.reviewBundle",
        "proposal.reviewVerdict",
        "proposal.reviewReport",
    ] {
        let result = rpc(method, params.clone());
        assert_eq!(
            result["proposal"], proposal,
            "{method}: existing proposal payload changed"
        );
        assert_eq!(
            snapshot(workspace.path()),
            before,
            "{method}: read changed workspace"
        );
    }
    for (method, expected_kind) in [
        ("proposal.readiness", "WorkspacePatchReadinessReportCreated"),
        (
            "proposal.applyCapability",
            "WorkspacePatchApplyCapabilityChecked",
        ),
    ] {
        let before = snapshot(workspace.path());
        let result = rpc(method, params.clone());
        assert_eq!(
            result["proposal"], proposal,
            "{method}: proposal payload changed"
        );
        let after = snapshot(workspace.path());
        assert_eq!(
            before.keys().collect::<Vec<_>>(),
            after.keys().collect::<Vec<_>>(),
            "{method}: layout changed"
        );
        let changed: Vec<_> = before
            .iter()
            .filter(|(path, value)| after.get(*path) != Some(*value))
            .collect();
        assert_eq!(
            changed.len(),
            1,
            "{method}: only existing ledger may change"
        );
        let (path, previous) = changed[0];
        assert_eq!(path.file_name().unwrap(), "ledger.jsonl");
        assert!(!previous.0);
        let current = &after[path];
        assert!(!current.0);
        assert!(
            current.1.starts_with(&previous.1),
            "{method}: history was rewritten"
        );
        let appended = &current.1[previous.1.len()..];
        let lines: Vec<_> = appended
            .split(|byte| *byte == b'\n')
            .filter(|line| !line.is_empty())
            .collect();
        assert_eq!(lines.len(), 1, "{method}: exactly one summary event");
        let event: Value = serde_json::from_slice(lines[0]).unwrap();
        assert_eq!(event["kind"], expected_kind);
        assert_eq!(event["run_id"], task["run_id"]);
        assert_eq!(event["task_id"], task["task_id"]);
        assert_eq!(event["payload"]["proposal_id"], params["proposal_id"]);
    }
}

#[test]
fn summary_inspection_refuses_invalid_states_without_mutation() {
    let _lock = ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let _environment = Environment::isolated();
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../brownie-store/tests/fixtures/historical-ledger/v1-running-task/.brownie");
    for seed in [
        "empty",
        "legacy",
        "unversioned",
        "corrupt",
        "schema-lock",
        "pending-terminal",
    ] {
        for method in ["proposal.readiness", "proposal.applyCapability"] {
            let workspace = tempfile::tempdir().unwrap();
            std::env::set_var("BROWNIE_WORKSPACE_ROOT", workspace.path());
            if seed != "empty" {
                let state = workspace.path().join(".brownie");
                copy_fixture_tree(&fixture, &state);
                let schema = state.join("store-schema.json");
                match seed {
                    "unversioned" => std::fs::remove_file(schema).unwrap(),
                    "corrupt" => std::fs::write(schema, b"invalid").unwrap(),
                    "schema-lock" | "pending-terminal" => {
                        let store = brownie_store::BrownieStore::from_env_or_cwd().unwrap();
                        let path = if seed == "schema-lock" {
                            state.join("store-schema.lock")
                        } else {
                            store
                                .tasks()
                                .run_dir("run_historical_v1_running_task")
                                .join("terminal-transition.json")
                        };
                        std::fs::write(path, b"pending owner-controlled state").unwrap();
                    }
                    _ => {}
                }
            }
            let before = snapshot(workspace.path());
            let request = json!({"jsonrpc":"2.0","id":1,"method":method,"params":{"run_id":"run_historical_v1_running_task","proposal_id":"absent-proposal"}});
            let response: Value = serde_json::from_str(
                &brownie_runtime::handle_jsonrpc_input_line(&request.to_string()).unwrap(),
            )
            .unwrap();
            assert!(
                response.get("error").is_some(),
                "{seed} {method}: {response}"
            );
            assert_eq!(
                snapshot(workspace.path()),
                before,
                "{seed} {method}: refusal changed workspace"
            );
        }
    }
}
