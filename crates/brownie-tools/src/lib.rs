//! Runtime tool abstraction crate.

use std::fs;
use std::path::{Component, Path};

use anyhow::{bail, Context};
use brownie_agentmodes::{CompiledModePolicy, RuntimeAction, RuntimePermissionGate};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const WORKSPACE_READ_TOOL_ID: &str = "workspace.read";
pub const WORKSPACE_WRITE_TOOL_ID: &str = "workspace.write";
pub const SUBTASK_SPAWN_TOOL_ID: &str = "subtask.spawn";
pub const MAX_WORKSPACE_READ_BYTES: usize = 65_536;
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
}

impl WorkspacePatchOperation {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::ReplaceFile => "replace_file",
            Self::CreateFile => "create_file",
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
    if operation != "replace_file" && operation != "create_file" {
        return Err("workspace.write input.operation must be replace_file or create_file.");
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
            &["test", "check", "verify", "run", "検証", "テスト", "実行"],
        ) {
            items.push(plan_item(
                "process.exec",
                "Goal suggests running tests or checks.",
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
        assert!(ids.contains(&"process.exec"));
        assert!(ids.contains(&"subtask.spawn"));
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
}
