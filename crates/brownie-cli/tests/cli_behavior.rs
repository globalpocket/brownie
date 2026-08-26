use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

fn brownie() -> &'static str {
    env!("CARGO_BIN_EXE_brownie")
}

fn fake_runtime(name: &str, body: &str) -> PathBuf {
    let dir =
        std::env::temp_dir().join(format!("brownie-cli-test-{}-{}", std::process::id(), name));
    fs::create_dir_all(&dir).unwrap();
    let path = dir.join("brownie-runtime");
    fs::write(
        &path,
        format!(
            "#!/bin/sh\nread line\nif [ -n \"$BROWNIE_FAKE_RUNTIME_CAPTURE\" ]; then printf '%s' \"$line\" > \"$BROWNIE_FAKE_RUNTIME_CAPTURE\"; fi\nprintf '%s\\n' '{}'\n",
            body
        ),
    )
    .unwrap();
    make_executable(&path);
    path
}

fn hanging_runtime(name: &str) -> PathBuf {
    let dir =
        std::env::temp_dir().join(format!("brownie-cli-test-{}-{}", std::process::id(), name));
    fs::create_dir_all(&dir).unwrap();
    let path = dir.join("brownie-runtime");
    fs::write(&path, "#!/bin/sh\nsleep 5\n").unwrap();
    make_executable(&path);
    path
}

fn make_executable(path: &Path) {
    #[cfg(unix)]
    {
        let mut permissions = fs::metadata(path).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions).unwrap();
    }
}

#[test]
fn help_succeeds_and_names_general_run_command() {
    let output = Command::new(brownie()).arg("--help").output().unwrap();
    assert!(output.status.success());
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("run <objective>"));
    assert!(stdout.contains("resume"));
    assert!(stdout.contains("status"));
    assert!(!stdout.contains("develop"));
}

#[test]
fn version_succeeds() {
    let output = Command::new(brownie()).arg("--version").output().unwrap();
    assert!(output.status.success());
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("brownie"));
    assert!(stdout.contains(env!("CARGO_PKG_VERSION")));
}

#[test]
fn invalid_invocation_exits_non_zero() {
    let output = Command::new(brownie())
        .args(["inspect", "task"])
        .output()
        .unwrap();
    assert!(!output.status.success());
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(stderr.contains("missing task-id"));
}

#[test]
fn develop_is_not_a_primary_command() {
    let output = Command::new(brownie())
        .args(["develop", "change code"])
        .output()
        .unwrap();
    assert!(!output.status.success());
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(stderr.contains("unknown command: develop"));
}

#[test]
fn status_invokes_runtime_status_and_prints_human_status() {
    let runtime = fake_runtime(
        "valid",
        r#"{"jsonrpc":"2.0","id":1,"result":{"name":"brownie-runtime","version":"0.1.0","status":"Ready"}}"#,
    );
    let capture = runtime.with_file_name("request.json");

    let output = Command::new(brownie())
        .arg("status")
        .env("BROWNIE_RUNTIME_PATH", &runtime)
        .env("BROWNIE_FAKE_RUNTIME_CAPTURE", &capture)
        .output()
        .unwrap();

    assert!(output.status.success());
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert_eq!(stdout, "brownie-runtime 0.1.0 Ready\n");
    let request = fs::read_to_string(capture).unwrap();
    let request: serde_json::Value = serde_json::from_str(&request).unwrap();
    assert_eq!(request["jsonrpc"], "2.0");
    assert_eq!(request["id"], 1);
    assert_eq!(request["method"], "runtime.status");
    assert!(request.get("params").is_none());
}

#[test]
fn json_status_invokes_runtime_status_and_stays_bounded() {
    let runtime = fake_runtime(
        "json-valid",
        r#"{"jsonrpc":"2.0","id":1,"result":{"name":"brownie-runtime","version":"0.1.0","status":"Ready"}}"#,
    );

    let output = Command::new(brownie())
        .args(["--json", "status"])
        .env("BROWNIE_RUNTIME_PATH", &runtime)
        .output()
        .unwrap();

    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("\"ok\":true"));
    assert!(stdout.contains("\"name\":\"brownie-runtime\""));
    assert!(!stdout.contains("BROWNIE_RUNTIME_PATH"));
}

#[test]
fn status_rejects_malformed_json() {
    let runtime = fake_runtime("malformed", "not-json");
    let output = Command::new(brownie())
        .arg("status")
        .env("BROWNIE_RUNTIME_PATH", &runtime)
        .output()
        .unwrap();

    assert!(!output.status.success());
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(stderr.contains("runtime returned an invalid response"));
    assert!(!stderr.contains(runtime.to_string_lossy().as_ref()));
}

#[test]
fn status_rejects_jsonrpc_error_without_exposing_runtime_payload() {
    let runtime = fake_runtime(
        "jsonrpc-error",
        r#"{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"method missing with internal detail"}}"#,
    );
    let output = Command::new(brownie())
        .args(["--json", "status"])
        .env("BROWNIE_RUNTIME_PATH", &runtime)
        .output()
        .unwrap();

    assert!(!output.status.success());
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("\"code\":\"runtime_error\""));
    assert!(!stdout.contains("internal detail"));
}

#[test]
fn status_rejects_mismatched_response_id() {
    let runtime = fake_runtime(
        "mismatch",
        r#"{"jsonrpc":"2.0","id":2,"result":{"name":"brownie-runtime","version":"0.1.0","status":"Ready"}}"#,
    );
    let output = Command::new(brownie())
        .arg("status")
        .env("BROWNIE_RUNTIME_PATH", &runtime)
        .output()
        .unwrap();

    assert!(!output.status.success());
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(stderr.contains("runtime returned an invalid response"));
}

#[test]
fn status_missing_binary_fails_closed() {
    let output = Command::new(brownie())
        .args(["--json", "status"])
        .env(
            "BROWNIE_RUNTIME_PATH",
            "/tmp/brownie-runtime-definitely-missing-for-cli-test",
        )
        .output()
        .unwrap();

    assert!(!output.status.success());
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("\"code\":\"runtime_unavailable\""));
    assert!(!stdout.contains("definitely-missing"));
}

#[test]
fn status_timeout_fails_closed() {
    let runtime = hanging_runtime("timeout");
    let output = Command::new(brownie())
        .args(["--json", "status"])
        .env("BROWNIE_RUNTIME_PATH", &runtime)
        .env("BROWNIE_RUNTIME_TIMEOUT_MS", "50")
        .output()
        .unwrap();

    assert!(!output.status.success());
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("\"code\":\"runtime_timeout\""));
}

#[test]
fn run_does_not_start_agent_loop_in_cli_2() {
    let output = Command::new(brownie())
        .args(["run", "summarize this repository"])
        .env(
            "BROWNIE_RUNTIME_PATH",
            "/tmp/brownie-runtime-should-not-be-started-for-run",
        )
        .output()
        .unwrap();

    assert!(!output.status.success());
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(stderr.contains("runtime command is not implemented in this CLI slice"));
}

#[test]
fn status_can_invoke_real_runtime_binary_when_available() {
    let runtime = build_real_runtime_binary();

    let output = Command::new(brownie())
        .arg("status")
        .env("BROWNIE_RUNTIME_PATH", runtime)
        .output()
        .unwrap();

    assert!(output.status.success());
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("brownie-runtime"));
    assert!(stdout.contains("Ready"));
}

fn build_real_runtime_binary() -> PathBuf {
    if let Some(path) = option_env!("CARGO_BIN_EXE_brownie-runtime").map(PathBuf::from) {
        if path.exists() {
            return path;
        }
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir
        .parent()
        .and_then(Path::parent)
        .expect("brownie-cli crate should live under crates/");
    let status = Command::new(env!("CARGO"))
        .args(["build", "-p", "brownie-runtime", "--bin", "brownie-runtime"])
        .current_dir(repo_root)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .expect("cargo should build brownie-runtime");
    assert!(status.success());

    let brownie_path = Path::new(brownie());
    let sibling = brownie_path
        .parent()
        .expect("brownie binary should have parent")
        .join(format!("brownie-runtime{}", std::env::consts::EXE_SUFFIX));
    if sibling.exists() {
        return sibling;
    }

    let target_debug = brownie_path
        .parent()
        .and_then(Path::parent)
        .expect("brownie binary should live under target debug dirs");
    let candidate = target_debug.join(format!("brownie-runtime{}", std::env::consts::EXE_SUFFIX));
    assert!(
        candidate.exists(),
        "brownie-runtime binary should exist after cargo build"
    );
    candidate
}
