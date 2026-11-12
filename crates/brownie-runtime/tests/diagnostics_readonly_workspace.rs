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
fn snapshot(
    root: &std::path::Path,
) -> std::collections::BTreeMap<std::path::PathBuf, (bool, Vec<u8>, std::time::SystemTime)> {
    fn walk(
        root: &std::path::Path,
        path: &std::path::Path,
        result: &mut std::collections::BTreeMap<
            std::path::PathBuf,
            (bool, Vec<u8>, std::time::SystemTime),
        >,
    ) {
        let metadata = std::fs::symlink_metadata(path).unwrap();
        assert!(!metadata.file_type().is_symlink());
        let directory = metadata.is_dir();
        assert!(directory || metadata.is_file());
        let bytes = if directory {
            Vec::new()
        } else {
            std::fs::read(path).unwrap()
        };
        result.insert(
            path.strip_prefix(root).unwrap().to_path_buf(),
            (directory, bytes, metadata.modified().unwrap()),
        );
        if directory {
            for entry in std::fs::read_dir(path).unwrap() {
                walk(root, &entry.unwrap().path(), result);
            }
        }
    }
    let mut result = std::collections::BTreeMap::new();
    walk(root, root, &mut result);
    result
}
fn check(kind: &str) {
    let _lock = ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let _environment = Environment::isolated();
    let workspace = tempfile::tempdir().unwrap();
    if kind == "initialized" {
        brownie_store::BrownieStore::new(workspace.path())
            .ensure_durable_schema()
            .unwrap();
    } else if kind != "empty" {
        std::fs::create_dir(workspace.path().join(".brownie")).unwrap();
        std::fs::write(
            workspace.path().join(".brownie/user-owned.txt"),
            b"preserve bytes\0\xff",
        )
        .unwrap();
        if kind == "corrupt-schema" {
            std::fs::write(
                workspace.path().join(".brownie/store-schema.json"),
                b"not a valid schema",
            )
            .unwrap();
        }
    }
    let before = snapshot(workspace.path());
    std::env::set_var("BROWNIE_WORKSPACE_ROOT", workspace.path());
    let text = brownie_runtime::handle_jsonrpc_input_line(
        r#"{"jsonrpc":"2.0","id":1,"method":"runtime.diagnostics.get"}"#,
    )
    .unwrap();
    let response: Value = serde_json::from_str(&text).unwrap();
    assert!(response.get("error").is_none(), "configuration inspection must not initialize or require the durable task store: {response}");
    assert!(response["result"]["diagnostics"]
        .as_array()
        .unwrap()
        .iter()
        .any(|d| d["code"] == "CONFIG_NOT_FOUND"));
    assert_eq!(
        snapshot(workspace.path()),
        before,
        "read-only diagnostics changed workspace bytes or mtimes"
    );
}
#[test]
fn fresh_workspace_remains_empty() {
    check("empty");
}
#[test]
fn existing_user_files_without_schema_remain_unchanged() {
    check("existing");
}
#[test]
fn malformed_task_store_does_not_prevent_readonly_config_inspection() {
    check("corrupt-schema");
}
#[test]
fn initialized_store_control_remains_unchanged() {
    check("initialized");
}
#[test]
fn normal_store_constructor_still_initializes_its_schema() {
    let _lock = ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let _environment = Environment::isolated();
    let workspace = tempfile::tempdir().unwrap();
    std::env::set_var("BROWNIE_WORKSPACE_ROOT", workspace.path());
    let store = brownie_store::BrownieStore::from_env_or_cwd().unwrap();
    assert!(store
        .tasks()
        .read_durable_schema_manifest()
        .unwrap()
        .is_some());
    assert!(!snapshot(workspace.path()).is_empty());
}
