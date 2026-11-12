use serde_json::Value;
use std::{ffi::OsString, sync::Mutex};

static ENV_LOCK: Mutex<()> = Mutex::new(());
const MARKER: &str = "SYNTHETIC_ENV_CREDENTIAL_NOT_A_REAL_SECRET";
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
fn check(strict: bool, custom: bool, credential: Option<&str>) {
    let _lock = ENV_LOCK.lock().unwrap_or_else(|poison| poison.into_inner());
    let _environment = Environment::isolated();
    let workspace = tempfile::tempdir().unwrap();
    // Initialize the durable fixture explicitly; the separate first-call observation remains unresolved.
    brownie_store::BrownieStore::new(workspace.path())
        .ensure_durable_schema()
        .unwrap();
    let baseline = snapshot(workspace.path());
    std::env::set_var("BROWNIE_WORKSPACE_ROOT", workspace.path());
    std::env::set_var("BROWNIE_LLM_PROVIDER", "openai-compatible");
    std::env::set_var("BROWNIE_LLM_BASE_URL", "http://127.0.0.1:9/v1");
    std::env::set_var("BROWNIE_LLM_MODEL", "fixture-no-network");
    std::env::set_var("BROWNIE_LLM_STRICT", if strict { "true" } else { "false" });
    let selected = if custom {
        "BROWNIE_DIAGNOSTICS_FIXTURE_KEY"
    } else {
        "BROWNIE_LLM_API_KEY"
    };
    if custom {
        std::env::set_var("BROWNIE_LLM_API_KEY_ENV", selected);
    }
    if let Some(value) = credential {
        std::env::set_var(selected, value);
    }
    let text = brownie_runtime::handle_jsonrpc_input_line(
        r#"{"jsonrpc":"2.0","id":1,"method":"runtime.diagnostics.get"}"#,
    )
    .unwrap();
    assert!(
        !text.contains(MARKER),
        "credentials must not enter diagnostics"
    );
    let response: Value = serde_json::from_str(&text).unwrap();
    assert!(response.get("error").is_none(), "{response}");
    let result = &response["result"];
    let rows = result["diagnostics"].as_array().unwrap();
    let matching = |code: &str| {
        rows.iter()
            .filter(|row| row["code"] == code)
            .collect::<Vec<_>>()
    };
    let present = credential.is_some_and(|value| !value.trim().is_empty());
    assert_eq!(result["llm_status"]["enabled"], present);
    assert_eq!(result["llm_status"]["strict"], strict);
    assert_eq!(result["llm_status"]["will_fallback_to_fake"], !strict);
    assert_eq!(matching("PROVIDER_ENV_OVERRIDE").len(), 1);
    assert!(matching("PROVIDER_UNKNOWN").is_empty());
    if present {
        for code in [
            "API_KEY_ENV_MISSING",
            "PROVIDER_STRICT_FAILURE",
            "PROVIDER_FALLBACK_TO_FAKE",
        ] {
            assert!(matching(code).is_empty(), "{result}");
        }
    } else {
        let missing = matching("API_KEY_ENV_MISSING");
        assert_eq!(missing.len(), 1, "{result}");
        assert!(missing[0]["message"].as_str().unwrap().contains(selected));
        assert_eq!(
            missing[0]["severity"],
            serde_json::to_value(brownie_protocol::DiagnosticSeverity::Warning).unwrap()
        );
        let expected = if strict {
            "PROVIDER_STRICT_FAILURE"
        } else {
            "PROVIDER_FALLBACK_TO_FAKE"
        };
        let opposite = if strict {
            "PROVIDER_FALLBACK_TO_FAKE"
        } else {
            "PROVIDER_STRICT_FAILURE"
        };
        let evidence = matching(expected);
        assert_eq!(evidence.len(), 1, "{result}");
        assert!(matching(opposite).is_empty(), "{result}");
        let severity = if strict {
            brownie_protocol::DiagnosticSeverity::Error
        } else {
            brownie_protocol::DiagnosticSeverity::Warning
        };
        assert_eq!(
            evidence[0]["severity"],
            serde_json::to_value(severity).unwrap()
        );
    }
    assert_eq!(
        snapshot(workspace.path()),
        baseline,
        "diagnostics must not mutate an initialized workspace"
    );
}
#[test]
fn default_missing_strict() {
    check(true, false, None);
}
#[test]
fn default_missing_fallback() {
    check(false, false, None);
}
#[test]
fn default_blank_strict() {
    check(true, false, Some(" \t\n"));
}
#[test]
fn default_blank_fallback() {
    check(false, false, Some(" \t\n"));
}
#[test]
fn custom_missing_strict() {
    check(true, true, None);
}
#[test]
fn custom_missing_fallback() {
    check(false, true, None);
}
#[test]
fn default_present_strict() {
    check(true, false, Some(MARKER));
}
#[test]
fn default_present_fallback() {
    check(false, false, Some(MARKER));
}
#[test]
fn custom_present_strict() {
    check(true, true, Some(MARKER));
}
#[test]
fn custom_present_fallback() {
    check(false, true, Some(MARKER));
}
