pub mod cli;
pub mod runtime_client;

use cli::{Cli, CliCommand, CliError, InspectTarget, ListTarget, ModeTarget};
use runtime_client::{RunRecoveryIdentity, RuntimeClient, RuntimeClientError};
use std::fs;
use std::io::{ErrorKind, Read};

const DEFAULT_RUN_FILE_MAX_BYTES: u64 = 65_536;
const RUN_FILE_MAX_BYTES_ENV: &str = "BROWNIE_CLI_RUN_FILE_MAX_BYTES";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExitCode {
    Success = 0,
    InvalidInvocation = 64,
    RuntimeUnavailable = 69,
    InternalCommunication = 70,
}

impl ExitCode {
    pub fn as_i32(self) -> i32 {
        self as i32
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct CliOutput {
    pub exit_code: ExitCode,
    pub stdout: String,
    pub stderr: String,
}

pub fn run_cli<I, S>(args: I) -> CliOutput
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    let args: Vec<String> = args.into_iter().map(Into::into).collect();
    let json_requested = args.iter().skip(1).any(|arg| arg == "--json");

    match Cli::parse(args) {
        Ok(cli) => execute(cli),
        Err(error) => error_output(
            ExitCode::InvalidInvocation,
            "invalid_invocation",
            &error.to_string(),
            json_requested,
            "unknown",
            None,
        ),
    }
}

fn execute(cli: Cli) -> CliOutput {
    match cli.command {
        CliCommand::Help { topic } => CliOutput {
            exit_code: ExitCode::Success,
            stdout: topic
                .as_ref()
                .map(Cli::topic_help)
                .unwrap_or_else(Cli::help),
            stderr: String::new(),
        },
        CliCommand::Version => CliOutput {
            exit_code: ExitCode::Success,
            stdout: format!("brownie {}\n", env!("CARGO_PKG_VERSION")),
            stderr: String::new(),
        },
        CliCommand::RunFile { path } => match read_run_file_objective(&path) {
            Ok(objective) => {
                let client = RuntimeClient::default();
                let command = CliCommand::Run { objective };
                match client.invoke(&command, cli.json) {
                    Ok(message) => CliOutput {
                        exit_code: ExitCode::Success,
                        stdout: message,
                        stderr: String::new(),
                    },
                    Err(error) => runtime_error_output(error, cli.json, "run"),
                }
            }
            Err(error) => error_output_with_reason(
                ExitCode::InvalidInvocation,
                "invalid_invocation",
                &format!("failed to read objective file: {}", error.message()),
                cli.json,
                "run",
                None,
                Some(error.reason()),
            ),
        },
        command => {
            let client = RuntimeClient::default();
            let command_name = command_name(&command);
            match client.invoke(&command, cli.json) {
                Ok(message) => CliOutput {
                    exit_code: ExitCode::Success,
                    stdout: message,
                    stderr: String::new(),
                },
                Err(error) => runtime_error_output(error, cli.json, command_name),
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum RunFileObjectiveError {
    InvalidUtf8,
    Message(String),
}

impl RunFileObjectiveError {
    fn message(&self) -> &str {
        match self {
            RunFileObjectiveError::InvalidUtf8 => "objective file must be valid UTF-8",
            RunFileObjectiveError::Message(message) => message.as_str(),
        }
    }

    fn reason(&self) -> &str {
        match self {
            RunFileObjectiveError::InvalidUtf8 => "invalid_utf8",
            RunFileObjectiveError::Message(_) => "read_failed",
        }
    }
}

fn read_run_file_objective(path: &str) -> Result<String, RunFileObjectiveError> {
    let max_bytes = run_file_max_bytes()?;
    let mut file = open_run_file(path)?;
    let metadata = file
        .metadata()
        .map_err(|error| RunFileObjectiveError::Message(error.to_string()))?;
    if !metadata.file_type().is_file() {
        return Err(RunFileObjectiveError::Message(
            "objective path must refer to a regular file".to_string(),
        ));
    }
    if metadata.len() > max_bytes {
        return Err(RunFileObjectiveError::Message(format!(
            "objective file exceeds configured maximum byte size: bytes={} max_bytes={} env={}",
            metadata.len(),
            max_bytes,
            RUN_FILE_MAX_BYTES_ENV
        )));
    }
    let mut objective = String::new();
    file.read_to_string(&mut objective).map_err(|error| {
        if error.kind() == ErrorKind::InvalidData {
            RunFileObjectiveError::InvalidUtf8
        } else {
            RunFileObjectiveError::Message(error.to_string())
        }
    })?;
    let bytes_read = objective.len() as u64;
    if bytes_read > max_bytes {
        return Err(RunFileObjectiveError::Message(format!(
            "objective file exceeds configured maximum byte size: bytes={} max_bytes={} env={}",
            bytes_read, max_bytes, RUN_FILE_MAX_BYTES_ENV
        )));
    }
    Ok(objective)
}

#[cfg(unix)]
fn open_run_file(path: &str) -> Result<fs::File, RunFileObjectiveError> {
    use std::os::unix::fs::OpenOptionsExt;

    fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NONBLOCK)
        .open(path)
        .map_err(|error| RunFileObjectiveError::Message(error.to_string()))
}

#[cfg(not(unix))]
fn open_run_file(path: &str) -> Result<fs::File, RunFileObjectiveError> {
    fs::File::open(path).map_err(|error| RunFileObjectiveError::Message(error.to_string()))
}

fn run_file_max_bytes() -> Result<u64, RunFileObjectiveError> {
    match std::env::var(RUN_FILE_MAX_BYTES_ENV) {
        Ok(value) => {
            let parsed = value.parse::<u64>().map_err(|_| {
                RunFileObjectiveError::Message(format!(
                    "{RUN_FILE_MAX_BYTES_ENV} must be a positive integer byte limit"
                ))
            })?;
            if parsed == 0 {
                return Err(RunFileObjectiveError::Message(format!(
                    "{RUN_FILE_MAX_BYTES_ENV} must be greater than zero"
                )));
            }
            Ok(parsed)
        }
        Err(std::env::VarError::NotPresent) => Ok(DEFAULT_RUN_FILE_MAX_BYTES),
        Err(std::env::VarError::NotUnicode(_)) => Err(RunFileObjectiveError::Message(format!(
            "{RUN_FILE_MAX_BYTES_ENV} must be valid UTF-8"
        ))),
    }
}

fn runtime_error_output(error: RuntimeClientError, json: bool, command: &'static str) -> CliOutput {
    let (exit_code, code, message, recovery_identity) = match error {
        RuntimeClientError::RuntimeUnavailable => (
            ExitCode::RuntimeUnavailable,
            "runtime_unavailable",
            "runtime binary is unavailable",
            None,
        ),
        RuntimeClientError::UnsupportedCommand => (
            ExitCode::RuntimeUnavailable,
            "runtime_unavailable",
            "runtime command is not implemented in this CLI slice",
            None,
        ),
        RuntimeClientError::CommunicationFailed => (
            ExitCode::InternalCommunication,
            "runtime_communication_failed",
            "runtime communication failed",
            None,
        ),
        RuntimeClientError::TimedOut => (
            ExitCode::InternalCommunication,
            "runtime_timeout",
            "runtime request timed out",
            None,
        ),
        RuntimeClientError::RunCommunicationFailedAdmissionUnknown(recovery_identity) => (
            ExitCode::InternalCommunication,
            "runtime_communication_failed",
            "runtime communication failed",
            Some(recovery_identity),
        ),
        RuntimeClientError::RunTimedOutAdmissionUnknown(recovery_identity) => (
            ExitCode::InternalCommunication,
            "runtime_timeout",
            "runtime request timed out",
            Some(recovery_identity),
        ),
        RuntimeClientError::InvalidRunModeConfig => (
            ExitCode::InvalidInvocation,
            "invalid_invocation",
            "BROWNIE_CLI_RUN_MODE_ID must be a non-empty bounded mode id using only ASCII letters, digits, '-', '_', '.', or ':'",
            None,
        ),
        RuntimeClientError::InvalidResponse => (
            ExitCode::InternalCommunication,
            "runtime_invalid_response",
            "runtime returned an invalid response",
            None,
        ),
        RuntimeClientError::RuntimeError => (
            ExitCode::InternalCommunication,
            "runtime_error",
            "runtime returned an error",
            None,
        ),
    };

    error_output(exit_code, code, message, json, command, recovery_identity)
}

fn error_output(
    exit_code: ExitCode,
    code: &str,
    message: &str,
    json: bool,
    command: &'static str,
    recovery_identity: Option<RunRecoveryIdentity>,
) -> CliOutput {
    error_output_with_reason(
        exit_code,
        code,
        message,
        json,
        command,
        recovery_identity,
        None,
    )
}

fn error_output_with_reason(
    exit_code: ExitCode,
    code: &str,
    message: &str,
    json: bool,
    command: &'static str,
    recovery_identity: Option<RunRecoveryIdentity>,
    error_reason: Option<&str>,
) -> CliOutput {
    if json {
        let retryable = matches!(code, "runtime_communication_failed" | "runtime_timeout");
        let unknown_run_admission = retryable && command == "run";
        let controller_action = if unknown_run_admission {
            "return_to_supervisor"
        } else if retryable {
            "retry"
        } else {
            "return_to_supervisor"
        };
        let stop_class = if retryable {
            "retryable_failure"
        } else {
            "terminal_failure"
        };
        let next_invocation = if retryable && command == "resume" {
            serde_json::json!({
                "command": "resume",
                "arguments": []
            })
        } else {
            serde_json::Value::Null
        };
        let process_admission_state = if unknown_run_admission {
            "unknown"
        } else {
            "not_applicable"
        };
        let recovery_recommendation = if unknown_run_admission {
            "supervisor_reconcile_or_probe_runtime_state"
        } else if retryable {
            "retry_same_process_invocation"
        } else {
            "return_to_supervisor"
        };
        let recovery_identity_json =
            recovery_identity
                .as_ref()
                .map_or(serde_json::Value::Null, |identity| {
                    serde_json::json!({
                        "session_id": identity.session_id,
                        "drive_id": identity.drive_id,
                        "journey_id": identity.journey_id,
                        "objective_fingerprint": identity.objective_fingerprint,
                    })
                });
        let payload = serde_json::json!({
            "ok": false,
            "command": command,
            "status": code,
            "next_action": controller_action,
            "stop_reason": code,
            "continuation_required": retryable && command == "resume",
            "completed": false,
            "blocked": false,
            "retryable": retryable,
            "terminal_failure": !retryable,
            "controller_action": controller_action,
            "stop_class": stop_class,
            "next_invocation": next_invocation.clone(),
            "process_admission_state": process_admission_state,
            "recovery_recommendation": recovery_recommendation,
            "recovery_identity": recovery_identity_json.clone(),
            "automation": {
                "schema_version": 1,
                "outcome_scope": "process",
                "status": stop_class,
                "class": stop_class,
                "outcome_source": "cli_process",
                "task_id": null,
                "run_id": null,
                "journey_id": null,
                "next_action": controller_action,
                "stop_reason": code,
                "continuation_required": retryable && command == "resume",
                "completed": false,
                "blocked": false,
                "retryable": retryable,
                "terminal_failure": !retryable,
                "controller_action": controller_action,
                "stop_class": stop_class,
                "next_invocation": next_invocation,
                "process_admission_state": process_admission_state,
                "recovery_recommendation": recovery_recommendation,
                "recovery_identity": recovery_identity_json
            },
            "error": {
                "code": code,
                "message": message,
                "reason": error_reason
            },
            "exit_code": exit_code.as_i32()
        });
        return CliOutput {
            exit_code,
            stdout: format!("{payload}\n"),
            stderr: String::new(),
        };
    }

    CliOutput {
        exit_code,
        stdout: String::new(),
        stderr: format!("brownie: {message}\n"),
    }
}

fn command_name(command: &CliCommand) -> &'static str {
    match command {
        CliCommand::Run { .. } => "run",
        CliCommand::RunFile { .. } => "run",
        CliCommand::Resume { .. } => "resume",
        CliCommand::Status => "status",
        CliCommand::Inspect {
            target: InspectTarget::Task { .. },
        } => "inspect task",
        CliCommand::Inspect {
            target: InspectTarget::Run { .. },
        } => "inspect run",
        CliCommand::Inspect {
            target: InspectTarget::Recovery { .. },
        } => "inspect recovery",
        CliCommand::List {
            target: ListTarget::Tasks,
        } => "list tasks",
        CliCommand::Mode {
            target: ModeTarget::List,
        } => "mode list",
        CliCommand::Help { .. } => "help",
        CliCommand::Version => "version",
    }
}

impl From<CliError> for ExitCode {
    fn from(_: CliError) -> Self {
        ExitCode::InvalidInvocation
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::{InspectTarget, ListTarget, ModeTarget};

    #[test]
    fn help_names_run_and_not_develop() {
        let help = Cli::help();
        assert!(help.contains("run <objective>"));
        assert!(help.contains("run --file <path>"));
        assert!(help.contains("help <topic>"));
        assert!(help.contains("resume"));
        assert!(help.contains("status"));
        assert!(!help.contains("develop"));
    }

    #[test]
    fn parses_command_specific_help_without_consuming_run_help_tokens() {
        let help_run = Cli::parse(["brownie", "help", "run"]).unwrap();
        assert_eq!(
            help_run.command,
            CliCommand::Help {
                topic: Some(crate::cli::HelpTopic::Run)
            }
        );

        let run_help_objective = Cli::parse(["brownie", "run", "--help"]).unwrap();
        assert_eq!(
            run_help_objective.command,
            CliCommand::Run {
                objective: "--help".into()
            }
        );
    }

    #[test]
    fn parses_run_file_as_explicit_file_mode() {
        let run_file = Cli::parse(["brownie", "run", "--file", "sample.md"]).unwrap();
        assert_eq!(
            run_file.command,
            CliCommand::RunFile {
                path: "sample.md".into()
            }
        );

        let short_run_file = Cli::parse(["brownie", "run", "-f", "sample.md"]).unwrap();
        assert_eq!(
            short_run_file.command,
            CliCommand::RunFile {
                path: "sample.md".into()
            }
        );

        let error = Cli::parse(["brownie", "run", "--file"]).unwrap_err();
        assert_eq!(error, CliError::MissingValue("file"));
    }

    #[test]
    fn command_help_is_bounded_and_keeps_runtime_authority_boundary() {
        let help = Cli::topic_help(&crate::cli::HelpTopic::Run);
        assert!(help.contains("brownie run <objective>"));
        assert!(help.contains("Rust runtime"));
        assert!(help.contains("--help"));
        assert!(!help.contains("develop"));
        assert!(!help.contains("JSON-RPC"));
    }

    #[test]
    fn unknown_help_topic_uses_invalid_invocation_exit_class() {
        let output = run_cli(["brownie", "--json", "help", "provider"]);
        assert_eq!(output.exit_code, ExitCode::InvalidInvocation);
        assert!(output.stdout.contains("\"code\":\"invalid_invocation\""));
        assert!(output.stdout.contains("\"exit_code\":64"));
        assert!(output.stdout.contains("unknown help topic"));
        assert!(output.stderr.is_empty());
    }

    #[test]
    fn parses_workflow_commands_without_exposing_rpc_names() {
        let run = Cli::parse(["brownie", "run", "summarize this repository"]).unwrap();
        assert_eq!(
            run.command,
            CliCommand::Run {
                objective: "summarize this repository".into()
            }
        );

        let inspect_task = Cli::parse(["brownie", "inspect", "task", "task-1"]).unwrap();
        assert_eq!(
            inspect_task.command,
            CliCommand::Inspect {
                target: InspectTarget::Task {
                    task_id: "task-1".into()
                }
            }
        );

        let list_tasks = Cli::parse(["brownie", "list", "tasks"]).unwrap();
        assert_eq!(
            list_tasks.command,
            CliCommand::List {
                target: ListTarget::Tasks
            }
        );

        let mode_list = Cli::parse(["brownie", "mode", "list"]).unwrap();
        assert_eq!(
            mode_list.command,
            CliCommand::Mode {
                target: ModeTarget::List
            }
        );
    }

    #[test]
    fn run_preserves_objective_tokens_that_look_like_global_options() {
        let json_objective = Cli::parse([
            "brownie", "run", "analyze", "the", "--json", "output", "format",
        ])
        .unwrap();
        assert_eq!(
            json_objective.command,
            CliCommand::Run {
                objective: "analyze the --json output format".into()
            }
        );
        assert!(!json_objective.json);

        let help_objective =
            Cli::parse(["brownie", "run", "explain", "--help", "behavior"]).unwrap();
        assert_eq!(
            help_objective.command,
            CliCommand::Run {
                objective: "explain --help behavior".into()
            }
        );

        let version_objective =
            Cli::parse(["brownie", "run", "compare", "-V", "and", "--version"]).unwrap();
        assert_eq!(
            version_objective.command,
            CliCommand::Run {
                objective: "compare -V and --version".into()
            }
        );
    }

    #[test]
    fn leading_json_is_global_but_run_tail_json_is_objective() {
        let parsed =
            Cli::parse(["brownie", "--json", "run", "analyze", "--json", "output"]).unwrap();
        assert!(parsed.json);
        assert_eq!(
            parsed.command,
            CliCommand::Run {
                objective: "analyze --json output".into()
            }
        );
    }

    #[test]
    fn rejects_develop_as_primary_command() {
        let error = Cli::parse(["brownie", "develop", "change code"]).unwrap_err();
        assert!(error.to_string().contains("unknown command"));
    }

    #[test]
    fn json_unsupported_workflow_uses_same_exit_meaning() {
        let output = run_cli(["brownie", "--json", "resume"]);
        assert_eq!(output.exit_code, ExitCode::RuntimeUnavailable);
        assert!(output.stdout.contains("\"code\":\"runtime_unavailable\""));
        let payload: serde_json::Value = serde_json::from_str(&output.stdout).unwrap();
        assert_eq!(payload["retryable"], false);
        assert_eq!(payload["terminal_failure"], true);
        assert_eq!(payload["controller_action"], "return_to_supervisor");
        assert_eq!(
            payload["automation"]["controller_action"],
            "return_to_supervisor"
        );
        assert_eq!(payload["automation"]["schema_version"], 1);
        assert_eq!(payload["automation"]["outcome_scope"], "process");
        assert!(output.stderr.is_empty());
    }

    #[test]
    fn json_run_transport_timeout_reports_unknown_admission_without_unscoped_resume() {
        let output = runtime_error_output(RuntimeClientError::TimedOut, true, "run");
        assert_eq!(output.exit_code, ExitCode::InternalCommunication);
        let payload: serde_json::Value = serde_json::from_str(&output.stdout).unwrap();
        assert_eq!(payload["command"], "run");
        assert_eq!(payload["status"], "runtime_timeout");
        assert_eq!(payload["retryable"], true);
        assert_eq!(payload["terminal_failure"], false);
        assert_eq!(payload["controller_action"], "return_to_supervisor");
        assert_eq!(payload["continuation_required"], false);
        assert!(payload["next_invocation"].is_null());
        assert_eq!(payload["process_admission_state"], "unknown");
        assert_eq!(
            payload["recovery_recommendation"],
            "supervisor_reconcile_or_probe_runtime_state"
        );
        assert_eq!(payload["automation"]["task_id"], serde_json::Value::Null);
        assert_eq!(payload["automation"]["run_id"], serde_json::Value::Null);
        assert_eq!(payload["automation"]["journey_id"], serde_json::Value::Null);
        assert!(payload["automation"]["next_invocation"].is_null());
        assert_eq!(payload["automation"]["process_admission_state"], "unknown");
    }

    #[test]
    fn json_run_communication_failure_does_not_resume_unrelated_journey() {
        let output = runtime_error_output(RuntimeClientError::CommunicationFailed, true, "run");
        assert_eq!(output.exit_code, ExitCode::InternalCommunication);
        let payload: serde_json::Value = serde_json::from_str(&output.stdout).unwrap();
        assert_eq!(payload["status"], "runtime_communication_failed");
        assert_eq!(payload["retryable"], true);
        assert_eq!(payload["controller_action"], "return_to_supervisor");
        assert_eq!(payload["continuation_required"], false);
        assert!(payload["next_invocation"].is_null());
        assert_eq!(payload["process_admission_state"], "unknown");
        assert_eq!(
            payload["automation"]["recovery_recommendation"],
            "supervisor_reconcile_or_probe_runtime_state"
        );
    }

    #[test]
    fn json_resume_transport_failure_can_retry_scoped_resume_invocation() {
        let output = runtime_error_output(RuntimeClientError::TimedOut, true, "resume");
        assert_eq!(output.exit_code, ExitCode::InternalCommunication);
        let payload: serde_json::Value = serde_json::from_str(&output.stdout).unwrap();
        assert_eq!(payload["command"], "resume");
        assert_eq!(payload["retryable"], true);
        assert_eq!(payload["controller_action"], "retry");
        assert_eq!(payload["continuation_required"], true);
        assert_eq!(payload["next_invocation"]["command"], "resume");
        assert_eq!(
            payload["recovery_recommendation"],
            "retry_same_process_invocation"
        );
        assert_eq!(payload["process_admission_state"], "not_applicable");
    }

    #[test]
    fn json_invalid_invocation_stays_bounded() {
        let output = run_cli(["brownie", "--json", "inspect", "task"]);
        assert_eq!(output.exit_code, ExitCode::InvalidInvocation);
        assert!(output.stdout.contains("\"code\":\"invalid_invocation\""));
        assert!(output.stdout.contains("\"exit_code\":64"));
        let payload: serde_json::Value = serde_json::from_str(&output.stdout).unwrap();
        assert_eq!(payload["retryable"], false);
        assert_eq!(payload["stop_class"], "terminal_failure");
        assert!(output.stderr.is_empty());
    }
}
