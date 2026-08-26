use crate::cli::{CliCommand, InspectTarget, ListTarget, ModeTarget};
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
use uuid::Uuid;

const JSONRPC_VERSION: &str = "2.0";
const RUNTIME_STATUS_METHOD: &str = "runtime.status";
const TASK_RUN_METHOD: &str = "task.run";
const TASK_INSPECT_METHOD: &str = "task.inspect";
const RUN_INSPECT_METHOD: &str = "run.inspect";
const TASK_LIST_METHOD: &str = "task.list";
const MODE_LIST_METHOD: &str = "mode.list";
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
const MAX_TASK_LIST_GROUP_ROWS: usize = 5;
const MAX_HEADLESS_ROUTE_ROWS: usize = 5;
const MAX_MODE_LIST_ROWS: usize = 12;
const CLI_RUN_MAX_ADVANCES: u8 = 3;
const CLI_RUN_MAX_STEPS_PER_ADVANCE: u8 = 1;
const CLI_RUN_MAX_PARENT_JOIN_ROUTES: u8 = 3;
const CLI_RUN_MAX_PROMPT_CHARS: usize = 4_096;
const CLI_RUN_MAX_LEDGER_EVENTS: usize = 16;
const CLI_RESUME_MAX_STEPS: u8 = 1;
const CLI_RUN_SESSION_PREFIX: &str = "cli.run.";

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
            CliCommand::Mode {
                target: ModeTarget::List,
            } => self.runtime_mode_list(json),
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
        let result = self.follow_parent_join_routes_if_available(result)?;
        let result = self.accept_and_finalize_completed_run_if_available(result)?;
        if json_output {
            return json_result("run", "run", cli_run_payload(&result)?);
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
            return json_result("resume", "resume", cli_resume_payload(&result)?);
        }

        bounded_output(render_resume_result(&result)?)
    }

    fn runtime_status(&self, json_output: bool) -> Result<String, RuntimeClientError> {
        let status = self.call_runtime_status()?;
        if json_output {
            return json_result("status", "status", status_payload(&status)?);
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
            return json_result(
                "inspect task",
                "task_inspect",
                task_inspect_payload(&result)?,
            );
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
            return json_result("inspect run", "run_inspect", run_inspect_payload(&result)?);
        }

        bounded_output(render_run_inspect(&result)?)
    }

    fn runtime_task_list(&self, json_output: bool) -> Result<String, RuntimeClientError> {
        let result =
            self.call_runtime_value(TASK_LIST_METHOD, None, RuntimeRequestClass::ReadOnly)?;
        validate_task_list_result(&result)?;
        if json_output {
            return json_result("list tasks", "task_list", task_list_payload(&result)?);
        }

        bounded_output(render_task_list(&result)?)
    }

    fn runtime_mode_list(&self, json_output: bool) -> Result<String, RuntimeClientError> {
        let result =
            self.call_runtime_value(MODE_LIST_METHOD, None, RuntimeRequestClass::ReadOnly)?;
        validate_mode_list_result(&result)?;
        if json_output {
            return json_result("mode list", "mode_list", mode_list_payload(&result)?);
        }

        bounded_output(render_mode_list(&result)?)
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

    fn accept_and_finalize_completed_run_if_available(
        &self,
        result: Value,
    ) -> Result<Value, RuntimeClientError> {
        let Some(target) = completion_acceptance_target(&result)? else {
            return Ok(result);
        };

        let acceptance_result = self.call_runtime_value(
            TASK_RUN_METHOD,
            Some(task_run_completion_acceptance_params(&target)),
            RuntimeRequestClass::ObjectiveExecution,
        )?;
        validate_completion_acceptance_result(&acceptance_result)?;

        let accepted_route_params = accepted_completion_route_params(&target, false, None);
        let accepted_route = self.call_runtime_value(
            HEADLESS_RUN_DRIVE_METHOD,
            Some(accepted_route_params),
            RuntimeRequestClass::ObjectiveExecution,
        )?;
        validate_headless_run_drive_result(&accepted_route)?;
        validate_accepted_completion_route(&accepted_route)?;

        let closure = object_field(&accepted_route, "completion_closure")?;
        let closure_fingerprint = display_string(closure, "closure_fingerprint")?;
        validate_sha256_fingerprint(&closure_fingerprint)?;
        let mut finalization_target = target;
        finalization_target.expected_start_session_sequence = required_u64(
            accepted_route
                .as_object()
                .ok_or(RuntimeClientError::InvalidResponse)?,
            "end_session_sequence",
        )?;
        let finalized_route_params = accepted_completion_route_params(
            &finalization_target,
            true,
            Some(&closure_fingerprint),
        );
        let finalized_route = self.call_runtime_value(
            HEADLESS_RUN_DRIVE_METHOD,
            Some(finalized_route_params),
            RuntimeRequestClass::ObjectiveExecution,
        )?;
        validate_headless_run_drive_result(&finalized_route)?;
        validate_accepted_completion_route(&finalized_route)?;
        validate_completion_finalization(&finalized_route)?;

        Ok(finalized_route)
    }

    fn follow_parent_join_routes_if_available(
        &self,
        mut result: Value,
    ) -> Result<Value, RuntimeClientError> {
        for route_index in 0..CLI_RUN_MAX_PARENT_JOIN_ROUTES {
            let Some(target) = parent_join_route_target(&result)? else {
                return Ok(result);
            };

            let followup_drive = self.call_runtime_value(
                HEADLESS_RUN_DRIVE_METHOD,
                Some(parent_join_followup_drive_params(&target, route_index)),
                RuntimeRequestClass::ObjectiveExecution,
            )?;
            validate_headless_run_drive_result(&followup_drive)?;
            result = followup_drive;
        }

        Ok(result)
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

fn json_result(command: &str, key: &str, result: Value) -> Result<String, RuntimeClientError> {
    let mut payload = serde_json::Map::new();
    payload.insert("ok".to_string(), Value::Bool(true));
    payload.insert("command".to_string(), Value::String(command.to_string()));
    payload.insert(
        "exit_code".to_string(),
        Value::Number(serde_json::Number::from(0_u8)),
    );
    payload.insert(key.to_string(), result);
    bounded_output(format!("{}\n", Value::Object(payload)))
}

fn bounded_output(output: String) -> Result<String, RuntimeClientError> {
    if output.chars().count() > MAX_RENDERED_OUTPUT_CHARS {
        return Err(RuntimeClientError::InvalidResponse);
    }
    Ok(output)
}

fn status_payload(status: &RuntimeStatus) -> Result<Value, RuntimeClientError> {
    let value = serde_json::to_value(status).map_err(|_| RuntimeClientError::InvalidResponse)?;
    let object = value
        .as_object()
        .ok_or(RuntimeClientError::InvalidResponse)?;
    let mut payload = serde_json::Map::new();
    for key in ["name", "version", "status"] {
        if let Some(value) = object.get(key) {
            payload.insert(key.to_string(), bounded_json_string(value)?);
        }
    }
    Ok(Value::Object(payload))
}

fn task_inspect_payload(result: &Value) -> Result<Value, RuntimeClientError> {
    let task = object_field(result, "task")?;
    let run = object_field(result, "run")?;
    let progress = optional_object_field(run, "progress_snapshot");

    let mut payload = serde_json::Map::new();
    payload.insert("task".to_string(), project_task_row(task)?);
    payload.insert("run".to_string(), project_run_summary(run, progress)?);
    Ok(Value::Object(payload))
}

fn run_inspect_payload(result: &Value) -> Result<Value, RuntimeClientError> {
    let run = object_field(result, "run")?;
    let progress = optional_object_field(run, "progress_snapshot");
    Ok(project_run_summary(run, progress)?)
}

fn task_list_payload(result: &Value) -> Result<Value, RuntimeClientError> {
    let object = result
        .as_object()
        .ok_or(RuntimeClientError::InvalidResponse)?;
    let tasks = object
        .get("tasks")
        .and_then(Value::as_array)
        .ok_or(RuntimeClientError::InvalidResponse)?;
    let progress = object_field(result, "progress_overview")?;

    let mut payload = serde_json::Map::new();
    payload.insert(
        "task_count".to_string(),
        Value::Number(serde_json::Number::from(display_usize_or(
            progress,
            "task_count",
            tasks.len(),
        )?)),
    );
    payload.insert(
        "runnable_count".to_string(),
        Value::Number(serde_json::Number::from(array_len(
            progress,
            "runnable_task_ids",
        )?)),
    );
    payload.insert(
        "blocked_count".to_string(),
        Value::Number(serde_json::Number::from(array_len(
            progress,
            "blocked_task_ids",
        )?)),
    );
    payload.insert(
        "terminal_count".to_string(),
        Value::Number(serde_json::Number::from(array_len(
            progress,
            "terminal_task_ids",
        )?)),
    );
    let parent_join_ready_count =
        optional_array_field_checked(progress, "parent_join_ready_task_ids")?
            .map(Vec::len)
            .unwrap_or(0);
    payload.insert(
        "parent_join_ready_count".to_string(),
        Value::Number(serde_json::Number::from(parent_join_ready_count)),
    );
    if let Some(value) = progress.get("source_fingerprint") {
        payload.insert(
            "source_fingerprint".to_string(),
            bounded_json_string(value)?,
        );
    }
    if let Some(value) = progress.get("aggregate_sequence") {
        payload.insert(
            "aggregate_sequence".to_string(),
            Value::Number(required_number(value)?),
        );
    }
    if let Some(counts) = optional_object_field_checked(progress, "status_counts")? {
        payload.insert("status_counts".to_string(), project_usize_object(counts)?);
    }
    payload.insert(
        "stage_counts".to_string(),
        project_progress_groups(progress, "stage_counts", &["current_stage"])?,
    );
    payload.insert(
        "next_action_sets".to_string(),
        project_progress_groups(progress, "next_action_sets", &["next_action"])?,
    );
    payload.insert(
        "blocked_sets".to_string(),
        project_progress_groups(progress, "blocked_sets", &["current_stage", "next_action"])?,
    );
    payload.insert(
        "headless_route_candidates".to_string(),
        project_route_candidates(progress)?,
    );
    payload.insert("tasks".to_string(), project_task_rows(tasks)?);
    payload.insert(
        "truncated".to_string(),
        json!({
            "tasks": tasks.len() > MAX_TASK_LIST_ROWS,
            "stage_counts": capped_array_len(progress, "stage_counts")? > MAX_TASK_LIST_GROUP_ROWS,
            "next_action_sets": capped_array_len(progress, "next_action_sets")? > MAX_TASK_LIST_GROUP_ROWS,
            "blocked_sets": capped_array_len(progress, "blocked_sets")? > MAX_TASK_LIST_GROUP_ROWS,
            "headless_route_candidates": capped_array_len(progress, "headless_route_candidates")? > MAX_HEADLESS_ROUTE_ROWS
        }),
    );
    Ok(Value::Object(payload))
}

fn mode_list_payload(result: &Value) -> Result<Value, RuntimeClientError> {
    let object = result
        .as_object()
        .ok_or(RuntimeClientError::InvalidResponse)?;
    let modes = object
        .get("modes")
        .and_then(Value::as_array)
        .ok_or(RuntimeClientError::InvalidResponse)?;
    let mut projected = Vec::new();
    for mode in modes.iter().take(MAX_MODE_LIST_ROWS) {
        let mode = mode
            .as_object()
            .ok_or(RuntimeClientError::InvalidResponse)?;
        let permissions = mode
            .get("permissions")
            .and_then(Value::as_object)
            .ok_or(RuntimeClientError::InvalidResponse)?;
        let mut projected_mode = serde_json::Map::new();
        for key in ["mode_id", "display_name", "role_definition"] {
            let value = mode.get(key).ok_or(RuntimeClientError::InvalidResponse)?;
            projected_mode.insert(key.to_string(), bounded_json_string(value)?);
        }
        let mut projected_permissions = serde_json::Map::new();
        for key in [
            "read_only",
            "workspace_write",
            "process_exec",
            "network_access",
            "service_control",
            "destructive",
            "can_spawn_subtasks",
            "codebase_index",
        ] {
            projected_permissions.insert(
                key.to_string(),
                Value::Bool(display_bool(permissions, key)?),
            );
        }
        projected_mode.insert(
            "permissions".to_string(),
            Value::Object(projected_permissions),
        );
        projected.push(Value::Object(projected_mode));
    }
    Ok(json!({
        "mode_count": modes.len(),
        "modes": projected,
        "truncated": modes.len() > MAX_MODE_LIST_ROWS
    }))
}

fn project_task_rows(tasks: &[Value]) -> Result<Value, RuntimeClientError> {
    let mut rows = Vec::new();
    for task in tasks.iter().take(MAX_TASK_LIST_ROWS) {
        rows.push(project_task_row(
            task.as_object()
                .ok_or(RuntimeClientError::InvalidResponse)?,
        )?);
    }
    Ok(Value::Array(rows))
}

fn project_task_row(task: &serde_json::Map<String, Value>) -> Result<Value, RuntimeClientError> {
    let mut row = serde_json::Map::new();
    for key in ["task_id", "run_id", "status"] {
        let value = task.get(key).ok_or(RuntimeClientError::InvalidResponse)?;
        row.insert(key.to_string(), bounded_json_string(value)?);
    }
    Ok(Value::Object(row))
}

fn project_run_summary(
    run: &serde_json::Map<String, Value>,
    progress: Option<&serde_json::Map<String, Value>>,
) -> Result<Value, RuntimeClientError> {
    let mut payload = serde_json::Map::new();
    for key in ["run_id", "task_id", "status"] {
        if let Some(value) = run.get(key) {
            payload.insert(key.to_string(), bounded_json_optional_string(value)?);
        }
    }
    if let Some(progress) = progress {
        for (source_key, target_key) in [
            ("current_stage", "current_stage"),
            ("next_action", "next_action"),
        ] {
            if let Some(value) = progress.get(source_key) {
                payload.insert(target_key.to_string(), bounded_json_string(value)?);
            }
        }
    }
    if let Some(value) = run.get("event_count") {
        payload.insert(
            "event_count".to_string(),
            Value::Number(required_number(value)?),
        );
    }
    Ok(Value::Object(payload))
}

fn project_usize_object(
    object: &serde_json::Map<String, Value>,
) -> Result<Value, RuntimeClientError> {
    let mut payload = serde_json::Map::new();
    for (key, value) in object {
        payload.insert(key.clone(), Value::Number(required_number(value)?));
    }
    Ok(Value::Object(payload))
}

fn project_progress_groups(
    progress: &serde_json::Map<String, Value>,
    key: &str,
    string_keys: &[&str],
) -> Result<Value, RuntimeClientError> {
    let Some(groups) = optional_array_field_checked(progress, key)? else {
        return Ok(Value::Array(Vec::new()));
    };
    let mut projected = Vec::new();
    for group in groups.iter().take(MAX_TASK_LIST_GROUP_ROWS) {
        let group = group
            .as_object()
            .ok_or(RuntimeClientError::InvalidResponse)?;
        let mut payload = serde_json::Map::new();
        for string_key in string_keys {
            let value = group
                .get(*string_key)
                .ok_or(RuntimeClientError::InvalidResponse)?;
            payload.insert((*string_key).to_string(), bounded_json_string(value)?);
        }
        let task_count = display_count(group, "task_count", "task_ids")?;
        payload.insert(
            "task_count".to_string(),
            Value::Number(serde_json::Number::from(task_count)),
        );
        projected.push(Value::Object(payload));
    }
    Ok(Value::Array(projected))
}

fn project_route_candidates(
    progress: &serde_json::Map<String, Value>,
) -> Result<Value, RuntimeClientError> {
    let Some(candidates) = optional_array_field_checked(progress, "headless_route_candidates")?
    else {
        return Ok(Value::Array(Vec::new()));
    };
    let mut projected = Vec::new();
    for candidate in candidates.iter().take(MAX_HEADLESS_ROUTE_ROWS) {
        let candidate = candidate
            .as_object()
            .ok_or(RuntimeClientError::InvalidResponse)?;
        let mut payload = serde_json::Map::new();
        for key in ["kind", "next_action"] {
            let value = candidate
                .get(key)
                .ok_or(RuntimeClientError::InvalidResponse)?;
            payload.insert(key.to_string(), bounded_json_string(value)?);
        }
        payload.insert(
            "priority".to_string(),
            Value::Number(serde_json::Number::from(display_usize(
                candidate, "priority",
            )?)),
        );
        if let Some(value) = candidate.get("task_id") {
            payload.insert("task_id".to_string(), bounded_json_optional_string(value)?);
        }
        if let Some(value) = candidate.get("run_id") {
            payload.insert("run_id".to_string(), bounded_json_optional_string(value)?);
        }
        projected.push(Value::Object(payload));
    }
    Ok(Value::Array(projected))
}

fn capped_array_len(
    object: &serde_json::Map<String, Value>,
    key: &str,
) -> Result<usize, RuntimeClientError> {
    Ok(optional_array_field_checked(object, key)?
        .map(Vec::len)
        .unwrap_or(0))
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
    let progress = object_field(result, "progress_overview")?;
    array_len(progress, "runnable_task_ids")?;
    array_len(progress, "blocked_task_ids")?;
    array_len(progress, "terminal_task_ids")?;
    if let Some(ids) = optional_array_field_checked(progress, "parent_join_ready_task_ids")? {
        validate_string_array(ids)?;
    }
    if let Some(counts) = optional_object_field_checked(progress, "status_counts")? {
        validate_usize_values(counts)?;
    }
    validate_progress_group_array(progress, "stage_counts")?;
    validate_progress_group_array(progress, "next_action_sets")?;
    validate_progress_group_array(progress, "blocked_sets")?;
    validate_progress_group_array(progress, "headless_route_candidates")?;
    Ok(())
}

fn validate_mode_list_result(result: &Value) -> Result<(), RuntimeClientError> {
    let object = result
        .as_object()
        .ok_or(RuntimeClientError::InvalidResponse)?;
    let modes = object
        .get("modes")
        .and_then(Value::as_array)
        .ok_or(RuntimeClientError::InvalidResponse)?;
    for mode in modes.iter().take(MAX_MODE_LIST_ROWS) {
        let mode = mode
            .as_object()
            .ok_or(RuntimeClientError::InvalidResponse)?;
        required_display_string(mode, "mode_id")?;
        required_display_string(mode, "display_name")?;
        required_display_string(mode, "role_definition")?;
        let permissions = mode
            .get("permissions")
            .and_then(Value::as_object)
            .ok_or(RuntimeClientError::InvalidResponse)?;
        for key in [
            "read_only",
            "workspace_write",
            "process_exec",
            "network_access",
            "service_control",
            "destructive",
            "can_spawn_subtasks",
            "codebase_index",
        ] {
            required_bool(permissions, key)?;
        }
    }
    Ok(())
}

fn validate_headless_run_drive_result(result: &Value) -> Result<(), RuntimeClientError> {
    let object = result
        .as_object()
        .ok_or(RuntimeClientError::InvalidResponse)?;
    for key in ["status", "session_id", "drive_id", "next_action"] {
        required_display_string(object, key)?;
    }
    if let Some(closure) = optional_object_field(object, "completion_closure") {
        required_display_string(closure, "status")?;
    }
    Ok(())
}

fn validate_completion_acceptance_result(result: &Value) -> Result<(), RuntimeClientError> {
    let acceptance = object_field(result, "completion_acceptance")?;
    for key in [
        "acceptance_id",
        "task_id",
        "run_id",
        "status",
        "terminal_completion_fingerprint",
        "acceptance_fingerprint",
        "verifier_gate_status",
        "next_action",
    ] {
        required_display_string(acceptance, key)?;
    }
    if display_string(acceptance, "status")? != "AcceptedComplete" {
        return Err(RuntimeClientError::InvalidResponse);
    }
    validate_sha256_fingerprint(&display_string(
        acceptance,
        "terminal_completion_fingerprint",
    )?)?;
    validate_sha256_fingerprint(&display_string(acceptance, "acceptance_fingerprint")?)?;
    Ok(())
}

fn validate_accepted_completion_route(result: &Value) -> Result<(), RuntimeClientError> {
    let accepted = object_field(result, "accepted_completion")?;
    for key in [
        "task_id",
        "run_id",
        "acceptance_id",
        "status",
        "terminal_completion_fingerprint",
        "acceptance_fingerprint",
        "verifier_gate_status",
        "next_action",
    ] {
        required_display_string(accepted, key)?;
    }
    if display_string(accepted, "status")? != "AcceptedComplete" {
        return Err(RuntimeClientError::InvalidResponse);
    }
    validate_sha256_fingerprint(&display_string(
        accepted,
        "terminal_completion_fingerprint",
    )?)?;
    validate_sha256_fingerprint(&display_string(accepted, "acceptance_fingerprint")?)?;
    Ok(())
}

fn validate_completion_finalization(result: &Value) -> Result<(), RuntimeClientError> {
    let finalization = object_field(result, "completion_finalization")?;
    for key in [
        "finalization_fingerprint",
        "closure_fingerprint",
        "progress_fingerprint",
        "status",
        "next_action",
    ] {
        required_display_string(finalization, key)?;
    }
    if display_string(finalization, "status")? != "finalized" {
        return Err(RuntimeClientError::InvalidResponse);
    }
    validate_sha256_fingerprint(&display_string(finalization, "finalization_fingerprint")?)?;
    validate_sha256_fingerprint(&display_string(finalization, "closure_fingerprint")?)?;
    validate_sha256_fingerprint(&display_string(finalization, "progress_fingerprint")?)?;
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
    let closure_status = optional_object_field(object, "completion_closure")
        .map(|closure| display_string(closure, "status"))
        .transpose()?
        .unwrap_or_else(|| "none".to_string());
    let journey = optional_object_field(object, "journey")
        .or_else(|| optional_object_field(object, "journey_execution"));
    let accepted_completion = object.get("accepted_completion").and_then(Value::as_object);
    let journey_id = display_string_from_optional(journey, "journey_id")?;
    let task_id = display_string_from_optional(journey.or(accepted_completion), "task_id")?;
    let run_id = display_string_from_optional(journey.or(accepted_completion), "run_id")?;
    let completion = object
        .get("terminal_completion_evidence")
        .and_then(Value::as_object)
        .map(|evidence| display_string(evidence, "completion_summary_preview"))
        .transpose()?
        .unwrap_or_else(|| "none".to_string());
    let accepted = accepted_completion
        .map(|accepted| display_string(accepted, "status"))
        .transpose()?
        .unwrap_or_else(|| "none".to_string());
    let finalization = object
        .get("completion_finalization")
        .and_then(Value::as_object)
        .map(|finalization| display_string(finalization, "finalization_fingerprint"))
        .transpose()?
        .unwrap_or_else(|| "none".to_string());

    Ok(format!(
        "run {session_id}\n  status: {status}\n  drive: {drive_id}\n  journey: {journey_id}\n  task: {task_id}\n  runtime_run: {run_id}\n  closure: {closure_status}\n  accepted: {accepted}\n  finalization: {finalization}\n  next: {next_action}\n  completion: {completion}\n"
    ))
}

fn cli_run_payload(result: &Value) -> Result<Value, RuntimeClientError> {
    let object = result
        .as_object()
        .ok_or(RuntimeClientError::InvalidResponse)?;
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
    if let Some(closure) = optional_object_field(object, "completion_closure") {
        payload.insert(
            "completion_closure_status".to_string(),
            bounded_json_string(
                closure
                    .get("status")
                    .ok_or(RuntimeClientError::InvalidResponse)?,
            )?,
        );
    }
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
    if let Some(accepted) = object.get("accepted_completion").and_then(Value::as_object) {
        for key in [
            "task_id",
            "run_id",
            "acceptance_id",
            "status",
            "terminal_completion_fingerprint",
            "acceptance_fingerprint",
            "verifier_gate_status",
            "next_action",
        ] {
            if let Some(value) = accepted.get(key) {
                payload.insert(
                    format!("accepted_completion_{key}"),
                    bounded_json_string(value)?,
                );
            }
        }
    }
    if let Some(finalization) = object
        .get("completion_finalization")
        .and_then(Value::as_object)
    {
        for key in [
            "finalization_fingerprint",
            "closure_fingerprint",
            "status",
            "next_action",
        ] {
            if let Some(value) = finalization.get(key) {
                payload.insert(
                    format!("completion_finalization_{key}"),
                    bounded_json_string(value)?,
                );
            }
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
        "continuation_scope": {
            "session_id_prefix": CLI_RUN_SESSION_PREFIX,
            "latest_matching_session": true
        },
        "context_budget": {
            "max_prompt_chars": CLI_RUN_MAX_PROMPT_CHARS,
            "max_ledger_events": CLI_RUN_MAX_LEDGER_EVENTS,
            "max_selected_index_chars": 0
        }
    }))
}

fn cli_run_drive_params(objective: &str) -> Result<Value, RuntimeClientError> {
    let objective = objective.trim();
    validate_cli_objective(objective)?;
    let invocation_id = cli_run_invocation_id();
    let session_id = format!("{CLI_RUN_SESSION_PREFIX}{invocation_id}");
    Ok(json!({
        "authorize": true,
        "session_id": session_id.clone(),
        "drive_id": format!("{session_id}.drive"),
        "expected_start_session_sequence": 0,
        "max_advances": CLI_RUN_MAX_ADVANCES,
        "max_steps_per_advance": CLI_RUN_MAX_STEPS_PER_ADVANCE,
        "context_budget": {
            "max_prompt_chars": CLI_RUN_MAX_PROMPT_CHARS,
            "max_ledger_events": CLI_RUN_MAX_LEDGER_EVENTS,
            "max_selected_index_chars": 0
        },
        "journey_admission": {
            "journey_id": format!("{session_id}.journey"),
            "authorize_journey_start": true,
            "task_start": {
                "goal": objective
            }
        }
    }))
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CompletionAcceptanceTarget {
    session_id: String,
    task_id: String,
    run_id: String,
    terminal_completion_fingerprint: String,
    expected_start_session_sequence: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParentJoinRouteTarget {
    session_id: String,
    expected_start_session_sequence: u64,
    expected_progress_fingerprint: String,
    expected_aggregate_sequence: u64,
    parent_task_id: String,
    parent_run_id: String,
    child_completion_fingerprint: String,
    child_completion_child_count: u64,
    child_terminal_completed_count: u64,
    child_terminal_failed_count: u64,
}

fn parent_join_route_target(
    result: &Value,
) -> Result<Option<ParentJoinRouteTarget>, RuntimeClientError> {
    let object = result
        .as_object()
        .ok_or(RuntimeClientError::InvalidResponse)?;
    let Some(route) = optional_object_field(object, "next_route") else {
        return Ok(None);
    };
    if display_string(route, "kind")? != "run_parent_task_explicitly" {
        return Ok(None);
    }

    let Some(parent_join) = latest_parent_join_readiness_outcome(object) else {
        return Err(RuntimeClientError::InvalidResponse);
    };
    if parent_join
        .get("parent_join_ready")
        .and_then(Value::as_bool)
        != Some(true)
    {
        return Err(RuntimeClientError::InvalidResponse);
    }

    let child_completion_fingerprint = display_string(parent_join, "child_completion_fingerprint")?;
    validate_sha256_fingerprint(&child_completion_fingerprint)?;

    Ok(Some(ParentJoinRouteTarget {
        session_id: display_string(object, "session_id")?,
        expected_start_session_sequence: required_u64(object, "end_session_sequence")?,
        expected_progress_fingerprint: display_string(route, "progress_fingerprint")?,
        expected_aggregate_sequence: required_u64(route, "aggregate_sequence")?,
        parent_task_id: display_string(parent_join, "parent_task_id")?,
        parent_run_id: display_string(parent_join, "parent_run_id")?,
        child_completion_fingerprint,
        child_completion_child_count: required_u64(parent_join, "child_completion_child_count")?,
        child_terminal_completed_count: required_u64(
            parent_join,
            "child_terminal_completed_count",
        )?,
        child_terminal_failed_count: required_u64(parent_join, "child_terminal_failed_count")?,
    }))
}

fn latest_parent_join_readiness_outcome(
    object: &serde_json::Map<String, Value>,
) -> Option<&serde_json::Map<String, Value>> {
    object
        .get("advances")
        .and_then(Value::as_array)?
        .iter()
        .rev()
        .filter_map(|advance| advance.get("steps").and_then(Value::as_array))
        .flat_map(|steps| steps.iter().rev())
        .find_map(|step| {
            step.get("parent_join_readiness_outcome")
                .and_then(Value::as_object)
        })
}

fn parent_join_followup_drive_params(target: &ParentJoinRouteTarget, route_index: u8) -> Value {
    json!({
        "authorize": true,
        "session_id": target.session_id.as_str(),
        "drive_id": format!("{}.parent.{}.drive", target.session_id, route_index + 1),
        "expected_start_session_sequence": target.expected_start_session_sequence,
        "max_advances": CLI_RUN_MAX_ADVANCES,
        "max_steps_per_advance": CLI_RUN_MAX_STEPS_PER_ADVANCE,
        "parent_join_run_target": {
            "authorize_parent_join_run": true,
            "parent_task_id": target.parent_task_id.as_str(),
            "parent_run_id": target.parent_run_id.as_str(),
            "expected_child_completion_fingerprint": target.child_completion_fingerprint.as_str(),
            "expected_child_completion_child_count": target.child_completion_child_count,
            "expected_terminal_completed_child_count": target.child_terminal_completed_count,
            "expected_terminal_failed_child_count": target.child_terminal_failed_count
        }
    })
}

fn completion_acceptance_target(
    result: &Value,
) -> Result<Option<CompletionAcceptanceTarget>, RuntimeClientError> {
    let object = result
        .as_object()
        .ok_or(RuntimeClientError::InvalidResponse)?;
    let Some(closure) = optional_object_field(object, "completion_closure") else {
        return Ok(None);
    };
    let closure_status = display_string(closure, "status")?;
    if closure_status != "complete" || object.get("accepted_completion").is_some() {
        return Ok(None);
    }

    let terminal = object
        .get("terminal_completion_evidence")
        .and_then(Value::as_object)
        .ok_or(RuntimeClientError::InvalidResponse)?;
    let terminal_completion_fingerprint =
        display_string(terminal, "completion_result_fingerprint")?;
    validate_sha256_fingerprint(&terminal_completion_fingerprint)?;

    let journey = optional_object_field(object, "journey")
        .or_else(|| optional_object_field(object, "journey_execution"))
        .ok_or(RuntimeClientError::InvalidResponse)?;
    let session_id = display_string(object, "session_id")?;
    let task_id = display_string(journey, "task_id")?;
    let run_id = display_string(journey, "run_id")?;
    let expected_start_session_sequence = required_u64(object, "end_session_sequence")?;

    Ok(Some(CompletionAcceptanceTarget {
        session_id,
        task_id,
        run_id,
        terminal_completion_fingerprint,
        expected_start_session_sequence,
    }))
}

fn task_run_completion_acceptance_params(target: &CompletionAcceptanceTarget) -> Value {
    json!({
        "task_id": target.task_id.as_str(),
        "completion_acceptance": {
            "authorize_completion_acceptance": true,
            "source_run_id": target.run_id.as_str(),
            "acceptance_id": format!("{}.ok", target.session_id),
            "expected_completion_result_fingerprint": target.terminal_completion_fingerprint.as_str(),
        }
    })
}

fn accepted_completion_route_params(
    target: &CompletionAcceptanceTarget,
    authorize_completion_finalization: bool,
    expected_completion_closure_fingerprint: Option<&str>,
) -> Value {
    let drive_suffix = if authorize_completion_finalization {
        "finalize"
    } else {
        "done"
    };
    let mut params = json!({
        "authorize": true,
        "session_id": target.session_id.as_str(),
        "drive_id": format!("{}.{}", target.session_id, drive_suffix),
        "expected_start_session_sequence": target.expected_start_session_sequence,
        "max_advances": 1,
        "max_steps_per_advance": 1
    });

    if authorize_completion_finalization {
        params["authorize_completion_finalization"] = Value::Bool(true);
    }
    if let Some(fingerprint) = expected_completion_closure_fingerprint {
        params["expected_completion_closure_fingerprint"] = Value::String(fingerprint.to_string());
    }
    params
}

fn validate_cli_objective(objective: &str) -> Result<(), RuntimeClientError> {
    if objective.is_empty() || objective.chars().count() > CLI_RUN_MAX_PROMPT_CHARS {
        return Err(RuntimeClientError::InvalidResponse);
    }
    Ok(())
}

fn cli_run_invocation_id() -> String {
    Uuid::new_v4()
        .simple()
        .to_string()
        .chars()
        .take(20)
        .collect()
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
    let parent_join_ready_count =
        optional_array_field_checked(progress, "parent_join_ready_task_ids")?
            .map(Vec::len)
            .unwrap_or(0);

    let mut output = format!(
        "tasks {task_count}\n  runnable: {runnable_count}\n  blocked: {blocked_count}\n  terminal: {terminal_count}\n  parent_join_ready: {parent_join_ready_count}\n"
    );
    render_status_counts(&mut output, progress)?;
    render_stage_counts(&mut output, progress)?;
    render_next_action_sets(&mut output, progress)?;
    render_blocked_sets(&mut output, progress)?;
    render_headless_route_candidates(&mut output, progress)?;
    output.push_str("  task rows:\n");
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

fn render_status_counts(
    output: &mut String,
    progress: &serde_json::Map<String, Value>,
) -> Result<(), RuntimeClientError> {
    let Some(counts) = optional_object_field_checked(progress, "status_counts")? else {
        return Ok(());
    };
    let keys = [
        "created",
        "queued",
        "running",
        "completed",
        "failed",
        "cancelled",
    ];
    let mut parts = Vec::new();
    for key in keys {
        if counts.contains_key(key) {
            parts.push(format!("{key}:{}", display_usize(counts, key)?));
        }
    }
    if !parts.is_empty() {
        output.push_str(&format!("  status_counts: {}\n", parts.join(" ")));
    }
    Ok(())
}

fn render_stage_counts(
    output: &mut String,
    progress: &serde_json::Map<String, Value>,
) -> Result<(), RuntimeClientError> {
    let Some(stages) = optional_array_field_checked(progress, "stage_counts")? else {
        return Ok(());
    };
    if stages.is_empty() {
        return Ok(());
    }
    output.push_str("  stages:\n");
    for stage in stages.iter().take(MAX_TASK_LIST_GROUP_ROWS) {
        let stage = stage
            .as_object()
            .ok_or(RuntimeClientError::InvalidResponse)?;
        let current_stage = display_string(stage, "current_stage")?;
        let task_count = display_usize_or(stage, "task_count", 0)?;
        output.push_str(&format!("    {current_stage}: {task_count}\n"));
    }
    render_truncation(
        output,
        "stage groups",
        stages.len(),
        MAX_TASK_LIST_GROUP_ROWS,
    );
    Ok(())
}

fn render_next_action_sets(
    output: &mut String,
    progress: &serde_json::Map<String, Value>,
) -> Result<(), RuntimeClientError> {
    let Some(sets) = optional_array_field_checked(progress, "next_action_sets")? else {
        return Ok(());
    };
    if sets.is_empty() {
        return Ok(());
    }
    output.push_str("  next actions:\n");
    for set in sets.iter().take(MAX_TASK_LIST_GROUP_ROWS) {
        let set = set.as_object().ok_or(RuntimeClientError::InvalidResponse)?;
        let next_action = display_string(set, "next_action")?;
        let task_count = display_count(set, "task_count", "task_ids")?;
        output.push_str(&format!("    {next_action}: {task_count}\n"));
    }
    render_truncation(
        output,
        "next action groups",
        sets.len(),
        MAX_TASK_LIST_GROUP_ROWS,
    );
    Ok(())
}

fn render_blocked_sets(
    output: &mut String,
    progress: &serde_json::Map<String, Value>,
) -> Result<(), RuntimeClientError> {
    let Some(sets) = optional_array_field_checked(progress, "blocked_sets")? else {
        return Ok(());
    };
    if sets.is_empty() {
        return Ok(());
    }
    output.push_str("  blocked groups:\n");
    for set in sets.iter().take(MAX_TASK_LIST_GROUP_ROWS) {
        let set = set.as_object().ok_or(RuntimeClientError::InvalidResponse)?;
        let current_stage = display_string(set, "current_stage")?;
        let next_action = display_string(set, "next_action")?;
        let task_count = display_count(set, "task_count", "task_ids")?;
        output.push_str(&format!(
            "    {current_stage} -> {next_action}: {task_count}\n"
        ));
    }
    render_truncation(
        output,
        "blocked groups",
        sets.len(),
        MAX_TASK_LIST_GROUP_ROWS,
    );
    Ok(())
}

fn render_headless_route_candidates(
    output: &mut String,
    progress: &serde_json::Map<String, Value>,
) -> Result<(), RuntimeClientError> {
    let Some(candidates) = optional_array_field_checked(progress, "headless_route_candidates")?
    else {
        return Ok(());
    };
    if candidates.is_empty() {
        return Ok(());
    }
    output.push_str("  headless routes:\n");
    for candidate in candidates.iter().take(MAX_HEADLESS_ROUTE_ROWS) {
        let candidate = candidate
            .as_object()
            .ok_or(RuntimeClientError::InvalidResponse)?;
        let priority = display_usize(candidate, "priority")?;
        let kind = display_string(candidate, "kind")?;
        let next_action = display_string(candidate, "next_action")?;
        let task_id = display_optional_string(candidate, "task_id")?;
        output.push_str(&format!(
            "    p{priority} {kind} {next_action} task:{task_id}\n"
        ));
    }
    render_truncation(
        output,
        "headless route candidates",
        candidates.len(),
        MAX_HEADLESS_ROUTE_ROWS,
    );
    Ok(())
}

fn render_mode_list(result: &Value) -> Result<String, RuntimeClientError> {
    let object = result
        .as_object()
        .ok_or(RuntimeClientError::InvalidResponse)?;
    let modes = object
        .get("modes")
        .and_then(Value::as_array)
        .ok_or(RuntimeClientError::InvalidResponse)?;
    let mut output = format!("modes {}\n", modes.len());
    for mode in modes.iter().take(MAX_MODE_LIST_ROWS) {
        let mode = mode
            .as_object()
            .ok_or(RuntimeClientError::InvalidResponse)?;
        let mode_id = display_string(mode, "mode_id")?;
        let display_name = display_string(mode, "display_name")?;
        let role = display_string(mode, "role_definition")?;
        let permissions = mode
            .get("permissions")
            .and_then(Value::as_object)
            .ok_or(RuntimeClientError::InvalidResponse)?;
        output.push_str(&format!("  {mode_id} {display_name}\n"));
        output.push_str(&format!("    role: {role}\n"));
        output.push_str(&format!(
            "    permissions: read_only={} workspace_write={} process_exec={} network_access={} service_control={} destructive={} can_spawn_subtasks={} codebase_index={}\n",
            display_bool(permissions, "read_only")?,
            display_bool(permissions, "workspace_write")?,
            display_bool(permissions, "process_exec")?,
            display_bool(permissions, "network_access")?,
            display_bool(permissions, "service_control")?,
            display_bool(permissions, "destructive")?,
            display_bool(permissions, "can_spawn_subtasks")?,
            display_bool(permissions, "codebase_index")?
        ));
    }
    render_truncation(&mut output, "modes", modes.len(), MAX_MODE_LIST_ROWS);
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

fn optional_array_field<'a>(
    object: &'a serde_json::Map<String, Value>,
    key: &str,
) -> Option<&'a Vec<Value>> {
    object.get(key).and_then(Value::as_array)
}

fn optional_object_field_checked<'a>(
    object: &'a serde_json::Map<String, Value>,
    key: &str,
) -> Result<Option<&'a serde_json::Map<String, Value>>, RuntimeClientError> {
    match object.get(key) {
        Some(Value::Null) | None => Ok(None),
        Some(value) => value
            .as_object()
            .map(Some)
            .ok_or(RuntimeClientError::InvalidResponse),
    }
}

fn optional_array_field_checked<'a>(
    object: &'a serde_json::Map<String, Value>,
    key: &str,
) -> Result<Option<&'a Vec<Value>>, RuntimeClientError> {
    match object.get(key) {
        Some(Value::Null) | None => Ok(None),
        Some(value) => value
            .as_array()
            .map(Some)
            .ok_or(RuntimeClientError::InvalidResponse),
    }
}

fn validate_string_array(values: &[Value]) -> Result<(), RuntimeClientError> {
    for value in values {
        bounded_string(value)?;
    }
    Ok(())
}

fn validate_usize_values(
    object: &serde_json::Map<String, Value>,
) -> Result<(), RuntimeClientError> {
    for value in object.values() {
        required_number(value)?;
    }
    Ok(())
}

fn validate_progress_group_array(
    object: &serde_json::Map<String, Value>,
    key: &str,
) -> Result<(), RuntimeClientError> {
    let Some(groups) = optional_array_field_checked(object, key)? else {
        return Ok(());
    };
    for group in groups {
        group
            .as_object()
            .ok_or(RuntimeClientError::InvalidResponse)?;
    }
    Ok(())
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

fn validate_sha256_fingerprint(value: &str) -> Result<(), RuntimeClientError> {
    let Some(hex) = value.strip_prefix("sha256:") else {
        return Err(RuntimeClientError::InvalidResponse);
    };
    if hex.len() != 64 || !hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(RuntimeClientError::InvalidResponse);
    }
    Ok(())
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

fn display_count(
    object: &serde_json::Map<String, Value>,
    count_key: &str,
    ids_key: &str,
) -> Result<usize, RuntimeClientError> {
    match object.get(count_key) {
        Some(_) => display_usize(object, count_key),
        None => optional_array_field(object, ids_key)
            .map(Vec::len)
            .ok_or(RuntimeClientError::InvalidResponse),
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

fn render_truncation(output: &mut String, label: &str, len: usize, limit: usize) {
    if len > limit {
        output.push_str(&format!("    ... {} more {label}\n", len - limit));
    }
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
        assert_eq!(params["max_advances"], 3);
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
        assert_ne!(
            params["session_id"],
            cli_run_drive_params("summarize this repository").unwrap()["session_id"]
        );
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
        assert_eq!(
            params["continuation_scope"],
            json!({
                "session_id_prefix": "cli.run.",
                "latest_matching_session": true
            })
        );
        assert!(params.get("verification_recovery_source").is_none());
        assert!(params.get("objective_proposal_apply_target").is_none());
    }
}
