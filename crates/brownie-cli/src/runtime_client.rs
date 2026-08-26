use crate::cli::{CliCommand, InspectTarget, ListTarget};
use brownie_protocol::{JsonRpcResponse, RuntimeStatus};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::env;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

const JSONRPC_VERSION: &str = "2.0";
const RUNTIME_STATUS_METHOD: &str = "runtime.status";
const TASK_INSPECT_METHOD: &str = "task.inspect";
const RUN_INSPECT_METHOD: &str = "run.inspect";
const TASK_LIST_METHOD: &str = "task.list";
const HEADLESS_CONTINUE_ONCE_METHOD: &str = "headless.continue_once";
const HEADLESS_RUN_DRIVE_METHOD: &str = "headless.run.drive";
const RUNTIME_PATH_ENV: &str = "BROWNIE_RUNTIME_PATH";
const RUNTIME_TIMEOUT_MS_ENV: &str = "BROWNIE_RUNTIME_TIMEOUT_MS";
const RUNTIME_OBJECTIVE_TIMEOUT_MS_ENV: &str = "BROWNIE_RUNTIME_OBJECTIVE_TIMEOUT_MS";
const DEFAULT_READ_ONLY_TIMEOUT_MS: u64 = 2_000;
const DEFAULT_OBJECTIVE_EXECUTION_TIMEOUT_MS: u64 = 120_000;
const MAX_RESPONSE_BYTES: usize = 16 * 1024;
const MAX_STATUS_FIELD_CHARS: usize = 128;
const MAX_RENDERED_OUTPUT_CHARS: usize = 4 * 1024;
const MAX_TEXT_FIELD_CHARS: usize = 256;
const MAX_TASK_LIST_ROWS: usize = 10;
const CLI_RUN_MAX_ADVANCES: u8 = 1;
const CLI_RUN_MAX_STEPS_PER_ADVANCE: u8 = 1;
const CLI_RUN_MAX_PROMPT_CHARS: usize = 4_096;
const CLI_RUN_MAX_LEDGER_EVENTS: usize = 16;
const CLI_RESUME_MAX_STEPS: u8 = 1;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeClient {
    boundary: RuntimeClientBoundary,
    config: RuntimeClientConfig,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeClientConfig {
    pub runtime_path: Option<PathBuf>,
    pub read_only_timeout: Duration,
    pub objective_execution_timeout: Duration,
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
            read_only_timeout: env_timeout(RUNTIME_TIMEOUT_MS_ENV, DEFAULT_READ_ONLY_TIMEOUT_MS),
            objective_execution_timeout: env_timeout(
                RUNTIME_OBJECTIVE_TIMEOUT_MS_ENV,
                DEFAULT_OBJECTIVE_EXECUTION_TIMEOUT_MS,
            ),
        }
    }

    pub fn with_runtime_path(path: PathBuf) -> Self {
        Self {
            runtime_path: Some(path),
            read_only_timeout: Duration::from_millis(DEFAULT_READ_ONLY_TIMEOUT_MS),
            objective_execution_timeout: Duration::from_millis(
                DEFAULT_OBJECTIVE_EXECUTION_TIMEOUT_MS,
            ),
        }
    }

    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.read_only_timeout = timeout;
        self.objective_execution_timeout = timeout;
        self
    }

    pub fn with_request_timeouts(
        mut self,
        read_only_timeout: Duration,
        objective_execution_timeout: Duration,
    ) -> Self {
        self.read_only_timeout = read_only_timeout;
        self.objective_execution_timeout = objective_execution_timeout;
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
            CliCommand::Run { objective } => self.runtime_run(objective, json),
            CliCommand::Resume => self.runtime_resume(json),
            CliCommand::Status => self.runtime_status(json),
            CliCommand::Inspect {
                target: InspectTarget::Task { task_id },
            } => self.runtime_task_inspect(task_id, json),
            CliCommand::Inspect {
                target: InspectTarget::Run { run_id },
            } => self.runtime_run_inspect(run_id, json),
            CliCommand::List {
                target: ListTarget::Tasks,
            } => self.runtime_task_list(json),
            _ => Err(RuntimeClientError::UnsupportedCommand),
        }
    }

    fn runtime_run(
        &self,
        objective: &str,
        json_output: bool,
    ) -> Result<String, RuntimeClientError> {
        let result = self.call_runtime_value(
            HEADLESS_RUN_DRIVE_METHOD,
            Some(cli_run_drive_params(objective)?),
            RuntimeRequestClass::ObjectiveExecution,
        )?;
        validate_headless_run_drive_result(&result)?;
        if json_output {
            return json_result("run", cli_run_payload(&result)?);
        }

        bounded_output(render_run_result(&result)?)
    }

    fn runtime_resume(&self, json_output: bool) -> Result<String, RuntimeClientError> {
        let task_list =
            self.call_runtime_value(TASK_LIST_METHOD, None, RuntimeRequestClass::ReadOnly)?;
        validate_task_list_result(&task_list)?;
        let resume_params = cli_resume_params(&task_list)?;
        let result = self.call_runtime_value(
            HEADLESS_CONTINUE_ONCE_METHOD,
            Some(resume_params),
            RuntimeRequestClass::ObjectiveExecution,
        )?;
        validate_headless_continue_once_result(&result)?;
        if json_output {
            return json_result("resume", cli_resume_payload(&result)?);
        }

        bounded_output(render_resume_result(&result)?)
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
        let result =
            self.call_runtime_value(RUNTIME_STATUS_METHOD, None, RuntimeRequestClass::ReadOnly)?;
        parse_runtime_status_result(result)
    }

    fn runtime_task_inspect(
        &self,
        task_id: &str,
        json_output: bool,
    ) -> Result<String, RuntimeClientError> {
        let result = self.call_runtime_value(
            TASK_INSPECT_METHOD,
            Some(json!({ "task_id": task_id })),
            RuntimeRequestClass::ReadOnly,
        )?;
        validate_task_inspect_result(&result)?;
        if json_output {
            return json_result("task_inspect", result);
        }

        bounded_output(render_task_inspect(&result)?)
    }

    fn runtime_run_inspect(
        &self,
        run_id: &str,
        json_output: bool,
    ) -> Result<String, RuntimeClientError> {
        let result = self.call_runtime_value(
            RUN_INSPECT_METHOD,
            Some(json!({ "run_id": run_id })),
            RuntimeRequestClass::ReadOnly,
        )?;
        validate_run_inspect_result(&result)?;
        if json_output {
            return json_result("run_inspect", result);
        }

        bounded_output(render_run_inspect(&result)?)
    }

    fn runtime_task_list(&self, json_output: bool) -> Result<String, RuntimeClientError> {
        let result =
            self.call_runtime_value(TASK_LIST_METHOD, None, RuntimeRequestClass::ReadOnly)?;
        validate_task_list_result(&result)?;
        if json_output {
            return json_result("task_list", result);
        }

        bounded_output(render_task_list(&result)?)
    }

    fn call_runtime_value(
        &self,
        method: &str,
        params: Option<Value>,
        request_class: RuntimeRequestClass,
    ) -> Result<Value, RuntimeClientError> {
        let request_id = json!(1);
        let mut request = json!({
            "jsonrpc": JSONRPC_VERSION,
            "id": request_id.clone(),
            "method": method
        });
        if let Some(params) = params {
            request["params"] = params;
        }
        let request_line =
            serde_json::to_string(&request).map_err(|_| RuntimeClientError::CommunicationFailed)?;
        let response_line = self.send_one_request(&request_line, request_class)?;
        parse_runtime_value_response(&response_line, &request_id)
    }

    fn send_one_request(
        &self,
        request_line: &str,
        request_class: RuntimeRequestClass,
    ) -> Result<String, RuntimeClientError> {
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

        let response = match receiver.recv_timeout(self.timeout_for(request_class)) {
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

    fn timeout_for(&self, request_class: RuntimeRequestClass) -> Duration {
        match request_class {
            RuntimeRequestClass::ReadOnly => self.config.read_only_timeout,
            RuntimeRequestClass::ObjectiveExecution => self.config.objective_execution_timeout,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RuntimeRequestClass {
    ReadOnly,
    ObjectiveExecution,
}

fn env_timeout(name: &str, default_ms: u64) -> Duration {
    env::var(name)
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .map(Duration::from_millis)
        .unwrap_or_else(|| Duration::from_millis(default_ms))
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

#[cfg(test)]
fn parse_runtime_status_response(
    line: &str,
    expected_id: &Value,
) -> Result<RuntimeStatus, RuntimeClientError> {
    parse_runtime_status_result(parse_runtime_value_response(line, expected_id)?)
}

fn parse_runtime_value_response(
    line: &str,
    expected_id: &Value,
) -> Result<Value, RuntimeClientError> {
    let raw: Value = serde_json::from_str(line).map_err(|_| RuntimeClientError::InvalidResponse)?;
    let response: JsonRpcResponse<Value> =
        serde_json::from_value(raw).map_err(|_| RuntimeClientError::InvalidResponse)?;

    if response.jsonrpc != JSONRPC_VERSION || response.id != *expected_id {
        return Err(RuntimeClientError::InvalidResponse);
    }

    match (response.result, response.error) {
        (Some(result), None) => Ok(result),
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

fn json_result(key: &str, result: Value) -> Result<String, RuntimeClientError> {
    let mut payload = serde_json::Map::new();
    payload.insert("ok".to_string(), Value::Bool(true));
    payload.insert(key.to_string(), result);
    bounded_output(format!("{}\n", Value::Object(payload)))
}

fn bounded_output(output: String) -> Result<String, RuntimeClientError> {
    if output.chars().count() > MAX_RENDERED_OUTPUT_CHARS {
        return Err(RuntimeClientError::InvalidResponse);
    }
    Ok(output)
}

fn validate_task_inspect_result(result: &Value) -> Result<(), RuntimeClientError> {
    object_field(result, "task")?;
    object_field(result, "run")?;
    Ok(())
}

fn validate_run_inspect_result(result: &Value) -> Result<(), RuntimeClientError> {
    object_field(result, "run")?;
    Ok(())
}

fn validate_task_list_result(result: &Value) -> Result<(), RuntimeClientError> {
    let tasks = result
        .as_object()
        .and_then(|object| object.get("tasks"))
        .and_then(Value::as_array)
        .ok_or(RuntimeClientError::InvalidResponse)?;
    for task in tasks {
        task.as_object()
            .ok_or(RuntimeClientError::InvalidResponse)?;
    }
    object_field(result, "progress_overview")?;
    Ok(())
}

fn validate_headless_run_drive_result(result: &Value) -> Result<(), RuntimeClientError> {
    let object = result
        .as_object()
        .ok_or(RuntimeClientError::InvalidResponse)?;
    for key in ["status", "session_id", "drive_id", "next_action"] {
        required_display_string(object, key)?;
    }
    let closure = object_field(result, "completion_closure")?;
    required_display_string(closure, "status")?;
    Ok(())
}

fn validate_headless_continue_once_result(result: &Value) -> Result<(), RuntimeClientError> {
    let object = result
        .as_object()
        .ok_or(RuntimeClientError::InvalidResponse)?;
    let status = required_display_string(object, "status")?;
    if !matches!(
        status.as_str(),
        "stale_progress" | "no_eligible_task" | "task_in_progress" | "task_executed"
    ) {
        return Err(RuntimeClientError::InvalidResponse);
    }
    for key in [
        "expected_progress_fingerprint",
        "current_progress_fingerprint",
        "next_action",
    ] {
        required_display_string(object, key)?;
    }
    required_u64(object, "expected_aggregate_sequence")?;
    required_u64(object, "current_aggregate_sequence")?;
    display_usize(object, "candidate_count")?;
    required_bool(object, "stale")?;
    required_bool(object, "replayed")?;
    optional_bounded_string(object, "decision_id")?;
    optional_bounded_string(object, "continuation_id")?;
    optional_bounded_string(object, "selected_task_id")?;
    optional_bounded_string(object, "selected_run_id")?;
    optional_bounded_string(object, "post_progress_fingerprint")?;
    optional_u64(object, "post_aggregate_sequence")?;
    Ok(())
}

fn render_run_result(result: &Value) -> Result<String, RuntimeClientError> {
    let object = result
        .as_object()
        .ok_or(RuntimeClientError::InvalidResponse)?;
    let session_id = display_string(object, "session_id")?;
    let status = display_string(object, "status")?;
    let drive_id = display_string(object, "drive_id")?;
    let next_action = display_string(object, "next_action")?;
    let closure = object_field(result, "completion_closure")?;
    let closure_status = display_string(closure, "status")?;
    let journey = optional_object_field(object, "journey")
        .or_else(|| optional_object_field(object, "journey_execution"));
    let journey_id = display_string_from_optional(journey, "journey_id")?;
    let task_id = display_string_from_optional(journey, "task_id")?;
    let run_id = display_string_from_optional(journey, "run_id")?;
    let completion = object
        .get("terminal_completion_evidence")
        .and_then(Value::as_object)
        .map(|evidence| display_string(evidence, "completion_summary_preview"))
        .transpose()?
        .unwrap_or_else(|| "none".to_string());

    Ok(format!(
        "run {session_id}\n  status: {status}\n  drive: {drive_id}\n  journey: {journey_id}\n  task: {task_id}\n  runtime_run: {run_id}\n  closure: {closure_status}\n  next: {next_action}\n  completion: {completion}\n"
    ))
}

fn cli_run_payload(result: &Value) -> Result<Value, RuntimeClientError> {
    let object = result
        .as_object()
        .ok_or(RuntimeClientError::InvalidResponse)?;
    let closure = object_field(result, "completion_closure")?;
    let journey = optional_object_field(object, "journey")
        .or_else(|| optional_object_field(object, "journey_execution"));
    let mut payload = serde_json::Map::new();
    for key in [
        "status",
        "session_id",
        "drive_id",
        "next_action",
        "stop_reason",
    ] {
        if let Some(value) = object.get(key) {
            payload.insert(key.to_string(), bounded_json_string(value)?);
        }
    }
    payload.insert(
        "completion_closure_status".to_string(),
        bounded_json_string(
            closure
                .get("status")
                .ok_or(RuntimeClientError::InvalidResponse)?,
        )?,
    );
    if let Some(journey) = journey {
        for key in ["journey_id", "task_id", "run_id"] {
            if let Some(value) = journey.get(key) {
                payload.insert(key.to_string(), bounded_json_string(value)?);
            }
        }
    }
    if let Some(evidence) = object
        .get("terminal_completion_evidence")
        .and_then(Value::as_object)
    {
        if let Some(value) = evidence.get("completion_summary_preview") {
            payload.insert(
                "completion_summary_preview".to_string(),
                bounded_json_string(value)?,
            );
        }
        if let Some(value) = evidence.get("completion_result_fingerprint") {
            payload.insert(
                "completion_result_fingerprint".to_string(),
                bounded_json_string(value)?,
            );
        }
    }
    Ok(Value::Object(payload))
}

fn render_resume_result(result: &Value) -> Result<String, RuntimeClientError> {
    let object = result
        .as_object()
        .ok_or(RuntimeClientError::InvalidResponse)?;
    let status = display_string(object, "status")?;
    let continuation_id = display_optional_string(object, "continuation_id")?;
    let task_id = display_optional_string(object, "selected_task_id")?;
    let run_id = display_optional_string(object, "selected_run_id")?;
    let candidate_count = display_usize(object, "candidate_count")?;
    let stale = display_bool(object, "stale")?;
    let replayed = display_bool(object, "replayed")?;
    let next_action = display_string(object, "next_action")?;

    Ok(format!(
        "resume\n  status: {status}\n  continuation: {continuation_id}\n  task: {task_id}\n  runtime_run: {run_id}\n  candidates: {candidate_count}\n  stale: {stale}\n  replayed: {replayed}\n  next: {next_action}\n"
    ))
}

fn cli_resume_payload(result: &Value) -> Result<Value, RuntimeClientError> {
    let object = result
        .as_object()
        .ok_or(RuntimeClientError::InvalidResponse)?;
    let mut payload = serde_json::Map::new();
    for key in [
        "status",
        "decision_id",
        "continuation_id",
        "selected_task_id",
        "selected_run_id",
        "next_action",
    ] {
        if let Some(value) = object.get(key) {
            payload.insert(key.to_string(), bounded_json_optional_string(value)?);
        }
    }
    for key in [
        "candidate_count",
        "current_aggregate_sequence",
        "post_aggregate_sequence",
    ] {
        if let Some(value) = object.get(key) {
            payload.insert(key.to_string(), bounded_json_optional_u64(value)?);
        }
    }
    for key in ["stale", "replayed"] {
        if let Some(value) = object.get(key) {
            payload.insert(key.to_string(), Value::Bool(json_bool(value)?));
        }
    }
    Ok(Value::Object(payload))
}

fn cli_resume_params(task_list: &Value) -> Result<Value, RuntimeClientError> {
    let progress = object_field(task_list, "progress_overview")?;
    let progress_fingerprint = required_display_string(progress, "source_fingerprint")?;
    let aggregate_sequence = required_u64(progress, "aggregate_sequence")?;
    let continuation_id = stable_cli_resume_id(&progress_fingerprint, aggregate_sequence);
    Ok(json!({
        "authorize": true,
        "expected_progress_fingerprint": progress_fingerprint,
        "expected_aggregate_sequence": aggregate_sequence,
        "continuation_id": continuation_id,
        "max_steps": CLI_RESUME_MAX_STEPS,
        "context_budget": {
            "max_prompt_chars": CLI_RUN_MAX_PROMPT_CHARS,
            "max_ledger_events": CLI_RUN_MAX_LEDGER_EVENTS,
            "max_selected_index_chars": 0
        }
    }))
}

fn cli_run_drive_params(objective: &str) -> Result<Value, RuntimeClientError> {
    let objective = objective.trim();
    let run_id = stable_cli_run_id(objective)?;
    Ok(json!({
        "authorize": true,
        "session_id": format!("cli.run.{run_id}"),
        "drive_id": format!("cli.run.{run_id}.drive"),
        "expected_start_session_sequence": 0,
        "max_advances": CLI_RUN_MAX_ADVANCES,
        "max_steps_per_advance": CLI_RUN_MAX_STEPS_PER_ADVANCE,
        "context_budget": {
            "max_prompt_chars": CLI_RUN_MAX_PROMPT_CHARS,
            "max_ledger_events": CLI_RUN_MAX_LEDGER_EVENTS,
            "max_selected_index_chars": 0
        },
        "journey_admission": {
            "journey_id": format!("cli.run.{run_id}.journey"),
            "authorize_journey_start": true,
            "task_start": {
                "goal": objective
            }
        }
    }))
}

fn stable_cli_run_id(objective: &str) -> Result<String, RuntimeClientError> {
    let objective = objective.trim();
    if objective.is_empty() || objective.chars().count() > CLI_RUN_MAX_PROMPT_CHARS {
        return Err(RuntimeClientError::InvalidResponse);
    }
    let mut hasher = Sha256::new();
    hasher.update(b"brownie-cli-run-v1\\0");
    hasher.update(objective.as_bytes());
    let digest = hasher.finalize();
    Ok(hex_prefix(&digest, 16))
}

fn stable_cli_resume_id(progress_fingerprint: &str, aggregate_sequence: u64) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"brownie-cli-resume-v1\\0");
    hasher.update(progress_fingerprint.as_bytes());
    hasher.update(b"\\0");
    hasher.update(aggregate_sequence.to_string().as_bytes());
    let digest = hasher.finalize();
    format!("cli.resume.{}", hex_prefix(&digest, 16))
}

fn hex_prefix(bytes: &[u8], len: usize) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(len * 2);
    for byte in bytes.iter().take(len) {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

fn render_task_inspect(result: &Value) -> Result<String, RuntimeClientError> {
    let task = object_field(result, "task")?;
    let run = object_field(result, "run")?;
    let progress = optional_object_field(run, "progress_snapshot");

    let task_id = display_string(task, "task_id")?;
    let run_id = display_string(task, "run_id")?;
    let status = display_string(task, "status")?;
    let stage = display_string_from_optional(progress, "current_stage")?;
    let next_action = display_string_from_optional(progress, "next_action")?;

    Ok(format!(
        "task {task_id}\n  status: {status}\n  run: {run_id}\n  stage: {stage}\n  next: {next_action}\n"
    ))
}

fn render_run_inspect(result: &Value) -> Result<String, RuntimeClientError> {
    let run = object_field(result, "run")?;
    let progress = optional_object_field(run, "progress_snapshot");

    let run_id = display_string(run, "run_id")?;
    let task_id = display_optional_string(run, "task_id")?;
    let status = display_optional_string(run, "status")?;
    let stage = display_string_from_optional(progress, "current_stage")?;
    let next_action = display_string_from_optional(progress, "next_action")?;
    let event_count = display_usize(run, "event_count")?;

    Ok(format!(
        "run {run_id}\n  task: {task_id}\n  status: {status}\n  stage: {stage}\n  next: {next_action}\n  events: {event_count}\n"
    ))
}

fn render_task_list(result: &Value) -> Result<String, RuntimeClientError> {
    let object = result
        .as_object()
        .ok_or(RuntimeClientError::InvalidResponse)?;
    let tasks = object
        .get("tasks")
        .and_then(Value::as_array)
        .ok_or(RuntimeClientError::InvalidResponse)?;
    let progress = object_field(result, "progress_overview")?;

    let task_count = display_usize_or(progress, "task_count", tasks.len())?;
    let runnable_count = array_len(progress, "runnable_task_ids")?;
    let blocked_count = array_len(progress, "blocked_task_ids")?;
    let terminal_count = array_len(progress, "terminal_task_ids")?;

    let mut output = format!(
        "tasks {task_count}\n  runnable: {runnable_count}\n  blocked: {blocked_count}\n  terminal: {terminal_count}\n"
    );
    for task in tasks.iter().take(MAX_TASK_LIST_ROWS) {
        let task = task
            .as_object()
            .ok_or(RuntimeClientError::InvalidResponse)?;
        let task_id = display_string(task, "task_id")?;
        let run_id = display_string(task, "run_id")?;
        let status = display_string(task, "status")?;
        output.push_str(&format!("  {task_id} {status} {run_id}\n"));
    }
    if tasks.len() > MAX_TASK_LIST_ROWS {
        output.push_str(&format!(
            "  ... {} more\n",
            tasks.len() - MAX_TASK_LIST_ROWS
        ));
    }
    Ok(output)
}

fn object_field<'a>(
    value: &'a Value,
    key: &str,
) -> Result<&'a serde_json::Map<String, Value>, RuntimeClientError> {
    value
        .as_object()
        .and_then(|object| object.get(key))
        .and_then(Value::as_object)
        .ok_or(RuntimeClientError::InvalidResponse)
}

fn optional_object_field<'a>(
    object: &'a serde_json::Map<String, Value>,
    key: &str,
) -> Option<&'a serde_json::Map<String, Value>> {
    object.get(key).and_then(Value::as_object)
}

fn display_string(
    object: &serde_json::Map<String, Value>,
    key: &str,
) -> Result<String, RuntimeClientError> {
    let Some(value) = object.get(key) else {
        return Ok("unknown".to_string());
    };
    bounded_string(value)
}

fn required_display_string(
    object: &serde_json::Map<String, Value>,
    key: &str,
) -> Result<String, RuntimeClientError> {
    let Some(value) = object.get(key) else {
        return Err(RuntimeClientError::InvalidResponse);
    };
    bounded_string(value)
}

fn display_optional_string(
    object: &serde_json::Map<String, Value>,
    key: &str,
) -> Result<String, RuntimeClientError> {
    match object.get(key) {
        Some(Value::Null) | None => Ok("none".to_string()),
        Some(value) => bounded_string(value),
    }
}

fn optional_bounded_string(
    object: &serde_json::Map<String, Value>,
    key: &str,
) -> Result<(), RuntimeClientError> {
    match object.get(key) {
        Some(Value::Null) | None => Ok(()),
        Some(value) => bounded_string(value).map(|_| ()),
    }
}

fn display_string_from_optional(
    object: Option<&serde_json::Map<String, Value>>,
    key: &str,
) -> Result<String, RuntimeClientError> {
    match object {
        Some(object) => display_string(object, key),
        None => Ok("unknown".to_string()),
    }
}

fn bounded_string(value: &Value) -> Result<String, RuntimeClientError> {
    let value = value.as_str().ok_or(RuntimeClientError::InvalidResponse)?;
    if value.is_empty()
        || value.chars().count() > MAX_TEXT_FIELD_CHARS
        || value.contains('\n')
        || value.contains('\r')
    {
        return Err(RuntimeClientError::InvalidResponse);
    }
    Ok(value.to_string())
}

fn bounded_json_string(value: &Value) -> Result<Value, RuntimeClientError> {
    bounded_string(value).map(Value::String)
}

fn bounded_json_optional_string(value: &Value) -> Result<Value, RuntimeClientError> {
    match value {
        Value::Null => Ok(Value::Null),
        _ => bounded_json_string(value),
    }
}

fn bounded_json_optional_u64(value: &Value) -> Result<Value, RuntimeClientError> {
    match value {
        Value::Null => Ok(Value::Null),
        _ => Ok(Value::Number(required_number(value)?)),
    }
}

fn required_number(value: &Value) -> Result<serde_json::Number, RuntimeClientError> {
    value
        .as_u64()
        .map(serde_json::Number::from)
        .ok_or(RuntimeClientError::InvalidResponse)
}

fn required_u64(
    object: &serde_json::Map<String, Value>,
    key: &str,
) -> Result<u64, RuntimeClientError> {
    object
        .get(key)
        .and_then(Value::as_u64)
        .ok_or(RuntimeClientError::InvalidResponse)
}

fn optional_u64(
    object: &serde_json::Map<String, Value>,
    key: &str,
) -> Result<(), RuntimeClientError> {
    match object.get(key) {
        Some(Value::Null) | None => Ok(()),
        Some(value) if value.as_u64().is_some() => Ok(()),
        Some(_) => Err(RuntimeClientError::InvalidResponse),
    }
}

fn display_bool(
    object: &serde_json::Map<String, Value>,
    key: &str,
) -> Result<bool, RuntimeClientError> {
    object
        .get(key)
        .map(json_bool)
        .ok_or(RuntimeClientError::InvalidResponse)?
}

fn required_bool(
    object: &serde_json::Map<String, Value>,
    key: &str,
) -> Result<bool, RuntimeClientError> {
    display_bool(object, key)
}

fn json_bool(value: &Value) -> Result<bool, RuntimeClientError> {
    value.as_bool().ok_or(RuntimeClientError::InvalidResponse)
}

fn display_usize(
    object: &serde_json::Map<String, Value>,
    key: &str,
) -> Result<usize, RuntimeClientError> {
    display_usize_or(object, key, 0)
}

fn display_usize_or(
    object: &serde_json::Map<String, Value>,
    key: &str,
    default: usize,
) -> Result<usize, RuntimeClientError> {
    match object.get(key) {
        Some(value) => value
            .as_u64()
            .and_then(|value| usize::try_from(value).ok())
            .ok_or(RuntimeClientError::InvalidResponse),
        None => Ok(default),
    }
}

fn array_len(
    object: &serde_json::Map<String, Value>,
    key: &str,
) -> Result<usize, RuntimeClientError> {
    object
        .get(key)
        .and_then(Value::as_array)
        .map(Vec::len)
        .ok_or(RuntimeClientError::InvalidResponse)
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

    #[test]
    fn default_transport_timeouts_separate_read_only_and_objective_execution() {
        let client = RuntimeClient::new(RuntimeClientConfig::with_runtime_path(PathBuf::from(
            "brownie-runtime",
        )));
        assert_eq!(
            client.timeout_for(RuntimeRequestClass::ReadOnly),
            Duration::from_millis(DEFAULT_READ_ONLY_TIMEOUT_MS)
        );
        assert_eq!(
            client.timeout_for(RuntimeRequestClass::ObjectiveExecution),
            Duration::from_millis(DEFAULT_OBJECTIVE_EXECUTION_TIMEOUT_MS)
        );
    }

    #[test]
    fn cli_run_params_are_fixed_headless_drive_without_mode_policy() {
        let params = cli_run_drive_params("summarize this repository").unwrap();
        assert_eq!(params["authorize"], true);
        assert_eq!(params["expected_start_session_sequence"], 0);
        assert_eq!(params["max_advances"], 1);
        assert_eq!(params["max_steps_per_advance"], 1);
        assert_eq!(params["journey_admission"]["authorize_journey_start"], true);
        assert_eq!(
            params["journey_admission"]["task_start"]["goal"],
            "summarize this repository"
        );
        assert!(params["journey_admission"]["task_start"]
            .get("mode_id")
            .is_none());
        assert!(params["session_id"]
            .as_str()
            .unwrap()
            .starts_with("cli.run."));
        assert!(params["drive_id"].as_str().unwrap().ends_with(".drive"));
        assert!(params["journey_admission"]["journey_id"]
            .as_str()
            .unwrap()
            .ends_with(".journey"));
    }

    #[test]
    fn cli_resume_params_use_fresh_progress_without_policy_copy() {
        let task_list = json!({
            "tasks": [],
            "progress_overview": {
                "source_fingerprint": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "aggregate_sequence": 42,
                "runnable_task_ids": [],
                "blocked_task_ids": [],
                "terminal_task_ids": []
            }
        });
        let params = cli_resume_params(&task_list).unwrap();
        assert_eq!(params["authorize"], true);
        assert_eq!(
            params["expected_progress_fingerprint"],
            "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        );
        assert_eq!(params["expected_aggregate_sequence"], 42);
        assert_eq!(params["max_steps"], 1);
        assert_eq!(
            params["context_budget"],
            json!({
                "max_prompt_chars": 4096,
                "max_ledger_events": 16,
                "max_selected_index_chars": 0
            })
        );
        assert!(params["continuation_id"]
            .as_str()
            .unwrap()
            .starts_with("cli.resume."));
        assert!(params.get("verification_recovery_source").is_none());
        assert!(params.get("objective_proposal_apply_target").is_none());
    }
}
