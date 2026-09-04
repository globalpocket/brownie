//! Minimal runtime-owned MCP client for stdio tools.

use std::fs::File;
use std::io::{BufReader, Read, Write};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use anyhow::{bail, Context, Result};
use brownie_modepack::{
    ModePackMcpSecretEnvBinding, ModePackMcpServerConfig, MAX_MCP_SECRET_REF_CHARS,
    MAX_MCP_TOOL_NAME_CHARS,
};
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
const MAX_MCP_SCHEMA_DEPTH: usize = 12;
const MAX_MCP_SCHEMA_PROPERTIES: usize = 64;
const MAX_MCP_SCHEMA_ENUM_VALUES: usize = 64;
const MAX_MCP_RESULT_CONTEXT_ITEMS: usize = 8;
const MAX_MCP_RESULT_TEXT_ITEM_CHARS: usize = 2_048;
const MAX_MCP_RESULT_TEXT_TOTAL_CHARS: usize = 8_192;
const MAX_MCP_SECRET_VALUE_BYTES: usize = 8_192;
const MAX_MCP_EXECUTABLE_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Debug, Clone, Copy)]
struct McpStdioDeadline {
    expires_at: Instant,
    total_budget: Duration,
}

impl McpStdioDeadline {
    fn after(total_budget: Duration) -> Self {
        Self {
            expires_at: Instant::now() + total_budget,
            total_budget,
        }
    }

    fn remaining(self) -> Option<Duration> {
        self.expires_at.checked_duration_since(Instant::now())
    }

    fn remaining_or_zero(self) -> Duration {
        self.remaining().unwrap_or(Duration::ZERO)
    }

    fn is_expired(self) -> bool {
        self.remaining().is_none()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct McpToolCatalogEntry {
    pub tool_id: String,
    pub server_id: String,
    pub tool_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub input_schema_fingerprint: String,
    #[serde(skip)]
    pub input_schema: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_schema_fingerprint: Option<String>,
    #[serde(skip)]
    pub output_schema: Option<Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub input_schema_summary: Vec<McpToolInputFieldSummary>,
    #[serde(default)]
    pub annotations: McpToolAnnotations,
    pub annotation_fingerprint: String,
    pub server_config_identity_fingerprint: String,
    pub server_executable_identity_fingerprint: String,
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
    pub server_executable_identity_fingerprint: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub server_secret_reference_fingerprints: Vec<String>,
    pub protocol_version: String,
    pub tools: Vec<McpToolCatalogEntry>,
    pub catalog_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct McpExecutableIdentity {
    pub executable_identity_fingerprint: String,
    pub executable_content_fingerprint: String,
    pub executable_size_bytes: u64,
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
    pub metadata: Option<Value>,
}

impl McpToolCallFailure {
    fn protocol_failed(message: impl Into<String>) -> Self {
        Self {
            kind: McpToolCallFailureKind::ProtocolFailed,
            message: message.into(),
            metadata: None,
        }
    }

    fn timed_out(message: impl Into<String>) -> Self {
        Self {
            kind: McpToolCallFailureKind::TimedOut,
            message: message.into(),
            metadata: None,
        }
    }

    fn failed(message: impl Into<String>) -> Self {
        Self {
            kind: McpToolCallFailureKind::Failed,
            message: message.into(),
            metadata: None,
        }
    }

    fn failed_with_metadata(message: impl Into<String>, metadata: Value) -> Self {
        Self {
            kind: McpToolCallFailureKind::Failed,
            message: message.into(),
            metadata: Some(metadata),
        }
    }

    fn input_required_unsupported(message: impl Into<String>) -> Self {
        Self {
            kind: McpToolCallFailureKind::InputRequiredUnsupported,
            message: message.into(),
            metadata: None,
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

pub trait McpSecretResolver {
    fn resolve_secret(&self, secret_ref: &str) -> Option<String>;
}

#[derive(Debug, Default)]
pub struct EnvMcpSecretResolver;

impl McpSecretResolver for EnvMcpSecretResolver {
    fn resolve_secret(&self, secret_ref: &str) -> Option<String> {
        std::env::var(secret_ref).ok()
    }
}

pub fn list_tools(config: &ModePackMcpServerConfig) -> Result<McpToolCatalog> {
    list_tools_with_secret_resolver(config, &EnvMcpSecretResolver)
}

pub fn list_tools_with_secret_resolver(
    config: &ModePackMcpServerConfig,
    secret_resolver: &dyn McpSecretResolver,
) -> Result<McpToolCatalog> {
    let executable_identity = materialize_mcp_executable_identity(config)?;
    let deadline = McpStdioDeadline::after(Duration::from_millis(MCP_STDIO_TIMEOUT_MS));
    let response = stdio_request(
        config,
        secret_resolver,
        Some(&executable_identity),
        deadline,
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
        validate_mcp_schema_subset(input_schema, "MCP tool inputSchema", true)?;
        let input_schema_fingerprint = bounded_schema_fingerprint(input_schema)?;
        let input_schema_summary = bounded_input_schema_summary(input_schema)?;
        let output_schema_fingerprint = object
            .get("outputSchema")
            .map(|schema| {
                if !schema.is_object() {
                    bail!("MCP tool outputSchema must be an object");
                }
                validate_mcp_schema_subset(schema, "MCP tool outputSchema", true)?;
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
            input_schema: input_schema.clone(),
            output_schema_fingerprint,
            output_schema: object.get("outputSchema").cloned(),
            input_schema_summary,
            annotations,
            annotation_fingerprint,
            server_config_identity_fingerprint: config.config_identity_fingerprint.clone(),
            server_executable_identity_fingerprint: executable_identity
                .executable_identity_fingerprint
                .clone(),
            protocol_version: MCP_PROTOCOL_VERSION.to_string(),
        });
    }
    entries.sort_by(|left, right| left.tool_id.cmp(&right.tool_id));
    let catalog_fingerprint = fingerprint_json(&json!({
        "version": "brownie_mcp_tool_catalog_v1",
        "server_id": config.server_id,
        "server_config_identity_fingerprint": config.config_identity_fingerprint,
        "server_executable_identity_fingerprint": executable_identity.executable_identity_fingerprint,
        "server_secret_reference_fingerprints": secret_reference_fingerprints(config),
        "protocol_version": MCP_PROTOCOL_VERSION,
        "tools": entries,
    }));
    Ok(McpToolCatalog {
        server_id: config.server_id.clone(),
        server_config_identity_fingerprint: config.config_identity_fingerprint.clone(),
        server_executable_identity_fingerprint: executable_identity.executable_identity_fingerprint,
        server_secret_reference_fingerprints: secret_reference_fingerprints(config),
        protocol_version: MCP_PROTOCOL_VERSION.to_string(),
        tools: entries,
        catalog_fingerprint,
    })
}

pub fn validate_tool_input_against_schema(
    entry: &McpToolCatalogEntry,
    input: &Value,
) -> Result<Value> {
    validate_json_value_against_schema(&entry.input_schema, input, "$", "input")?;
    Ok(json!({
        "schema_validation_version": 1,
        "input_schema_fingerprint": entry.input_schema_fingerprint,
        "validated_value_fingerprint": fingerprint_json(input),
        "status": "validated",
    }))
}

pub fn call_tool(
    config: &ModePackMcpServerConfig,
    entry: &McpToolCatalogEntry,
    arguments: Value,
) -> std::result::Result<McpToolCallResult, McpToolCallFailure> {
    call_tool_with_secret_resolver(config, entry, arguments, &EnvMcpSecretResolver)
}

pub fn call_tool_with_secret_resolver(
    config: &ModePackMcpServerConfig,
    entry: &McpToolCatalogEntry,
    arguments: Value,
    secret_resolver: &dyn McpSecretResolver,
) -> std::result::Result<McpToolCallResult, McpToolCallFailure> {
    let tool_name = entry.tool_name.as_str();
    validate_tool_name(tool_name).map_err(|error| McpToolCallFailure::failed(error.to_string()))?;
    if !arguments.is_object() {
        return Err(McpToolCallFailure::failed(
            "MCP tools/call arguments must be an object",
        ));
    }
    let executable_identity = materialize_mcp_executable_identity(config)
        .map_err(|error| McpToolCallFailure::protocol_failed(error.to_string()))?;
    if executable_identity.executable_identity_fingerprint
        != entry.server_executable_identity_fingerprint
    {
        return Err(McpToolCallFailure::failed_with_metadata(
            "MCP stdio executable identity drifted before tools/call",
            json!({
                "server_executable_identity_fingerprint": executable_identity.executable_identity_fingerprint,
                "expected_server_executable_identity_fingerprint": entry.server_executable_identity_fingerprint,
            }),
        ));
    }
    let deadline = McpStdioDeadline::after(Duration::from_millis(MCP_STDIO_TIMEOUT_MS));
    let response = stdio_request(
        config,
        secret_resolver,
        Some(&executable_identity),
        deadline,
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
    let output_schema_validation = if status.is_success() {
        match validate_tool_output_against_schema(entry, &result) {
            Ok(evidence) => evidence,
            Err(error) => {
                let reason = bounded_failure_message(error.to_string());
                return Err(McpToolCallFailure::failed_with_metadata(
                    "MCP tools/call output schema validation failed",
                    json!({
                        "output_schema_validation": {
                            "schema_validation_version": 1,
                            "status": "failed",
                            "reason": reason,
                            "output_schema_fingerprint": entry.output_schema_fingerprint,
                            "result_fingerprint": fingerprint_json(&result),
                            "validation_target": "structuredContent_or_empty_object",
                        }
                    }),
                ));
            }
        }
    } else {
        json!({
            "schema_validation_version": 1,
            "status": "not_applicable",
            "reason": "tool_error_result",
        })
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
            "server_executable_identity_fingerprint": executable_identity.executable_identity_fingerprint,
            "server_secret_reference_fingerprints": secret_reference_fingerprints(config),
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
            "output_schema_validation": output_schema_validation,
            "content_items": content_items,
        }),
    })
}

fn bounded_failure_message(message: String) -> String {
    message.chars().take(240).collect()
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

fn stdio_request(
    config: &ModePackMcpServerConfig,
    secret_resolver: &dyn McpSecretResolver,
    expected_executable_identity: Option<&McpExecutableIdentity>,
    deadline: McpStdioDeadline,
    request: Value,
) -> Result<Value> {
    if config.transport != "stdio" {
        bail!("unsupported MCP transport");
    }
    let executable_identity = materialize_mcp_executable_identity(config)?;
    if let Some(expected) = expected_executable_identity {
        if executable_identity.executable_identity_fingerprint
            != expected.executable_identity_fingerprint
        {
            bail!("MCP stdio executable identity drifted before launch");
        }
    }
    let mut command = Command::new(&config.command);
    command
        .args(&config.args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    configure_hardened_mcp_stdio_process(&mut command);
    configure_mcp_secret_environment(&mut command, config, secret_resolver)?;
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
    let line = match rx.recv_timeout(deadline.remaining_or_zero()) {
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
    wait_for_stdio_child_exit_or_timeout(&mut child, deadline)?;
    let _ = reader.join();
    if line.trim().is_empty() {
        bail!("MCP stdio server returned empty response");
    }
    serde_json::from_str(&line).context("MCP stdio response is not valid JSON")
}

fn wait_for_stdio_child_exit_or_timeout(
    child: &mut Child,
    deadline: McpStdioDeadline,
) -> Result<()> {
    loop {
        if child
            .try_wait()
            .context("failed to inspect MCP stdio child exit")?
            .is_some()
        {
            return Ok(());
        }
        if deadline.is_expired() {
            let (succeeded, reason) = terminate_process_tree(child);
            bail!(
                "MCP stdio request timed out while waiting for child exit; timeout_budget_ms={} process_tree_kill_attempted=true process_tree_kill_succeeded={succeeded} process_tree_kill_reason={reason}",
                deadline.total_budget.as_millis()
            );
        }
        thread::sleep(deadline.remaining_or_zero().min(Duration::from_millis(10)));
    }
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

fn materialize_mcp_executable_identity(
    config: &ModePackMcpServerConfig,
) -> Result<McpExecutableIdentity> {
    validate_stdio_command_boundary(config)?;
    let path = Path::new(&config.command);
    let metadata = std::fs::symlink_metadata(path)
        .context("MCP stdio executable identity metadata is unavailable")?;
    if !metadata.file_type().is_file() {
        bail!("MCP stdio executable identity requires a regular file");
    }
    let executable_size_bytes = metadata.len();
    if executable_size_bytes == 0 || executable_size_bytes > MAX_MCP_EXECUTABLE_BYTES {
        bail!("MCP stdio executable identity is outside the supported byte limit");
    }
    validate_executable_permissions(&metadata)?;
    let mut file = File::open(path).context("MCP stdio executable identity is unreadable")?;
    let mut hasher = Sha256::new();
    let mut total = 0_u64;
    let mut chunk = [0_u8; 8192];
    loop {
        let read = file
            .read(&mut chunk)
            .context("failed to read MCP stdio executable identity")?;
        if read == 0 {
            break;
        }
        total = total.saturating_add(read as u64);
        if total > MAX_MCP_EXECUTABLE_BYTES {
            bail!("MCP stdio executable identity exceeds the supported byte limit");
        }
        hasher.update(&chunk[..read]);
    }
    if total != executable_size_bytes {
        bail!("MCP stdio executable identity changed while being read");
    }
    let executable_content_fingerprint = format!(
        "sha256:{}",
        hasher
            .finalize()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    );
    let executable_identity_fingerprint = fingerprint_json(&json!({
        "version": "brownie_mcp_executable_identity_v1",
        "content_fingerprint": executable_content_fingerprint,
        "size_bytes": executable_size_bytes,
    }));
    Ok(McpExecutableIdentity {
        executable_identity_fingerprint,
        executable_content_fingerprint,
        executable_size_bytes,
    })
}

#[cfg(unix)]
fn validate_executable_permissions(metadata: &std::fs::Metadata) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    if metadata.permissions().mode() & 0o111 == 0 {
        bail!("MCP stdio executable identity target is not executable");
    }
    Ok(())
}

#[cfg(not(unix))]
fn validate_executable_permissions(_metadata: &std::fs::Metadata) -> Result<()> {
    Ok(())
}

fn configure_hardened_mcp_stdio_process(command: &mut Command) {
    command.env_clear();
    command.current_dir(mcp_stdio_neutral_cwd());
}

fn configure_mcp_secret_environment(
    command: &mut Command,
    config: &ModePackMcpServerConfig,
    secret_resolver: &dyn McpSecretResolver,
) -> Result<()> {
    for binding in &config.secret_env {
        validate_secret_binding(binding)?;
        let Some(value) = secret_resolver.resolve_secret(&binding.secret_ref) else {
            bail!("MCP secret reference for configured child environment is unresolved");
        };
        validate_secret_value(&value)?;
        command.env(&binding.env_name, value);
    }
    Ok(())
}

fn validate_secret_binding(binding: &ModePackMcpSecretEnvBinding) -> Result<()> {
    if binding.env_name.is_empty()
        || binding.env_name.chars().count() > brownie_modepack::MAX_MCP_SECRET_ENV_NAME_CHARS
        || !binding.env_name.chars().enumerate().all(|(index, ch)| {
            if index == 0 {
                ch.is_ascii_uppercase() || ch == '_'
            } else {
                ch.is_ascii_uppercase() || ch.is_ascii_digit() || ch == '_'
            }
        })
    {
        bail!("MCP secret environment binding name is invalid");
    }
    if binding.secret_ref.is_empty()
        || binding.secret_ref.chars().count() > MAX_MCP_SECRET_REF_CHARS
        || !binding
            .secret_ref
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' || ch == '.')
    {
        bail!("MCP secret reference is invalid");
    }
    if !binding.secret_ref_fingerprint.starts_with("sha256:") {
        bail!("MCP secret reference fingerprint is invalid");
    }
    Ok(())
}

fn validate_secret_value(value: &str) -> Result<()> {
    if value.is_empty() || value.len() > MAX_MCP_SECRET_VALUE_BYTES || value.as_bytes().contains(&0)
    {
        bail!("MCP secret reference resolved to an invalid value");
    }
    Ok(())
}

fn secret_reference_fingerprints(config: &ModePackMcpServerConfig) -> Vec<String> {
    config
        .secret_env
        .iter()
        .map(|binding| binding.secret_ref_fingerprint.clone())
        .collect()
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

fn validate_mcp_schema_subset(
    schema: &Value,
    context: &str,
    require_object_root: bool,
) -> Result<()> {
    let canonical = canonical_json(schema);
    let text = canonical.to_string();
    if text.len() > MAX_MCP_SCHEMA_BYTES {
        bail!("{context} exceeds byte limit");
    }
    validate_mcp_schema_subset_inner(schema, context, 0, require_object_root)
}

fn validate_mcp_schema_subset_inner(
    schema: &Value,
    context: &str,
    depth: usize,
    require_object_root: bool,
) -> Result<()> {
    if depth > MAX_MCP_SCHEMA_DEPTH {
        bail!("{context} exceeds schema depth limit");
    }
    let object = schema
        .as_object()
        .with_context(|| format!("{context} schema node must be an object"))?;
    for keyword in object.keys() {
        if is_unsupported_validation_keyword(keyword) {
            bail!("{context} contains unsupported schema keyword {keyword}");
        }
    }
    let Some(schema_type) = object.get("type").and_then(Value::as_str) else {
        bail!("{context} schema type must be a supported string");
    };
    if !is_supported_schema_type(schema_type) {
        bail!("{context} schema type is unsupported");
    }
    if require_object_root && schema_type != "object" {
        bail!("{context} root schema must be type object");
    }
    match schema_type {
        "object" => {
            if let Some(properties) = object.get("properties") {
                let properties = properties
                    .as_object()
                    .with_context(|| format!("{context} properties must be an object"))?;
                if properties.len() > MAX_MCP_SCHEMA_PROPERTIES {
                    bail!("{context} properties exceed bounded limit");
                }
                for (name, property_schema) in properties {
                    validate_tool_name(name)
                        .with_context(|| format!("{context} property name is malformed"))?;
                    validate_mcp_schema_subset_inner(property_schema, context, depth + 1, false)?;
                }
            }
            if let Some(required) = object.get("required") {
                let required = required
                    .as_array()
                    .with_context(|| format!("{context} required must be an array"))?;
                if required.len() > MAX_MCP_SCHEMA_PROPERTIES {
                    bail!("{context} required exceeds bounded limit");
                }
                for item in required {
                    let name = item
                        .as_str()
                        .with_context(|| format!("{context} required entries must be strings"))?;
                    validate_tool_name(name)
                        .with_context(|| format!("{context} required property is malformed"))?;
                }
            }
            if let Some(additional) = object.get("additionalProperties") {
                if !additional.is_boolean() {
                    bail!("{context} additionalProperties must be a boolean");
                }
            }
        }
        "array" => {
            if let Some(items) = object.get("items") {
                validate_mcp_schema_subset_inner(items, context, depth + 1, false)?;
            }
        }
        "string" => {
            validate_u64_keyword(object, "minLength", context)?;
            validate_u64_keyword(object, "maxLength", context)?;
        }
        "number" | "integer" => {
            validate_number_keyword(object, "minimum", context)?;
            validate_number_keyword(object, "maximum", context)?;
        }
        "boolean" | "null" => {}
        _ => unreachable!("supported schema type checked"),
    }
    if let Some(values) = object.get("enum") {
        let values = values
            .as_array()
            .with_context(|| format!("{context} enum must be an array"))?;
        if values.is_empty() || values.len() > MAX_MCP_SCHEMA_ENUM_VALUES {
            bail!("{context} enum must be non-empty and bounded");
        }
    }
    Ok(())
}

fn validate_u64_keyword(object: &Map<String, Value>, keyword: &str, context: &str) -> Result<()> {
    if let Some(value) = object.get(keyword) {
        if value.as_u64().is_none() {
            bail!("{context} {keyword} must be an unsigned integer");
        }
    }
    Ok(())
}

fn validate_number_keyword(
    object: &Map<String, Value>,
    keyword: &str,
    context: &str,
) -> Result<()> {
    if let Some(value) = object.get(keyword) {
        if value.as_f64().is_none() {
            bail!("{context} {keyword} must be a number");
        }
    }
    Ok(())
}

fn is_supported_schema_type(value: &str) -> bool {
    matches!(
        value,
        "object" | "string" | "number" | "integer" | "boolean" | "array" | "null"
    )
}

fn is_unsupported_validation_keyword(keyword: &str) -> bool {
    matches!(
        keyword,
        "$ref"
            | "$dynamicRef"
            | "oneOf"
            | "anyOf"
            | "allOf"
            | "not"
            | "if"
            | "then"
            | "else"
            | "pattern"
            | "format"
            | "patternProperties"
            | "propertyNames"
            | "dependentRequired"
            | "dependentSchemas"
            | "contains"
            | "minContains"
            | "maxContains"
            | "minItems"
            | "maxItems"
            | "uniqueItems"
            | "multipleOf"
            | "exclusiveMinimum"
            | "exclusiveMaximum"
    )
}

fn validate_tool_output_against_schema(
    entry: &McpToolCatalogEntry,
    result: &Value,
) -> Result<Value> {
    let Some(schema) = entry.output_schema.as_ref() else {
        return Ok(json!({
            "schema_validation_version": 1,
            "status": "not_applicable",
            "reason": "missing_output_schema",
        }));
    };
    let empty_object = json!({});
    let value = result.get("structuredContent").unwrap_or(&empty_object);
    validate_json_value_against_schema(schema, value, "$", "output")?;
    Ok(json!({
        "schema_validation_version": 1,
        "output_schema_fingerprint": entry.output_schema_fingerprint,
        "validated_value_fingerprint": fingerprint_json(value),
        "validation_target": "structuredContent_or_empty_object",
        "status": "validated",
    }))
}

fn validate_json_value_against_schema(
    schema: &Value,
    value: &Value,
    path: &str,
    subject: &str,
) -> Result<()> {
    let object = schema
        .as_object()
        .with_context(|| format!("MCP {subject} schema at {path} must be an object"))?;
    if let Some(expected) = object.get("const") {
        if value != expected {
            bail!("MCP {subject} schema const mismatch at {path}");
        }
    }
    if let Some(values) = object.get("enum").and_then(Value::as_array) {
        if !values.iter().any(|expected| expected == value) {
            bail!("MCP {subject} schema enum mismatch at {path}");
        }
    }
    let schema_type = object
        .get("type")
        .and_then(Value::as_str)
        .with_context(|| format!("MCP {subject} schema type must be present"))?;
    match schema_type {
        "object" => validate_object_value(object, value, path, subject),
        "string" => validate_string_value(object, value, path, subject),
        "number" => {
            validate_number_value(object, value, path, false, subject)?;
            Ok(())
        }
        "integer" => {
            validate_number_value(object, value, path, true, subject)?;
            Ok(())
        }
        "array" => validate_array_value(object, value, path, subject),
        "boolean" if value.is_boolean() => Ok(()),
        "null" if value.is_null() => Ok(()),
        "boolean" | "null" => bail!("MCP {subject} schema type mismatch at {path}"),
        _ => bail!("MCP {subject} schema type is unsupported at {path}"),
    }
}

fn validate_object_value(
    object: &Map<String, Value>,
    value: &Value,
    path: &str,
    subject: &str,
) -> Result<()> {
    let value_object = value
        .as_object()
        .with_context(|| format!("MCP {subject} schema expected object at {path}"))?;
    let properties = object.get("properties").and_then(Value::as_object);
    if let Some(required) = object.get("required").and_then(Value::as_array) {
        for item in required {
            let name = item
                .as_str()
                .with_context(|| format!("MCP {subject} schema required entry must be a string"))?;
            if !value_object.contains_key(name) {
                bail!("MCP {subject} schema missing required field {name}");
            }
        }
    }
    if object.get("additionalProperties").and_then(Value::as_bool) == Some(false) {
        for key in value_object.keys() {
            if !properties
                .map(|property_map| property_map.contains_key(key))
                .unwrap_or(false)
            {
                bail!("MCP {subject} schema disallows additional field {key}");
            }
        }
    }
    if let Some(properties) = properties {
        for (name, property_schema) in properties {
            if let Some(field_value) = value_object.get(name) {
                validate_json_value_against_schema(
                    property_schema,
                    field_value,
                    &format!("{path}.{name}"),
                    subject,
                )?;
            }
        }
    }
    Ok(())
}

fn validate_array_value(
    object: &Map<String, Value>,
    value: &Value,
    path: &str,
    subject: &str,
) -> Result<()> {
    let values = value
        .as_array()
        .with_context(|| format!("MCP {subject} schema expected array at {path}"))?;
    if let Some(items) = object.get("items") {
        for (index, item) in values.iter().enumerate() {
            validate_json_value_against_schema(items, item, &format!("{path}[{index}]"), subject)?;
        }
    }
    Ok(())
}

fn validate_string_value(
    object: &Map<String, Value>,
    value: &Value,
    path: &str,
    subject: &str,
) -> Result<()> {
    let string = value
        .as_str()
        .with_context(|| format!("MCP {subject} schema expected string at {path}"))?;
    let chars = string.chars().count() as u64;
    if let Some(min) = object.get("minLength").and_then(Value::as_u64) {
        if chars < min {
            bail!("MCP {subject} schema string is shorter than minLength at {path}");
        }
    }
    if let Some(max) = object.get("maxLength").and_then(Value::as_u64) {
        if chars > max {
            bail!("MCP {subject} schema string exceeds maxLength at {path}");
        }
    }
    Ok(())
}

fn validate_number_value(
    object: &Map<String, Value>,
    value: &Value,
    path: &str,
    integer: bool,
    subject: &str,
) -> Result<()> {
    let number = value
        .as_f64()
        .with_context(|| format!("MCP {subject} schema expected number at {path}"))?;
    if integer && !(value.as_i64().is_some() || value.as_u64().is_some()) {
        bail!("MCP {subject} schema expected integer at {path}");
    }
    if let Some(minimum) = object.get("minimum").and_then(Value::as_f64) {
        if number < minimum {
            bail!("MCP {subject} schema number is below minimum at {path}");
        }
    }
    if let Some(maximum) = object.get("maximum").and_then(Value::as_f64) {
        if number > maximum {
            bail!("MCP {subject} schema number exceeds maximum at {path}");
        }
    }
    Ok(())
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
            secret_env: vec![],
            config_identity_fingerprint: "sha256:test".to_string(),
        };

        let error = validate_stdio_command_boundary(&config)
            .expect_err("relative command should fail closed")
            .to_string();

        assert!(error.contains("absolute executable path"));
    }

    #[test]
    fn mcp_stdio_deadline_reconstructs_remaining_monotonic_budget() {
        let deadline = McpStdioDeadline::after(Duration::from_millis(250));

        assert!(deadline.remaining().expect("remaining") <= deadline.total_budget);
        assert!(!deadline.is_expired());

        let expired = McpStdioDeadline {
            expires_at: Instant::now() - Duration::from_millis(1),
            total_budget: Duration::from_millis(250),
        };
        assert_eq!(expired.remaining_or_zero(), Duration::ZERO);
        assert!(expired.is_expired());
    }

    #[test]
    #[cfg(unix)]
    fn mcp_stdio_deadline_covers_child_exit_after_response_line() {
        let temp = tempfile::tempdir().expect("tempdir");
        let pid_file = temp.path().join("late-exit.pid");
        let script = temp.path().join("fake-mcp-late-exit.sh");
        std::fs::write(
            &script,
            format!(
                r#"#!/bin/sh
read request
printf '%s\n' "$$" > "{}"
printf '%s\n' '{{"jsonrpc":"2.0","id":1,"result":{{"tools":[]}}}}'
sleep 5
"#,
                pid_file.display()
            ),
        )
        .expect("write script");
        make_executable(&script);
        let config = ModePackMcpServerConfig {
            server_id: "github".to_string(),
            transport: "stdio".to_string(),
            command: script.to_string_lossy().to_string(),
            args: vec![],
            secret_env: vec![],
            config_identity_fingerprint: "sha256:server-config".to_string(),
        };

        let error = stdio_request(
            &config,
            &EnvMcpSecretResolver,
            None,
            McpStdioDeadline::after(Duration::from_millis(3_000)),
            json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/list",
                "params": {}
            }),
        )
        .expect_err("late child exit must be bounded by the same deadline")
        .to_string();

        assert!(error.contains("waiting for child exit"));
        assert!(error.contains("timeout_budget_ms=3000"));
        let pid = std::fs::read_to_string(&pid_file)
            .expect("pid file")
            .trim()
            .parse::<u32>()
            .expect("pid");
        assert!(!process_exists(pid), "late-exit child was not killed");
    }

    #[derive(Debug)]
    struct StaticSecretResolver {
        secret_ref: String,
        value: String,
    }

    impl McpSecretResolver for StaticSecretResolver {
        fn resolve_secret(&self, secret_ref: &str) -> Option<String> {
            (secret_ref == self.secret_ref).then(|| self.value.clone())
        }
    }

    #[derive(Debug, Default)]
    struct MissingSecretResolver;

    impl McpSecretResolver for MissingSecretResolver {
        fn resolve_secret(&self, _secret_ref: &str) -> Option<String> {
            None
        }
    }

    #[test]
    #[cfg(unix)]
    fn mcp_secret_reference_is_injected_without_result_exposure() {
        let temp = tempfile::tempdir().expect("tempdir");
        let script = temp.path().join("fake-mcp-secret.sh");
        std::fs::write(
            &script,
            r#"#!/bin/sh
read request
if [ "$BROWNIE_TEST_TOKEN" != "test-secret-value" ]; then
  printf '%s\n' '{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"missing secret"}}'
  exit 0
fi
case "$request" in
  *tools/list*)
    printf '%s\n' '{"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"search_code","description":"safe","inputSchema":{"type":"object"},"outputSchema":{"type":"object"},"annotations":{"readOnlyHint":true,"idempotentHint":true}}]}}'
    ;;
  *tools/call*)
    printf '%s\n' '{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"ok"}],"structuredContent":{},"isError":false}}'
    ;;
esac
"#,
        )
        .expect("write script");
        let mut permissions = std::fs::metadata(&script)
            .expect("script metadata")
            .permissions();
        std::os::unix::fs::PermissionsExt::set_mode(&mut permissions, 0o755);
        std::fs::set_permissions(&script, permissions).expect("chmod script");
        let config = ModePackMcpServerConfig {
            server_id: "github".to_string(),
            transport: "stdio".to_string(),
            command: script.to_string_lossy().to_string(),
            args: vec![],
            secret_env: vec![ModePackMcpSecretEnvBinding {
                env_name: "BROWNIE_TEST_TOKEN".to_string(),
                secret_ref: "github.token".to_string(),
                secret_ref_fingerprint: "sha256:test-secret-ref".to_string(),
            }],
            config_identity_fingerprint: "sha256:server-config".to_string(),
        };
        let resolver = StaticSecretResolver {
            secret_ref: "github.token".to_string(),
            value: "test-secret-value".to_string(),
        };

        let catalog = list_tools_with_secret_resolver(&config, &resolver).expect("catalog");
        assert_eq!(
            catalog.server_secret_reference_fingerprints,
            vec!["sha256:test-secret-ref".to_string()]
        );
        let result =
            call_tool_with_secret_resolver(&config, &catalog.tools[0], json!({}), &resolver)
                .expect("call tool");

        let serialized = result.output.to_string();
        assert!(!serialized.contains("test-secret-value"));
        assert!(!serialized.contains("github.token"));
        assert!(serialized.contains("sha256:test-secret-ref"));
    }

    #[test]
    #[cfg(unix)]
    fn mcp_secret_resolution_failure_happens_before_spawn() {
        let temp = tempfile::tempdir().expect("tempdir");
        let marker = temp.path().join("spawned");
        let script = temp.path().join("fake-mcp-secret-missing.sh");
        std::fs::write(
            &script,
            format!(
                r#"#!/bin/sh
touch "{}"
printf '%s\n' '{{"jsonrpc":"2.0","id":1,"result":{{"tools":[]}}}}'
"#,
                marker.display()
            ),
        )
        .expect("write script");
        let mut permissions = std::fs::metadata(&script)
            .expect("script metadata")
            .permissions();
        std::os::unix::fs::PermissionsExt::set_mode(&mut permissions, 0o755);
        std::fs::set_permissions(&script, permissions).expect("chmod script");
        let config = ModePackMcpServerConfig {
            server_id: "github".to_string(),
            transport: "stdio".to_string(),
            command: script.to_string_lossy().to_string(),
            args: vec![],
            secret_env: vec![ModePackMcpSecretEnvBinding {
                env_name: "BROWNIE_TEST_TOKEN".to_string(),
                secret_ref: "github.token".to_string(),
                secret_ref_fingerprint: "sha256:test-secret-ref".to_string(),
            }],
            config_identity_fingerprint: "sha256:server-config".to_string(),
        };

        let error = list_tools_with_secret_resolver(&config, &MissingSecretResolver)
            .expect_err("unresolved secret reference should fail closed");

        assert!(error.to_string().contains("unresolved"));
        assert!(!marker.exists());
    }

    #[test]
    #[cfg(unix)]
    fn mcp_executable_identity_is_cataloged_without_raw_path() {
        let temp = tempfile::tempdir().expect("tempdir");
        let script = temp.path().join("fake-mcp-identity.sh");
        std::fs::write(
            &script,
            r#"#!/bin/sh
read request
case "$request" in
  *tools/list*)
    printf '%s\n' '{"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"search_code","inputSchema":{"type":"object"},"annotations":{"readOnlyHint":true,"idempotentHint":true}}]}}'
    ;;
  *tools/call*)
    printf '%s\n' '{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"ok"}],"structuredContent":{},"isError":false}}'
    ;;
esac
"#,
        )
        .expect("write script");
        make_executable(&script);
        let config = ModePackMcpServerConfig {
            server_id: "github".to_string(),
            transport: "stdio".to_string(),
            command: script.to_string_lossy().to_string(),
            args: vec![],
            secret_env: vec![],
            config_identity_fingerprint: "sha256:server-config".to_string(),
        };

        let catalog = list_tools(&config).expect("catalog");
        let entry = &catalog.tools[0];

        assert!(catalog
            .server_executable_identity_fingerprint
            .starts_with("sha256:"));
        assert_eq!(
            entry.server_executable_identity_fingerprint,
            catalog.server_executable_identity_fingerprint
        );
        assert!(catalog.catalog_fingerprint.starts_with("sha256:"));
        let serialized = serde_json::to_string(&catalog).expect("serialize catalog");
        assert!(serialized.contains("server_executable_identity_fingerprint"));
        assert!(!serialized.contains(&script.to_string_lossy().to_string()));
        assert!(!serialized.contains("fake-mcp-identity.sh"));
    }

    #[test]
    #[cfg(unix)]
    fn mcp_executable_identity_drift_fails_before_call_spawn() {
        let temp = tempfile::tempdir().expect("tempdir");
        let marker = temp.path().join("spawned-after-drift");
        let script = temp.path().join("fake-mcp-drift.sh");
        std::fs::write(
            &script,
            r#"#!/bin/sh
read request
case "$request" in
  *tools/list*)
    printf '%s\n' '{"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"search_code","inputSchema":{"type":"object"},"outputSchema":{"type":"object"},"annotations":{"readOnlyHint":true,"idempotentHint":true}}]}}'
    ;;
  *tools/call*)
    printf '%s\n' '{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"ok"}],"structuredContent":{},"isError":false}}'
    ;;
esac
"#,
        )
        .expect("write script");
        make_executable(&script);
        let config = ModePackMcpServerConfig {
            server_id: "github".to_string(),
            transport: "stdio".to_string(),
            command: script.to_string_lossy().to_string(),
            args: vec![],
            secret_env: vec![],
            config_identity_fingerprint: "sha256:server-config".to_string(),
        };
        let catalog = list_tools(&config).expect("catalog");
        std::fs::write(
            &script,
            format!(
                r#"#!/bin/sh
touch "{}"
printf '%s\n' '{{"jsonrpc":"2.0","id":1,"result":{{"content":[{{"type":"text","text":"changed"}}],"structuredContent":{{}},"isError":false}}}}'
"#,
                marker.display()
            ),
        )
        .expect("rewrite script");
        make_executable(&script);

        let error = call_tool(&config, &catalog.tools[0], json!({}))
            .expect_err("drifted executable identity should fail closed");

        assert_eq!(error.kind, McpToolCallFailureKind::Failed);
        assert!(error.message.contains("identity drifted"));
        assert!(!marker.exists());
        let metadata = error.metadata.expect("bounded drift metadata");
        assert!(metadata
            .get("server_executable_identity_fingerprint")
            .and_then(Value::as_str)
            .is_some_and(|value| value.starts_with("sha256:")));
        assert_eq!(
            metadata
                .get("expected_server_executable_identity_fingerprint")
                .and_then(Value::as_str),
            Some(
                catalog.tools[0]
                    .server_executable_identity_fingerprint
                    .as_str()
            )
        );
    }

    #[test]
    #[cfg(unix)]
    fn mcp_executable_identity_rejects_non_regular_before_spawn() {
        let temp = tempfile::tempdir().expect("tempdir");
        let marker = temp.path().join("spawned");
        let config = ModePackMcpServerConfig {
            server_id: "github".to_string(),
            transport: "stdio".to_string(),
            command: temp.path().to_string_lossy().to_string(),
            args: vec![],
            secret_env: vec![],
            config_identity_fingerprint: "sha256:server-config".to_string(),
        };

        let error = list_tools(&config)
            .expect_err("directory executable identity should fail closed")
            .to_string();

        assert!(error.contains("regular file"));
        assert!(!marker.exists());
    }

    #[cfg(unix)]
    fn make_executable(path: &Path) {
        let mut permissions = std::fs::metadata(path)
            .expect("script metadata")
            .permissions();
        std::os::unix::fs::PermissionsExt::set_mode(&mut permissions, 0o755);
        std::fs::set_permissions(path, permissions).expect("chmod script");
    }

    #[cfg(unix)]
    fn process_exists(pid: u32) -> bool {
        unsafe extern "C" {
            fn kill(pid: i32, sig: i32) -> i32;
        }
        unsafe { kill(pid as i32, 0) == 0 }
    }
}
