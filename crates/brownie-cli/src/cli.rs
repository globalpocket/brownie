use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Cli {
    pub json: bool,
    pub command: CliCommand,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CliCommand {
    Help,
    Version,
    Run { objective: String },
    Resume,
    Status,
    Inspect { target: InspectTarget },
    List { target: ListTarget },
    Mode { target: ModeTarget },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InspectTarget {
    Task { task_id: String },
    Run { run_id: String },
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
        let mut index = 0;
        while index < args.len() {
            match args[index].as_str() {
                "--json" => {
                    json = true;
                    args.remove(index);
                }
                "-h" | "--help" => {
                    return Ok(Self {
                        json,
                        command: CliCommand::Help,
                    });
                }
                "-V" | "--version" => {
                    return Ok(Self {
                        json,
                        command: CliCommand::Version,
                    });
                }
                _ => index += 1,
            }
        }

        let Some(command) = args.first().map(String::as_str) else {
            return Ok(Self {
                json,
                command: CliCommand::Help,
            });
        };

        let command = match command {
            "run" => {
                let objective = join_required_tail(&args[1..], "objective")?;
                CliCommand::Run { objective }
            }
            "resume" => no_args(&args, CliCommand::Resume)?,
            "status" => no_args(&args, CliCommand::Status)?,
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
            "",
            "Commands:",
            "  run <objective>          Run a general autonomous objective",
            "  resume                   Resume the latest interrupted objective",
            "  status                   Show current runtime status",
            "  inspect task <task-id>   Inspect a task",
            "  inspect run <run-id>     Inspect a run",
            "  list tasks               List tasks",
            "  mode list                List available modes",
            "",
            "Options:",
            "  --json                   Emit bounded machine-readable output",
            "  -h, --help               Show help",
            "  -V, --version            Show version",
            "",
        ]
        .join("\n")
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
        [kind] if kind == "task" => Err(CliError::MissingValue("task-id")),
        [kind] if kind == "run" => Err(CliError::MissingValue("run-id")),
        _ => Err(CliError::InvalidCommand(
            "inspect expects task <task-id> or run <run-id>".to_string(),
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
