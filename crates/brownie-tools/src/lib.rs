//! Runtime tool abstraction crate.

#[cfg(test)]
use std::cell::RefCell;
use std::collections::BTreeSet;
use std::ffi::OsString;
use std::fs;
use std::io::{Read, Write};
#[cfg(unix)]
use std::os::unix::process::CommandExt;
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::{bail, Context};
use brownie_agentmodes::{CompiledModePolicy, RuntimeAction, RuntimePermissionGate};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

pub const WORKSPACE_READ_TOOL_ID: &str = "workspace.read";
pub const CODEBASE_INDEX_SELECTION_READ_TOOL_ID: &str = "codebase.index.selection.read";
pub const WORKSPACE_WRITE_TOOL_ID: &str = "workspace.write";
pub const SUBTASK_SPAWN_TOOL_ID: &str = "subtask.spawn";
pub const VERIFICATION_CARGO_FMT_CHECK_TOOL_ID: &str = "verification.cargo_fmt_check";
pub const VERIFICATION_CARGO_CHECK_TOOL_ID: &str = "verification.cargo_check";
pub const VERIFICATION_CARGO_TEST_TOOL_ID: &str = "verification.cargo_test";
pub const GIT_STATUS_TOOL_ID: &str = "git.status";
pub const GIT_DIFF_TOOL_ID: &str = "git.diff";
pub const GIT_COMMIT_TOOL_ID: &str = "git.commit";
pub const PROCESS_EXEC_TOOL_ID: &str = "process.exec";
pub const TIME_NOW_TOOL_ID: &str = "time.now";
pub const RUNTIME_SLEEP_TOOL_ID: &str = "runtime.sleep";
pub const WORKSPACE_APPEND_LINE_TOOL_ID: &str = "workspace.append_line";
pub const MAX_WORKSPACE_READ_BYTES: usize = 65_536;
pub const DEFAULT_VERIFICATION_TIMEOUT_MS: u64 = 30_000;
pub const MAX_VERIFICATION_CAPTURE_BYTES: usize = 65_536;
pub const MAX_GIT_CAPTURE_BYTES: usize = 32_768;
pub const MAX_GIT_SUMMARY_LINES: usize = 40;
pub const MAX_GIT_SUMMARY_LINE_CHARS: usize = 240;
pub const DEFAULT_GIT_TIMEOUT_MS: u64 = 5_000;
pub const MAX_GIT_COMMIT_MESSAGE_CHARS: usize = 2_000;
const MAX_GIT_COMMIT_AUTHORIZED_PATHS: usize = 64;
const MAX_GIT_COMMIT_AUTH_ID_CHARS: usize = 128;
const GIT_COMMIT_AUTHORIZATION_VERSION: &str = "brownie_git_commit_authorization_v1";
const BROWNIE_COMMIT_INTENT_TRAILER: &str = "Brownie-Commit-Intent";
pub const MAX_BOUNDED_CARGO_DIAGNOSTICS: usize = 5;
const VERIFICATION_CAPTURE_JOIN_TIMEOUT_MS: u64 = 1_000;
const GIT_CAPTURE_JOIN_TIMEOUT_MS: u64 = 1_000;
const MAX_BOUNDED_CARGO_DIAGNOSTIC_PATH_CHARS: usize = 240;
const MAX_BOUNDED_CARGO_DIAGNOSTIC_CODE_CHARS: usize = 32;
pub const DEFAULT_MAX_WORKSPACE_WRITE_CONTENT_CHARS: usize = 20_000;

#[cfg(test)]
thread_local! {
    static TEST_GIT_PROGRAM_OVERRIDE: RefCell<Option<OsString>> = const { RefCell::new(None) };
    static TEST_GIT_TIMEOUT_OVERRIDE: RefCell<Option<Duration>> = const { RefCell::new(None) };
}
pub const MIN_WORKSPACE_WRITE_CONTENT_CHARS: usize = 100;
pub const MAX_WORKSPACE_WRITE_CONTENT_CHARS: usize = 200_000;
pub const DEFAULT_PROPOSAL_PREVIEW_CHARS: usize = 2_000;
pub const MAX_SUBTASK_SPAWN_GOAL_CHARS: usize = 1_000;
pub const MAX_SUBTASK_SPAWN_MODE_ID_CHARS: usize = 128;
pub const MAX_WORKSPACE_APPEND_LINE_CHARS: usize = 4_096;
pub const MAX_RUNTIME_SLEEP_MS: u64 = 120_000;
const AGENTMODES_NEW_TASK_ALIAS_TOOL_ID: &str = "new_task";

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
            tool("codebase.index.selection.read", "Codebase Index Selection Read", "Controlled workspace read for one runtime-validated codebase index selection handle.", RuntimeAction::ReadWorkspace),
            tool("workspace.write", "Workspace Write", "Dry-run definition for workspace write requests; no writes are executed in Phase 1.6.", RuntimeAction::WriteWorkspace),
            verification_cargo_fmt_check_tool(),
            verification_cargo_check_tool(),
            verification_cargo_test_tool(),
            git_status_tool(),
            git_diff_tool(),
            git_commit_tool(),
            time_now_tool(),
            runtime_sleep_tool(),
            workspace_append_line_tool(),
            tool(PROCESS_EXEC_TOOL_ID, "Process Exec", "Dry-run definition for process execution requests; no commands are executed in Phase 1.6.", RuntimeAction::ExecuteProcess),
            subtask_spawn_tool(),
            tool("network.access", "Network Access", "Dry-run definition for network access requests.", RuntimeAction::AccessNetwork),
            tool("llm.provider.access", "LLM Provider Access", "Dry-run definition for configured LLM provider access requests.", RuntimeAction::AccessLlmProvider),
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
        let target_metadata = fs::symlink_metadata(&target)
            .with_context(|| format!("failed to inspect {}", relative_path))?;
        if target_metadata.file_type().is_symlink() {
            bail!("symlink reads are not supported");
        }
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
            CODEBASE_INDEX_SELECTION_READ_TOOL_ID => Ok(ToolExecutionResult {
                tool_id: request.tool_id,
                status: ToolExecutionStatus::Denied,
                output: json!({
                    "reason": "codebase.index.selection.read is executed by the Brownie runtime after index provenance validation."
                }),
            }),
            VERIFICATION_CARGO_FMT_CHECK_TOOL_ID => {
                VerificationCommandExecutor::cargo_fmt_check(workspace_root, &request.input)
            }
            VERIFICATION_CARGO_CHECK_TOOL_ID => {
                VerificationCommandExecutor::cargo_check(workspace_root, &request.input)
            }
            VERIFICATION_CARGO_TEST_TOOL_ID => {
                VerificationCommandExecutor::cargo_test(workspace_root, &request.input)
            }
            GIT_STATUS_TOOL_ID => GitCommandExecutor::status(workspace_root, &request.input),
            GIT_DIFF_TOOL_ID => GitCommandExecutor::diff_summary(workspace_root, &request.input),
            GIT_COMMIT_TOOL_ID => GitCommandExecutor::commit(workspace_root, &request.input),
            TIME_NOW_TOOL_ID => BoundedRuntimeToolExecutor::time_now(&request.input),
            RUNTIME_SLEEP_TOOL_ID => BoundedRuntimeToolExecutor::sleep(&request.input),
            WORKSPACE_APPEND_LINE_TOOL_ID => {
                BoundedRuntimeToolExecutor::append_line(workspace_root, &request.input)
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

pub struct BoundedRuntimeToolExecutor;

impl BoundedRuntimeToolExecutor {
    fn time_now(input: &Value) -> anyhow::Result<ToolExecutionResult> {
        if let Err(reason) = preflight_time_now_input(input) {
            return Ok(ToolExecutionResult {
                tool_id: TIME_NOW_TOOL_ID.to_string(),
                status: ToolExecutionStatus::Failed,
                output: json!({ "reason": reason }),
            });
        }
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .context("system clock is before unix epoch")?
            .as_millis();
        Ok(ToolExecutionResult {
            tool_id: TIME_NOW_TOOL_ID.to_string(),
            status: ToolExecutionStatus::Completed,
            output: json!({
                "unix_epoch_ms": now_ms,
            }),
        })
    }

    fn sleep(input: &Value) -> anyhow::Result<ToolExecutionResult> {
        let duration_ms = match preflight_runtime_sleep_input(input) {
            Ok(duration_ms) => duration_ms,
            Err(reason) => {
                return Ok(ToolExecutionResult {
                    tool_id: RUNTIME_SLEEP_TOOL_ID.to_string(),
                    status: ToolExecutionStatus::Failed,
                    output: json!({ "reason": reason }),
                })
            }
        };
        thread::sleep(Duration::from_millis(duration_ms));
        Ok(ToolExecutionResult {
            tool_id: RUNTIME_SLEEP_TOOL_ID.to_string(),
            status: ToolExecutionStatus::Completed,
            output: json!({
                "slept_ms": duration_ms,
            }),
        })
    }

    fn append_line(workspace_root: &Path, input: &Value) -> anyhow::Result<ToolExecutionResult> {
        let (relative_path, line) = match preflight_workspace_append_line_input(input) {
            Ok(value) => value,
            Err(reason) => {
                return Ok(ToolExecutionResult {
                    tool_id: WORKSPACE_APPEND_LINE_TOOL_ID.to_string(),
                    status: ToolExecutionStatus::Failed,
                    output: json!({ "reason": reason }),
                })
            }
        };
        let line = match line {
            WorkspaceAppendLine::Literal(line) => line.to_string(),
            WorkspaceAppendLine::CurrentUnixEpochMs => SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .context("system clock is before unix epoch")?
                .as_millis()
                .to_string(),
        };
        let root = workspace_root.canonicalize().with_context(|| {
            format!(
                "failed to canonicalize workspace root {}",
                workspace_root.display()
            )
        })?;
        let target = root.join(Path::new(relative_path));
        let parent = target
            .parent()
            .context("workspace.append_line target must have a parent")?;
        let canonical_parent = parent
            .canonicalize()
            .with_context(|| format!("failed to inspect parent for {relative_path}"))?;
        if !canonical_parent.starts_with(&root) {
            bail!("path escapes workspace root");
        }
        if let Ok(metadata) = fs::symlink_metadata(&target) {
            if metadata.file_type().is_symlink() {
                bail!("symlink writes are not supported");
            }
            if metadata.is_dir() {
                bail!("directory writes are not supported");
            }
        }
        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&target)
            .with_context(|| format!("failed to open append target {relative_path}"))?;
        file.write_all(line.as_bytes())
            .with_context(|| format!("failed to append line to {relative_path}"))?;
        file.write_all(b"\n")
            .with_context(|| format!("failed to append newline to {relative_path}"))?;
        file.sync_all()
            .with_context(|| format!("failed to sync append target {relative_path}"))?;
        Ok(ToolExecutionResult {
            tool_id: WORKSPACE_APPEND_LINE_TOOL_ID.to_string(),
            status: ToolExecutionStatus::Completed,
            output: json!({
                "path": relative_path,
                "bytes_appended": line.len() + 1,
                "content_redacted": true,
            }),
        })
    }
}

pub struct GitCommandExecutor;

impl GitCommandExecutor {
    pub fn status(workspace_root: &Path, input: &Value) -> anyhow::Result<ToolExecutionResult> {
        if let Err(reason) = preflight_git_status_input(input) {
            return Ok(ToolExecutionResult {
                tool_id: GIT_STATUS_TOOL_ID.to_string(),
                status: ToolExecutionStatus::Failed,
                output: json!({ "reason": reason }),
            });
        }
        execute_bounded_git(
            workspace_root,
            GIT_STATUS_TOOL_ID,
            &[
                "-c",
                "core.fsmonitor=false",
                "status",
                "--short",
                "--branch",
                "--untracked-files=normal",
            ],
            "status",
        )
    }

    pub fn diff_summary(
        workspace_root: &Path,
        input: &Value,
    ) -> anyhow::Result<ToolExecutionResult> {
        if let Err(reason) = preflight_git_diff_input(input) {
            return Ok(ToolExecutionResult {
                tool_id: GIT_DIFF_TOOL_ID.to_string(),
                status: ToolExecutionStatus::Failed,
                output: json!({ "reason": reason }),
            });
        }
        execute_bounded_git(
            workspace_root,
            GIT_DIFF_TOOL_ID,
            &[
                "-c",
                "core.fsmonitor=false",
                "diff",
                "--no-ext-diff",
                "--no-textconv",
                "--stat",
                "--summary",
                "--find-renames",
                "--",
            ],
            "diff_summary",
        )
    }

    pub fn commit(workspace_root: &Path, input: &Value) -> anyhow::Result<ToolExecutionResult> {
        let (message, authorization) = match preflight_git_commit_execution_input(input) {
            Ok(parsed) => parsed,
            Err(reason) => {
                return Ok(ToolExecutionResult {
                    tool_id: GIT_COMMIT_TOOL_ID.to_string(),
                    status: ToolExecutionStatus::Failed,
                    output: json!({ "reason": reason }),
                });
            }
        };
        execute_bounded_git_commit(workspace_root, &message, &authorization)
    }

    pub fn current_head(workspace_root: &Path) -> anyhow::Result<Option<String>> {
        let root = workspace_root
            .canonicalize()
            .context("workspace root is unavailable")?;
        if let Some(result) = validate_git_repository_root(&root, GIT_COMMIT_TOOL_ID, "head")? {
            anyhow::bail!(
                "{}",
                result
                    .output
                    .get("reason")
                    .and_then(Value::as_str)
                    .unwrap_or("Git capability requires a workspace repository.")
            );
        }
        let output = run_bounded_git_process(
            &root,
            &[
                "-c",
                "core.fsmonitor=false",
                "rev-parse",
                "--verify",
                "HEAD",
            ],
            git_timeout(),
        )
        .context("failed to inspect current git head")?;
        if output.timed_out || output.output_oversized {
            anyhow::bail!("bounded git head inspection failed closed");
        }
        if output.exit_code != Some(0) {
            return Ok(None);
        }
        Ok(Some(
            String::from_utf8_lossy(&output.combined_capture.content)
                .trim()
                .to_string(),
        ))
    }
}

fn execute_bounded_git(
    workspace_root: &Path,
    tool_id: &str,
    args: &[&str],
    operation: &str,
) -> anyhow::Result<ToolExecutionResult> {
    let root = workspace_root
        .canonicalize()
        .context("workspace root is unavailable")?;
    if let Some(result) = validate_git_repository_root(&root, tool_id, operation)? {
        return Ok(result);
    }

    let output = run_bounded_git_process(&root, args, git_timeout())
        .context("failed to execute bounded git capability")?;
    let text = String::from_utf8_lossy(&output.combined_capture.content);
    let total_line_count = text.lines().count();
    let summary_lines = text
        .lines()
        .take(MAX_GIT_SUMMARY_LINES)
        .map(sanitize_git_summary_line)
        .collect::<Vec<_>>();
    let result_fingerprint = sha256_fingerprint(summary_lines.join("\n").as_bytes());
    let failed_closed_reason = if output.timed_out {
        Some("git capability timed out.")
    } else if output.output_oversized {
        Some("git output exceeded byte limit.")
    } else {
        None
    };
    let mut result = ToolExecutionResult {
        tool_id: tool_id.to_string(),
        status: if failed_closed_reason.is_some() {
            ToolExecutionStatus::Failed
        } else if output.exit_code == Some(0) {
            ToolExecutionStatus::Completed
        } else {
            ToolExecutionStatus::Failed
        },
        output: json!({
            "operation": operation,
            "exit_status": output.exit_code,
            "summary_lines": summary_lines,
            "git": {
                "operation": operation,
                "result_fingerprint": result_fingerprint,
                "summary_line_count": total_line_count,
                "materialized_summary_line_count": summary_lines.len(),
                "summary_lines": summary_lines,
                "output_truncated": output.combined_capture.truncated || output.output_oversized || total_line_count > MAX_GIT_SUMMARY_LINES,
                "max_summary_lines": MAX_GIT_SUMMARY_LINES,
                "max_summary_line_chars": MAX_GIT_SUMMARY_LINE_CHARS,
                "raw_diff_redacted": true,
                "raw_file_content_redacted": true,
                "absolute_paths_redacted": true,
            },
            "line_count": total_line_count,
            "captured_bytes": output.combined_capture.bytes,
            "output_truncated": output.combined_capture.truncated || output.output_oversized || total_line_count > MAX_GIT_SUMMARY_LINES,
            "output_oversized": output.output_oversized,
            "timed_out": output.timed_out,
            "duration_ms": output.duration_ms,
            "process_tree_timeout_supported": process_tree_timeout_supported(),
            "process_tree_kill_attempted": output.process_tree_kill_attempted,
            "process_tree_kill_succeeded": output.process_tree_kill_succeeded,
            "process_tree_kill_reason": output.process_tree_kill_reason,
            "reader_thread_joined": output.reader_thread_joined,
            "git_environment_hardened": true,
            "git_prompts_disabled": true,
            "git_optional_locks_disabled": true,
            "raw_diff_redacted": true,
            "raw_file_content_redacted": true,
            "absolute_paths_redacted": true,
            "process_launched": true,
        }),
    };
    if let Some(reason) = failed_closed_reason {
        result.output["reason"] = json!(reason);
    }
    Ok(result)
}

fn validate_git_repository_root(
    root: &Path,
    tool_id: &str,
    operation: &str,
) -> anyhow::Result<Option<ToolExecutionResult>> {
    let repo = run_bounded_git_process(
        root,
        &["-c", "core.fsmonitor=false", "rev-parse", "--show-toplevel"],
        git_timeout(),
    )
    .context("failed to inspect git repository")?;
    if repo.timed_out || repo.output_oversized {
        return Ok(Some(ToolExecutionResult {
            tool_id: tool_id.to_string(),
            status: ToolExecutionStatus::Failed,
            output: json!({
                "reason": if repo.timed_out {
                    "Git repository inspection timed out."
                } else {
                    "Git repository inspection exceeded byte limit."
                },
                "operation": operation,
                "process_launched": true,
                "timed_out": repo.timed_out,
                "output_oversized": repo.output_oversized,
                "duration_ms": repo.duration_ms,
                "process_tree_timeout_supported": process_tree_timeout_supported(),
                "process_tree_kill_attempted": repo.process_tree_kill_attempted,
                "process_tree_kill_succeeded": repo.process_tree_kill_succeeded,
                "process_tree_kill_reason": repo.process_tree_kill_reason,
                "reader_thread_joined": repo.reader_thread_joined,
                "git_environment_hardened": true,
                "git_prompts_disabled": true,
                "git_optional_locks_disabled": true,
                "raw_diff_redacted": true,
                "raw_file_content_redacted": true,
                "absolute_paths_redacted": true,
            }),
        }));
    }
    if repo.exit_code != Some(0) {
        return Ok(Some(ToolExecutionResult {
            tool_id: tool_id.to_string(),
            status: ToolExecutionStatus::Denied,
            output: json!({ "reason": "Git capability requires a workspace repository." }),
        }));
    }
    let repo_root = String::from_utf8_lossy(&repo.combined_capture.content)
        .trim()
        .to_string();
    let repo_root = Path::new(&repo_root)
        .canonicalize()
        .context("failed to validate git repository root")?;
    if repo_root != root {
        return Ok(Some(ToolExecutionResult {
            tool_id: tool_id.to_string(),
            status: ToolExecutionStatus::Denied,
            output: json!({ "reason": "Git capability is scoped to the admitted workspace repository." }),
        }));
    }
    Ok(None)
}

struct GitProcessResult {
    exit_code: Option<i32>,
    timed_out: bool,
    output_oversized: bool,
    duration_ms: u64,
    combined_capture: ProcessCapture,
    process_tree_kill_attempted: bool,
    process_tree_kill_succeeded: bool,
    process_tree_kill_reason: &'static str,
    reader_thread_joined: bool,
}

fn run_bounded_git_process(
    root: &Path,
    args: &[&str],
    timeout: Duration,
) -> anyhow::Result<GitProcessResult> {
    run_bounded_git_process_with_env(root, args, timeout, &[])
}

fn run_bounded_git_process_with_env(
    root: &Path,
    args: &[&str],
    timeout: Duration,
    extra_env: &[(&str, OsString)],
) -> anyhow::Result<GitProcessResult> {
    let start = Instant::now();
    let total_bytes = Arc::new(AtomicUsize::new(0));
    let output_oversized = Arc::new(AtomicBool::new(false));
    let mut command = Command::new(git_program());
    command
        .args(args)
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_process_tree_timeout(&mut command);
    configure_hardened_git_environment(&mut command);
    for (key, value) in extra_env {
        command.env(key, value);
    }

    let mut child = command.spawn()?;
    let stdout_handle = child.stdout.take().map(|stdout| {
        capture_pipe_async_bounded(
            stdout,
            MAX_GIT_CAPTURE_BYTES,
            Arc::clone(&total_bytes),
            Arc::clone(&output_oversized),
        )
    });
    let stderr_handle = child.stderr.take().map(|stderr| {
        capture_pipe_async_bounded(
            stderr,
            MAX_GIT_CAPTURE_BYTES,
            Arc::clone(&total_bytes),
            Arc::clone(&output_oversized),
        )
    });

    let mut timed_out = false;
    let mut process_tree_kill_attempted = false;
    let mut process_tree_kill_succeeded = false;
    let mut process_tree_kill_reason = "not_timed_out";
    let exit_code = loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if output_oversized.load(Ordering::SeqCst) {
                    process_tree_kill_succeeded = true;
                    process_tree_kill_reason = "process_tree_already_exited";
                }
                break status.code();
            }
            Ok(None) if output_oversized.load(Ordering::SeqCst) => {
                process_tree_kill_attempted = true;
                let (succeeded, reason) = terminate_git_process_tree(&mut child);
                process_tree_kill_succeeded = succeeded;
                process_tree_kill_reason = reason;
                break None;
            }
            Ok(None) if start.elapsed() >= timeout => {
                timed_out = true;
                process_tree_kill_attempted = true;
                let (succeeded, reason) = terminate_git_process_tree(&mut child);
                process_tree_kill_succeeded = succeeded;
                process_tree_kill_reason = reason;
                break None;
            }
            Ok(None) => thread::sleep(Duration::from_millis(10)),
            Err(_) => {
                process_tree_kill_attempted = true;
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
        }
    };

    let (stdout_capture, stdout_joined) = join_capture_with_status(stdout_handle);
    let (stderr_capture, stderr_joined) = join_capture_with_status(stderr_handle);
    let mut combined = stdout_capture.content;
    let remaining = MAX_GIT_CAPTURE_BYTES.saturating_sub(combined.len());
    combined
        .extend_from_slice(&stderr_capture.content[..stderr_capture.content.len().min(remaining)]);
    let duration_ms = start.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;

    Ok(GitProcessResult {
        exit_code,
        timed_out,
        output_oversized: output_oversized.load(Ordering::SeqCst),
        duration_ms,
        combined_capture: ProcessCapture {
            bytes: total_bytes
                .load(Ordering::SeqCst)
                .min(MAX_GIT_CAPTURE_BYTES),
            truncated: stdout_capture.truncated
                || stderr_capture.truncated
                || output_oversized.load(Ordering::SeqCst),
            content: combined,
        },
        process_tree_kill_attempted,
        process_tree_kill_succeeded,
        process_tree_kill_reason,
        reader_thread_joined: stdout_joined && stderr_joined,
    })
}

fn terminate_git_process_tree(child: &mut Child) -> (bool, &'static str) {
    let (succeeded, reason) = terminate_process_tree(child.id());
    if succeeded {
        let _ = child.wait();
        return (true, reason);
    }
    let fallback_killed = child.kill().is_ok();
    let waited = child.wait().is_ok();
    if fallback_killed || waited {
        (true, "process_tree_kill_fallback")
    } else {
        (false, reason)
    }
}

fn git_program() -> OsString {
    #[cfg(test)]
    if let Some(program) = TEST_GIT_PROGRAM_OVERRIDE.with(|program| program.borrow().clone()) {
        return program;
    }
    #[cfg(test)]
    if let Some(program) = std::env::var_os("BROWNIE_TEST_GIT_PROGRAM") {
        return program;
    }
    OsString::from("git")
}

fn git_timeout() -> Duration {
    #[cfg(test)]
    if let Some(timeout) = TEST_GIT_TIMEOUT_OVERRIDE.with(|timeout| *timeout.borrow()) {
        return timeout;
    }
    #[cfg(test)]
    if let Some(timeout_ms) = std::env::var_os("BROWNIE_TEST_GIT_TIMEOUT_MS")
        .and_then(|value| value.to_str().and_then(|value| value.parse::<u64>().ok()))
    {
        return Duration::from_millis(timeout_ms);
    }
    Duration::from_millis(DEFAULT_GIT_TIMEOUT_MS)
}

fn configure_hardened_git_environment(command: &mut Command) {
    let path = std::env::var_os("PATH");
    command.env_clear();
    if let Some(path) = path {
        command.env("PATH", path);
    }
    command
        .env("HOME", "/nonexistent")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_SYSTEM", "/dev/null")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_ASKPASS", "/bin/false")
        .env("SSH_ASKPASS", "/bin/false")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_PAGER", "cat")
        .env("PAGER", "cat")
        .env("LC_ALL", "C");
}

fn sanitize_git_summary_line(line: &str) -> String {
    line.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(MAX_GIT_SUMMARY_LINE_CHARS)
        .collect()
}

#[derive(Debug, Clone)]
struct GitCommitAuthorization {
    task_id: String,
    run_id: String,
    journey_id: Option<String>,
    apply_ids: Vec<String>,
    proposal_ids: Vec<String>,
    paths: Vec<GitAuthorizedPath>,
    expected_parent_head: String,
    authorized_change_set_fingerprint: String,
    workspace_write_scope_fingerprint: String,
    logical_invocation_id: String,
}

#[derive(Debug, Clone)]
struct GitAuthorizedPath {
    path: String,
    operation: String,
    post_write_sha256: Option<String>,
    expected_target_absent: Option<bool>,
    post_delete_target_exists: Option<bool>,
}

fn execute_bounded_git_commit(
    workspace_root: &Path,
    message: &str,
    authorization: &GitCommitAuthorization,
) -> anyhow::Result<ToolExecutionResult> {
    let root = workspace_root
        .canonicalize()
        .context("workspace root is unavailable")?;
    if let Some(result) = validate_git_repository_root(&root, GIT_COMMIT_TOOL_ID, "commit")? {
        return Ok(result);
    }

    let message_fingerprint = sha256_fingerprint(message.as_bytes());
    let logical_invocation_fingerprint =
        git_commit_logical_invocation_fingerprint(&message_fingerprint, authorization);
    let intent_trailer =
        format!("{BROWNIE_COMMIT_INTENT_TRAILER}: {logical_invocation_fingerprint}");
    let mut process_count = 1usize;

    let log_output = run_bounded_git_process(
        &root,
        &["-c", "core.fsmonitor=false", "log", "-1", "--format=%H%n%B"],
        git_timeout(),
    )
    .context("failed to inspect latest git commit")?;
    process_count += 1;
    if let Some(result) = git_commit_process_failure(
        &log_output,
        "replay_lookup",
        "git.commit replay lookup failed closed.",
        process_count,
    ) {
        return Ok(result);
    }
    if let Some(commit_id) = parse_latest_commit_for_intent(&log_output, &intent_trailer) {
        return Ok(ToolExecutionResult {
            tool_id: GIT_COMMIT_TOOL_ID.to_string(),
            status: ToolExecutionStatus::Completed,
            output: json!({
                "operation": "commit",
                "commit_id": commit_id,
                "message_fingerprint": message_fingerprint,
                "expected_parent_head": &authorization.expected_parent_head,
                "authorized_change_set_fingerprint": &authorization.authorized_change_set_fingerprint,
                "workspace_write_scope_fingerprint": &authorization.workspace_write_scope_fingerprint,
                "logical_invocation_fingerprint": logical_invocation_fingerprint,
                "authorized_path_count": authorization.paths.len(),
                "replayed": true,
                "runtime_authorization_required": true,
                "process_launched": true,
                "mutation_process_launched": false,
                "git_process_count": process_count,
                "git_processes_bounded": true,
                "git_environment_hardened": true,
                "git_prompts_disabled": true,
                "git_optional_locks_disabled": true,
                "raw_diff_redacted": true,
                "raw_file_content_redacted": true,
                "raw_message_redacted": true,
                "absolute_paths_redacted": true,
                "ambient_index_ignored": true,
                "used_temporary_index": true,
                "used_git_plumbing": true,
                "repository_hooks_bypassed": true,
            }),
        });
    }

    let current_head_output = run_bounded_git_process(
        &root,
        &[
            "-c",
            "core.fsmonitor=false",
            "rev-parse",
            "--verify",
            "HEAD",
        ],
        git_timeout(),
    )
    .context("failed to inspect current git head")?;
    process_count += 1;
    if let Some(result) = git_commit_process_failure(
        &current_head_output,
        "inspect_head",
        "git.commit current HEAD inspection failed closed.",
        process_count,
    ) {
        return Ok(result);
    }
    let current_head = first_non_empty_git_output_line(&current_head_output)
        .filter(|line| is_git_object_id(line))
        .unwrap_or_default();
    if current_head != authorization.expected_parent_head {
        return Ok(git_commit_failed_output(json!({
            "reason": "git.commit expected parent HEAD does not match current workspace HEAD.",
            "operation": "commit",
            "message_fingerprint": message_fingerprint,
            "authorized_change_set_fingerprint": &authorization.authorized_change_set_fingerprint,
            "workspace_write_scope_fingerprint": &authorization.workspace_write_scope_fingerprint,
            "logical_invocation_fingerprint": logical_invocation_fingerprint,
            "authorized_path_count": authorization.paths.len(),
            "process_launched": true,
            "mutation_process_launched": false,
            "git_process_count": process_count,
        })));
    }

    let parent_tree_output = run_bounded_git_process(
        &root,
        &[
            "-c",
            "core.fsmonitor=false",
            "rev-parse",
            &format!("{}^{{tree}}", authorization.expected_parent_head),
        ],
        git_timeout(),
    )
    .context("failed to inspect parent git tree")?;
    process_count += 1;
    if let Some(result) = git_commit_process_failure(
        &parent_tree_output,
        "inspect_parent_tree",
        "git.commit parent tree inspection failed closed.",
        process_count,
    ) {
        return Ok(result);
    }
    let parent_tree = first_non_empty_git_output_line(&parent_tree_output)
        .filter(|line| is_git_object_id(line))
        .unwrap_or_default();
    if parent_tree.is_empty() {
        return Ok(git_commit_failed_output(json!({
            "reason": "git.commit parent tree inspection returned malformed output.",
            "operation": "commit",
            "process_launched": true,
            "mutation_process_launched": false,
            "git_process_count": process_count,
        })));
    }

    let head_ref_output = run_bounded_git_process(
        &root,
        &["-c", "core.fsmonitor=false", "symbolic-ref", "-q", "HEAD"],
        git_timeout(),
    )
    .context("failed to inspect git head ref")?;
    process_count += 1;
    if let Some(result) = git_commit_process_failure(
        &head_ref_output,
        "inspect_head_ref",
        "git.commit branch ref inspection failed closed.",
        process_count,
    ) {
        return Ok(result);
    }
    let head_ref = first_non_empty_git_output_line(&head_ref_output).unwrap_or_default();
    if !head_ref.starts_with("refs/heads/") {
        return Ok(git_commit_failed_output(json!({
            "reason": "git.commit requires an attached local branch HEAD.",
            "operation": "commit",
            "process_launched": true,
            "mutation_process_launched": false,
            "git_process_count": process_count,
        })));
    }

    let temp_index_path = runtime_git_temp_index_path();
    let temp_index_env = [("GIT_INDEX_FILE", temp_index_path.as_os_str().to_os_string())];

    let read_tree_output = run_bounded_git_process_with_env(
        &root,
        &[
            "-c",
            "core.fsmonitor=false",
            "-c",
            "core.hooksPath=/dev/null",
            "read-tree",
            &authorization.expected_parent_head,
        ],
        git_timeout(),
        &temp_index_env,
    )
    .context("failed to prepare runtime git index")?;
    process_count += 1;
    if let Some(mut result) = git_commit_process_failure(
        &read_tree_output,
        "read_tree",
        "git.commit temporary index preparation failed closed.",
        process_count,
    ) {
        mark_temporary_index_used(&mut result, &temp_index_path);
        return Ok(result);
    }

    for authorized_path in &authorization.paths {
        if is_delete_operation(&authorized_path.operation) {
            if authorized_path.post_delete_target_exists != Some(false) {
                let cleaned = cleanup_runtime_git_temp_index(&temp_index_path);
                return Ok(git_commit_failed_output(json!({
                    "reason": "git.commit delete authorization is missing absent-path evidence.",
                    "operation": "commit",
                    "process_launched": true,
                    "mutation_process_launched": false,
                    "git_process_count": process_count,
                    "used_temporary_index": true,
                    "used_git_plumbing": true,
                    "temporary_index_cleaned": cleaned,
                })));
            }
            if root.join(&authorized_path.path).exists() {
                let cleaned = cleanup_runtime_git_temp_index(&temp_index_path);
                return Ok(git_commit_failed_output(json!({
                    "reason": "git.commit authorized delete path still exists in workspace.",
                    "operation": "commit",
                    "process_launched": true,
                    "mutation_process_launched": false,
                    "git_process_count": process_count,
                    "used_temporary_index": true,
                    "used_git_plumbing": true,
                    "temporary_index_cleaned": cleaned,
                })));
            }
            let remove_output = run_bounded_git_process_with_env(
                &root,
                &[
                    "-c",
                    "core.fsmonitor=false",
                    "-c",
                    "core.hooksPath=/dev/null",
                    "update-index",
                    "--force-remove",
                    "--",
                    &authorized_path.path,
                ],
                git_timeout(),
                &temp_index_env,
            )
            .context("failed to update runtime git index for delete")?;
            process_count += 1;
            if let Some(mut result) = git_commit_process_failure(
                &remove_output,
                "update_index_delete",
                "git.commit authorized delete staging failed closed.",
                process_count,
            ) {
                mark_temporary_index_used(&mut result, &temp_index_path);
                return Ok(result);
            }
            continue;
        }

        if let Some(reason) = verify_authorized_workspace_file(&root, authorized_path) {
            let cleaned = cleanup_runtime_git_temp_index(&temp_index_path);
            return Ok(git_commit_failed_output(json!({
                "reason": reason,
                "operation": "commit",
                "message_fingerprint": message_fingerprint,
                "authorized_change_set_fingerprint": &authorization.authorized_change_set_fingerprint,
                "workspace_write_scope_fingerprint": &authorization.workspace_write_scope_fingerprint,
                "logical_invocation_fingerprint": logical_invocation_fingerprint,
                "authorized_path_count": authorization.paths.len(),
                "process_launched": true,
                "mutation_process_launched": false,
                "git_process_count": process_count,
                "used_temporary_index": true,
                "used_git_plumbing": true,
                "temporary_index_cleaned": cleaned,
            })));
        }

        let hash_output = run_bounded_git_process(
            &root,
            &[
                "-c",
                "core.fsmonitor=false",
                "-c",
                "core.hooksPath=/dev/null",
                "hash-object",
                "-w",
                "--",
                &authorized_path.path,
            ],
            git_timeout(),
        )
        .context("failed to write authorized git blob")?;
        process_count += 1;
        if let Some(mut result) = git_commit_process_failure(
            &hash_output,
            "hash_object",
            "git.commit authorized blob write failed closed.",
            process_count,
        ) {
            mark_temporary_index_used(&mut result, &temp_index_path);
            return Ok(result);
        }
        let blob_id = first_non_empty_git_output_line(&hash_output)
            .filter(|line| is_git_object_id(line))
            .unwrap_or_default();
        if blob_id.is_empty() {
            let cleaned = cleanup_runtime_git_temp_index(&temp_index_path);
            return Ok(git_commit_failed_output(json!({
                "reason": "git.commit authorized blob write returned malformed output.",
                "operation": "commit",
                "process_launched": true,
                "mutation_process_launched": false,
                "git_process_count": process_count,
                "used_temporary_index": true,
                "used_git_plumbing": true,
                "temporary_index_cleaned": cleaned,
            })));
        }
        let update_output = run_bounded_git_process_with_env(
            &root,
            &[
                "-c",
                "core.fsmonitor=false",
                "-c",
                "core.hooksPath=/dev/null",
                "update-index",
                "--add",
                "--cacheinfo",
                "100644",
                blob_id,
                &authorized_path.path,
            ],
            git_timeout(),
            &temp_index_env,
        )
        .context("failed to update runtime git index")?;
        process_count += 1;
        if let Some(mut result) = git_commit_process_failure(
            &update_output,
            "update_index",
            "git.commit authorized path staging failed closed.",
            process_count,
        ) {
            mark_temporary_index_used(&mut result, &temp_index_path);
            return Ok(result);
        }
    }

    let tree_output = run_bounded_git_process_with_env(
        &root,
        &[
            "-c",
            "core.fsmonitor=false",
            "-c",
            "core.hooksPath=/dev/null",
            "write-tree",
        ],
        git_timeout(),
        &temp_index_env,
    )
    .context("failed to write authorized git tree")?;
    process_count += 1;
    if let Some(mut result) = git_commit_process_failure(
        &tree_output,
        "write_tree",
        "git.commit authorized tree write failed closed.",
        process_count,
    ) {
        mark_temporary_index_used(&mut result, &temp_index_path);
        return Ok(result);
    }
    let tree_id = first_non_empty_git_output_line(&tree_output)
        .filter(|line| is_git_object_id(line))
        .unwrap_or_default();
    if tree_id.is_empty() {
        let cleaned = cleanup_runtime_git_temp_index(&temp_index_path);
        return Ok(git_commit_failed_output(json!({
            "reason": "git.commit authorized tree write returned malformed output.",
            "operation": "commit",
            "process_launched": true,
            "mutation_process_launched": false,
            "git_process_count": process_count,
            "used_temporary_index": true,
            "used_git_plumbing": true,
            "temporary_index_cleaned": cleaned,
        })));
    }
    if tree_id == parent_tree {
        let cleaned = cleanup_runtime_git_temp_index(&temp_index_path);
        return Ok(git_commit_failed_output(json!({
            "reason": "git.commit authorized change set produced no tree changes.",
            "operation": "commit",
            "message_fingerprint": message_fingerprint,
            "authorized_change_set_fingerprint": &authorization.authorized_change_set_fingerprint,
            "workspace_write_scope_fingerprint": &authorization.workspace_write_scope_fingerprint,
            "logical_invocation_fingerprint": logical_invocation_fingerprint,
            "authorized_path_count": authorization.paths.len(),
            "process_launched": true,
            "mutation_process_launched": false,
            "git_process_count": process_count,
            "used_temporary_index": true,
            "used_git_plumbing": true,
            "temporary_index_cleaned": cleaned,
        })));
    }

    let commit_message = format!("{message}\n\n{intent_trailer}");
    let commit_env = [
        ("GIT_AUTHOR_NAME", OsString::from("Brownie Runtime")),
        (
            "GIT_AUTHOR_EMAIL",
            OsString::from("brownie-runtime@example.invalid"),
        ),
        ("GIT_COMMITTER_NAME", OsString::from("Brownie Runtime")),
        (
            "GIT_COMMITTER_EMAIL",
            OsString::from("brownie-runtime@example.invalid"),
        ),
    ];
    let commit_output = run_bounded_git_process_with_env(
        &root,
        &[
            "-c",
            "core.fsmonitor=false",
            "-c",
            "core.hooksPath=/dev/null",
            "commit-tree",
            tree_id,
            "-p",
            &authorization.expected_parent_head,
            "-m",
            &commit_message,
        ],
        git_timeout(),
        &commit_env,
    )
    .context("failed to create authorized git commit")?;
    process_count += 1;
    if let Some(mut result) = git_commit_process_failure(
        &commit_output,
        "commit_tree",
        "git.commit commit-tree failed closed.",
        process_count,
    ) {
        mark_temporary_index_used(&mut result, &temp_index_path);
        return Ok(result);
    }
    let commit_id = first_non_empty_git_output_line(&commit_output)
        .filter(|line| is_git_object_id(line))
        .unwrap_or_default();
    if commit_id.is_empty() {
        let cleaned = cleanup_runtime_git_temp_index(&temp_index_path);
        return Ok(git_commit_failed_output(json!({
            "reason": "git.commit commit-tree returned malformed output.",
            "operation": "commit",
            "process_launched": true,
            "mutation_process_launched": true,
            "git_process_count": process_count,
            "used_temporary_index": true,
            "used_git_plumbing": true,
            "temporary_index_cleaned": cleaned,
        })));
    }

    let update_ref_output = run_bounded_git_process(
        &root,
        &[
            "-c",
            "core.fsmonitor=false",
            "-c",
            "core.hooksPath=/dev/null",
            "update-ref",
            head_ref,
            commit_id,
            &authorization.expected_parent_head,
        ],
        git_timeout(),
    )
    .context("failed to stale-check and publish authorized git commit")?;
    process_count += 1;
    let temp_index_cleaned = cleanup_runtime_git_temp_index(&temp_index_path);
    if let Some(mut result) = git_commit_process_failure(
        &update_ref_output,
        "update_ref",
        "git.commit stale-checked ref update failed closed.",
        process_count,
    ) {
        result.output["temporary_index_cleaned"] = json!(temp_index_cleaned);
        result.output["used_temporary_index"] = json!(true);
        result.output["used_git_plumbing"] = json!(true);
        return Ok(result);
    }

    Ok(ToolExecutionResult {
        tool_id: GIT_COMMIT_TOOL_ID.to_string(),
        status: ToolExecutionStatus::Completed,
        output: json!({
            "operation": "commit",
            "commit_id": commit_id,
            "message_fingerprint": message_fingerprint,
            "expected_parent_head": &authorization.expected_parent_head,
            "authorized_change_set_fingerprint": &authorization.authorized_change_set_fingerprint,
            "workspace_write_scope_fingerprint": &authorization.workspace_write_scope_fingerprint,
            "logical_invocation_fingerprint": logical_invocation_fingerprint,
            "authorized_path_count": authorization.paths.len(),
            "committed_tree_fingerprint": sha256_fingerprint(tree_id.as_bytes()),
            "replayed": false,
            "runtime_authorization_required": true,
            "process_launched": true,
            "mutation_process_launched": true,
            "git_process_count": process_count,
            "git_processes_bounded": true,
            "git_environment_hardened": true,
            "git_prompts_disabled": true,
            "git_optional_locks_disabled": true,
            "ambient_index_ignored": true,
            "used_temporary_index": true,
            "temporary_index_cleaned": temp_index_cleaned,
            "used_git_plumbing": true,
            "repository_hooks_bypassed": true,
            "raw_diff_redacted": true,
            "raw_file_content_redacted": true,
            "raw_message_redacted": true,
            "absolute_paths_redacted": true,
        }),
    })
}

fn parse_latest_commit_for_intent(
    output: &GitProcessResult,
    intent_trailer: &str,
) -> Option<String> {
    if output.exit_code != Some(0) {
        return None;
    }
    let text = String::from_utf8_lossy(&output.combined_capture.content);
    let mut lines = text.lines();
    let commit_id = lines.next()?;
    if lines.any(|line| line.trim() == intent_trailer) {
        Some(commit_id.to_string())
    } else {
        None
    }
}

fn git_commit_logical_invocation_fingerprint(
    message_fingerprint: &str,
    authorization: &GitCommitAuthorization,
) -> String {
    let canonical = json!({
        "version": "brownie_git_commit_logical_invocation_v1",
        "task_id": &authorization.task_id,
        "run_id": &authorization.run_id,
        "journey_id": &authorization.journey_id,
        "apply_ids": &authorization.apply_ids,
        "proposal_ids": &authorization.proposal_ids,
        "expected_parent_head": &authorization.expected_parent_head,
        "authorized_change_set_fingerprint": &authorization.authorized_change_set_fingerprint,
        "workspace_write_scope_fingerprint": &authorization.workspace_write_scope_fingerprint,
        "logical_invocation_id": &authorization.logical_invocation_id,
        "message_fingerprint": message_fingerprint,
    });
    sha256_fingerprint(canonical.to_string().as_bytes())
}

fn git_commit_failed_output(output: Value) -> ToolExecutionResult {
    let mut output = output;
    set_default_json_bool(&mut output, "git_processes_bounded", true);
    set_default_json_bool(&mut output, "git_environment_hardened", true);
    set_default_json_bool(&mut output, "git_prompts_disabled", true);
    set_default_json_bool(&mut output, "git_optional_locks_disabled", true);
    set_default_json_bool(&mut output, "runtime_authorization_required", true);
    set_default_json_bool(&mut output, "ambient_index_ignored", true);
    set_default_json_bool(&mut output, "used_temporary_index", false);
    set_default_json_bool(&mut output, "used_git_plumbing", false);
    set_default_json_bool(&mut output, "repository_hooks_bypassed", true);
    set_default_json_bool(&mut output, "raw_diff_redacted", true);
    set_default_json_bool(&mut output, "raw_file_content_redacted", true);
    set_default_json_bool(&mut output, "raw_message_redacted", true);
    set_default_json_bool(&mut output, "absolute_paths_redacted", true);
    ToolExecutionResult {
        tool_id: GIT_COMMIT_TOOL_ID.to_string(),
        status: ToolExecutionStatus::Failed,
        output,
    }
}

fn set_default_json_bool(output: &mut Value, key: &str, value: bool) {
    if output.get(key).is_none() {
        output[key] = json!(value);
    }
}

fn mark_temporary_index_used(result: &mut ToolExecutionResult, path: &Path) {
    result.output["used_temporary_index"] = json!(true);
    result.output["used_git_plumbing"] = json!(true);
    result.output["temporary_index_cleaned"] = json!(cleanup_runtime_git_temp_index(path));
}

fn git_commit_process_failure(
    output: &GitProcessResult,
    operation: &str,
    reason: &str,
    process_count: usize,
) -> Option<ToolExecutionResult> {
    let failed = output.timed_out || output.output_oversized || output.exit_code != Some(0);
    failed.then(|| {
        git_commit_failed_output(json!({
            "reason": reason,
            "operation": "commit",
            "failed_git_operation": operation,
            "exit_status": output.exit_code,
            "process_launched": true,
            "timed_out": output.timed_out,
            "output_oversized": output.output_oversized,
            "duration_ms": output.duration_ms,
            "captured_bytes": output.combined_capture.bytes,
            "output_truncated": output.combined_capture.truncated || output.output_oversized,
            "process_tree_timeout_supported": process_tree_timeout_supported(),
            "process_tree_kill_attempted": output.process_tree_kill_attempted,
            "process_tree_kill_succeeded": output.process_tree_kill_succeeded,
            "process_tree_kill_reason": output.process_tree_kill_reason,
            "reader_thread_joined": output.reader_thread_joined,
            "git_process_count": process_count,
        }))
    })
}

fn first_non_empty_git_output_line(output: &GitProcessResult) -> Option<&str> {
    let text = std::str::from_utf8(&output.combined_capture.content).ok()?;
    text.lines().map(str::trim).find(|line| !line.is_empty())
}

fn is_git_object_id(value: &str) -> bool {
    matches!(value.len(), 40 | 64)
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn is_sha256_fingerprint(value: &str) -> bool {
    let Some(hex) = value.strip_prefix("sha256:") else {
        return false;
    };
    hex.len() == 64
        && hex
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn runtime_git_temp_index_path() -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!(
        "brownie-runtime-git-index-{}-{nanos}.idx",
        std::process::id()
    ))
}

fn cleanup_runtime_git_temp_index(path: &Path) -> bool {
    match fs::remove_file(path) {
        Ok(()) => true,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => true,
        Err(_) => false,
    }
}

fn is_delete_operation(operation: &str) -> bool {
    operation == WorkspacePatchOperation::DeleteFile.as_str()
}

fn verify_authorized_workspace_file(
    root: &Path,
    authorized_path: &GitAuthorizedPath,
) -> Option<&'static str> {
    if authorized_path.operation == WorkspacePatchOperation::CreateFile.as_str()
        && authorized_path.expected_target_absent != Some(true)
    {
        return Some("git.commit create authorization must prove prior target absence.");
    }
    let full_path = root.join(&authorized_path.path);
    let metadata = match fs::symlink_metadata(&full_path) {
        Ok(metadata) => metadata,
        Err(_) => return Some("git.commit authorized path is missing from workspace."),
    };
    if !metadata.file_type().is_file() {
        return Some("git.commit authorized path is not a regular file.");
    }
    let Some(expected) = authorized_path.post_write_sha256.as_deref() else {
        return Some("git.commit authorized write path is missing expected content fingerprint.");
    };
    let bytes = match fs::read(&full_path) {
        Ok(bytes) => bytes,
        Err(_) => return Some("git.commit authorized path content could not be read."),
    };
    let actual = sha256_fingerprint(&bytes);
    if actual != expected {
        return Some("git.commit authorized path content fingerprint does not match workspace.");
    }
    None
}

fn sha256_fingerprint(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("sha256:{:x}", hasher.finalize())
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
    test_code_executed: Option<bool>,
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

    pub fn cargo_test(workspace_root: &Path, input: &Value) -> anyhow::Result<ToolExecutionResult> {
        let safety = verification_safety_metadata("cargo_test");
        if let Err(reason) = preflight_verification_cargo_test_input(input) {
            return Ok(verification_result(
                VERIFICATION_CARGO_TEST_TOOL_ID,
                "cargo_test",
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
        if let Err(reason) = preflight_cargo_test_workspace(workspace_root) {
            return Ok(verification_result(
                VERIFICATION_CARGO_TEST_TOOL_ID,
                "cargo_test",
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
                    VERIFICATION_CARGO_TEST_TOOL_ID,
                    "cargo_test",
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
            VERIFICATION_CARGO_TEST_TOOL_ID,
            "cargo_test",
            "cargo",
            &[
                "test",
                "--workspace",
                "--all-targets",
                "--locked",
                "--offline",
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

fn capture_pipe_async_bounded<R>(
    reader: R,
    max_bytes: usize,
    total_bytes: Arc<AtomicUsize>,
    output_oversized: Arc<AtomicBool>,
) -> ProcessCaptureHandle
where
    R: Read + Send + 'static,
{
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let _ = sender.send(capture_pipe_bounded(
            reader,
            max_bytes,
            total_bytes,
            output_oversized,
        ));
    });
    ProcessCaptureHandle { receiver }
}

fn capture_pipe<R: Read>(mut reader: R) -> ProcessCapture {
    let mut total = 0usize;
    let mut truncated = false;
    let mut content = Vec::new();
    let mut buffer = [0u8; 8192];
    while let Ok(read) = reader.read(&mut buffer) {
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

fn capture_pipe_bounded<R: Read>(
    mut reader: R,
    max_bytes: usize,
    total_bytes: Arc<AtomicUsize>,
    output_oversized: Arc<AtomicBool>,
) -> ProcessCapture {
    let mut truncated = false;
    let mut content = Vec::new();
    let mut buffer = [0u8; 8192];
    while let Ok(read) = reader.read(&mut buffer) {
        if read == 0 {
            break;
        }
        let previous = total_bytes.fetch_add(read, Ordering::SeqCst);
        let next_total = previous.saturating_add(read);
        let remaining = max_bytes.saturating_sub(previous.min(max_bytes));
        if remaining > 0 {
            let retained = remaining.min(read);
            content.extend_from_slice(&buffer[..retained]);
            if retained < read {
                truncated = true;
            }
        } else {
            truncated = true;
        }
        if next_total > max_bytes {
            truncated = true;
            output_oversized.store(true, Ordering::SeqCst);
            break;
        }
    }
    ProcessCapture {
        bytes: total_bytes.load(Ordering::SeqCst).min(max_bytes),
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

fn join_capture_with_status(handle: Option<ProcessCaptureHandle>) -> (ProcessCapture, bool) {
    handle
        .map(|handle| {
            handle
                .receiver
                .recv_timeout(Duration::from_millis(GIT_CAPTURE_JOIN_TIMEOUT_MS))
                .map(|capture| (capture, true))
                .unwrap_or_else(|_| (ProcessCapture::empty(), false))
        })
        .unwrap_or_else(|| (ProcessCapture::empty(), true))
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

#[expect(
    clippy::too_many_arguments,
    reason = "Verifier result construction keeps bounded process evidence explicit at call sites."
)]
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
        stdout.truncated || stderr.truncated,
        &stdout.content,
        &stderr.content,
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
    if let Some(test_code_executed) = safety.test_code_executed {
        output["test_code_executed"] = json!(test_code_executed && process_launched);
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
    stderr: &[u8],
) -> Vec<Value> {
    if verification_status != "Failed" {
        return Vec::new();
    }
    if check_id == "cargo_test" {
        return bounded_cargo_test_diagnostics(output_truncated, stdout, stderr);
    }
    if check_id != "cargo_check" {
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

fn bounded_cargo_test_diagnostics(
    output_truncated: bool,
    stdout: &[u8],
    stderr: &[u8],
) -> Vec<Value> {
    let combined = format!(
        "{}\n{}",
        String::from_utf8_lossy(stdout),
        String::from_utf8_lossy(stderr)
    );
    let mut diagnostics = Vec::new();
    for line in combined.lines() {
        if diagnostics.len() >= MAX_BOUNDED_CARGO_DIAGNOSTICS {
            break;
        }
        let Some((test_name, path, line, column)) = parse_cargo_test_panic_location(line) else {
            continue;
        };
        let diagnostic = json!({
            "tool_id": VERIFICATION_CARGO_TEST_TOOL_ID,
            "check_id": "cargo_test",
            "diagnostic_kind": "panic_location",
            "severity": "error",
            "test_name_hash": cargo_test_name_hash(test_name),
            "workspace_relative_path": path,
            "line": line,
            "column": column,
            "truncated": output_truncated,
        });
        if !diagnostics.contains(&diagnostic) {
            diagnostics.push(diagnostic);
        }
    }
    for line in combined.lines() {
        if diagnostics.len() >= MAX_BOUNDED_CARGO_DIAGNOSTICS {
            break;
        }
        let Some(test_name) = parse_cargo_test_failed_name(line) else {
            continue;
        };
        let diagnostic = json!({
            "tool_id": VERIFICATION_CARGO_TEST_TOOL_ID,
            "check_id": "cargo_test",
            "diagnostic_kind": "test_failure",
            "severity": "error",
            "test_name_hash": cargo_test_name_hash(test_name),
            "truncated": output_truncated,
        });
        if !diagnostics.contains(&diagnostic) {
            diagnostics.push(diagnostic);
        }
    }
    if diagnostics.is_empty() {
        diagnostics.push(json!({
            "tool_id": VERIFICATION_CARGO_TEST_TOOL_ID,
            "check_id": "cargo_test",
            "diagnostic_kind": "unavailable",
            "severity": "error",
            "truncated": output_truncated,
        }));
    }
    diagnostics
}

fn parse_cargo_test_panic_location(line: &str) -> Option<(&str, String, u64, u64)> {
    let rest = line.strip_prefix("thread '")?;
    let (test_name, rest) = rest.split_once("' panicked at ")?;
    let (location, _) = rest.rsplit_once(':')?;
    let (path_and_line, column) = location.rsplit_once(':')?;
    let (path, line) = path_and_line.rsplit_once(':')?;
    let path = sanitize_cargo_diagnostic_path(path)?;
    let line = line.parse::<u64>().ok()?;
    let column = column.parse::<u64>().ok()?;
    if line == 0 || column == 0 {
        return None;
    }
    Some((test_name, path, line, column))
}

fn parse_cargo_test_failed_name(line: &str) -> Option<&str> {
    let rest = line.strip_prefix("test ")?;
    let test_name = rest.strip_suffix(" ... FAILED")?;
    if test_name.is_empty() {
        return None;
    }
    Some(test_name)
}

fn cargo_test_name_hash(test_name: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(test_name.as_bytes());
    format!("sha256:{:x}", hasher.finalize())
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
        "cargo_test" => VerificationSafetyMetadata {
            target_dir_isolated: Some(true),
            cleanup_succeeded: None,
            cargo_dependency_fetch_offline: Some(true),
            os_network_isolated: Some(false),
            compile_time_code_sandboxed: Some(false),
            test_code_executed: Some(true),
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

fn preflight_cargo_test_workspace(workspace_root: &Path) -> Result<(), &'static str> {
    if !workspace_root.join("Cargo.toml").is_file() {
        return Err("verification.cargo_test requires a workspace Cargo.toml.");
    }
    if !workspace_root.join("Cargo.lock").is_file() {
        return Err("verification.cargo_test requires an existing Cargo.lock.");
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

fn verification_cargo_test_tool() -> ToolDefinition {
    ToolDefinition {
        tool_id: VERIFICATION_CARGO_TEST_TOOL_ID.to_string(),
        display_name: "Cargo Test".to_string(),
        description: "Controlled fixed verification command: cargo test --workspace --all-targets --locked --offline with an isolated target directory. Callers cannot supply argv, cwd, environment, stdin, shell, timeout, package, feature, target, test name, filter, or path.".to_string(),
        required_action: RuntimeAction::ExecuteProcess,
        input_schema: ToolInputSchema {
            fields: vec![ToolInputField {
                name: "check_id".to_string(),
                required: false,
                description: "Optional literal cargo_test identifier; arbitrary command fields and selectors are rejected.".to_string(),
            }],
        },
    }
}

fn git_status_tool() -> ToolDefinition {
    ToolDefinition {
        tool_id: GIT_STATUS_TOOL_ID.to_string(),
        display_name: "Git Status".to_string(),
        description: "Controlled bounded Git status for the admitted workspace repository. Callers cannot supply argv, cwd, environment, stdin, shell, remote, or path input.".to_string(),
        required_action: RuntimeAction::UseGitInspectCapability,
        input_schema: ToolInputSchema { fields: Vec::new() },
    }
}

fn git_diff_tool() -> ToolDefinition {
    ToolDefinition {
        tool_id: GIT_DIFF_TOOL_ID.to_string(),
        display_name: "Git Diff Summary".to_string(),
        description: "Controlled bounded Git diff summary for the admitted workspace repository. Raw diffs and file contents are not returned. Callers cannot supply argv, cwd, environment, stdin, shell, remote, or path input.".to_string(),
        required_action: RuntimeAction::UseGitInspectCapability,
        input_schema: ToolInputSchema { fields: Vec::new() },
    }
}

fn git_commit_tool() -> ToolDefinition {
    ToolDefinition {
        tool_id: GIT_COMMIT_TOOL_ID.to_string(),
        display_name: "Git Commit".to_string(),
        description: "Controlled bounded Git commit for runtime-authorized workspace changes in the admitted repository. Callers provide only a bounded message; Runtime attaches change-set provenance, ignores ambient staged changes, and rejects argv, cwd, environment, stdin, shell, remote, path, branch, and ref input.".to_string(),
        required_action: RuntimeAction::UseGitCommitCapability,
        input_schema: ToolInputSchema {
            fields: vec![ToolInputField {
                name: "message".to_string(),
                required: true,
                description: "Bounded commit message. The runtime records only its fingerprint in ledger evidence.".to_string(),
            }],
        },
    }
}

fn time_now_tool() -> ToolDefinition {
    ToolDefinition {
        tool_id: TIME_NOW_TOOL_ID.to_string(),
        display_name: "Time Now".to_string(),
        description: "Controlled current-time read. Returns the current Unix epoch time in milliseconds; callers cannot supply shell, command, environment, network, or file input.".to_string(),
        required_action: RuntimeAction::ExecuteProcess,
        input_schema: ToolInputSchema {
            fields: vec![ToolInputField {
                name: "format".to_string(),
                required: false,
                description: "Optional literal unix_epoch_ms output format.".to_string(),
            }],
        },
    }
}

fn runtime_sleep_tool() -> ToolDefinition {
    ToolDefinition {
        tool_id: RUNTIME_SLEEP_TOOL_ID.to_string(),
        display_name: "Runtime Sleep".to_string(),
        description: "Controlled bounded wait. Sleeps for duration_ms up to the Runtime maximum; callers cannot supply shell, command, environment, network, or file input.".to_string(),
        required_action: RuntimeAction::ExecuteProcess,
        input_schema: ToolInputSchema {
            fields: vec![
                ToolInputField {
                    name: "duration_ms".to_string(),
                    required: false,
                    description: "Bounded sleep duration in milliseconds. Use exactly one of duration_ms or duration_seconds.".to_string(),
                },
                ToolInputField {
                    name: "duration_seconds".to_string(),
                    required: false,
                    description: "Bounded sleep duration in seconds. Use exactly one of duration_ms or duration_seconds.".to_string(),
                },
            ],
        },
    }
}

fn workspace_append_line_tool() -> ToolDefinition {
    ToolDefinition {
        tool_id: WORKSPACE_APPEND_LINE_TOOL_ID.to_string(),
        display_name: "Workspace Append Line".to_string(),
        description: "Controlled workspace mutation that appends exactly one UTF-8 line to a workspace-relative file. This is not arbitrary shell execution.".to_string(),
        required_action: RuntimeAction::WriteWorkspace,
        input_schema: ToolInputSchema {
            fields: vec![
                ToolInputField {
                    name: "path".to_string(),
                    required: true,
                    description: "Workspace-relative file path.".to_string(),
                },
                ToolInputField {
                    name: "line".to_string(),
                    required: false,
                    description: "Single literal UTF-8 line to append; newline characters are rejected. Use exactly one of line or line_source.".to_string(),
                },
                ToolInputField {
                    name: "line_source".to_string(),
                    required: false,
                    description: "Optional Runtime-owned line source. Use current_time_unix_epoch_ms to append the current time without arbitrary process execution.".to_string(),
                },
            ],
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
    PatchFile,
}

impl WorkspacePatchOperation {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::ReplaceFile => "replace_file",
            Self::CreateFile => "create_file",
            Self::DeleteFile => "delete_file",
            Self::PatchFile => "patch_file",
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
    if operation != "replace_file"
        && operation != "create_file"
        && operation != "delete_file"
        && operation != "patch_file"
    {
        return Err("workspace.write input.operation must be replace_file, create_file, delete_file, or patch_file.");
    }
    if operation == "delete_file" {
        if object.contains_key("content") {
            return Err("workspace.write input.content must be omitted for delete_file.");
        }
        return Ok(());
    }
    if operation == "patch_file" {
        if object.contains_key("content") {
            return Err("workspace.write input.content must be omitted for patch_file.");
        }
        if let Some(hunks) = object.get("hunks") {
            if object.contains_key("old_text") || object.contains_key("new_text") {
                return Err("workspace.write input.hunks cannot be combined with old_text or new_text for patch_file.");
            }
            let Some(hunks) = hunks.as_array() else {
                return Err("workspace.write input.hunks must be an array for patch_file.");
            };
            if !(2..=5).contains(&hunks.len()) {
                return Err(
                    "workspace.write input.hunks must contain 2 to 5 hunks for patch_file.",
                );
            }
            let mut hunk_chars = 0usize;
            for hunk in hunks {
                let Some(hunk) = hunk.as_object() else {
                    return Err(
                        "workspace.write input.hunks entries must be objects for patch_file.",
                    );
                };
                let Some(old_text) = hunk.get("old_text").and_then(|value| value.as_str()) else {
                    return Err(
                        "workspace.write input.hunks[].old_text is required for patch_file.",
                    );
                };
                let Some(new_text) = hunk.get("new_text").and_then(|value| value.as_str()) else {
                    return Err(
                        "workspace.write input.hunks[].new_text is required for patch_file.",
                    );
                };
                if old_text.is_empty() {
                    return Err(
                        "workspace.write input.hunks[].old_text must not be empty for patch_file.",
                    );
                }
                hunk_chars += old_text.chars().count() + new_text.chars().count();
            }
            if hunk_chars > max_content_chars {
                return Err("workspace.write patch hunks exceed parser length limit.");
            }
        } else {
            let Some(old_text) = object.get("old_text") else {
                return Err("workspace.write input.old_text is required for patch_file.");
            };
            let Some(old_text) = old_text.as_str() else {
                return Err("workspace.write input.old_text must be a string.");
            };
            let Some(new_text) = object.get("new_text") else {
                return Err("workspace.write input.new_text is required for patch_file.");
            };
            let Some(new_text) = new_text.as_str() else {
                return Err("workspace.write input.new_text must be a string.");
            };
            if old_text.is_empty() {
                return Err("workspace.write input.old_text must not be empty for patch_file.");
            }
            if old_text.chars().count() + new_text.chars().count() > max_content_chars {
                return Err("workspace.write patch hunk exceeds parser length limit.");
            }
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

pub enum WorkspaceAppendLine<'a> {
    Literal(&'a str),
    CurrentUnixEpochMs,
}

pub fn preflight_workspace_append_line_input(
    input: &Value,
) -> Result<(&str, WorkspaceAppendLine<'_>), &'static str> {
    let Some(object) = input.as_object() else {
        return Err("workspace.append_line input must be an object.");
    };
    for key in object.keys() {
        match key.as_str() {
            "path" | "line" | "line_source" => {}
            _ => return Err("workspace.append_line input contains unsupported field."),
        }
    }
    let Some(path) = object.get("path").and_then(Value::as_str) else {
        return Err("workspace.append_line input.path must be a string.");
    };
    preflight_workspace_write_path(path)?;
    let line = object.get("line").and_then(Value::as_str);
    let line_source = object.get("line_source").and_then(Value::as_str);
    if line.is_some() == line_source.is_some() {
        return Err("workspace.append_line requires exactly one of line or line_source.");
    }
    if let Some(line) = line {
        if line.contains('\n') || line.contains('\r') {
            return Err("workspace.append_line input.line must be a single line.");
        }
        if line.chars().count() > MAX_WORKSPACE_APPEND_LINE_CHARS {
            return Err("workspace.append_line input.line exceeds parser length limit.");
        }
        return Ok((path, WorkspaceAppendLine::Literal(line)));
    }
    if line_source != Some("current_time_unix_epoch_ms") {
        return Err("workspace.append_line input.line_source must be current_time_unix_epoch_ms.");
    }
    Ok((path, WorkspaceAppendLine::CurrentUnixEpochMs))
}

fn preflight_time_now_input(input: &Value) -> Result<(), &'static str> {
    let Some(object) = input.as_object() else {
        return Err("time.now input must be an object.");
    };
    for key in object.keys() {
        match key.as_str() {
            "format" => {
                if object.get("format").and_then(Value::as_str) != Some("unix_epoch_ms") {
                    return Err("time.now input.format must be unix_epoch_ms when provided.");
                }
            }
            _ => return Err("time.now input contains unsupported field."),
        }
    }
    Ok(())
}

fn preflight_runtime_sleep_input(input: &Value) -> Result<u64, &'static str> {
    let Some(object) = input.as_object() else {
        return Err("runtime.sleep input must be an object.");
    };
    for key in object.keys() {
        if key != "duration_ms" && key != "duration_seconds" {
            return Err("runtime.sleep input contains unsupported field.");
        }
    }
    let duration_ms = object.get("duration_ms").and_then(Value::as_u64);
    let duration_seconds = object.get("duration_seconds").and_then(Value::as_u64);
    if duration_ms.is_some() == duration_seconds.is_some() {
        return Err("runtime.sleep requires exactly one of duration_ms or duration_seconds.");
    };
    let duration_ms = if let Some(duration_ms) = duration_ms {
        duration_ms
    } else {
        duration_seconds
            .and_then(|seconds| seconds.checked_mul(1_000))
            .ok_or("runtime.sleep input.duration_seconds exceeds the maximum duration.")?
    };
    if duration_ms > MAX_RUNTIME_SLEEP_MS {
        return Err("runtime.sleep input.duration_ms exceeds the maximum duration.");
    }
    Ok(duration_ms)
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
            } else {
                let (requests, alias_rejections) =
                    parse_agentmodes_new_task_requests(content, config);
                if !requests.is_empty() || !alias_rejections.is_empty() {
                    summary.accepted_requests = requests.len();
                    rejected.extend(alias_rejections);
                    summary.rejected_requests = rejected.len();
                    return ParsedToolIntent {
                        requests,
                        rejected,
                        summary,
                    };
                }
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
            if BuiltinToolRegistry::get(&tool_id_value).is_none()
                && !is_dynamic_mcp_tool_candidate(&tool_id_value)
            {
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
            if tool_id_value == WORKSPACE_APPEND_LINE_TOOL_ID {
                if let Err(reason) = preflight_workspace_append_line_input(&input) {
                    rejected.push(rejection(Some(tool_id_value), reason, "invalid_input"));
                    continue;
                }
            }
            if tool_id_value == TIME_NOW_TOOL_ID {
                if let Err(reason) = preflight_time_now_input(&input) {
                    rejected.push(rejection(Some(tool_id_value), reason, "invalid_input"));
                    continue;
                }
            }
            if tool_id_value == RUNTIME_SLEEP_TOOL_ID {
                if let Err(reason) = preflight_runtime_sleep_input(&input) {
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
            if tool_id_value == VERIFICATION_CARGO_TEST_TOOL_ID {
                if let Err(reason) = preflight_verification_cargo_test_input(&input) {
                    rejected.push(rejection(Some(tool_id_value), reason, "invalid_input"));
                    continue;
                }
            }
            if tool_id_value == GIT_STATUS_TOOL_ID {
                if let Err(reason) = preflight_git_status_input(&input) {
                    rejected.push(rejection(Some(tool_id_value), reason, "invalid_input"));
                    continue;
                }
            }
            if tool_id_value == GIT_DIFF_TOOL_ID {
                if let Err(reason) = preflight_git_diff_input(&input) {
                    rejected.push(rejection(Some(tool_id_value), reason, "invalid_input"));
                    continue;
                }
            }
            if tool_id_value == GIT_COMMIT_TOOL_ID {
                if let Err(reason) = preflight_git_commit_input(&input) {
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

fn is_dynamic_mcp_tool_candidate(tool_id: &str) -> bool {
    let Some(rest) = tool_id.strip_prefix("mcp.") else {
        return false;
    };
    let Some((server_id, tool_name)) = rest.split_once('.') else {
        return false;
    };
    !server_id.is_empty() && !tool_name.is_empty() && !tool_name.contains('.')
}

fn rejection(tool_id: Option<String>, reason: impl Into<String>, code: &str) -> RejectedToolIntent {
    RejectedToolIntent {
        tool_id,
        reason: reason.into(),
        code: code.to_string(),
    }
}

fn parse_agentmodes_new_task_requests(
    content: &str,
    config: &ToolIntentParserConfig,
) -> (Vec<AssistantToolRequest>, Vec<RejectedToolIntent>) {
    let mut requests = Vec::new();
    let mut rejected = Vec::new();
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || !line.starts_with("new_task(") {
            continue;
        }
        if requests.len() + rejected.len() >= config.max_tool_requests {
            rejected.push(rejection(
                Some(AGENTMODES_NEW_TASK_ALIAS_TOOL_ID.to_string()),
                "new_task requests exceed parser count limit.",
                "too_many_requests",
            ));
            break;
        }
        match parse_agentmodes_new_task_call(line, config) {
            Ok(request) => requests.push(request),
            Err(reason) => rejected.push(rejection(
                Some(AGENTMODES_NEW_TASK_ALIAS_TOOL_ID.to_string()),
                reason,
                "invalid_input",
            )),
        }
    }
    (requests, rejected)
}

fn parse_agentmodes_new_task_call(
    line: &str,
    config: &ToolIntentParserConfig,
) -> Result<AssistantToolRequest, &'static str> {
    if line.len() > config.max_input_bytes {
        return Err("new_task arguments exceed parser size limit.");
    }
    let line = line.strip_suffix(';').unwrap_or(line).trim_end();
    let Some(arguments) = line
        .strip_prefix("new_task(")
        .and_then(|line| line.strip_suffix(')'))
    else {
        return Err("new_task call must use new_task(mode, message).");
    };
    let parts = split_new_task_arguments(arguments)?;
    if parts.len() != 2 {
        return Err("new_task requires mode and message arguments.");
    }
    let (mode_id, goal) = parse_new_task_mode_and_message(&parts)?;
    let input = json!({
        "goal": goal,
        "mode_id": mode_id,
    });
    preflight_subtask_spawn_input(&input)?;
    Ok(AssistantToolRequest {
        tool_id: SUBTASK_SPAWN_TOOL_ID.to_string(),
        reason: "AgentModes new_task compatibility adapter.".to_string(),
        input,
    })
}

fn split_new_task_arguments(arguments: &str) -> Result<Vec<String>, &'static str> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut quote = None;
    let mut escaped = false;
    for ch in arguments.chars() {
        if escaped {
            current.push(ch);
            escaped = false;
            continue;
        }
        if ch == '\\' {
            current.push(ch);
            escaped = true;
            continue;
        }
        if let Some(active_quote) = quote {
            current.push(ch);
            if ch == active_quote {
                quote = None;
            }
            continue;
        }
        match ch {
            '"' | '\'' => {
                quote = Some(ch);
                current.push(ch);
            }
            ',' => {
                parts.push(current.trim().to_string());
                current.clear();
            }
            _ => current.push(ch),
        }
    }
    if quote.is_some() {
        return Err("new_task arguments contain an unterminated string.");
    }
    parts.push(current.trim().to_string());
    Ok(parts)
}

fn parse_new_task_mode_and_message(parts: &[String]) -> Result<(String, String), &'static str> {
    let first = parts[0].trim();
    let second = parts[1].trim();
    let keyed = first.starts_with("mode:") || first.starts_with("mode=");
    if keyed {
        let mode_id = parse_keyed_new_task_value(first, "mode")?;
        let goal = parse_keyed_new_task_value(second, "message")?;
        return Ok((mode_id, goal));
    }
    let mode_id = parse_new_task_string_or_bare_mode(first)?;
    let goal = parse_new_task_string(second)?;
    Ok((mode_id, goal))
}

fn parse_keyed_new_task_value(part: &str, expected_key: &str) -> Result<String, &'static str> {
    let Some((key, value)) = part.split_once(':').or_else(|| part.split_once('=')) else {
        return Err("new_task keyed arguments must use mode and message.");
    };
    if key.trim() != expected_key {
        return Err("new_task keyed arguments must be mode then message.");
    }
    if expected_key == "mode" {
        parse_new_task_string_or_bare_mode(value.trim())
    } else {
        parse_new_task_string(value.trim())
    }
}

fn parse_new_task_string_or_bare_mode(value: &str) -> Result<String, &'static str> {
    if value.starts_with('"') || value.starts_with('\'') {
        return parse_new_task_string(value);
    }
    if value.split_whitespace().count() != 1 {
        return Err("new_task mode must be a single mode id.");
    }
    Ok(value.to_string())
}

fn parse_new_task_string(value: &str) -> Result<String, &'static str> {
    let mut chars = value.chars();
    let Some(quote @ ('"' | '\'')) = chars.next() else {
        return Err("new_task message must be a quoted string.");
    };
    if !value.ends_with(quote) || value.len() < 2 {
        return Err("new_task string arguments must be quoted.");
    }
    let inner = &value[1..value.len() - 1];
    let mut parsed = String::new();
    let mut escaped = false;
    for ch in inner.chars() {
        if escaped {
            parsed.push(match ch {
                '"' | '\'' | '\\' => ch,
                'n' => '\n',
                'r' => '\r',
                't' => '\t',
                _ => return Err("new_task string contains unsupported escape."),
            });
            escaped = false;
            continue;
        }
        if ch == '\\' {
            escaped = true;
        } else {
            parsed.push(ch);
        }
    }
    if escaped {
        return Err("new_task string contains trailing escape.");
    }
    Ok(parsed)
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

fn preflight_verification_cargo_test_input(input: &Value) -> Result<(), &'static str> {
    let Some(object) = input.as_object() else {
        return Err("verification.cargo_test input must be an object.");
    };
    for (key, value) in object {
        match key.as_str() {
            "check_id" => {
                if value.as_str() != Some("cargo_test") {
                    return Err(
                        "verification.cargo_test input.check_id must be cargo_test when provided.",
                    );
                }
            }
            "command" | "argv" | "args" | "cwd" | "env" | "stdin" | "shell" | "timeout"
            | "timeout_ms" | "package" | "packages" | "feature" | "features" | "target"
            | "test" | "test_name" | "path" | "filter" | "nocapture" | "ignored" | "release"
            | "jobs" | "profile" | "manifest_path" => {
                return Err("verification.cargo_test does not accept command, argv, cwd, env, stdin, shell, timeout, package, feature, target, test, path, filter, profile, or manifest input.");
            }
            _ => {
                return Err("verification.cargo_test does not accept unknown input fields.");
            }
        }
    }
    Ok(())
}

fn preflight_git_status_input(input: &Value) -> Result<(), &'static str> {
    preflight_git_input(input, "git.status")
}

fn preflight_git_diff_input(input: &Value) -> Result<(), &'static str> {
    preflight_git_input(input, "git.diff")
}

fn preflight_git_commit_input(input: &Value) -> Result<String, &'static str> {
    preflight_git_commit_message(input, false)
}

fn preflight_git_commit_execution_input(
    input: &Value,
) -> Result<(String, GitCommitAuthorization), &'static str> {
    let message = preflight_git_commit_message(input, true)?;
    let object = input
        .as_object()
        .ok_or("git capability input must be an object.")?;
    let authorization = object
        .get("commit_authorization")
        .ok_or("git.commit requires runtime-owned commit authorization.")?;
    Ok((message, parse_git_commit_authorization(authorization)?))
}

fn preflight_git_commit_message(
    input: &Value,
    allow_runtime_authorization: bool,
) -> Result<String, &'static str> {
    let Some(object) = input.as_object() else {
        return Err("git capability input must be an object.");
    };
    for key in object.keys() {
        match key.as_str() {
            "message" => {}
            "commit_authorization" if allow_runtime_authorization => {}
            "command" | "argv" | "args" | "cwd" | "env" | "stdin" | "shell" | "timeout"
            | "timeout_ms" | "remote" | "path" | "paths" | "branch" | "ref" | "revision" => {
                return Err("git capability does not accept command, argv, cwd, env, stdin, shell, timeout, remote, path, branch, ref, or revision input.");
            }
            _ => return Err("git.commit does not accept unknown input fields."),
        }
    }
    let Some(message) = object.get("message").and_then(Value::as_str) else {
        return Err("git.commit input.message must be a string.");
    };
    let message = message.trim();
    if message.is_empty() {
        return Err("git.commit input.message must not be empty.");
    }
    if message.chars().count() > MAX_GIT_COMMIT_MESSAGE_CHARS {
        return Err("git.commit input.message exceeds the maximum length.");
    }
    if message
        .chars()
        .any(|ch| ch.is_control() && ch != '\n' && ch != '\t')
    {
        return Err("git.commit input.message contains unsupported control characters.");
    }
    Ok(message.to_string())
}

fn parse_git_commit_authorization(value: &Value) -> Result<GitCommitAuthorization, &'static str> {
    let Some(object) = value.as_object() else {
        return Err("git.commit commit_authorization must be an object.");
    };
    for key in object.keys() {
        match key.as_str() {
            "version"
            | "task_id"
            | "run_id"
            | "journey_id"
            | "apply_ids"
            | "proposal_ids"
            | "paths"
            | "expected_parent_head"
            | "authorized_change_set_fingerprint"
            | "workspace_write_scope_fingerprint"
            | "logical_invocation_id" => {}
            _ => return Err("git.commit commit_authorization contains unknown fields."),
        }
    }
    if object.get("version").and_then(Value::as_str) != Some(GIT_COMMIT_AUTHORIZATION_VERSION) {
        return Err("git.commit commit_authorization version is unsupported.");
    }
    let task_id = required_git_commit_auth_id(object, "task_id")?;
    let run_id = required_git_commit_auth_id(object, "run_id")?;
    let journey_id = match object.get("journey_id") {
        Some(Value::String(value)) if !value.trim().is_empty() => {
            if !is_runtime_identifier(value) {
                return Err("git.commit commit_authorization journey_id is invalid.");
            }
            Some(value.to_string())
        }
        Some(Value::Null) | None => None,
        _ => return Err("git.commit commit_authorization journey_id must be a string or null."),
    };
    let apply_ids = required_git_commit_auth_id_array(object, "apply_ids")?;
    let proposal_ids = required_git_commit_auth_id_array(object, "proposal_ids")?;
    let expected_parent_head = required_git_commit_auth_id(object, "expected_parent_head")?;
    if !is_git_object_id(&expected_parent_head) {
        return Err("git.commit commit_authorization expected_parent_head is invalid.");
    }
    let authorized_change_set_fingerprint =
        required_git_commit_auth_fingerprint(object, "authorized_change_set_fingerprint")?;
    let workspace_write_scope_fingerprint =
        required_git_commit_auth_fingerprint(object, "workspace_write_scope_fingerprint")?;
    let logical_invocation_id =
        required_git_commit_auth_fingerprint(object, "logical_invocation_id")?;
    let paths = parse_git_commit_authorized_paths(
        object
            .get("paths")
            .ok_or("git.commit commit_authorization paths are required.")?,
    )?;
    Ok(GitCommitAuthorization {
        task_id,
        run_id,
        journey_id,
        apply_ids,
        proposal_ids,
        paths,
        expected_parent_head,
        authorized_change_set_fingerprint,
        workspace_write_scope_fingerprint,
        logical_invocation_id,
    })
}

fn required_git_commit_auth_id(
    object: &serde_json::Map<String, Value>,
    key: &'static str,
) -> Result<String, &'static str> {
    let value = object
        .get(key)
        .and_then(Value::as_str)
        .ok_or("git.commit commit_authorization is missing a required string field.")?;
    if !is_runtime_identifier(value) {
        return Err("git.commit commit_authorization contains an invalid identifier.");
    }
    Ok(value.to_string())
}

fn required_git_commit_auth_fingerprint(
    object: &serde_json::Map<String, Value>,
    key: &'static str,
) -> Result<String, &'static str> {
    let value = object
        .get(key)
        .and_then(Value::as_str)
        .ok_or("git.commit commit_authorization is missing a required fingerprint.")?;
    if !is_sha256_fingerprint(value) {
        return Err("git.commit commit_authorization fingerprint is invalid.");
    }
    Ok(value.to_string())
}

fn required_git_commit_auth_id_array(
    object: &serde_json::Map<String, Value>,
    key: &'static str,
) -> Result<Vec<String>, &'static str> {
    let values = object
        .get(key)
        .and_then(Value::as_array)
        .ok_or("git.commit commit_authorization is missing a required identifier array.")?;
    if values.is_empty() || values.len() > MAX_GIT_COMMIT_AUTHORIZED_PATHS {
        return Err("git.commit commit_authorization identifier array size is invalid.");
    }
    values
        .iter()
        .map(|value| {
            let Some(value) = value.as_str() else {
                return Err(
                    "git.commit commit_authorization identifier array contains a non-string.",
                );
            };
            if !is_runtime_identifier(value) {
                return Err(
                    "git.commit commit_authorization identifier array contains an invalid value.",
                );
            }
            Ok(value.to_string())
        })
        .collect()
}

fn parse_git_commit_authorized_paths(
    value: &Value,
) -> Result<Vec<GitAuthorizedPath>, &'static str> {
    let values = value
        .as_array()
        .ok_or("git.commit commit_authorization paths must be an array.")?;
    if values.is_empty() || values.len() > MAX_GIT_COMMIT_AUTHORIZED_PATHS {
        return Err("git.commit commit_authorization path count is invalid.");
    }
    let mut seen = BTreeSet::new();
    let mut paths = Vec::new();
    for value in values {
        let Some(object) = value.as_object() else {
            return Err("git.commit commit_authorization path entry must be an object.");
        };
        for key in object.keys() {
            match key.as_str() {
                "path"
                | "operation"
                | "post_write_sha256"
                | "expected_target_absent"
                | "post_delete_target_exists" => {}
                _ => return Err("git.commit commit_authorization path entry has unknown fields."),
            }
        }
        let path = object
            .get("path")
            .and_then(Value::as_str)
            .ok_or("git.commit commit_authorization path must be a string.")?;
        preflight_workspace_write_path(path)?;
        if !seen.insert(path.to_string()) {
            return Err("git.commit commit_authorization contains duplicate paths.");
        }
        let operation = object
            .get("operation")
            .and_then(Value::as_str)
            .ok_or("git.commit commit_authorization operation must be a string.")?;
        if operation != WorkspacePatchOperation::ReplaceFile.as_str()
            && operation != WorkspacePatchOperation::CreateFile.as_str()
            && operation != WorkspacePatchOperation::DeleteFile.as_str()
            && operation != WorkspacePatchOperation::PatchFile.as_str()
        {
            return Err("git.commit commit_authorization operation is unsupported.");
        }
        let post_write_sha256 =
            match object.get("post_write_sha256") {
                Some(Value::String(value)) => {
                    if !is_sha256_fingerprint(value) {
                        return Err("git.commit commit_authorization path fingerprint is invalid.");
                    }
                    Some(value.to_string())
                }
                Some(Value::Null) | None => None,
                _ => return Err(
                    "git.commit commit_authorization path fingerprint must be a string or null.",
                ),
            };
        if operation == WorkspacePatchOperation::DeleteFile.as_str() {
            if post_write_sha256.is_some() {
                return Err("git.commit delete authorization must not carry post_write_sha256.");
            }
        } else if post_write_sha256.is_none() {
            return Err("git.commit write authorization requires post_write_sha256.");
        }
        let expected_target_absent = optional_bool_field(
            object,
            "expected_target_absent",
            "git.commit expected_target_absent must be a boolean.",
        )?;
        let post_delete_target_exists = optional_bool_field(
            object,
            "post_delete_target_exists",
            "git.commit post_delete_target_exists must be a boolean.",
        )?;
        if operation == WorkspacePatchOperation::DeleteFile.as_str()
            && post_delete_target_exists != Some(false)
        {
            return Err(
                "git.commit delete authorization requires post_delete_target_exists=false.",
            );
        }
        paths.push(GitAuthorizedPath {
            path: path.to_string(),
            operation: operation.to_string(),
            post_write_sha256,
            expected_target_absent,
            post_delete_target_exists,
        });
    }
    Ok(paths)
}

fn optional_bool_field(
    object: &serde_json::Map<String, Value>,
    key: &'static str,
    reason: &'static str,
) -> Result<Option<bool>, &'static str> {
    match object.get(key) {
        Some(Value::Bool(value)) => Ok(Some(*value)),
        Some(Value::Null) | None => Ok(None),
        _ => Err(reason),
    }
}

fn is_runtime_identifier(value: &str) -> bool {
    let value = value.trim();
    !value.is_empty()
        && value.len() <= MAX_GIT_COMMIT_AUTH_ID_CHARS
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.' | b':'))
}

fn preflight_git_input(input: &Value, tool_id: &str) -> Result<(), &'static str> {
    let Some(object) = input.as_object() else {
        return Err("git capability input must be an object.");
    };
    if let Some(key) = object.keys().next() {
        match key.as_str() {
            "command" | "argv" | "args" | "cwd" | "env" | "stdin" | "shell" | "timeout"
            | "timeout_ms" | "remote" | "path" | "paths" | "branch" | "ref" | "revision" => {
                return Err("git capability does not accept command, argv, cwd, env, stdin, shell, timeout, remote, path, branch, ref, or revision input.");
            }
            _ => {
                return Err(match tool_id {
                    "git.status" => "git.status does not accept input fields in this phase.",
                    "git.diff" => "git.diff does not accept input fields in this phase.",
                    _ => "git capability does not accept unknown input fields.",
                })
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
        Self::evaluate_with_dynamic_tools(policy, parsed, &[])
    }

    pub fn evaluate_with_dynamic_tools(
        policy: &CompiledModePolicy,
        parsed: ParsedToolIntent,
        dynamic_tools: &[ToolDefinition],
    ) -> ToolIntentEvaluation {
        let mut rejected = parsed.rejected;
        let mut items = Vec::new();
        for request in parsed.requests {
            let definition = BuiltinToolRegistry::get(&request.tool_id).or_else(|| {
                dynamic_tools
                    .iter()
                    .find(|tool| tool.tool_id == request.tool_id)
                    .cloned()
            });
            let Some(definition) = definition else {
                rejected.push(RejectedToolIntent {
                    tool_id: Some(request.tool_id),
                    reason: "Unknown tool id.".to_string(),
                    code: "unknown_tool".to_string(),
                });
                continue;
            };
            let decision = if definition.tool_id == WORKSPACE_WRITE_TOOL_ID {
                request
                    .input
                    .get("path")
                    .and_then(Value::as_str)
                    .map(|path| RuntimePermissionGate::check_workspace_write_path(policy, path))
                    .unwrap_or_else(|| {
                        RuntimePermissionGate::check(policy, definition.required_action.clone())
                    })
            } else {
                RuntimePermissionGate::check(policy, definition.required_action.clone())
            };
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
                "append",
                "create",
                "update",
                "save",
                "修正",
                "編集",
                "実装",
                "追記",
                "書き込",
                "作成",
                "更新",
                "保存",
                "追加",
            ],
        ) {
            items.push(plan_item(
                "workspace.write",
                "Goal suggests implementation or editing work.",
            ));
            items.push(plan_item(
                WORKSPACE_APPEND_LINE_TOOL_ID,
                "Goal suggests appending bounded lines to workspace files.",
            ));
        }
        if contains_any(
            &goal,
            &["time", "timestamp", "clock", "date", "現在時刻", "時刻"],
        ) {
            items.push(plan_item(
                TIME_NOW_TOOL_ID,
                "Goal asks for current time evidence.",
            ));
        }
        if contains_any(&goal, &["wait", "sleep", "待つ", "待機"]) {
            items.push(plan_item(
                RUNTIME_SLEEP_TOOL_ID,
                "Goal asks for a bounded Runtime wait.",
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
    use brownie_modepack::{
        load_modepack_from_str_with_options, ModePackCapabilityCeiling, ModePackLoadOptions,
        ModePackSourceTrust,
    };

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
                "codebase.index.selection.read",
                "workspace.write",
                "verification.cargo_fmt_check",
                "verification.cargo_check",
                "verification.cargo_test",
                "git.status",
                "git.diff",
                "git.commit",
                "time.now",
                "runtime.sleep",
                "workspace.append_line",
                "process.exec",
                "subtask.spawn",
                "network.access",
                "llm.provider.access",
                "service.control",
                "destructive.operation"
            ]
        );
    }

    #[test]
    fn planner_includes_workspace_write_for_japanese_append_goals() {
        let plan = ToolPlanner::plan(ToolPlanningInput {
            task_id: "task_1".to_string(),
            goal: "現在時刻を取得し、timestamp.txt に行を追記して、1分待機してください".to_string(),
            mode_id: "implementer".to_string(),
        });
        let ids = plan
            .items
            .iter()
            .map(|item| item.tool_id.as_str())
            .collect::<Vec<_>>();
        assert!(ids.contains(&WORKSPACE_READ_TOOL_ID));
        assert!(ids.contains(&WORKSPACE_WRITE_TOOL_ID));
        assert!(ids.contains(&WORKSPACE_APPEND_LINE_TOOL_ID));
        assert!(ids.contains(&TIME_NOW_TOOL_ID));
        assert!(ids.contains(&RUNTIME_SLEEP_TOOL_ID));
    }

    #[test]
    fn parser_accepts_bounded_runtime_sleep_seconds() {
        let parsed = ToolIntentParser::parse_assistant_content(
            "```brownie-tool-intent\n{\"tool_requests\":[{\"tool_id\":\"runtime.sleep\",\"reason\":\"Wait one minute.\",\"input\":{\"duration_seconds\":60}}]}\n```",
        );
        assert_eq!(parsed.summary.accepted_requests, 1);
        assert_eq!(parsed.summary.rejected_requests, 0);
    }

    #[test]
    fn controlled_append_line_can_append_runtime_current_time() {
        let temp = tempfile::tempdir().unwrap();
        let result = ToolExecutor::execute_controlled(
            temp.path(),
            ToolExecutionRequest {
                tool_id: WORKSPACE_APPEND_LINE_TOOL_ID.to_string(),
                input: json!({
                    "path": "timestamp.txt",
                    "line_source": "current_time_unix_epoch_ms",
                }),
            },
        )
        .unwrap();
        assert_eq!(result.status, ToolExecutionStatus::Completed);
        let content = fs::read_to_string(temp.path().join("timestamp.txt")).unwrap();
        let line = content.trim();
        assert!(!line.is_empty());
        assert!(line.bytes().all(|byte| byte.is_ascii_digit()));
    }

    #[test]
    fn modepack_reserved_v0_side_effects_cannot_enable_builtin_tool_authority() {
        let content = r#"{
          "name": "workspace-invariant-side-effects",
          "schema_version": 1,
          "modes": [
            {
              "mode_id": "external-integrator",
              "display_name": "External Integrator",
              "role_definition": "Trusted external policy declares every side effect.",
              "permissions": {
                "read_only": false,
                "workspace_write": true,
                "process_exec": true,
                "network_access": true,
                "llm_provider_access": true,
                "service_control": true,
                "destructive": true,
                "can_spawn_subtasks": true,
                "codebase_index": true,
                "mcp_tool_access": true
              },
              "allowed_handoff_targets": ["$modepack/*"]
            }
          ]
        }"#;
        let snapshot = load_modepack_from_str_with_options(
            content,
            ".brownie/modepack.json",
            ModePackLoadOptions {
                source_trust: ModePackSourceTrust::TrustedSignedActiveModePack,
                capability_ceiling: ModePackCapabilityCeiling {
                    workspace_write: true,
                    process_exec: true,
                    git_inspect: true,
                    git_commit: true,
                    network_access: true,
                    llm_provider_access: true,
                    service_control: true,
                    destructive: true,
                    can_spawn_subtasks: true,
                    mcp_tool_access: true,
                },
            },
        )
        .expect("trusted modepack should compile");
        let policy = snapshot
            .modes
            .iter()
            .find(|mode| mode.mode_id == "external-integrator")
            .expect("external-integrator");

        assert!(policy.permissions.workspace_write);
        assert!(policy.permissions.process_exec);
        assert!(policy.permissions.can_spawn_subtasks);
        assert!(policy.permissions.mcp_tool_access);

        for tool_id in ["network.access", "service.control", "destructive.operation"] {
            let tool = BuiltinToolRegistry::get(tool_id).expect("builtin tool");
            let decision = RuntimePermissionGate::check(policy, tool.required_action.clone());
            assert!(
                !decision.allowed,
                "{tool_id} must remain denied for trusted external Mode Packs in v0"
            );
        }
        let llm_provider_tool =
            BuiltinToolRegistry::get("llm.provider.access").expect("builtin tool");
        let llm_provider_decision =
            RuntimePermissionGate::check(policy, llm_provider_tool.required_action);
        assert!(
            llm_provider_decision.allowed,
            "configured LLM provider access is separate from generic network access"
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
    fn parser_accepts_controlled_cargo_test_verification_intent() {
        let parsed = ToolIntentParser::parse_assistant_content("```brownie-tool-intent\n{\"tool_requests\":[{\"tool_id\":\"verification.cargo_test\",\"reason\":\"Verify tests.\",\"input\":{\"check_id\":\"cargo_test\"}}]}\n```");
        assert_eq!(parsed.requests.len(), 1);
        assert!(parsed.rejected.is_empty());
        assert_eq!(parsed.requests[0].tool_id, VERIFICATION_CARGO_TEST_TOOL_ID);
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
            assert!(
                preflight_verification_cargo_test_input(&input).is_err(),
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
            assert!(
                preflight_verification_cargo_test_input(&input).is_err(),
                "{input:?}"
            );
        }
        for input in [
            serde_json::json!({"feature":"all"}),
            serde_json::json!({"test":"unit_name"}),
            serde_json::json!({"test_name":"unit_name"}),
            serde_json::json!({"filter":"unit_name"}),
            serde_json::json!({"nocapture":true}),
            serde_json::json!({"ignored":true}),
            serde_json::json!({"release":true}),
            serde_json::json!({"jobs":2}),
            serde_json::json!({"profile":"dev"}),
            serde_json::json!({"manifest_path":"crates/brownie-tools/Cargo.toml"}),
        ] {
            assert!(
                preflight_verification_cargo_test_input(&input).is_err(),
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
    fn intent_evaluator_checks_workspace_write_scopes_by_path() {
        let mut policy = BuiltinModeRegistry::get("implementer").expect("policy");
        policy.workspace_write_scopes = vec![brownie_agentmodes::WorkspaceWriteScope {
            file_regex: Some("^docs/.*\\.md$".to_string()),
            description: Some("Documentation files only.".to_string()),
        }];
        let parsed = ToolIntentParser::parse_assistant_content(
            "```brownie-tool-intent\n{\"tool_requests\":[{\"tool_id\":\"workspace.write\",\"reason\":\"Update docs.\",\"input\":{\"path\":\"docs/guide.md\",\"operation\":\"replace_file\",\"content\":\"new docs\"}},{\"tool_id\":\"workspace.write\",\"reason\":\"Update code.\",\"input\":{\"path\":\"src/lib.rs\",\"operation\":\"replace_file\",\"content\":\"pub fn new() {}\"}}]}\n```",
        );

        let evaluation = ToolIntentEvaluator::evaluate(&policy, parsed);

        assert_eq!(evaluation.items.len(), 2);
        let docs = evaluation
            .items
            .iter()
            .find(|item| item.input["path"] == "docs/guide.md")
            .expect("docs decision");
        assert!(docs.allowed);
        assert!(docs.reason.contains("within compiled scope"));
        let source = evaluation
            .items
            .iter()
            .find(|item| item.input["path"] == "src/lib.rs")
            .expect("source decision");
        assert!(!source.allowed);
        assert!(source.reason.contains("outside compiled scope"));
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
    fn parser_adapts_agentmodes_new_task_call_to_subtask_spawn() {
        let parsed = ToolIntentParser::parse_assistant_content(
            "new_task(\"reviewer\", \"Review this change and report findings.\")",
        );
        assert_eq!(parsed.requests.len(), 1);
        assert!(parsed.rejected.is_empty());
        assert_eq!(parsed.requests[0].tool_id, SUBTASK_SPAWN_TOOL_ID);
        assert_eq!(
            parsed.requests[0].reason,
            "AgentModes new_task compatibility adapter."
        );
        assert_eq!(parsed.requests[0].input["mode_id"], "reviewer");
        assert_eq!(
            parsed.requests[0].input["goal"],
            "Review this change and report findings."
        );
        assert_eq!(parsed.summary.accepted_requests, 1);
    }

    #[test]
    fn parser_adapts_agentmodes_keyed_new_task_call_to_subtask_spawn() {
        let parsed = ToolIntentParser::parse_assistant_content(
            "new_task(mode: reviewer, message: 'Review compact TASK_PACKET_V1.');",
        );
        assert_eq!(parsed.requests.len(), 1);
        assert!(parsed.rejected.is_empty());
        assert_eq!(parsed.requests[0].tool_id, SUBTASK_SPAWN_TOOL_ID);
        assert_eq!(parsed.requests[0].input["mode_id"], "reviewer");
        assert_eq!(
            parsed.requests[0].input["goal"],
            "Review compact TASK_PACKET_V1."
        );
    }

    #[test]
    fn parser_rejects_malformed_agentmodes_new_task_without_raw_payload() {
        let oversized_goal = "secret-token ".repeat(MAX_SUBTASK_SPAWN_GOAL_CHARS);
        let parsed = ToolIntentParser::parse_assistant_content(&format!(
            "new_task(\"../reviewer\", \"{oversized_goal}\")"
        ));
        assert!(parsed.requests.is_empty());
        assert_eq!(parsed.rejected.len(), 1);
        assert_eq!(
            parsed.rejected[0].tool_id.as_deref(),
            Some(AGENTMODES_NEW_TASK_ALIAS_TOOL_ID)
        );
        assert_eq!(parsed.rejected[0].code, "invalid_input");
        let rejected = serde_json::to_string(&parsed.rejected).expect("serialize");
        assert!(!rejected.contains("../reviewer"));
        assert!(!rejected.contains("secret-token"));
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

    #[cfg(unix)]
    #[test]
    fn workspace_read_executor_rejects_symlink_targets() {
        let temp = tempfile::tempdir().expect("tempdir");
        std::fs::write(temp.path().join("README.md"), "hello").expect("write");
        std::os::unix::fs::symlink(temp.path().join("README.md"), temp.path().join("link.md"))
            .expect("symlink");

        let result = WorkspaceReadExecutor::read(temp.path(), "link.md", MAX_WORKSPACE_READ_BYTES)
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

    fn assert_cargo_test_honest_safety_metadata(output: &Value) {
        assert_eq!(output["target_dir_isolated"], true);
        assert_eq!(output["cargo_dependency_fetch_offline"], true);
        assert_eq!(output["os_network_isolated"], false);
        assert_eq!(output["compile_time_code_sandboxed"], false);
        assert_eq!(output["test_code_executed"], true);
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
    fn verification_executor_reports_cargo_test_honest_safety_metadata() {
        let temp = tempfile::tempdir().expect("tempdir");
        write_cargo_check_fixture(
            temp.path(),
            "test_pass",
            "pub fn ok() -> i32 { 1 }\n\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn passes() {\n        assert_eq!(super::ok(), 1);\n    }\n}\n",
        );

        let result =
            VerificationCommandExecutor::cargo_test(temp.path(), &json!({})).expect("execute");

        assert_eq!(result.tool_id, VERIFICATION_CARGO_TEST_TOOL_ID);
        assert_eq!(result.status, ToolExecutionStatus::Completed);
        assert_eq!(result.output["check_id"], "cargo_test");
        assert_eq!(result.output["verification_status"], "Passed");
        assert_eq!(result.output["process_launched"], true);
        assert_eq!(result.output["output_redacted"], true);
        assert_cargo_test_honest_safety_metadata(&result.output);
        assert_process_tree_timeout_not_attempted(&result.output);
        assert_eq!(result.output["cleanup_succeeded"], true);
        assert!(!temp.path().join("target").exists());
        let serialized = result.output.to_string();
        assert!(!serialized.contains("passes"));
        assert!(!serialized.contains("stdout"));
        assert!(!serialized.contains("stderr"));
        assert!(!serialized.contains("CARGO_TARGET_DIR"));
    }

    #[test]
    fn verification_executor_reports_cargo_test_failure_without_raw_output() {
        let temp = tempfile::tempdir().expect("tempdir");
        write_cargo_check_fixture(
            temp.path(),
            "test_fail",
            "pub fn ok() -> i32 { 1 }\n\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn fails() {\n        assert_eq!(super::ok(), 2);\n    }\n}\n",
        );

        let result =
            VerificationCommandExecutor::cargo_test(temp.path(), &json!({})).expect("execute");

        assert_eq!(result.status, ToolExecutionStatus::Failed);
        assert_eq!(result.output["check_id"], "cargo_test");
        assert_eq!(result.output["verification_status"], "Failed");
        assert_eq!(result.output["process_launched"], true);
        assert_eq!(result.output["output_redacted"], true);
        assert_cargo_test_honest_safety_metadata(&result.output);
        let diagnostics = result.output["bounded_cargo_diagnostics"]
            .as_array()
            .expect("bounded cargo test diagnostics");
        assert!(!diagnostics.is_empty());
        assert!(diagnostics.len() <= MAX_BOUNDED_CARGO_DIAGNOSTICS);
        assert_eq!(
            diagnostics[0]["tool_id"],
            json!(VERIFICATION_CARGO_TEST_TOOL_ID)
        );
        assert_eq!(diagnostics[0]["check_id"], "cargo_test");
        assert_eq!(diagnostics[0]["severity"], "error");
        assert!(matches!(
            diagnostics[0]["diagnostic_kind"].as_str(),
            Some("panic_location" | "test_failure" | "unavailable")
        ));
        assert!(diagnostics.iter().any(|diagnostic| diagnostic
            .get("test_name_hash")
            .and_then(Value::as_str)
            .is_some_and(|hash| {
                hash.len() == 71
                    && hash.starts_with("sha256:")
                    && hash[7..].bytes().all(|byte| byte.is_ascii_hexdigit())
            })));
        assert!(diagnostics
            .iter()
            .all(|diagnostic| diagnostic.get("test_name").is_none()));
        assert!(diagnostics
            .iter()
            .all(|diagnostic| diagnostic.get("message").is_none()));
        assert!(diagnostics
            .iter()
            .all(|diagnostic| diagnostic.get("rendered").is_none()));
        assert!(!temp.path().join("target").exists());
        let serialized = result.output.to_string();
        assert!(!serialized.contains("fails"));
        assert!(!serialized.contains("assert_eq"));
        assert!(!serialized.contains("stdout"));
        assert!(!serialized.contains("stderr"));
    }

    #[test]
    fn verification_executor_rejects_cargo_test_without_manifest_or_lockfile() {
        let missing_manifest = tempfile::tempdir().expect("tempdir");
        let result = VerificationCommandExecutor::cargo_test(missing_manifest.path(), &json!({}))
            .expect("execute");
        assert_eq!(result.status, ToolExecutionStatus::Failed);
        assert_eq!(result.output["verification_status"], "Rejected");
        assert_eq!(result.output["process_launched"], false);
        assert_eq!(result.output["test_code_executed"], false);

        let missing_lock = tempfile::tempdir().expect("tempdir");
        std::fs::create_dir(missing_lock.path().join("src")).expect("mkdir");
        std::fs::write(
            missing_lock.path().join("Cargo.toml"),
            "[package]\nname = \"missing_test_lock\"\nversion = \"0.1.0\"\nedition = \"2021\"\n",
        )
        .expect("manifest");
        std::fs::write(missing_lock.path().join("src/lib.rs"), "pub fn ok() {}\n").expect("src");
        let result = VerificationCommandExecutor::cargo_test(missing_lock.path(), &json!({}))
            .expect("execute");
        assert_eq!(result.status, ToolExecutionStatus::Failed);
        assert_eq!(result.output["verification_status"], "Rejected");
        assert_eq!(result.output["process_launched"], false);
        assert_eq!(result.output["test_code_executed"], false);
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

    static GIT_TEST_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn git_test_env_lock() -> std::sync::MutexGuard<'static, ()> {
        GIT_TEST_ENV_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    #[test]
    fn git_status_diff_and_authorized_commit_are_bounded_dedicated_capabilities() {
        let _lock = git_test_env_lock();
        let temp = git_repository("git-status-diff");
        fs::write(temp.path().join("README.md"), "# Changed\n").expect("write changed readme");
        fs::write(temp.path().join("notes.md"), "new note\n").expect("write note");
        let status = ToolExecutor::execute_controlled(
            temp.path(),
            ToolExecutionRequest {
                tool_id: GIT_STATUS_TOOL_ID.to_string(),
                input: json!({}),
            },
        )
        .expect("git status");
        assert_eq!(status.status, ToolExecutionStatus::Completed);
        assert_eq!(status.output["operation"], "status");
        assert_eq!(status.output["raw_diff_redacted"], true);
        let status_json = status.output.to_string();
        assert!(status_json.contains("README.md"));
        assert!(!status_json.contains(temp.path().to_string_lossy().as_ref()));

        let diff = ToolExecutor::execute_controlled(
            temp.path(),
            ToolExecutionRequest {
                tool_id: GIT_DIFF_TOOL_ID.to_string(),
                input: json!({}),
            },
        )
        .expect("git diff");
        assert_eq!(diff.status, ToolExecutionStatus::Completed);
        assert_eq!(diff.output["operation"], "diff_summary");
        assert_eq!(diff.output["raw_diff_redacted"], true);
        let diff_json = diff.output.to_string();
        assert!(diff_json.contains("README.md"));
        assert!(!diff_json.contains("# Changed"));
        assert!(!diff_json.contains(temp.path().to_string_lossy().as_ref()));

        fs::write(temp.path().join("foreign.txt"), "foreign staged change\n")
            .expect("write foreign");
        let add = Command::new("git")
            .args(["add", "foreign.txt"])
            .current_dir(temp.path())
            .status()
            .expect("git add foreign");
        assert!(add.success());
        #[cfg(unix)]
        let hook_sentinel = {
            let sentinel = temp.path().join("hook-ran");
            let hooks_dir = temp.path().join(".git").join("hooks");
            for hook_name in [
                "pre-commit",
                "prepare-commit-msg",
                "commit-msg",
                "post-commit",
            ] {
                let hook = hooks_dir.join(hook_name);
                fs::write(
                    &hook,
                    format!(
                        "#!/bin/sh\nprintf hook > '{}'\nexit 1\n",
                        sentinel.display()
                    ),
                )
                .expect("write hook");
                let mut permissions = fs::metadata(&hook).expect("metadata").permissions();
                std::os::unix::fs::PermissionsExt::set_mode(&mut permissions, 0o755);
                fs::set_permissions(&hook, permissions).expect("chmod hook");
            }
            sentinel
        };
        let commit_input = test_git_commit_input(
            temp.path(),
            "Update README from bounded git capability",
            "proposal_readme_1",
            "apply_readme_1",
            "runtime.logical.1",
        );
        let commit = ToolExecutor::execute_controlled(
            temp.path(),
            ToolExecutionRequest {
                tool_id: GIT_COMMIT_TOOL_ID.to_string(),
                input: commit_input.clone(),
            },
        )
        .expect("git commit");
        assert_eq!(commit.status, ToolExecutionStatus::Completed);
        assert_eq!(commit.output["operation"], "commit");
        assert_eq!(commit.output["raw_diff_redacted"], true);
        assert_eq!(commit.output["raw_message_redacted"], true);
        assert_eq!(commit.output["process_launched"], true);
        assert_eq!(commit.output["mutation_process_launched"], true);
        assert_eq!(commit.output["ambient_index_ignored"], true);
        assert_eq!(commit.output["used_temporary_index"], true);
        assert_eq!(commit.output["used_git_plumbing"], true);
        assert_eq!(commit.output["repository_hooks_bypassed"], true);
        assert!(commit.output["commit_id"].as_str().is_some());
        assert!(commit.output["message_fingerprint"]
            .as_str()
            .is_some_and(|value| value.starts_with("sha256:")));
        assert!(commit.output["authorized_change_set_fingerprint"]
            .as_str()
            .is_some_and(|value| value.starts_with("sha256:")));
        assert!(commit.output["logical_invocation_fingerprint"]
            .as_str()
            .is_some_and(|value| value.starts_with("sha256:")));
        let commit_json = commit.output.to_string();
        assert!(!commit_json.contains("Update README from bounded git capability"));
        assert!(!commit_json.contains("# Changed"));
        assert!(!commit_json.contains("foreign staged change"));
        assert!(!commit_json.contains(temp.path().to_string_lossy().as_ref()));
        let head_paths = Command::new("git")
            .args(["ls-tree", "-r", "--name-only", "HEAD"])
            .current_dir(temp.path())
            .output()
            .expect("git ls-tree");
        assert!(head_paths.status.success());
        let head_paths = String::from_utf8_lossy(&head_paths.stdout);
        assert!(head_paths.contains("README.md"));
        assert!(!head_paths.contains("foreign.txt"));
        #[cfg(unix)]
        assert!(
            !hook_sentinel.exists(),
            "repository hooks must not run for git.commit"
        );
        let staged_paths = Command::new("git")
            .args(["diff", "--cached", "--name-only"])
            .current_dir(temp.path())
            .output()
            .expect("git staged paths");
        assert!(staged_paths.status.success());
        assert!(String::from_utf8_lossy(&staged_paths.stdout).contains("foreign.txt"));

        let replay = ToolExecutor::execute_controlled(
            temp.path(),
            ToolExecutionRequest {
                tool_id: GIT_COMMIT_TOOL_ID.to_string(),
                input: commit_input,
            },
        )
        .expect("git commit replay");
        assert_eq!(replay.status, ToolExecutionStatus::Completed);
        assert_eq!(replay.output["commit_id"], commit.output["commit_id"]);
        assert_eq!(replay.output["replayed"], true);
        assert_eq!(replay.output["mutation_process_launched"], false);

        fs::write(temp.path().join("README.md"), "# Changed Again\n")
            .expect("write changed readme again");
        let second_commit = ToolExecutor::execute_controlled(
            temp.path(),
            ToolExecutionRequest {
                tool_id: GIT_COMMIT_TOOL_ID.to_string(),
                input: test_git_commit_input(
                    temp.path(),
                    "Update README from bounded git capability",
                    "proposal_readme_2",
                    "apply_readme_2",
                    "runtime.logical.2",
                ),
            },
        )
        .expect("second git commit");
        assert_eq!(second_commit.status, ToolExecutionStatus::Completed);
        assert_ne!(
            second_commit.output["commit_id"],
            commit.output["commit_id"]
        );
        assert_eq!(second_commit.output["replayed"], false);
        let count = Command::new("git")
            .args(["rev-list", "--count", "HEAD"])
            .current_dir(temp.path())
            .output()
            .expect("git rev-list");
        assert!(count.status.success());
        assert_eq!(String::from_utf8_lossy(&count.stdout).trim(), "3");
    }

    #[test]
    fn git_commit_without_runtime_authorization_fails_closed() {
        let _lock = git_test_env_lock();
        let temp = git_repository("git-commit-no-auth");
        fs::write(temp.path().join("README.md"), "# Changed\n").expect("write changed readme");
        let add = Command::new("git")
            .args(["add", "README.md"])
            .current_dir(temp.path())
            .status()
            .expect("git add");
        assert!(add.success());

        let commit = ToolExecutor::execute_controlled(
            temp.path(),
            ToolExecutionRequest {
                tool_id: GIT_COMMIT_TOOL_ID.to_string(),
                input: json!({"message":"Try ambient staged commit"}),
            },
        )
        .expect("git commit");
        assert_eq!(commit.status, ToolExecutionStatus::Failed);
        assert!(commit.output["reason"]
            .as_str()
            .expect("reason")
            .contains("runtime-owned commit authorization"));
        let count = Command::new("git")
            .args(["rev-list", "--count", "HEAD"])
            .current_dir(temp.path())
            .output()
            .expect("git rev-list");
        assert!(count.status.success());
        assert_eq!(String::from_utf8_lossy(&count.stdout).trim(), "1");
    }

    #[cfg(unix)]
    #[test]
    fn git_status_and_diff_do_not_run_repo_configured_helpers() {
        let _lock = git_test_env_lock();
        let temp = git_repository("git-helper-sentinels");

        let fsmonitor_sentinel = temp.path().join("fsmonitor-ran");
        let fsmonitor_script =
            write_sentinel_script(temp.path(), "fsmonitor-sentinel.sh", &fsmonitor_sentinel);
        let config = Command::new("git")
            .args(["config", "core.fsmonitor"])
            .arg(&fsmonitor_script)
            .current_dir(temp.path())
            .status()
            .expect("git config fsmonitor");
        assert!(config.success());
        fs::write(temp.path().join("README.md"), "# fsmonitor sealed\n").expect("write readme");
        let status = GitCommandExecutor::status(temp.path(), &json!({})).expect("git status");
        assert_eq!(status.status, ToolExecutionStatus::Completed);
        assert!(
            !fsmonitor_sentinel.exists(),
            "git.status must disable repo-local fsmonitor helpers"
        );

        let diff_sentinel = temp.path().join("diff-helper-ran");
        let diff_script = write_sentinel_script(temp.path(), "diff-sentinel.sh", &diff_sentinel);
        fs::write(
            temp.path().join(".gitattributes"),
            "README.md diff=sentinel\n",
        )
        .expect("write attributes");
        let config = Command::new("git")
            .args(["config", "diff.sentinel.command"])
            .arg(&diff_script)
            .current_dir(temp.path())
            .status()
            .expect("git config external diff");
        assert!(config.success());
        let config = Command::new("git")
            .args(["config", "diff.sentinel.textconv"])
            .arg(&diff_script)
            .current_dir(temp.path())
            .status()
            .expect("git config textconv");
        assert!(config.success());
        let diff = GitCommandExecutor::diff_summary(temp.path(), &json!({})).expect("git diff");
        assert_eq!(diff.status, ToolExecutionStatus::Completed);
        assert!(
            !diff_sentinel.exists(),
            "git.diff must disable external diff and textconv helpers"
        );
    }

    #[test]
    fn git_intents_require_dedicated_runtime_action_and_reject_shell_inputs() {
        let parsed = ToolIntentParser::parse_assistant_content(
            "```brownie-tool-intent\n{\"tool_requests\":[{\"tool_id\":\"git.status\",\"reason\":\"Inspect local repo state.\",\"input\":{}},{\"tool_id\":\"git.diff\",\"reason\":\"Inspect bounded diff summary.\",\"input\":{}},{\"tool_id\":\"git.commit\",\"reason\":\"Commit runtime-authorized changes.\",\"input\":{\"message\":\"Bounded commit message\"}}]}\n```",
        );
        assert_eq!(parsed.requests.len(), 3);
        assert!(parsed.rejected.is_empty());
        let policy = BuiltinModeRegistry::get("implementer").expect("policy");
        let evaluation = ToolIntentEvaluator::evaluate(&policy, parsed);
        assert_eq!(
            evaluation.items[0].required_action,
            RuntimeAction::UseGitInspectCapability
        );
        assert_eq!(
            evaluation.items[1].required_action,
            RuntimeAction::UseGitInspectCapability
        );
        assert_eq!(
            evaluation.items[2].required_action,
            RuntimeAction::UseGitCommitCapability
        );
        assert!(evaluation.items.iter().all(|item| item.allowed));

        let rejected = ToolIntentParser::parse_assistant_content(
            "```brownie-tool-intent\n{\"tool_requests\":[{\"tool_id\":\"git.status\",\"reason\":\"Try shell escape.\",\"input\":{\"command\":\"git status\",\"cwd\":\"/tmp\"}}]}\n```",
        );
        assert!(rejected.requests.is_empty());
        assert_eq!(rejected.rejected[0].code, "invalid_input");

        let rejected_message = ToolIntentParser::parse_assistant_content(
            "```brownie-tool-intent\n{\"tool_requests\":[{\"tool_id\":\"git.commit\",\"reason\":\"Try raw command.\",\"input\":{\"message\":\"x\",\"argv\":[\"commit\"]}}]}\n```",
        );
        assert!(rejected_message.requests.is_empty());
        assert_eq!(rejected_message.rejected[0].code, "invalid_input");
    }

    #[cfg(unix)]
    struct TestGitEnvGuard {
        previous_program: Option<OsString>,
        previous_timeout: Option<Duration>,
    }

    #[cfg(unix)]
    impl TestGitEnvGuard {
        fn set(program: &Path, timeout_ms: u64) -> Self {
            let previous_program = TEST_GIT_PROGRAM_OVERRIDE
                .with(|override_value| override_value.replace(Some(program.as_os_str().into())));
            let previous_timeout = TEST_GIT_TIMEOUT_OVERRIDE.with(|override_value| {
                override_value.replace(Some(Duration::from_millis(timeout_ms)))
            });
            Self {
                previous_program,
                previous_timeout,
            }
        }
    }

    #[cfg(unix)]
    impl Drop for TestGitEnvGuard {
        fn drop(&mut self) {
            TEST_GIT_PROGRAM_OVERRIDE
                .with(|override_value| override_value.replace(self.previous_program.take()));
            TEST_GIT_TIMEOUT_OVERRIDE
                .with(|override_value| override_value.replace(self.previous_timeout.take()));
        }
    }

    #[cfg(unix)]
    fn write_fake_git(root: &Path, scenario: &str) -> PathBuf {
        let script = root.join(format!("fake-git-{scenario}.sh"));
        let canonical_root = root.canonicalize().expect("canonical fake git root");
        let oversize_pid = root.join("git-oversize.pid");
        let timeout_pid = root.join("git-timeout.pid");
        let oversized_payload = "x".repeat(MAX_GIT_CAPTURE_BYTES + 4096);
        let scenario_body = match scenario {
            "oversized_no_newline" => format!(
                r#"  printf '%s\n' "$$" > "{oversize_pid}"
  printf '%s' "{oversized_payload}"
  sleep 5
  exit 0
"#,
                oversize_pid = oversize_pid.display(),
                oversized_payload = oversized_payload,
            ),
            "timeout" => format!(
                r#"  printf '%s\n' "$$" > "{timeout_pid}"
  sleep 5
  exit 0
"#,
                timeout_pid = timeout_pid.display(),
            ),
            _ => panic!("unknown fake git scenario: {scenario}"),
        };
        fs::write(
            &script,
            format!(
                r#"#!/bin/sh
while [ "$1" = "-c" ]; do
  shift
  shift
done
if [ "$1" = "rev-parse" ] && [ "$2" = "--show-toplevel" ]; then
  printf '%s\n' "{canonical_root}"
  exit 0
fi
if [ "$1" = "status" ]; then
{scenario_body}fi
if [ "$1" = "diff" ]; then
  printf '%s\n' ' README.md | 2 +-'
  exit 0
fi
printf '%s\n' '?? normal.txt'
"#,
                canonical_root = canonical_root.display(),
                scenario_body = scenario_body,
            ),
        )
        .expect("fake git script");
        let mut permissions = fs::metadata(&script).expect("metadata").permissions();
        std::os::unix::fs::PermissionsExt::set_mode(&mut permissions, 0o755);
        fs::set_permissions(&script, permissions).expect("chmod fake git");
        script
    }

    #[cfg(unix)]
    fn process_exists(pid: u32) -> bool {
        unsafe extern "C" {
            fn kill(pid: i32, sig: i32) -> i32;
        }
        unsafe { kill(pid as i32, 0) == 0 }
    }

    #[cfg(unix)]
    fn assert_fake_git_cleanup(output: &Value) {
        let kill_reason = output["process_tree_kill_reason"]
            .as_str()
            .expect("kill reason");
        assert!(
            kill_reason == "process_tree_kill_signaled"
                || kill_reason == "process_tree_kill_fallback"
                || kill_reason == "process_tree_already_exited"
        );
        if kill_reason != "process_tree_already_exited" {
            assert_eq!(output["process_tree_kill_succeeded"], true);
        }
    }

    fn test_git_commit_input(
        root: &Path,
        message: &str,
        proposal_id: &str,
        apply_id: &str,
        logical_seed: &str,
    ) -> Value {
        let expected_parent = Command::new("git")
            .args(["rev-parse", "--verify", "HEAD"])
            .current_dir(root)
            .output()
            .expect("git head");
        assert!(expected_parent.status.success());
        let expected_parent = String::from_utf8_lossy(&expected_parent.stdout)
            .trim()
            .to_string();
        let readme_bytes = fs::read(root.join("README.md")).expect("read readme");
        let post_write_sha256 = sha256_fingerprint(&readme_bytes);
        let authorized_change_set_fingerprint = sha256_fingerprint(
            json!({
                "proposal_id": proposal_id,
                "apply_id": apply_id,
                "path": "README.md",
                "operation": WorkspacePatchOperation::ReplaceFile.as_str(),
                "post_write_sha256": post_write_sha256,
            })
            .to_string()
            .as_bytes(),
        );
        let workspace_write_scope_fingerprint = sha256_fingerprint(
            json!({
                "mode_id": "implementer",
                "workspace_write_scope_count": 1,
                "path": "README.md",
            })
            .to_string()
            .as_bytes(),
        );
        json!({
            "message": message,
            "commit_authorization": {
                "version": GIT_COMMIT_AUTHORIZATION_VERSION,
                "task_id": "task.git.commit.1",
                "run_id": "run.git.commit.1",
                "journey_id": "journey.git.commit.1",
                "apply_ids": [apply_id],
                "proposal_ids": [proposal_id],
                "paths": [{
                    "path": "README.md",
                    "operation": WorkspacePatchOperation::ReplaceFile.as_str(),
                    "post_write_sha256": post_write_sha256,
                    "expected_target_absent": false,
                    "post_delete_target_exists": null,
                }],
                "expected_parent_head": expected_parent,
                "authorized_change_set_fingerprint": authorized_change_set_fingerprint,
                "workspace_write_scope_fingerprint": workspace_write_scope_fingerprint,
                "logical_invocation_id": sha256_fingerprint(logical_seed.as_bytes()),
            },
        })
    }

    #[cfg(unix)]
    fn write_sentinel_script(root: &Path, name: &str, sentinel: &Path) -> PathBuf {
        let script = root.join(name);
        fs::write(
            &script,
            format!("#!/bin/sh\nprintf ran > '{}'\nexit 0\n", sentinel.display()),
        )
        .expect("write sentinel script");
        let mut permissions = fs::metadata(&script).expect("metadata").permissions();
        std::os::unix::fs::PermissionsExt::set_mode(&mut permissions, 0o755);
        fs::set_permissions(&script, permissions).expect("chmod sentinel script");
        script
    }

    #[cfg(unix)]
    #[test]
    fn git_status_oversized_no_newline_output_fails_closed_and_cleans_up_process() {
        let _lock = git_test_env_lock();
        let temp = tempfile::tempdir().expect("tempdir");
        let fake_git = write_fake_git(temp.path(), "oversized_no_newline");
        let _guard = TestGitEnvGuard::set(&fake_git, 1_000);

        let start = Instant::now();
        let result = GitCommandExecutor::status(temp.path(), &json!({})).expect("git status");

        assert!(start.elapsed() < Duration::from_millis(1_500));
        assert_eq!(result.status, ToolExecutionStatus::Failed);
        assert_eq!(result.output["operation"], "status");
        assert_eq!(result.output["output_oversized"], true);
        assert_eq!(result.output["timed_out"], false);
        assert_fake_git_cleanup(&result.output);
        assert_eq!(result.output["reader_thread_joined"], true);
        assert_eq!(result.output["git_environment_hardened"], true);
        assert_eq!(result.output["git_prompts_disabled"], true);
        assert_eq!(result.output["git_optional_locks_disabled"], true);
        assert!(result.output["captured_bytes"].as_u64().unwrap() <= MAX_GIT_CAPTURE_BYTES as u64);
        assert!(
            result.output["git"]["summary_lines"]
                .as_array()
                .expect("summary lines")
                .len()
                <= MAX_GIT_SUMMARY_LINES
        );
        let pid = fs::read_to_string(temp.path().join("git-oversize.pid"))
            .expect("pid")
            .trim()
            .parse::<u32>()
            .expect("pid number");
        assert!(
            !process_exists(pid),
            "oversized fake git process remained alive"
        );
        let serialized = result.output.to_string();
        assert!(!serialized.contains("fake-git"));
        assert!(!serialized.contains("BROWNIE_TEST_GIT_PROGRAM"));
        assert!(!serialized.contains("command"));
    }

    #[cfg(unix)]
    #[test]
    fn git_status_repeated_timeout_and_oversize_do_not_accumulate_processes_or_threads() {
        let _lock = git_test_env_lock();
        for scenario in ["timeout", "oversized_no_newline"] {
            for attempt in 0..2 {
                let temp = tempfile::tempdir().expect("tempdir");
                let fake_git = write_fake_git(temp.path(), scenario);
                let timeout_ms = if scenario == "timeout" { 1_500 } else { 1_000 };
                let _guard = TestGitEnvGuard::set(&fake_git, timeout_ms);

                let result = GitCommandExecutor::status(temp.path(), &json!({}))
                    .unwrap_or_else(|error| panic!("{scenario} attempt {attempt}: {error}"));

                assert_eq!(result.status, ToolExecutionStatus::Failed);
                assert_fake_git_cleanup(&result.output);
                assert_eq!(result.output["reader_thread_joined"], true);
                let pid_file = if scenario == "timeout" {
                    "git-timeout.pid"
                } else {
                    "git-oversize.pid"
                };
                let pid = fs::read_to_string(temp.path().join(pid_file))
                    .unwrap_or_else(|error| {
                        panic!("{scenario} attempt {attempt}: missing pid file: {error}")
                    })
                    .trim()
                    .parse::<u32>()
                    .expect("pid number");
                assert!(
                    !process_exists(pid),
                    "{scenario} attempt {attempt}: fake git process {pid} remained alive"
                );
                if scenario == "timeout" {
                    assert_eq!(result.output["timed_out"], true);
                    assert_eq!(result.output["output_oversized"], false);
                } else {
                    assert_eq!(result.output["output_oversized"], true);
                }
            }
        }
    }

    fn git_repository(name: &str) -> tempfile::TempDir {
        let temp = tempfile::Builder::new()
            .prefix(name)
            .tempdir()
            .expect("temp git repo");
        let status = Command::new("git")
            .args(["init"])
            .current_dir(temp.path())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .expect("git init");
        assert!(status.success());
        for (key, value) in [
            ("user.email", "brownie-tools-test@example.invalid"),
            ("user.name", "Brownie Tools Test"),
        ] {
            let status = Command::new("git")
                .args(["config", key, value])
                .current_dir(temp.path())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .expect("git config");
            assert!(status.success());
        }
        fs::write(temp.path().join("README.md"), "# Initial\n").expect("write readme");
        let status = Command::new("git")
            .args(["add", "README.md"])
            .current_dir(temp.path())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .expect("git add");
        assert!(status.success());
        let status = Command::new("git")
            .args(["commit", "-qm", "init"])
            .current_dir(temp.path())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .expect("git commit");
        assert!(status.success());
        temp
    }
}
