use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use sha2::{Digest, Sha256};

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

static RUNTIME_BUILD_COUNTER: AtomicUsize = AtomicUsize::new(0);
static RUNTIME_BUILD_LOCK: Mutex<()> = Mutex::new(());
static CURRENT_AGENTMODES_CHECKOUT_LOCK: Mutex<()> = Mutex::new(());
const READ_ONLY_FAKE_RUNTIME_TIMEOUT_MS: &str = "10000";

fn brownie() -> &'static str {
    env!("CARGO_BIN_EXE_brownie")
}

fn fake_runtime(name: &str, body: &str) -> PathBuf {
    let dir = unique_test_dir(name);
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

fn fake_runtime_sequence(name: &str, bodies: &[&str]) -> PathBuf {
    let dir = unique_test_dir(name);
    fs::create_dir_all(&dir).unwrap();
    let _ = fs::remove_file(dir.join("count"));
    let _ = fs::remove_file(dir.join("requests.ndjson"));
    for (index, body) in bodies.iter().enumerate() {
        fs::write(dir.join(format!("response-{index}.json")), body).unwrap();
    }
    let path = dir.join("brownie-runtime");
    fs::write(
        &path,
        r#"#!/bin/sh
read line
count_file="${BROWNIE_FAKE_RUNTIME_COUNT:-$(dirname "$0")/count}"
count=0
if [ -f "$count_file" ]; then count=$(cat "$count_file"); fi
next=$((count + 1))
printf '%s' "$next" > "$count_file"
if [ -n "$BROWNIE_FAKE_RUNTIME_CAPTURE" ]; then printf '%s\n' "$line" >> "$BROWNIE_FAKE_RUNTIME_CAPTURE"; fi
response="$(dirname "$0")/response-${count}.json"
if [ -f "$response" ]; then
  cat "$response"
  printf '\n'
else
  printf '%s\n' '{"jsonrpc":"2.0","id":1,"error":{"code":-32603,"message":"unexpected fake runtime call with internal detail"}}'
fi
"#,
    )
    .unwrap();
    make_executable(&path);
    path
}

fn fake_runtime_resume_hanging_continue(name: &str) -> PathBuf {
    let dir = unique_test_dir(name);
    fs::create_dir_all(&dir).unwrap();
    let _ = fs::remove_file(dir.join("requests.ndjson"));
    let path = dir.join("brownie-runtime");
    fs::write(
        &path,
        r#"#!/bin/sh
read line
if [ -n "$BROWNIE_FAKE_RUNTIME_CAPTURE" ]; then printf '%s\n' "$line" >> "$BROWNIE_FAKE_RUNTIME_CAPTURE"; fi
case "$line" in
  *'"method":"task.list"'*)
    printf '%s\n' '{"jsonrpc":"2.0","id":1,"result":{"tasks":[],"progress_overview":{"source_fingerprint":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","aggregate_sequence":7,"task_count":0,"root_task_ids":[],"runnable_task_ids":[],"blocked_task_ids":[],"terminal_task_ids":[],"parent_join_ready_task_ids":[],"status_counts":{"created":0,"queued":0,"running":0,"completed":0,"failed":0,"cancelled":0},"stage_counts":[],"next_action_sets":[],"blocked_sets":[],"headless_route_candidates":[],"nodes":[],"edges":[]}}}'
    ;;
  *)
    sleep 5
    ;;
esac
"#,
    )
    .unwrap();
    make_executable(&path);
    path
}

fn hanging_runtime(name: &str) -> PathBuf {
    let dir = unique_test_dir(name);
    fs::create_dir_all(&dir).unwrap();
    let path = dir.join("brownie-runtime");
    fs::write(&path, "#!/bin/sh\nsleep 5\n").unwrap();
    make_executable(&path);
    path
}

fn unique_test_dir(name: &str) -> PathBuf {
    let id = RUNTIME_BUILD_COUNTER.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!(
        "brownie-cli-test-{}-{name}-{id}",
        std::process::id()
    ))
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
    assert!(stdout.contains("mode list"));
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
fn command_specific_help_succeeds_without_runtime_startup() {
    for topic in ["run", "resume", "status", "inspect", "list", "mode"] {
        let output = Command::new(brownie())
            .args(["help", topic])
            .env(
                "BROWNIE_RUNTIME_PATH",
                "/tmp/brownie-runtime-must-not-be-started-for-help",
            )
            .output()
            .unwrap();

        assert!(output.status.success(), "help topic failed: {topic}");
        assert!(output.stderr.is_empty());
        let stdout = String::from_utf8(output.stdout).unwrap();
        assert!(stdout.contains("Usage:"), "missing usage for {topic}");
        assert!(
            stdout.contains("Boundary:"),
            "missing runtime boundary for {topic}"
        );
        assert!(!stdout.contains("develop"));
        assert!(!stdout.contains("JSON-RPC"));
        assert!(!stdout.contains("BROWNIE_RUNTIME_PATH"));
    }
}

#[test]
fn help_run_is_the_command_help_surface_and_run_help_token_remains_objective() {
    let help = Command::new(brownie())
        .args(["help", "run"])
        .output()
        .unwrap();
    assert!(help.status.success());
    let help_stdout = String::from_utf8(help.stdout).unwrap();
    assert!(help_stdout.contains("brownie run <objective>"));
    assert!(help_stdout.contains("Tokens after run"));

    let runtime = fake_runtime(
        "run-help-objective",
        r#"{"jsonrpc":"2.0","id":1,"result":{"status":"task_executed","session_id":"session-1","drive_id":"drive-1","next_action":"inspect_progress_overview","completion_closure":{"status":"budget_exhausted"},"journey":{"journey_id":"journey-1","task_id":"task-1","run_id":"run-1"}}}"#,
    );
    let capture = runtime.with_file_name("request.json");
    let run = Command::new(brownie())
        .args(["run", "--help"])
        .env("BROWNIE_RUNTIME_PATH", &runtime)
        .env(
            "BROWNIE_RUNTIME_OBJECTIVE_TIMEOUT_MS",
            READ_ONLY_FAKE_RUNTIME_TIMEOUT_MS,
        )
        .env("BROWNIE_FAKE_RUNTIME_CAPTURE", &capture)
        .output()
        .unwrap();

    assert!(run.status.success());
    let request = fs::read_to_string(capture).unwrap();
    let request: serde_json::Value = serde_json::from_str(&request).unwrap();
    assert_eq!(request["method"], "headless.run.drive");
    assert_eq!(
        request["params"]["journey_admission"]["task_start"]["goal"],
        "--help"
    );
}

#[test]
fn unknown_help_topic_exits_with_invalid_invocation() {
    let output = Command::new(brownie())
        .args(["help", "provider"])
        .output()
        .unwrap();

    assert!(!output.status.success());
    assert_eq!(output.status.code(), Some(64));
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(stderr.contains("unknown help topic: provider"));
}

#[test]
fn invalid_invocation_exits_non_zero() {
    let output = Command::new(brownie())
        .args(["inspect", "task"])
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert_eq!(output.status.code(), Some(64));
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
    assert_eq!(output.status.code(), Some(64));
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
        .env(
            "BROWNIE_RUNTIME_TIMEOUT_MS",
            READ_ONLY_FAKE_RUNTIME_TIMEOUT_MS,
        )
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
        .env(
            "BROWNIE_RUNTIME_TIMEOUT_MS",
            READ_ONLY_FAKE_RUNTIME_TIMEOUT_MS,
        )
        .output()
        .unwrap();

    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    let payload: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    assert_eq!(payload["ok"], true);
    assert_eq!(payload["command"], "status");
    assert_eq!(payload["exit_code"], 0);
    assert_eq!(payload["status"]["name"], "brownie-runtime");
    assert_eq!(payload["status"]["version"], "0.1.0");
    assert_eq!(payload["status"]["status"], "Ready");
    assert!(!stdout.contains("BROWNIE_RUNTIME_PATH"));
}

#[test]
fn status_rejects_malformed_json() {
    let runtime = fake_runtime("malformed", "not-json");
    let output = Command::new(brownie())
        .arg("status")
        .env("BROWNIE_RUNTIME_PATH", &runtime)
        .env(
            "BROWNIE_RUNTIME_TIMEOUT_MS",
            READ_ONLY_FAKE_RUNTIME_TIMEOUT_MS,
        )
        .output()
        .unwrap();

    assert!(!output.status.success());
    assert_eq!(output.status.code(), Some(70));
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
        .env(
            "BROWNIE_RUNTIME_TIMEOUT_MS",
            READ_ONLY_FAKE_RUNTIME_TIMEOUT_MS,
        )
        .output()
        .unwrap();

    assert!(!output.status.success());
    assert_eq!(output.status.code(), Some(70));
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("\"code\":\"runtime_error\""));
    assert!(stdout.contains("\"exit_code\":70"));
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
        .env(
            "BROWNIE_RUNTIME_TIMEOUT_MS",
            READ_ONLY_FAKE_RUNTIME_TIMEOUT_MS,
        )
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
    assert_eq!(output.status.code(), Some(69));
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("\"code\":\"runtime_unavailable\""));
    assert!(stdout.contains("\"exit_code\":69"));
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
    assert_eq!(output.status.code(), Some(70));
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("\"code\":\"runtime_timeout\""));
    assert!(stdout.contains("\"exit_code\":70"));
    let payload: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    assert_eq!(payload["retryable"], true);
    assert_eq!(payload["terminal_failure"], false);
    assert_eq!(payload["controller_action"], "retry");
    assert_eq!(payload["automation"]["controller_action"], "retry");
    assert_eq!(payload["automation"]["outcome_scope"], "process");
}

#[test]
fn run_uses_objective_transport_timeout_class() {
    let runtime = hanging_runtime("objective-timeout");
    let output = Command::new(brownie())
        .args(["--json", "run", "long running objective"])
        .env("BROWNIE_RUNTIME_PATH", &runtime)
        .env("BROWNIE_RUNTIME_OBJECTIVE_TIMEOUT_MS", "50")
        .output()
        .unwrap();

    assert!(!output.status.success());
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("\"code\":\"runtime_timeout\""));
    let payload: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    assert_eq!(payload["controller_action"], "return_to_supervisor");
    assert_eq!(payload["process_admission_state"], "unknown");
    assert!(payload["next_invocation"].is_null());
    let recovery_identity = payload["recovery_identity"].as_object().unwrap();
    let session_id = recovery_identity["session_id"].as_str().unwrap();
    assert!(session_id.starts_with("cli.run."));
    assert_eq!(recovery_identity["drive_id"], format!("{session_id}.drive"));
    assert_eq!(
        recovery_identity["journey_id"],
        format!("{session_id}.journey")
    );
    assert!(recovery_identity["objective_fingerprint"]
        .as_str()
        .unwrap()
        .starts_with("sha256:"));
}

#[test]
fn inspect_task_invokes_fixed_runtime_method_and_prints_bounded_human_output() {
    let runtime = fake_runtime(
        "inspect-task",
        r#"{"jsonrpc":"2.0","id":1,"result":{"task":{"task_id":"task-1","run_id":"run-1","status":"Created"},"run":{"run_id":"run-1","task_id":"task-1","status":"Created","progress_snapshot":{"current_stage":"created","next_action":"run_task_explicitly"},"event_count":1}}}"#,
    );
    let capture = runtime.with_file_name("request.json");

    let output = Command::new(brownie())
        .args(["inspect", "task", "task-1"])
        .env("BROWNIE_RUNTIME_PATH", &runtime)
        .env(
            "BROWNIE_RUNTIME_TIMEOUT_MS",
            READ_ONLY_FAKE_RUNTIME_TIMEOUT_MS,
        )
        .env("BROWNIE_FAKE_RUNTIME_CAPTURE", &capture)
        .output()
        .unwrap();

    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("task task-1"));
    assert!(stdout.contains("status: Created"));
    assert!(stdout.contains("stage: created"));
    assert!(stdout.contains("next: run_task_explicitly"));
    assert!(!stdout.contains("BROWNIE_RUNTIME_PATH"));

    let request = fs::read_to_string(capture).unwrap();
    let request: serde_json::Value = serde_json::from_str(&request).unwrap();
    assert_eq!(request["jsonrpc"], "2.0");
    assert_eq!(request["id"], 1);
    assert_eq!(request["method"], "task.inspect");
    assert_eq!(
        request["params"],
        serde_json::json!({ "task_id": "task-1" })
    );
}

#[test]
fn inspect_run_invokes_fixed_runtime_method_and_prints_json_result() {
    let runtime = fake_runtime(
        "inspect-run-json",
        r#"{"jsonrpc":"2.0","id":1,"result":{"run":{"run_id":"run-1","task_id":"task-1","status":"Created","progress_snapshot":{"current_stage":"created","next_action":"run_task_explicitly"},"event_count":1}}}"#,
    );
    let capture = runtime.with_file_name("request.json");

    let output = Command::new(brownie())
        .args(["--json", "inspect", "run", "run-1"])
        .env("BROWNIE_RUNTIME_PATH", &runtime)
        .env(
            "BROWNIE_RUNTIME_TIMEOUT_MS",
            READ_ONLY_FAKE_RUNTIME_TIMEOUT_MS,
        )
        .env("BROWNIE_FAKE_RUNTIME_CAPTURE", &capture)
        .output()
        .unwrap();

    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    let payload: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    assert_eq!(payload["ok"], true);
    assert_eq!(payload["command"], "inspect run");
    assert_eq!(payload["exit_code"], 0);
    assert_eq!(payload["run_inspect"]["run_id"], "run-1");
    assert_eq!(payload["run_inspect"]["task_id"], "task-1");
    assert_eq!(payload["run_inspect"]["status"], "Created");
    assert_eq!(payload["run_inspect"]["current_stage"], "created");
    assert_eq!(payload["run_inspect"]["next_action"], "run_task_explicitly");
    assert_eq!(payload["run_inspect"]["event_count"], 1);
    assert!(payload["run_inspect"].get("progress_snapshot").is_none());
    assert!(!stdout.contains("BROWNIE_RUNTIME_PATH"));

    let request = fs::read_to_string(capture).unwrap();
    let request: serde_json::Value = serde_json::from_str(&request).unwrap();
    assert_eq!(request["method"], "run.inspect");
    assert_eq!(request["params"], serde_json::json!({ "run_id": "run-1" }));
}

#[test]
fn inspect_recovery_invokes_runtime_probe_and_projects_three_state_json_contract() {
    let runtime = fake_runtime(
        "inspect-recovery-json",
        r#"{"jsonrpc":"2.0","id":1,"result":{"admission_state":"persisted","session_id":"cli.run.recover","drive_id":"cli.run.recover.drive","journey_id":"cli.run.recover.journey","objective_fingerprint":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","task_id":"task-recover","run_id":"run-recover","recovery_recommendation":"continue_with_scoped_resume_after_persisted_identity_confirmation","next_runtime_invocation":null}}"#,
    );
    let capture = runtime.with_file_name("request.json");

    let output = Command::new(brownie())
        .args([
            "--json",
            "inspect",
            "recovery",
            "cli.run.recover",
            "cli.run.recover.drive",
            "cli.run.recover.journey",
            "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        ])
        .env("BROWNIE_RUNTIME_PATH", &runtime)
        .env(
            "BROWNIE_RUNTIME_TIMEOUT_MS",
            READ_ONLY_FAKE_RUNTIME_TIMEOUT_MS,
        )
        .env("BROWNIE_FAKE_RUNTIME_CAPTURE", &capture)
        .output()
        .unwrap();

    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    let payload: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    assert_eq!(payload["ok"], true);
    assert_eq!(payload["command"], "inspect recovery");
    assert_eq!(payload["recovery"]["admission_state"], "persisted");
    assert_eq!(payload["recovery"]["task_id"], "task-recover");
    assert_eq!(payload["recovery"]["run_id"], "run-recover");
    assert_eq!(payload["recovery"]["controller_action"], "resume");
    assert_eq!(payload["recovery"]["next_invocation"]["command"], "resume");
    assert_eq!(
        payload["recovery"]["next_invocation"]["arguments"],
        serde_json::json!([
            "--session-id",
            "cli.run.recover",
            "--journey-id",
            "cli.run.recover.journey",
            "--task-id",
            "task-recover",
            "--run-id",
            "run-recover"
        ])
    );
    assert_eq!(
        payload["recovery"]["next_invocation"]["scope"],
        serde_json::json!({
            "session_id": "cli.run.recover",
            "journey_id": "cli.run.recover.journey",
            "task_id": "task-recover",
            "run_id": "run-recover"
        })
    );
    assert_eq!(payload["automation"]["admission_state"], "persisted");
    assert_eq!(
        payload["automation"]["next_invocation"],
        payload["recovery"]["next_invocation"]
    );
    assert!(!stdout.contains("Recover exact failed run identity"));
    assert!(!stdout.contains("BROWNIE_RUNTIME_PATH"));

    let request = fs::read_to_string(capture).unwrap();
    let request: serde_json::Value = serde_json::from_str(&request).unwrap();
    assert_eq!(request["method"], "headless.run.recovery_probe");
    assert_eq!(
        request["params"],
        serde_json::json!({
            "authorize_recovery_probe": true,
            "session_id": "cli.run.recover",
            "drive_id": "cli.run.recover.drive",
            "journey_id": "cli.run.recover.journey",
            "objective_fingerprint": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        })
    );
}

#[test]
fn inspect_recovery_projects_not_persisted_without_objective_text() {
    let runtime = fake_runtime(
        "inspect-recovery-not-persisted",
        r#"{"jsonrpc":"2.0","id":1,"result":{"admission_state":"not_persisted","session_id":"cli.run.missing","drive_id":"cli.run.missing.drive","journey_id":"cli.run.missing.journey","objective_fingerprint":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","recovery_recommendation":"retry_original_run_with_same_objective_allowed","next_runtime_invocation":null}}"#,
    );

    let output = Command::new(brownie())
        .args([
            "--json",
            "inspect",
            "recovery",
            "cli.run.missing",
            "cli.run.missing.drive",
            "cli.run.missing.journey",
            "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        ])
        .env("BROWNIE_RUNTIME_PATH", &runtime)
        .env(
            "BROWNIE_RUNTIME_TIMEOUT_MS",
            READ_ONLY_FAKE_RUNTIME_TIMEOUT_MS,
        )
        .output()
        .unwrap();

    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    let payload: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    assert_eq!(payload["recovery"]["admission_state"], "not_persisted");
    assert_eq!(payload["recovery"]["task_id"], serde_json::Value::Null);
    assert_eq!(payload["recovery"]["run_id"], serde_json::Value::Null);
    assert_eq!(payload["recovery"]["controller_action"], "run");
    assert_eq!(payload["recovery"]["next_invocation"]["command"], "run");
    assert_eq!(payload["automation"]["admission_state"], "not_persisted");
    assert_eq!(payload["automation"]["controller_action"], "run");
    assert_eq!(
        payload["automation"]["next_invocation"],
        payload["recovery"]["next_invocation"]
    );
    assert_eq!(payload["automation"]["task_id"], serde_json::Value::Null);
    assert_eq!(payload["automation"]["run_id"], serde_json::Value::Null);
    assert_eq!(
        payload["recovery"]["next_invocation"]["arguments"][0],
        "<original-objective>"
    );
    assert!(!stdout.contains("original objective"));
    assert!(!stdout.contains("BROWNIE_RUNTIME_PATH"));
}

#[test]
fn inspect_recovery_projects_unknown_without_automatic_next_invocation() {
    let runtime = fake_runtime(
        "inspect-recovery-unknown",
        r#"{"jsonrpc":"2.0","id":1,"result":{"admission_state":"unknown","session_id":"cli.run.unknown","drive_id":"cli.run.unknown.drive","journey_id":"cli.run.unknown.journey","objective_fingerprint":"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","recovery_recommendation":"supervisor_reconcile_or_probe_runtime_state","next_runtime_invocation":null}}"#,
    );

    let output = Command::new(brownie())
        .args([
            "--json",
            "inspect",
            "recovery",
            "cli.run.unknown",
            "cli.run.unknown.drive",
            "cli.run.unknown.journey",
            "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        ])
        .env("BROWNIE_RUNTIME_PATH", &runtime)
        .env(
            "BROWNIE_RUNTIME_TIMEOUT_MS",
            READ_ONLY_FAKE_RUNTIME_TIMEOUT_MS,
        )
        .output()
        .unwrap();

    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    let payload: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    assert_eq!(payload["recovery"]["admission_state"], "unknown");
    assert_eq!(
        payload["recovery"]["controller_action"],
        "return_to_supervisor"
    );
    assert!(payload["recovery"]["next_invocation"].is_null());
    assert_eq!(payload["automation"]["admission_state"], "unknown");
    assert_eq!(
        payload["automation"]["controller_action"],
        "return_to_supervisor"
    );
    assert!(payload["automation"]["next_invocation"].is_null());
    assert_eq!(payload["automation"]["task_id"], serde_json::Value::Null);
    assert_eq!(payload["automation"]["run_id"], serde_json::Value::Null);
    assert!(!stdout.contains("provider_response"));
    assert!(!stdout.contains("BROWNIE_RUNTIME_PATH"));
}

#[test]
fn inspect_task_json_uses_stable_public_projection() {
    let runtime = fake_runtime(
        "inspect-task-json",
        r#"{"jsonrpc":"2.0","id":1,"result":{"task":{"task_id":"task-1","run_id":"run-1","status":"Created"},"run":{"run_id":"run-1","task_id":"task-1","status":"Created","progress_snapshot":{"current_stage":"created","next_action":"run_task_explicitly"},"event_count":1}}}"#,
    );

    let output = Command::new(brownie())
        .args(["--json", "inspect", "task", "task-1"])
        .env("BROWNIE_RUNTIME_PATH", &runtime)
        .env(
            "BROWNIE_RUNTIME_TIMEOUT_MS",
            READ_ONLY_FAKE_RUNTIME_TIMEOUT_MS,
        )
        .output()
        .unwrap();

    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    let payload: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    assert_eq!(payload["ok"], true);
    assert_eq!(payload["command"], "inspect task");
    assert_eq!(payload["exit_code"], 0);
    assert_eq!(payload["task_inspect"]["task"]["task_id"], "task-1");
    assert_eq!(payload["task_inspect"]["task"]["run_id"], "run-1");
    assert_eq!(payload["task_inspect"]["task"]["status"], "Created");
    assert_eq!(payload["task_inspect"]["run"]["run_id"], "run-1");
    assert_eq!(payload["task_inspect"]["run"]["current_stage"], "created");
    assert_eq!(
        payload["task_inspect"]["run"]["next_action"],
        "run_task_explicitly"
    );
    assert!(payload["task_inspect"].get("progress_snapshot").is_none());
}

#[test]
fn list_tasks_invokes_fixed_runtime_method_and_prints_progress_counts() {
    let runtime = fake_runtime(
        "list-tasks",
        r#"{"jsonrpc":"2.0","id":1,"result":{"tasks":[{"task_id":"task-1","run_id":"run-1","status":"Created"}],"progress_overview":{"task_count":1,"runnable_task_ids":["task-1"],"blocked_task_ids":[],"terminal_task_ids":[]}}}"#,
    );
    let capture = runtime.with_file_name("request.json");

    let output = Command::new(brownie())
        .args(["list", "tasks"])
        .env("BROWNIE_RUNTIME_PATH", &runtime)
        .env(
            "BROWNIE_RUNTIME_TIMEOUT_MS",
            READ_ONLY_FAKE_RUNTIME_TIMEOUT_MS,
        )
        .env("BROWNIE_FAKE_RUNTIME_CAPTURE", &capture)
        .output()
        .unwrap();

    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("tasks 1"));
    assert!(stdout.contains("runnable: 1"));
    assert!(stdout.contains("task-1 Created run-1"));

    let request = fs::read_to_string(capture).unwrap();
    let request: serde_json::Value = serde_json::from_str(&request).unwrap();
    assert_eq!(request["method"], "task.list");
    assert_eq!(
        request["params"],
        serde_json::json!({
            "bounds": {
                "max_tasks": 10,
                "max_task_goal_chars": 0,
                "max_task_ids": 50,
                "max_groups": 5,
                "max_group_task_ids": 20,
                "max_headless_route_candidates": 5,
                "max_nodes": 0,
                "max_edges": 0
            }
        })
    );
}

#[test]
fn list_tasks_renders_runtime_owned_progress_next_actions_and_bounds_rows() {
    let runtime = fake_runtime(
        "list-tasks-rich-progress",
        r#"{"jsonrpc":"2.0","id":1,"result":{"tasks":[{"task_id":"task-1","run_id":"run-1","status":"Created"},{"task_id":"task-2","run_id":"run-2","status":"Completed"}],"progress_overview":{"source_fingerprint":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","aggregate_sequence":7,"task_count":2,"root_task_ids":["task-1"],"runnable_task_ids":["task-1"],"blocked_task_ids":["task-2"],"terminal_task_ids":["task-2"],"parent_join_ready_task_ids":["task-2"],"status_counts":{"created":1,"queued":0,"running":0,"completed":1,"failed":0,"cancelled":0},"stage_counts":[{"current_stage":"created","task_count":1},{"current_stage":"parent_join_ready","task_count":1}],"next_action_sets":[{"next_action":"run_task_explicitly","task_count":1,"task_ids":["task-1"]},{"next_action":"run_parent_task_explicitly","task_count":1,"task_ids":["task-2"]}],"blocked_sets":[{"current_stage":"parent_join_ready","next_action":"run_parent_task_explicitly","task_count":1,"task_ids":["task-2"]}],"headless_route_candidates":[{"kind":"headless_continue_once","reason":"internal reason should not render","task_id":"task-1","run_id":"run-1","progress_fingerprint":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","aggregate_sequence":7,"route_fingerprint":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","priority":1,"next_action":"run_task_explicitly"}],"nodes":[],"edges":[]}}}"#,
    );

    let output = Command::new(brownie())
        .args(["list", "tasks"])
        .env("BROWNIE_RUNTIME_PATH", &runtime)
        .env(
            "BROWNIE_RUNTIME_TIMEOUT_MS",
            READ_ONLY_FAKE_RUNTIME_TIMEOUT_MS,
        )
        .output()
        .unwrap();

    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("parent_join_ready: 1"));
    assert!(stdout
        .contains("status_counts: created:1 queued:0 running:0 completed:1 failed:0 cancelled:0"));
    assert!(stdout.contains("stages:"));
    assert!(stdout.contains("created: 1"));
    assert!(stdout.contains("next actions:"));
    assert!(stdout.contains("run_task_explicitly: 1"));
    assert!(stdout.contains("blocked groups:"));
    assert!(stdout.contains("parent_join_ready -> run_parent_task_explicitly: 1"));
    assert!(stdout.contains("headless routes:"));
    assert!(stdout.contains("p1 headless_continue_once run_task_explicitly task:task-1"));
    assert!(!stdout.contains("internal reason"));
}

#[test]
fn list_tasks_human_output_is_bounded_for_large_runtime_progress() {
    let mut tasks = Vec::new();
    for index in 0..14 {
        tasks.push(serde_json::json!({
            "task_id": format!("task-{index}"),
            "run_id": format!("run-{index}"),
            "status": "Created"
        }));
    }
    let mut next_action_sets = Vec::new();
    let mut route_candidates = Vec::new();
    for index in 0..8 {
        next_action_sets.push(serde_json::json!({
            "next_action": format!("action-{index}"),
            "task_count": 1,
            "task_ids": [format!("task-{index}")]
        }));
        route_candidates.push(serde_json::json!({
            "kind": "headless_continue_once",
            "reason": format!("reason-{index}"),
            "task_id": format!("task-{index}"),
            "run_id": format!("run-{index}"),
            "progress_fingerprint": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "aggregate_sequence": 7,
            "route_fingerprint": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            "priority": index,
            "next_action": format!("action-{index}")
        }));
    }
    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "result": {
            "tasks": tasks,
            "progress_overview": {
                "source_fingerprint": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "aggregate_sequence": 7,
                "task_count": 14,
                "root_task_ids": [],
                "runnable_task_ids": [],
                "blocked_task_ids": [],
                "terminal_task_ids": [],
                "parent_join_ready_task_ids": [],
                "status_counts": {"created":14,"queued":0,"running":0,"completed":0,"failed":0,"cancelled":0},
                "stage_counts": [],
                "next_action_sets": next_action_sets,
                "blocked_sets": [],
                "headless_route_candidates": route_candidates,
                "nodes": [],
                "edges": []
            }
        }
    })
    .to_string();
    let runtime = fake_runtime("list-tasks-large-progress", &body);

    let output = Command::new(brownie())
        .args(["list", "tasks"])
        .env("BROWNIE_RUNTIME_PATH", &runtime)
        .env(
            "BROWNIE_RUNTIME_TIMEOUT_MS",
            READ_ONLY_FAKE_RUNTIME_TIMEOUT_MS,
        )
        .output()
        .unwrap();

    assert!(output.status.success());
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("... 3 more next action groups"));
    assert!(stdout.contains("... 3 more headless route candidates"));
    assert!(stdout.contains("... 4 more"));
    assert!(!stdout.contains("task-13 Created run-13"));
    assert!(!stdout.contains("reason-0"));
}

#[test]
fn list_tasks_json_uses_stable_bounded_public_projection() {
    let runtime = fake_runtime(
        "list-tasks-json-projection",
        r#"{"jsonrpc":"2.0","id":1,"result":{"tasks":[{"task_id":"task-1","run_id":"run-1","status":"Created"}],"progress_overview":{"source_fingerprint":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","aggregate_sequence":7,"task_count":1,"root_task_ids":["task-1"],"runnable_task_ids":["task-1"],"blocked_task_ids":[],"terminal_task_ids":[],"parent_join_ready_task_ids":[],"status_counts":{"created":1,"queued":0,"running":0,"completed":0,"failed":0,"cancelled":0},"stage_counts":[{"current_stage":"created","task_count":1}],"next_action_sets":[{"next_action":"run_task_explicitly","task_count":1,"task_ids":["task-1"]}],"blocked_sets":[],"headless_route_candidates":[{"kind":"headless_continue_once","reason":"internal reason should not render","task_id":"task-1","run_id":"run-1","progress_fingerprint":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","aggregate_sequence":7,"route_fingerprint":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","priority":1,"next_action":"run_task_explicitly"}],"nodes":[],"edges":[]}}}"#,
    );

    let output = Command::new(brownie())
        .args(["--json", "list", "tasks"])
        .env("BROWNIE_RUNTIME_PATH", &runtime)
        .env(
            "BROWNIE_RUNTIME_TIMEOUT_MS",
            READ_ONLY_FAKE_RUNTIME_TIMEOUT_MS,
        )
        .output()
        .unwrap();

    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    let payload: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    assert_eq!(payload["ok"], true);
    assert_eq!(payload["command"], "list tasks");
    assert_eq!(payload["exit_code"], 0);
    assert_eq!(payload["task_list"]["task_count"], 1);
    assert_eq!(payload["task_list"]["runnable_count"], 1);
    assert_eq!(payload["task_list"]["tasks"][0]["task_id"], "task-1");
    assert_eq!(
        payload["task_list"]["stage_counts"][0]["current_stage"],
        "created"
    );
    assert_eq!(
        payload["task_list"]["next_action_sets"][0]["next_action"],
        "run_task_explicitly"
    );
    assert_eq!(
        payload["task_list"]["headless_route_candidates"][0]["kind"],
        "headless_continue_once"
    );
    assert_eq!(
        payload["task_list"]["headless_route_candidates"][0]["task_id"],
        "task-1"
    );
    assert!(payload["task_list"].get("progress_overview").is_none());
    assert!(payload["task_list"]["headless_route_candidates"][0]
        .get("reason")
        .is_none());
    assert!(!stdout.contains("internal reason"));
}

#[test]
fn list_tasks_json_bounds_large_progress_and_reports_truncation() {
    let mut tasks = Vec::new();
    let mut stage_counts = Vec::new();
    let mut next_action_sets = Vec::new();
    let mut blocked_sets = Vec::new();
    let mut route_candidates = Vec::new();
    for index in 0..14 {
        tasks.push(serde_json::json!({
            "task_id": format!("task-{index}"),
            "run_id": format!("run-{index}"),
            "status": "Created"
        }));
    }
    for index in 0..8 {
        stage_counts.push(serde_json::json!({
            "current_stage": format!("stage-{index}"),
            "task_count": 1
        }));
        next_action_sets.push(serde_json::json!({
            "next_action": format!("action-{index}"),
            "task_count": 1,
            "task_ids": [format!("task-{index}")]
        }));
        blocked_sets.push(serde_json::json!({
            "current_stage": format!("blocked-stage-{index}"),
            "next_action": format!("blocked-action-{index}"),
            "task_count": 1,
            "task_ids": [format!("task-{index}")]
        }));
        route_candidates.push(serde_json::json!({
            "kind": "headless_continue_once",
            "reason": format!("secret-route-reason-{index}"),
            "task_id": format!("task-{index}"),
            "run_id": format!("run-{index}"),
            "progress_fingerprint": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "aggregate_sequence": 7,
            "route_fingerprint": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            "priority": index,
            "next_action": format!("action-{index}")
        }));
    }
    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "result": {
            "tasks": tasks,
            "progress_overview": {
                "source_fingerprint": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "aggregate_sequence": 7,
                "task_count": 14,
                "root_task_ids": [],
                "runnable_task_ids": [],
                "blocked_task_ids": [],
                "terminal_task_ids": [],
                "parent_join_ready_task_ids": [],
                "status_counts": {"created":14,"queued":0,"running":0,"completed":0,"failed":0,"cancelled":0},
                "stage_counts": stage_counts,
                "next_action_sets": next_action_sets,
                "blocked_sets": blocked_sets,
                "headless_route_candidates": route_candidates,
                "nodes": [],
                "edges": []
            }
        }
    })
    .to_string();
    let runtime = fake_runtime("list-tasks-json-large-progress", &body);

    let output = Command::new(brownie())
        .args(["--json", "list", "tasks"])
        .env("BROWNIE_RUNTIME_PATH", &runtime)
        .env(
            "BROWNIE_RUNTIME_TIMEOUT_MS",
            READ_ONLY_FAKE_RUNTIME_TIMEOUT_MS,
        )
        .output()
        .unwrap();

    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    let payload: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    assert_eq!(payload["task_list"]["tasks"].as_array().unwrap().len(), 10);
    assert_eq!(
        payload["task_list"]["stage_counts"]
            .as_array()
            .unwrap()
            .len(),
        5
    );
    assert_eq!(
        payload["task_list"]["next_action_sets"]
            .as_array()
            .unwrap()
            .len(),
        5
    );
    assert_eq!(
        payload["task_list"]["blocked_sets"]
            .as_array()
            .unwrap()
            .len(),
        5
    );
    assert_eq!(
        payload["task_list"]["headless_route_candidates"]
            .as_array()
            .unwrap()
            .len(),
        5
    );
    assert_eq!(payload["task_list"]["truncated"]["tasks"], true);
    assert_eq!(payload["task_list"]["truncated"]["stage_counts"], true);
    assert_eq!(payload["task_list"]["truncated"]["next_action_sets"], true);
    assert_eq!(payload["task_list"]["truncated"]["blocked_sets"], true);
    assert_eq!(
        payload["task_list"]["truncated"]["headless_route_candidates"],
        true
    );
    assert!(!stdout.contains("task-13"));
    assert!(!stdout.contains("secret-route-reason"));
}

#[test]
fn list_tasks_rejects_malformed_runtime_progress_groups() {
    let runtime = fake_runtime(
        "list-tasks-malformed-progress-groups",
        r#"{"jsonrpc":"2.0","id":1,"result":{"tasks":[],"progress_overview":{"task_count":0,"runnable_task_ids":[],"blocked_task_ids":[],"terminal_task_ids":[],"stage_counts":"not-an-array"}}}"#,
    );

    let output = Command::new(brownie())
        .args(["list", "tasks"])
        .env("BROWNIE_RUNTIME_PATH", &runtime)
        .env(
            "BROWNIE_RUNTIME_TIMEOUT_MS",
            READ_ONLY_FAKE_RUNTIME_TIMEOUT_MS,
        )
        .output()
        .unwrap();

    assert!(!output.status.success());
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(stderr.contains("runtime returned an invalid response"));
}

#[test]
fn mode_list_invokes_runtime_mode_list_and_prints_bounded_human_output() {
    let runtime = fake_runtime(
        "mode-list",
        r#"{"jsonrpc":"2.0","id":1,"result":{"modes":[{"mode_id":"orchestrator","display_name":"Orchestrator","role_definition":"Break down and coordinate bounded work","permissions":{"read_only":true,"workspace_write":false,"process_exec":false,"network_access":false,"service_control":false,"destructive":false,"can_spawn_subtasks":true,"codebase_index":true}}]}}"#,
    );
    let capture = runtime.with_file_name("request.json");

    let output = Command::new(brownie())
        .args(["mode", "list"])
        .env("BROWNIE_RUNTIME_PATH", &runtime)
        .env(
            "BROWNIE_RUNTIME_TIMEOUT_MS",
            READ_ONLY_FAKE_RUNTIME_TIMEOUT_MS,
        )
        .env("BROWNIE_FAKE_RUNTIME_CAPTURE", &capture)
        .output()
        .unwrap();

    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("modes 1"));
    assert!(stdout.contains("orchestrator Orchestrator"));
    assert!(stdout.contains("role: Break down and coordinate bounded work"));
    assert!(stdout.contains("workspace_write=false"));
    assert!(stdout.contains("can_spawn_subtasks=true"));

    let request = fs::read_to_string(capture).unwrap();
    let request: serde_json::Value = serde_json::from_str(&request).unwrap();
    assert_eq!(request["method"], "mode.list");
    assert!(request.get("params").is_none());
}

#[test]
fn mode_list_json_uses_runtime_owned_bounded_projection() {
    let runtime = fake_runtime(
        "mode-list-json",
        r#"{"jsonrpc":"2.0","id":1,"result":{"modes":[{"mode_id":"orchestrator","display_name":"Orchestrator","role_definition":"Break down and coordinate bounded work","permissions":{"read_only":true,"workspace_write":false,"process_exec":false,"network_access":false,"service_control":false,"destructive":false,"can_spawn_subtasks":true,"codebase_index":true}}]}}"#,
    );

    let output = Command::new(brownie())
        .args(["--json", "mode", "list"])
        .env("BROWNIE_RUNTIME_PATH", &runtime)
        .env(
            "BROWNIE_RUNTIME_TIMEOUT_MS",
            READ_ONLY_FAKE_RUNTIME_TIMEOUT_MS,
        )
        .output()
        .unwrap();

    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    let payload: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    assert_eq!(payload["ok"], true);
    assert_eq!(payload["command"], "mode list");
    assert_eq!(payload["exit_code"], 0);
    assert_eq!(payload["mode_list"]["mode_count"], 1);
    assert_eq!(payload["mode_list"]["modes"][0]["mode_id"], "orchestrator");
    assert_eq!(
        payload["mode_list"]["modes"][0]["permissions"]["workspace_write"],
        false
    );
    assert!(payload["mode_list"].get("modepack_path").is_none());
}

#[test]
fn inspect_run_rejects_mismatched_response_id() {
    let runtime = fake_runtime(
        "inspect-run-mismatch",
        r#"{"jsonrpc":"2.0","id":2,"result":{"run":{"run_id":"run-1","task_id":"task-1","status":"Created","progress_snapshot":{"current_stage":"created","next_action":"run_task_explicitly"},"event_count":1}}}"#,
    );

    let output = Command::new(brownie())
        .args(["inspect", "run", "run-1"])
        .env("BROWNIE_RUNTIME_PATH", &runtime)
        .env(
            "BROWNIE_RUNTIME_TIMEOUT_MS",
            READ_ONLY_FAKE_RUNTIME_TIMEOUT_MS,
        )
        .output()
        .unwrap();

    assert!(!output.status.success());
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(stderr.contains("runtime returned an invalid response"));
}

#[test]
fn inspect_task_runtime_error_does_not_expose_runtime_payload() {
    let runtime = fake_runtime(
        "inspect-task-error",
        r#"{"jsonrpc":"2.0","id":1,"error":{"code":-32602,"message":"task not found with internal store detail"}}"#,
    );

    let output = Command::new(brownie())
        .args(["--json", "inspect", "task", "missing-task"])
        .env("BROWNIE_RUNTIME_PATH", &runtime)
        .env(
            "BROWNIE_RUNTIME_TIMEOUT_MS",
            READ_ONLY_FAKE_RUNTIME_TIMEOUT_MS,
        )
        .output()
        .unwrap();

    assert!(!output.status.success());
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("\"code\":\"runtime_error\""));
    assert!(!stdout.contains("internal store detail"));
}

#[test]
fn run_invokes_fixed_headless_drive_and_prints_bounded_human_output() {
    let runtime = fake_runtime(
        "run-headless-drive",
        r#"{"jsonrpc":"2.0","id":1,"result":{"status":"task_executed","session_id":"cli.run.test","drive_id":"cli.run.test.drive","start_session_sequence":0,"end_session_sequence":1,"replayed":false,"max_advances":1,"max_steps_per_advance":1,"advance_count":1,"executed_count":1,"replayed_count":0,"stop_reason":"budget_exhausted","drive_fingerprint":"sha256:1111111111111111111111111111111111111111111111111111111111111111","completion_closure":{"status":"budget_exhausted","stop_reason":"bounded","terminal_task_count":0,"accepted_completion_count":0,"last_terminal_task_id":null,"closure_fingerprint":"sha256:2222222222222222222222222222222222222222222222222222222222222222"},"start_progress":{"progress_fingerprint":"sha256:3333333333333333333333333333333333333333333333333333333333333333","aggregate_sequence":0},"next_action":"inspect_progress_overview","journey":{"journey_id":"cli.run.test.journey","session_id":"cli.run.test","drive_id":"cli.run.test.drive","task_id":"task-1","run_id":"run-1","post_aggregate_sequence":1,"closure_status":"budget_exhausted","next_action":"inspect_progress_overview","replayed":false,"journey_fingerprint":"sha256:4444444444444444444444444444444444444444444444444444444444444444"},"terminal_completion_evidence":{"final_state":"Completed","task_status":"Completed","completion_result_fingerprint":"sha256:5555555555555555555555555555555555555555555555555555555555555555","completion_summary_preview":"objective completed","completion_summary_redacted":false,"completion_summary_truncated":false}}}"#,
    );
    let capture = runtime.with_file_name("request.json");

    let output = Command::new(brownie())
        .args(["run", "summarize this repository"])
        .env("BROWNIE_RUNTIME_PATH", &runtime)
        .env("BROWNIE_FAKE_RUNTIME_CAPTURE", &capture)
        .output()
        .unwrap();

    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("run cli.run.test"));
    assert!(stdout.contains("status: task_executed"));
    assert!(stdout.contains("journey: cli.run.test.journey"));
    assert!(stdout.contains("task: task-1"));
    assert!(stdout.contains("runtime_run: run-1"));
    assert!(stdout.contains("closure: budget_exhausted"));
    assert!(stdout.contains("next: inspect_progress_overview"));
    assert!(stdout.contains("completion: objective completed"));
    assert!(!stdout.contains("BROWNIE_RUNTIME_PATH"));

    let request = fs::read_to_string(capture).unwrap();
    let request: serde_json::Value = serde_json::from_str(&request).unwrap();
    assert_eq!(request["jsonrpc"], "2.0");
    assert_eq!(request["id"], 1);
    assert_eq!(request["method"], "headless.run.drive");
    assert_eq!(request["params"]["authorize"], true);
    assert_eq!(request["params"]["expected_start_session_sequence"], 0);
    assert_eq!(request["params"]["max_advances"], 3);
    assert_eq!(request["params"]["max_steps_per_advance"], 1);
    assert!(request["params"].get("context_budget").is_none());
    assert_eq!(
        request["params"]["journey_admission"]["task_start"]["goal"],
        "summarize this repository"
    );
    assert!(request["params"]["journey_admission"]["task_start"]
        .get("mode_id")
        .is_none());
    assert!(request["params"]["session_id"]
        .as_str()
        .unwrap()
        .starts_with("cli.run."));
    assert!(request["params"]["drive_id"]
        .as_str()
        .unwrap()
        .ends_with(".drive"));
    assert!(request["params"]["journey_admission"]["journey_id"]
        .as_str()
        .unwrap()
        .ends_with(".journey"));
}

#[test]
fn run_accepts_and_finalizes_runtime_owned_complete_closure() {
    let runtime = fake_runtime_sequence(
        "run-accepts-complete",
        &[
            r#"{"jsonrpc":"2.0","id":1,"result":{"status":"task_executed","session_id":"cli.run.accepted","drive_id":"cli.run.accepted.drive","start_session_sequence":0,"end_session_sequence":1,"replayed":false,"max_advances":3,"max_steps_per_advance":1,"advance_count":1,"executed_count":1,"replayed_count":0,"stop_reason":"complete","drive_fingerprint":"sha256:1111111111111111111111111111111111111111111111111111111111111111","completion_closure":{"status":"complete","stop_reason":"complete","terminal_task_count":1,"accepted_completion_count":0,"last_terminal_task_id":"task-accepted","closure_fingerprint":"sha256:2222222222222222222222222222222222222222222222222222222222222222"},"next_action":"complete_headless_run","journey":{"journey_id":"cli.run.accepted.journey","session_id":"cli.run.accepted","drive_id":"cli.run.accepted.drive","task_id":"task-accepted","run_id":"run-accepted","post_aggregate_sequence":1,"closure_status":"complete","next_action":"complete_headless_run","replayed":false,"journey_fingerprint":"sha256:3333333333333333333333333333333333333333333333333333333333333333"},"terminal_completion_evidence":{"final_state":"Completed","task_status":"Completed","completion_result_fingerprint":"sha256:4444444444444444444444444444444444444444444444444444444444444444","completion_summary_preview":"accepted objective completed"}}}"#,
            r#"{"jsonrpc":"2.0","id":1,"result":{"task_id":"task-accepted","run_id":"run-accepted","status":"Completed","completion_acceptance":{"acceptance_id":"cli.run.accepted.ok","task_id":"task-accepted","run_id":"run-accepted","status":"AcceptedComplete","terminal_completion_fingerprint":"sha256:4444444444444444444444444444444444444444444444444444444444444444","acceptance_fingerprint":"sha256:5555555555555555555555555555555555555555555555555555555555555555","verifier_gate_status":"NotRequired","replayed":false,"next_action":"inspect_accepted_completion"}}}"#,
            r#"{"jsonrpc":"2.0","id":1,"result":{"status":"no_eligible_task","session_id":"cli.run.accepted","drive_id":"cli.run.accepted.done","start_session_sequence":1,"end_session_sequence":1,"replayed":false,"max_advances":1,"max_steps_per_advance":1,"advance_count":0,"executed_count":0,"replayed_count":0,"stop_reason":"complete","drive_fingerprint":"sha256:6666666666666666666666666666666666666666666666666666666666666666","completion_closure":{"status":"complete","stop_reason":"complete","terminal_task_count":1,"accepted_completion_count":1,"last_terminal_task_id":"task-accepted","closure_fingerprint":"sha256:7777777777777777777777777777777777777777777777777777777777777777"},"next_action":"close_headless_run","journey":{"journey_id":"cli.run.accepted.journey","session_id":"cli.run.accepted","drive_id":"cli.run.accepted.done","task_id":"task-accepted","run_id":"run-accepted","post_aggregate_sequence":1,"closure_status":"complete","next_action":"close_headless_run","replayed":true,"journey_fingerprint":"sha256:3333333333333333333333333333333333333333333333333333333333333333"},"terminal_completion_evidence":{"final_state":"Completed","task_status":"Completed","completion_result_fingerprint":"sha256:4444444444444444444444444444444444444444444444444444444444444444","completion_summary_preview":"accepted objective completed"},"accepted_completion":{"task_id":"task-accepted","run_id":"run-accepted","acceptance_id":"cli.run.accepted.ok","status":"AcceptedComplete","terminal_completion_fingerprint":"sha256:4444444444444444444444444444444444444444444444444444444444444444","acceptance_fingerprint":"sha256:5555555555555555555555555555555555555555555555555555555555555555","verifier_gate_status":"NotRequired","replayed":true,"next_action":"close_headless_run"}}}"#,
            r#"{"jsonrpc":"2.0","id":1,"result":{"status":"no_eligible_task","session_id":"cli.run.accepted","drive_id":"cli.run.accepted.done","start_session_sequence":1,"end_session_sequence":1,"replayed":true,"max_advances":1,"max_steps_per_advance":1,"advance_count":0,"executed_count":0,"replayed_count":0,"stop_reason":"complete","drive_fingerprint":"sha256:6666666666666666666666666666666666666666666666666666666666666666","completion_closure":{"status":"complete","stop_reason":"complete","terminal_task_count":1,"accepted_completion_count":1,"last_terminal_task_id":"task-accepted","closure_fingerprint":"sha256:7777777777777777777777777777777777777777777777777777777777777777"},"next_action":"close_headless_run","journey":{"journey_id":"cli.run.accepted.journey","session_id":"cli.run.accepted","drive_id":"cli.run.accepted.done","task_id":"task-accepted","run_id":"run-accepted","post_aggregate_sequence":1,"closure_status":"complete","next_action":"close_headless_run","replayed":true,"journey_fingerprint":"sha256:3333333333333333333333333333333333333333333333333333333333333333"},"terminal_completion_evidence":{"final_state":"Completed","task_status":"Completed","completion_result_fingerprint":"sha256:4444444444444444444444444444444444444444444444444444444444444444","completion_summary_preview":"accepted objective completed"},"accepted_completion":{"task_id":"task-accepted","run_id":"run-accepted","acceptance_id":"cli.run.accepted.ok","status":"AcceptedComplete","terminal_completion_fingerprint":"sha256:4444444444444444444444444444444444444444444444444444444444444444","acceptance_fingerprint":"sha256:5555555555555555555555555555555555555555555555555555555555555555","verifier_gate_status":"NotRequired","replayed":true,"next_action":"close_headless_run"},"completion_finalization":{"finalization_fingerprint":"sha256:8888888888888888888888888888888888888888888888888888888888888888","closure_fingerprint":"sha256:7777777777777777777777777777777777777777777777777777777777777777","progress_fingerprint":"sha256:9999999999999999999999999999999999999999999999999999999999999999","aggregate_sequence":1,"status":"finalized","terminal_task_count":1,"total_task_count":1,"owner_task_id":"task-accepted","owner_run_id":"run-accepted","terminal_completion_fingerprint":"sha256:4444444444444444444444444444444444444444444444444444444444444444","replayed":false,"next_action":"close_headless_run"}}}"#,
        ],
    );
    let capture = runtime.with_file_name("requests.ndjson");
    let count = runtime.with_file_name("count");

    let output = Command::new(brownie())
        .args(["run", "finish a small objective"])
        .env("BROWNIE_RUNTIME_PATH", &runtime)
        .env("BROWNIE_FAKE_RUNTIME_CAPTURE", &capture)
        .env("BROWNIE_FAKE_RUNTIME_COUNT", &count)
        .output()
        .unwrap();

    assert!(
        output.status.success(),
        "run failed with status {:?}\nstdout:\n{}\nstderr:\n{}",
        output.status.code(),
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("closure: complete"));
    assert!(stdout.contains("accepted: AcceptedComplete"));
    assert!(stdout.contains(
        "finalization: sha256:8888888888888888888888888888888888888888888888888888888888888888"
    ));
    assert!(!stdout.contains("BROWNIE_RUNTIME_PATH"));

    let requests = fs::read_to_string(capture).unwrap();
    let requests: Vec<serde_json::Value> = requests
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(requests.len(), 4);
    assert_eq!(requests[0]["method"], "headless.run.drive");
    assert_eq!(requests[0]["params"]["max_advances"], 3);
    assert_eq!(requests[1]["method"], "task.run");
    assert_eq!(
        requests[1]["params"]["completion_acceptance"]["authorize_completion_acceptance"],
        true
    );
    assert_eq!(
        requests[1]["params"]["completion_acceptance"]["expected_completion_result_fingerprint"],
        "sha256:4444444444444444444444444444444444444444444444444444444444444444"
    );
    assert_eq!(requests[2]["method"], "headless.run.drive");
    assert_eq!(requests[2]["params"]["drive_id"], "cli.run.accepted.done");
    assert!(requests[2]["params"]
        .get("authorize_completion_finalization")
        .is_none());
    assert_eq!(requests[3]["method"], "headless.run.drive");
    assert_eq!(
        requests[3]["params"]["authorize_completion_finalization"],
        true
    );
    assert_eq!(
        requests[3]["params"]["expected_completion_closure_fingerprint"],
        "sha256:7777777777777777777777777777777777777777777777777777777777777777"
    );
}

#[test]
fn run_same_objective_uses_distinct_invocation_identities() {
    let runtime = fake_runtime_sequence(
        "run-distinct-identity",
        &[
            r#"{"jsonrpc":"2.0","id":1,"result":{"status":"task_executed","session_id":"cli.run.fake1","drive_id":"cli.run.fake1.drive","start_session_sequence":0,"end_session_sequence":1,"replayed":false,"max_advances":1,"max_steps_per_advance":1,"advance_count":1,"executed_count":1,"replayed_count":0,"stop_reason":"budget_exhausted","drive_fingerprint":"sha256:1111111111111111111111111111111111111111111111111111111111111111","completion_closure":{"status":"budget_exhausted","stop_reason":"bounded","terminal_task_count":0,"accepted_completion_count":0,"last_terminal_task_id":null,"closure_fingerprint":"sha256:2222222222222222222222222222222222222222222222222222222222222222"},"start_progress":{"progress_fingerprint":"sha256:3333333333333333333333333333333333333333333333333333333333333333","aggregate_sequence":0},"next_action":"inspect_progress_overview","journey":{"journey_id":"cli.run.fake1.journey","session_id":"cli.run.fake1","drive_id":"cli.run.fake1.drive","task_id":"task-1","run_id":"run-1","post_aggregate_sequence":1,"closure_status":"budget_exhausted","next_action":"inspect_progress_overview","replayed":false,"journey_fingerprint":"sha256:4444444444444444444444444444444444444444444444444444444444444444"}}}"#,
            r#"{"jsonrpc":"2.0","id":1,"result":{"status":"task_executed","session_id":"cli.run.fake2","drive_id":"cli.run.fake2.drive","start_session_sequence":0,"end_session_sequence":1,"replayed":false,"max_advances":1,"max_steps_per_advance":1,"advance_count":1,"executed_count":1,"replayed_count":0,"stop_reason":"budget_exhausted","drive_fingerprint":"sha256:1111111111111111111111111111111111111111111111111111111111111111","completion_closure":{"status":"budget_exhausted","stop_reason":"bounded","terminal_task_count":0,"accepted_completion_count":0,"last_terminal_task_id":null,"closure_fingerprint":"sha256:2222222222222222222222222222222222222222222222222222222222222222"},"start_progress":{"progress_fingerprint":"sha256:3333333333333333333333333333333333333333333333333333333333333333","aggregate_sequence":0},"next_action":"inspect_progress_overview","journey":{"journey_id":"cli.run.fake2.journey","session_id":"cli.run.fake2","drive_id":"cli.run.fake2.drive","task_id":"task-2","run_id":"run-2","post_aggregate_sequence":1,"closure_status":"budget_exhausted","next_action":"inspect_progress_overview","replayed":false,"journey_fingerprint":"sha256:4444444444444444444444444444444444444444444444444444444444444444"}}}"#,
        ],
    );
    let capture = runtime.with_file_name("requests.ndjson");
    let count = runtime.with_file_name("count");

    for _ in 0..2 {
        let output = Command::new(brownie())
            .args(["run", "repeatable objective"])
            .env("BROWNIE_RUNTIME_PATH", &runtime)
            .env("BROWNIE_FAKE_RUNTIME_CAPTURE", &capture)
            .env("BROWNIE_FAKE_RUNTIME_COUNT", &count)
            .output()
            .unwrap();
        assert!(output.status.success());
    }

    let requests = fs::read_to_string(capture).unwrap();
    let requests: Vec<serde_json::Value> = requests
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(requests.len(), 2);
    let first_session = requests[0]["params"]["session_id"].as_str().unwrap();
    let second_session = requests[1]["params"]["session_id"].as_str().unwrap();
    assert!(first_session.starts_with("cli.run."));
    assert!(second_session.starts_with("cli.run."));
    assert_ne!(first_session, second_session);
    assert_eq!(
        requests[0]["params"]["journey_admission"]["task_start"]["goal"],
        "repeatable objective"
    );
    assert_eq!(
        requests[1]["params"]["journey_admission"]["task_start"]["goal"],
        "repeatable objective"
    );
}

#[test]
fn run_preserves_objective_tokens_that_look_like_cli_options() {
    assert_run_preserves_objective(
        "run-preserve-json-token",
        &["run", "analyze", "the", "--json", "output", "format"],
        "analyze the --json output format",
    );
    assert_run_preserves_objective(
        "run-preserve-help-token",
        &["run", "explain", "--help", "behavior"],
        "explain --help behavior",
    );
    assert_run_preserves_objective(
        "run-preserve-version-token",
        &["run", "compare", "-V", "and", "--version"],
        "compare -V and --version",
    );
}

#[test]
fn run_leading_json_is_global_and_later_json_is_objective() {
    assert_run_preserves_objective(
        "run-leading-json-only",
        &["--json", "run", "analyze", "--json", "output"],
        "analyze --json output",
    );
}

#[test]
fn json_run_outputs_bounded_runtime_owned_result() {
    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "result": {
            "status": "task_executed",
            "session_id": "cli.run.json",
            "drive_id": "cli.run.json.drive",
            "stop_reason": "budget_exhausted",
            "completion_closure": {
                "status": "budget_exhausted"
            },
            "next_action": "inspect_progress_overview",
            "journey": {
                "journey_id": "cli.run.json.journey",
                "task_id": "task-json",
                "run_id": "run-json"
            },
            "terminal_completion_evidence": {
                "completion_result_fingerprint": "sha256:6666666666666666666666666666666666666666666666666666666666666666",
                "completion_summary_preview": "json completed"
            },
            "execution_outcome": {
                "schema_version": 1,
                "outcome_scope": "objective",
                "class": "continuation_required",
                "status": "continuation_required",
                "controller_action": "resume",
                "continuation_required": true,
                "completed": false,
                "blocked": false,
                "retryable": true,
                "terminal_failure": false,
                "stop_reason": "budget_exhausted",
                "next_invocation": {
                    "command": "resume",
                    "arguments": []
                }
            }
        }
    })
    .to_string();
    let runtime = fake_runtime("json-run", &body);

    let output = Command::new(brownie())
        .args(["--json", "run", "write a bounded note"])
        .env("BROWNIE_RUNTIME_PATH", &runtime)
        .env("BROWNIE_RUNTIME_PATH_SHOULD_NOT_LEAK", "secret-path")
        .output()
        .unwrap();

    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    let payload: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    assert_eq!(payload["ok"], true);
    assert_eq!(payload["command"], "run");
    assert_eq!(payload["exit_code"], 0);
    assert_eq!(payload["run"]["status"], "task_executed");
    assert_eq!(payload["run"]["session_id"], "cli.run.json");
    assert_eq!(payload["run"]["journey_id"], "cli.run.json.journey");
    assert_eq!(payload["run"]["task_id"], "task-json");
    assert_eq!(payload["run"]["run_id"], "run-json");
    assert_eq!(
        payload["run"]["completion_closure_status"],
        "budget_exhausted"
    );
    assert_eq!(
        payload["run"]["completion_summary_preview"],
        "json completed"
    );
    assert_eq!(payload["run"]["continuation_required"], true);
    assert_eq!(payload["run"]["completed"], false);
    assert_eq!(payload["run"]["blocked"], false);
    assert_eq!(payload["run"]["retryable"], true);
    assert_eq!(payload["run"]["terminal_failure"], false);
    assert_eq!(payload["run"]["controller_action"], "resume");
    assert_eq!(payload["run"]["stop_class"], "continuation_required");
    assert_eq!(payload["automation"]["controller_action"], "resume");
    assert_eq!(payload["automation"]["schema_version"], 1);
    assert_eq!(payload["automation"]["outcome_scope"], "objective");
    assert_eq!(payload["automation"]["status"], "continuation_required");
    assert_eq!(payload["automation"]["outcome_source"], "runtime");
    assert_eq!(
        payload["automation"]["next_invocation"]["command"],
        "resume"
    );
    assert_eq!(
        payload["run"]["automation"]["status"],
        "continuation_required"
    );
    assert_eq!(payload["run"]["automation"]["task_id"], "task-json");
    assert_eq!(payload["run"]["automation"]["run_id"], "run-json");
    assert_eq!(
        payload["run"]["automation"]["journey_id"],
        "cli.run.json.journey"
    );
    assert_eq!(
        payload["run"]["automation"]["stop_reason"],
        "budget_exhausted"
    );
    assert_eq!(payload["run"]["automation"]["controller_action"], "resume");
    assert!(payload["run"].get("execution_outcome").is_none());
    assert!(payload["run"].get("advances").is_none());
    assert!(!stdout.contains("secret-path"));
    assert!(!stdout.contains("BROWNIE_RUNTIME_PATH"));
}

#[test]
fn cli_external_loop_policy_guard_uses_runtime_outcome_and_selected_route() {
    let source =
        fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("src/runtime_client.rs"))
            .unwrap();
    let old_token_helper = format!("{}{}", "contains_loop", "_token");
    let old_invoke_action = format!("{}{}", "invoke", "_again");
    let old_human_action = format!("{}{}", "return_to", "_human");
    let old_candidate_sort = format!("{}{}", "resume_candidates", ".sort_by");
    assert!(source.contains("execution_outcome"));
    assert!(source.contains("selected_headless_route"));
    assert!(!source.contains(&old_token_helper));
    assert!(!source.contains(&format!("\"{old_invoke_action}\"")));
    assert!(!source.contains(&format!("\"{old_human_action}\"")));
    assert!(!source.contains(&old_candidate_sort));
}

#[test]
fn run_runtime_error_does_not_expose_runtime_payload() {
    let runtime = fake_runtime(
        "run-jsonrpc-error",
        r#"{"jsonrpc":"2.0","id":1,"error":{"code":-32602,"message":"bad objective with api_key=secret-internal-detail"}}"#,
    );

    let output = Command::new(brownie())
        .args(["--json", "run", "bad objective"])
        .env("BROWNIE_RUNTIME_PATH", &runtime)
        .output()
        .unwrap();

    assert!(!output.status.success());
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("\"code\":\"runtime_error\""));
    assert!(!stdout.contains("secret-internal-detail"));
}

#[test]
fn run_rejects_invalid_runtime_shape() {
    let runtime = fake_runtime(
        "run-invalid-shape",
        r#"{"jsonrpc":"2.0","id":1,"result":{"status":"task_executed","session_id":"cli.run.invalid","drive_id":"cli.run.invalid.drive"}}"#,
    );

    let output = Command::new(brownie())
        .args(["run", "invalid shape"])
        .env("BROWNIE_RUNTIME_PATH", &runtime)
        .output()
        .unwrap();

    assert!(!output.status.success());
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(stderr.contains("runtime returned an invalid response"));
}

#[test]
fn run_rejects_missing_required_run_status() {
    let runtime = fake_runtime(
        "run-missing-required-status",
        r#"{"jsonrpc":"2.0","id":1,"result":{"session_id":"cli.run.invalid","drive_id":"cli.run.invalid.drive","next_action":"inspect_progress_overview","completion_closure":{"status":"incomplete"}}}"#,
    );

    let output = Command::new(brownie())
        .args(["run", "invalid run status"])
        .env("BROWNIE_RUNTIME_PATH", &runtime)
        .output()
        .unwrap();

    assert!(!output.status.success());
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(stderr.contains("runtime returned an invalid response"));
}

#[test]
fn run_rejects_missing_completion_closure_status() {
    let runtime = fake_runtime(
        "run-missing-closure-status",
        r#"{"jsonrpc":"2.0","id":1,"result":{"status":"task_executed","session_id":"cli.run.invalid","drive_id":"cli.run.invalid.drive","next_action":"inspect_progress_overview","completion_closure":{}}}"#,
    );

    let output = Command::new(brownie())
        .args(["--json", "run", "invalid closure"])
        .env("BROWNIE_RUNTIME_PATH", &runtime)
        .output()
        .unwrap();

    assert!(!output.status.success());
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("\"code\":\"runtime_invalid_response\""));
}

#[test]
fn resume_invokes_task_list_then_headless_continue_once_and_prints_bounded_human_output() {
    let runtime = fake_runtime_sequence(
        "resume-continue",
        &[
            r#"{"jsonrpc":"2.0","id":1,"result":{"tasks":[{"task_id":"task-1","run_id":"run-1","status":"Created"}],"progress_overview":{"source_fingerprint":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","aggregate_sequence":7,"task_count":1,"root_task_ids":["task-1"],"runnable_task_ids":["task-1"],"blocked_task_ids":[],"terminal_task_ids":[],"parent_join_ready_task_ids":[],"status_counts":{"created":1,"queued":0,"running":0,"completed":0,"failed":0,"cancelled":0},"stage_counts":[],"next_action_sets":[],"blocked_sets":[],"headless_route_candidates":[],"nodes":[],"edges":[]}}}"#,
            r#"{"jsonrpc":"2.0","id":1,"result":{"status":"task_executed","decision_id":"decision-1","continuation_id":"cli.resume.replayed","selected_task_id":"task-1","selected_run_id":"run-1","candidate_count":1,"expected_progress_fingerprint":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","expected_aggregate_sequence":7,"current_progress_fingerprint":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","current_aggregate_sequence":7,"post_progress_fingerprint":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","post_aggregate_sequence":8,"stale":false,"replayed":false,"task_run_result":null,"proposal_apply_result":null,"next_route":null,"selected_headless_journey_context":{"kind":"headless_journey_context","selection_source":"continuation_scope","journey_id":"cli.run.context.journey","session_id":"cli.run.context","drive_id":"cli.run.context.drive","task_id":"task-1","run_id":"run-1","selected_task_id":"task-1","selected_run_id":"run-1","task_start_fingerprint":"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","start_progress_fingerprint":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","start_aggregate_sequence":7,"journey_fingerprint":"sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","has_session_checkpoint":true,"current_session_sequence":1,"next_action":"drive_headless_journey"},"next_action":"inspect_progress_overview"}}"#,
        ],
    );
    let capture = runtime.with_file_name("requests.ndjson");

    let output = Command::new(brownie())
        .arg("resume")
        .env("BROWNIE_RUNTIME_PATH", &runtime)
        .env(
            "BROWNIE_RUNTIME_TIMEOUT_MS",
            READ_ONLY_FAKE_RUNTIME_TIMEOUT_MS,
        )
        .env("BROWNIE_FAKE_RUNTIME_CAPTURE", &capture)
        .output()
        .unwrap();

    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("resume"));
    assert!(stdout.contains("status: task_executed"));
    assert!(stdout.contains("continuation: cli.resume.replayed"));
    assert!(stdout.contains("session: cli.run.context"));
    assert!(stdout.contains("journey: cli.run.context.journey"));
    assert!(stdout.contains("task: task-1"));
    assert!(stdout.contains("runtime_run: run-1"));
    assert!(stdout.contains("candidates: 1"));
    assert!(stdout.contains("stale: false"));
    assert!(stdout.contains("replayed: false"));
    assert!(stdout.contains("next: inspect_progress_overview"));
    assert!(!stdout.contains("BROWNIE_RUNTIME_PATH"));

    let requests = fs::read_to_string(capture).unwrap();
    let requests: Vec<serde_json::Value> = requests
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(requests.len(), 2);
    assert_eq!(requests[0]["method"], "task.list");
    assert_eq!(
        requests[0]["params"],
        serde_json::json!({
            "bounds": {
                "max_tasks": 8,
                "max_task_goal_chars": 0,
                "max_task_ids": 0,
                "max_groups": 0,
                "max_group_task_ids": 0,
                "max_headless_route_candidates": 8,
                "max_nodes": 0,
                "max_edges": 0
            }
        })
    );
    assert_eq!(requests[1]["method"], "headless.continue_once");
    assert_eq!(requests[1]["params"]["authorize"], true);
    assert_eq!(
        requests[1]["params"]["expected_progress_fingerprint"],
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    );
    assert_eq!(requests[1]["params"]["expected_aggregate_sequence"], 7);
    assert_eq!(requests[1]["params"]["max_steps"], 1);
    assert!(requests[1]["params"]["continuation_id"]
        .as_str()
        .unwrap()
        .starts_with("cli.resume."));
    assert_eq!(
        requests[1]["params"]["continuation_scope"],
        serde_json::json!({
            "session_id_prefix": "cli.run.",
            "latest_matching_session": true
        })
    );
    assert!(requests[1]["params"].get("context_budget").is_none());
}

#[test]
fn recovery_scoped_resume_does_not_resume_unrelated_latest_journey() {
    let runtime = fake_runtime_sequence(
        "resume-recovery-scope",
        &[
            r#"{"jsonrpc":"2.0","id":1,"result":{"tasks":[{"task_id":"task-recover","run_id":"run-recover","status":"Created"},{"task_id":"task-newer","run_id":"run-newer","status":"Created"}],"progress_overview":{"source_fingerprint":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","aggregate_sequence":7,"task_count":2,"root_task_ids":["task-recover","task-newer"],"runnable_task_ids":["task-recover","task-newer"],"blocked_task_ids":[],"terminal_task_ids":[],"parent_join_ready_task_ids":[],"status_counts":{"created":2,"queued":0,"running":0,"completed":0,"failed":0,"cancelled":0},"stage_counts":[],"next_action_sets":[],"blocked_sets":[],"headless_route_candidates":[],"selected_headless_route":{"session_id":"cli.run.newer","journey_id":"cli.run.newer.journey","task_id":"task-newer","run_id":"run-newer","journey_fingerprint":"sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","next_session_sequence":2,"progress_fingerprint":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","aggregate_sequence":7},"nodes":[],"edges":[]}}}"#,
            r#"{"jsonrpc":"2.0","id":1,"result":{"status":"task_executed","decision_id":"decision-recover","continuation_id":"cli.resume.recover","selected_task_id":"task-recover","selected_run_id":"run-recover","candidate_count":1,"expected_progress_fingerprint":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","expected_aggregate_sequence":7,"current_progress_fingerprint":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","current_aggregate_sequence":7,"post_progress_fingerprint":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","post_aggregate_sequence":8,"stale":false,"replayed":false,"task_run_result":null,"proposal_apply_result":null,"next_route":null,"selected_headless_journey_context":{"kind":"headless_journey_context","selection_source":"continuation_scope","journey_id":"cli.run.recover.journey","session_id":"cli.run.recover","drive_id":"cli.run.recover.drive","task_id":"task-recover","run_id":"run-recover","selected_task_id":"task-recover","selected_run_id":"run-recover","task_start_fingerprint":"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","start_progress_fingerprint":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","start_aggregate_sequence":7,"journey_fingerprint":"sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","has_session_checkpoint":true,"current_session_sequence":1,"next_action":"drive_headless_journey"},"next_action":"inspect_progress_overview"}}"#,
        ],
    );
    let capture = runtime.with_file_name("requests.ndjson");

    let output = Command::new(brownie())
        .args([
            "--json",
            "resume",
            "--session-id",
            "cli.run.recover",
            "--journey-id",
            "cli.run.recover.journey",
            "--task-id",
            "task-recover",
            "--run-id",
            "run-recover",
        ])
        .env("BROWNIE_RUNTIME_PATH", &runtime)
        .env(
            "BROWNIE_RUNTIME_TIMEOUT_MS",
            READ_ONLY_FAKE_RUNTIME_TIMEOUT_MS,
        )
        .env("BROWNIE_FAKE_RUNTIME_CAPTURE", &capture)
        .output()
        .unwrap();

    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    let payload: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    assert_eq!(payload["resume"]["selected_task_id"], "task-recover");
    assert_eq!(payload["resume"]["selected_run_id"], "run-recover");
    assert_eq!(payload["resume"]["headless_session_id"], "cli.run.recover");
    assert_eq!(
        payload["resume"]["headless_journey_id"],
        "cli.run.recover.journey"
    );

    let requests = fs::read_to_string(capture).unwrap();
    let requests: Vec<serde_json::Value> = requests
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(requests.len(), 2);
    assert_eq!(requests[0]["method"], "task.list");
    assert_eq!(requests[1]["method"], "headless.continue_once");
    assert_eq!(
        requests[1]["params"]["continuation_scope"],
        serde_json::json!({
            "session_id": "cli.run.recover",
            "journey_id": "cli.run.recover.journey",
            "task_id": "task-recover",
            "run_id": "run-recover"
        })
    );
    assert_eq!(requests[1]["params"]["max_steps"], 1);
    assert_eq!(
        requests[1]["params"]["expected_progress_fingerprint"],
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    );
    assert_eq!(requests[1]["params"]["expected_aggregate_sequence"], 7);
}

#[test]
fn resume_uses_runtime_owned_route_candidate_for_scoped_run_advance() {
    let runtime = fake_runtime_sequence(
        "resume-run-advance",
        &[
            r#"{"jsonrpc":"2.0","id":1,"result":{"tasks":[{"task_id":"task-old","run_id":"run-old","status":"Created","created_at":"2026-08-27T10:00:00Z","updated_at":"2026-08-27T10:00:00Z"},{"task_id":"task-new","run_id":"run-new","status":"Created","created_at":"2026-08-27T10:01:00Z","updated_at":"2026-08-27T10:01:00Z"},{"task_id":"task-unrelated","run_id":"run-unrelated","status":"Created","created_at":"2026-08-27T10:02:00Z","updated_at":"2026-08-27T10:02:00Z"}],"progress_overview":{"source_fingerprint":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","aggregate_sequence":7,"task_count":3,"root_task_ids":["task-old","task-new","task-unrelated"],"runnable_task_ids":["task-old","task-new","task-unrelated"],"blocked_task_ids":[],"terminal_task_ids":[],"parent_join_ready_task_ids":[],"status_counts":{"created":3,"queued":0,"running":0,"completed":0,"failed":0,"cancelled":0},"stage_counts":[],"next_action_sets":[],"blocked_sets":[],"selected_headless_route":{"kind":"headless_continue_once","reason":"runtime selected cli route","task_id":"task-new","run_id":"run-new","journey_id":"cli.run.new.journey","session_id":"cli.run.new","journey_fingerprint":"sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","next_session_sequence":2,"progress_fingerprint":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","aggregate_sequence":7,"route_fingerprint":"sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","priority":80,"next_action":"headless_continue_once"},"headless_route_candidates":[{"kind":"headless_continue_once","reason":"older cli route","task_id":"task-old","run_id":"run-old","journey_id":"cli.run.old.journey","session_id":"cli.run.old","journey_fingerprint":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","next_session_sequence":1,"progress_fingerprint":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","aggregate_sequence":7,"route_fingerprint":"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","priority":80,"next_action":"headless_continue_once"},{"kind":"headless_continue_once","reason":"newer cli route","task_id":"task-new","run_id":"run-new","journey_id":"cli.run.new.journey","session_id":"cli.run.new","journey_fingerprint":"sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","next_session_sequence":2,"progress_fingerprint":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","aggregate_sequence":7,"route_fingerprint":"sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","priority":80,"next_action":"headless_continue_once"},{"kind":"headless_continue_once","reason":"non-cli route","task_id":"task-unrelated","run_id":"run-unrelated","journey_id":"other.session.journey","session_id":"other.session","journey_fingerprint":"sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","next_session_sequence":1,"progress_fingerprint":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","aggregate_sequence":7,"route_fingerprint":"sha256:111111111111111111111111111111111111111111111111111111111111","priority":80,"next_action":"headless_continue_once"}],"nodes":[],"edges":[]}}}"#,
            r#"{"jsonrpc":"2.0","id":1,"result":{"status":"task_executed","session_id":"cli.run.new","advance_id":"cli.resume.advance","session_sequence":2,"replayed":false,"start_progress":{"progress_fingerprint":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","aggregate_sequence":7},"post_progress":{"progress_fingerprint":"sha256:9999999999999999999999999999999999999999999999999999999999999999","aggregate_sequence":8},"max_steps":1,"step_count":1,"executed_count":1,"replayed_count":0,"stop_reason":"step executed","checkpoint_fingerprint":"sha256:8888888888888888888888888888888888888888888888888888888888888888","terminal_completion_evidence":null,"next_route":null,"steps":[{"step_index":1,"status":"task_executed","decision_id":"decision-new","continuation_id":"run.cli.run.new.2","selected_task_id":"task-new","selected_run_id":"run-new","candidate_count":1,"current_progress_fingerprint":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","current_aggregate_sequence":7,"post_progress_fingerprint":"sha256:9999999999999999999999999999999999999999999999999999999999999999","post_aggregate_sequence":8,"replayed":false,"next_route":null,"next_action":"inspect_progress_overview"}],"next_action":"inspect_progress_overview"}}"#,
            r#"{"jsonrpc":"2.0","id":1,"result":{"status":"no_eligible_task","session_id":"cli.run.new","drive_id":"cli.run.new.resume.drive","start_session_sequence":2,"end_session_sequence":3,"max_advances":3,"max_steps_per_advance":1,"advance_count":0,"executed_count":0,"replayed_count":0,"replayed":false,"stop_reason":"completion finalized","next_route":null,"completion_closure":{"status":"complete","closure_fingerprint":"sha256:2222222222222222222222222222222222222222222222222222222222222222","progress_fingerprint":"sha256:3333333333333333333333333333333333333333333333333333333333333333","terminal_completion_fingerprint":"sha256:4444444444444444444444444444444444444444444444444444444444444444","next_action":"accept_completion"},"accepted_completion":{"acceptance_id":"accept-new","task_id":"task-new","run_id":"run-new","status":"AcceptedComplete","terminal_completion_fingerprint":"sha256:4444444444444444444444444444444444444444444444444444444444444444","acceptance_fingerprint":"sha256:5555555555555555555555555555555555555555555555555555555555555555","verifier_gate_status":"passed","next_action":"finalize_completion"},"completion_finalization":{"finalization_fingerprint":"sha256:6666666666666666666666666666666666666666666666666666666666666666","closure_fingerprint":"sha256:2222222222222222222222222222222222222222222222222222222222222222","progress_fingerprint":"sha256:3333333333333333333333333333333333333333333333333333333333333333","status":"finalized","next_action":"inspect_progress_overview"},"next_action":"inspect_progress_overview"}}"#,
        ],
    );
    let capture = runtime.with_file_name("requests.ndjson");

    let output = Command::new(brownie())
        .args(["--json", "resume"])
        .env("BROWNIE_RUNTIME_PATH", &runtime)
        .env(
            "BROWNIE_RUNTIME_TIMEOUT_MS",
            READ_ONLY_FAKE_RUNTIME_TIMEOUT_MS,
        )
        .env("BROWNIE_FAKE_RUNTIME_CAPTURE", &capture)
        .output()
        .unwrap();

    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    let payload: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    assert_eq!(payload["resume"]["status"], "no_eligible_task");
    assert_eq!(payload["resume"]["selected_task_id"], "task-new");
    assert_eq!(payload["resume"]["headless_session_id"], "cli.run.new");
    assert_eq!(payload["resume"]["candidate_count"], 1);
    assert_eq!(payload["resume"]["completion_closure_status"], "complete");
    assert_eq!(
        payload["resume"]["accepted_completion_status"],
        "AcceptedComplete"
    );
    assert_eq!(
        payload["resume"]["completion_finalization_status"],
        "finalized"
    );
    assert_eq!(payload["resume"]["task_id"], "task-new");
    assert_eq!(payload["resume"]["run_id"], "run-new");
    assert_eq!(payload["resume"]["journey_id"], "cli.run.new.journey");
    assert_eq!(payload["resume"]["continuation_required"], false);
    assert_eq!(payload["resume"]["completed"], true);
    assert_eq!(payload["resume"]["blocked"], false);
    assert_eq!(payload["resume"]["retryable"], false);
    assert_eq!(payload["resume"]["terminal_failure"], false);
    assert_eq!(payload["resume"]["controller_action"], "stop");
    assert_eq!(payload["resume"]["stop_class"], "completed");
    assert_eq!(payload["automation"]["schema_version"], 1);
    assert_eq!(payload["automation"]["status"], "completed");
    assert_eq!(payload["automation"]["controller_action"], "stop");
    assert_eq!(payload["resume"]["automation"]["controller_action"], "stop");
    assert!(payload["resume"].get("execution_outcome").is_none());

    let requests = fs::read_to_string(capture).unwrap();
    let requests: Vec<serde_json::Value> = requests
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(requests.len(), 3);
    assert_eq!(requests[0]["method"], "task.list");
    assert_eq!(requests[1]["method"], "headless.run.advance");
    assert_eq!(requests[2]["method"], "headless.run.drive");
    assert_eq!(requests[1]["params"]["session_id"], "cli.run.new");
    assert_eq!(requests[1]["params"]["expected_session_sequence"], 2);
    assert_eq!(
        requests[1]["params"]["expected_progress_fingerprint"],
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    );
    assert_eq!(requests[1]["params"]["expected_aggregate_sequence"], 7);
    assert_eq!(
        requests[1]["params"]["continuation_scope"],
        serde_json::json!({
            "session_id": "cli.run.new",
            "journey_id": "cli.run.new.journey",
            "task_id": "task-new",
            "run_id": "run-new"
        })
    );
    assert_eq!(requests[1]["params"]["max_steps"], 1);
    assert_eq!(requests[2]["params"]["session_id"], "cli.run.new");
    assert_eq!(
        requests[2]["params"]["drive_id"],
        "cli.run.new.resume.drive"
    );
    assert_eq!(requests[2]["params"]["expected_start_session_sequence"], 2);
    assert_eq!(requests[2]["params"]["max_advances"], 3);
}

#[test]
fn json_resume_outputs_bounded_cli_projection() {
    let runtime = fake_runtime_sequence(
        "resume-json",
        &[
            r#"{"jsonrpc":"2.0","id":1,"result":{"tasks":[],"progress_overview":{"source_fingerprint":"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","aggregate_sequence":3,"task_count":0,"root_task_ids":[],"runnable_task_ids":[],"blocked_task_ids":[],"terminal_task_ids":[],"parent_join_ready_task_ids":[],"status_counts":{"created":0,"queued":0,"running":0,"completed":0,"failed":0,"cancelled":0},"stage_counts":[],"next_action_sets":[],"blocked_sets":[],"headless_route_candidates":[],"nodes":[],"edges":[]}}}"#,
            r#"{"jsonrpc":"2.0","id":1,"result":{"status":"no_eligible_task","decision_id":null,"continuation_id":"cli.resume.none","selected_task_id":null,"selected_run_id":null,"candidate_count":0,"expected_progress_fingerprint":"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","expected_aggregate_sequence":3,"current_progress_fingerprint":"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","current_aggregate_sequence":3,"post_progress_fingerprint":null,"post_aggregate_sequence":null,"stale":false,"replayed":false,"task_run_result":null,"proposal_apply_result":null,"next_route":{"kind":"inspect_progress_overview","reason":"no tasks","next_action":"inspect_progress_overview"},"next_action":"inspect_progress_overview"}}"#,
        ],
    );

    let output = Command::new(brownie())
        .args(["--json", "resume"])
        .env("BROWNIE_RUNTIME_PATH", &runtime)
        .env(
            "BROWNIE_RUNTIME_TIMEOUT_MS",
            READ_ONLY_FAKE_RUNTIME_TIMEOUT_MS,
        )
        .env("BROWNIE_RUNTIME_PATH_SHOULD_NOT_LEAK", "secret-path")
        .output()
        .unwrap();

    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    let payload: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    assert_eq!(payload["ok"], true);
    assert_eq!(payload["command"], "resume");
    assert_eq!(payload["exit_code"], 0);
    assert_eq!(payload["resume"]["status"], "no_eligible_task");
    assert_eq!(payload["resume"]["continuation_id"], "cli.resume.none");
    assert_eq!(
        payload["resume"]["selected_task_id"],
        serde_json::Value::Null
    );
    assert_eq!(payload["resume"]["candidate_count"], 0);
    assert_eq!(payload["resume"]["current_aggregate_sequence"], 3);
    assert_eq!(
        payload["resume"]["post_aggregate_sequence"],
        serde_json::Value::Null
    );
    assert_eq!(payload["resume"]["stale"], false);
    assert_eq!(payload["resume"]["replayed"], false);
    assert_eq!(
        payload["resume"]["next_action"],
        "inspect_progress_overview"
    );
    assert_eq!(payload["resume"]["task_id"], serde_json::Value::Null);
    assert_eq!(payload["resume"]["run_id"], serde_json::Value::Null);
    assert_eq!(payload["resume"]["journey_id"], serde_json::Value::Null);
    assert_eq!(payload["resume"]["stop_reason"], "no_actionable_work");
    assert_eq!(payload["resume"]["continuation_required"], false);
    assert_eq!(payload["resume"]["completed"], false);
    assert_eq!(payload["resume"]["blocked"], false);
    assert_eq!(payload["resume"]["retryable"], false);
    assert_eq!(payload["resume"]["terminal_failure"], false);
    assert_eq!(payload["resume"]["controller_action"], "stop");
    assert_eq!(payload["resume"]["stop_class"], "no_actionable_work");
    assert_eq!(
        payload["resume"]["automation"]["stop_reason"],
        "no_actionable_work"
    );
    assert_eq!(
        payload["automation"]["outcome_source"],
        "legacy_cli_projection"
    );
    assert!(payload["resume"].get("next_route").is_none());
    assert!(payload["resume"].get("task_run_result").is_none());
    assert!(!stdout.contains("secret-path"));
    assert!(!stdout.contains("BROWNIE_RUNTIME_PATH"));
}

#[test]
fn json_resume_projects_runtime_owned_scoped_journey_context() {
    let runtime = fake_runtime_sequence(
        "resume-json-scoped-context",
        &[
            r#"{"jsonrpc":"2.0","id":1,"result":{"tasks":[{"task_id":"task-1","run_id":"run-1","status":"Created"}],"progress_overview":{"source_fingerprint":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","aggregate_sequence":7,"task_count":1,"root_task_ids":["task-1"],"runnable_task_ids":["task-1"],"blocked_task_ids":[],"terminal_task_ids":[],"parent_join_ready_task_ids":[],"status_counts":{"created":1,"queued":0,"running":0,"completed":0,"failed":0,"cancelled":0},"stage_counts":[],"next_action_sets":[],"blocked_sets":[],"headless_route_candidates":[],"nodes":[],"edges":[]}}}"#,
            r#"{"jsonrpc":"2.0","id":1,"result":{"status":"task_executed","decision_id":"decision-1","continuation_id":"cli.resume.context","selected_task_id":"task-1","selected_run_id":"run-1","candidate_count":1,"expected_progress_fingerprint":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","expected_aggregate_sequence":7,"current_progress_fingerprint":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","current_aggregate_sequence":7,"post_progress_fingerprint":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","post_aggregate_sequence":8,"stale":false,"replayed":false,"task_run_result":null,"proposal_apply_result":null,"next_route":null,"selected_headless_journey_context":{"kind":"headless_journey_context","selection_source":"continuation_scope","journey_id":"cli.run.context.journey","session_id":"cli.run.context","drive_id":"cli.run.context.drive","task_id":"task-1","run_id":"run-1","selected_task_id":"task-1","selected_run_id":"run-1","task_start_fingerprint":"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","start_progress_fingerprint":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","start_aggregate_sequence":7,"journey_fingerprint":"sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","has_session_checkpoint":true,"current_session_sequence":1,"next_action":"drive_headless_journey"},"next_action":"inspect_progress_overview"}}"#,
        ],
    );

    let output = Command::new(brownie())
        .args(["--json", "resume"])
        .env("BROWNIE_RUNTIME_PATH", &runtime)
        .env(
            "BROWNIE_RUNTIME_TIMEOUT_MS",
            READ_ONLY_FAKE_RUNTIME_TIMEOUT_MS,
        )
        .env("BROWNIE_RUNTIME_PATH_SHOULD_NOT_LEAK", "secret-path")
        .output()
        .unwrap();

    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    let payload: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    assert_eq!(payload["resume"]["headless_session_id"], "cli.run.context");
    assert_eq!(
        payload["resume"]["headless_journey_id"],
        "cli.run.context.journey"
    );
    assert_eq!(payload["resume"]["headless_root_task_id"], "task-1");
    assert_eq!(payload["resume"]["headless_root_run_id"], "run-1");
    assert_eq!(payload["resume"]["headless_selected_task_id"], "task-1");
    assert_eq!(payload["resume"]["headless_selected_run_id"], "run-1");
    assert_eq!(payload["resume"]["headless_current_session_sequence"], 1);
    assert!(payload["resume"]
        .get("selected_headless_journey_context")
        .is_none());
    assert!(!stdout.contains("secret-path"));
    assert!(!stdout.contains("BROWNIE_RUNTIME_PATH"));
}

#[test]
fn resume_surfaces_stale_progress_as_runtime_owned_decision() {
    let runtime = fake_runtime_sequence(
        "resume-stale",
        &[
            r#"{"jsonrpc":"2.0","id":1,"result":{"tasks":[{"task_id":"task-1","run_id":"run-1","status":"Created"}],"progress_overview":{"source_fingerprint":"sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","aggregate_sequence":9,"task_count":1,"root_task_ids":["task-1"],"runnable_task_ids":["task-1"],"blocked_task_ids":[],"terminal_task_ids":[],"parent_join_ready_task_ids":[],"status_counts":{"created":1,"queued":0,"running":0,"completed":0,"failed":0,"cancelled":0},"stage_counts":[],"next_action_sets":[],"blocked_sets":[],"headless_route_candidates":[],"nodes":[],"edges":[]}}}"#,
            r#"{"jsonrpc":"2.0","id":1,"result":{"status":"stale_progress","decision_id":null,"continuation_id":"cli.resume.stale","selected_task_id":null,"selected_run_id":null,"candidate_count":1,"expected_progress_fingerprint":"sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","expected_aggregate_sequence":9,"current_progress_fingerprint":"sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","current_aggregate_sequence":10,"post_progress_fingerprint":null,"post_aggregate_sequence":null,"stale":true,"replayed":false,"task_run_result":null,"proposal_apply_result":null,"next_route":{"kind":"inspect_progress_overview","reason":"refresh","next_action":"refresh_progress_overview"},"next_action":"refresh_progress_overview"}}"#,
        ],
    );

    let output = Command::new(brownie())
        .arg("resume")
        .env("BROWNIE_RUNTIME_PATH", &runtime)
        .env(
            "BROWNIE_RUNTIME_TIMEOUT_MS",
            READ_ONLY_FAKE_RUNTIME_TIMEOUT_MS,
        )
        .output()
        .unwrap();

    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("status: stale_progress"));
    assert!(stdout.contains("stale: true"));
    assert!(stdout.contains("next: refresh_progress_overview"));
}

#[test]
fn json_resume_projects_stale_progress_as_retryable_runtime_owned_resume() {
    let runtime = fake_runtime_sequence(
        "resume-json-stale",
        &[
            r#"{"jsonrpc":"2.0","id":1,"result":{"tasks":[{"task_id":"task-1","run_id":"run-1","status":"Created"}],"progress_overview":{"source_fingerprint":"sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","aggregate_sequence":9,"task_count":1,"root_task_ids":["task-1"],"runnable_task_ids":["task-1"],"blocked_task_ids":[],"terminal_task_ids":[],"parent_join_ready_task_ids":[],"status_counts":{"created":1,"queued":0,"running":0,"completed":0,"failed":0,"cancelled":0},"stage_counts":[],"next_action_sets":[],"blocked_sets":[],"headless_route_candidates":[],"nodes":[],"edges":[]}}}"#,
            r#"{"jsonrpc":"2.0","id":1,"result":{"status":"stale_progress","decision_id":null,"continuation_id":"cli.resume.stale","selected_task_id":null,"selected_run_id":null,"candidate_count":1,"expected_progress_fingerprint":"sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","expected_aggregate_sequence":9,"current_progress_fingerprint":"sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","current_aggregate_sequence":10,"post_progress_fingerprint":null,"post_aggregate_sequence":null,"stale":true,"replayed":false,"task_run_result":null,"proposal_apply_result":null,"next_route":{"kind":"inspect_progress_overview","reason":"refresh","next_action":"refresh_progress_overview"},"next_action":"refresh_progress_overview","execution_outcome":{"schema_version":1,"outcome_scope":"objective","class":"stale_retry","status":"stale_retry","controller_action":"resume","continuation_required":true,"completed":false,"blocked":false,"retryable":true,"terminal_failure":false,"stop_reason":"stale_progress","next_invocation":{"command":"resume","arguments":[]}}}}"#,
        ],
    );

    let output = Command::new(brownie())
        .args(["--json", "resume"])
        .env("BROWNIE_RUNTIME_PATH", &runtime)
        .env(
            "BROWNIE_RUNTIME_TIMEOUT_MS",
            READ_ONLY_FAKE_RUNTIME_TIMEOUT_MS,
        )
        .output()
        .unwrap();

    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    let payload: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    assert_eq!(payload["ok"], true);
    assert_eq!(payload["automation"]["schema_version"], 1);
    assert_eq!(payload["automation"]["outcome_source"], "runtime");
    assert_eq!(payload["automation"]["status"], "stale_retry");
    assert_eq!(payload["automation"]["class"], "stale_retry");
    assert_eq!(payload["automation"]["controller_action"], "resume");
    assert_eq!(payload["automation"]["continuation_required"], true);
    assert_eq!(payload["automation"]["blocked"], false);
    assert_eq!(payload["automation"]["retryable"], true);
    assert_eq!(payload["automation"]["terminal_failure"], false);
    assert_eq!(
        payload["automation"]["next_invocation"]["command"],
        "resume"
    );
    assert_eq!(payload["resume"]["stale"], true);
    assert_eq!(payload["resume"]["automation"]["status"], "stale_retry");
    assert_eq!(
        payload["resume"]["automation"]["controller_action"],
        "resume"
    );
    assert!(payload["resume"].get("execution_outcome").is_none());
}

#[test]
fn resume_runtime_error_does_not_expose_runtime_payload() {
    let runtime = fake_runtime_sequence(
        "resume-jsonrpc-error",
        &[
            r#"{"jsonrpc":"2.0","id":1,"result":{"tasks":[],"progress_overview":{"source_fingerprint":"sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","aggregate_sequence":1,"task_count":0,"root_task_ids":[],"runnable_task_ids":[],"blocked_task_ids":[],"terminal_task_ids":[],"parent_join_ready_task_ids":[],"status_counts":{"created":0,"queued":0,"running":0,"completed":0,"failed":0,"cancelled":0},"stage_counts":[],"next_action_sets":[],"blocked_sets":[],"headless_route_candidates":[],"nodes":[],"edges":[]}}}"#,
            r#"{"jsonrpc":"2.0","id":1,"error":{"code":-32602,"message":"bad continuation with api_key=secret-internal-detail"}}"#,
        ],
    );

    let output = Command::new(brownie())
        .args(["--json", "resume"])
        .env("BROWNIE_RUNTIME_PATH", &runtime)
        .env(
            "BROWNIE_RUNTIME_TIMEOUT_MS",
            READ_ONLY_FAKE_RUNTIME_TIMEOUT_MS,
        )
        .output()
        .unwrap();

    assert!(!output.status.success());
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("\"code\":\"runtime_error\""));
    assert!(!stdout.contains("secret-internal-detail"));
}

#[test]
fn resume_rejects_invalid_runtime_shape() {
    let runtime = fake_runtime_sequence(
        "resume-invalid-shape",
        &[
            r#"{"jsonrpc":"2.0","id":1,"result":{"tasks":[],"progress_overview":{"source_fingerprint":"sha256:abababababababababababababababababababababababababababababababab","aggregate_sequence":1,"task_count":0,"root_task_ids":[],"runnable_task_ids":[],"blocked_task_ids":[],"terminal_task_ids":[],"parent_join_ready_task_ids":[],"status_counts":{"created":0,"queued":0,"running":0,"completed":0,"failed":0,"cancelled":0},"stage_counts":[],"next_action_sets":[],"blocked_sets":[],"headless_route_candidates":[],"nodes":[],"edges":[]}}}"#,
            r#"{"jsonrpc":"2.0","id":1,"result":{"status":"task_executed","next_action":"inspect_progress_overview"}}"#,
        ],
    );

    let output = Command::new(brownie())
        .arg("resume")
        .env("BROWNIE_RUNTIME_PATH", &runtime)
        .env(
            "BROWNIE_RUNTIME_TIMEOUT_MS",
            READ_ONLY_FAKE_RUNTIME_TIMEOUT_MS,
        )
        .output()
        .unwrap();

    assert!(!output.status.success());
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(stderr.contains("runtime returned an invalid response"));
}

#[test]
fn resume_uses_objective_transport_timeout_class_for_continue_call() {
    let runtime = fake_runtime_resume_hanging_continue("resume-objective-timeout");

    let output = Command::new(brownie())
        .args(["--json", "resume"])
        .env("BROWNIE_RUNTIME_PATH", &runtime)
        .env(
            "BROWNIE_RUNTIME_TIMEOUT_MS",
            READ_ONLY_FAKE_RUNTIME_TIMEOUT_MS,
        )
        .env("BROWNIE_RUNTIME_OBJECTIVE_TIMEOUT_MS", "50")
        .output()
        .unwrap();

    assert!(!output.status.success());
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("\"code\":\"runtime_timeout\""));
}

#[test]
fn json_status_can_invoke_real_runtime_binary_when_available() {
    let runtime = build_real_runtime_binary();

    let output = Command::new(brownie())
        .args(["--json", "status"])
        .env("BROWNIE_RUNTIME_PATH", runtime)
        .env(
            "BROWNIE_RUNTIME_TIMEOUT_MS",
            READ_ONLY_FAKE_RUNTIME_TIMEOUT_MS,
        )
        .output()
        .unwrap();

    assert!(output.status.success());
    let stdout = String::from_utf8(output.stdout).unwrap();
    let payload: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    assert_eq!(payload["ok"], true);
    assert_eq!(payload["command"], "status");
    assert_eq!(payload["status"]["name"], "brownie-runtime");
    assert_eq!(payload["status"]["status"], "Ready");
}

#[test]
fn json_list_tasks_can_invoke_real_runtime_binary_when_available() {
    let runtime = build_real_runtime_binary();

    let output = Command::new(brownie())
        .args(["--json", "list", "tasks"])
        .env("BROWNIE_RUNTIME_PATH", runtime)
        .env(
            "BROWNIE_RUNTIME_TIMEOUT_MS",
            READ_ONLY_FAKE_RUNTIME_TIMEOUT_MS,
        )
        .output()
        .unwrap();

    assert!(output.status.success());
    let stdout = String::from_utf8(output.stdout).unwrap();
    let payload: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    assert_eq!(payload["ok"], true);
    assert_eq!(payload["command"], "list tasks");
    assert!(payload["task_list"]["tasks"].is_array());
    assert!(payload["task_list"]["truncated"].is_object());
    assert!(payload["task_list"].get("progress_overview").is_none());
}

#[test]
fn json_mode_list_can_invoke_real_runtime_binary_when_available() {
    let runtime = build_real_runtime_binary();

    let output = Command::new(brownie())
        .args(["--json", "mode", "list"])
        .env("BROWNIE_RUNTIME_PATH", runtime)
        .env(
            "BROWNIE_RUNTIME_TIMEOUT_MS",
            READ_ONLY_FAKE_RUNTIME_TIMEOUT_MS,
        )
        .output()
        .unwrap();

    assert!(output.status.success());
    let stdout = String::from_utf8(output.stdout).unwrap();
    let payload: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    assert_eq!(payload["ok"], true);
    assert_eq!(payload["command"], "mode list");
    assert!(payload["mode_list"]["modes"].is_array());
}

#[test]
fn run_can_invoke_real_runtime_headless_drive_with_temp_workspace() {
    let runtime = build_real_runtime_binary();
    let workspace = std::env::temp_dir().join(format!(
        "brownie-cli-real-run-{}-{}",
        std::process::id(),
        RUNTIME_BUILD_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir_all(&workspace).unwrap();

    let output = Command::new(brownie())
        .args(["run", "Run CLI smoke objective"])
        .env("BROWNIE_RUNTIME_PATH", runtime)
        .env("BROWNIE_WORKSPACE_ROOT", &workspace)
        .env(
            "BROWNIE_RUNTIME_OBJECTIVE_TIMEOUT_MS",
            READ_ONLY_FAKE_RUNTIME_TIMEOUT_MS,
        )
        .output()
        .unwrap();

    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("run cli.run."));
    assert!(stdout.contains("status: no_eligible_task"));
    assert!(stdout.contains("task: task_"));
    assert!(stdout.contains("runtime_run: run_"));
    assert!(stdout.contains("closure: complete"));
    assert!(stdout.contains("accepted: AcceptedComplete"));
    assert!(stdout.contains("finalization: sha256:"));
    assert!(stdout.contains("next: inspect_progress_overview"));
    assert!(!stdout.contains(workspace.to_string_lossy().as_ref()));
    assert!(!stdout.contains("BROWNIE_WORKSPACE_ROOT"));
}

#[test]
fn installed_run_can_complete_from_arbitrary_repository_with_sibling_runtime() {
    let (installed, prefix) = install_real_cli_with_sibling_runtime("installed-run");
    let repository = ordinary_git_repository("installed-run-repo");

    let output = Command::new(&installed)
        .args([
            "run",
            "Complete a minimal CLI golden journey objective without changing files",
        ])
        .current_dir(&repository)
        .env_remove("BROWNIE_RUNTIME_PATH")
        .env_remove("BROWNIE_WORKSPACE_ROOT")
        .env(
            "BROWNIE_RUNTIME_OBJECTIVE_TIMEOUT_MS",
            READ_ONLY_FAKE_RUNTIME_TIMEOUT_MS,
        )
        .output()
        .unwrap();

    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("run cli.run."));
    assert!(stdout.contains("status: no_eligible_task"));
    assert!(stdout.contains("task: task_"));
    assert!(stdout.contains("runtime_run: run_"));
    assert!(stdout.contains("closure: complete"));
    assert!(stdout.contains("accepted: AcceptedComplete"));
    assert!(stdout.contains("finalization: sha256:"));
    assert!(!stdout.contains(repository.to_string_lossy().as_ref()));
    assert!(!stdout.contains(prefix.to_string_lossy().as_ref()));
    assert!(!stdout.contains("BROWNIE_RUNTIME_PATH"));
    assert!(!stdout.contains("BROWNIE_WORKSPACE_ROOT"));

    fs::remove_dir_all(repository).unwrap();
    fs::remove_dir_all(prefix).unwrap();
}

#[test]
fn installed_json_run_projects_completion_from_arbitrary_repository() {
    let (installed, prefix) = install_real_cli_with_sibling_runtime("installed-json-run");
    let repository = ordinary_git_repository("installed-json-run-repo");

    let output = Command::new(&installed)
        .args([
            "--json",
            "run",
            "Complete a minimal CLI JSON golden journey objective without changing files",
        ])
        .current_dir(&repository)
        .env_remove("BROWNIE_RUNTIME_PATH")
        .env_remove("BROWNIE_WORKSPACE_ROOT")
        .env(
            "BROWNIE_RUNTIME_OBJECTIVE_TIMEOUT_MS",
            READ_ONLY_FAKE_RUNTIME_TIMEOUT_MS,
        )
        .output()
        .unwrap();

    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    let payload: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    assert_eq!(payload["ok"], true);
    assert_eq!(payload["command"], "run");
    assert_eq!(payload["run"]["status"], "no_eligible_task");
    assert_eq!(payload["run"]["completion_closure_status"], "complete");
    assert_eq!(
        payload["run"]["accepted_completion_status"],
        "AcceptedComplete"
    );
    assert_eq!(
        payload["run"]["completion_finalization_status"],
        "finalized"
    );
    assert!(
        payload["run"]["completion_finalization_finalization_fingerprint"]
            .as_str()
            .unwrap()
            .starts_with("sha256:")
    );
    assert!(!stdout.contains(repository.to_string_lossy().as_ref()));
    assert!(!stdout.contains(prefix.to_string_lossy().as_ref()));
    assert!(!stdout.contains("BROWNIE_RUNTIME_PATH"));
    assert!(!stdout.contains("BROWNIE_WORKSPACE_ROOT"));

    fs::remove_dir_all(repository).unwrap();
    fs::remove_dir_all(prefix).unwrap();
}

#[test]
fn installed_run_executes_primary_development_path_from_arbitrary_repository() {
    let (installed, prefix) = install_real_cli_with_sibling_runtime("installed-development-run");
    let repository = ordinary_git_repository("installed-development-run-repo");

    let output = Command::new(&installed)
        .args(["--json", "run", "Implement README update"])
        .current_dir(&repository)
        .env_remove("BROWNIE_RUNTIME_PATH")
        .env_remove("BROWNIE_WORKSPACE_ROOT")
        .env("BROWNIE_RUNTIME_OBJECTIVE_TIMEOUT_MS", "30000")
        .output()
        .unwrap();

    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    let payload: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    assert_eq!(payload["ok"], true);
    assert_eq!(payload["command"], "run");
    assert_eq!(payload["run"]["status"], "no_eligible_task");
    assert_eq!(payload["run"]["completion_closure_status"], "complete");
    assert_eq!(
        payload["run"]["objective_proposal_preflight_status"],
        "authorized_preflight_ready"
    );
    assert_eq!(
        payload["run"]["objective_proposal_preflight_operation"],
        "replace_file"
    );
    assert_eq!(payload["run"]["objective_apply_apply_status"], "Applied");
    assert_eq!(payload["run"]["objective_apply_applied"], true);
    assert_eq!(
        payload["run"]["objective_apply_authorization_consumed"],
        true
    );
    assert_eq!(
        payload["run"]["objective_apply_verification_verification_status"],
        "verified"
    );
    assert_eq!(
        payload["run"]["objective_completion_acceptance_acceptance_status"],
        "accepted"
    );
    assert_eq!(
        payload["run"]["completion_finalization_status"],
        "finalized"
    );
    assert!(
        payload["run"]["completion_finalization_finalization_fingerprint"]
            .as_str()
            .unwrap()
            .starts_with("sha256:")
    );
    assert_eq!(
        fs::read_to_string(repository.join("README.md")).unwrap(),
        "new README content"
    );
    assert!(!stdout.contains(repository.to_string_lossy().as_ref()));
    assert!(!stdout.contains(prefix.to_string_lossy().as_ref()));
    assert!(!stdout.contains("BROWNIE_RUNTIME_PATH"));
    assert!(!stdout.contains("BROWNIE_WORKSPACE_ROOT"));

    fs::remove_dir_all(repository).unwrap();
    fs::remove_dir_all(prefix).unwrap();
}

#[test]
fn installed_json_run_uses_real_agentmodes_active_snapshot_from_arbitrary_repository() {
    let (installed, prefix) =
        install_real_cli_with_sibling_runtime("installed-agentmodes-entrypoint");
    let runtime = installed_runtime_from_prefix(&prefix);
    let repository = ordinary_git_repository("installed-agentmodes-entrypoint-repo");
    let Some(agentmodes) = write_current_agentmodes_modepack_if_available(&repository) else {
        fs::remove_dir_all(repository).unwrap();
        fs::remove_dir_all(prefix).unwrap();
        return;
    };

    let activated = invoke_runtime_json(
        &runtime,
        &repository,
        &serde_json::json!({"jsonrpc":"2.0","id":1,"method":"modepack.activate","params":{"authorize":true}}),
        &[],
    );
    assert_eq!(activated["result"]["activated"], true);
    assert_eq!(
        activated["result"]["snapshot"]["modepack_name"],
        "current-agentmodes"
    );
    assert_eq!(
        activated["result"]["snapshot"]["source_path"],
        ".brownie/modepack.json"
    );
    assert!(activated["result"]["snapshot"]["mode_ids"]
        .as_array()
        .unwrap()
        .iter()
        .any(|mode| mode == "core.orchestrator"));
    let activation_fingerprint = activated["result"]["snapshot"]["activation_fingerprint"]
        .as_str()
        .unwrap()
        .to_string();

    fs::remove_file(repository.join(".brownie/modepack.json")).unwrap();
    let objective = "Implement README update through real AgentModes CLI entrypoint";
    let output = Command::new(&installed)
        .args(["--json", "run", objective])
        .current_dir(&repository)
        .env_remove("BROWNIE_RUNTIME_PATH")
        .env_remove("BROWNIE_WORKSPACE_ROOT")
        .env("BROWNIE_RUNTIME_OBJECTIVE_TIMEOUT_MS", "30000")
        .output()
        .unwrap();

    assert!(
        output.status.success(),
        "installed run failed: {}",
        String::from_utf8_lossy(&output.stdout)
    );
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    let payload: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    assert_eq!(payload["ok"], true);
    assert_eq!(payload["command"], "run");
    assert_eq!(payload["run"]["status"], "no_eligible_task");
    assert_eq!(
        fs::read_to_string(repository.join("README.md")).unwrap(),
        "# Ordinary repository\n"
    );
    assert!(!stdout.contains(repository.to_string_lossy().as_ref()));
    assert!(!stdout.contains(prefix.to_string_lossy().as_ref()));
    assert!(!stdout.contains(agentmodes.source_root.to_string_lossy().as_ref()));
    assert!(!stdout.contains("BROWNIE_RUNTIME_PATH"));
    assert!(!stdout.contains("BROWNIE_WORKSPACE_ROOT"));

    let tasks = invoke_runtime_json(
        &runtime,
        &repository,
        &serde_json::json!({"jsonrpc":"2.0","id":2,"method":"task.list"}),
        &[],
    );
    let task = single_task_by_goal(&tasks, objective);
    assert_eq!(task["mode_id"], "core.orchestrator");
    let run_id = task["run_id"].as_str().expect("run id");
    let ledger = fs::read_to_string(
        repository
            .join(".brownie/runs")
            .join(run_id)
            .join("ledger.jsonl"),
    )
    .expect("ledger");
    assert!(ledger.contains("ModeResolved"));
    assert!(ledger.contains("external_modepack_task_provenance"));
    assert!(ledger.contains("current-agentmodes"));
    assert!(ledger.contains(&activation_fingerprint));
    assert!(ledger.contains("\"mode_id\":\"core.orchestrator\""));
    assert!(ledger.contains("ToolIntentDenied"));
    assert!(ledger.contains("\"tool_id\":\"workspace.write\""));
    assert!(!ledger.contains(agentmodes.source_root.to_string_lossy().as_ref()));
    assert!(!ledger.contains("raw_prompt"));
    assert!(!ledger.contains("provider_response"));
    assert!(!ledger.contains("BROWNIE_LLM"));
    assert!(!ledger.contains(repository.to_string_lossy().as_ref()));

    fs::remove_dir_all(repository).unwrap();
    fs::remove_dir_all(prefix).unwrap();
}

#[test]
fn installed_json_run_uses_signed_latest_agentmodes_core_without_member_pack_write_authority() {
    let (installed, prefix) =
        install_real_cli_with_sibling_runtime("installed-agentmodes-core-only");
    let runtime = installed_runtime_from_prefix(&prefix);
    let repository = ordinary_git_repository("installed-agentmodes-core-only-repo");
    let Some(agentmodes) = write_current_agentmodes_modepack_if_available(&repository) else {
        fs::remove_dir_all(repository).unwrap();
        fs::remove_dir_all(prefix).unwrap();
        return;
    };
    let active =
        activate_trusted_current_agentmodes_via_signed_candidate_for_cli(&runtime, &repository);

    fs::remove_file(repository.join(".brownie/modepack.json")).unwrap();
    let objective = "Implement README update through latest AgentModes Core";
    let output = Command::new(&installed)
        .args(["--json", "run", objective])
        .current_dir(&repository)
        .env_remove("BROWNIE_RUNTIME_PATH")
        .env_remove("BROWNIE_WORKSPACE_ROOT")
        .env("BROWNIE_RUNTIME_OBJECTIVE_TIMEOUT_MS", "30000")
        .output()
        .unwrap();

    assert!(
        output.status.success(),
        "installed run failed\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    let payload: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    assert_eq!(payload["ok"], true);
    assert_eq!(payload["command"], "run");
    assert_eq!(payload["run"]["status"], "no_eligible_task");
    assert_eq!(
        fs::read_to_string(repository.join("README.md")).unwrap(),
        "# Ordinary repository\n"
    );
    assert!(!stdout.contains(repository.to_string_lossy().as_ref()));
    assert!(!stdout.contains(prefix.to_string_lossy().as_ref()));
    assert!(!stdout.contains(agentmodes.source_root.to_string_lossy().as_ref()));
    assert!(!stdout.contains("BROWNIE_RUNTIME_PATH"));
    assert!(!stdout.contains("BROWNIE_WORKSPACE_ROOT"));

    let tasks = invoke_runtime_json(
        &runtime,
        &repository,
        &serde_json::json!({"jsonrpc":"2.0","id":2,"method":"task.list"}),
        &[],
    );
    let root_task = single_task_by_goal(&tasks, objective);
    assert_eq!(
        root_task["mode_id"].as_str(),
        Some(active.default_entrypoint.as_str())
    );
    let root_run_id = root_task["run_id"].as_str().expect("root run id");
    let children = tasks["result"]["tasks"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|task| task["parent_run_id"].as_str() == Some(root_run_id))
        .collect::<Vec<_>>();
    assert_eq!(
        children.len(),
        0,
        "latest AgentModes OSS Core must not materialize member-only write children"
    );

    let root_ledger = fs::read_to_string(
        repository
            .join(".brownie/runs")
            .join(root_run_id)
            .join("ledger.jsonl"),
    )
    .expect("root ledger");
    assert!(root_ledger.contains("ToolIntentDenied"));
    assert!(root_ledger.contains("\"tool_id\":\"workspace.write\""));
    assert!(root_ledger.contains("\"tool_id\":\"subtask.spawn\""));
    assert!(!root_ledger.contains("SubtaskOrchestrationQueued"));
    assert!(root_ledger.contains(&active.activation_fingerprint));
    assert!(root_ledger.contains("\"mode_id\":\"core.orchestrator\""));
    assert!(!root_ledger.contains(agentmodes.source_root.to_string_lossy().as_ref()));
    assert!(!root_ledger.contains("raw_prompt"));
    assert!(!root_ledger.contains("provider_response"));
    assert!(!root_ledger.contains("BROWNIE_LLM"));
    assert!(!root_ledger.contains(repository.to_string_lossy().as_ref()));

    fs::remove_dir_all(repository).unwrap();
    fs::remove_dir_all(prefix).unwrap();
}

#[test]
fn installed_resume_continues_persisted_cli_journey_after_lost_response() {
    let (installed, prefix) = install_real_cli_with_sibling_runtime("installed-resume-loss");
    let runtime = installed_runtime_from_prefix(&prefix);
    let repository = ordinary_git_repository("installed-resume-loss-repo");
    let initial_request = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "headless.run.drive",
        "params": {
            "authorize": true,
            "session_id": "cli.run.restart_loss",
            "drive_id": "cli.run.restart_loss.drive",
            "expected_start_session_sequence": 0,
            "max_advances": 1,
            "max_steps_per_advance": 1,
            "context_budget": {
                "max_prompt_chars": 4096,
                "max_ledger_events": 16,
                "max_selected_index_chars": 0
            },
            "journey_admission": {
                "journey_id": "cli.run.restart_loss.journey",
                "authorize_journey_start": true,
                "task_start": {
                    "goal": "Read README and create one follow-up subtask",
                    "mode_id": "orchestrator"
                }
            }
        }
    });
    let first = invoke_runtime_json(&runtime, &repository, &initial_request, &[]);
    assert_eq!(first["result"]["status"], "task_executed");
    assert_eq!(first["result"]["replayed"], false);
    let source_task_id = first["result"]["journey"]["task_id"]
        .as_str()
        .unwrap()
        .to_string();

    let replay = invoke_runtime_json(&runtime, &repository, &initial_request, &[]);
    assert_eq!(replay["result"]["status"], "task_executed");
    assert_eq!(replay["result"]["replayed"], true);
    assert_eq!(replay["result"]["journey"]["replayed"], true);
    assert_eq!(replay["result"]["journey"]["task_id"], source_task_id);

    let output = Command::new(&installed)
        .args(["--json", "resume"])
        .current_dir(&repository)
        .env_remove("BROWNIE_RUNTIME_PATH")
        .env_remove("BROWNIE_WORKSPACE_ROOT")
        .env(
            "BROWNIE_RUNTIME_OBJECTIVE_TIMEOUT_MS",
            READ_ONLY_FAKE_RUNTIME_TIMEOUT_MS,
        )
        .output()
        .unwrap();

    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    let payload: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    assert_eq!(payload["ok"], true);
    assert_eq!(payload["command"], "resume");
    assert_eq!(payload["resume"]["status"], "task_executed");
    assert_eq!(payload["resume"]["candidate_count"], 1);
    assert_ne!(
        payload["resume"]["selected_task_id"].as_str().unwrap(),
        source_task_id
    );
    assert!(payload["resume"]["selected_run_id"].as_str().is_some());
    assert!(!stdout.contains(repository.to_string_lossy().as_ref()));
    assert!(!stdout.contains(prefix.to_string_lossy().as_ref()));
    assert!(!stdout.contains("BROWNIE_RUNTIME_PATH"));
    assert!(!stdout.contains("BROWNIE_WORKSPACE_ROOT"));

    fs::remove_dir_all(repository).unwrap();
    fs::remove_dir_all(prefix).unwrap();
}

#[test]
fn installed_run_timeout_retry_uses_same_admission_without_duplicate_task() {
    let (installed, prefix) = install_real_cli_with_sibling_runtime("installed-admission-retry");
    let runtime = installed_runtime_from_prefix(&prefix);
    let repository = ordinary_git_repository("installed-admission-retry-repo");
    let objective = "Implement README update";

    let timed_out = Command::new(&installed)
        .args(["--json", "run", objective])
        .current_dir(&repository)
        .env_remove("BROWNIE_RUNTIME_PATH")
        .env_remove("BROWNIE_WORKSPACE_ROOT")
        .env("BROWNIE_RUNTIME_OBJECTIVE_TIMEOUT_MS", "8000")
        .env(
            "BROWNIE_TEST_SLEEP_AFTER_HEADLESS_JOURNEY_STARTED_MS",
            "15000",
        )
        .output()
        .unwrap();
    assert!(!timed_out.status.success());
    assert_eq!(timed_out.status.code(), Some(70));
    assert!(timed_out.stderr.is_empty());
    let timeout_stdout = String::from_utf8(timed_out.stdout).unwrap();
    let timeout_payload: serde_json::Value = serde_json::from_str(&timeout_stdout).unwrap();
    assert_eq!(
        timeout_payload["automation"]["process_admission_state"],
        "unknown"
    );
    let recovery_identity = timeout_payload["automation"]["recovery_identity"]
        .as_object()
        .expect("recovery identity");
    let session_id = recovery_identity["session_id"].as_str().unwrap();
    let drive_id = recovery_identity["drive_id"].as_str().unwrap();
    let journey_id = recovery_identity["journey_id"].as_str().unwrap();
    assert_eq!(drive_id, format!("{session_id}.drive"));
    assert_eq!(journey_id, format!("{session_id}.journey"));
    assert!(!timeout_stdout.contains(objective));
    assert!(!timeout_stdout.contains(repository.to_string_lossy().as_ref()));
    assert!(!timeout_stdout.contains(prefix.to_string_lossy().as_ref()));

    let tasks_after_timeout = invoke_runtime_json(
        &runtime,
        &repository,
        &serde_json::json!({"jsonrpc":"2.0","id":1,"method":"task.list"}),
        &[],
    );
    let timed_out_task = single_task_by_goal(&tasks_after_timeout, objective);
    let timed_out_task_id = timed_out_task["task_id"].as_str().unwrap().to_string();
    let task_count_after_timeout = tasks_after_timeout["result"]["tasks"]
        .as_array()
        .unwrap()
        .len();

    let retry_request = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "headless.run.drive",
        "params": {
            "authorize": true,
            "session_id": session_id,
            "drive_id": drive_id,
            "expected_start_session_sequence": 0,
            "max_advances": 1,
            "max_steps_per_advance": 1,
            "journey_admission": {
                "journey_id": journey_id,
                "authorize_journey_start": true,
                "admission_id": format!("{session_id}.admission"),
                "task_start": {
                    "goal": objective
                }
            }
        }
    });
    let retry = invoke_runtime_json(&runtime, &repository, &retry_request, &[]);
    assert!(
        retry.get("result").is_some(),
        "retry should replay or continue the admitted journey: {retry}"
    );
    assert_eq!(retry["result"]["journey"]["task_id"], timed_out_task_id);
    assert_eq!(retry["result"]["journey"]["session_id"], session_id);
    assert_eq!(retry["result"]["journey"]["drive_id"], drive_id);
    assert_eq!(retry["result"]["journey"]["journey_id"], journey_id);

    let tasks_after_retry = invoke_runtime_json(
        &runtime,
        &repository,
        &serde_json::json!({"jsonrpc":"2.0","id":3,"method":"task.list"}),
        &[],
    );
    assert_eq!(
        tasks_after_retry["result"]["tasks"]
            .as_array()
            .unwrap()
            .len(),
        task_count_after_timeout
    );
    let retried_task = single_task_by_goal(&tasks_after_retry, objective);
    assert_eq!(retried_task["task_id"], timed_out_task_id);
    let retry_stdout = retry.to_string();
    assert!(!retry_stdout.contains(repository.to_string_lossy().as_ref()));
    assert!(!retry_stdout.contains(prefix.to_string_lossy().as_ref()));

    fs::remove_dir_all(repository).unwrap();
    fs::remove_dir_all(prefix).unwrap();
}

#[test]
fn installed_timeout_resume_continues_exact_persisted_cli_journey_without_duplicate_admission() {
    let (installed, prefix) = install_real_cli_with_sibling_runtime("installed-timeout-resume");
    let runtime = installed_runtime_from_prefix(&prefix);
    let repository = ordinary_git_repository("installed-timeout-resume-repo");
    let objective = "Implement README update";

    let unrelated = invoke_runtime_json(
        &runtime,
        &repository,
        &serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "task.start",
            "params": {
                "goal": "Unrelated ordinary repository task",
                "mode_id": "implementer"
            }
        }),
        &[],
    );
    let unrelated_task_id = unrelated["result"]["task_id"].as_str().unwrap().to_string();

    let timed_out = Command::new(&installed)
        .args(["--json", "run", objective])
        .current_dir(&repository)
        .env_remove("BROWNIE_RUNTIME_PATH")
        .env_remove("BROWNIE_WORKSPACE_ROOT")
        .env("BROWNIE_RUNTIME_OBJECTIVE_TIMEOUT_MS", "2000")
        .env(
            "BROWNIE_TEST_SLEEP_AFTER_HEADLESS_JOURNEY_STARTED_MS",
            "5000",
        )
        .output()
        .unwrap();
    assert!(!timed_out.status.success());
    assert_eq!(timed_out.status.code(), Some(70));
    assert!(timed_out.stderr.is_empty());
    let timeout_stdout = String::from_utf8(timed_out.stdout).unwrap();
    let timeout_payload: serde_json::Value = serde_json::from_str(&timeout_stdout).unwrap();
    assert_eq!(timeout_payload["ok"], false);
    assert_eq!(timeout_payload["error"]["code"], "runtime_timeout");
    assert_eq!(timeout_payload["automation"]["schema_version"], 1);
    assert_eq!(timeout_payload["automation"]["outcome_scope"], "process");
    assert_eq!(
        timeout_payload["automation"]["controller_action"],
        "return_to_supervisor"
    );
    assert_eq!(
        timeout_payload["automation"]["continuation_required"],
        false
    );
    assert_eq!(timeout_payload["automation"]["retryable"], true);
    assert_eq!(
        timeout_payload["automation"]["process_admission_state"],
        "unknown"
    );
    assert_eq!(
        timeout_payload["automation"]["recovery_recommendation"],
        "supervisor_reconcile_or_probe_runtime_state"
    );
    assert!(timeout_payload["automation"]["next_invocation"].is_null());
    let recovery_identity = timeout_payload["automation"]["recovery_identity"]
        .as_object()
        .expect("recovery identity");
    let session_id = recovery_identity["session_id"].as_str().unwrap();
    assert!(session_id.starts_with("cli.run."));
    assert_eq!(recovery_identity["drive_id"], format!("{session_id}.drive"));
    assert_eq!(
        recovery_identity["journey_id"],
        format!("{session_id}.journey")
    );
    let objective_fingerprint = recovery_identity["objective_fingerprint"].as_str().unwrap();
    assert!(objective_fingerprint.starts_with("sha256:"));
    assert!(!timeout_stdout.contains(objective));

    let tasks_after_timeout = invoke_runtime_json(
        &runtime,
        &repository,
        &serde_json::json!({"jsonrpc":"2.0","id":2,"method":"task.list"}),
        &[],
    );
    let timed_out_task = single_task_by_goal(&tasks_after_timeout, objective);
    assert_eq!(timed_out_task["status"], "Created");
    let timed_out_task_id = timed_out_task["task_id"].as_str().unwrap().to_string();
    assert_ne!(timed_out_task_id, unrelated_task_id);

    let output = Command::new(&installed)
        .args(["--json", "resume"])
        .current_dir(&repository)
        .env_remove("BROWNIE_RUNTIME_PATH")
        .env_remove("BROWNIE_WORKSPACE_ROOT")
        .env("BROWNIE_RUNTIME_OBJECTIVE_TIMEOUT_MS", "30000")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "resume failed with status {:?}\nstdout:\n{}\nstderr:\n{}",
        output.status.code(),
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    let payload: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    assert_eq!(payload["ok"], true);
    assert_eq!(payload["command"], "resume");
    assert_eq!(payload["resume"]["status"], "no_eligible_task");
    assert_eq!(payload["resume"]["candidate_count"], 1);
    assert_eq!(payload["resume"]["selected_task_id"], timed_out_task_id);
    assert_ne!(payload["resume"]["selected_task_id"], unrelated_task_id);
    assert_eq!(payload["resume"]["completion_closure_status"], "complete");
    assert_eq!(
        payload["resume"]["objective_completion_acceptance_acceptance_status"],
        "accepted"
    );
    assert_eq!(
        payload["resume"]["completion_finalization_status"],
        "finalized"
    );
    assert_eq!(payload["automation"]["schema_version"], 1);
    assert_eq!(payload["automation"]["status"], "completed");
    assert_eq!(payload["automation"]["controller_action"], "stop");
    assert_eq!(payload["automation"]["completed"], true);
    assert_eq!(payload["automation"]["outcome_source"], "runtime");
    assert_eq!(payload["resume"]["automation"]["controller_action"], "stop");
    assert!(payload["resume"].get("execution_outcome").is_none());

    let tasks_after_resume = invoke_runtime_json(
        &runtime,
        &repository,
        &serde_json::json!({"jsonrpc":"2.0","id":3,"method":"task.list"}),
        &[],
    );
    let resumed_task = single_task_by_goal(&tasks_after_resume, objective);
    assert_eq!(resumed_task["task_id"], timed_out_task_id);
    assert_eq!(resumed_task["status"], "Completed");
    let unrelated_task =
        single_task_by_goal(&tasks_after_resume, "Unrelated ordinary repository task");
    assert_eq!(unrelated_task["task_id"], unrelated_task_id);
    assert_eq!(unrelated_task["status"], "Created");
    assert!(!stdout.contains(repository.to_string_lossy().as_ref()));
    assert!(!stdout.contains(prefix.to_string_lossy().as_ref()));
    assert!(!stdout.contains("BROWNIE_RUNTIME_PATH"));
    assert!(!stdout.contains("BROWNIE_WORKSPACE_ROOT"));

    fs::remove_dir_all(repository).unwrap();
    fs::remove_dir_all(prefix).unwrap();
}

#[test]
fn installed_long_history_list_and_resume_use_bounded_task_list_transport() {
    let (installed, prefix) = install_real_cli_with_sibling_runtime("installed-long-history");
    let runtime = installed_runtime_from_prefix(&prefix);
    let repository = ordinary_git_repository("installed-long-history-repo");
    let objective = "Implement README update";
    let filler_suffix = "x".repeat(900);
    let mut unrelated_task_ids = Vec::new();

    for index in 0..24 {
        let started = invoke_runtime_json(
            &runtime,
            &repository,
            &serde_json::json!({
                "jsonrpc": "2.0",
                "id": index + 1,
                "method": "task.start",
                "params": {
                    "goal": format!("Long history filler task {index}: {filler_suffix}"),
                    "mode_id": "implementer"
                }
            }),
            &[],
        );
        assert!(
            started.get("error").is_none(),
            "filler task admission should succeed: {started}"
        );
        unrelated_task_ids.push(started["result"]["task_id"].as_str().unwrap().to_string());
    }

    let raw_unbounded = invoke_runtime_stdout(
        &runtime,
        &repository,
        &serde_json::json!({"jsonrpc":"2.0","id":100,"method":"task.list"}),
        &[],
    );
    assert!(
        raw_unbounded.len() > 16 * 1024,
        "fixture must exceed the old CLI transport cap, got {} bytes",
        raw_unbounded.len()
    );

    let human_list = Command::new(&installed)
        .args(["list", "tasks"])
        .current_dir(&repository)
        .env_remove("BROWNIE_RUNTIME_PATH")
        .env_remove("BROWNIE_WORKSPACE_ROOT")
        .env(
            "BROWNIE_RUNTIME_TIMEOUT_MS",
            READ_ONLY_FAKE_RUNTIME_TIMEOUT_MS,
        )
        .output()
        .unwrap();
    assert!(
        human_list.status.success(),
        "bounded human list failed with status {:?}\nstdout:\n{}\nstderr:\n{}",
        human_list.status.code(),
        String::from_utf8_lossy(&human_list.stdout),
        String::from_utf8_lossy(&human_list.stderr)
    );
    assert!(human_list.stderr.is_empty());
    let human_stdout = String::from_utf8(human_list.stdout).unwrap();
    assert!(human_stdout.contains("tasks 24"));
    assert!(!human_stdout.contains(repository.to_string_lossy().as_ref()));
    assert!(!human_stdout.contains(prefix.to_string_lossy().as_ref()));

    let json_list = Command::new(&installed)
        .args(["--json", "list", "tasks"])
        .current_dir(&repository)
        .env_remove("BROWNIE_RUNTIME_PATH")
        .env_remove("BROWNIE_WORKSPACE_ROOT")
        .env(
            "BROWNIE_RUNTIME_TIMEOUT_MS",
            READ_ONLY_FAKE_RUNTIME_TIMEOUT_MS,
        )
        .output()
        .unwrap();
    assert!(json_list.status.success());
    assert!(json_list.stderr.is_empty());
    let json_stdout = String::from_utf8(json_list.stdout).unwrap();
    let list_payload: serde_json::Value = serde_json::from_str(&json_stdout).unwrap();
    assert_eq!(list_payload["ok"], true);
    assert_eq!(list_payload["task_list"]["task_count"], 24);
    assert_eq!(list_payload["task_list"]["runnable_count"], 24);
    assert_eq!(
        list_payload["task_list"]["tasks"].as_array().unwrap().len(),
        10
    );
    assert_eq!(list_payload["task_list"]["truncated"]["tasks"], true);
    assert!(!json_stdout.contains(repository.to_string_lossy().as_ref()));
    assert!(!json_stdout.contains(prefix.to_string_lossy().as_ref()));

    let timed_out = Command::new(&installed)
        .args(["--json", "run", objective])
        .current_dir(&repository)
        .env_remove("BROWNIE_RUNTIME_PATH")
        .env_remove("BROWNIE_WORKSPACE_ROOT")
        .env("BROWNIE_RUNTIME_OBJECTIVE_TIMEOUT_MS", "2000")
        .env(
            "BROWNIE_TEST_SLEEP_AFTER_HEADLESS_JOURNEY_STARTED_MS",
            "5000",
        )
        .output()
        .unwrap();
    assert!(!timed_out.status.success());
    assert_eq!(timed_out.status.code(), Some(70));
    assert!(timed_out.stderr.is_empty());

    let raw_after_timeout = invoke_runtime_stdout(
        &runtime,
        &repository,
        &serde_json::json!({"jsonrpc":"2.0","id":101,"method":"task.list"}),
        &[],
    );
    assert!(
        raw_after_timeout.len() > 16 * 1024,
        "post-timeout task.list should still exceed the old cap, got {} bytes",
        raw_after_timeout.len()
    );
    let tasks_after_timeout: serde_json::Value = serde_json::from_str(
        raw_after_timeout
            .lines()
            .find(|line| !line.trim().is_empty())
            .unwrap_or(""),
    )
    .unwrap();
    let timed_out_task = single_task_by_goal(&tasks_after_timeout, objective);
    assert_eq!(timed_out_task["status"], "Created");
    let timed_out_task_id = timed_out_task["task_id"].as_str().unwrap().to_string();
    assert!(
        !unrelated_task_ids.contains(&timed_out_task_id),
        "timed-out CLI journey must be distinct from unrelated long-history tasks"
    );

    let resumed = Command::new(&installed)
        .args(["--json", "resume"])
        .current_dir(&repository)
        .env_remove("BROWNIE_RUNTIME_PATH")
        .env_remove("BROWNIE_WORKSPACE_ROOT")
        .env("BROWNIE_RUNTIME_OBJECTIVE_TIMEOUT_MS", "30000")
        .output()
        .unwrap();
    assert!(
        resumed.status.success(),
        "bounded resume failed with status {:?}\nstdout:\n{}\nstderr:\n{}",
        resumed.status.code(),
        String::from_utf8_lossy(&resumed.stdout),
        String::from_utf8_lossy(&resumed.stderr)
    );
    assert!(resumed.stderr.is_empty());
    let resume_stdout = String::from_utf8(resumed.stdout).unwrap();
    let resume_payload: serde_json::Value = serde_json::from_str(&resume_stdout).unwrap();
    assert_eq!(resume_payload["ok"], true);
    assert_eq!(resume_payload["command"], "resume");
    assert_eq!(resume_payload["resume"]["status"], "no_eligible_task");
    assert_eq!(resume_payload["resume"]["candidate_count"], 1);
    assert_eq!(
        resume_payload["resume"]["selected_task_id"],
        timed_out_task_id
    );
    assert_eq!(
        resume_payload["resume"]["completion_closure_status"],
        "complete"
    );
    assert_eq!(
        resume_payload["resume"]["completion_finalization_status"],
        "finalized"
    );
    assert_eq!(resume_payload["automation"]["schema_version"], 1);
    assert_eq!(resume_payload["automation"]["status"], "completed");
    assert_eq!(resume_payload["automation"]["controller_action"], "stop");
    assert_eq!(resume_payload["automation"]["completed"], true);
    assert_eq!(resume_payload["automation"]["outcome_source"], "runtime");
    assert!(resume_payload["resume"].get("execution_outcome").is_none());
    assert!(!resume_stdout.contains(repository.to_string_lossy().as_ref()));
    assert!(!resume_stdout.contains(prefix.to_string_lossy().as_ref()));

    let tasks_after_resume = invoke_runtime_json(
        &runtime,
        &repository,
        &serde_json::json!({"jsonrpc":"2.0","id":102,"method":"task.list"}),
        &[],
    );
    let resumed_task = single_task_by_goal(&tasks_after_resume, objective);
    assert_eq!(resumed_task["task_id"], timed_out_task_id);
    assert_eq!(resumed_task["status"], "Completed");
    assert_eq!(
        tasks_after_resume["result"]["tasks"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|task| task["status"] == "Created"
                && unrelated_task_ids
                    .iter()
                    .any(|task_id| task["task_id"].as_str() == Some(task_id.as_str())))
            .count(),
        unrelated_task_ids.len()
    );

    fs::remove_dir_all(repository).unwrap();
    fs::remove_dir_all(prefix).unwrap();
}

#[test]
fn installed_resume_keeps_runtime_created_recovery_inside_cli_scope() {
    let (installed, prefix) = install_real_cli_with_sibling_runtime("installed-resume-recovery");
    let runtime = installed_runtime_from_prefix(&prefix);
    let repository = ordinary_git_repository("installed-resume-recovery-repo");

    let run = Command::new(&installed)
        .args(["--json", "run", "run cargo check for this repository"])
        .current_dir(&repository)
        .env_remove("BROWNIE_RUNTIME_PATH")
        .env_remove("BROWNIE_WORKSPACE_ROOT")
        .env(
            "BROWNIE_RUNTIME_OBJECTIVE_TIMEOUT_MS",
            READ_ONLY_FAKE_RUNTIME_TIMEOUT_MS,
        )
        .output()
        .unwrap();
    assert!(run.status.success());
    assert!(run.stderr.is_empty());
    let run_stdout = String::from_utf8(run.stdout).unwrap();
    let run_payload: serde_json::Value = serde_json::from_str(&run_stdout).unwrap();
    assert_eq!(
        run_payload["run"]["next_action"],
        "start_verification_recovery_explicitly"
    );
    let source_task_id = run_payload["run"]["task_id"].as_str().unwrap();
    let source_run_id = run_payload["run"]["run_id"].as_str().unwrap();

    let tasks = invoke_runtime_json(
        &runtime,
        &repository,
        &serde_json::json!({"jsonrpc":"2.0","id":2,"method":"task.list"}),
        &[],
    );
    let source_task = tasks["result"]["tasks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|task| task["task_id"] == source_task_id)
        .expect("source task");
    assert_eq!(source_task["status"], "Failed");

    let events = invoke_runtime_json(
        &runtime,
        &repository,
        &serde_json::json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "run.events",
            "params": { "run_id": source_run_id }
        }),
        &[],
    );
    let failed_gate = events["result"]["events"]
        .as_array()
        .unwrap()
        .iter()
        .find(|event| event["kind"] == "TaskFailed")
        .and_then(|event| event.get("payload"))
        .expect("failed gate");
    let failure_fingerprint = verification_recovery_failure_fingerprint(source_task, failed_gate);

    let recovery = invoke_runtime_json(
        &runtime,
        &repository,
        &serde_json::json!({
            "jsonrpc": "2.0",
            "id": 4,
            "method": "task.start",
            "params": {
                "goal": "Repair the failed verifier from CLI recovery E2E",
                "mode_id": "implementer",
                "verification_recovery_source": {
                    "source_task_id": source_task_id,
                    "source_run_id": source_run_id,
                    "expected_failure_fingerprint": failure_fingerprint,
                    "authorize_recovery": true
                }
            }
        }),
        &[],
    );
    assert!(
        recovery.get("error").is_none(),
        "recovery admission should succeed: {recovery}"
    );
    let recovery_task_id = recovery["result"]["task_id"].as_str().unwrap();
    let recovery_run_id = recovery["result"]["run_id"].as_str().unwrap();
    assert_eq!(
        recovery["result"]["verification_recovery_admission"]["source_task_id"],
        source_task_id
    );

    let output = Command::new(&installed)
        .args(["--json", "resume"])
        .current_dir(&repository)
        .env_remove("BROWNIE_RUNTIME_PATH")
        .env_remove("BROWNIE_WORKSPACE_ROOT")
        .env(
            "BROWNIE_RUNTIME_OBJECTIVE_TIMEOUT_MS",
            READ_ONLY_FAKE_RUNTIME_TIMEOUT_MS,
        )
        .output()
        .unwrap();

    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    let payload: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    assert_eq!(payload["ok"], true);
    assert_eq!(payload["command"], "resume");
    assert_eq!(payload["resume"]["status"], "task_executed");
    assert_eq!(payload["resume"]["selected_task_id"], recovery_task_id);
    assert_eq!(payload["resume"]["selected_run_id"], recovery_run_id);
    assert!(!stdout.contains(repository.to_string_lossy().as_ref()));
    assert!(!stdout.contains(prefix.to_string_lossy().as_ref()));
    assert!(!stdout.contains("BROWNIE_RUNTIME_PATH"));
    assert!(!stdout.contains("BROWNIE_WORKSPACE_ROOT"));

    fs::remove_dir_all(repository).unwrap();
    fs::remove_dir_all(prefix).unwrap();
}

#[test]
fn resume_can_invoke_real_runtime_continue_once_with_temp_workspace() {
    let runtime = build_real_runtime_binary();
    let workspace = std::env::temp_dir().join(format!(
        "brownie-cli-real-resume-{}-{}",
        std::process::id(),
        RUNTIME_BUILD_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir_all(&workspace).unwrap();

    let output = Command::new(brownie())
        .arg("resume")
        .env("BROWNIE_RUNTIME_PATH", runtime)
        .env("BROWNIE_WORKSPACE_ROOT", &workspace)
        .env(
            "BROWNIE_RUNTIME_TIMEOUT_MS",
            READ_ONLY_FAKE_RUNTIME_TIMEOUT_MS,
        )
        .env(
            "BROWNIE_RUNTIME_OBJECTIVE_TIMEOUT_MS",
            READ_ONLY_FAKE_RUNTIME_TIMEOUT_MS,
        )
        .output()
        .unwrap();

    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("resume"));
    assert!(stdout.contains("status: no_eligible_task"));
    assert!(stdout.contains("next: inspect_progress_overview"));
    assert!(!stdout.contains(workspace.to_string_lossy().as_ref()));
    assert!(!stdout.contains("BROWNIE_WORKSPACE_ROOT"));
}

fn assert_run_preserves_objective(name: &str, args: &[&str], expected_objective: &str) {
    let runtime = fake_runtime(
        name,
        r#"{"jsonrpc":"2.0","id":1,"result":{"status":"task_executed","session_id":"cli.run.preserve","drive_id":"cli.run.preserve.drive","completion_closure":{"status":"budget_exhausted"},"next_action":"inspect_progress_overview","journey":{"journey_id":"cli.run.preserve.journey","task_id":"task-preserve","run_id":"run-preserve"}}}"#,
    );
    let capture = runtime.with_file_name("request.json");

    let output = Command::new(brownie())
        .args(args)
        .env("BROWNIE_RUNTIME_PATH", &runtime)
        .env("BROWNIE_FAKE_RUNTIME_CAPTURE", &capture)
        .output()
        .unwrap();

    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let request = fs::read_to_string(capture).unwrap();
    let request: serde_json::Value = serde_json::from_str(&request).unwrap();
    assert_eq!(request["method"], "headless.run.drive");
    assert_eq!(
        request["params"]["journey_admission"]["task_start"]["goal"],
        expected_objective
    );
}

fn ordinary_git_repository(name: &str) -> PathBuf {
    let repository = unique_test_dir(name);
    fs::create_dir_all(&repository).unwrap();
    let status = Command::new("git")
        .args(["init"])
        .current_dir(&repository)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .expect("git init should run");
    assert!(status.success());
    let status = Command::new("git")
        .args(["config", "user.email", "brownie-cli-test@example.invalid"])
        .current_dir(&repository)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .expect("git config user.email should run");
    assert!(status.success());
    let status = Command::new("git")
        .args(["config", "user.name", "Brownie CLI Test"])
        .current_dir(&repository)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .expect("git config user.name should run");
    assert!(status.success());
    fs::write(repository.join("README.md"), "# Ordinary repository\n").unwrap();
    let status = Command::new("git")
        .args(["add", "README.md"])
        .current_dir(&repository)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .expect("git add should run");
    assert!(status.success());
    let status = Command::new("git")
        .args(["commit", "-qm", "init"])
        .current_dir(&repository)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .expect("git commit should run");
    assert!(status.success());
    repository
}

fn install_real_cli_with_sibling_runtime(name: &str) -> (PathBuf, PathBuf) {
    let runtime = build_real_runtime_binary();
    let prefix = unique_test_dir(name);
    let bin_dir = prefix.join("bin");
    fs::create_dir_all(&bin_dir).unwrap();
    let installed = bin_dir.join(format!("brownie{}", std::env::consts::EXE_SUFFIX));
    let installed_runtime =
        bin_dir.join(format!("brownie-runtime{}", std::env::consts::EXE_SUFFIX));
    fs::copy(brownie(), &installed).unwrap();
    fs::copy(runtime, &installed_runtime).unwrap();
    make_executable(&installed);
    make_executable(&installed_runtime);
    (installed, prefix)
}

fn installed_runtime_from_prefix(prefix: &Path) -> PathBuf {
    prefix
        .join("bin")
        .join(format!("brownie-runtime{}", std::env::consts::EXE_SUFFIX))
}

struct CurrentAgentModesCliFixture {
    source_root: PathBuf,
}

fn write_current_agentmodes_modepack_if_available(
    workspace_root: &Path,
) -> Option<CurrentAgentModesCliFixture> {
    let source_root = current_agentmodes_root_for_test()?;
    let baseline = brownie_agentmodes::CURRENT_AGENTMODES_COMPATIBILITY_BASELINE;
    let modepack = brownie_agentmodes::compile_agentmodes_modepack_from_root(
        &source_root,
        brownie_agentmodes::AgentModesCompileOptions {
            modepack_name: Some("current-agentmodes".to_string()),
            ..brownie_agentmodes::AgentModesCompileOptions::default()
        },
    )
    .expect("compile current AgentModes mode pack");
    assert_eq!(modepack.modes.len(), baseline.expected_compiled_mode_count);
    assert_eq!(
        policy_artifact_category_count(&modepack.global_policy_artifacts, "rule"),
        baseline.expected_rule_count
    );
    assert_eq!(
        policy_artifact_category_count(&modepack.global_policy_artifacts, "skill"),
        baseline.expected_skill_count
    );
    assert_eq!(
        policy_artifact_category_count(&modepack.global_policy_artifacts, "command"),
        baseline.expected_command_count
    );
    assert_eq!(
        policy_artifact_category_count(&modepack.global_policy_artifacts, "contract"),
        baseline.expected_contract_count
    );
    assert_eq!(
        policy_artifact_category_count(&modepack.global_policy_artifacts, "schema"),
        baseline.expected_schema_count
    );
    assert_eq!(
        policy_artifact_category_count(&modepack.global_policy_artifacts, "runtime_policy"),
        baseline.expected_runtime_policy_count
    );
    assert!(modepack
        .modes
        .iter()
        .any(|mode| mode.mode_id == brownie_agentmodes::AGENTMODES_V2_DEFAULT_ROLE_ID));
    let modepack_dir = workspace_root.join(".brownie");
    fs::create_dir_all(&modepack_dir).unwrap();
    fs::write(
        modepack_dir.join("modepack.json"),
        serde_json::to_string_pretty(&modepack).expect("serialize current AgentModes mode pack"),
    )
    .unwrap();
    Some(CurrentAgentModesCliFixture { source_root })
}

struct TrustedCurrentAgentModesCliActivation {
    default_entrypoint: String,
    activation_fingerprint: String,
}

fn activate_trusted_current_agentmodes_via_signed_candidate_for_cli(
    runtime: &Path,
    workspace_root: &Path,
) -> TrustedCurrentAgentModesCliActivation {
    use base64::{engine::general_purpose, Engine as _};
    use ed25519_dalek::{Signer, SigningKey};

    let modepack_path = workspace_root.join(".brownie/modepack.json");
    let modepack_json = fs::read_to_string(&modepack_path).unwrap();
    let bootstrap_json = r#"{
      "name": "bootstrap-before-current-agentmodes",
      "schema_version": 1,
      "entrypoints": { "default": "bootstrap-reader" },
      "modes": [
        {
          "mode_id": "bootstrap-reader",
          "display_name": "Bootstrap Reader",
          "role_definition": "Temporary read-only bootstrap policy before signed AgentModes Core replacement.",
          "permissions": {
            "read_only": true,
            "workspace_write": false,
            "process_exec": false,
            "git_inspect": false,
            "git_commit": false,
            "network_access": false,
            "service_control": false,
            "destructive": false,
            "can_spawn_subtasks": false,
            "codebase_index": true,
            "mcp_tool_access": false
          }
        }
      ]
    }"#;
    fs::write(&modepack_path, bootstrap_json).unwrap();
    let workspace_activation = invoke_runtime_json(
        runtime,
        workspace_root,
        &serde_json::json!({"jsonrpc":"2.0","id":10,"method":"modepack.activate","params":{"authorize":true}}),
        &[],
    );
    assert!(
        workspace_activation.get("error").is_none(),
        "workspace activation should succeed: {workspace_activation}"
    );
    let current_activation_fingerprint = workspace_activation["result"]["snapshot"]
        ["activation_fingerprint"]
        .as_str()
        .expect("current activation fingerprint")
        .to_string();
    fs::write(&modepack_path, &modepack_json).unwrap();

    let store = brownie_store::BrownieStore::new(workspace_root);
    let snapshot = brownie_modepack::load_modepack_from_str_with_options(
        &modepack_json,
        ".brownie/modepack.json",
        brownie_modepack::ModePackLoadOptions::trusted_signed_active_modepack(),
    )
    .expect("trusted current AgentModes load");
    let default_entrypoint = snapshot
        .entrypoints
        .default_mode_id()
        .expect("current AgentModes default entrypoint")
        .to_string();
    assert_eq!(
        default_entrypoint,
        brownie_agentmodes::AGENTMODES_V2_DEFAULT_ROLE_ID
    );
    let entry_policy = snapshot
        .modes
        .iter()
        .find(|policy| policy.mode_id == default_entrypoint)
        .expect("current AgentModes orchestrator policy");
    assert!(!entry_policy.permissions.can_spawn_subtasks);
    assert!(!entry_policy.permissions.workspace_write);
    assert!(!entry_policy.permissions.process_exec);
    assert_eq!(entry_policy.allowed_handoff_targets, None);
    for required in ["core.orchestrator", "core.reviewer", "core.reporter"] {
        assert!(
            snapshot
                .modes
                .iter()
                .any(|policy| policy.mode_id == required),
            "current AgentModes Core must include {required}"
        );
    }
    for policy in &snapshot.modes {
        assert!(
            !policy.permissions.workspace_write,
            "{} must not grant workspace write in AgentModes OSS Core",
            policy.mode_id
        );
        assert!(
            !policy.permissions.process_exec,
            "{} must not grant command execution in AgentModes OSS Core",
            policy.mode_id
        );
        assert!(
            !policy.permissions.can_spawn_subtasks,
            "{} must not grant dispatch in AgentModes OSS Core",
            policy.mode_id
        );
        assert!(
            !policy.permissions.git_inspect && !policy.permissions.git_commit,
            "{} must not grant Git authority in AgentModes OSS Core",
            policy.mode_id
        );
    }

    let policy_snapshots = snapshot
        .modes
        .iter()
        .map(|policy| {
            let policy_fingerprint = cli_external_modepack_policy_fingerprint(
                &snapshot.name,
                snapshot.schema_version,
                policy,
            );
            brownie_store::ActiveModePackPolicySnapshot {
                mode_id: policy.mode_id.clone(),
                display_name: policy.display_name.clone(),
                role_definition: policy.role_definition.clone(),
                when_to_use: policy.when_to_use.clone(),
                description: policy.description.clone(),
                prompt_sections: cli_mode_prompt_sections_payload(policy),
                verification_responsibility: policy.verification_responsibility.clone(),
                instruction_fingerprint: policy.instruction_fingerprint.clone(),
                permissions: cli_mode_permissions_payload(policy),
                workspace_write_scopes: cli_mode_workspace_write_scopes_payload(policy),
                allowed_handoff_targets: policy.allowed_handoff_targets.clone(),
                mcp_access: cli_mode_mcp_access_payload(policy),
                completion_rules: policy.completion_rules.clone(),
                policy_fingerprint,
            }
        })
        .collect::<Vec<_>>();
    let mode_ids = policy_snapshots
        .iter()
        .map(|policy| policy.mode_id.clone())
        .collect::<Vec<_>>();
    let global_policy_artifacts = cli_modepack_global_policy_artifacts_payload(&snapshot);
    let compiled_policy_fingerprint = cli_active_modepack_compiled_policy_fingerprint(
        &snapshot.name,
        snapshot.schema_version,
        snapshot.entrypoints.default_mode_id(),
        &global_policy_artifacts,
        &policy_snapshots,
    );
    let activation_fingerprint = cli_active_modepack_activation_fingerprint(
        &snapshot.name,
        snapshot.schema_version,
        &compiled_policy_fingerprint,
        &mode_ids,
        snapshot.entrypoints.default_mode_id(),
    );
    let source_url = "https://example.com/current-agentmodes-modepack.json";
    let source_url_host = "example.com";
    let source_url_fingerprint = format!("sha256:{}", hex_lower(&Sha256::digest(source_url)));
    let pinned_addr = "93.184.216.34:443";
    let pinned_addr_fingerprint = format!("sha256:{}", hex_lower(&Sha256::digest(pinned_addr)));
    let resolution_fingerprint = format!(
        "sha256:{}",
        hex_lower(&Sha256::digest(&pinned_addr_fingerprint))
    );
    let content_sha256 = format!("sha256:{}", hex_lower(&Sha256::digest(&modepack_json)));
    let candidate = store
        .commit_modepack_candidate_snapshot(&brownie_store::ModePackCandidateSnapshot {
            summary: brownie_protocol::ModePackCandidateSummary {
                candidate_id: format!("modepack_candidate_{}", &content_sha256[7..23]),
                source_kind: "remote_https".to_string(),
                source_url_host: source_url_host.to_string(),
                source_url_fingerprint: source_url_fingerprint.clone(),
                dns_binding: brownie_protocol::ModePackDnsBindingSummary {
                    resolution_fingerprint,
                    pinned_address_fingerprint: pinned_addr_fingerprint,
                    resolved_address_count: 1,
                    pinned_address_family: "ipv4".to_string(),
                },
                content_sha256: content_sha256.clone(),
                byte_count: modepack_json.len(),
                modepack_name: snapshot.name.clone(),
                schema_version: snapshot.schema_version,
                mode_count: mode_ids.len(),
                mode_ids: mode_ids.clone(),
                default_entrypoint: snapshot.entrypoints.default.clone(),
                compiled_policy_fingerprint: compiled_policy_fingerprint.clone(),
                cached_at: "2026-09-01T00:00:00Z".to_string(),
                cache_event_id: String::new(),
            },
            modepack_json,
        })
        .expect("current AgentModes candidate cache");
    assert!(!candidate.replayed);
    let signing_key = SigningKey::from_bytes(&[42u8; 32]);
    let public_key_bytes = signing_key.verifying_key().to_bytes();
    let signer_fingerprint = format!("sha256:{}", hex_lower(&Sha256::digest(public_key_bytes)));
    let statement = serde_json::json!({
        "content_sha256": candidate.snapshot.summary.content_sha256,
        "compiled_policy_fingerprint": candidate.snapshot.summary.compiled_policy_fingerprint,
        "source_url_fingerprint": candidate.snapshot.summary.source_url_fingerprint,
        "mode_ids": candidate.snapshot.summary.mode_ids,
        "schema_version": candidate.snapshot.summary.schema_version,
        "signer_fingerprint": signer_fingerprint,
        "signer_identity": "brownie-cli-current-agentmodes-e2e",
    })
    .to_string();
    let signature = signing_key.sign(statement.as_bytes());
    let provenance = invoke_runtime_json(
        runtime,
        workspace_root,
        &serde_json::json!({
            "jsonrpc": "2.0",
            "id": 11,
            "method": "modepack.verifyCandidateProvenance",
            "params": {
                "authorize_provenance_verification": true,
                "expected_content_sha256": candidate.snapshot.summary.content_sha256,
                "expected_compiled_policy_fingerprint": candidate.snapshot.summary.compiled_policy_fingerprint,
                "expected_signer_fingerprint": signer_fingerprint,
                "provenance_statement_json": statement,
                "provenance_signature_base64": general_purpose::STANDARD.encode(signature.to_bytes()),
                "provenance_public_key_base64": general_purpose::STANDARD.encode(public_key_bytes),
            }
        }),
        &[],
    );
    assert!(
        provenance.get("error").is_none(),
        "provenance verification should succeed: {provenance}"
    );
    assert_eq!(provenance["result"]["verified"], true);
    let trust = invoke_runtime_json(
        runtime,
        workspace_root,
        &serde_json::json!({
            "jsonrpc": "2.0",
            "id": 12,
            "method": "modepack.trustSigner",
            "params": {
                "authorize_trust": true,
                "signer_fingerprint": provenance["result"]["provenance"]["signer_fingerprint"],
            }
        }),
        &[],
    );
    assert!(
        trust.get("error").is_none(),
        "signer trust should succeed: {trust}"
    );
    assert_eq!(trust["result"]["trusted"], true);
    let approval = invoke_runtime_json(
        runtime,
        workspace_root,
        &serde_json::json!({
            "jsonrpc": "2.0",
            "id": 13,
            "method": "modepack.approveCandidate",
            "params": {
                "authorize_trust": true,
                "expected_content_sha256": candidate.snapshot.summary.content_sha256,
                "expected_compiled_policy_fingerprint": candidate.snapshot.summary.compiled_policy_fingerprint,
                "expected_provenance_id": provenance["result"]["provenance"]["provenance_id"],
                "expected_provenance_event_id": provenance["result"]["provenance"]["provenance_event_id"],
                "expected_signer_fingerprint": provenance["result"]["provenance"]["signer_fingerprint"],
                "expected_statement_sha256": provenance["result"]["provenance"]["statement_sha256"],
            }
        }),
        &[],
    );
    assert!(
        approval.get("error").is_none(),
        "candidate approval should succeed: {approval}"
    );
    assert_eq!(approval["result"]["approved"], true);
    let replacement = invoke_runtime_json(
        runtime,
        workspace_root,
        &serde_json::json!({
            "jsonrpc": "2.0",
            "id": 14,
            "method": "modepack.replaceActive",
            "params": {
                "authorize_replacement": true,
                "expected_current_activation_fingerprint": current_activation_fingerprint,
                "expected_candidate_activation_fingerprint": activation_fingerprint,
                "approved_candidate_approval_id": approval["result"]["approval"]["approval_id"],
                "expected_approved_candidate_content_sha256": approval["result"]["approval"]["content_sha256"],
                "expected_approved_candidate_compiled_policy_fingerprint": approval["result"]["approval"]["compiled_policy_fingerprint"],
                "expected_approved_candidate_id": approval["result"]["approval"]["candidate_id"],
                "expected_approved_candidate_source_url_host": approval["result"]["approval"]["source_url_host"],
                "expected_approved_candidate_source_url_fingerprint": approval["result"]["approval"]["source_url_fingerprint"],
                "expected_approved_candidate_dns_resolution_fingerprint": candidate.snapshot.summary.dns_binding.resolution_fingerprint,
                "expected_approved_candidate_pinned_address_fingerprint": candidate.snapshot.summary.dns_binding.pinned_address_fingerprint,
                "expected_approved_candidate_approval_event_id": approval["result"]["approval"]["approval_event_id"],
            }
        }),
        &[],
    );
    assert!(
        replacement.get("error").is_none(),
        "active replacement should succeed: {replacement}"
    );
    assert_eq!(replacement["result"]["replaced"], true);
    assert_eq!(
        replacement["result"]["replacement_snapshot"]["source_kind"],
        "remote_https_candidate"
    );
    assert_eq!(
        replacement["result"]["replacement_snapshot"]["activation_fingerprint"],
        activation_fingerprint
    );
    assert_eq!(
        replacement["result"]["approved_candidate"]["consumed"],
        true
    );
    store
        .read_active_modepack_snapshot()
        .expect("active snapshot read")
        .expect("active snapshot");
    TrustedCurrentAgentModesCliActivation {
        default_entrypoint,
        activation_fingerprint,
    }
}

fn cli_mode_permissions_payload(
    policy: &brownie_agentmodes::CompiledModePolicy,
) -> serde_json::Value {
    serde_json::json!({
        "read_only": policy.permissions.read_only,
        "workspace_write": policy.permissions.workspace_write,
        "process_exec": policy.permissions.process_exec,
        "git_inspect": policy.permissions.git_inspect,
        "git_commit": policy.permissions.git_commit,
        "network_access": policy.permissions.network_access,
        "service_control": policy.permissions.service_control,
        "destructive": policy.permissions.destructive,
        "can_spawn_subtasks": policy.permissions.can_spawn_subtasks,
        "codebase_index": policy.permissions.codebase_index,
        "mcp_tool_access": policy.permissions.mcp_tool_access,
    })
}

fn cli_mode_prompt_sections_payload(
    policy: &brownie_agentmodes::CompiledModePolicy,
) -> Vec<serde_json::Value> {
    policy
        .prompt_sections
        .iter()
        .map(|section| serde_json::json!(section))
        .collect()
}

fn cli_mode_workspace_write_scopes_payload(
    policy: &brownie_agentmodes::CompiledModePolicy,
) -> Vec<serde_json::Value> {
    policy
        .workspace_write_scopes
        .iter()
        .map(|scope| serde_json::json!(scope))
        .collect()
}

fn cli_mode_mcp_access_payload(
    policy: &brownie_agentmodes::CompiledModePolicy,
) -> Vec<serde_json::Value> {
    policy
        .mcp_access
        .iter()
        .map(|access| serde_json::json!(access))
        .collect()
}

fn cli_modepack_global_policy_artifacts_payload(
    snapshot: &brownie_modepack::ModePackSnapshot,
) -> Vec<serde_json::Value> {
    snapshot
        .global_policy_artifacts
        .iter()
        .map(|artifact| serde_json::json!(artifact))
        .collect()
}

fn cli_external_modepack_policy_fingerprint(
    modepack_name: &str,
    schema_version: u64,
    policy: &brownie_agentmodes::CompiledModePolicy,
) -> String {
    let canonical = serde_json::json!({
        "version": "external_modepack_policy_fingerprint_v1",
        "modepack_name": modepack_name,
        "schema_version": schema_version,
        "source_path": brownie_modepack::WORKSPACE_MODEPACK_PATH,
        "mode_id": policy.mode_id,
        "display_name": policy.display_name,
        "role_definition": policy.role_definition,
        "when_to_use": policy.when_to_use,
        "description": policy.description,
        "prompt_sections": policy.prompt_sections,
        "verification_responsibility": policy.verification_responsibility,
        "instruction_fingerprint": policy.instruction_fingerprint,
        "workspace_write_scopes": policy.workspace_write_scopes,
        "allowed_handoff_targets": policy.allowed_handoff_targets,
        "mcp_access": policy.mcp_access,
        "completion_rules": policy.completion_rules,
        "permissions": {
            "read_only": policy.permissions.read_only,
            "workspace_write": policy.permissions.workspace_write,
            "process_exec": policy.permissions.process_exec,
            "git_inspect": policy.permissions.git_inspect,
            "git_commit": policy.permissions.git_commit,
            "network_access": policy.permissions.network_access,
            "service_control": policy.permissions.service_control,
            "destructive": policy.permissions.destructive,
            "can_spawn_subtasks": policy.permissions.can_spawn_subtasks,
            "codebase_index": policy.permissions.codebase_index,
            "mcp_tool_access": policy.permissions.mcp_tool_access,
        }
    });
    let digest = Sha256::digest(canonical.to_string().as_bytes());
    format!("sha256:{}", hex_lower(&digest))
}

fn cli_active_modepack_compiled_policy_fingerprint(
    modepack_name: &str,
    schema_version: u64,
    default_entrypoint: Option<&str>,
    global_policy_artifacts: &[serde_json::Value],
    policies: &[brownie_store::ActiveModePackPolicySnapshot],
) -> String {
    let canonical = serde_json::json!({
        "version": "active_modepack_compiled_policy_fingerprint_v3",
        "modepack_name": modepack_name,
        "schema_version": schema_version,
        "source_path": brownie_modepack::WORKSPACE_MODEPACK_PATH,
        "default_entrypoint": default_entrypoint,
        "global_policy_artifacts": global_policy_artifacts,
        "policies": policies,
    });
    let digest = Sha256::digest(canonical.to_string().as_bytes());
    format!("sha256:{}", hex_lower(&digest))
}

fn cli_active_modepack_activation_fingerprint(
    modepack_name: &str,
    schema_version: u64,
    compiled_policy_fingerprint: &str,
    mode_ids: &[String],
    default_entrypoint: Option<&str>,
) -> String {
    let canonical = serde_json::json!({
        "version": "active_modepack_activation_fingerprint_v2",
        "modepack_name": modepack_name,
        "schema_version": schema_version,
        "source_path": brownie_modepack::WORKSPACE_MODEPACK_PATH,
        "mode_ids": mode_ids,
        "default_entrypoint": default_entrypoint,
        "compiled_policy_fingerprint": compiled_policy_fingerprint,
    });
    let digest = Sha256::digest(canonical.to_string().as_bytes());
    format!("sha256:{}", hex_lower(&digest))
}

fn current_agentmodes_required_for_test() -> bool {
    let baseline = brownie_agentmodes::CURRENT_AGENTMODES_COMPATIBILITY_BASELINE;
    truthy_env(baseline.required_env) || truthy_env("CI")
}

fn truthy_env(name: &str) -> bool {
    std::env::var(name)
        .map(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
        .unwrap_or(false)
}

fn current_agentmodes_root_for_test() -> Option<PathBuf> {
    let baseline = brownie_agentmodes::CURRENT_AGENTMODES_COMPATIBILITY_BASELINE;
    if let Some(root) = std::env::var_os(baseline.root_env).map(PathBuf::from) {
        assert_current_agentmodes_root_for_test(&root);
        return Some(root);
    }

    if current_agentmodes_required_for_test() {
        let _guard = CURRENT_AGENTMODES_CHECKOUT_LOCK
            .lock()
            .expect("AgentModes compatibility checkout lock");
        let root = current_agentmodes_managed_checkout_for_test("brownie-cli");
        prepare_current_agentmodes_checkout_for_test(&root);
        assert_current_agentmodes_root_for_test(&root);
        return Some(root);
    }

    let root = PathBuf::from("/Users/satoshitanaka/Documents/AgentModes");
    if !root.join("core").is_dir()
        || current_agentmodes_revision(&root).as_deref() != Some(baseline.revision)
    {
        return None;
    }
    Some(root)
}

fn assert_current_agentmodes_root_for_test(root: &Path) {
    let baseline = brownie_agentmodes::CURRENT_AGENTMODES_COMPATIBILITY_BASELINE;
    assert!(
        root.join("core").is_dir(),
        "{} must point to a checked-out {} repository",
        baseline.root_env,
        baseline.repository
    );
    assert_eq!(
        current_agentmodes_revision(root).as_deref(),
        Some(baseline.revision),
        "AgentModes compatibility baseline revision drifted"
    );
    assert!(
        root.join("core/orchestrator.yaml").is_file(),
        "AgentModes compatibility baseline must include v2 Core role artifacts"
    );
    assert!(
        root.join("runtime-policies/brownie/loop-policy.yaml")
            .is_file(),
        "AgentModes compatibility baseline must include Brownie runtime policies"
    );
}

fn current_agentmodes_managed_checkout_for_test(namespace: &str) -> PathBuf {
    let baseline = brownie_agentmodes::CURRENT_AGENTMODES_COMPATIBILITY_BASELINE;
    std::env::temp_dir()
        .join("brownie-agentmodes-compat")
        .join(format!(
            "{}-{}-{}",
            namespace,
            std::process::id(),
            baseline.revision
        ))
}

fn prepare_current_agentmodes_checkout_for_test(root: &Path) {
    let baseline = brownie_agentmodes::CURRENT_AGENTMODES_COMPATIBILITY_BASELINE;
    if current_agentmodes_revision(root).as_deref() == Some(baseline.revision)
        && root.join("core/orchestrator.yaml").is_file()
    {
        return;
    }
    if root.exists() {
        fs::remove_dir_all(root).expect("remove stale AgentModes compatibility checkout");
    }
    fs::create_dir_all(root.parent().expect("AgentModes checkout parent"))
        .expect("create AgentModes compatibility checkout parent");
    let repository_url = format!("https://github.com/{}.git", baseline.repository);
    assert_git_status_for_test(
        Command::new("git")
            .arg("clone")
            .arg("--no-checkout")
            .arg(&repository_url)
            .arg(root),
        "clone AgentModes compatibility baseline",
    );
    assert_git_status_for_test(
        Command::new("git")
            .arg("-C")
            .arg(root)
            .arg("fetch")
            .arg("--depth")
            .arg("1")
            .arg("origin")
            .arg(baseline.revision),
        "fetch AgentModes compatibility baseline revision",
    );
    assert_git_status_for_test(
        Command::new("git")
            .arg("-C")
            .arg(root)
            .arg("checkout")
            .arg("--detach")
            .arg(baseline.revision),
        "checkout AgentModes compatibility baseline revision",
    );
}

fn assert_git_status_for_test(command: &mut Command, label: &str) {
    let status = command
        .status()
        .unwrap_or_else(|error| panic!("{label}: {error}"));
    assert!(status.success(), "{label} failed with status {status}");
}

fn current_agentmodes_revision(root: &Path) -> Option<String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .arg("rev-parse")
        .arg("HEAD")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn policy_artifact_category_count(
    artifacts: &[brownie_agentmodes::CompiledPolicyArtifact],
    category: &str,
) -> usize {
    artifacts
        .iter()
        .filter(|artifact| artifact.category == category)
        .count()
}

fn invoke_runtime_json(
    runtime: &Path,
    current_dir: &Path,
    request: &serde_json::Value,
    envs: &[(&str, &str)],
) -> serde_json::Value {
    let stdout = invoke_runtime_stdout(runtime, current_dir, request, envs);
    serde_json::from_str(
        stdout
            .lines()
            .find(|line| !line.trim().is_empty())
            .unwrap_or(""),
    )
    .expect("runtime json response")
}

fn invoke_runtime_stdout(
    runtime: &Path,
    current_dir: &Path,
    request: &serde_json::Value,
    envs: &[(&str, &str)],
) -> String {
    let mut child = Command::new(runtime)
        .current_dir(current_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env_remove("BROWNIE_WORKSPACE_ROOT")
        .env_remove("BROWNIE_RUNTIME_PATH")
        .envs(envs.iter().copied())
        .spawn()
        .expect("runtime should start");
    {
        let stdin = child.stdin.as_mut().expect("runtime stdin");
        writeln!(stdin, "{request}").expect("write runtime request");
    }
    let output = child.wait_with_output().expect("runtime output");
    assert!(
        output.status.success(),
        "runtime failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        output.stderr.is_empty(),
        "runtime stderr should stay empty: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).expect("runtime stdout utf8")
}

fn single_task_by_goal<'a>(tasks: &'a serde_json::Value, goal: &str) -> &'a serde_json::Value {
    let matches = tasks["result"]["tasks"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|task| task["goal"] == goal)
        .collect::<Vec<_>>();
    assert_eq!(
        matches.len(),
        1,
        "expected one task with goal {goal}, got {matches:?}"
    );
    matches[0]
}

fn verification_recovery_failure_fingerprint(
    source_task: &serde_json::Value,
    gate: &serde_json::Value,
) -> String {
    let bounded_cargo_diagnostics = gate
        .get("bounded_cargo_diagnostics")
        .cloned()
        .unwrap_or_else(|| serde_json::json!([]));
    let canonical = serde_json::json!({
        "version": "verification_recovery_failure_fingerprint_v1",
        "source_task_id": source_task["task_id"],
        "source_run_id": source_task["run_id"],
        "source_status": source_task["status"],
        "verification_completion_gate_status": gate["verification_completion_gate_status"],
        "required_verifier_count": gate["required_verifier_count"],
        "passed_verifier_count": gate["passed_verifier_count"],
        "failed_verifier_count": gate["failed_verifier_count"],
        "required_verifier_tool_ids": gate["required_verifier_tool_ids"],
        "passed_verifier_tool_ids": gate["passed_verifier_tool_ids"],
        "failed_verifier_tool_ids": gate["failed_verifier_tool_ids"],
        "failure_reasons": gate["failure_reasons"],
        "bounded_cargo_diagnostics": bounded_cargo_diagnostics,
        "next_action": gate["next_action"],
    });
    let digest = Sha256::digest(canonical.to_string().as_bytes());
    format!("sha256:{}", hex_lower(&digest))
}

fn hex_lower(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>()
}

fn build_real_runtime_binary() -> PathBuf {
    let _guard = RUNTIME_BUILD_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let brownie_path = Path::new(brownie());
    let binary_dir = brownie_path
        .parent()
        .expect("brownie binary should have parent");
    let target_debug_dir = if binary_dir.file_name().and_then(|name| name.to_str()) == Some("deps")
    {
        binary_dir
            .parent()
            .expect("target deps dir should have debug parent")
    } else {
        binary_dir
    };
    let target_root = target_debug_dir
        .parent()
        .expect("target debug dir should have target root");
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir
        .parent()
        .and_then(Path::parent)
        .expect("brownie-cli crate should live under crates/");
    let status = Command::new(env!("CARGO"))
        .args(["build", "-p", "brownie-runtime", "--bin", "brownie-runtime"])
        .current_dir(repo_root)
        .env("CARGO_TARGET_DIR", target_root)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .expect("cargo should build brownie-runtime");
    assert!(status.success());

    let candidate =
        target_debug_dir.join(format!("brownie-runtime{}", std::env::consts::EXE_SUFFIX));
    assert!(
        candidate.exists(),
        "brownie-runtime binary should exist after cargo build"
    );
    candidate
}
