use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

static RUNTIME_BUILD_COUNTER: AtomicUsize = AtomicUsize::new(0);
static RUNTIME_BUILD_LOCK: Mutex<()> = Mutex::new(());
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
        .env(
            "BROWNIE_RUNTIME_TIMEOUT_MS",
            READ_ONLY_FAKE_RUNTIME_TIMEOUT_MS,
        )
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
    assert!(stdout.contains("\"ok\":true"));
    assert!(stdout.contains("\"run_inspect\""));
    assert!(stdout.contains("\"run_id\":\"run-1\""));
    assert!(!stdout.contains("BROWNIE_RUNTIME_PATH"));

    let request = fs::read_to_string(capture).unwrap();
    let request: serde_json::Value = serde_json::from_str(&request).unwrap();
    assert_eq!(request["method"], "run.inspect");
    assert_eq!(request["params"], serde_json::json!({ "run_id": "run-1" }));
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
    assert!(request.get("params").is_none());
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
    assert_eq!(request["params"]["max_advances"], 1);
    assert_eq!(request["params"]["max_steps_per_advance"], 1);
    assert_eq!(
        request["params"]["context_budget"],
        serde_json::json!({
            "max_prompt_chars": 4096,
            "max_ledger_events": 16,
            "max_selected_index_chars": 0
        })
    );
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
    let runtime = fake_runtime(
        "json-run",
        r#"{"jsonrpc":"2.0","id":1,"result":{"status":"task_executed","session_id":"cli.run.json","drive_id":"cli.run.json.drive","stop_reason":"budget_exhausted","completion_closure":{"status":"budget_exhausted"},"next_action":"inspect_progress_overview","journey":{"journey_id":"cli.run.json.journey","task_id":"task-json","run_id":"run-json"},"terminal_completion_evidence":{"completion_result_fingerprint":"sha256:6666666666666666666666666666666666666666666666666666666666666666","completion_summary_preview":"json completed"}}}"#,
    );

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
    assert!(payload["run"].get("advances").is_none());
    assert!(!stdout.contains("secret-path"));
    assert!(!stdout.contains("BROWNIE_RUNTIME_PATH"));
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
        r#"{"jsonrpc":"2.0","id":1,"result":{"status":"task_executed","session_id":"cli.run.invalid","drive_id":"cli.run.invalid.drive","next_action":"inspect_progress_overview"}}"#,
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
            r#"{"jsonrpc":"2.0","id":1,"result":{"status":"task_executed","decision_id":"decision-1","continuation_id":"cli.resume.replayed","selected_task_id":"task-1","selected_run_id":"run-1","candidate_count":1,"expected_progress_fingerprint":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","expected_aggregate_sequence":7,"current_progress_fingerprint":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","current_aggregate_sequence":7,"post_progress_fingerprint":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","post_aggregate_sequence":8,"stale":false,"replayed":false,"task_run_result":null,"proposal_apply_result":null,"next_route":null,"next_action":"inspect_progress_overview"}}"#,
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
    assert!(requests[0].get("params").is_none());
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
        requests[1]["params"]["context_budget"],
        serde_json::json!({
            "max_prompt_chars": 4096,
            "max_ledger_events": 16,
            "max_selected_index_chars": 0
        })
    );
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
        .env("BROWNIE_RUNTIME_PATH_SHOULD_NOT_LEAK", "secret-path")
        .output()
        .unwrap();

    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    let payload: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    assert_eq!(payload["ok"], true);
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
    assert!(payload["resume"].get("next_route").is_none());
    assert!(payload["resume"].get("task_run_result").is_none());
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

#[test]
fn list_tasks_can_invoke_real_runtime_binary_when_available() {
    let runtime = build_real_runtime_binary();

    let output = Command::new(brownie())
        .args(["list", "tasks"])
        .env("BROWNIE_RUNTIME_PATH", runtime)
        .output()
        .unwrap();

    assert!(output.status.success());
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("tasks "));
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
        .output()
        .unwrap();

    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("run cli.run."));
    assert!(stdout.contains("status: task_executed"));
    assert!(stdout.contains("journey: cli.run."));
    assert!(stdout.contains("task: task_"));
    assert!(stdout.contains("runtime_run: run_"));
    assert!(stdout.contains("next: inspect_progress_overview"));
    assert!(!stdout.contains(workspace.to_string_lossy().as_ref()));
    assert!(!stdout.contains("BROWNIE_WORKSPACE_ROOT"));
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
