//! Minimal runtime-owned MCP client for stdio tools.

use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
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
    pub server_config_identity_fingerprint: String,
    pub protocol_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct McpToolCatalog {
    pub server_id: String,
    pub server_config_identity_fingerprint: String,
    pub protocol_version: String,
    pub tools: Vec<McpToolCatalogEntry>,
    pub catalog_fingerprint: String,
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
    if response.get("error").is_some() {
        bail!("MCP tools/list returned protocol error");
    }
    let result = response
        .get("result")
        .and_then(Value::as_object)
        .context("MCP tools/list missing result object")?;
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
        entries.push(McpToolCatalogEntry {
            tool_id: normalized_tool_id(&config.server_id, name),
            server_id: config.server_id.clone(),
            tool_name: name.to_string(),
            description,
            input_schema_fingerprint,
            output_schema_fingerprint,
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
) -> Result<Value> {
    validate_tool_name(tool_name)?;
    if !arguments.is_object() {
        bail!("MCP tools/call arguments must be an object");
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
    )?;
    if response.get("error").is_some() {
        bail!("MCP tools/call returned protocol error");
    }
    let result = response
        .get("result")
        .cloned()
        .context("MCP tools/call missing result")?;
    Ok(json!({
        "server_id": config.server_id,
        "tool_name": tool_name,
        "protocol_version": MCP_PROTOCOL_VERSION,
        "server_config_identity_fingerprint": config.config_identity_fingerprint,
        "result_fingerprint": fingerprint_json(&result),
        "is_error": result.get("isError").and_then(Value::as_bool).unwrap_or(false),
        "content_items": result.get("content").and_then(Value::as_array).map(|items| items.len()).unwrap_or(0),
    }))
}

fn stdio_request(config: &ModePackMcpServerConfig, request: Value) -> Result<Value> {
    if config.transport != "stdio" {
        bail!("unsupported MCP transport");
    }
    let config = config.clone();
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let result = stdio_request_inner(&config, request);
        let _ = tx.send(result);
    });
    rx.recv_timeout(Duration::from_millis(MCP_STDIO_TIMEOUT_MS))
        .unwrap_or_else(|_| Err(anyhow::anyhow!("MCP stdio request timed out")))
}

fn stdio_request_inner(config: &ModePackMcpServerConfig, request: Value) -> Result<Value> {
    let mut child = Command::new(&config.command)
        .args(&config.args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .with_context(|| format!("failed to start MCP stdio server {}", config.server_id))?;
    {
        let stdin = child
            .stdin
            .as_mut()
            .context("MCP server stdin unavailable")?;
        writeln!(stdin, "{}", request)?;
    }
    let stdout = child
        .stdout
        .take()
        .context("MCP server stdout unavailable")?;
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    reader
        .read_line(&mut line)
        .context("failed to read MCP stdio response")?;
    if line.len() > MAX_MCP_RESPONSE_BYTES {
        bail!("MCP stdio response exceeds byte limit");
    }
    let _ = child.kill();
    let _ = child.wait();
    if line.trim().is_empty() {
        bail!("MCP stdio server returned empty response");
    }
    serde_json::from_str(&line).context("MCP stdio response is not valid JSON")
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
    })
}
