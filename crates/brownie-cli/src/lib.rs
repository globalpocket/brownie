pub mod cli;
pub mod runtime_client;

use cli::{Cli, CliCommand, CliError};
use runtime_client::{RuntimeClient, RuntimeClientError};

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
        command => {
            let client = RuntimeClient::default();
            match client.invoke(&command, cli.json) {
                Ok(message) => CliOutput {
                    exit_code: ExitCode::Success,
                    stdout: message,
                    stderr: String::new(),
                },
                Err(error) => runtime_error_output(error, cli.json),
            }
        }
    }
}

fn runtime_error_output(error: RuntimeClientError, json: bool) -> CliOutput {
    let (exit_code, code, message) = match error {
        RuntimeClientError::RuntimeUnavailable => (
            ExitCode::RuntimeUnavailable,
            "runtime_unavailable",
            "runtime binary is unavailable",
        ),
        RuntimeClientError::UnsupportedCommand => (
            ExitCode::RuntimeUnavailable,
            "runtime_unavailable",
            "runtime command is not implemented in this CLI slice",
        ),
        RuntimeClientError::CommunicationFailed => (
            ExitCode::InternalCommunication,
            "runtime_communication_failed",
            "runtime communication failed",
        ),
        RuntimeClientError::TimedOut => (
            ExitCode::InternalCommunication,
            "runtime_timeout",
            "runtime request timed out",
        ),
        RuntimeClientError::InvalidResponse => (
            ExitCode::InternalCommunication,
            "runtime_invalid_response",
            "runtime returned an invalid response",
        ),
        RuntimeClientError::RuntimeError => (
            ExitCode::InternalCommunication,
            "runtime_error",
            "runtime returned an error",
        ),
    };

    error_output(exit_code, code, message, json)
}

fn error_output(exit_code: ExitCode, code: &str, message: &str, json: bool) -> CliOutput {
    if json {
        let payload = serde_json::json!({
            "ok": false,
            "error": {
                "code": code,
                "message": message
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
        assert!(output.stderr.is_empty());
    }

    #[test]
    fn json_invalid_invocation_stays_bounded() {
        let output = run_cli(["brownie", "--json", "inspect", "task"]);
        assert_eq!(output.exit_code, ExitCode::InvalidInvocation);
        assert!(output.stdout.contains("\"code\":\"invalid_invocation\""));
        assert!(output.stdout.contains("\"exit_code\":64"));
        assert!(output.stderr.is_empty());
    }
}
