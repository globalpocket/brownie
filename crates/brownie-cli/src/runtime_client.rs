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
const PROPOSAL_INSPECT_METHOD: &str = "proposal.inspect";
const HEADLESS_CONTINUE_ONCE_METHOD: &str = "headless.continue_once";
const HEADLESS_RUN_ADVANCE_METHOD: &str = "headless.run.advance";
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
const CLI_TASK_LIST_TRANSPORT_TASK_ROWS: usize = MAX_TASK_LIST_ROWS;
const CLI_TASK_LIST_TRANSPORT_IDS: usize = 50;
const CLI_TASK_LIST_TRANSPORT_GROUP_IDS: usize = 20;
const CLI_RESUME_TRANSPORT_TASK_ROWS: usize = 8;
const CLI_RESUME_TRANSPORT_ROUTE_CANDIDATES: usize = 8;
const MAX_MODE_LIST_ROWS: usize = 12;
const CLI_RUN_MAX_ADVANCES: u8 = 3;
const CLI_RUN_MAX_STEPS_PER_ADVANCE: u8 = 1;
const CLI_RUN_MAX_PARENT_JOIN_ROUTES: u8 = 3;
const CLI_RUN_MAX_OBJECTIVE_CHARS: usize = 4_096;
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
        let result = self.follow_objective_proposal_preflight_route_if_available(result)?;
        let result = self.follow_objective_proposal_apply_route_if_available(result)?;
        let result = self.follow_objective_apply_verification_route_if_available(result)?;
        let result = self.follow_objective_completion_acceptance_route_if_available(result)?;
        let result = self.close_and_finalize_objective_completion_if_available(result)?;
        let result = self.accept_and_finalize_completed_run_if_available(result)?;
        if json_output {
            return json_result("run", "run", cli_run_payload(&result)?);
        }

        bounded_output(render_run_result(&result)?)
    }

    fn runtime_resume(&self, json_output: bool) -> Result<String, RuntimeClientError> {
        let task_list = self.call_runtime_value(
            TASK_LIST_METHOD,
            Some(cli_resume_task_list_params()),
            RuntimeRequestClass::ReadOnly,
        )?;
        validate_task_list_result(&task_list)?;
        let result = if let Some((resume_params, resume_candidate)) =
            cli_resume_advance_params(&task_list)?
        {
            let result = self.call_runtime_value(
                HEADLESS_RUN_ADVANCE_METHOD,
                Some(resume_params),
                RuntimeRequestClass::ObjectiveExecution,
            )?;
            validate_headless_run_advance_result(&result)?;
            self.continue_resumed_headless_journey_if_available(result, &resume_candidate)?
        } else {
            let resume_params = cli_resume_params(&task_list)?;
            let result = self.call_runtime_value(
                HEADLESS_CONTINUE_ONCE_METHOD,
                Some(resume_params),
                RuntimeRequestClass::ObjectiveExecution,
            )?;
            validate_headless_continue_once_result(&result)?;
            result
        };
        if json_output {
            return json_result("resume", "resume", cli_resume_payload(&result)?);
        }

        bounded_output(render_resume_result(&result)?)
    }

    fn continue_resumed_headless_journey_if_available(
        &self,
        advance_result: Value,
        resume_candidate: &CliResumeRouteCandidate,
    ) -> Result<Value, RuntimeClientError> {
        let Some(params) = resumed_cli_drive_params(&advance_result)? else {
            return attach_resume_route_candidate_context(advance_result, resume_candidate);
        };

        let result = self.call_runtime_value(
            HEADLESS_RUN_DRIVE_METHOD,
            Some(params),
            RuntimeRequestClass::ObjectiveExecution,
        )?;
        validate_headless_run_drive_result(&result)?;
        let result = self.follow_parent_join_routes_if_available(result)?;
        let result = self.follow_objective_proposal_preflight_route_if_available(result)?;
        let result = self.follow_objective_proposal_apply_route_if_available(result)?;
        let result = self.follow_objective_apply_verification_route_if_available(result)?;
        let result = self.follow_objective_completion_acceptance_route_if_available(result)?;
        let result = self.close_and_finalize_objective_completion_if_available(result)?;
        let result = self.accept_and_finalize_completed_run_if_available(result)?;
        let result = merge_resume_drive_result(&advance_result, result)?;
        attach_resume_route_candidate_context(result, resume_candidate)
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
        let result = self.call_runtime_value(
            TASK_LIST_METHOD,
            Some(cli_task_list_params()),
            RuntimeRequestClass::ReadOnly,
        )?;
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

    fn follow_objective_proposal_preflight_route_if_available(
        &self,
        result: Value,
    ) -> Result<Value, RuntimeClientError> {
        let Some(params) = objective_proposal_authorization_preflight_params(&result)? else {
            return Ok(result);
        };

        let authorization_result = self.call_runtime_value(
            HEADLESS_CONTINUE_ONCE_METHOD,
            Some(params),
            RuntimeRequestClass::ObjectiveExecution,
        )?;
        validate_headless_continue_once_result(&authorization_result)?;
        validate_objective_proposal_authorization_preflight_result(&authorization_result)?;
        merge_objective_continue_result(result, authorization_result)
    }

    fn follow_objective_proposal_apply_route_if_available(
        &self,
        result: Value,
    ) -> Result<Value, RuntimeClientError> {
        let Some(inspect_params) = objective_proposal_inspect_params(&result)? else {
            return Ok(result);
        };
        let proposal = self.call_runtime_value(
            PROPOSAL_INSPECT_METHOD,
            Some(inspect_params),
            RuntimeRequestClass::ObjectiveExecution,
        )?;
        let Some(params) = objective_proposal_apply_params(&result, &proposal)? else {
            return Ok(result);
        };

        let apply_result = self.call_runtime_value(
            HEADLESS_CONTINUE_ONCE_METHOD,
            Some(params),
            RuntimeRequestClass::ObjectiveExecution,
        )?;
        validate_headless_continue_once_result(&apply_result)?;
        validate_objective_proposal_apply_result(&apply_result)?;
        merge_objective_continue_result(result, apply_result)
    }

    fn follow_objective_apply_verification_route_if_available(
        &self,
        result: Value,
    ) -> Result<Value, RuntimeClientError> {
        let Some(params) = objective_apply_verification_params(&result)? else {
            return Ok(result);
        };

        let verification_result = self.call_runtime_value(
            HEADLESS_CONTINUE_ONCE_METHOD,
            Some(params),
            RuntimeRequestClass::ObjectiveExecution,
        )?;
        validate_headless_continue_once_result(&verification_result)?;
        validate_objective_apply_verification_result(&verification_result)?;
        merge_objective_continue_result(result, verification_result)
    }

    fn follow_objective_completion_acceptance_route_if_available(
        &self,
        result: Value,
    ) -> Result<Value, RuntimeClientError> {
        let Some(params) = objective_completion_acceptance_params(&result)? else {
            return Ok(result);
        };

        let completion_result = self.call_runtime_value(
            HEADLESS_CONTINUE_ONCE_METHOD,
            Some(params),
            RuntimeRequestClass::ObjectiveExecution,
        )?;
        validate_headless_continue_once_result(&completion_result)?;
        validate_objective_completion_acceptance_result(&completion_result)?;
        merge_objective_continue_result(result, completion_result)
    }

    fn close_and_finalize_objective_completion_if_available(
        &self,
        result: Value,
    ) -> Result<Value, RuntimeClientError> {
        let Some(target) = objective_completion_close_target(&result)? else {
            return Ok(result);
        };

        let close_route = self.call_runtime_value(
            HEADLESS_RUN_DRIVE_METHOD,
            Some(accepted_completion_route_params(&target, false, None)),
            RuntimeRequestClass::ObjectiveExecution,
        )?;
        validate_headless_run_drive_result(&close_route)?;
        validate_objective_completion_close_route(&close_route)?;
        let close_route = merge_objective_drive_result(&result, close_route)?;

        let closure = object_field(&close_route, "completion_closure")?;
        let closure_fingerprint = required_display_string(closure, "closure_fingerprint")?;
        validate_sha256_fingerprint(&closure_fingerprint)?;
        let mut finalization_target = target;
        finalization_target.expected_start_session_sequence = required_u64(
            close_route
                .as_object()
                .ok_or(RuntimeClientError::InvalidResponse)?,
            "end_session_sequence",
        )?;
        let finalized_route = self.call_runtime_value(
            HEADLESS_RUN_DRIVE_METHOD,
            Some(accepted_completion_route_params(
                &finalization_target,
                true,
                Some(&closure_fingerprint),
            )),
            RuntimeRequestClass::ObjectiveExecution,
        )?;
        validate_headless_run_drive_result(&finalized_route)?;
        validate_objective_completion_close_route(&finalized_route)?;
        validate_completion_finalization(&finalized_route)?;
        merge_objective_drive_result(&close_route, finalized_route)
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
    if let Some(automation) = result
        .as_object()
        .and_then(|object| object.get("automation"))
        .cloned()
    {
        payload.insert("automation".to_string(), automation);
    }
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
        Value::Number(serde_json::Number::from(display_usize_or(
            progress,
            "runnable_count",
            array_len(progress, "runnable_task_ids")?,
        )?)),
    );
    payload.insert(
        "blocked_count".to_string(),
        Value::Number(serde_json::Number::from(display_usize_or(
            progress,
            "blocked_count",
            array_len(progress, "blocked_task_ids")?,
        )?)),
    );
    payload.insert(
        "terminal_count".to_string(),
        Value::Number(serde_json::Number::from(display_usize_or(
            progress,
            "terminal_count",
            array_len(progress, "terminal_task_ids")?,
        )?)),
    );
    let parent_join_ready_ids =
        optional_array_field_checked(progress, "parent_join_ready_task_ids")?;
    let parent_join_ready_count = display_usize_or(
        progress,
        "parent_join_ready_count",
        parent_join_ready_ids.map(Vec::len).unwrap_or(0),
    )?;
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
            "tasks": display_usize_or(progress, "task_count", tasks.len())? > tasks.len() || tasks.len() > MAX_TASK_LIST_ROWS,
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
    validate_optional_execution_outcome(object)?;
    Ok(())
}

fn validate_headless_run_advance_result(result: &Value) -> Result<(), RuntimeClientError> {
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
        "session_id",
        "advance_id",
        "stop_reason",
        "checkpoint_fingerprint",
        "next_action",
    ] {
        required_display_string(object, key)?;
    }
    validate_sha256_fingerprint(&display_string(object, "checkpoint_fingerprint")?)?;
    required_u64(object, "session_sequence")?;
    required_bool(object, "replayed")?;
    display_usize(object, "step_count")?;
    display_usize(object, "executed_count")?;
    display_usize(object, "replayed_count")?;
    let start_progress = object_field(result, "start_progress")?;
    validate_sha256_fingerprint(&required_display_string(
        start_progress,
        "progress_fingerprint",
    )?)?;
    required_u64(start_progress, "aggregate_sequence")?;
    if let Some(post_progress) = optional_object_field(object, "post_progress") {
        validate_sha256_fingerprint(&required_display_string(
            post_progress,
            "progress_fingerprint",
        )?)?;
        required_u64(post_progress, "aggregate_sequence")?;
    }
    let steps = optional_array_field_checked(object, "steps")?
        .ok_or(RuntimeClientError::InvalidResponse)?;
    if steps.len() != display_usize(object, "step_count")? {
        return Err(RuntimeClientError::InvalidResponse);
    }
    for step in steps {
        validate_headless_continue_step_result(step)?;
    }
    validate_optional_execution_outcome(object)?;
    Ok(())
}

fn validate_headless_continue_step_result(step: &Value) -> Result<(), RuntimeClientError> {
    let object = step
        .as_object()
        .ok_or(RuntimeClientError::InvalidResponse)?;
    let status = required_display_string(object, "status")?;
    if !matches!(
        status.as_str(),
        "stale_progress" | "no_eligible_task" | "task_in_progress" | "task_executed"
    ) {
        return Err(RuntimeClientError::InvalidResponse);
    }
    for key in ["current_progress_fingerprint", "next_action"] {
        required_display_string(object, key)?;
    }
    validate_sha256_fingerprint(&display_string(object, "current_progress_fingerprint")?)?;
    required_u64(object, "current_aggregate_sequence")?;
    optional_bounded_string(object, "decision_id")?;
    optional_bounded_string(object, "continuation_id")?;
    optional_bounded_string(object, "selected_task_id")?;
    optional_bounded_string(object, "selected_run_id")?;
    optional_bounded_string(object, "post_progress_fingerprint")?;
    optional_u64(object, "post_aggregate_sequence")?;
    display_usize(object, "candidate_count")?;
    required_bool(object, "replayed")?;
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
    if let Some(context) = optional_object_field(object, "selected_headless_journey_context") {
        validate_selected_headless_journey_context(context)?;
    }
    validate_optional_execution_outcome(object)?;
    Ok(())
}

fn validate_selected_headless_journey_context(
    context: &serde_json::Map<String, Value>,
) -> Result<(), RuntimeClientError> {
    if display_string(context, "kind")? != "headless_journey_context"
        || display_string(context, "selection_source")? != "continuation_scope"
        || display_string(context, "next_action")? != "drive_headless_journey"
        || context.contains_key("raw_prompt")
        || context.contains_key("provider_response")
        || context.contains_key("absolute_path")
    {
        return Err(RuntimeClientError::InvalidResponse);
    }
    for key in [
        "journey_id",
        "session_id",
        "drive_id",
        "task_id",
        "run_id",
        "selected_task_id",
        "selected_run_id",
    ] {
        required_display_string(context, key)?;
    }
    for key in [
        "task_start_fingerprint",
        "start_progress_fingerprint",
        "journey_fingerprint",
    ] {
        validate_sha256_fingerprint(&required_display_string(context, key)?)?;
    }
    required_u64(context, "start_aggregate_sequence")?;
    required_bool(context, "has_session_checkpoint")?;
    optional_u64(context, "current_session_sequence")?;
    Ok(())
}

fn validate_optional_execution_outcome(
    object: &serde_json::Map<String, Value>,
) -> Result<(), RuntimeClientError> {
    if let Some(outcome) = optional_object_field_checked(object, "execution_outcome")? {
        validate_execution_outcome(outcome)?;
    }
    Ok(())
}

fn validate_execution_outcome(
    outcome: &serde_json::Map<String, Value>,
) -> Result<(), RuntimeClientError> {
    if outcome.get("schema_version").and_then(Value::as_u64) != Some(1) {
        return Err(RuntimeClientError::InvalidResponse);
    }
    let outcome_scope = required_display_string(outcome, "outcome_scope")?;
    if !matches!(outcome_scope.as_str(), "objective" | "process") {
        return Err(RuntimeClientError::InvalidResponse);
    }
    let class_name = required_display_string(outcome, "class")?;
    if !is_valid_execution_outcome_class(&class_name) {
        return Err(RuntimeClientError::InvalidResponse);
    }
    let status = required_display_string(outcome, "status")?;
    if status != class_name {
        return Err(RuntimeClientError::InvalidResponse);
    }
    let controller_action = required_display_string(outcome, "controller_action")?;
    if !is_valid_controller_action(&controller_action) {
        return Err(RuntimeClientError::InvalidResponse);
    }
    for key in [
        "continuation_required",
        "completed",
        "blocked",
        "retryable",
        "terminal_failure",
    ] {
        required_bool(outcome, key)?;
    }
    required_display_string(outcome, "stop_reason")?;
    validate_next_invocation(outcome.get("next_invocation"), &controller_action)?;
    Ok(())
}

fn validate_next_invocation(
    next_invocation: Option<&Value>,
    controller_action: &str,
) -> Result<(), RuntimeClientError> {
    let Some(next_invocation) = next_invocation.filter(|value| !value.is_null()) else {
        return if controller_action == "resume" {
            Err(RuntimeClientError::InvalidResponse)
        } else {
            Ok(())
        };
    };
    let object = next_invocation
        .as_object()
        .ok_or(RuntimeClientError::InvalidResponse)?;
    let command = required_display_string(object, "command")?;
    if command != "resume" {
        return Err(RuntimeClientError::InvalidResponse);
    }
    let arguments = object
        .get("arguments")
        .and_then(Value::as_array)
        .ok_or(RuntimeClientError::InvalidResponse)?;
    if !arguments.is_empty() {
        return Err(RuntimeClientError::InvalidResponse);
    }
    if controller_action != "resume" && controller_action != "retry" {
        return Err(RuntimeClientError::InvalidResponse);
    }
    Ok(())
}

fn is_valid_execution_outcome_class(value: &str) -> bool {
    matches!(
        value,
        "continuation_required"
            | "completed"
            | "blocked"
            | "stale_retry"
            | "no_actionable_work"
            | "waiting"
            | "retryable_failure"
            | "terminal_failure"
    )
}

fn is_valid_controller_action(value: &str) -> bool {
    matches!(
        value,
        "resume" | "stop" | "wait" | "retry" | "return_to_supervisor"
    )
}

fn bounded_json_execution_outcome(value: &Value) -> Result<Value, RuntimeClientError> {
    let outcome = value
        .as_object()
        .ok_or(RuntimeClientError::InvalidResponse)?;
    validate_execution_outcome(outcome)?;
    let mut projected = serde_json::Map::new();
    projected.insert(
        "schema_version".to_string(),
        Value::Number(serde_json::Number::from(1_u8)),
    );
    for key in [
        "outcome_scope",
        "class",
        "status",
        "controller_action",
        "stop_reason",
    ] {
        projected.insert(
            key.to_string(),
            bounded_json_string(
                outcome
                    .get(key)
                    .ok_or(RuntimeClientError::InvalidResponse)?,
            )?,
        );
    }
    for key in [
        "continuation_required",
        "completed",
        "blocked",
        "retryable",
        "terminal_failure",
    ] {
        projected.insert(key.to_string(), Value::Bool(required_bool(outcome, key)?));
    }
    if let Some(next_invocation) = outcome.get("next_invocation") {
        projected.insert(
            "next_invocation".to_string(),
            bounded_json_next_invocation(next_invocation)?,
        );
    }
    Ok(Value::Object(projected))
}

fn bounded_json_next_invocation(value: &Value) -> Result<Value, RuntimeClientError> {
    if value.is_null() {
        return Ok(Value::Null);
    }
    let object = value
        .as_object()
        .ok_or(RuntimeClientError::InvalidResponse)?;
    Ok(json!({
        "command": bounded_json_string(
            object
                .get("command")
                .ok_or(RuntimeClientError::InvalidResponse)?
        )?,
        "arguments": []
    }))
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
    if let Some(preflight) = object
        .get("objective_proposal_authorization_preflight_result")
        .and_then(Value::as_object)
    {
        for key in ["status", "operation", "next_action"] {
            if let Some(value) = preflight.get(key) {
                payload.insert(
                    format!("objective_proposal_preflight_{key}"),
                    bounded_json_string(value)?,
                );
            }
        }
    }
    if let Some(apply) = object
        .get("proposal_apply_result")
        .and_then(Value::as_object)
        .and_then(|result| result.get("apply_result"))
        .and_then(Value::as_object)
    {
        for key in ["operation", "apply_status", "next_action"] {
            if let Some(value) = apply.get(key) {
                payload.insert(
                    format!("objective_apply_{key}"),
                    bounded_json_string(value)?,
                );
            }
        }
        if let Some(value) = apply.get("applied") {
            payload.insert(
                "objective_apply_applied".to_string(),
                Value::Bool(json_bool(value)?),
            );
        }
        if let Some(value) = apply.get("authorization_consumed") {
            payload.insert(
                "objective_apply_authorization_consumed".to_string(),
                Value::Bool(json_bool(value)?),
            );
        }
    }
    if let Some(verification) = object
        .get("objective_apply_verification_result")
        .and_then(Value::as_object)
    {
        for key in ["verification_status", "operation", "next_action"] {
            if let Some(value) = verification.get(key) {
                payload.insert(
                    format!("objective_apply_verification_{key}"),
                    bounded_json_string(value)?,
                );
            }
        }
    }
    if let Some(completion) = object
        .get("objective_completion_acceptance_result")
        .and_then(Value::as_object)
    {
        for key in ["acceptance_status", "operation", "next_action"] {
            if let Some(value) = completion.get(key) {
                payload.insert(
                    format!("objective_completion_acceptance_{key}"),
                    bounded_json_string(value)?,
                );
            }
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
    if let Some(outcome) = object.get("execution_outcome") {
        payload.insert(
            "execution_outcome".to_string(),
            bounded_json_execution_outcome(outcome)?,
        );
    }
    add_external_loop_contract(&mut payload)?;
    Ok(Value::Object(payload))
}

fn render_resume_result(result: &Value) -> Result<String, RuntimeClientError> {
    let object = result
        .as_object()
        .ok_or(RuntimeClientError::InvalidResponse)?;
    let status = display_string(object, "status")?;
    let step = resume_result_first_step(object);
    let continuation_id = display_optional_resume_string(object, step, "continuation_id")?;
    let task_id = display_optional_resume_string(object, step, "selected_task_id")?;
    let run_id = display_optional_resume_string(object, step, "selected_run_id")?;
    let candidate_count = display_resume_usize(object, step, "candidate_count")?;
    let stale = display_resume_stale(object)?;
    let replayed = display_bool(object, "replayed")?;
    let next_action = display_string(object, "next_action")?;
    let journey_context = optional_object_field(object, "selected_headless_journey_context");
    let session_id =
        display_string_from_optional(journey_context, "session_id").and_then(|value| {
            if value == "unknown" {
                display_string(object, "session_id")
            } else {
                Ok(value)
            }
        })?;
    let journey_id = display_string_from_optional(journey_context, "journey_id")?;

    Ok(format!(
        "resume\n  status: {status}\n  continuation: {continuation_id}\n  session: {session_id}\n  journey: {journey_id}\n  task: {task_id}\n  runtime_run: {run_id}\n  candidates: {candidate_count}\n  stale: {stale}\n  replayed: {replayed}\n  next: {next_action}\n"
    ))
}

fn cli_resume_payload(result: &Value) -> Result<Value, RuntimeClientError> {
    let object = result
        .as_object()
        .ok_or(RuntimeClientError::InvalidResponse)?;
    let mut payload = if object.contains_key("drive_id") {
        match cli_run_payload(result)? {
            Value::Object(payload) => payload,
            _ => return Err(RuntimeClientError::InvalidResponse),
        }
    } else {
        serde_json::Map::new()
    };
    let step = resume_result_first_step(object);
    for key in [
        "status",
        "decision_id",
        "continuation_id",
        "selected_task_id",
        "selected_run_id",
        "next_action",
    ] {
        if let Some(value) = resume_result_field(object, step, key) {
            payload.insert(key.to_string(), bounded_json_optional_string(value)?);
        }
    }
    for key in [
        "candidate_count",
        "current_aggregate_sequence",
        "post_aggregate_sequence",
    ] {
        if let Some(value) = resume_result_field(object, step, key) {
            payload.insert(key.to_string(), bounded_json_optional_u64(value)?);
        }
    }
    payload.insert(
        "stale".to_string(),
        Value::Bool(display_resume_stale(object)?),
    );
    if let Some(value) = object.get("replayed") {
        payload.insert("replayed".to_string(), Value::Bool(json_bool(value)?));
    }
    if let Some(context) = optional_object_field(object, "selected_headless_journey_context") {
        for (source, target) in [
            ("journey_id", "headless_journey_id"),
            ("session_id", "headless_session_id"),
            ("task_id", "headless_root_task_id"),
            ("run_id", "headless_root_run_id"),
            ("selected_task_id", "headless_selected_task_id"),
            ("selected_run_id", "headless_selected_run_id"),
            ("journey_fingerprint", "headless_journey_fingerprint"),
        ] {
            if let Some(value) = context.get(source) {
                payload.insert(target.to_string(), bounded_json_string(value)?);
            }
        }
        if let Some(value) = context.get("current_session_sequence") {
            payload.insert(
                "headless_current_session_sequence".to_string(),
                bounded_json_optional_u64(value)?,
            );
        }
    }
    if !payload.contains_key("headless_session_id") {
        if let Some(value) = object.get("session_id") {
            payload.insert(
                "headless_session_id".to_string(),
                bounded_json_string(value)?,
            );
        }
    }
    if let Some(outcome) = object.get("execution_outcome") {
        payload.insert(
            "execution_outcome".to_string(),
            bounded_json_execution_outcome(outcome)?,
        );
    }
    add_external_loop_contract(&mut payload)?;
    Ok(Value::Object(payload))
}

fn add_external_loop_contract(
    payload: &mut serde_json::Map<String, Value>,
) -> Result<(), RuntimeClientError> {
    promote_payload_alias(
        payload,
        "task_id",
        &[
            "selected_task_id",
            "headless_selected_task_id",
            "headless_root_task_id",
            "accepted_completion_task_id",
        ],
    );
    promote_payload_alias(
        payload,
        "run_id",
        &[
            "selected_run_id",
            "headless_selected_run_id",
            "headless_root_run_id",
            "accepted_completion_run_id",
        ],
    );
    promote_payload_alias(payload, "journey_id", &["headless_journey_id"]);
    ensure_payload_key(payload, "task_id");
    ensure_payload_key(payload, "run_id");
    ensure_payload_key(payload, "journey_id");

    let outcome = if let Some(outcome) = payload.get("execution_outcome") {
        automation_outcome_from_execution_outcome(outcome)?
    } else {
        automation_outcome_from_legacy_payload(payload)?
    };
    payload.insert(
        "continuation_required".to_string(),
        Value::Bool(outcome.continuation_required),
    );
    payload.insert("completed".to_string(), Value::Bool(outcome.completed));
    payload.insert("blocked".to_string(), Value::Bool(outcome.blocked));
    payload.insert("retryable".to_string(), Value::Bool(outcome.retryable));
    payload.insert(
        "terminal_failure".to_string(),
        Value::Bool(outcome.terminal_failure),
    );
    payload.insert(
        "controller_action".to_string(),
        Value::String(outcome.controller_action.clone()),
    );
    payload.insert(
        "stop_reason".to_string(),
        Value::String(outcome.stop_reason.clone()),
    );
    payload.insert(
        "stop_class".to_string(),
        Value::String(outcome.class_name.clone()),
    );
    if let Some(next_invocation) = outcome.next_invocation.clone() {
        payload.insert("next_invocation".to_string(), next_invocation);
    }
    payload.insert(
        "automation".to_string(),
        json!({
            "schema_version": 1,
            "outcome_scope": outcome.outcome_scope.clone(),
            "status": outcome.status.clone(),
            "class": outcome.class_name.clone(),
            "outcome_source": outcome.outcome_source.clone(),
            "task_id": payload.get("task_id").cloned().unwrap_or(Value::Null),
            "run_id": payload.get("run_id").cloned().unwrap_or(Value::Null),
            "journey_id": payload.get("journey_id").cloned().unwrap_or(Value::Null),
            "next_action": payload.get("next_action").cloned().unwrap_or(Value::Null),
            "stop_reason": outcome.stop_reason.clone(),
            "continuation_required": outcome.continuation_required,
            "completed": outcome.completed,
            "blocked": outcome.blocked,
            "retryable": outcome.retryable,
            "terminal_failure": outcome.terminal_failure,
            "controller_action": outcome.controller_action.clone(),
            "stop_class": outcome.class_name.clone(),
            "next_invocation": outcome.next_invocation.clone().unwrap_or(Value::Null)
        }),
    );
    payload.remove("execution_outcome");
    Ok(())
}

struct AutomationOutcome {
    outcome_scope: String,
    status: String,
    class_name: String,
    controller_action: String,
    continuation_required: bool,
    completed: bool,
    blocked: bool,
    retryable: bool,
    terminal_failure: bool,
    stop_reason: String,
    next_invocation: Option<Value>,
    outcome_source: String,
}

fn automation_outcome_from_execution_outcome(
    value: &Value,
) -> Result<AutomationOutcome, RuntimeClientError> {
    let outcome = value
        .as_object()
        .ok_or(RuntimeClientError::InvalidResponse)?;
    validate_execution_outcome(outcome)?;
    let class_name = required_display_string(outcome, "class")?;
    let status = outcome
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or(class_name.as_str())
        .to_string();
    Ok(AutomationOutcome {
        outcome_scope: required_display_string(outcome, "outcome_scope")?,
        status,
        class_name,
        controller_action: required_display_string(outcome, "controller_action")?,
        continuation_required: required_bool(outcome, "continuation_required")?,
        completed: required_bool(outcome, "completed")?,
        blocked: required_bool(outcome, "blocked")?,
        retryable: required_bool(outcome, "retryable")?,
        terminal_failure: required_bool(outcome, "terminal_failure")?,
        stop_reason: required_display_string(outcome, "stop_reason")?,
        next_invocation: outcome
            .get("next_invocation")
            .filter(|value| !value.is_null())
            .cloned(),
        outcome_source: "runtime".to_string(),
    })
}

fn automation_outcome_from_legacy_payload(
    payload: &serde_json::Map<String, Value>,
) -> Result<AutomationOutcome, RuntimeClientError> {
    let status = payload_string(payload, "status").ok_or(RuntimeClientError::InvalidResponse)?;
    let completed = payload_string(payload, "completion_finalization_status").as_deref()
        == Some("finalized")
        || (payload_string(payload, "completion_closure_status").as_deref() == Some("complete")
            && payload_string(payload, "accepted_completion_status").as_deref()
                == Some("AcceptedComplete"));
    let (class_name, controller_action, continuation_required, retryable, stop_reason) =
        if completed {
            (
                "completed",
                "stop",
                false,
                false,
                payload_string(payload, "stop_reason").unwrap_or_else(|| "complete".to_string()),
            )
        } else {
            match status.as_str() {
                "stale_progress" => (
                    "stale_retry",
                    "resume",
                    true,
                    true,
                    payload_string(payload, "stop_reason")
                        .unwrap_or_else(|| "stale_progress".to_string()),
                ),
                "no_eligible_task" => (
                    "no_actionable_work",
                    "stop",
                    false,
                    false,
                    payload_string(payload, "stop_reason")
                        .unwrap_or_else(|| "no_actionable_work".to_string()),
                ),
                "task_in_progress" => (
                    "waiting",
                    "wait",
                    false,
                    true,
                    payload_string(payload, "stop_reason")
                        .unwrap_or_else(|| "task_in_progress".to_string()),
                ),
                "task_executed" => (
                    "continuation_required",
                    "resume",
                    true,
                    true,
                    payload_string(payload, "stop_reason")
                        .unwrap_or_else(|| "bounded_progress".to_string()),
                ),
                _ => return Err(RuntimeClientError::InvalidResponse),
            }
        };
    Ok(AutomationOutcome {
        outcome_scope: "objective".to_string(),
        status: class_name.to_string(),
        class_name: class_name.to_string(),
        controller_action: controller_action.to_string(),
        continuation_required,
        completed,
        blocked: false,
        retryable,
        terminal_failure: false,
        stop_reason,
        next_invocation: next_invocation_for_controller_action(controller_action),
        outcome_source: "legacy_cli_projection".to_string(),
    })
}

fn next_invocation_for_controller_action(controller_action: &str) -> Option<Value> {
    (controller_action == "resume").then(|| {
        json!({
            "command": "resume",
            "arguments": []
        })
    })
}

fn promote_payload_alias(
    payload: &mut serde_json::Map<String, Value>,
    target: &str,
    sources: &[&str],
) {
    if payload
        .get(target)
        .map(|value| !value.is_null())
        .unwrap_or(false)
    {
        return;
    }
    if let Some(value) = sources.iter().find_map(|source| {
        payload
            .get(*source)
            .filter(|value| !value.is_null())
            .cloned()
    }) {
        payload.insert(target.to_string(), value);
    }
}

fn ensure_payload_key(payload: &mut serde_json::Map<String, Value>, key: &str) {
    payload.entry(key.to_string()).or_insert(Value::Null);
}

fn payload_string(payload: &serde_json::Map<String, Value>, key: &str) -> Option<String> {
    payload
        .get(key)
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn resume_result_first_step(
    object: &serde_json::Map<String, Value>,
) -> Option<&serde_json::Map<String, Value>> {
    object
        .get("steps")
        .and_then(Value::as_array)
        .and_then(|steps| steps.first())
        .and_then(Value::as_object)
}

fn resume_result_field<'a>(
    object: &'a serde_json::Map<String, Value>,
    step: Option<&'a serde_json::Map<String, Value>>,
    key: &str,
) -> Option<&'a Value> {
    object
        .get(key)
        .or_else(|| step.and_then(|step| step.get(key)))
}

fn display_optional_resume_string(
    object: &serde_json::Map<String, Value>,
    step: Option<&serde_json::Map<String, Value>>,
    key: &str,
) -> Result<String, RuntimeClientError> {
    match resume_result_field(object, step, key) {
        Some(Value::Null) | None => Ok("none".to_string()),
        Some(value) => bounded_string(value),
    }
}

fn display_resume_usize(
    object: &serde_json::Map<String, Value>,
    step: Option<&serde_json::Map<String, Value>>,
    key: &str,
) -> Result<usize, RuntimeClientError> {
    match resume_result_field(object, step, key) {
        Some(value) => value
            .as_u64()
            .and_then(|value| usize::try_from(value).ok())
            .ok_or(RuntimeClientError::InvalidResponse),
        None => Ok(0),
    }
}

fn display_resume_stale(
    object: &serde_json::Map<String, Value>,
) -> Result<bool, RuntimeClientError> {
    if object.contains_key("stale") {
        return display_bool(object, "stale");
    }
    Ok(display_string(object, "status")? == "stale_progress")
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CliResumeRouteCandidate {
    session_id: String,
    journey_id: String,
    task_id: String,
    run_id: String,
    next_session_sequence: u64,
    progress_fingerprint: String,
    aggregate_sequence: u64,
}

fn cli_task_list_params() -> Value {
    json!({
        "bounds": {
            "max_tasks": CLI_TASK_LIST_TRANSPORT_TASK_ROWS,
            "max_task_goal_chars": 0,
            "max_task_ids": CLI_TASK_LIST_TRANSPORT_IDS,
            "max_groups": MAX_TASK_LIST_GROUP_ROWS,
            "max_group_task_ids": CLI_TASK_LIST_TRANSPORT_GROUP_IDS,
            "max_headless_route_candidates": MAX_HEADLESS_ROUTE_ROWS,
            "max_nodes": 0,
            "max_edges": 0
        }
    })
}

fn cli_resume_task_list_params() -> Value {
    json!({
        "bounds": {
            "max_tasks": CLI_RESUME_TRANSPORT_TASK_ROWS,
            "max_task_goal_chars": 0,
            "max_task_ids": 0,
            "max_groups": 0,
            "max_group_task_ids": 0,
            "max_headless_route_candidates": CLI_RESUME_TRANSPORT_ROUTE_CANDIDATES,
            "max_nodes": 0,
            "max_edges": 0
        }
    })
}

fn cli_resume_advance_params(
    task_list: &Value,
) -> Result<Option<(Value, CliResumeRouteCandidate)>, RuntimeClientError> {
    let Some(candidate) = cli_resume_selected_route_candidate(task_list)? else {
        return Ok(None);
    };
    let advance_id = stable_cli_resume_id(
        &candidate.progress_fingerprint,
        candidate.aggregate_sequence,
    );
    let params = json!({
        "authorize": true,
        "session_id": candidate.session_id.clone(),
        "advance_id": advance_id,
        "expected_session_sequence": candidate.next_session_sequence,
        "expected_progress_fingerprint": candidate.progress_fingerprint.clone(),
        "expected_aggregate_sequence": candidate.aggregate_sequence,
        "max_steps": CLI_RESUME_MAX_STEPS,
        "continuation_scope": {
            "session_id": candidate.session_id.clone(),
            "journey_id": candidate.journey_id.clone(),
            "task_id": candidate.task_id.clone(),
            "run_id": candidate.run_id.clone()
        }
    });
    Ok(Some((params, candidate)))
}

fn resumed_cli_drive_params(advance_result: &Value) -> Result<Option<Value>, RuntimeClientError> {
    let object = advance_result
        .as_object()
        .ok_or(RuntimeClientError::InvalidResponse)?;
    if display_string(object, "status")? != "task_executed" {
        return Ok(None);
    }
    let session_id = required_display_string(object, "session_id")?;
    let session_sequence = required_u64(object, "session_sequence")?;

    Ok(Some(json!({
        "authorize": true,
        "session_id": session_id,
        "drive_id": format!("{session_id}.resume.drive"),
        "expected_start_session_sequence": session_sequence,
        "max_advances": CLI_RUN_MAX_ADVANCES,
        "max_steps_per_advance": CLI_RUN_MAX_STEPS_PER_ADVANCE
    })))
}

fn cli_resume_selected_route_candidate(
    task_list: &Value,
) -> Result<Option<CliResumeRouteCandidate>, RuntimeClientError> {
    task_list
        .as_object()
        .ok_or(RuntimeClientError::InvalidResponse)?
        .get("tasks")
        .and_then(Value::as_array)
        .ok_or(RuntimeClientError::InvalidResponse)?;
    let progress = object_field(task_list, "progress_overview")?;
    let progress_fingerprint = required_display_string(progress, "source_fingerprint")?;
    validate_sha256_fingerprint(&progress_fingerprint)?;
    let aggregate_sequence = required_u64(progress, "aggregate_sequence")?;
    let Some(candidate) = progress.get("selected_headless_route") else {
        return Ok(None);
    };
    if candidate.is_null() {
        return Ok(None);
    }
    let candidate = candidate
        .as_object()
        .ok_or(RuntimeClientError::InvalidResponse)?;
    let Some(session_id) = candidate.get("session_id").and_then(Value::as_str) else {
        return Ok(None);
    };
    if !session_id.starts_with(CLI_RUN_SESSION_PREFIX) {
        return Ok(None);
    }
    let journey_id = required_display_string(candidate, "journey_id")?;
    let task_id = required_display_string(candidate, "task_id")?;
    let run_id = required_display_string(candidate, "run_id")?;
    let journey_fingerprint = required_display_string(candidate, "journey_fingerprint")?;
    validate_sha256_fingerprint(&journey_fingerprint)?;
    let next_session_sequence = required_u64(candidate, "next_session_sequence")?;
    if next_session_sequence == 0
        || required_display_string(candidate, "progress_fingerprint")? != progress_fingerprint
        || required_u64(candidate, "aggregate_sequence")? != aggregate_sequence
    {
        return Err(RuntimeClientError::InvalidResponse);
    }
    Ok(Some(CliResumeRouteCandidate {
        session_id: session_id.to_string(),
        journey_id,
        task_id,
        run_id,
        next_session_sequence,
        progress_fingerprint,
        aggregate_sequence,
    }))
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

fn objective_proposal_authorization_preflight_params(
    result: &Value,
) -> Result<Option<Value>, RuntimeClientError> {
    let object = result
        .as_object()
        .ok_or(RuntimeClientError::InvalidResponse)?;
    let Some(route) = optional_object_field(object, "next_route") else {
        return Ok(None);
    };
    if display_string(route, "kind")? != "review_and_authorize_objective_proposal" {
        return Ok(None);
    }

    let candidate = object_field(result, "objective_proposal_candidate")?;
    if display_string(candidate, "status")? != "ready_for_review"
        || display_string(candidate, "operation")? != "replace_file"
        || display_string(candidate, "validation_status")? != "Valid"
        || display_string(candidate, "approval_status")? != "Pending"
        || display_string(candidate, "next_action")? != "review_and_authorize_objective_proposal"
    {
        return Err(RuntimeClientError::InvalidResponse);
    }
    if display_usize(candidate, "candidate_count")? != 1 {
        return Err(RuntimeClientError::InvalidResponse);
    }

    let journey = object_field(result, "journey")?;
    let progress = object_field(result, "post_progress")?;
    let candidate_fingerprint = required_display_string(candidate, "candidate_fingerprint")?;
    validate_sha256_fingerprint(&candidate_fingerprint)?;
    let objective_context_fingerprint =
        required_display_string(candidate, "objective_context_fingerprint")?;
    validate_sha256_fingerprint(&objective_context_fingerprint)?;
    let selected_context_fingerprint =
        required_display_string(candidate, "selected_context_fingerprint")?;
    validate_sha256_fingerprint(&selected_context_fingerprint)?;
    let path_fingerprint = required_display_string(candidate, "path_fingerprint")?;
    validate_sha256_fingerprint(&path_fingerprint)?;

    let progress_fingerprint = required_display_string(progress, "progress_fingerprint")?;
    validate_sha256_fingerprint(&progress_fingerprint)?;
    let aggregate_sequence = required_u64(progress, "aggregate_sequence")?;
    let session_id = required_display_string(candidate, "session_id")?;
    let continuation_id =
        stable_cli_objective_route_id("objective.auth", &session_id, &candidate_fingerprint);
    let authorization_token_fingerprint =
        stable_cli_objective_authorization_token_fingerprint(&candidate_fingerprint);

    Ok(Some(json!({
        "authorize": true,
        "continuation_id": continuation_id,
        "expected_progress_fingerprint": progress_fingerprint,
        "expected_aggregate_sequence": aggregate_sequence,
        "objective_proposal_authorization_preflight_target": {
            "authorize_objective_proposal_preflight": true,
            "journey_id": required_display_string(candidate, "journey_id")?,
            "session_id": session_id,
            "source_drive_id": required_display_string(candidate, "drive_id")?,
            "expected_journey_fingerprint": required_display_string(journey, "journey_fingerprint")?,
            "expected_candidate_fingerprint": candidate_fingerprint,
            "expected_objective_context_fingerprint": objective_context_fingerprint,
            "expected_selected_context_fingerprint": selected_context_fingerprint,
            "expected_task_id": required_display_string(candidate, "task_id")?,
            "expected_run_id": required_display_string(candidate, "run_id")?,
            "expected_proposal_id": required_display_string(candidate, "proposal_id")?,
            "expected_source_event_id": required_display_string(candidate, "source_event_id")?,
            "expected_source_event_kind": required_display_string(candidate, "source_event_kind")?,
            "expected_operation": required_display_string(candidate, "operation")?,
            "expected_path_fingerprint": path_fingerprint,
            "expected_validation_status": required_display_string(candidate, "validation_status")?,
            "expected_approval_status": required_display_string(candidate, "approval_status")?,
            "authorization_token_fingerprint": authorization_token_fingerprint,
        }
    })))
}

fn validate_objective_proposal_authorization_preflight_result(
    result: &Value,
) -> Result<(), RuntimeClientError> {
    let object = result
        .as_object()
        .ok_or(RuntimeClientError::InvalidResponse)?;
    let authorization = object_field(result, "objective_proposal_authorization_preflight_result")?;
    if display_string(authorization, "status")? != "authorized_preflight_ready"
        || display_string(authorization, "operation")? != "replace_file"
        || display_string(authorization, "validation_status")? != "Valid"
        || display_string(authorization, "approval_status")? != "Approved"
        || display_string(authorization, "next_action")? != "apply_authorized_objective_proposal"
        || object
            .get("proposal_apply_result")
            .is_some_and(|value| !value.is_null())
        || authorization.contains_key("content")
        || authorization.contains_key("diff")
    {
        return Err(RuntimeClientError::InvalidResponse);
    }
    for key in [
        "candidate_fingerprint",
        "authorization_token_fingerprint",
        "authorization_preflight_fingerprint",
        "path_fingerprint",
        "objective_context_fingerprint",
        "selected_context_fingerprint",
    ] {
        validate_sha256_fingerprint(&required_display_string(authorization, key)?)?;
    }
    for key in [
        "journey_id",
        "task_id",
        "run_id",
        "session_id",
        "source_drive_id",
        "proposal_id",
        "source_event_id",
        "source_event_kind",
    ] {
        required_display_string(authorization, key)?;
    }
    let route = object_field(result, "next_route")?;
    if display_string(route, "kind")? != "apply_authorized_objective_proposal_explicitly"
        || display_string(route, "next_action")? != "apply_authorized_objective_proposal"
    {
        return Err(RuntimeClientError::InvalidResponse);
    }
    Ok(())
}

fn objective_proposal_inspect_params(result: &Value) -> Result<Option<Value>, RuntimeClientError> {
    let object = result
        .as_object()
        .ok_or(RuntimeClientError::InvalidResponse)?;
    let Some(route) = optional_object_field(object, "next_route") else {
        return Ok(None);
    };
    if display_string(route, "kind")? != "apply_authorized_objective_proposal_explicitly" {
        return Ok(None);
    }
    let authorization = object_field(result, "objective_proposal_authorization_preflight_result")?;
    Ok(Some(json!({
        "run_id": required_display_string(authorization, "run_id")?,
        "proposal_id": required_display_string(authorization, "proposal_id")?,
    })))
}

fn objective_proposal_apply_params(
    result: &Value,
    proposal_inspect: &Value,
) -> Result<Option<Value>, RuntimeClientError> {
    let object = result
        .as_object()
        .ok_or(RuntimeClientError::InvalidResponse)?;
    let Some(route) = optional_object_field(object, "next_route") else {
        return Ok(None);
    };
    if display_string(route, "kind")? != "apply_authorized_objective_proposal_explicitly" {
        return Ok(None);
    }
    let authorization = object_field(result, "objective_proposal_authorization_preflight_result")?;
    let proposal = object_field(proposal_inspect, "proposal")?;
    let snapshot = object_field_from_value(authorization, "preflight_snapshot")?;
    let apply_plan = object_field_from_value(authorization, "apply_plan")?;

    let proposal_id = required_display_string(authorization, "proposal_id")?;
    if required_display_string(proposal, "proposal_id")? != proposal_id
        || display_string(proposal, "operation")? != "replace_file"
        || display_string(proposal, "validation_status")? != "Valid"
        || display_string(proposal, "approval_status")? != "Approved"
        || json_bool(
            proposal
                .get("truncated")
                .ok_or(RuntimeClientError::InvalidResponse)?,
        )?
        || json_bool(
            proposal
                .get("diff_redacted")
                .ok_or(RuntimeClientError::InvalidResponse)?,
        )?
    {
        return Err(RuntimeClientError::InvalidResponse);
    }
    let replacement_content = required_display_string(proposal, "content_preview")?;
    if display_usize(proposal, "content_chars")? != replacement_content.chars().count() {
        return Err(RuntimeClientError::InvalidResponse);
    }
    let expected_target_sha256 = required_display_string(snapshot, "file_sha256")?;
    validate_sha256_fingerprint(&expected_target_sha256)?;
    let authorization_preflight_fingerprint =
        required_display_string(authorization, "authorization_preflight_fingerprint")?;
    validate_sha256_fingerprint(&authorization_preflight_fingerprint)?;
    let progress_fingerprint =
        required_display_string(object, "objective_continue_post_progress_fingerprint")?;
    validate_sha256_fingerprint(&progress_fingerprint)?;
    let aggregate_sequence = required_u64(object, "objective_continue_post_aggregate_sequence")?;
    let apply_plan_id = required_display_string(apply_plan, "plan_id")?;
    if display_string(apply_plan, "status")? != "Ready" {
        return Err(RuntimeClientError::InvalidResponse);
    }
    let continuation_id = stable_cli_objective_route_id(
        "objective.apply",
        &required_display_string(authorization, "session_id")?,
        &authorization_preflight_fingerprint,
    );

    Ok(Some(json!({
        "authorize": true,
        "continuation_id": continuation_id,
        "expected_progress_fingerprint": progress_fingerprint,
        "expected_aggregate_sequence": aggregate_sequence,
        "objective_proposal_apply_target": {
            "authorize_objective_proposal_apply": true,
            "authorization_preflight_continuation_id": required_display_string(object, "objective_continue_continuation_id")?,
            "expected_authorization_preflight_decision_id": required_display_string(object, "objective_continue_decision_id")?,
            "journey_id": required_display_string(authorization, "journey_id")?,
            "session_id": required_display_string(authorization, "session_id")?,
            "source_drive_id": required_display_string(authorization, "source_drive_id")?,
            "expected_journey_fingerprint": required_display_string(object_field(result, "journey")?, "journey_fingerprint")?,
            "expected_candidate_fingerprint": required_display_string(authorization, "candidate_fingerprint")?,
            "expected_objective_context_fingerprint": required_display_string(authorization, "objective_context_fingerprint")?,
            "expected_selected_context_fingerprint": required_display_string(authorization, "selected_context_fingerprint")?,
            "expected_task_id": required_display_string(authorization, "task_id")?,
            "expected_run_id": required_display_string(authorization, "run_id")?,
            "expected_proposal_id": proposal_id,
            "expected_source_event_id": required_display_string(authorization, "source_event_id")?,
            "expected_source_event_kind": required_display_string(authorization, "source_event_kind")?,
            "expected_operation": required_display_string(authorization, "operation")?,
            "expected_path_fingerprint": required_display_string(authorization, "path_fingerprint")?,
            "expected_validation_status": required_display_string(authorization, "validation_status")?,
            "expected_approval_status": required_display_string(authorization, "approval_status")?,
            "expected_authorization_preflight_fingerprint": authorization_preflight_fingerprint,
            "expected_preflight_snapshot_id": required_display_string(snapshot, "snapshot_id")?,
            "expected_apply_plan_id": apply_plan_id,
            "expected_target_sha256": expected_target_sha256,
            "replacement_content": replacement_content,
        }
    })))
}

fn validate_objective_proposal_apply_result(result: &Value) -> Result<(), RuntimeClientError> {
    let object = result
        .as_object()
        .ok_or(RuntimeClientError::InvalidResponse)?;
    let proposal_apply = object_field(result, "proposal_apply_result")?;
    let apply = object_field_from_value(proposal_apply, "apply_result")?;
    if display_string(apply, "operation")? != "replace_file"
        || display_string(apply, "apply_status")? != "Applied"
        || !display_bool(apply, "applied")?
        || !display_bool(apply, "authorization_consumed")?
    {
        return Err(RuntimeClientError::InvalidResponse);
    }
    validate_sha256_fingerprint(&required_display_string(apply, "post_write_sha256")?)?;
    let route = object_field(result, "next_route")?;
    if display_string(route, "kind")? != "verify_objective_apply_explicitly"
        || display_string(route, "next_action")? != "verify_objective_apply"
        || object
            .get("objective_proposal_authorization_preflight_result")
            .is_some_and(|value| !value.is_null())
    {
        return Err(RuntimeClientError::InvalidResponse);
    }
    Ok(())
}

fn objective_apply_verification_params(
    result: &Value,
) -> Result<Option<Value>, RuntimeClientError> {
    let object = result
        .as_object()
        .ok_or(RuntimeClientError::InvalidResponse)?;
    let Some(route) = optional_object_field(object, "next_route") else {
        return Ok(None);
    };
    if display_string(route, "kind")? != "verify_objective_apply_explicitly" {
        return Ok(None);
    }
    let authorization = object_field(result, "objective_proposal_authorization_preflight_result")?;
    let proposal_apply = object_field(result, "proposal_apply_result")?;
    let apply = object_field_from_value(proposal_apply, "apply_result")?;
    let progress_fingerprint = required_display_string(route, "progress_fingerprint")?;
    validate_sha256_fingerprint(&progress_fingerprint)?;
    let apply_fingerprint = required_display_string(route, "apply_fingerprint")?;
    validate_sha256_fingerprint(&apply_fingerprint)?;
    let post_write_sha256 = required_display_string(apply, "post_write_sha256")?;
    validate_sha256_fingerprint(&post_write_sha256)?;
    if display_string(apply, "apply_status")? != "Applied"
        || !display_bool(apply, "applied")?
        || !display_bool(apply, "authorization_consumed")?
    {
        return Err(RuntimeClientError::InvalidResponse);
    }
    let session_id = required_display_string(authorization, "session_id")?;
    let continuation_id =
        stable_cli_objective_route_id("objective.verify", &session_id, &apply_fingerprint);

    Ok(Some(json!({
        "authorize": true,
        "continuation_id": continuation_id,
        "expected_progress_fingerprint": progress_fingerprint,
        "expected_aggregate_sequence": required_u64(route, "aggregate_sequence")?,
        "objective_apply_verification_target": {
            "authorize_objective_apply_verification": true,
            "objective_apply_continuation_id": required_display_string(object, "objective_continue_continuation_id")?,
            "expected_objective_apply_decision_id": required_display_string(object, "objective_continue_decision_id")?,
            "journey_id": required_display_string(authorization, "journey_id")?,
            "session_id": session_id,
            "source_drive_id": required_display_string(authorization, "source_drive_id")?,
            "expected_task_id": required_display_string(authorization, "task_id")?,
            "expected_run_id": required_display_string(authorization, "run_id")?,
            "expected_proposal_id": required_display_string(authorization, "proposal_id")?,
            "expected_apply_id": required_display_string(apply, "apply_id")?,
            "expected_operation": required_display_string(apply, "operation")?,
            "expected_apply_status": required_display_string(apply, "apply_status")?,
            "expected_authorization_consumed": display_bool(apply, "authorization_consumed")?,
            "expected_path_fingerprint": required_display_string(authorization, "path_fingerprint")?,
            "expected_apply_fingerprint": apply_fingerprint,
            "expected_post_write_sha256": post_write_sha256,
        }
    })))
}

fn validate_objective_apply_verification_result(result: &Value) -> Result<(), RuntimeClientError> {
    let verification = object_field(result, "objective_apply_verification_result")?;
    if display_string(verification, "verification_status")? != "verified"
        || display_string(verification, "operation")? != "replace_file"
        || display_string(verification, "route_kind")? != "accept_objective_completion_explicitly"
        || display_string(verification, "next_action")? != "accept_objective_completion"
    {
        return Err(RuntimeClientError::InvalidResponse);
    }
    for key in [
        "path_fingerprint",
        "apply_fingerprint",
        "expected_post_write_sha256",
        "current_target_sha256",
        "verification_fingerprint",
    ] {
        validate_sha256_fingerprint(&required_display_string(verification, key)?)?;
    }
    if required_display_string(verification, "expected_post_write_sha256")?
        != required_display_string(verification, "current_target_sha256")?
    {
        return Err(RuntimeClientError::InvalidResponse);
    }
    let route = object_field(result, "next_route")?;
    if display_string(route, "kind")? != "accept_objective_completion_explicitly"
        || display_string(route, "next_action")? != "accept_objective_completion"
    {
        return Err(RuntimeClientError::InvalidResponse);
    }
    Ok(())
}

fn objective_completion_acceptance_params(
    result: &Value,
) -> Result<Option<Value>, RuntimeClientError> {
    let object = result
        .as_object()
        .ok_or(RuntimeClientError::InvalidResponse)?;
    let Some(route) = optional_object_field(object, "next_route") else {
        return Ok(None);
    };
    if display_string(route, "kind")? != "accept_objective_completion_explicitly" {
        return Ok(None);
    }
    let authorization = object_field(result, "objective_proposal_authorization_preflight_result")?;
    let proposal_apply = object_field(result, "proposal_apply_result")?;
    let apply = object_field_from_value(proposal_apply, "apply_result")?;
    let verification = object_field(result, "objective_apply_verification_result")?;
    let progress_fingerprint = required_display_string(route, "progress_fingerprint")?;
    validate_sha256_fingerprint(&progress_fingerprint)?;
    let apply_fingerprint = required_display_string(verification, "apply_fingerprint")?;
    validate_sha256_fingerprint(&apply_fingerprint)?;
    let verification_fingerprint =
        required_display_string(verification, "verification_fingerprint")?;
    validate_sha256_fingerprint(&verification_fingerprint)?;
    let post_write_sha256 = required_display_string(verification, "expected_post_write_sha256")?;
    validate_sha256_fingerprint(&post_write_sha256)?;
    let current_target_sha256 = required_display_string(verification, "current_target_sha256")?;
    validate_sha256_fingerprint(&current_target_sha256)?;
    if display_string(verification, "verification_status")? != "verified"
        || display_string(verification, "route_kind")? != "accept_objective_completion_explicitly"
        || display_string(verification, "next_action")? != "accept_objective_completion"
        || display_string(apply, "apply_status")? != "Applied"
        || !display_bool(apply, "applied")?
        || !display_bool(apply, "authorization_consumed")?
    {
        return Err(RuntimeClientError::InvalidResponse);
    }
    let session_id = required_display_string(authorization, "session_id")?;
    let continuation_id =
        stable_cli_objective_route_id("objective.complete", &session_id, &verification_fingerprint);

    Ok(Some(json!({
        "authorize": true,
        "continuation_id": continuation_id,
        "expected_progress_fingerprint": progress_fingerprint,
        "expected_aggregate_sequence": required_u64(route, "aggregate_sequence")?,
        "objective_completion_acceptance_target": {
            "authorize_objective_completion_acceptance": true,
            "objective_apply_verification_continuation_id": required_display_string(object, "objective_continue_continuation_id")?,
            "expected_objective_apply_verification_decision_id": required_display_string(object, "objective_continue_decision_id")?,
            "journey_id": required_display_string(authorization, "journey_id")?,
            "session_id": session_id,
            "source_drive_id": required_display_string(authorization, "source_drive_id")?,
            "expected_task_id": required_display_string(authorization, "task_id")?,
            "expected_run_id": required_display_string(authorization, "run_id")?,
            "expected_proposal_id": required_display_string(authorization, "proposal_id")?,
            "expected_apply_id": required_display_string(apply, "apply_id")?,
            "expected_operation": required_display_string(apply, "operation")?,
            "expected_apply_status": required_display_string(apply, "apply_status")?,
            "expected_authorization_consumed": display_bool(apply, "authorization_consumed")?,
            "expected_path_fingerprint": required_display_string(authorization, "path_fingerprint")?,
            "expected_apply_fingerprint": apply_fingerprint,
            "expected_post_write_sha256": post_write_sha256,
            "expected_current_target_sha256": current_target_sha256,
            "expected_verification_status": required_display_string(verification, "verification_status")?,
            "expected_verification_route_kind": required_display_string(verification, "route_kind")?,
            "expected_verification_fingerprint": verification_fingerprint,
        }
    })))
}

fn validate_objective_completion_acceptance_result(
    result: &Value,
) -> Result<(), RuntimeClientError> {
    let completion = object_field(result, "objective_completion_acceptance_result")?;
    if display_string(completion, "acceptance_status")? != "accepted"
        || display_string(completion, "operation")? != "replace_file"
        || display_string(completion, "verification_status")? != "verified"
        || display_string(completion, "next_action")? != "close_headless_run"
    {
        return Err(RuntimeClientError::InvalidResponse);
    }
    for key in [
        "path_fingerprint",
        "apply_fingerprint",
        "expected_post_write_sha256",
        "current_target_sha256",
        "verification_fingerprint",
        "acceptance_fingerprint",
    ] {
        validate_sha256_fingerprint(&required_display_string(completion, key)?)?;
    }
    if required_display_string(completion, "expected_post_write_sha256")?
        != required_display_string(completion, "current_target_sha256")?
    {
        return Err(RuntimeClientError::InvalidResponse);
    }
    let route = object_field(result, "next_route")?;
    if display_string(route, "kind")? != "refresh_progress_overview"
        || display_string(route, "next_action")? != "close_headless_run"
    {
        return Err(RuntimeClientError::InvalidResponse);
    }
    Ok(())
}

fn objective_completion_close_target(
    result: &Value,
) -> Result<Option<CompletionAcceptanceTarget>, RuntimeClientError> {
    let object = result
        .as_object()
        .ok_or(RuntimeClientError::InvalidResponse)?;
    let Some(completion) = optional_object_field(object, "objective_completion_acceptance_result")
    else {
        return Ok(None);
    };
    let Some(route) = optional_object_field(object, "next_route") else {
        return Ok(None);
    };
    if display_string(route, "kind")? != "refresh_progress_overview"
        || display_string(route, "next_action")? != "close_headless_run"
    {
        return Ok(None);
    }
    if display_string(completion, "acceptance_status")? != "accepted"
        || display_string(completion, "verification_status")? != "verified"
        || display_string(completion, "next_action")? != "close_headless_run"
    {
        return Err(RuntimeClientError::InvalidResponse);
    }
    let session_id = required_display_string(completion, "session_id")?;
    let task_id = required_display_string(completion, "task_id")?;
    let run_id = required_display_string(completion, "run_id")?;
    let terminal_completion_fingerprint =
        required_display_string(completion, "acceptance_fingerprint")?;
    validate_sha256_fingerprint(&terminal_completion_fingerprint)?;
    let expected_start_session_sequence = required_u64(object, "end_session_sequence")?;

    Ok(Some(CompletionAcceptanceTarget {
        session_id,
        task_id,
        run_id,
        terminal_completion_fingerprint,
        expected_start_session_sequence,
    }))
}

fn validate_objective_completion_close_route(result: &Value) -> Result<(), RuntimeClientError> {
    let object = result
        .as_object()
        .ok_or(RuntimeClientError::InvalidResponse)?;
    let closure = object_field(result, "completion_closure")?;
    let next_action = display_string(object, "next_action")?;
    if display_string(closure, "status")? != "complete"
        || !matches!(
            next_action.as_str(),
            "close_headless_run" | "inspect_progress_overview"
        )
    {
        return Err(RuntimeClientError::InvalidResponse);
    }
    validate_sha256_fingerprint(&required_display_string(closure, "closure_fingerprint")?)?;
    validate_sha256_fingerprint(&required_display_string(closure, "progress_fingerprint")?)?;
    if let Some(fingerprint) = closure.get("terminal_completion_fingerprint") {
        validate_sha256_fingerprint(&bounded_string(fingerprint)?)?;
    }
    if let Some(route) = optional_object_field(object, "next_route") {
        let route_kind = display_string(route, "kind")?;
        if !matches!(
            route_kind.as_str(),
            "refresh_progress_overview" | "inspect_progress_overview" | "no_eligible_task"
        ) {
            return Err(RuntimeClientError::InvalidResponse);
        }
    }
    if let Some(accepted) = optional_object_field(object, "accepted_completion") {
        validate_sha256_fingerprint(&required_display_string(
            accepted,
            "terminal_completion_fingerprint",
        )?)?;
    }
    Ok(())
}

fn merge_objective_drive_result(
    previous: &Value,
    drive: Value,
) -> Result<Value, RuntimeClientError> {
    let previous = previous
        .as_object()
        .ok_or(RuntimeClientError::InvalidResponse)?;
    let mut drive = drive
        .as_object()
        .cloned()
        .ok_or(RuntimeClientError::InvalidResponse)?;
    for key in [
        "journey",
        "journey_execution",
        "terminal_completion_evidence",
        "objective_proposal_authorization_preflight_result",
        "proposal_apply_result",
        "objective_apply_verification_result",
        "objective_completion_acceptance_result",
        "objective_continue_decision_id",
        "objective_continue_continuation_id",
        "objective_continue_post_progress_fingerprint",
        "objective_continue_post_aggregate_sequence",
    ] {
        if let Some(value) = previous.get(key) {
            drive.insert(key.to_string(), value.clone());
        }
    }
    Ok(Value::Object(drive))
}

fn merge_resume_drive_result(advance: &Value, drive: Value) -> Result<Value, RuntimeClientError> {
    let advance = advance
        .as_object()
        .ok_or(RuntimeClientError::InvalidResponse)?;
    let mut drive = drive
        .as_object()
        .cloned()
        .ok_or(RuntimeClientError::InvalidResponse)?;
    let step = resume_result_first_step(advance);

    for key in [
        "decision_id",
        "continuation_id",
        "selected_task_id",
        "selected_run_id",
        "candidate_count",
        "current_aggregate_sequence",
        "post_aggregate_sequence",
    ] {
        if drive.get(key).is_none() {
            if let Some(value) = resume_result_field(advance, step, key) {
                drive.insert(key.to_string(), value.clone());
            }
        }
    }
    if drive.get("stale").is_none() {
        drive.insert("stale".to_string(), Value::Bool(false));
    }
    if drive.get("selected_headless_journey_context").is_none() {
        if let Some(value) = advance.get("selected_headless_journey_context") {
            drive.insert(
                "selected_headless_journey_context".to_string(),
                value.clone(),
            );
        }
    }
    Ok(Value::Object(drive))
}

fn attach_resume_route_candidate_context(
    result: Value,
    candidate: &CliResumeRouteCandidate,
) -> Result<Value, RuntimeClientError> {
    let mut object = result
        .as_object()
        .cloned()
        .ok_or(RuntimeClientError::InvalidResponse)?;
    if object.get("selected_headless_journey_context").is_none() {
        object.insert(
            "selected_headless_journey_context".to_string(),
            json!({
                "kind": "headless_journey_context",
                "selection_source": "headless_route_candidate",
                "journey_id": candidate.journey_id,
                "session_id": candidate.session_id,
                "task_id": candidate.task_id,
                "run_id": candidate.run_id,
                "selected_task_id": candidate.task_id,
                "selected_run_id": candidate.run_id,
                "current_session_sequence": candidate.next_session_sequence
            }),
        );
    }
    Ok(Value::Object(object))
}

fn merge_objective_continue_result(
    original: Value,
    continuation: Value,
) -> Result<Value, RuntimeClientError> {
    let mut object = original
        .as_object()
        .cloned()
        .ok_or(RuntimeClientError::InvalidResponse)?;
    let continuation = continuation
        .as_object()
        .ok_or(RuntimeClientError::InvalidResponse)?;
    if let Some(value) = continuation.get("objective_proposal_authorization_preflight_result") {
        object.insert(
            "objective_proposal_authorization_preflight_result".to_string(),
            value.clone(),
        );
    }
    if let Some(value) = continuation.get("proposal_apply_result") {
        object.insert("proposal_apply_result".to_string(), value.clone());
    }
    if let Some(value) = continuation.get("objective_apply_verification_result") {
        object.insert(
            "objective_apply_verification_result".to_string(),
            value.clone(),
        );
    }
    if let Some(value) = continuation.get("objective_completion_acceptance_result") {
        object.insert(
            "objective_completion_acceptance_result".to_string(),
            value.clone(),
        );
    }
    if let Some(value) = continuation.get("next_route") {
        object.insert("next_route".to_string(), value.clone());
    }
    let continuation_next_action = continuation
        .get("next_action")
        .map(bounded_json_string)
        .transpose()?;
    if let Some(value) = continuation_next_action.as_ref() {
        object.insert("next_action".to_string(), value.clone());
    }
    for (source_key, target_key) in [
        ("decision_id", "objective_continue_decision_id"),
        ("continuation_id", "objective_continue_continuation_id"),
        (
            "post_progress_fingerprint",
            "objective_continue_post_progress_fingerprint",
        ),
        (
            "post_aggregate_sequence",
            "objective_continue_post_aggregate_sequence",
        ),
    ] {
        if let Some(value) = continuation.get(source_key) {
            object.insert(target_key.to_string(), value.clone());
        }
    }
    let stop_reason = match continuation_next_action.as_ref().and_then(Value::as_str) {
        Some("close_headless_run") => "objective_completion_accepted",
        Some("accept_objective_completion") => "objective_apply_verified",
        Some("verify_objective_apply") => "objective_proposal_apply_ready_for_verification",
        Some("apply_authorized_objective_proposal") => {
            "objective_proposal_authorization_preflight_ready"
        }
        _ => "objective_route_followed",
    };
    object.insert(
        "stop_reason".to_string(),
        Value::String(stop_reason.to_string()),
    );
    Ok(Value::Object(object))
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
    if closure_status != "complete"
        || object.get("accepted_completion").is_some()
        || object.get("completion_finalization").is_some()
        || object
            .get("objective_completion_acceptance_result")
            .is_some()
    {
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
    if objective.is_empty() || objective.chars().count() > CLI_RUN_MAX_OBJECTIVE_CHARS {
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

fn stable_cli_objective_route_id(kind: &str, session_id: &str, route_fingerprint: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"brownie-cli-objective-route-v1\\0");
    hasher.update(kind.as_bytes());
    hasher.update(b"\\0");
    hasher.update(session_id.as_bytes());
    hasher.update(b"\\0");
    hasher.update(route_fingerprint.as_bytes());
    let digest = hasher.finalize();
    format!("cli.obj.{}", hex_prefix(&digest, 16))
}

fn stable_cli_objective_authorization_token_fingerprint(route_fingerprint: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"brownie-cli-objective-authorization-v1\\0");
    hasher.update(route_fingerprint.as_bytes());
    let digest = hasher.finalize();
    format!("sha256:{}", hex_prefix(&digest, 32))
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
    let runnable_count = display_usize_or(
        progress,
        "runnable_count",
        array_len(progress, "runnable_task_ids")?,
    )?;
    let blocked_count = display_usize_or(
        progress,
        "blocked_count",
        array_len(progress, "blocked_task_ids")?,
    )?;
    let terminal_count = display_usize_or(
        progress,
        "terminal_count",
        array_len(progress, "terminal_task_ids")?,
    )?;
    let parent_join_ready_ids =
        optional_array_field_checked(progress, "parent_join_ready_task_ids")?;
    let parent_join_ready_count = display_usize_or(
        progress,
        "parent_join_ready_count",
        parent_join_ready_ids.map(Vec::len).unwrap_or(0),
    )?;

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

fn object_field_from_value<'a>(
    object: &'a serde_json::Map<String, Value>,
    key: &str,
) -> Result<&'a serde_json::Map<String, Value>, RuntimeClientError> {
    object
        .get(key)
        .and_then(Value::as_object)
        .ok_or(RuntimeClientError::InvalidResponse)
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
    fn cli_run_objective_proposal_preflight_params_use_runtime_route_evidence() {
        let drive = json!({
            "status": "task_executed",
            "session_id": "cli.run.abc",
            "drive_id": "cli.run.abc.drive",
            "next_action": "review_and_authorize_objective_proposal",
            "stop_reason": "objective_proposal_candidate_ready",
            "end_session_sequence": 1,
            "post_progress": {
                "progress_fingerprint": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "aggregate_sequence": 7
            },
            "journey": {
                "journey_id": "cli.run.abc.journey",
                "task_id": "task_1",
                "run_id": "run_1",
                "journey_fingerprint": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
            },
            "next_route": {
                "kind": "review_and_authorize_objective_proposal",
                "task_id": "task_1",
                "run_id": "run_1",
                "proposal_id": "proposal_1",
                "progress_fingerprint": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "aggregate_sequence": 7,
                "next_action": "review_and_authorize_objective_proposal",
                "reason": "ready"
            },
            "objective_proposal_candidate": {
                "status": "ready_for_review",
                "journey_id": "cli.run.abc.journey",
                "task_id": "task_1",
                "run_id": "run_1",
                "session_id": "cli.run.abc",
                "drive_id": "cli.run.abc.drive",
                "objective_context_fingerprint": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
                "selected_context_fingerprint": "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
                "candidate_count": 1,
                "proposal_id": "proposal_1",
                "source_event_id": "event_1",
                "source_event_kind": "WorkspacePatchProposed",
                "operation": "replace_file",
                "path_fingerprint": "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
                "validation_status": "Valid",
                "approval_status": "Pending",
                "candidate_fingerprint": "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
                "replayed": false,
                "next_action": "review_and_authorize_objective_proposal"
            }
        });

        let params = objective_proposal_authorization_preflight_params(&drive)
            .unwrap()
            .expect("preflight params");
        let second = objective_proposal_authorization_preflight_params(&drive)
            .unwrap()
            .expect("stable preflight params");
        assert_eq!(params, second);
        assert_eq!(params["authorize"], true);
        assert_eq!(params["expected_aggregate_sequence"], 7);
        assert_eq!(
            params["expected_progress_fingerprint"],
            "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        );
        assert!(params.get("mode_id").is_none());
        assert!(params.get("replacement_content").is_none());
        assert!(params.get("objective_proposal_apply_target").is_none());
        let target = &params["objective_proposal_authorization_preflight_target"];
        assert_eq!(target["authorize_objective_proposal_preflight"], true);
        assert_eq!(target["expected_operation"], "replace_file");
        assert_eq!(target["expected_validation_status"], "Valid");
        assert_eq!(target["expected_approval_status"], "Pending");
        assert_eq!(
            target["expected_candidate_fingerprint"],
            "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
        );
        validate_sha256_fingerprint(
            target["authorization_token_fingerprint"]
                .as_str()
                .expect("token fingerprint"),
        )
        .unwrap();
    }

    #[test]
    fn cli_run_objective_proposal_apply_params_use_runtime_preflight_and_inspect_evidence() {
        let authorized: Value = serde_json::from_str(
            r#"{
                "status":"task_executed",
                "session_id":"cli.run.abc",
                "drive_id":"cli.run.abc.drive",
                "next_action":"apply_authorized_objective_proposal",
                "stop_reason":"objective_proposal_authorization_preflight_ready",
                "end_session_sequence":1,
                "objective_continue_decision_id":"headless_decision_1",
                "objective_continue_continuation_id":"cli.obj.auth",
                "objective_continue_post_progress_fingerprint":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "objective_continue_post_aggregate_sequence":8,
                "journey":{"journey_id":"cli.run.abc.journey","task_id":"task_1","run_id":"run_1","journey_fingerprint":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},
                "next_route":{"kind":"apply_authorized_objective_proposal_explicitly","task_id":"task_1","run_id":"run_1","proposal_id":"proposal_1","progress_fingerprint":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","aggregate_sequence":8,"next_action":"apply_authorized_objective_proposal","reason":"ready"},
                "objective_proposal_authorization_preflight_result":{
                    "status":"authorized_preflight_ready",
                    "journey_id":"cli.run.abc.journey",
                    "task_id":"task_1",
                    "run_id":"run_1",
                    "session_id":"cli.run.abc",
                    "source_drive_id":"cli.run.abc.drive",
                    "proposal_id":"proposal_1",
                    "source_event_id":"event_1",
                    "source_event_kind":"WorkspacePatchProposed",
                    "operation":"replace_file",
                    "path_fingerprint":"sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
                    "objective_context_fingerprint":"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
                    "selected_context_fingerprint":"sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
                    "candidate_fingerprint":"sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
                    "authorization_token_fingerprint":"sha256:1111111111111111111111111111111111111111111111111111111111111111",
                    "validation_status":"Valid",
                    "approval_status":"Approved",
                    "preflight_snapshot":{"proposal_id":"proposal_1","snapshot_id":"snapshot_1","path":"README.md","canonical_path_hash":"sha256:2222222222222222222222222222222222222222222222222222222222222222","file_exists":true,"file_kind":"regular_file","file_size_bytes":15,"file_modified_unix_ms":1,"file_sha256":"sha256:3333333333333333333333333333333333333333333333333333333333333333","captured_at":"2026-08-27T00:00:00Z","stale":false,"stale_reason":null},
                    "apply_plan":{"proposal_id":"proposal_1","plan_id":"plan_1","status":"Ready","checklist":[]},
                    "authorization_preflight_fingerprint":"sha256:4444444444444444444444444444444444444444444444444444444444444444",
                    "replayed":false,
                    "next_action":"apply_authorized_objective_proposal"
                }
            }"#,
        )
        .unwrap();
        let proposal: Value = serde_json::from_str(
            r#"{
                "proposal":{
                    "proposal_id":"proposal_1",
                    "path":"README.md",
                    "operation":"replace_file",
                    "content_preview":"new README content",
                    "content_chars":18,
                    "truncated":false,
                    "validation_status":"Valid",
                    "validation_reason":null,
                    "diff_preview":"--- README.md",
                    "diff_truncated":false,
                    "diff_redacted":false,
                    "approval_status":"Approved",
                    "approval_reason":null,
                    "approval_reason_redacted":false,
                    "approved_at":"2026-08-27T00:00:00Z",
                    "rejected_at":null,
                    "latest_apply_plan":null,
                    "latest_snapshot":null
                }
            }"#,
        )
        .unwrap();

        let inspect_params = objective_proposal_inspect_params(&authorized)
            .unwrap()
            .expect("inspect params");
        assert_eq!(inspect_params["run_id"], "run_1");
        assert_eq!(inspect_params["proposal_id"], "proposal_1");

        let params = objective_proposal_apply_params(&authorized, &proposal)
            .unwrap()
            .expect("apply params");
        let second = objective_proposal_apply_params(&authorized, &proposal)
            .unwrap()
            .expect("stable apply params");
        assert_eq!(params, second);
        assert_eq!(params["authorize"], true);
        assert!(params.get("mode_id").is_none());
        assert_eq!(params["expected_aggregate_sequence"], 8);
        let target = &params["objective_proposal_apply_target"];
        assert_eq!(target["authorize_objective_proposal_apply"], true);
        assert_eq!(target["expected_operation"], "replace_file");
        assert_eq!(
            target["expected_authorization_preflight_fingerprint"],
            "sha256:4444444444444444444444444444444444444444444444444444444444444444"
        );
        assert_eq!(
            target["expected_target_sha256"],
            "sha256:3333333333333333333333333333333333333333333333333333333333333333"
        );
        assert_eq!(target["replacement_content"], "new README content");
    }

    #[test]
    fn cli_run_objective_apply_verification_params_use_runtime_apply_evidence() {
        let applied: Value = serde_json::from_str(
            r#"{
                "status":"task_executed",
                "session_id":"cli.run.abc",
                "drive_id":"cli.run.abc.drive",
                "next_action":"verify_objective_apply",
                "stop_reason":"objective_proposal_apply_ready_for_verification",
                "objective_continue_decision_id":"headless_decision_apply",
                "objective_continue_continuation_id":"cli.obj.apply",
                "journey":{"journey_id":"cli.run.abc.journey","task_id":"task_1","run_id":"run_1","journey_fingerprint":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},
                "next_route":{"kind":"verify_objective_apply_explicitly","task_id":"task_1","run_id":"run_1","proposal_id":"proposal_1","apply_id":"apply_1","apply_fingerprint":"sha256:5555555555555555555555555555555555555555555555555555555555555555","progress_fingerprint":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","aggregate_sequence":9,"next_action":"verify_objective_apply","reason":"ready"},
                "objective_proposal_authorization_preflight_result":{
                    "status":"authorized_preflight_ready",
                    "journey_id":"cli.run.abc.journey",
                    "task_id":"task_1",
                    "run_id":"run_1",
                    "session_id":"cli.run.abc",
                    "source_drive_id":"cli.run.abc.drive",
                    "proposal_id":"proposal_1",
                    "source_event_id":"event_1",
                    "source_event_kind":"WorkspacePatchProposed",
                    "operation":"replace_file",
                    "path_fingerprint":"sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
                    "objective_context_fingerprint":"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
                    "selected_context_fingerprint":"sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
                    "candidate_fingerprint":"sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
                    "authorization_token_fingerprint":"sha256:1111111111111111111111111111111111111111111111111111111111111111",
                    "validation_status":"Valid",
                    "approval_status":"Approved",
                    "preflight_snapshot":{"proposal_id":"proposal_1","snapshot_id":"snapshot_1","path":"README.md","canonical_path_hash":"sha256:2222222222222222222222222222222222222222222222222222222222222222","file_exists":true,"file_kind":"regular_file","file_size_bytes":15,"file_modified_unix_ms":1,"file_sha256":"sha256:3333333333333333333333333333333333333333333333333333333333333333","captured_at":"2026-08-27T00:00:00Z","stale":false,"stale_reason":null},
                    "apply_plan":{"proposal_id":"proposal_1","plan_id":"plan_1","status":"Ready","checklist":[]},
                    "authorization_preflight_fingerprint":"sha256:4444444444444444444444444444444444444444444444444444444444444444",
                    "replayed":false,
                    "next_action":"apply_authorized_objective_proposal"
                },
                "proposal_apply_result":{
                    "proposal":{"proposal_id":"proposal_1","path":"README.md","operation":"replace_file","content_preview":"new README content","content_chars":18,"truncated":false,"validation_status":"Valid","validation_reason":null,"diff_preview":"--- README.md","diff_truncated":false,"diff_redacted":false,"approval_status":"Approved","approval_reason":null,"approval_reason_redacted":false,"approved_at":"2026-08-27T00:00:00Z","rejected_at":null,"latest_apply_plan":null,"latest_snapshot":null},
                    "apply_result":{"proposal_id":"proposal_1","apply_id":"apply_1","apply_status":"Applied","apply_reason":"applied","authorization_id":"auth_1","authorization_consumed":true,"applied":true,"operation":"replace_file","atomic_replacement_completed":true,"atomic_create_completed":false,"atomic_delete_completed":false,"path":"README.md","expected_target_sha256":"sha256:3333333333333333333333333333333333333333333333333333333333333333","expected_target_absent":null,"pre_write_target_sha256":"sha256:3333333333333333333333333333333333333333333333333333333333333333","pre_write_target_exists":true,"post_write_sha256":"sha256:6666666666666666666666666666666666666666666666666666666666666666","post_delete_target_exists":null,"content_chars":18,"content_bytes":18,"checked_at":"2026-08-27T00:00:00Z","applied_at":"2026-08-27T00:00:00Z","temp_file_cleaned":true,"check_count":1,"failed_checks":[],"blocked_checks":[],"checklist":[]}
                }
            }"#,
        )
        .unwrap();

        let params = objective_apply_verification_params(&applied)
            .unwrap()
            .expect("verification params");
        let second = objective_apply_verification_params(&applied)
            .unwrap()
            .expect("stable verification params");
        assert_eq!(params, second);
        assert_eq!(params["authorize"], true);
        assert!(params.get("mode_id").is_none());
        assert!(params.get("replacement_content").is_none());
        assert_eq!(params["expected_aggregate_sequence"], 9);
        let target = &params["objective_apply_verification_target"];
        assert_eq!(target["authorize_objective_apply_verification"], true);
        assert_eq!(target["objective_apply_continuation_id"], "cli.obj.apply");
        assert_eq!(
            target["expected_objective_apply_decision_id"],
            "headless_decision_apply"
        );
        assert_eq!(target["expected_operation"], "replace_file");
        assert_eq!(target["expected_apply_status"], "Applied");
        assert_eq!(target["expected_authorization_consumed"], true);
        assert_eq!(
            target["expected_apply_fingerprint"],
            "sha256:5555555555555555555555555555555555555555555555555555555555555555"
        );
        assert_eq!(
            target["expected_post_write_sha256"],
            "sha256:6666666666666666666666666666666666666666666666666666666666666666"
        );
    }

    #[test]
    fn cli_run_objective_completion_acceptance_params_use_runtime_verification_evidence() {
        let verified: Value = serde_json::from_str(
            r#"{
                "status":"task_executed",
                "session_id":"cli.run.abc",
                "drive_id":"cli.run.abc.drive",
                "next_action":"accept_objective_completion",
                "stop_reason":"objective_apply_verified",
                "objective_continue_decision_id":"headless_decision_verify",
                "objective_continue_continuation_id":"cli.obj.verify",
                "journey":{"journey_id":"cli.run.abc.journey","task_id":"task_1","run_id":"run_1","journey_fingerprint":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},
                "next_route":{"kind":"accept_objective_completion_explicitly","task_id":"task_1","run_id":"run_1","proposal_id":"proposal_1","apply_id":"apply_1","apply_fingerprint":"sha256:5555555555555555555555555555555555555555555555555555555555555555","progress_fingerprint":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","aggregate_sequence":10,"next_action":"accept_objective_completion","reason":"ready"},
                "objective_proposal_authorization_preflight_result":{
                    "status":"authorized_preflight_ready",
                    "journey_id":"cli.run.abc.journey",
                    "task_id":"task_1",
                    "run_id":"run_1",
                    "session_id":"cli.run.abc",
                    "source_drive_id":"cli.run.abc.drive",
                    "proposal_id":"proposal_1",
                    "source_event_id":"event_1",
                    "source_event_kind":"WorkspacePatchProposed",
                    "operation":"replace_file",
                    "path_fingerprint":"sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
                    "objective_context_fingerprint":"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
                    "selected_context_fingerprint":"sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
                    "candidate_fingerprint":"sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
                    "authorization_token_fingerprint":"sha256:1111111111111111111111111111111111111111111111111111111111111111",
                    "validation_status":"Valid",
                    "approval_status":"Approved",
                    "preflight_snapshot":{"proposal_id":"proposal_1","snapshot_id":"snapshot_1","path":"README.md","canonical_path_hash":"sha256:2222222222222222222222222222222222222222222222222222222222222222","file_exists":true,"file_kind":"regular_file","file_size_bytes":15,"file_modified_unix_ms":1,"file_sha256":"sha256:3333333333333333333333333333333333333333333333333333333333333333","captured_at":"2026-08-27T00:00:00Z","stale":false,"stale_reason":null},
                    "apply_plan":{"proposal_id":"proposal_1","plan_id":"plan_1","status":"Ready","checklist":[]},
                    "authorization_preflight_fingerprint":"sha256:4444444444444444444444444444444444444444444444444444444444444444",
                    "replayed":false,
                    "next_action":"apply_authorized_objective_proposal"
                },
                "proposal_apply_result":{
                    "proposal":{"proposal_id":"proposal_1","path":"README.md","operation":"replace_file","content_preview":"new README content","content_chars":18,"truncated":false,"validation_status":"Valid","validation_reason":null,"diff_preview":"--- README.md","diff_truncated":false,"diff_redacted":false,"approval_status":"Approved","approval_reason":null,"approval_reason_redacted":false,"approved_at":"2026-08-27T00:00:00Z","rejected_at":null,"latest_apply_plan":null,"latest_snapshot":null},
                    "apply_result":{"proposal_id":"proposal_1","apply_id":"apply_1","apply_status":"Applied","apply_reason":"applied","authorization_id":"auth_1","authorization_consumed":true,"applied":true,"operation":"replace_file","atomic_replacement_completed":true,"atomic_create_completed":false,"atomic_delete_completed":false,"path":"README.md","expected_target_sha256":"sha256:3333333333333333333333333333333333333333333333333333333333333333","expected_target_absent":null,"pre_write_target_sha256":"sha256:3333333333333333333333333333333333333333333333333333333333333333","pre_write_target_exists":true,"post_write_sha256":"sha256:6666666666666666666666666666666666666666666666666666666666666666","post_delete_target_exists":null,"content_chars":18,"content_bytes":18,"checked_at":"2026-08-27T00:00:00Z","applied_at":"2026-08-27T00:00:00Z","temp_file_cleaned":true,"check_count":1,"failed_checks":[],"blocked_checks":[],"checklist":[]}
                },
                "objective_apply_verification_result":{
                    "verification_status":"verified",
                    "journey_id":"cli.run.abc.journey",
                    "task_id":"task_1",
                    "run_id":"run_1",
                    "session_id":"cli.run.abc",
                    "source_drive_id":"cli.run.abc.drive",
                    "proposal_id":"proposal_1",
                    "apply_id":"apply_1",
                    "operation":"replace_file",
                    "path_fingerprint":"sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
                    "apply_fingerprint":"sha256:5555555555555555555555555555555555555555555555555555555555555555",
                    "expected_post_write_sha256":"sha256:6666666666666666666666666666666666666666666666666666666666666666",
                    "current_target_sha256":"sha256:6666666666666666666666666666666666666666666666666666666666666666",
                    "verification_fingerprint":"sha256:7777777777777777777777777777777777777777777777777777777777777777",
                    "route_kind":"accept_objective_completion_explicitly",
                    "replayed":false,
                    "next_action":"accept_objective_completion"
                }
            }"#,
        )
        .unwrap();

        let params = objective_completion_acceptance_params(&verified)
            .unwrap()
            .expect("completion acceptance params");
        let second = objective_completion_acceptance_params(&verified)
            .unwrap()
            .expect("stable completion acceptance params");
        assert_eq!(params, second);
        assert_eq!(params["authorize"], true);
        assert!(params.get("mode_id").is_none());
        assert!(params.get("replacement_content").is_none());
        assert_eq!(params["expected_aggregate_sequence"], 10);
        let target = &params["objective_completion_acceptance_target"];
        assert_eq!(target["authorize_objective_completion_acceptance"], true);
        assert_eq!(
            target["objective_apply_verification_continuation_id"],
            "cli.obj.verify"
        );
        assert_eq!(
            target["expected_objective_apply_verification_decision_id"],
            "headless_decision_verify"
        );
        assert_eq!(target["expected_operation"], "replace_file");
        assert_eq!(target["expected_apply_status"], "Applied");
        assert_eq!(target["expected_authorization_consumed"], true);
        assert_eq!(target["expected_verification_status"], "verified");
        assert_eq!(
            target["expected_verification_route_kind"],
            "accept_objective_completion_explicitly"
        );
        assert_eq!(
            target["expected_verification_fingerprint"],
            "sha256:7777777777777777777777777777777777777777777777777777777777777777"
        );
    }

    #[test]
    fn cli_run_objective_completion_close_params_use_runtime_acceptance_evidence() {
        let accepted: Value = serde_json::from_str(
            r#"{
                "status":"task_executed",
                "session_id":"cli.run.abc",
                "drive_id":"cli.run.abc.drive",
                "next_action":"close_headless_run",
                "stop_reason":"objective_completion_accepted",
                "end_session_sequence":1,
                "objective_continue_decision_id":"headless_decision_complete",
                "objective_continue_continuation_id":"cli.obj.complete",
                "journey":{"journey_id":"cli.run.abc.journey","task_id":"task_1","run_id":"run_1","journey_fingerprint":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},
                "next_route":{"kind":"refresh_progress_overview","task_id":"task_1","run_id":"run_1","proposal_id":"proposal_1","apply_id":"apply_1","apply_fingerprint":"sha256:5555555555555555555555555555555555555555555555555555555555555555","progress_fingerprint":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","aggregate_sequence":11,"next_action":"close_headless_run","reason":"ready"},
                "objective_completion_acceptance_result":{
                    "acceptance_status":"accepted",
                    "journey_id":"cli.run.abc.journey",
                    "task_id":"task_1",
                    "run_id":"run_1",
                    "session_id":"cli.run.abc",
                    "source_drive_id":"cli.run.abc.drive",
                    "proposal_id":"proposal_1",
                    "apply_id":"apply_1",
                    "operation":"replace_file",
                    "path_fingerprint":"sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
                    "apply_fingerprint":"sha256:5555555555555555555555555555555555555555555555555555555555555555",
                    "expected_post_write_sha256":"sha256:6666666666666666666666666666666666666666666666666666666666666666",
                    "current_target_sha256":"sha256:6666666666666666666666666666666666666666666666666666666666666666",
                    "verification_status":"verified",
                    "verification_fingerprint":"sha256:7777777777777777777777777777777777777777777777777777777777777777",
                    "acceptance_fingerprint":"sha256:8888888888888888888888888888888888888888888888888888888888888888",
                    "replayed":false,
                    "next_action":"close_headless_run"
                }
            }"#,
        )
        .unwrap();

        let target = objective_completion_close_target(&accepted)
            .unwrap()
            .expect("close target");
        assert_eq!(target.session_id, "cli.run.abc");
        assert_eq!(target.task_id, "task_1");
        assert_eq!(target.run_id, "run_1");
        assert_eq!(target.expected_start_session_sequence, 1);
        assert_eq!(
            target.terminal_completion_fingerprint,
            "sha256:8888888888888888888888888888888888888888888888888888888888888888"
        );
        let close_params = accepted_completion_route_params(&target, false, None);
        assert_eq!(close_params["authorize"], true);
        assert_eq!(close_params["session_id"], "cli.run.abc");
        assert_eq!(close_params["drive_id"], "cli.run.abc.done");
        assert_eq!(close_params["expected_start_session_sequence"], 1);
        assert!(close_params.get("completion_acceptance").is_none());
        assert!(close_params
            .get("objective_completion_acceptance_target")
            .is_none());
        assert!(close_params
            .get("authorize_completion_finalization")
            .is_none());

        let final_params = accepted_completion_route_params(
            &target,
            true,
            Some("sha256:9999999999999999999999999999999999999999999999999999999999999999"),
        );
        assert_eq!(final_params["drive_id"], "cli.run.abc.finalize");
        assert_eq!(final_params["authorize_completion_finalization"], true);
        assert_eq!(
            final_params["expected_completion_closure_fingerprint"],
            "sha256:9999999999999999999999999999999999999999999999999999999999999999"
        );

        let refreshed_close: Value = serde_json::from_str(
            r#"{
                "status":"no_eligible_task",
                "session_id":"cli.run.abc",
                "drive_id":"cli.run.abc.done",
                "start_session_sequence":1,
                "end_session_sequence":2,
                "stop_reason":"complete",
                "completion_closure":{
                    "status":"complete",
                    "closure_fingerprint":"sha256:9999999999999999999999999999999999999999999999999999999999999999",
                    "progress_fingerprint":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                    "terminal_completion_fingerprint":"sha256:8888888888888888888888888888888888888888888888888888888888888888"
                },
                "next_action":"inspect_progress_overview",
                "next_route":{"kind":"no_eligible_task","next_action":"inspect_progress_overview"},
                "accepted_completion":{
                    "terminal_completion_fingerprint":"sha256:8888888888888888888888888888888888888888888888888888888888888888"
                }
            }"#,
        )
        .unwrap();
        validate_objective_completion_close_route(&refreshed_close).unwrap();
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
        assert!(params.get("context_budget").is_none());
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

    #[test]
    fn cli_resume_accepts_headless_run_advance_result_projection() {
        let result: Value = serde_json::from_str(
            r#"{"status":"task_executed","session_id":"cli.run.new","advance_id":"cli.resume.advance","session_sequence":2,"replayed":false,"start_progress":{"progress_fingerprint":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","aggregate_sequence":7},"post_progress":{"progress_fingerprint":"sha256:9999999999999999999999999999999999999999999999999999999999999999","aggregate_sequence":8},"max_steps":1,"step_count":1,"executed_count":1,"replayed_count":0,"stop_reason":"step executed","checkpoint_fingerprint":"sha256:8888888888888888888888888888888888888888888888888888888888888888","terminal_completion_evidence":null,"next_route":null,"steps":[{"step_index":1,"status":"task_executed","decision_id":"decision-new","continuation_id":"run.cli.run.new.2","selected_task_id":"task-new","selected_run_id":"run-new","candidate_count":1,"current_progress_fingerprint":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","current_aggregate_sequence":7,"post_progress_fingerprint":"sha256:9999999999999999999999999999999999999999999999999999999999999999","post_aggregate_sequence":8,"replayed":false,"next_route":null,"next_action":"inspect_progress_overview"}],"next_action":"inspect_progress_overview"}"#,
        )
        .unwrap();
        let response = format!(r#"{{"jsonrpc":"2.0","id":1,"result":{result}}}"#,);
        let result = parse_runtime_value_response(&response, &json!(1)).unwrap();
        validate_headless_run_advance_result(&result).unwrap();
        let payload = cli_resume_payload(&result).unwrap();
        assert_eq!(payload["selected_task_id"], "task-new");
        assert_eq!(payload["headless_session_id"], "cli.run.new");
        let rendered = json_result("resume", "resume", payload).unwrap();
        assert!(rendered.len() < MAX_RENDERED_OUTPUT_CHARS);
    }
}
