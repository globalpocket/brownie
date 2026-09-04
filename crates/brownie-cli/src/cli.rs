use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Cli {
    pub json: bool,
    pub command: CliCommand,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CliCommand {
    Help { topic: Option<HelpTopic> },
    Version,
    Run { objective: String },
    Resume { scope: Option<ResumeScope> },
    Status,
    Inspect { target: InspectTarget },
    List { target: ListTarget },
    Mode { target: ModeTarget },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResumeScope {
    pub session_id: String,
    pub journey_id: String,
    pub task_id: String,
    pub run_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HelpTopic {
    Run,
    Resume,
    Status,
    Inspect,
    List,
    Mode,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InspectTarget {
    Task {
        task_id: String,
    },
    Run {
        run_id: String,
    },
    Recovery {
        session_id: String,
        drive_id: String,
        journey_id: String,
        objective_fingerprint: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ListTarget {
    Tasks,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ModeTarget {
    List,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CliError {
    MissingValue(&'static str),
    UnknownCommand(String),
    InvalidCommand(String),
}

impl Cli {
    pub fn parse<I, S>(args: I) -> Result<Self, CliError>
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        let mut args: Vec<String> = args.into_iter().map(Into::into).collect();
        if !args.is_empty() {
            args.remove(0);
        }

        let mut json = false;
        let mut command_index = 0;
        while command_index < args.len() {
            match args[command_index].as_str() {
                "--json" => {
                    json = true;
                    command_index += 1;
                }
                "-h" | "--help" => {
                    return Ok(Self {
                        json,
                        command: CliCommand::Help { topic: None },
                    });
                }
                "-V" | "--version" => {
                    return Ok(Self {
                        json,
                        command: CliCommand::Version,
                    });
                }
                _ => break,
            }
        }

        let args = &args[command_index..];
        let Some(command) = args.first().map(String::as_str) else {
            return Ok(Self {
                json,
                command: CliCommand::Help { topic: None },
            });
        };

        let command = match command {
            "help" => parse_help(&args[1..])?,
            "run" => {
                let objective = join_required_tail(&args[1..], "objective")?;
                CliCommand::Run { objective }
            }
            "resume" => parse_resume(&args[1..])?,
            "status" => no_args(args, CliCommand::Status)?,
            "inspect" => parse_inspect(&args[1..])?,
            "list" => parse_list(&args[1..])?,
            "mode" => parse_mode(&args[1..])?,
            other => return Err(CliError::UnknownCommand(other.to_string())),
        };

        Ok(Self { json, command })
    }

    pub fn help() -> String {
        [
            "Brownie CLI",
            "",
            "Usage:",
            "  brownie [--json] <command>",
            "  brownie help <topic>",
            "",
            "Commands:",
            "  help <topic>             Show command-specific help",
            "  run <objective>          Run a general autonomous objective",
            "  resume                   Resume the latest interrupted objective",
            "  status                   Show current runtime status",
            "  inspect task <task-id>   Inspect a task",
            "  inspect run <run-id>     Inspect a run",
            "  inspect recovery <session-id> <drive-id> <journey-id> <objective-fingerprint>",
            "  list tasks               List tasks",
            "  mode list                List available modes",
            "",
            "Options:",
            "  --json                   Emit bounded machine-readable output for external loops",
            "  -h, --help               Show help",
            "  -V, --version            Show version",
            "",
            "Help topics:",
            "  run, resume, status, inspect, list, mode",
            "",
        ]
        .join("\n")
    }

    pub fn topic_help(topic: &HelpTopic) -> String {
        match topic {
            HelpTopic::Run => [
                "brownie run",
                "",
                "Usage:",
                "  brownie run <objective>",
                "  brownie --json run <objective>",
                "",
                "Runs one general autonomous objective through the Rust runtime.",
                "The objective is free text. Tokens after run, including --help, -V, --version, and --json, remain part of the objective.",
                "Set BROWNIE_CLI_RUN_MODE_ID to request a specific runtime mode for the admitted task.",
                "For strict OpenAI-compatible provider runs, use BROWNIE_CLI_RUN_MODE_ID=provider-runner together with BROWNIE_LLM_ALLOW_TASK_RUN_NETWORK=true.",
                "One invocation performs bounded progress, persists through the runtime, and exits.",
                "JSON output includes an automation object and controller_action for external loops.",
                "",
                "Examples:",
                "  brownie run \"summarize this repository\"",
                "  BROWNIE_CLI_RUN_MODE_ID=provider-runner brownie run \"Hello\"",
                "  brownie --json run \"inspect the current task state\"",
                "",
                "Boundary:",
                "  The CLI invokes runtime-owned headless execution. It does not select tasks, apply workspace changes, or own runtime policy.",
                "",
            ]
            .join("\n"),
            HelpTopic::Resume => [
                "brownie resume",
                "",
                "Usage:",
                "  brownie resume",
                "  brownie resume --session-id <session-id> --journey-id <journey-id> --task-id <task-id> --run-id <run-id>",
                "  brownie --json resume",
                "",
                "Asks the Rust runtime to continue the latest eligible CLI-created objective once.",
                "Scoped resume is emitted by recovery inspection after persisted journey identity is confirmed.",
                "One invocation performs bounded progress, persists through the runtime, and exits.",
                "JSON output includes an automation object and controller_action for external loops.",
                "",
                "Boundary:",
                "  Resume scope, freshness, replay, and next-action decisions remain runtime-owned.",
                "",
            ]
            .join("\n"),
            HelpTopic::Status => [
                "brownie status",
                "",
                "Usage:",
                "  brownie status",
                "  brownie --json status",
                "",
                "Shows the current Rust runtime status using a bounded read-only request.",
                "",
                "Boundary:",
                "  The CLI starts no agent loop for status and does not inspect ledgers directly.",
                "",
            ]
            .join("\n"),
            HelpTopic::Inspect => [
                "brownie inspect",
                "",
                "Usage:",
                "  brownie inspect task <task-id>",
                "  brownie inspect run <run-id>",
                "  brownie inspect recovery <session-id> <drive-id> <journey-id> <objective-fingerprint>",
                "  brownie --json inspect task <task-id>",
                "  brownie --json inspect run <run-id>",
                "  brownie --json inspect recovery <session-id> <drive-id> <journey-id> <objective-fingerprint>",
                "",
                "Inspects bounded task, run, or run-recovery state through fixed runtime methods.",
                "",
                "Boundary:",
                "  The CLI renders runtime-provided summaries and does not read raw ledger files.",
                "",
            ]
            .join("\n"),
            HelpTopic::List => [
                "brownie list",
                "",
                "Usage:",
                "  brownie list tasks",
                "  brownie --json list tasks",
                "",
                "Lists bounded runtime-owned task progress and next-action summaries.",
                "",
                "Boundary:",
                "  The CLI does not rank or select continuation candidates as policy.",
                "",
            ]
            .join("\n"),
            HelpTopic::Mode => [
                "brownie mode",
                "",
                "Usage:",
                "  brownie mode list",
                "  brownie --json mode list",
                "",
                "Lists bounded runtime-owned mode summaries.",
                "",
                "Boundary:",
                "  Mode Pack loading, validation, compilation, and permission policy remain in the Rust runtime.",
                "",
            ]
            .join("\n"),
        }
    }
}

fn join_required_tail(values: &[String], name: &'static str) -> Result<String, CliError> {
    let value = values.join(" ").trim().to_string();
    if value.is_empty() {
        return Err(CliError::MissingValue(name));
    }
    Ok(value)
}

fn no_args(args: &[String], command: CliCommand) -> Result<CliCommand, CliError> {
    if args.len() == 1 {
        Ok(command)
    } else {
        Err(CliError::InvalidCommand(format!(
            "{} does not accept extra arguments",
            args[0]
        )))
    }
}

fn parse_resume(args: &[String]) -> Result<CliCommand, CliError> {
    match args {
        [] => Ok(CliCommand::Resume { scope: None }),
        [session_flag, session_id, journey_flag, journey_id, task_flag, task_id, run_flag, run_id]
            if session_flag == "--session-id"
                && journey_flag == "--journey-id"
                && task_flag == "--task-id"
                && run_flag == "--run-id"
                && !session_id.trim().is_empty()
                && !journey_id.trim().is_empty()
                && !task_id.trim().is_empty()
                && !run_id.trim().is_empty() =>
        {
            Ok(CliCommand::Resume {
                scope: Some(ResumeScope {
                    session_id: session_id.to_string(),
                    journey_id: journey_id.to_string(),
                    task_id: task_id.to_string(),
                    run_id: run_id.to_string(),
                }),
            })
        }
        _ => Err(CliError::InvalidCommand(
            "resume expects no arguments or a complete recovery scope".to_string(),
        )),
    }
}

fn parse_help(args: &[String]) -> Result<CliCommand, CliError> {
    match args {
        [] => Ok(CliCommand::Help { topic: None }),
        [topic] => {
            let topic = match topic.as_str() {
                "run" => HelpTopic::Run,
                "resume" => HelpTopic::Resume,
                "status" => HelpTopic::Status,
                "inspect" => HelpTopic::Inspect,
                "list" => HelpTopic::List,
                "mode" => HelpTopic::Mode,
                other => {
                    return Err(CliError::InvalidCommand(format!(
                        "unknown help topic: {other}"
                    )))
                }
            };
            Ok(CliCommand::Help { topic: Some(topic) })
        }
        _ => Err(CliError::InvalidCommand(
            "help expects at most one topic".to_string(),
        )),
    }
}

fn parse_inspect(args: &[String]) -> Result<CliCommand, CliError> {
    match args {
        [kind, id] if kind == "task" && !id.trim().is_empty() => Ok(CliCommand::Inspect {
            target: InspectTarget::Task {
                task_id: id.to_string(),
            },
        }),
        [kind, id] if kind == "run" && !id.trim().is_empty() => Ok(CliCommand::Inspect {
            target: InspectTarget::Run {
                run_id: id.to_string(),
            },
        }),
        [kind, session_id, drive_id, journey_id, objective_fingerprint]
            if kind == "recovery"
                && !session_id.trim().is_empty()
                && !drive_id.trim().is_empty()
                && !journey_id.trim().is_empty()
                && !objective_fingerprint.trim().is_empty() =>
        {
            Ok(CliCommand::Inspect {
                target: InspectTarget::Recovery {
                    session_id: session_id.to_string(),
                    drive_id: drive_id.to_string(),
                    journey_id: journey_id.to_string(),
                    objective_fingerprint: objective_fingerprint.to_string(),
                },
            })
        }
        [kind] if kind == "task" => Err(CliError::MissingValue("task-id")),
        [kind] if kind == "run" => Err(CliError::MissingValue("run-id")),
        [kind] if kind == "recovery" => Err(CliError::MissingValue("recovery-identity")),
        _ => Err(CliError::InvalidCommand(
            "inspect expects task <task-id>, run <run-id>, or recovery <session-id> <drive-id> <journey-id> <objective-fingerprint>".to_string(),
        )),
    }
}

fn parse_list(args: &[String]) -> Result<CliCommand, CliError> {
    match args {
        [target] if target == "tasks" => Ok(CliCommand::List {
            target: ListTarget::Tasks,
        }),
        _ => Err(CliError::InvalidCommand("list expects tasks".to_string())),
    }
}

fn parse_mode(args: &[String]) -> Result<CliCommand, CliError> {
    match args {
        [target] if target == "list" => Ok(CliCommand::Mode {
            target: ModeTarget::List,
        }),
        _ => Err(CliError::InvalidCommand("mode expects list".to_string())),
    }
}

impl fmt::Display for CliError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CliError::MissingValue(name) => write!(formatter, "missing {name}"),
            CliError::UnknownCommand(command) => write!(formatter, "unknown command: {command}"),
            CliError::InvalidCommand(message) => write!(formatter, "invalid command: {message}"),
        }
    }
}

impl std::error::Error for CliError {}
