//! Runtime tool abstraction crate.

use std::ffi::OsString;
use std::fs;
use std::io::Read;
#[cfg(unix)]
use std::os::unix::process::CommandExt;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::{bail, Context};
use brownie_agentmodes::{CompiledModePolicy, RuntimeAction, RuntimePermissionGate};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const WORKSPACE_READ_TOOL_ID: &str = "workspace.read";
pub const WORKSPACE_WRITE_TOOL_ID: &str = "workspace.write";
pub const SUBTASK_SPAWN_TOOL_ID: &str = "subtask.spawn";
pub const VERIFICATION_CARGO_FMT_CHECK_TOOL_ID: &str = "verification.cargo_fmt_check";
pub const VERIFICATION_CARGO_CHECK_TOOL_ID: &str = "verification.cargo_check";
pub const MAX_WORKSPACE_READ_BYTES: usize = 65_536;
pub const DEFAULT_VERIFICATION_TIMEOUT_MS: u64 = 30_000;
pub const MAX_VERIFICATION_CAPTURE_BYTES: usize = 65_536;
pub const MAX_BOUNDED_CARGO_DIAGNOSTICS: usize = 5;
const VERIFICATION_CAPTURE_JOIN_TIMEOUT_MS: u64 = 1_000;
const MAX_BOUNDED_CARGO_DIAGNOSTIC_PATH_CHARS: usize = 240;
const MAX_BOUNDED_CARGO_DIAGNOSTIC_CODE_CHARS: usize = 32;
pub const DEFAULT_MAX_WORKSPACE_WRITE_CONTENT_CHARS: usize = 20_000;
pub const MIN_WORKSPACE_WRITE_CONTENT_CHARS: usize = 100;
pub const MAX_WORKSPACE_WRITE_CONTENT_CHARS: usize = 200_000;
pub const DEFAULT_PROPOSAL_PREVIEW_CHARS: usize = 2_000;
pub const MAX_SUBTASK_SPAWN_GOAL_CHARS: usize = 1_000;
pub const MAX_SUBTASK_SPAWN_MODE_ID_CHARS: usize = 128;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolSideEffectLevel {
    ReadOnly,
    WorkspaceWrite,
    ProcessExec,
    NetworkAccess,
    ServiceControl,
    Destructive,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolDefinition {
    pub tool_id: String,
    pub display_name: String,
    pub description: String,
    pub required_action: RuntimeAction,
    pub input_schema: ToolInputSchema,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolInputSchema {
    pub fields: Vec<ToolInputField>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolInputField {
    pub name: String,
    pub required: bool,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolPlanItem {
    pub tool_id: String,
    pub reason: String,
    pub required_action: RuntimeAction,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolPlan {
    pub items: Vec<ToolPlanItem>,
}

pub struct BuiltinToolRegistry;

impl BuiltinToolRegistry {
    pub fn list() -> Vec<ToolDefinition> {
        vec![
            tool("workspace.read", "Workspace Read", "Dry-run definition for workspace read requests.", RuntimeAction::ReadWorkspace),
            tool("workspace.write", "Workspace Write", "Dry-run definition for workspace write requests; no writes are executed in Phase 1.6.", RuntimeAction::WriteWorkspace),
            verification_cargo_fmt_check_tool(),
            verification_cargo_check_tool(),
            tool("process.exec", "Process Exec", "Dry-run definition for process execution requests; no commands are executed in Phase 1.6.", RuntimeAction::ExecuteProcess),
            subtask_spawn_tool(),
            tool("network.access", "Network Access", "Dry-run definition for network access requests.", RuntimeAction::AccessNetwork),
            tool("service.control", "Service Control", "Dry-run definition for service control requests.", RuntimeAction::ControlService),
            tool("destructive.operation", "Destructive Operation", "Dry-run definition for destructive operation requests.", RuntimeAction::DestructiveOperation),
        ]
    }
    pub fn get(tool_id: &str) -> Option<ToolDefinition> {
        Self::list()
            .into_iter()
            .find(|tool| tool.tool_id == tool_id)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolExecutionRequest {
    pub tool_id: String,
    pub input: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolExecutionResult {
    pub tool_id: String,
    pub status: ToolExecutionStatus,
    pub output: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ToolExecutionStatus {
    Completed,
    Denied,
    Failed,
}

pub struct WorkspaceReadExecutor;

impl WorkspaceReadExecutor {
    pub fn read(
        workspace_root: &Path,
        relative_path: &str,
        max_bytes: usize,
    ) -> anyhow::Result<ToolExecutionResult> {
        match Self::try_read(workspace_root, relative_path, max_bytes) {
            Ok(result) => Ok(result),
            Err(error) => Ok(ToolExecutionResult {
                tool_id: WORKSPACE_READ_TOOL_ID.to_string(),
                status: ToolExecutionStatus::Failed,
                output: json!({ "reason": error.to_string() }),
            }),
        }
    }

    fn try_read(
        workspace_root: &Path,
        relative_path: &str,
        max_bytes: usize,
    ) -> anyhow::Result<ToolExecutionResult> {
        if relative_path.trim().is_empty() {
            bail!("path must not be empty");
        }
        let requested_path = Path::new(relative_path);
        if requested_path.is_absolute() {
            bail!("absolute paths are not allowed");
        }
        for component in requested_path.components() {
            match component {
                Component::ParentDir => bail!("path traversal is not allowed"),
                Component::Normal(name)
                    if is_blocked_component(name.to_string_lossy().as_ref()) =>
                {
                    bail!("reading protected workspace paths is not allowed")
                }
                Component::Prefix(_) | Component::RootDir => {
                    bail!("absolute paths are not allowed")
                }
                _ => {}
            }
        }

        let root = workspace_root.canonicalize().with_context(|| {
            format!(
                "failed to canonicalize workspace root {}",
                workspace_root.display()
            )
        })?;
        let target = root.join(requested_path);
        let canonical_target = target
            .canonicalize()
            .with_context(|| format!("failed to canonicalize {}", relative_path))?;
        if !canonical_target.starts_with(&root) {
            bail!("path escapes workspace root");
        }
        if canonical_target.is_dir() {
            bail!("directory reads are not supported in Phase 1.7");
        }

        let bytes = fs::read(&canonical_target)
            .with_context(|| format!("failed to read {}", relative_path))?;
        let truncated = bytes.len() > max_bytes;
        let read_len = bytes.len().min(max_bytes);
        let content = std::str::from_utf8(&bytes[..read_len])
            .context("workspace.read supports UTF-8 text files only")?
            .to_string();

        Ok(ToolExecutionResult {
            tool_id: WORKSPACE_READ_TOOL_ID.to_string(),
            status: ToolExecutionStatus::Completed,
            output: json!({
                "path": relative_path,
                "content": content,
                "truncated": truncated,
                "bytes_read": read_len,
            }),
        })
    }
}

fn is_blocked_component(component: &str) -> bool {
    matches!(component, ".git" | ".brownie" | "node_modules" | "target")
}

pub struct ToolExecutor;

impl ToolExecutor {
    pub fn execute_controlled(
        workspace_root: &Path,
        request: ToolExecutionRequest,
    ) -> anyhow::Result<ToolExecutionResult> {
        if BuiltinToolRegistry::get(&request.tool_id).is_none() {
            return Ok(ToolExecutionResult {
                tool_id: request.tool_id,
                status: ToolExecutionStatus::Failed,
                output: json!({ "reason": "Unknown tool id." }),
            });
        }
        match request.tool_id.as_str() {
            WORKSPACE_READ_TOOL_ID => {
                let Some(path) = request.input.get("path").and_then(Value::as_str) else {
                    return Ok(ToolExecutionResult {
                        tool_id: request.tool_id,
                        status: ToolExecutionStatus::Failed,
                        output: json!({ "reason": "workspace.read input.path must be a string." }),
                    });
                };
                WorkspaceReadExecutor::read(workspace_root, path, MAX_WORKSPACE_READ_BYTES)
            }
            VERIFICATION_CARGO_FMT_CHECK_TOOL_ID => {
                VerificationCommandExecutor::cargo_fmt_check(workspace_root, &request.input)
            }
            VERIFICATION_CARGO_CHECK_TOOL_ID => {
                VerificationCommandExecutor::cargo_check(workspace_root, &request.input)
            }
            _ => Ok(ToolExecutionResult {
                tool_id: request.tool_id,
                status: ToolExecutionStatus::Denied,
                output: json!({
                    "reason": "Tool execution is not enabled for this tool."
                }),
            }),
        }
    }

    pub fn execute_read_only(
        workspace_root: &Path,
        request: ToolExecutionRequest,
    ) -> anyhow::Result<ToolExecutionResult> {
        if BuiltinToolRegistry::get(&request.tool_id).is_none() {
            return Ok(ToolExecutionResult {
                tool_id: request.tool_id,
                status: ToolExecutionStatus::Failed,
                output: json!({ "reason": "Unknown tool id." }),
            });
        }
        if request.tool_id != WORKSPACE_READ_TOOL_ID {
            return Ok(ToolExecutionResult {
                tool_id: request.tool_id,
                status: ToolExecutionStatus::Denied,
                output: json!({
                    "reason": "Tool execution is not enabled for this tool in Phase 1.7."
                }),
            });
        }
        let Some(path) = request.input.get("path").and_then(Value::as_str) else {
            return Ok(ToolExecutionResult {
                tool_id: request.tool_id,
                status: ToolExecutionStatus::Failed,
                output: json!({ "reason": "workspace.read input.path must be a string." }),
            });
        };
        WorkspaceReadExecutor::read(workspace_root, path, MAX_WORKSPACE_READ_BYTES)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ProcessCapture {
    bytes: usize,
    truncated: bool,
    content: Vec<u8>,
}

impl ProcessCapture {
    fn empty() -> Self {
        Self {
            bytes: 0,
            truncated: false,
            content: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct VerificationSafetyMetadata {
    target_dir_isolated: Option<bool>,
    cleanup_succeeded: Option<bool>,
    cargo_dependency_fetch_offline: Option<bool>,
    os_network_isolated: Option<bool>,
    compile_time_code_sandboxed: Option<bool>,
    trusted_workspace_required: Option<bool>,
    process_tree_timeout_supported: Option<bool>,
    process_tree_kill_attempted: Option<bool>,
    process_tree_kill_succeeded: Option<bool>,
    process_tree_kill_reason: Option<&'static str>,
}

impl VerificationSafetyMetadata {
    fn with_target_dir_isolated(mut self, isolated: bool) -> Self {
        self.target_dir_isolated = Some(isolated);
        self
    }

    fn with_process_tree_not_timed_out(mut self) -> Self {
        self.process_tree_timeout_supported = Some(process_tree_timeout_supported());
        self.process_tree_kill_attempted = Some(false);
        self.process_tree_kill_succeeded = Some(false);
        self.process_tree_kill_reason = Some("not_timed_out");
        self
    }

    fn with_process_tree_kill(mut self, succeeded: bool, reason: &'static str) -> Self {
        self.process_tree_timeout_supported = Some(process_tree_timeout_supported());
        self.process_tree_kill_attempted = Some(true);
        self.process_tree_kill_succeeded = Some(succeeded);
        self.process_tree_kill_reason = Some(reason);
        self
    }
}

pub struct VerificationCommandExecutor;

impl VerificationCommandExecutor {
    pub fn cargo_fmt_check(
        workspace_root: &Path,
        input: &Value,
    ) -> anyhow::Result<ToolExecutionResult> {
        if let Err(reason) = preflight_verification_cargo_fmt_check_input(input) {
            return Ok(verification_result(
                VERIFICATION_CARGO_FMT_CHECK_TOOL_ID,
                "cargo_fmt_check",
                ToolExecutionStatus::Failed,
                "Rejected",
                false,
                None,
                false,
                0,
                ProcessCapture::empty(),
                ProcessCapture::empty(),
                Some(reason),
                VerificationSafetyMetadata::default(),
            ));
        }
        Self::run_fixed(
            workspace_root,
            VERIFICATION_CARGO_FMT_CHECK_TOOL_ID,
            "cargo_fmt_check",
            "cargo",
            &["fmt", "--check"],
            Duration::from_millis(DEFAULT_VERIFICATION_TIMEOUT_MS),
            None,
        )
    }

    pub fn cargo_check(
        workspace_root: &Path,
        input: &Value,
    ) -> anyhow::Result<ToolExecutionResult> {
        let safety = VerificationSafetyMetadata {
            target_dir_isolated: Some(true),
            cleanup_succeeded: None,
            cargo_dependency_fetch_offline: Some(true),
            os_network_isolated: Some(false),
            compile_time_code_sandboxed: Some(false),
            trusted_workspace_required: Some(true),
            ..VerificationSafetyMetadata::default()
        };
        if let Err(reason) = preflight_verification_cargo_check_input(input) {
            return Ok(verification_result(
                VERIFICATION_CARGO_CHECK_TOOL_ID,
                "cargo_check",
                ToolExecutionStatus::Failed,
                "Rejected",
                false,
                None,
                false,
                0,
                ProcessCapture::empty(),
                ProcessCapture::empty(),
                Some(reason),
                safety,
            ));
        }
        if let Err(reason) = preflight_cargo_check_workspace(workspace_root) {
            return Ok(verification_result(
                VERIFICATION_CARGO_CHECK_TOOL_ID,
                "cargo_check",
                ToolExecutionStatus::Failed,
                "Rejected",
                false,
                None,
                false,
                0,
                ProcessCapture::empty(),
                ProcessCapture::empty(),
                Some(reason),
                safety,
            ));
        }
        let target_dir = match prepare_isolated_cargo_target_dir(workspace_root) {
            Ok(path) => path,
            Err(reason) => {
                return Ok(verification_result(
                    VERIFICATION_CARGO_CHECK_TOOL_ID,
                    "cargo_check",
                    ToolExecutionStatus::Failed,
                    "SpawnFailed",
                    false,
                    None,
                    false,
                    0,
                    ProcessCapture::empty(),
                    ProcessCapture::empty(),
                    Some(reason),
                    safety.with_target_dir_isolated(false),
                ));
            }
        };
        let env_vars = minimal_cargo_check_env(&target_dir);
        let mut result = Self::run_fixed(
            workspace_root,
            VERIFICATION_CARGO_CHECK_TOOL_ID,
            "cargo_check",
            "cargo",
            &[
                "check",
                "--workspace",
                "--all-targets",
                "--locked",
                "--offline",
                "--message-format=json",
            ],
            Duration::from_millis(DEFAULT_VERIFICATION_TIMEOUT_MS),
            Some(env_vars),
        )?;
        let cleanup_succeeded = fs::remove_dir_all(&target_dir).is_ok() || !target_dir.exists();
        result.output["cleanup_succeeded"] = json!(cleanup_succeeded);
        Ok(result)
    }

    fn run_fixed(
        workspace_root: &Path,
        tool_id: &str,
        check_id: &str,
        program: &str,
        args: &[&str],
        timeout: Duration,
        env_vars: Option<Vec<(String, OsString)>>,
    ) -> anyhow::Result<ToolExecutionResult> {
        let Ok(root) = workspace_root.canonicalize() else {
            return Ok(verification_result(
                tool_id,
                check_id,
                ToolExecutionStatus::Failed,
                "SpawnFailed",
                false,
                None,
                false,
                0,
                ProcessCapture::empty(),
                ProcessCapture::empty(),
                Some("workspace root is unavailable."),
                verification_safety_metadata(check_id).with_process_tree_not_timed_out(),
            ));
        };
        let start = Instant::now();
        let mut command = Command::new(program);
        command
            .args(args)
            .current_dir(root)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        configure_process_tree_timeout(&mut command);
        if let Some(env_vars) = env_vars {
            command.env_clear();
            for (key, value) in env_vars {
                command.env(key, value);
            }
        }
        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(_) => {
                return Ok(verification_result(
                    tool_id,
                    check_id,
                    ToolExecutionStatus::Failed,
                    "SpawnFailed",
                    false,
                    None,
                    false,
                    0,
                    ProcessCapture::empty(),
                    ProcessCapture::empty(),
                    Some("failed to spawn verifier."),
                    verification_safety_metadata(check_id).with_process_tree_not_timed_out(),
                ));
            }
        };
        let stdout_handle = child.stdout.take().map(capture_pipe_async);
        let stderr_handle = child.stderr.take().map(capture_pipe_async);

        let mut timed_out = false;
        let mut timeout_kill_succeeded = false;
        let mut timeout_kill_reason = "not_timed_out";
        let exit_code = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status.code(),
                Ok(None) if start.elapsed() >= timeout => {
                    timed_out = true;
                    let (succeeded, reason) = terminate_process_tree(child.id());
                    timeout_kill_succeeded = succeeded;
                    timeout_kill_reason = reason;
                    if !succeeded {
                        let _ = child.kill();
                    }
                    let _ = child.wait();
                    break None;
                }
                Ok(None) => thread::sleep(Duration::from_millis(25)),
                Err(_) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    break None;
                }
            }
        };

        let stdout_capture = join_capture(stdout_handle);
        let stderr_capture = join_capture(stderr_handle);
        let duration_ms = start.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;

        if timed_out {
            return Ok(verification_result(
                tool_id,
                check_id,
                ToolExecutionStatus::Failed,
                "TimedOut",
                true,
                exit_code,
                true,
                duration_ms,
                stdout_capture,
                stderr_capture,
                Some("verifier timed out."),
                verification_safety_metadata(check_id)
                    .with_process_tree_kill(timeout_kill_succeeded, timeout_kill_reason),
            ));
        }
        match exit_code {
            Some(0) => Ok(verification_result(
                tool_id,
                check_id,
                ToolExecutionStatus::Completed,
                "Passed",
                true,
                Some(0),
                false,
                duration_ms,
                stdout_capture,
                stderr_capture,
                None,
                verification_safety_metadata(check_id).with_process_tree_not_timed_out(),
            )),
            _ => Ok(verification_result(
                tool_id,
                check_id,
                ToolExecutionStatus::Failed,
                "Failed",
                true,
                exit_code,
                false,
                duration_ms,
                stdout_capture,
                stderr_capture,
                Some("verifier exited with nonzero status."),
                verification_safety_metadata(check_id).with_process_tree_not_timed_out(),
            )),
        }
    }
}

struct ProcessCaptureHandle {
    receiver: mpsc::Receiver<ProcessCapture>,
}

fn capture_pipe_async<R>(reader: R) -> ProcessCaptureHandle
where
    R: Read + Send + 'static,
{
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let _ = sender.send(capture_pipe(reader));
    });
    ProcessCaptureHandle { receiver }
}

fn capture_pipe<R: Read>(mut reader: R) -> ProcessCapture {
    let mut total = 0usize;
    let mut truncated = false;
    let mut content = Vec::new();
    let mut buffer = [0u8; 8192];
    loop {
        let Ok(read) = reader.read(&mut buffer) else {
            break;
        };
        if read == 0 {
            break;
        }
        let remaining = MAX_VERIFICATION_CAPTURE_BYTES.saturating_sub(content.len());
        if remaining > 0 {
            let retained = remaining.min(read);
            content.extend_from_slice(&buffer[..retained]);
            if retained < read {
                truncated = true;
            }
        } else {
            truncated = true;
        }
        total = total.saturating_add(read);
        if total > MAX_VERIFICATION_CAPTURE_BYTES {
            truncated = true;
        }
    }
    ProcessCapture {
        bytes: total.min(MAX_VERIFICATION_CAPTURE_BYTES),
        truncated,
        content,
    }
}

fn join_capture(handle: Option<ProcessCaptureHandle>) -> ProcessCapture {
    handle
        .and_then(|handle| {
            handle
                .receiver
                .recv_timeout(Duration::from_millis(VERIFICATION_CAPTURE_JOIN_TIMEOUT_MS))
                .ok()
        })
        .unwrap_or_else(ProcessCapture::empty)
}

#[cfg(unix)]
fn configure_process_tree_timeout(command: &mut Command) {
    command.process_group(0);
}

#[cfg(not(unix))]
fn configure_process_tree_timeout(_command: &mut Command) {}

fn process_tree_timeout_supported() -> bool {
    cfg!(unix)
}

#[cfg(unix)]
fn terminate_process_tree(child_id: u32) -> (bool, &'static str) {
    const SIGKILL: i32 = 9;
    unsafe extern "C" {
        fn kill(pid: i32, sig: i32) -> i32;
    }

    let pgid = child_id as i32;
    let signaled = unsafe { kill(-pgid, SIGKILL) == 0 };
    if signaled {
        (true, "process_tree_kill_signaled")
    } else {
        (false, "process_tree_kill_failed")
    }
}

#[cfg(not(unix))]
fn terminate_process_tree(_child_id: u32) -> (bool, &'static str) {
    (false, "process_tree_timeout_unsupported")
}

fn verification_result(
    tool_id: &str,
    check_id: &str,
    status: ToolExecutionStatus,
    verification_status: &str,
    process_launched: bool,
    exit_code: Option<i32>,
    timed_out: bool,
    duration_ms: u64,
    stdout: ProcessCapture,
    stderr: ProcessCapture,
    reason: Option<&str>,
    safety: VerificationSafetyMetadata,
) -> ToolExecutionResult {
    let bounded_diagnostics = bounded_cargo_diagnostics(
        check_id,
        verification_status,
        stdout.truncated,
        &stdout.content,
    );
    let mut output = json!({
        "check_id": check_id,
        "verification_status": verification_status,
        "process_launched": process_launched,
        "exit_code": exit_code,
        "timed_out": timed_out,
        "duration_ms": duration_ms,
        "standard_output_bytes": stdout.bytes,
        "standard_error_bytes": stderr.bytes,
        "standard_output_truncated": stdout.truncated,
        "standard_error_truncated": stderr.truncated,
        "output_redacted": true,
    });
    if !bounded_diagnostics.is_empty() {
        output["bounded_cargo_diagnostics"] = json!(bounded_diagnostics);
    }
    if let Some(reason) = reason {
        output["reason"] = json!(reason);
    }
    if let Some(target_dir_isolated) = safety.target_dir_isolated {
        output["target_dir_isolated"] = json!(target_dir_isolated);
    }
    if let Some(cleanup_succeeded) = safety.cleanup_succeeded {
        output["cleanup_succeeded"] = json!(cleanup_succeeded);
    }
    if let Some(cargo_dependency_fetch_offline) = safety.cargo_dependency_fetch_offline {
        output["cargo_dependency_fetch_offline"] = json!(cargo_dependency_fetch_offline);
    }
    if let Some(os_network_isolated) = safety.os_network_isolated {
        output["os_network_isolated"] = json!(os_network_isolated);
    }
    if let Some(compile_time_code_sandboxed) = safety.compile_time_code_sandboxed {
        output["compile_time_code_sandboxed"] = json!(compile_time_code_sandboxed);
    }
    if let Some(trusted_workspace_required) = safety.trusted_workspace_required {
        output["trusted_workspace_required"] = json!(trusted_workspace_required);
    }
    if let Some(process_tree_timeout_supported) = safety.process_tree_timeout_supported {
        output["process_tree_timeout_supported"] = json!(process_tree_timeout_supported);
    }
    if let Some(process_tree_kill_attempted) = safety.process_tree_kill_attempted {
        output["process_tree_kill_attempted"] = json!(process_tree_kill_attempted);
    }
    if let Some(process_tree_kill_succeeded) = safety.process_tree_kill_succeeded {
        output["process_tree_kill_succeeded"] = json!(process_tree_kill_succeeded);
    }
    if let Some(process_tree_kill_reason) = safety.process_tree_kill_reason {
        output["process_tree_kill_reason"] = json!(process_tree_kill_reason);
    }
    ToolExecutionResult {
        tool_id: tool_id.to_string(),
        status,
        output,
    }
}

fn bounded_cargo_diagnostics(
    check_id: &str,
    verification_status: &str,
    output_truncated: bool,
    stdout: &[u8],
) -> Vec<Value> {
    if check_id != "cargo_check" || verification_status != "Failed" {
        return Vec::new();
    }
    let stdout = String::from_utf8_lossy(stdout);
    let mut diagnostics = Vec::new();
    for line in stdout.lines() {
        if diagnostics.len() >= MAX_BOUNDED_CARGO_DIAGNOSTICS {
            break;
        }
        let Ok(record) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if record.get("reason").and_then(Value::as_str) != Some("compiler-message") {
            continue;
        }
        let Some(message) = record.get("message") else {
            continue;
        };
        let Some((path, line, column)) = primary_cargo_diagnostic_location(message) else {
            continue;
        };
        let Some(severity) = sanitized_cargo_diagnostic_severity(message) else {
            continue;
        };
        let diagnostic_kind = match severity {
            "error" => "compile_error",
            "warning" => "compile_warning",
            _ => continue,
        };
        let mut diagnostic = json!({
            "tool_id": VERIFICATION_CARGO_CHECK_TOOL_ID,
            "check_id": "cargo_check",
            "diagnostic_kind": diagnostic_kind,
            "severity": severity,
            "workspace_relative_path": path,
            "line": line,
            "column": column,
            "truncated": output_truncated,
        });
        if let Some(code) = sanitized_cargo_diagnostic_code(message) {
            diagnostic["code"] = json!(code);
        }
        diagnostics.push(diagnostic);
    }
    diagnostics
}

fn primary_cargo_diagnostic_location(message: &Value) -> Option<(String, u64, u64)> {
    let spans = message.get("spans")?.as_array()?;
    let primary = spans
        .iter()
        .find(|span| span.get("is_primary").and_then(Value::as_bool) == Some(true))?;
    let path = primary
        .get("file_name")
        .and_then(Value::as_str)
        .and_then(sanitize_cargo_diagnostic_path)?;
    let line = primary.get("line_start").and_then(Value::as_u64)?;
    let column = primary.get("column_start").and_then(Value::as_u64)?;
    if line == 0 || column == 0 {
        return None;
    }
    Some((path, line, column))
}

fn sanitized_cargo_diagnostic_severity(message: &Value) -> Option<&'static str> {
    match message.get("level").and_then(Value::as_str)? {
        "error" => Some("error"),
        "warning" => Some("warning"),
        _ => None,
    }
}

fn sanitized_cargo_diagnostic_code(message: &Value) -> Option<String> {
    let code = message.get("code")?.get("code")?.as_str()?;
    if code.is_empty() || code.len() > MAX_BOUNDED_CARGO_DIAGNOSTIC_CODE_CHARS {
        return None;
    }
    if !code
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
    {
        return None;
    }
    Some(code.to_string())
}

fn sanitize_cargo_diagnostic_path(path: &str) -> Option<String> {
    if path.is_empty()
        || path.len() > MAX_BOUNDED_CARGO_DIAGNOSTIC_PATH_CHARS
        || path.contains('\0')
        || path.contains('\\')
    {
        return None;
    }
    let path = Path::new(path);
    if path.is_absolute() {
        return None;
    }
    let mut components = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(name) => {
                let name = name.to_string_lossy();
                if name.is_empty() || name == "." || name == ".." || is_blocked_component(&name) {
                    return None;
                }
                components.push(name.to_string());
            }
            Component::CurDir => {}
            Component::ParentDir | Component::Prefix(_) | Component::RootDir => return None,
        }
    }
    if components.is_empty() {
        return None;
    }
    Some(components.join("/"))
}

fn verification_safety_metadata(check_id: &str) -> VerificationSafetyMetadata {
    match check_id {
        "cargo_check" => VerificationSafetyMetadata {
            target_dir_isolated: Some(true),
            cleanup_succeeded: None,
            cargo_dependency_fetch_offline: Some(true),
            os_network_isolated: Some(false),
            compile_time_code_sandboxed: Some(false),
            trusted_workspace_required: Some(true),
            ..VerificationSafetyMetadata::default()
        },
        _ => VerificationSafetyMetadata::default(),
    }
}

fn minimal_cargo_check_env(target_dir: &Path) -> Vec<(String, OsString)> {
    let mut env_vars = Vec::new();
    for key in ["PATH", "HOME", "CARGO_HOME", "RUSTUP_HOME", "RUSTC"] {
        if let Some(value) = std::env::var_os(key) {
            env_vars.push((key.to_string(), value));
        }
    }
    env_vars.push(("CARGO_NET_OFFLINE".to_string(), OsString::from("true")));
    env_vars.push(("CARGO_TERM_COLOR".to_string(), OsString::from("never")));
    env_vars.push((
        "CARGO_TARGET_DIR".to_string(),
        target_dir.as_os_str().to_os_string(),
    ));
    env_vars
}

fn preflight_cargo_check_workspace(workspace_root: &Path) -> Result<(), &'static str> {
    if !workspace_root.join("Cargo.toml").is_file() {
        return Err("verification.cargo_check requires a workspace Cargo.toml.");
    }
    if !workspace_root.join("Cargo.lock").is_file() {
        return Err("verification.cargo_check requires an existing Cargo.lock.");
    }
    if workspace_contains_build_script(workspace_root) {
        return Err("verification.cargo_check does not support workspaces with build scripts in this phase.");
    }
    Ok(())
}

fn workspace_contains_build_script(workspace_root: &Path) -> bool {
    let mut stack = vec![workspace_root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name == "build.rs" {
                return true;
            }
            if is_blocked_component(name.as_ref()) {
                continue;
            }
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_dir() {
                stack.push(entry.path());
            }
        }
    }
    false
}

fn prepare_isolated_cargo_target_dir(workspace_root: &Path) -> Result<PathBuf, &'static str> {
    let root = workspace_root
        .canonicalize()
        .map_err(|_| "workspace root is unavailable.")?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let target_dir = std::env::temp_dir().join(format!(
        "brownie-cargo-check-target-{}-{nonce}",
        std::process::id()
    ));
    fs::create_dir(&target_dir)
        .map_err(|_| "failed to prepare isolated cargo target directory.")?;
    let canonical_target = target_dir
        .canonicalize()
        .map_err(|_| "failed to prepare isolated cargo target directory.")?;
    if canonical_target.starts_with(&root) {
        let _ = fs::remove_dir_all(&target_dir);
        return Err("isolated cargo target directory is unsafe.");
    }
    Ok(target_dir)
}

fn tool(
    tool_id: &str,
    display_name: &str,
    description: &str,
    required_action: RuntimeAction,
) -> ToolDefinition {
    ToolDefinition {
        tool_id: tool_id.to_string(),
        display_name: display_name.to_string(),
        description: description.to_string(),
        required_action,
        input_schema: ToolInputSchema { fields: Vec::new() },
    }
}

fn subtask_spawn_tool() -> ToolDefinition {
    ToolDefinition {
        tool_id: SUBTASK_SPAWN_TOOL_ID.to_string(),
        display_name: "Subtask Spawn".to_string(),
        description: "Request a bounded child-task materialization intent; parent execution only records/materializes controlled child state.".to_string(),
        required_action: RuntimeAction::SpawnSubtask,
        input_schema: ToolInputSchema {
            fields: vec![
                ToolInputField {
                    name: "goal".to_string(),
                    required: false,
                    description: "Optional bounded child task goal. Must be a non-empty string when provided.".to_string(),
                },
                ToolInputField {
                    name: "mode_id".to_string(),
                    required: false,
                    description: "Optional existing mode id for the child task. Must resolve before materialization.".to_string(),
                },
            ],
        },
    }
}

fn verification_cargo_fmt_check_tool() -> ToolDefinition {
    ToolDefinition {
        tool_id: VERIFICATION_CARGO_FMT_CHECK_TOOL_ID.to_string(),
        display_name: "Cargo Fmt Check".to_string(),
        description: "Controlled fixed verification command: cargo fmt --check. Callers cannot supply argv, cwd, environment, stdin, shell, or timeout.".to_string(),
        required_action: RuntimeAction::ExecuteProcess,
        input_schema: ToolInputSchema {
            fields: vec![ToolInputField {
                name: "check_id".to_string(),
                required: false,
                description: "Optional literal cargo_fmt_check identifier; arbitrary command fields are rejected.".to_string(),
            }],
        },
    }
}

fn verification_cargo_check_tool() -> ToolDefinition {
    ToolDefinition {
        tool_id: VERIFICATION_CARGO_CHECK_TOOL_ID.to_string(),
        display_name: "Cargo Check".to_string(),
        description: "Controlled fixed verification command: cargo check --workspace --all-targets --locked --offline --message-format=json with an isolated target directory. Callers cannot supply argv, cwd, environment, stdin, shell, or timeout.".to_string(),
        required_action: RuntimeAction::ExecuteProcess,
        input_schema: ToolInputSchema {
            fields: vec![ToolInputField {
                name: "check_id".to_string(),
                required: false,
                description: "Optional literal cargo_check identifier; arbitrary command fields are rejected.".to_string(),
            }],
        },
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolIntentParserConfig {
    pub max_blocks: usize,
    pub max_block_bytes: usize,
    pub max_tool_requests: usize,
    pub max_input_bytes: usize,
    pub max_reason_chars: usize,
    pub max_workspace_write_content_chars: usize,
}

impl Default for ToolIntentParserConfig {
    fn default() -> Self {
        Self {
            max_blocks: 1,
            max_block_bytes: 16_384,
            max_tool_requests: 8,
            max_input_bytes: 4_096,
            max_reason_chars: 1_000,
            max_workspace_write_content_chars: DEFAULT_MAX_WORKSPACE_WRITE_CONTENT_CHARS,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolIntentParserSummary {
    pub found_blocks: usize,
    pub accepted_blocks: usize,
    pub accepted_requests: usize,
    pub rejected_requests: usize,
    pub max_blocks: usize,
    pub max_block_bytes: usize,
    pub max_tool_requests: usize,
    pub max_input_bytes: usize,
    pub max_reason_chars: usize,
    pub max_workspace_write_content_chars: usize,
}

impl ToolIntentParserSummary {
    fn new(config: &ToolIntentParserConfig) -> Self {
        Self {
            found_blocks: 0,
            accepted_blocks: 0,
            accepted_requests: 0,
            rejected_requests: 0,
            max_blocks: config.max_blocks,
            max_block_bytes: config.max_block_bytes,
            max_tool_requests: config.max_tool_requests,
            max_input_bytes: config.max_input_bytes,
            max_reason_chars: config.max_reason_chars,
            max_workspace_write_content_chars: config.max_workspace_write_content_chars,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AssistantToolIntent {
    pub tool_requests: Vec<AssistantToolRequest>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AssistantToolRequest {
    pub tool_id: String,
    pub reason: String,
    #[serde(default = "empty_input_object")]
    pub input: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ParsedToolIntent {
    pub requests: Vec<AssistantToolRequest>,
    pub rejected: Vec<RejectedToolIntent>,
    pub summary: ToolIntentParserSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RejectedToolIntent {
    pub tool_id: Option<String>,
    pub reason: String,
    pub code: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchProposal {
    pub proposal_id: String,
    pub task_id: String,
    pub run_id: String,
    pub tool_id: String,
    pub path: String,
    pub operation: WorkspacePatchOperation,
    pub content_preview: String,
    pub content_chars: usize,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum WorkspacePatchOperation {
    ReplaceFile,
    CreateFile,
    DeleteFile,
}

impl WorkspacePatchOperation {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::ReplaceFile => "replace_file",
            Self::CreateFile => "create_file",
            Self::DeleteFile => "delete_file",
        }
    }
}

pub fn preflight_workspace_write_input(input: &Value) -> Result<(), &'static str> {
    preflight_workspace_write_input_with_limit(input, DEFAULT_MAX_WORKSPACE_WRITE_CONTENT_CHARS)
}

pub fn preflight_workspace_write_input_with_limit(
    input: &Value,
    max_content_chars: usize,
) -> Result<(), &'static str> {
    let max_content_chars = max_content_chars.clamp(
        MIN_WORKSPACE_WRITE_CONTENT_CHARS,
        MAX_WORKSPACE_WRITE_CONTENT_CHARS,
    );
    let Some(object) = input.as_object() else {
        return Err("workspace.write input must be an object.");
    };
    let Some(path) = object.get("path") else {
        return Err("workspace.write input.path is required.");
    };
    let Some(path) = path.as_str() else {
        return Err("workspace.write input.path must be a string.");
    };
    preflight_workspace_write_path(path)?;
    let Some(operation) = object.get("operation") else {
        return Err("workspace.write input.operation is required.");
    };
    let Some(operation) = operation.as_str() else {
        return Err("workspace.write input.operation must be a string.");
    };
    if operation != "replace_file" && operation != "create_file" && operation != "delete_file" {
        return Err(
            "workspace.write input.operation must be replace_file, create_file, or delete_file.",
        );
    }
    if operation == "delete_file" {
        if object.contains_key("content") {
            return Err("workspace.write input.content must be omitted for delete_file.");
        }
        return Ok(());
    }
    let Some(content) = object.get("content") else {
        return Err("workspace.write input.content is required.");
    };
    let Some(content) = content.as_str() else {
        return Err("workspace.write input.content must be a string.");
    };
    if content.chars().count() > max_content_chars {
        return Err("workspace.write input.content exceeds parser length limit.");
    }
    Ok(())
}

pub fn preflight_workspace_write_path(relative_path: &str) -> Result<(), &'static str> {
    if relative_path.trim().is_empty() {
        return Err("workspace.write input.path must not be empty.");
    }
    let requested_path = Path::new(relative_path);
    if requested_path.is_absolute() {
        return Err("workspace.write input.path must be workspace-relative.");
    }
    for component in requested_path.components() {
        match component {
            Component::ParentDir => {
                return Err("workspace.write input.path must not contain path traversal.")
            }
            Component::Normal(name) if is_blocked_component(name.to_string_lossy().as_ref()) => {
                return Err("workspace.write input.path targets a protected workspace path.")
            }
            Component::Prefix(_) | Component::RootDir => {
                return Err("workspace.write input.path must be workspace-relative.")
            }
            _ => {}
        }
    }
    Ok(())
}

pub fn preflight_subtask_spawn_input(input: &Value) -> Result<(), &'static str> {
    let Some(object) = input.as_object() else {
        return Err("subtask.spawn input must be an object.");
    };
    for key in object.keys() {
        if key != "goal" && key != "mode_id" {
            return Err("subtask.spawn input contains unsupported field.");
        }
    }
    if let Some(goal) = object.get("goal") {
        let Some(goal) = goal.as_str() else {
            return Err("subtask.spawn input.goal must be a string.");
        };
        if goal.split_whitespace().next().is_none() {
            return Err("subtask.spawn input.goal must not be empty.");
        }
        if goal.chars().count() > MAX_SUBTASK_SPAWN_GOAL_CHARS {
            return Err("subtask.spawn input.goal exceeds parser length limit.");
        }
    }
    if let Some(mode_id) = object.get("mode_id") {
        let Some(mode_id) = mode_id.as_str() else {
            return Err("subtask.spawn input.mode_id must be a string.");
        };
        let mode_id = mode_id.trim();
        if mode_id.is_empty() {
            return Err("subtask.spawn input.mode_id must not be empty.");
        }
        if mode_id.chars().count() > MAX_SUBTASK_SPAWN_MODE_ID_CHARS {
            return Err("subtask.spawn input.mode_id exceeds parser length limit.");
        }
        if !mode_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
        {
            return Err("subtask.spawn input.mode_id contains unsupported characters.");
        }
    }
    Ok(())
}

pub struct ToolIntentParser;

impl ToolIntentParser {
    pub fn config() -> ToolIntentParserConfig {
        ToolIntentParserConfig::default()
    }

    pub fn parse_assistant_content(content: &str) -> ParsedToolIntent {
        Self::parse_assistant_content_with_config(content, &Self::config())
    }

    pub fn parse_assistant_content_with_config(
        content: &str,
        config: &ToolIntentParserConfig,
    ) -> ParsedToolIntent {
        let mut summary = ToolIntentParserSummary::new(config);
        let blocks = extract_fenced_blocks(content);
        summary.found_blocks = blocks.len();
        let mut rejected = Vec::new();
        if blocks.is_empty() {
            if content.contains("```brownie-tool-intent") {
                rejected.push(rejection(
                    None,
                    "Missing closing brownie-tool-intent fence.",
                    "missing_closing_fence",
                ));
            }
            summary.rejected_requests = rejected.len();
            return ParsedToolIntent {
                requests: Vec::new(),
                rejected,
                summary,
            };
        }
        if blocks.len() > config.max_blocks {
            rejected.push(rejection(
                None,
                "Too many brownie-tool-intent blocks.",
                "too_many_blocks",
            ));
            summary.rejected_requests = rejected.len();
            return ParsedToolIntent {
                requests: Vec::new(),
                rejected,
                summary,
            };
        }
        let json_block = blocks[0];
        if json_block.len() > config.max_block_bytes {
            rejected.push(rejection(
                None,
                "brownie-tool-intent block exceeds parser size limit.",
                "block_too_large",
            ));
            summary.rejected_requests = rejected.len();
            return ParsedToolIntent {
                requests: Vec::new(),
                rejected,
                summary,
            };
        }
        summary.accepted_blocks = 1;
        let value: Value = match serde_json::from_str(json_block.trim()) {
            Ok(value) => value,
            Err(_) => {
                rejected.push(rejection(
                    None,
                    "Invalid brownie-tool-intent JSON.",
                    "malformed_json",
                ));
                summary.rejected_requests = rejected.len();
                return ParsedToolIntent {
                    requests: Vec::new(),
                    rejected,
                    summary,
                };
            }
        };
        let Some(object) = value.as_object() else {
            rejected.push(rejection(
                None,
                "brownie-tool-intent JSON must be an object.",
                "invalid_schema",
            ));
            summary.rejected_requests = rejected.len();
            return ParsedToolIntent {
                requests: Vec::new(),
                rejected,
                summary,
            };
        };
        if object.keys().any(|key| key != "tool_requests") {
            rejected.push(rejection(
                None,
                "Unknown top-level field in brownie-tool-intent JSON.",
                "unknown_field",
            ));
            summary.rejected_requests = rejected.len();
            return ParsedToolIntent {
                requests: Vec::new(),
                rejected,
                summary,
            };
        }
        let Some(items) = object.get("tool_requests").and_then(Value::as_array) else {
            rejected.push(rejection(
                None,
                "tool_requests must be an array.",
                "invalid_schema",
            ));
            summary.rejected_requests = rejected.len();
            return ParsedToolIntent {
                requests: Vec::new(),
                rejected,
                summary,
            };
        };
        if items.len() > config.max_tool_requests {
            rejected.push(rejection(
                None,
                "tool_requests exceeds parser count limit.",
                "too_many_requests",
            ));
            summary.rejected_requests = rejected.len();
            return ParsedToolIntent {
                requests: Vec::new(),
                rejected,
                summary,
            };
        }
        let mut requests = Vec::new();
        for item in items {
            let Some(obj) = item.as_object() else {
                rejected.push(rejection(
                    None,
                    "tool request must be an object.",
                    "invalid_schema",
                ));
                continue;
            };
            if obj
                .keys()
                .any(|key| !matches!(key.as_str(), "tool_id" | "reason" | "input"))
            {
                rejected.push(rejection(
                    None,
                    "Unknown field in tool request.",
                    "unknown_field",
                ));
                continue;
            }
            let tool_id = obj
                .get("tool_id")
                .and_then(Value::as_str)
                .map(str::to_string);
            let reason = obj
                .get("reason")
                .and_then(Value::as_str)
                .map(str::to_string);
            let Some(tool_id_value) = tool_id.clone() else {
                rejected.push(rejection(
                    None,
                    "tool_id must be a string.",
                    "invalid_schema",
                ));
                continue;
            };
            let Some(reason_value) = reason else {
                rejected.push(rejection(
                    Some(tool_id_value),
                    "reason must be a string.",
                    "invalid_schema",
                ));
                continue;
            };
            if reason_value.chars().count() > config.max_reason_chars {
                rejected.push(rejection(
                    Some(tool_id_value),
                    "reason exceeds parser length limit.",
                    "input_too_large",
                ));
                continue;
            }
            if BuiltinToolRegistry::get(&tool_id_value).is_none() {
                rejected.push(rejection(
                    Some(tool_id_value),
                    "Unknown tool id.",
                    "unknown_tool",
                ));
                continue;
            }
            let input = match obj.get("input") {
                Some(value) if value.is_object() => value.clone(),
                Some(_) => {
                    rejected.push(rejection(
                        Some(tool_id_value),
                        "input must be an object when provided.",
                        "invalid_input",
                    ));
                    continue;
                }
                None => empty_input_object(),
            };
            if input.to_string().len() > config.max_input_bytes {
                rejected.push(rejection(
                    Some(tool_id_value),
                    "input exceeds parser size limit.",
                    "input_too_large",
                ));
                continue;
            }
            if tool_id_value == WORKSPACE_READ_TOOL_ID {
                if let Err(reason) = preflight_workspace_read_input(&input) {
                    rejected.push(rejection(Some(tool_id_value), reason, "invalid_input"));
                    continue;
                }
            }
            if tool_id_value == WORKSPACE_WRITE_TOOL_ID {
                if let Err(reason) = preflight_workspace_write_input_with_limit(
                    &input,
                    config.max_workspace_write_content_chars,
                ) {
                    rejected.push(rejection(Some(tool_id_value), reason, "invalid_input"));
                    continue;
                }
            }
            if tool_id_value == SUBTASK_SPAWN_TOOL_ID {
                if let Err(reason) = preflight_subtask_spawn_input(&input) {
                    rejected.push(rejection(Some(tool_id_value), reason, "invalid_input"));
                    continue;
                }
            }
            if tool_id_value == VERIFICATION_CARGO_FMT_CHECK_TOOL_ID {
                if let Err(reason) = preflight_verification_cargo_fmt_check_input(&input) {
                    rejected.push(rejection(Some(tool_id_value), reason, "invalid_input"));
                    continue;
                }
            }
            if tool_id_value == VERIFICATION_CARGO_CHECK_TOOL_ID {
                if let Err(reason) = preflight_verification_cargo_check_input(&input) {
                    rejected.push(rejection(Some(tool_id_value), reason, "invalid_input"));
                    continue;
                }
            }
            requests.push(AssistantToolRequest {
                tool_id: tool_id_value,
                reason: reason_value,
                input,
            });
        }
        summary.accepted_requests = requests.len();
        summary.rejected_requests = rejected.len();
        ParsedToolIntent {
            requests,
            rejected,
            summary,
        }
    }
}

fn rejection(tool_id: Option<String>, reason: impl Into<String>, code: &str) -> RejectedToolIntent {
    RejectedToolIntent {
        tool_id,
        reason: reason.into(),
        code: code.to_string(),
    }
}

pub fn preflight_workspace_read_path(relative_path: &str) -> Result<(), &'static str> {
    if relative_path.trim().is_empty() {
        return Err("workspace.read input.path must not be empty.");
    }
    let requested_path = Path::new(relative_path);
    if requested_path.is_absolute() {
        return Err("workspace.read input.path must be workspace-relative.");
    }
    for component in requested_path.components() {
        match component {
            Component::ParentDir => {
                return Err("workspace.read input.path must not contain path traversal.")
            }
            Component::Normal(name) if is_blocked_component(name.to_string_lossy().as_ref()) => {
                return Err("workspace.read input.path targets a protected workspace path.")
            }
            Component::Prefix(_) | Component::RootDir => {
                return Err("workspace.read input.path must be workspace-relative.")
            }
            _ => {}
        }
    }
    Ok(())
}

fn preflight_workspace_read_input(input: &Value) -> Result<(), &'static str> {
    let Some(path) = input.get("path").and_then(Value::as_str) else {
        return Err("workspace.read input.path must be a string.");
    };
    preflight_workspace_read_path(path)
}

fn preflight_verification_cargo_fmt_check_input(input: &Value) -> Result<(), &'static str> {
    let Some(object) = input.as_object() else {
        return Err("verification.cargo_fmt_check input must be an object.");
    };
    for (key, value) in object {
        match key.as_str() {
            "check_id" => {
                if value.as_str() != Some("cargo_fmt_check") {
                    return Err("verification.cargo_fmt_check input.check_id must be cargo_fmt_check when provided.");
                }
            }
            "command" | "argv" | "args" | "cwd" | "env" | "stdin" | "shell" | "timeout"
            | "timeout_ms" => {
                return Err("verification.cargo_fmt_check does not accept command, argv, cwd, env, stdin, shell, or timeout input.");
            }
            _ => {
                return Err("verification.cargo_fmt_check does not accept unknown input fields.");
            }
        }
    }
    Ok(())
}

fn preflight_verification_cargo_check_input(input: &Value) -> Result<(), &'static str> {
    let Some(object) = input.as_object() else {
        return Err("verification.cargo_check input must be an object.");
    };
    for (key, value) in object {
        match key.as_str() {
            "check_id" => {
                if value.as_str() != Some("cargo_check") {
                    return Err("verification.cargo_check input.check_id must be cargo_check when provided.");
                }
            }
            "command" | "argv" | "args" | "cwd" | "env" | "stdin" | "shell" | "timeout"
            | "timeout_ms" | "package" | "packages" | "features" | "target" | "path" => {
                return Err("verification.cargo_check does not accept command, argv, cwd, env, stdin, shell, timeout, package, feature, target, or path input.");
            }
            _ => {
                return Err("verification.cargo_check does not accept unknown input fields.");
            }
        }
    }
    Ok(())
}

fn extract_fenced_blocks(content: &str) -> Vec<&str> {
    let marker = "```brownie-tool-intent";
    let mut blocks = Vec::new();
    let mut rest = content;
    while let Some(pos) = rest.find(marker) {
        let after = &rest[pos + marker.len()..];
        let after = after
            .strip_prefix('\r')
            .unwrap_or(after)
            .strip_prefix('\n')
            .unwrap_or(after);
        let Some(end) = after.find("```") else {
            break;
        };
        blocks.push(&after[..end]);
        rest = &after[end + 3..];
    }
    blocks
}

fn empty_input_object() -> serde_json::Value {
    serde_json::json!({})
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolIntentEvaluation {
    pub items: Vec<ToolIntentDecision>,
    pub rejected: Vec<RejectedToolIntent>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolIntentDecision {
    pub tool_id: String,
    pub required_action: RuntimeAction,
    pub allowed: bool,
    pub reason: String,
    pub request_reason: String,
    pub input: serde_json::Value,
}

pub struct ToolIntentEvaluator;

impl ToolIntentEvaluator {
    pub fn evaluate(policy: &CompiledModePolicy, parsed: ParsedToolIntent) -> ToolIntentEvaluation {
        let mut rejected = parsed.rejected;
        let mut items = Vec::new();
        for request in parsed.requests {
            let Some(definition) = BuiltinToolRegistry::get(&request.tool_id) else {
                rejected.push(RejectedToolIntent {
                    tool_id: Some(request.tool_id),
                    reason: "Unknown tool id.".to_string(),
                    code: "unknown_tool".to_string(),
                });
                continue;
            };
            let decision = RuntimePermissionGate::check(policy, definition.required_action.clone());
            items.push(ToolIntentDecision {
                tool_id: definition.tool_id,
                required_action: definition.required_action,
                allowed: decision.allowed,
                reason: decision.reason,
                request_reason: request.reason,
                input: request.input,
            });
        }
        ToolIntentEvaluation { items, rejected }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolPlanningInput {
    pub task_id: String,
    pub goal: String,
    pub mode_id: String,
}

pub struct ToolPlanner;
impl ToolPlanner {
    pub fn plan(input: ToolPlanningInput) -> ToolPlan {
        let mut items = vec![plan_item(
            "workspace.read",
            "Every task may need workspace context.",
        )];
        let goal = input.goal.to_lowercase();
        if contains_any(
            &goal,
            &[
                "write",
                "edit",
                "modify",
                "implement",
                "修正",
                "編集",
                "実装",
            ],
        ) {
            items.push(plan_item(
                "workspace.write",
                "Goal suggests implementation or editing work.",
            ));
        }
        if contains_any(
            &goal,
            &[
                "cargo check",
                "typecheck",
                "type-check",
                "type check",
                "compile",
                "compilation",
            ],
        ) {
            items.push(plan_item(
                VERIFICATION_CARGO_CHECK_TOOL_ID,
                "Goal suggests running the controlled cargo check verifier.",
            ));
        } else if contains_any(
            &goal,
            &["test", "check", "verify", "fmt", "format", "検証", "テスト"],
        ) {
            items.push(plan_item(
                VERIFICATION_CARGO_FMT_CHECK_TOOL_ID,
                "Goal suggests running the controlled format verifier.",
            ));
        }
        if input.mode_id == "orchestrator" {
            items.push(plan_item(
                "subtask.spawn",
                "Orchestrator mode may coordinate subtasks.",
            ));
        }
        ToolPlan { items }
    }
}

fn contains_any(haystack: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| haystack.contains(needle))
}
fn plan_item(tool_id: &str, reason: &str) -> ToolPlanItem {
    let definition = BuiltinToolRegistry::get(tool_id).expect("built-in tool exists");
    ToolPlanItem {
        tool_id: definition.tool_id,
        reason: reason.to_string(),
        required_action: definition.required_action,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolPlanEvaluation {
    pub items: Vec<ToolPlanDecision>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolPlanDecision {
    pub tool_id: String,
    pub required_action: RuntimeAction,
    pub allowed: bool,
    pub reason: String,
}
pub struct ToolPlanEvaluator;
impl ToolPlanEvaluator {
    pub fn evaluate(policy: &CompiledModePolicy, plan: ToolPlan) -> ToolPlanEvaluation {
        let items = plan
            .items
            .into_iter()
            .map(|item| {
                let decision = RuntimePermissionGate::check(policy, item.required_action.clone());
                ToolPlanDecision {
                    tool_id: item.tool_id,
                    required_action: item.required_action,
                    allowed: decision.allowed,
                    reason: decision.reason,
                }
            })
            .collect();
        ToolPlanEvaluation { items }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use brownie_agentmodes::BuiltinModeRegistry;
    #[test]
    fn builtin_tool_registry_lists_required_tools() {
        let ids: Vec<_> = BuiltinToolRegistry::list()
            .into_iter()
            .map(|tool| tool.tool_id)
            .collect();
        assert_eq!(
            ids,
            vec![
                "workspace.read",
                "workspace.write",
                "verification.cargo_fmt_check",
                "verification.cargo_check",
                "process.exec",
                "subtask.spawn",
                "network.access",
                "service.control",
                "destructive.operation"
            ]
        );
    }
    #[test]
    fn planner_includes_expected_items() {
        let plan = ToolPlanner::plan(ToolPlanningInput {
            task_id: "task_1".into(),
            goal: "Implement and test".into(),
            mode_id: "orchestrator".into(),
        });
        let ids: Vec<_> = plan
            .items
            .iter()
            .map(|item| item.tool_id.as_str())
            .collect();
        assert!(ids.contains(&"workspace.read"));
        assert!(ids.contains(&"workspace.write"));
        assert!(ids.contains(&"verification.cargo_fmt_check"));
        assert!(ids.contains(&"subtask.spawn"));
    }
    #[test]
    fn planner_routes_compile_goals_to_cargo_check_verifier() {
        let plan = ToolPlanner::plan(ToolPlanningInput {
            task_id: "task_1".into(),
            goal: "Compile and type-check the workspace".into(),
            mode_id: "verifier".into(),
        });
        let ids: Vec<_> = plan
            .items
            .iter()
            .map(|item| item.tool_id.as_str())
            .collect();
        assert!(ids.contains(&"verification.cargo_check"));
        assert!(!ids.contains(&"verification.cargo_fmt_check"));
    }
    #[test]
    fn evaluator_allows_and_denies_with_runtime_gate() {
        let policy = BuiltinModeRegistry::get("orchestrator").expect("policy");
        let plan = ToolPlanner::plan(ToolPlanningInput {
            task_id: "task_1".into(),
            goal: "Implement and test".into(),
            mode_id: "orchestrator".into(),
        });
        let evaluation = ToolPlanEvaluator::evaluate(&policy, plan);
        assert!(evaluation
            .items
            .iter()
            .any(|item| item.tool_id == "workspace.read" && item.allowed));
        assert!(evaluation
            .items
            .iter()
            .any(|item| item.tool_id == "workspace.write" && !item.allowed));
    }
    #[test]
    fn parser_parses_valid_fenced_json() {
        let parsed = ToolIntentParser::parse_assistant_content("x\n```brownie-tool-intent\n{\"tool_requests\":[{\"tool_id\":\"workspace.read\",\"reason\":\"Need context.\",\"input\":{\"path\":\"README.md\"}}]}\n```");
        assert_eq!(parsed.requests.len(), 1);
        assert!(parsed.rejected.is_empty());
    }
    #[test]
    fn parser_returns_empty_without_fence() {
        let parsed = ToolIntentParser::parse_assistant_content("none");
        assert!(parsed.requests.is_empty());
        assert!(parsed.rejected.is_empty());
    }
    #[test]
    fn parser_rejects_invalid_json_without_panic() {
        let parsed =
            ToolIntentParser::parse_assistant_content("```brownie-tool-intent\nnot-json\n```");
        assert!(parsed.requests.is_empty());
        assert_eq!(parsed.rejected.len(), 1);
    }

    #[test]
    fn parser_rejects_missing_closing_fence_and_path_traversal() {
        let missing = ToolIntentParser::parse_assistant_content("```brownie-tool-intent\n{}");
        assert_eq!(missing.rejected[0].code, "missing_closing_fence");

        let traversal = ToolIntentParser::parse_assistant_content("```brownie-tool-intent\n{\"tool_requests\":[{\"tool_id\":\"workspace.read\",\"reason\":\"Need context.\",\"input\":{\"path\":\"../secret.txt\"}}]}\n```");
        assert!(traversal.requests.is_empty());
        assert_eq!(traversal.rejected[0].code, "invalid_input");
    }

    #[test]
    fn parser_rejects_unknown_fields_and_oversized_blocks() {
        let unknown = ToolIntentParser::parse_assistant_content(
            "```brownie-tool-intent\n{\"tool_requests\":[],\"raw\":\"do not keep\"}\n```",
        );
        assert_eq!(unknown.rejected[0].code, "unknown_field");

        let config = ToolIntentParserConfig {
            max_block_bytes: 2,
            ..ToolIntentParserConfig::default()
        };
        let oversized = ToolIntentParser::parse_assistant_content_with_config(
            "```brownie-tool-intent\n{}\n```",
            &config,
        );
        assert_eq!(oversized.rejected[0].code, "block_too_large");
    }

    #[test]
    fn parser_rejects_unknown_tool_id() {
        let parsed = ToolIntentParser::parse_assistant_content("```brownie-tool-intent\n{\"tool_requests\":[{\"tool_id\":\"unknown.tool\",\"reason\":\"Need it.\"}]}\n```");
        assert!(parsed.requests.is_empty());
        assert_eq!(parsed.rejected[0].tool_id.as_deref(), Some("unknown.tool"));
    }

    #[test]
    fn parser_accepts_controlled_cargo_fmt_verification_intent() {
        let parsed = ToolIntentParser::parse_assistant_content("```brownie-tool-intent\n{\"tool_requests\":[{\"tool_id\":\"verification.cargo_fmt_check\",\"reason\":\"Verify formatting.\",\"input\":{\"check_id\":\"cargo_fmt_check\"}}]}\n```");
        assert_eq!(parsed.requests.len(), 1);
        assert!(parsed.rejected.is_empty());
        assert_eq!(
            parsed.requests[0].tool_id,
            VERIFICATION_CARGO_FMT_CHECK_TOOL_ID
        );
    }

    #[test]
    fn parser_accepts_controlled_cargo_check_verification_intent() {
        let parsed = ToolIntentParser::parse_assistant_content("```brownie-tool-intent\n{\"tool_requests\":[{\"tool_id\":\"verification.cargo_check\",\"reason\":\"Verify compilation.\",\"input\":{\"check_id\":\"cargo_check\"}}]}\n```");
        assert_eq!(parsed.requests.len(), 1);
        assert!(parsed.rejected.is_empty());
        assert_eq!(parsed.requests[0].tool_id, VERIFICATION_CARGO_CHECK_TOOL_ID);
    }

    #[test]
    fn parser_rejects_verification_command_overrides() {
        for input in [
            serde_json::json!({"command":"cargo test"}),
            serde_json::json!({"argv":["fmt","--check"]}),
            serde_json::json!({"cwd":"crates/brownie-runtime"}),
            serde_json::json!({"env":{"RUSTFLAGS":"-Awarnings"}}),
            serde_json::json!({"stdin":"raw"}),
            serde_json::json!({"timeout_ms":1}),
            serde_json::json!({"unknown":true}),
        ] {
            assert!(
                preflight_verification_cargo_fmt_check_input(&input).is_err(),
                "{input:?}"
            );
            assert!(
                preflight_verification_cargo_check_input(&input).is_err(),
                "{input:?}"
            );
        }
        for input in [
            serde_json::json!({"package":"brownie-tools"}),
            serde_json::json!({"features":["all"]}),
            serde_json::json!({"target":"x86_64-unknown-linux-gnu"}),
            serde_json::json!({"path":"crates/brownie-tools"}),
        ] {
            assert!(
                preflight_verification_cargo_check_input(&input).is_err(),
                "{input:?}"
            );
        }
    }

    #[test]
    fn parser_parses_input_object_and_rejects_missing_write_input() {
        let parsed = ToolIntentParser::parse_assistant_content("```brownie-tool-intent\n{\"tool_requests\":[{\"tool_id\":\"workspace.read\",\"reason\":\"Need context.\",\"input\":{\"path\":\"README.md\"}},{\"tool_id\":\"workspace.write\",\"reason\":\"Need edit.\"}]}\n```");
        assert_eq!(parsed.requests[0].input["path"], "README.md");
        assert_eq!(parsed.requests.len(), 1);
        assert_eq!(parsed.rejected[0].code, "invalid_input");
    }

    #[test]
    fn parser_rejects_non_object_input() {
        let parsed = ToolIntentParser::parse_assistant_content("```brownie-tool-intent\n{\"tool_requests\":[{\"tool_id\":\"workspace.read\",\"reason\":\"Need context.\",\"input\":\"README.md\"}]}\n```");
        assert!(parsed.requests.is_empty());
        assert_eq!(parsed.rejected.len(), 1);
    }

    #[test]
    fn intent_evaluator_allows_read_and_denies_write_for_orchestrator() {
        let policy = BuiltinModeRegistry::get("orchestrator").expect("policy");
        let parsed = ParsedToolIntent {
            requests: vec![
                AssistantToolRequest {
                    tool_id: "workspace.read".into(),
                    reason: "Read".into(),
                    input: serde_json::json!({"path":"README.md"}),
                },
                AssistantToolRequest {
                    tool_id: "workspace.write".into(),
                    reason: "Write".into(),
                    input: serde_json::json!({}),
                },
            ],
            rejected: vec![],
            summary: ToolIntentParserSummary::new(&ToolIntentParserConfig::default()),
        };
        let evaluation = ToolIntentEvaluator::evaluate(&policy, parsed);
        assert!(evaluation
            .items
            .iter()
            .any(|item| item.tool_id == "workspace.read" && item.allowed));
        assert!(evaluation
            .items
            .iter()
            .any(|item| item.tool_id == "workspace.write" && !item.allowed));
        let read = evaluation
            .items
            .iter()
            .find(|item| item.tool_id == "workspace.read")
            .expect("read decision");
        assert_eq!(read.input["path"], "README.md");
    }

    #[test]
    fn parser_accepts_valid_workspace_write_replace_file_intent() {
        let parsed = ToolIntentParser::parse_assistant_content("```brownie-tool-intent\n{\"tool_requests\":[{\"tool_id\":\"workspace.write\",\"reason\":\"Propose README update\",\"input\":{\"path\":\"README.md\",\"operation\":\"replace_file\",\"content\":\"new content\"}}]}\n```");
        assert_eq!(parsed.requests.len(), 1);
        assert!(parsed.rejected.is_empty());
    }

    #[test]
    fn parser_accepts_valid_workspace_write_create_file_intent() {
        let parsed = ToolIntentParser::parse_assistant_content("```brownie-tool-intent\n{\"tool_requests\":[{\"tool_id\":\"workspace.write\",\"reason\":\"Propose new note\",\"input\":{\"path\":\"notes/new.md\",\"operation\":\"create_file\",\"content\":\"new content\"}}]}\n```");
        assert_eq!(parsed.requests.len(), 1);
        assert!(parsed.rejected.is_empty());
    }

    #[test]
    fn parser_accepts_valid_workspace_write_delete_file_intent_without_content() {
        let parsed = ToolIntentParser::parse_assistant_content("```brownie-tool-intent\n{\"tool_requests\":[{\"tool_id\":\"workspace.write\",\"reason\":\"Remove obsolete note\",\"input\":{\"path\":\"notes/obsolete.md\",\"operation\":\"delete_file\"}}]}\n```");
        assert_eq!(parsed.requests.len(), 1);
        assert!(parsed.rejected.is_empty());
    }

    #[test]
    fn parser_rejects_invalid_workspace_write_inputs() {
        for (input, reason) in [
            (
                serde_json::json!({"operation":"replace_file","content":"x"}),
                "missing path",
            ),
            (
                serde_json::json!({"path":"/tmp/x","operation":"replace_file","content":"x"}),
                "absolute path",
            ),
            (
                serde_json::json!({"path":"../README.md","operation":"replace_file","content":"x"}),
                "parent traversal",
            ),
            (
                serde_json::json!({"path":".git/config","operation":"replace_file","content":"x"}),
                "protected component",
            ),
            (
                serde_json::json!({"path":"README.md","operation":"append","content":"x"}),
                "unsupported operation",
            ),
            (
                serde_json::json!({"path":"README.md","operation":"delete_file","content":"x"}),
                "delete with content",
            ),
        ] {
            assert!(preflight_workspace_write_input(&input).is_err(), "{reason}");
        }
    }

    #[test]
    fn parser_rejects_workspace_write_content_too_large() {
        let content = "x".repeat(101);
        let input =
            serde_json::json!({"path":"README.md","operation":"replace_file","content":content});
        assert!(preflight_workspace_write_input_with_limit(&input, 100).is_err());
    }

    #[test]
    fn parser_accepts_bounded_subtask_spawn_input() {
        let parsed = ToolIntentParser::parse_assistant_content("```brownie-tool-intent\n{\"tool_requests\":[{\"tool_id\":\"subtask.spawn\",\"reason\":\"Coordinate focused work.\",\"input\":{\"goal\":\"Check the parser boundary.\",\"mode_id\":\"implementer\"}},{\"tool_id\":\"subtask.spawn\",\"reason\":\"Use default child goal.\"}]}\n```");
        assert_eq!(parsed.requests.len(), 2);
        assert!(parsed.rejected.is_empty());
        assert_eq!(
            parsed.requests[0].input["goal"],
            "Check the parser boundary."
        );
        assert_eq!(parsed.requests[0].input["mode_id"], "implementer");
        assert_eq!(parsed.requests[1].input, serde_json::json!({}));
    }

    #[test]
    fn parser_rejects_invalid_subtask_spawn_inputs() {
        let oversized_goal = "x".repeat(MAX_SUBTASK_SPAWN_GOAL_CHARS + 1);
        for (input, reason) in [
            (serde_json::json!({"raw":"no"}), "unknown field"),
            (serde_json::json!({"goal":""}), "empty goal"),
            (serde_json::json!({"goal":123}), "non-string goal"),
            (serde_json::json!({"goal":oversized_goal}), "oversized goal"),
            (serde_json::json!({"mode_id":""}), "empty mode"),
            (serde_json::json!({"mode_id":123}), "non-string mode"),
            (serde_json::json!({"mode_id":"../mode"}), "unsafe mode"),
        ] {
            assert!(preflight_subtask_spawn_input(&input).is_err(), "{reason}");
        }
    }

    #[test]
    fn workspace_read_executor_reads_file() {
        let temp = tempfile::tempdir().expect("tempdir");
        std::fs::write(temp.path().join("README.md"), "hello brownie").expect("write");

        let result =
            WorkspaceReadExecutor::read(temp.path(), "README.md", MAX_WORKSPACE_READ_BYTES)
                .expect("read result");

        assert_eq!(result.status, ToolExecutionStatus::Completed);
        assert_eq!(result.output["content"], "hello brownie");
        assert_eq!(result.output["truncated"], false);
    }

    #[test]
    fn workspace_read_executor_rejects_absolute_paths() {
        let temp = tempfile::tempdir().expect("tempdir");
        let result =
            WorkspaceReadExecutor::read(temp.path(), "/etc/passwd", MAX_WORKSPACE_READ_BYTES)
                .expect("read result");
        assert_eq!(result.status, ToolExecutionStatus::Failed);
    }

    #[test]
    fn workspace_read_executor_rejects_path_traversal() {
        let temp = tempfile::tempdir().expect("tempdir");
        let result =
            WorkspaceReadExecutor::read(temp.path(), "../secret.txt", MAX_WORKSPACE_READ_BYTES)
                .expect("read result");
        assert_eq!(result.status, ToolExecutionStatus::Failed);
    }

    #[test]
    fn workspace_read_executor_rejects_protected_directories() {
        for dir in [".brownie", ".git", "node_modules", "target"] {
            let temp = tempfile::tempdir().expect("tempdir");
            std::fs::create_dir(temp.path().join(dir)).expect("mkdir");
            std::fs::write(temp.path().join(dir).join("file.txt"), "secret").expect("write");
            let result = WorkspaceReadExecutor::read(
                temp.path(),
                &format!("{dir}/file.txt"),
                MAX_WORKSPACE_READ_BYTES,
            )
            .expect("read result");
            assert_eq!(result.status, ToolExecutionStatus::Failed, "{dir}");
        }
    }

    #[test]
    fn workspace_read_executor_truncates_large_file() {
        let temp = tempfile::tempdir().expect("tempdir");
        std::fs::write(temp.path().join("large.log"), "abcdef").expect("write");
        let result = WorkspaceReadExecutor::read(temp.path(), "large.log", 3).expect("read result");
        assert_eq!(result.status, ToolExecutionStatus::Completed);
        assert_eq!(result.output["content"], "abc");
        assert_eq!(result.output["truncated"], true);
        assert_eq!(result.output["bytes_read"], 3);
    }

    #[test]
    fn workspace_read_executor_fails_invalid_utf8() {
        let temp = tempfile::tempdir().expect("tempdir");
        std::fs::write(temp.path().join("binary.bin"), [0xff, 0xfe, 0xfd]).expect("write");
        let result =
            WorkspaceReadExecutor::read(temp.path(), "binary.bin", MAX_WORKSPACE_READ_BYTES)
                .expect("read result");
        assert_eq!(result.status, ToolExecutionStatus::Failed);
    }

    #[test]
    fn tool_executor_denies_non_workspace_read_tools() {
        let temp = tempfile::tempdir().expect("tempdir");
        let result = ToolExecutor::execute_read_only(
            temp.path(),
            ToolExecutionRequest {
                tool_id: "workspace.write".into(),
                input: serde_json::json!({"path":"README.md"}),
            },
        )
        .expect("execute");
        assert_eq!(result.status, ToolExecutionStatus::Denied);
    }

    #[test]
    fn controlled_executor_denies_generic_process_exec() {
        let temp = tempfile::tempdir().expect("tempdir");
        let result = ToolExecutor::execute_controlled(
            temp.path(),
            ToolExecutionRequest {
                tool_id: "process.exec".into(),
                input: serde_json::json!({"command":"cargo fmt --check"}),
            },
        )
        .expect("execute");
        assert_eq!(result.status, ToolExecutionStatus::Denied);
        assert_eq!(result.tool_id, "process.exec");
    }

    #[test]
    fn verification_executor_rejects_caller_supplied_process_fields_without_launch() {
        let temp = tempfile::tempdir().expect("tempdir");
        let result = ToolExecutor::execute_controlled(
            temp.path(),
            ToolExecutionRequest {
                tool_id: VERIFICATION_CARGO_FMT_CHECK_TOOL_ID.into(),
                input: serde_json::json!({"command":"cargo test"}),
            },
        )
        .expect("execute");
        assert_eq!(result.status, ToolExecutionStatus::Failed);
        assert_eq!(result.output["verification_status"], "Rejected");
        assert_eq!(result.output["process_launched"], false);
        assert!(result.output.get("command").is_none());
        assert!(result.output.get("stdout").is_none());
        assert!(result.output.get("stderr").is_none());
    }

    #[test]
    fn verification_executor_reports_cargo_fmt_pass_without_raw_output() {
        let temp = tempfile::tempdir().expect("tempdir");
        std::fs::create_dir(temp.path().join("src")).expect("mkdir");
        std::fs::write(
            temp.path().join("Cargo.toml"),
            "[package]\nname = \"fmt_pass\"\nversion = \"0.1.0\"\nedition = \"2021\"\n",
        )
        .expect("manifest");
        std::fs::write(temp.path().join("src/lib.rs"), "pub fn ok() {}\n").expect("src");

        let result =
            VerificationCommandExecutor::cargo_fmt_check(temp.path(), &json!({})).expect("execute");

        assert_eq!(result.status, ToolExecutionStatus::Completed);
        assert_eq!(result.output["verification_status"], "Passed");
        assert_eq!(result.output["process_launched"], true);
        assert_eq!(result.output["output_redacted"], true);
        let serialized = result.output.to_string();
        assert!(!serialized.contains("pub fn"));
        assert!(!serialized.contains("stdout"));
        assert!(!serialized.contains("stderr"));
    }

    #[test]
    fn verification_executor_reports_cargo_fmt_failure_without_raw_output() {
        let temp = tempfile::tempdir().expect("tempdir");
        std::fs::create_dir(temp.path().join("src")).expect("mkdir");
        std::fs::write(
            temp.path().join("Cargo.toml"),
            "[package]\nname = \"fmt_fail\"\nversion = \"0.1.0\"\nedition = \"2021\"\n",
        )
        .expect("manifest");
        std::fs::write(temp.path().join("src/lib.rs"), "pub fn bad( )->i32{1}\n").expect("src");

        let result =
            VerificationCommandExecutor::cargo_fmt_check(temp.path(), &json!({})).expect("execute");

        assert_eq!(result.status, ToolExecutionStatus::Failed);
        assert_eq!(result.output["verification_status"], "Failed");
        assert_eq!(result.output["process_launched"], true);
        assert_eq!(result.output["output_redacted"], true);
        let serialized = result.output.to_string();
        assert!(!serialized.contains("pub fn"));
        assert!(!serialized.contains("bad"));
        assert!(!serialized.contains("stdout"));
        assert!(!serialized.contains("stderr"));
    }

    fn write_cargo_check_fixture(root: &Path, package_name: &str, source: &str) {
        std::fs::create_dir(root.join("src")).expect("mkdir");
        std::fs::write(
            root.join("Cargo.toml"),
            format!(
                "[package]\nname = \"{package_name}\"\nversion = \"0.1.0\"\nedition = \"2021\"\n"
            ),
        )
        .expect("manifest");
        std::fs::write(
            root.join("Cargo.lock"),
            format!(
                "# This file is automatically @generated by Cargo.\n# It is not intended for manual editing.\nversion = 4\n\n[[package]]\nname = \"{package_name}\"\nversion = \"0.1.0\"\n"
            ),
        )
        .expect("lock");
        std::fs::write(root.join("src/lib.rs"), source).expect("src");
    }

    fn assert_cargo_check_honest_safety_metadata(output: &Value) {
        assert_eq!(output["target_dir_isolated"], true);
        assert_eq!(output["cargo_dependency_fetch_offline"], true);
        assert_eq!(output["os_network_isolated"], false);
        assert_eq!(output["compile_time_code_sandboxed"], false);
        assert_eq!(output["trusted_workspace_required"], true);
        assert!(output.get("network_disabled").is_none());
    }

    fn assert_process_tree_timeout_not_attempted(output: &Value) {
        assert_eq!(output["process_tree_timeout_supported"], cfg!(unix));
        assert_eq!(output["process_tree_kill_attempted"], false);
        assert_eq!(output["process_tree_kill_succeeded"], false);
        assert_eq!(output["process_tree_kill_reason"], "not_timed_out");
    }

    #[test]
    fn verification_executor_reports_cargo_check_honest_safety_metadata() {
        let temp = tempfile::tempdir().expect("tempdir");
        write_cargo_check_fixture(temp.path(), "check_pass", "pub fn ok() -> i32 { 1 }\n");

        let result =
            VerificationCommandExecutor::cargo_check(temp.path(), &json!({})).expect("execute");

        assert_eq!(result.tool_id, VERIFICATION_CARGO_CHECK_TOOL_ID);
        assert_eq!(result.status, ToolExecutionStatus::Completed);
        assert_eq!(result.output["check_id"], "cargo_check");
        assert_eq!(result.output["verification_status"], "Passed");
        assert_eq!(result.output["process_launched"], true);
        assert_eq!(result.output["output_redacted"], true);
        assert_cargo_check_honest_safety_metadata(&result.output);
        assert_process_tree_timeout_not_attempted(&result.output);
        assert_eq!(result.output["cleanup_succeeded"], true);
        assert!(!temp.path().join("target").exists());
        let serialized = result.output.to_string();
        assert!(!serialized.contains("pub fn ok"));
        assert!(!serialized.contains("stdout"));
        assert!(!serialized.contains("stderr"));
        assert!(!serialized.contains("CARGO_TARGET_DIR"));
    }

    #[test]
    fn verification_executor_reports_cargo_check_failure_without_raw_output() {
        let temp = tempfile::tempdir().expect("tempdir");
        write_cargo_check_fixture(
            temp.path(),
            "check_fail",
            "pub fn bad() -> MissingType { 1 }\n",
        );

        let result =
            VerificationCommandExecutor::cargo_check(temp.path(), &json!({})).expect("execute");

        assert_eq!(result.status, ToolExecutionStatus::Failed);
        assert_eq!(result.output["verification_status"], "Failed");
        assert_eq!(result.output["process_launched"], true);
        assert_eq!(result.output["output_redacted"], true);
        let diagnostics = result.output["bounded_cargo_diagnostics"]
            .as_array()
            .expect("bounded cargo diagnostics");
        assert!(!diagnostics.is_empty());
        assert!(diagnostics.len() <= MAX_BOUNDED_CARGO_DIAGNOSTICS);
        assert_eq!(
            diagnostics[0]["tool_id"],
            json!(VERIFICATION_CARGO_CHECK_TOOL_ID)
        );
        assert_eq!(diagnostics[0]["check_id"], "cargo_check");
        assert_eq!(diagnostics[0]["severity"], "error");
        assert_eq!(diagnostics[0]["workspace_relative_path"], "src/lib.rs");
        assert_eq!(diagnostics[0]["line"], 1);
        assert!(diagnostics[0]["column"].as_u64().unwrap_or(0) > 0);
        assert!(diagnostics[0].get("message").is_none());
        assert!(diagnostics[0].get("rendered").is_none());
        assert_cargo_check_honest_safety_metadata(&result.output);
        assert_process_tree_timeout_not_attempted(&result.output);
        assert!(!temp.path().join("target").exists());
        let serialized = result.output.to_string();
        assert!(!serialized.contains("MissingType"));
        assert!(!serialized.contains("pub fn bad"));
        assert!(!serialized.contains("stdout"));
        assert!(!serialized.contains("stderr"));
    }

    #[test]
    fn verification_executor_rejects_cargo_check_without_lockfile_or_with_build_script() {
        let missing_lock = tempfile::tempdir().expect("tempdir");
        std::fs::create_dir(missing_lock.path().join("src")).expect("mkdir");
        std::fs::write(
            missing_lock.path().join("Cargo.toml"),
            "[package]\nname = \"missing_lock\"\nversion = \"0.1.0\"\nedition = \"2021\"\n",
        )
        .expect("manifest");
        std::fs::write(missing_lock.path().join("src/lib.rs"), "pub fn ok() {}\n").expect("src");
        let result = VerificationCommandExecutor::cargo_check(missing_lock.path(), &json!({}))
            .expect("execute");
        assert_eq!(result.status, ToolExecutionStatus::Failed);
        assert_eq!(result.output["verification_status"], "Rejected");
        assert_eq!(result.output["process_launched"], false);
        assert!(!missing_lock.path().join("target").exists());

        let build_script = tempfile::tempdir().expect("tempdir");
        write_cargo_check_fixture(build_script.path(), "build_script", "pub fn ok() {}\n");
        std::fs::write(build_script.path().join("build.rs"), "fn main() {}\n").expect("build rs");
        let result = VerificationCommandExecutor::cargo_check(build_script.path(), &json!({}))
            .expect("execute");
        assert_eq!(result.status, ToolExecutionStatus::Failed);
        assert_eq!(result.output["verification_status"], "Rejected");
        assert_eq!(result.output["process_launched"], false);
    }

    #[test]
    fn verification_executor_reports_spawn_failure_and_timeout_as_bounded_results() {
        let temp = tempfile::tempdir().expect("tempdir");
        let spawn_failed = VerificationCommandExecutor::run_fixed(
            temp.path(),
            VERIFICATION_CARGO_FMT_CHECK_TOOL_ID,
            "cargo_fmt_check",
            "__brownie_missing_verifier_binary__",
            &[],
            Duration::from_millis(1),
            None,
        )
        .expect("spawn failure result");
        assert_eq!(spawn_failed.status, ToolExecutionStatus::Failed);
        assert_eq!(spawn_failed.output["verification_status"], "SpawnFailed");
        assert_eq!(spawn_failed.output["process_launched"], false);

        let timed_out = VerificationCommandExecutor::run_fixed(
            temp.path(),
            VERIFICATION_CARGO_FMT_CHECK_TOOL_ID,
            "cargo_fmt_check",
            "sleep",
            &["2"],
            Duration::from_millis(10),
            None,
        )
        .expect("timeout result");
        assert_eq!(timed_out.status, ToolExecutionStatus::Failed);
        assert_eq!(timed_out.output["verification_status"], "TimedOut");
        assert_eq!(timed_out.output["timed_out"], true);
        assert_eq!(
            timed_out.output["process_tree_timeout_supported"],
            cfg!(unix)
        );
        assert_eq!(timed_out.output["process_tree_kill_attempted"], true);
        assert_eq!(timed_out.output["process_tree_kill_succeeded"], cfg!(unix));
        if cfg!(unix) {
            assert_eq!(
                timed_out.output["process_tree_kill_reason"],
                "process_tree_kill_signaled"
            );
        } else {
            assert_eq!(
                timed_out.output["process_tree_kill_reason"],
                "process_tree_timeout_unsupported"
            );
        }
        assert_eq!(timed_out.output["output_redacted"], true);
    }

    #[cfg(unix)]
    #[test]
    fn verification_executor_timeout_attempts_process_tree_termination() {
        let temp = tempfile::tempdir().expect("tempdir");
        let start = Instant::now();
        let timed_out = VerificationCommandExecutor::run_fixed(
            temp.path(),
            VERIFICATION_CARGO_FMT_CHECK_TOOL_ID,
            "cargo_fmt_check",
            "sh",
            &["-c", "sleep 2 & wait"],
            Duration::from_millis(20),
            None,
        )
        .expect("timeout result");

        assert!(start.elapsed() < Duration::from_millis(1_500));
        assert_eq!(timed_out.status, ToolExecutionStatus::Failed);
        assert_eq!(timed_out.output["verification_status"], "TimedOut");
        assert_eq!(timed_out.output["process_tree_timeout_supported"], true);
        assert_eq!(timed_out.output["process_tree_kill_attempted"], true);
        assert_eq!(timed_out.output["process_tree_kill_succeeded"], true);
        assert_eq!(
            timed_out.output["process_tree_kill_reason"],
            "process_tree_kill_signaled"
        );
        let serialized = timed_out.output.to_string();
        assert!(!serialized.contains("stdout"));
        assert!(!serialized.contains("stderr"));
        assert!(!serialized.contains("sh"));
        assert!(!serialized.contains("sleep"));
    }
}
