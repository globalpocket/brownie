use crate::cli::CliCommand;
use brownie_protocol::{JsonRpcResponse, RuntimeStatus};
use serde_json::{json, Value};
use std::env;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

const JSONRPC_VERSION: &str = "2.0";
const RUNTIME_STATUS_METHOD: &str = "runtime.status";
const RUNTIME_PATH_ENV: &str = "BROWNIE_RUNTIME_PATH";
const RUNTIME_TIMEOUT_MS_ENV: &str = "BROWNIE_RUNTIME_TIMEOUT_MS";
const DEFAULT_TIMEOUT_MS: u64 = 2_000;
const MAX_RESPONSE_BYTES: usize = 16 * 1024;
const MAX_STATUS_FIELD_CHARS: usize = 128;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeClient {
    boundary: RuntimeClientBoundary,
    config: RuntimeClientConfig,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeClientConfig {
    pub runtime_path: Option<PathBuf>,
    pub timeout: Duration,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeClientBoundary {
    pub authority: RuntimeAuthority,
    pub transport: RuntimeTransport,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuntimeAuthority {
    RustRuntime,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuntimeTransport {
    JsonRpcHostProcess,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeClientError {
    RuntimeUnavailable,
    UnsupportedCommand,
    CommunicationFailed,
    TimedOut,
    InvalidResponse,
    RuntimeError,
}

impl Default for RuntimeClient {
    fn default() -> Self {
        Self {
            boundary: RuntimeClientBoundary {
                authority: RuntimeAuthority::RustRuntime,
                transport: RuntimeTransport::JsonRpcHostProcess,
            },
            config: RuntimeClientConfig::from_env(),
        }
    }
}

impl RuntimeClientConfig {
    pub fn from_env() -> Self {
        Self {
            runtime_path: env::var_os(RUNTIME_PATH_ENV)
                .filter(|value| !value.is_empty())
                .map(PathBuf::from),
            timeout: env::var(RUNTIME_TIMEOUT_MS_ENV)
                .ok()
                .and_then(|value| value.parse::<u64>().ok())
                .filter(|value| *value > 0)
                .map(Duration::from_millis)
                .unwrap_or_else(|| Duration::from_millis(DEFAULT_TIMEOUT_MS)),
        }
    }

    pub fn with_runtime_path(path: PathBuf) -> Self {
        Self {
            runtime_path: Some(path),
            timeout: Duration::from_millis(DEFAULT_TIMEOUT_MS),
        }
    }

    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }
}

impl RuntimeClient {
    pub fn new(config: RuntimeClientConfig) -> Self {
        Self {
            boundary: RuntimeClientBoundary {
                authority: RuntimeAuthority::RustRuntime,
                transport: RuntimeTransport::JsonRpcHostProcess,
            },
            config,
        }
    }

    pub fn boundary(&self) -> &RuntimeClientBoundary {
        &self.boundary
    }

    pub fn invoke(&self, command: &CliCommand, json: bool) -> Result<String, RuntimeClientError> {
        match command {
            CliCommand::Status => self.runtime_status(json),
            _ => Err(RuntimeClientError::UnsupportedCommand),
        }
    }

    fn runtime_status(&self, json_output: bool) -> Result<String, RuntimeClientError> {
        let status = self.call_runtime_status()?;
        if json_output {
            return Ok(format!("{}\n", json!({ "ok": true, "status": status })));
        }

        Ok(format!(
            "{} {} {:?}\n",
            status.name, status.version, status.status
        ))
    }

    fn call_runtime_status(&self) -> Result<RuntimeStatus, RuntimeClientError> {
        let request_id = json!(1);
        let request = json!({
            "jsonrpc": JSONRPC_VERSION,
            "id": request_id.clone(),
            "method": RUNTIME_STATUS_METHOD
        });
        let request_line =
            serde_json::to_string(&request).map_err(|_| RuntimeClientError::CommunicationFailed)?;
        let response_line = self.send_one_request(&request_line)?;
        parse_runtime_status_response(&response_line, &request_id)
    }

    fn send_one_request(&self, request_line: &str) -> Result<String, RuntimeClientError> {
        let runtime_path = self.resolve_runtime_path();
        let mut child = Command::new(runtime_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| {
                if error.kind() == std::io::ErrorKind::NotFound {
                    RuntimeClientError::RuntimeUnavailable
                } else {
                    RuntimeClientError::CommunicationFailed
                }
            })?;

        {
            let mut stdin = child
                .stdin
                .take()
                .ok_or(RuntimeClientError::CommunicationFailed)?;
            writeln!(stdin, "{request_line}")
                .map_err(|_| RuntimeClientError::CommunicationFailed)?;
        }

        let mut stdout = child
            .stdout
            .take()
            .ok_or(RuntimeClientError::CommunicationFailed)?;
        let (sender, receiver) = mpsc::channel();
        thread::spawn(move || {
            let _ = sender.send(read_bounded_response_line(&mut stdout));
        });

        let response = match receiver.recv_timeout(self.config.timeout) {
            Ok(Ok(buffer)) => {
                if matches!(child.try_wait(), Ok(None)) {
                    let _ = child.kill();
                }
                let _ = child.wait();
                if buffer.is_empty() || buffer.len() > MAX_RESPONSE_BYTES {
                    return Err(RuntimeClientError::InvalidResponse);
                }
                String::from_utf8(buffer).map_err(|_| RuntimeClientError::InvalidResponse)?
            }
            Ok(Err(_)) => {
                let _ = child.wait();
                return Err(RuntimeClientError::CommunicationFailed);
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(RuntimeClientError::TimedOut);
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                let _ = child.wait();
                return Err(RuntimeClientError::CommunicationFailed);
            }
        };

        response
            .lines()
            .find(|line| !line.trim().is_empty())
            .map(|line| line.trim().to_string())
            .ok_or(RuntimeClientError::InvalidResponse)
    }

    fn resolve_runtime_path(&self) -> PathBuf {
        if let Some(path) = &self.config.runtime_path {
            return path.clone();
        }

        if let Ok(current_exe) = env::current_exe() {
            if let Some(parent) = current_exe.parent() {
                let sibling = parent.join(format!("brownie-runtime{}", env::consts::EXE_SUFFIX));
                if sibling.exists() {
                    return sibling;
                }
            }
        }

        PathBuf::from(format!("brownie-runtime{}", env::consts::EXE_SUFFIX))
    }
}

fn read_bounded_response_line(stdout: &mut impl Read) -> std::io::Result<Vec<u8>> {
    let mut buffer = Vec::new();
    let mut byte = [0_u8; 1];
    loop {
        match stdout.read(&mut byte)? {
            0 => break,
            _ => {
                buffer.push(byte[0]);
                if byte[0] == b'\n' || buffer.len() > MAX_RESPONSE_BYTES {
                    break;
                }
            }
        }
    }
    Ok(buffer)
}

fn parse_runtime_status_response(
    line: &str,
    expected_id: &Value,
) -> Result<RuntimeStatus, RuntimeClientError> {
    let raw: Value = serde_json::from_str(line).map_err(|_| RuntimeClientError::InvalidResponse)?;
    let response: JsonRpcResponse<Value> =
        serde_json::from_value(raw).map_err(|_| RuntimeClientError::InvalidResponse)?;

    if response.jsonrpc != JSONRPC_VERSION || response.id != *expected_id {
        return Err(RuntimeClientError::InvalidResponse);
    }

    match (response.result, response.error) {
        (Some(result), None) => parse_runtime_status_result(result),
        (None, Some(_)) => Err(RuntimeClientError::RuntimeError),
        _ => Err(RuntimeClientError::InvalidResponse),
    }
}

fn parse_runtime_status_result(result: Value) -> Result<RuntimeStatus, RuntimeClientError> {
    let object = result
        .as_object()
        .ok_or(RuntimeClientError::InvalidResponse)?;
    let valid_keys = ["name", "version", "status"];
    if object.len() != valid_keys.len()
        || object.keys().any(|key| !valid_keys.contains(&key.as_str()))
    {
        return Err(RuntimeClientError::InvalidResponse);
    }

    for key in ["name", "version"] {
        let Some(value) = object.get(key).and_then(Value::as_str) else {
            return Err(RuntimeClientError::InvalidResponse);
        };
        if value.is_empty() || value.chars().count() > MAX_STATUS_FIELD_CHARS {
            return Err(RuntimeClientError::InvalidResponse);
        }
    }

    let Some(status) = object.get("status").and_then(Value::as_str) else {
        return Err(RuntimeClientError::InvalidResponse);
    };
    if !matches!(status, "Ready" | "Starting" | "Stopping" | "Error") {
        return Err(RuntimeClientError::InvalidResponse);
    }

    serde_json::from_value::<RuntimeStatus>(Value::Object(object.clone()))
        .map_err(|_| RuntimeClientError::InvalidResponse)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn boundary_names_runtime_authority_without_policy_copy() {
        let client = RuntimeClient::default();
        assert_eq!(client.boundary().authority, RuntimeAuthority::RustRuntime);
        assert_eq!(
            client.boundary().transport,
            RuntimeTransport::JsonRpcHostProcess
        );
    }

    #[test]
    fn rejects_mismatched_runtime_response_id() {
        let error = parse_runtime_status_response(
            r#"{"jsonrpc":"2.0","id":2,"result":{"name":"brownie-runtime","version":"0.1.0","status":"Ready"}}"#,
            &json!(1),
        )
        .unwrap_err();
        assert_eq!(error, RuntimeClientError::InvalidResponse);
    }

    #[test]
    fn accepts_bounded_runtime_status_response() {
        let status = parse_runtime_status_response(
            r#"{"jsonrpc":"2.0","id":1,"result":{"name":"brownie-runtime","version":"0.1.0","status":"Ready"}}"#,
            &json!(1),
        )
        .unwrap();
        assert_eq!(status.name, "brownie-runtime");
        assert_eq!(status.status, brownie_protocol::RuntimeState::Ready);
    }
}
