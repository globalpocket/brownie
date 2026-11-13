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
