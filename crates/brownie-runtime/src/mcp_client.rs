//! Minimal runtime-owned MCP client for stdio tools.

use std::io::{BufReader, Read, Write};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use anyhow::{bail, Context, Result};
use brownie_modepack::{ModePackMcpServerConfig, MAX_MCP_TOOL_NAME_CHARS};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

pub const MCP_PROTOCOL_VERSION: &str = "2026-07-28";
const MCP_STDIO_TIMEOUT_MS: u64 = 2_000;
const MAX_MCP_RESPONSE_BYTES: usize = 131_072;
const MAX_MCP_SCHEMA_BYTES: usize = 16_384;
const MAX_MCP_DESCRIPTION_CHARS: usize = 1_000;
const MAX_MCP_SCHEMA_SUMMARY_FIELDS: usize = 32;
const MAX_MCP_SCHEMA_TYPE_CHARS: usize = 32;
const MAX_MCP_RESULT_CONTEXT_ITEMS: usize = 8;
const MAX_MCP_RESULT_TEXT_ITEM_CHARS: usize = 2_048;
const MAX_MCP_RESULT_TEXT_TOTAL_CHARS: usize = 8_192;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct McpToolCatalogEntry {
    pub tool_id: String,
    pub server_id: String,
    pub tool_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub input_schema_fingerprint: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_schema_fingerprint: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub input_schema_summary: Vec<McpToolInputFieldSummary>,
    #[serde(default)]
    pub annotations: McpToolAnnotations,
    pub annotation_fingerprint: String,
    pub server_config_identity_fingerprint: String,
    pub protocol_version: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct McpToolAnnotations {
    #[serde(
        default,
        rename = "readOnlyHint",
        skip_serializing_if = "Option::is_none"
    )]
    pub read_only_hint: Option<bool>,
    #[serde(
        default,
        rename = "destructiveHint",
        skip_serializing_if = "Option::is_none"
    )]
    pub destructive_hint: Option<bool>,
    #[serde(
        default,
        rename = "idempotentHint",
        skip_serializing_if = "Option::is_none"
    )]
    pub idempotent_hint: Option<bool>,
    #[serde(
        default,
        rename = "openWorldHint",
        skip_serializing_if = "Option::is_none"
    )]
    pub open_world_hint: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct McpToolInputFieldSummary {
    pub name: String,
    #[serde(default)]
    pub required: bool,
    #[serde(rename = "type")]
    pub value_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct McpToolCatalog {
    pub server_id: String,
    pub server_config_identity_fingerprint: String,
    pub protocol_version: String,
    pub tools: Vec<McpToolCatalogEntry>,
    pub catalog_fingerprint: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum McpToolCallStatus {
    ToolSucceeded,
    ToolReturnedError,
}

impl McpToolCallStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ToolSucceeded => "ToolSucceeded",
            Self::ToolReturnedError => "ToolReturnedError",
        }
    }

    pub fn is_success(self) -> bool {
        matches!(self, Self::ToolSucceeded)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct McpToolCallResult {
    pub status: McpToolCallStatus,
    pub output: Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum McpToolCallFailureKind {
    ProtocolFailed,
    TimedOut,
    Failed,
    InputRequiredUnsupported,
}

impl McpToolCallFailureKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ProtocolFailed => "ProtocolFailed",
            Self::TimedOut => "TimedOut",
            Self::Failed => "Failed",
            Self::InputRequiredUnsupported => "InputRequiredUnsupported",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct McpToolCallFailure {
    pub kind: McpToolCallFailureKind,
    pub message: String,
}

impl McpToolCallFailure {
    fn protocol_failed(message: impl Into<String>) -> Self {
        Self {
            kind: McpToolCallFailureKind::ProtocolFailed,
            message: message.into(),
        }
    }

    fn timed_out(message: impl Into<String>) -> Self {
        Self {
            kind: McpToolCallFailureKind::TimedOut,
            message: message.into(),
        }
    }

    fn failed(message: impl Into<String>) -> Self {
        Self {
            kind: McpToolCallFailureKind::Failed,
            message: message.into(),
        }
    }

    fn input_required_unsupported(message: impl Into<String>) -> Self {
        Self {
            kind: McpToolCallFailureKind::InputRequiredUnsupported,
            message: message.into(),
        }
    }

    fn from_stdio_error(error: anyhow::Error) -> Self {
        let message = error.to_string();
        if message.contains("timed out") {
            Self::timed_out(message)
        } else {
            Self::protocol_failed(message)
        }
    }
}

pub fn normalized_tool_id(server_id: &str, tool_name: &str) -> String {
    format!("mcp.{server_id}.{tool_name}")
}

pub fn split_normalized_tool_id(tool_id: &str) -> Option<(&str, &str)> {
    let rest = tool_id.strip_prefix("mcp.")?;
    let (server_id, tool_name) = rest.split_once('.')?;
    if server_id.is_empty() || tool_name.is_empty() || tool_name.contains('.') {
        return None;
    }
    Some((server_id, tool_name))
}

pub fn list_tools(config: &ModePackMcpServerConfig) -> Result<McpToolCatalog> {
    let response = stdio_request(
        config,
        json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/list",
            "params": {
                "_meta": client_meta(),
            }
        }),
    )?;
    validate_response_envelope(&response, 1, "MCP tools/list")?;
    if response.get("error").is_some() {
        bail!("MCP tools/list returned protocol error");
    }
    let result = response
        .get("result")
        .and_then(Value::as_object)
        .context("MCP tools/list missing result object")?;
    validate_complete_result_type(result, "MCP tools/list")?;
    let tools = result
        .get("tools")
        .and_then(Value::as_array)
        .context("MCP tools/list missing tools array")?;
    let mut entries = Vec::with_capacity(tools.len());
    let mut seen = std::collections::HashSet::new();
    for tool in tools {
        let object = tool
            .as_object()
            .context("MCP tools/list tool entry must be an object")?;
        let name = object
            .get("name")
            .and_then(Value::as_str)
            .context("MCP tool missing name")?;
        validate_tool_name(name)?;
        if !seen.insert(name.to_string()) {
            bail!("MCP tools/list returned duplicate tool name: {name}");
        }
        let input_schema = object
            .get("inputSchema")
            .filter(|value| value.is_object())
            .context("MCP tool inputSchema must be an object")?;
        let input_schema_fingerprint = bounded_schema_fingerprint(input_schema)?;
        let input_schema_summary = bounded_input_schema_summary(input_schema)?;
        let output_schema_fingerprint = object
            .get("outputSchema")
            .map(|schema| {
                if !schema.is_object() {
                    bail!("MCP tool outputSchema must be an object");
                }
                bounded_schema_fingerprint(schema)
            })
            .transpose()?;
        let description = object
            .get("description")
            .and_then(Value::as_str)
            .map(|value| {
                value
                    .chars()
                    .take(MAX_MCP_DESCRIPTION_CHARS)
                    .collect::<String>()
            });
        let annotations = bounded_tool_annotations(object)?;
        let annotation_fingerprint = fingerprint_json(&json!(annotations));
        entries.push(McpToolCatalogEntry {
            tool_id: normalized_tool_id(&config.server_id, name),
            server_id: config.server_id.clone(),
            tool_name: name.to_string(),
            description,
            input_schema_fingerprint,
            output_schema_fingerprint,
            input_schema_summary,
            annotations,
            annotation_fingerprint,
            server_config_identity_fingerprint: config.config_identity_fingerprint.clone(),
            protocol_version: MCP_PROTOCOL_VERSION.to_string(),
        });
    }
    entries.sort_by(|left, right| left.tool_id.cmp(&right.tool_id));
    let catalog_fingerprint = fingerprint_json(&json!({
        "version": "brownie_mcp_tool_catalog_v1",
        "server_id": config.server_id,
        "server_config_identity_fingerprint": config.config_identity_fingerprint,
        "protocol_version": MCP_PROTOCOL_VERSION,
        "tools": entries,
    }));
    Ok(McpToolCatalog {
        server_id: config.server_id.clone(),
        server_config_identity_fingerprint: config.config_identity_fingerprint.clone(),
        protocol_version: MCP_PROTOCOL_VERSION.to_string(),
        tools: entries,
        catalog_fingerprint,
    })
}

pub fn call_tool(
    config: &ModePackMcpServerConfig,
    tool_name: &str,
    arguments: Value,
) -> std::result::Result<McpToolCallResult, McpToolCallFailure> {
    validate_tool_name(tool_name).map_err(|error| McpToolCallFailure::failed(error.to_string()))?;
    if !arguments.is_object() {
        return Err(McpToolCallFailure::failed(
            "MCP tools/call arguments must be an object",
        ));
    }
    let response = stdio_request(
        config,
        json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "_meta": client_meta(),
                "name": tool_name,
                "arguments": arguments,
            }
        }),
    )
    .map_err(McpToolCallFailure::from_stdio_error)?;
    validate_response_envelope(&response, 1, "MCP tools/call")
        .map_err(|error| McpToolCallFailure::protocol_failed(error.to_string()))?;
    if response.get("error").is_some() {
        return Err(McpToolCallFailure::protocol_failed(
            "MCP tools/call returned protocol error",
        ));
    }
    let result = response
        .get("result")
        .cloned()
        .ok_or_else(|| McpToolCallFailure::protocol_failed("MCP tools/call missing result"))?;
    if !result.is_object() {
        return Err(McpToolCallFailure::failed(
            "MCP tools/call result must be an object",
        ));
    }
    let result_object = result.as_object().expect("checked object");
    let result_type = match classify_call_result_type(result_object)? {
        McpCallResultType::Complete(result_type) => result_type,
        McpCallResultType::InputRequired => {
            return Err(McpToolCallFailure::input_required_unsupported(
                "MCP tools/call input_required results are not supported in v0",
            ));
        }
    };
    let Some(content) = result.get("content").and_then(Value::as_array) else {
        return Err(McpToolCallFailure::failed(
            "MCP tools/call result content must be an array",
        ));
    };
    let is_error = match result.get("isError") {
        Some(Value::Bool(value)) => *value,
        None => false,
        Some(_) => {
            return Err(McpToolCallFailure::failed(
                "MCP tools/call result isError must be a boolean when present",
            ))
        }
    };
    let status = if is_error {
        McpToolCallStatus::ToolReturnedError
    } else {
        McpToolCallStatus::ToolSucceeded
    };
    let content_item_count = content.len();
    let (content_items, content_truncated, text_chars, materialized_text_chars) =
        bounded_result_context_items(&result);
    Ok(McpToolCallResult {
        status,
        output: json!({
            "server_id": config.server_id,
            "tool_name": tool_name,
            "protocol_version": MCP_PROTOCOL_VERSION,
            "server_config_identity_fingerprint": config.config_identity_fingerprint,
            "result_fingerprint": fingerprint_json(&result),
            "is_error": is_error,
            "protocol_status": "ProtocolSucceeded",
            "tool_status": status.as_str(),
            "execution_status": status.as_str(),
            "result_type": result_type.value,
            "result_type_source": result_type.source,
            "retry_policy": if is_error { "policy_controlled" } else { "success_replay_allowed" },
            "content_item_count": content_item_count,
            "materialized_content_item_count": content_items.len(),
            "content_truncated": content_truncated,
            "text_chars": text_chars,
            "materialized_text_chars": materialized_text_chars,
            "max_content_items": MAX_MCP_RESULT_CONTEXT_ITEMS,
            "max_text_item_chars": MAX_MCP_RESULT_TEXT_ITEM_CHARS,
            "max_total_text_chars": MAX_MCP_RESULT_TEXT_TOTAL_CHARS,
            "content_items": content_items,
        }),
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct McpCompleteResultType {
    value: &'static str,
    source: &'static str,
}

enum McpCallResultType {
    Complete(McpCompleteResultType),
    InputRequired,
}

fn classify_call_result_type(
    result: &Map<String, Value>,
) -> std::result::Result<McpCallResultType, McpToolCallFailure> {
    match result.get("resultType") {
        Some(Value::String(value)) if value == "complete" => {
            Ok(McpCallResultType::Complete(McpCompleteResultType {
                value: "complete",
                source: "wire",
            }))
        }
        Some(Value::String(value)) if value == "input_required" => {
            Ok(McpCallResultType::InputRequired)
        }
        Some(Value::String(_)) => Err(McpToolCallFailure::protocol_failed(
            "MCP tools/call returned unsupported resultType",
        )),
        Some(_) => Err(McpToolCallFailure::protocol_failed(
            "MCP tools/call resultType must be a string",
        )),
        None => Ok(McpCallResultType::Complete(McpCompleteResultType {
            value: "complete",
            source: "backward_compat_absent",
        })),
    }
}

fn validate_complete_result_type(result: &Map<String, Value>, operation: &str) -> Result<()> {
    match result.get("resultType") {
        Some(Value::String(value)) if value == "complete" => Ok(()),
        Some(Value::String(value)) if value == "input_required" => {
            bail!("{operation} input_required results are not supported in v0")
        }
        Some(Value::String(_)) => bail!("{operation} returned unsupported resultType"),
        Some(_) => bail!("{operation} resultType must be a string"),
        None => Ok(()),
    }
}

fn bounded_result_context_items(result: &Value) -> (Vec<Value>, bool, usize, usize) {
    let Some(content) = result.get("content").and_then(Value::as_array) else {
        return (Vec::new(), false, 0, 0);
    };
    let mut items = Vec::new();
    let mut text_chars = 0usize;
    let mut materialized_text_chars = 0usize;
    let mut content_truncated = content.len() > MAX_MCP_RESULT_CONTEXT_ITEMS;
    for (index, item) in content
        .iter()
        .take(MAX_MCP_RESULT_CONTEXT_ITEMS)
        .enumerate()
    {
        let item_type = item
            .get("type")
            .and_then(Value::as_str)
            .filter(|value| {
                !value.is_empty()
                    && value.chars().count() <= MAX_MCP_SCHEMA_TYPE_CHARS
                    && value
                        .chars()
                        .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
            })
            .unwrap_or("unknown");
        if item_type == "text" {
            let text = item.get("text").and_then(Value::as_str).unwrap_or_default();
            let item_text_chars = text.chars().count();
            text_chars = text_chars.saturating_add(item_text_chars);
            let remaining_total =
                MAX_MCP_RESULT_TEXT_TOTAL_CHARS.saturating_sub(materialized_text_chars);
            let allowed_chars = remaining_total.min(MAX_MCP_RESULT_TEXT_ITEM_CHARS);
            let bounded_text = text.chars().take(allowed_chars).collect::<String>();
            let bounded_chars = bounded_text.chars().count();
            materialized_text_chars = materialized_text_chars.saturating_add(bounded_chars);
            let truncated = bounded_chars < item_text_chars;
            content_truncated |= truncated;
            items.push(json!({
                "index": index,
                "type": "text",
                "text": bounded_text,
                "text_chars": item_text_chars,
                "materialized_text_chars": bounded_chars,
                "truncated": truncated,
            }));
        } else {
            content_truncated = true;
            items.push(json!({
                "index": index,
                "type": item_type,
                "unsupported": true,
            }));
        }
    }
    (
        items,
        content_truncated,
        text_chars,
        materialized_text_chars,
    )
}

fn stdio_request(config: &ModePackMcpServerConfig, request: Value) -> Result<Value> {
    if config.transport != "stdio" {
        bail!("unsupported MCP transport");
    }
    validate_stdio_command_boundary(config)?;
    let mut command = Command::new(&config.command);
    command
        .args(&config.args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    configure_hardened_mcp_stdio_process(&mut command);
    configure_process_tree_timeout(&mut command);
    let mut child = command
        .spawn()
        .with_context(|| format!("failed to start MCP stdio server {}", config.server_id))?;
    {
        let stdin = child
            .stdin
            .as_mut()
            .context("MCP server stdin unavailable")?;
        writeln!(stdin, "{}", request)?;
    }
    drop(child.stdin.take());
    let stdout = child
        .stdout
        .take()
        .context("MCP server stdout unavailable")?;
    let (tx, rx) = mpsc::channel();
    let reader = thread::spawn(move || {
        let result = read_stdio_response(stdout);
        let _ = tx.send(result);
    });
    let line = match rx.recv_timeout(Duration::from_millis(MCP_STDIO_TIMEOUT_MS)) {
        Ok(Ok(line)) => line,
        Ok(Err(error)) => {
            let _ = terminate_process_tree(&mut child);
            let _ = reader.join();
            return Err(error);
        }
        Err(mpsc::RecvTimeoutError::Timeout) => {
            let (succeeded, reason) = terminate_process_tree(&mut child);
            let _ = reader.join();
            bail!(
                "MCP stdio request timed out; process_tree_kill_attempted=true process_tree_kill_succeeded={succeeded} process_tree_kill_reason={reason}"
            );
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            let _ = terminate_process_tree(&mut child);
            let _ = reader.join();
            bail!("MCP stdio response reader disconnected");
        }
    };
    let _ = terminate_process_tree(&mut child);
    let _ = reader.join();
    if line.trim().is_empty() {
        bail!("MCP stdio server returned empty response");
    }
    serde_json::from_str(&line).context("MCP stdio response is not valid JSON")
}

fn validate_stdio_command_boundary(config: &ModePackMcpServerConfig) -> Result<()> {
    let path = Path::new(&config.command);
    if !path.is_absolute() {
        bail!("MCP stdio command must be an absolute executable path; PATH lookup is not allowed");
    }
    if path.components().any(|component| {
        matches!(
            component,
            std::path::Component::ParentDir | std::path::Component::CurDir
        )
    }) {
        bail!("MCP stdio command must not contain relative path components");
    }
    Ok(())
}

fn configure_hardened_mcp_stdio_process(command: &mut Command) {
    command.env_clear();
    command.current_dir(mcp_stdio_neutral_cwd());
}

fn mcp_stdio_neutral_cwd() -> &'static Path {
    #[cfg(windows)]
    {
        Path::new(r"C:\")
    }
    #[cfg(not(windows))]
    {
        Path::new("/")
    }
}

fn read_stdio_response(stdout: std::process::ChildStdout) -> Result<String> {
    let mut reader = BufReader::new(stdout);
    let mut bytes = Vec::new();
    let mut chunk = [0_u8; 4096];
    loop {
        let read = reader
            .read(&mut chunk)
            .context("failed to read MCP stdio response")?;
        if read == 0 {
            break;
        }
        if let Some(newline_index) = chunk[..read].iter().position(|byte| *byte == b'\n') {
            let line_bytes = newline_index + 1;
            if bytes.len().saturating_add(line_bytes) > MAX_MCP_RESPONSE_BYTES {
                bail!("MCP stdio response exceeds byte limit");
            }
            bytes.extend_from_slice(&chunk[..line_bytes]);
            break;
        }
        if bytes.len().saturating_add(read) > MAX_MCP_RESPONSE_BYTES {
            bail!("MCP stdio response exceeds byte limit");
        }
        bytes.extend_from_slice(&chunk[..read]);
    }
    String::from_utf8(bytes).context("MCP stdio response is not valid UTF-8")
}

#[cfg(unix)]
fn configure_process_tree_timeout(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

#[cfg(not(unix))]
fn configure_process_tree_timeout(_command: &mut Command) {}

#[cfg(unix)]
fn terminate_process_tree(child: &mut Child) -> (bool, &'static str) {
    unsafe extern "C" {
        fn kill(pid: i32, sig: i32) -> i32;
    }
    const SIGKILL: i32 = 9;
    let pid = child.id() as i32;
    let signaled = unsafe { kill(-pid, SIGKILL) == 0 };
    let _ = child.kill();
    let _ = child.wait();
    if signaled {
        (true, "process_tree_kill_signaled")
    } else {
        (false, "process_tree_kill_failed")
    }
}

#[cfg(not(unix))]
fn terminate_process_tree(child: &mut Child) -> (bool, &'static str) {
    let killed = child.kill().is_ok();
    let _ = child.wait();
    if killed {
        (true, "process_kill_signaled")
    } else {
        (false, "process_tree_timeout_unsupported")
    }
}

fn validate_response_envelope(response: &Value, request_id: i64, context: &str) -> Result<()> {
    let object = response
        .as_object()
        .with_context(|| format!("{context} response must be a JSON-RPC object"))?;
    if object.get("jsonrpc").and_then(Value::as_str) != Some("2.0") {
        bail!("{context} response has invalid jsonrpc version");
    }
    if object.get("id").and_then(Value::as_i64) != Some(request_id) {
        bail!("{context} response id does not match request id");
    }
    let has_result = object.contains_key("result");
    let has_error = object.contains_key("error");
    match (has_result, has_error) {
        (true, true) => bail!("{context} response cannot contain both result and error"),
        (false, false) => bail!("{context} response missing result or error"),
        _ => Ok(()),
    }
}

fn validate_tool_name(name: &str) -> Result<()> {
    if name.is_empty() || name.chars().count() > MAX_MCP_TOOL_NAME_CHARS {
        bail!("MCP tool name is outside bounded identifier limits");
    }
    if !name
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' || ch == '.')
    {
        bail!("MCP tool name is malformed");
    }
    Ok(())
}

fn bounded_schema_fingerprint(schema: &Value) -> Result<String> {
    let canonical = canonical_json(schema);
    let text = canonical.to_string();
    if text.len() > MAX_MCP_SCHEMA_BYTES {
        bail!("MCP tool schema exceeds byte limit");
    }
    Ok(fingerprint_bytes(text.as_bytes()))
}

fn bounded_input_schema_summary(schema: &Value) -> Result<Vec<McpToolInputFieldSummary>> {
    let object = schema
        .as_object()
        .context("MCP input schema must be an object")?;
    let required = object
        .get("required")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(ToString::to_string)
                .collect::<std::collections::HashSet<_>>()
        })
        .unwrap_or_default();
    let Some(properties) = object.get("properties").and_then(Value::as_object) else {
        return Ok(Vec::new());
    };
    if properties.len() > MAX_MCP_SCHEMA_SUMMARY_FIELDS {
        bail!("MCP input schema summary exceeds field limit");
    }
    let mut names = properties.keys().collect::<Vec<_>>();
    names.sort();
    let mut fields = Vec::with_capacity(names.len());
    for name in names {
        validate_tool_name(name)?;
        let value_type = properties
            .get(name)
            .and_then(|property| property.get("type"))
            .and_then(Value::as_str)
            .filter(|value| {
                !value.is_empty()
                    && value.chars().count() <= MAX_MCP_SCHEMA_TYPE_CHARS
                    && value
                        .chars()
                        .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
            })
            .unwrap_or("unknown")
            .to_string();
        fields.push(McpToolInputFieldSummary {
            name: name.clone(),
            required: required.contains(name),
            value_type,
        });
    }
    Ok(fields)
}

fn bounded_tool_annotations(object: &Map<String, Value>) -> Result<McpToolAnnotations> {
    let Some(value) = object.get("annotations") else {
        return Ok(McpToolAnnotations::default());
    };
    let annotations = value
        .as_object()
        .context("MCP tool annotations must be an object when present")?;
    Ok(McpToolAnnotations {
        read_only_hint: bounded_annotation_bool(annotations, "readOnlyHint")?,
        destructive_hint: bounded_annotation_bool(annotations, "destructiveHint")?,
        idempotent_hint: bounded_annotation_bool(annotations, "idempotentHint")?,
        open_world_hint: bounded_annotation_bool(annotations, "openWorldHint")?,
    })
}

fn bounded_annotation_bool(annotations: &Map<String, Value>, field: &str) -> Result<Option<bool>> {
    match annotations.get(field) {
        Some(Value::Bool(value)) => Ok(Some(*value)),
        Some(_) => bail!("MCP tool annotation {field} must be a boolean when present"),
        None => Ok(None),
    }
}

fn fingerprint_json(value: &Value) -> String {
    fingerprint_bytes(canonical_json(value).to_string().as_bytes())
}

fn fingerprint_bytes(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    format!(
        "sha256:{}",
        digest
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    )
}

fn canonical_json(value: &Value) -> Value {
    match value {
        Value::Object(object) => {
            let mut sorted = Map::new();
            let mut keys = object.keys().collect::<Vec<_>>();
            keys.sort();
            for key in keys {
                sorted.insert(key.clone(), canonical_json(&object[key]));
            }
            Value::Object(sorted)
        }
        Value::Array(items) => Value::Array(items.iter().map(canonical_json).collect()),
        other => other.clone(),
    }
}

fn client_meta() -> Value {
    json!({
        "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION,
        "io.modelcontextprotocol/clientInfo": {
            "name": "brownie-runtime",
            "version": env!("CARGO_PKG_VERSION"),
        },
        "io.modelcontextprotocol/clientCapabilities": {},
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(unix)]
    fn mcp_stdio_child_does_not_inherit_ambient_environment() {
        let env_path = Path::new("/usr/bin/env");
        if !env_path.exists() {
            return;
        }
        std::env::set_var("BROWNIE_MCP_TEST_SECRET", "must-not-leak");
        let mut command = Command::new(env_path);
        command.stdout(Stdio::piped()).stderr(Stdio::piped());
        configure_hardened_mcp_stdio_process(&mut command);

        let output = command.output().expect("run env");

        std::env::remove_var("BROWNIE_MCP_TEST_SECRET");
        assert!(output.status.success());
        let stdout = String::from_utf8_lossy(&output.stdout);
        assert!(!stdout.contains("BROWNIE_MCP_TEST_SECRET"));
        assert!(!stdout.contains("must-not-leak"));
    }

    #[test]
    #[cfg(unix)]
    fn mcp_stdio_child_uses_neutral_cwd() {
        let pwd_path = Path::new("/bin/pwd");
        if !pwd_path.exists() {
            return;
        }
        let mut command = Command::new(pwd_path);
        command.stdout(Stdio::piped()).stderr(Stdio::piped());
        configure_hardened_mcp_stdio_process(&mut command);

        let output = command.output().expect("run pwd");

        assert!(output.status.success());
        assert_eq!(
            String::from_utf8_lossy(&output.stdout).trim(),
            mcp_stdio_neutral_cwd().to_string_lossy()
        );
    }

    #[test]
    fn mcp_stdio_rejects_path_lookup_at_runtime_boundary() {
        let config = ModePackMcpServerConfig {
            server_id: "local".to_string(),
            transport: "stdio".to_string(),
            command: "npx".to_string(),
            args: vec![],
            config_identity_fingerprint: "sha256:test".to_string(),
        };

        let error = validate_stdio_command_boundary(&config)
            .expect_err("relative command should fail closed")
            .to_string();

        assert!(error.contains("absolute executable path"));
    }
}
