//! Context materialization and sliding window truncation crate.

use brownie_protocol::TaskRecord;
use brownie_store::{LedgerEvent, LedgerEventKind};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContextRegion {
    Protected,
    Recent,
    Truncatable,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum PromptRole {
    System,
    User,
    Assistant,
    Tool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PromptMessage {
    pub role: PromptRole,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PromptView {
    pub messages: Vec<PromptMessage>,
}

pub const MAX_LEDGER_CONTEXT_EVENTS: usize = 12;
pub const DEFAULT_MAX_SELECTED_INDEX_CONTEXT_CHARS: usize = usize::MAX;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContextWindowSummary {
    pub total_events: usize,
    pub included_events: usize,
    pub omitted_events: usize,
    pub max_events: usize,
    pub first_included_event: Option<String>,
    pub last_included_event: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ContextBudget {
    pub max_prompt_chars: usize,
    pub max_ledger_events: usize,
    pub max_selected_index_chars: usize,
}

impl ContextBudget {
    pub fn default_for_prompt(max_prompt_chars: usize) -> Self {
        Self {
            max_prompt_chars,
            max_ledger_events: MAX_LEDGER_CONTEXT_EVENTS,
            max_selected_index_chars: DEFAULT_MAX_SELECTED_INDEX_CONTEXT_CHARS,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContextBudgetSummary {
    pub requested: bool,
    pub max_prompt_chars: usize,
    pub max_ledger_events: usize,
    pub max_selected_index_chars: usize,
    pub total_events: usize,
    pub included_events: usize,
    pub omitted_events: usize,
    pub selected_index_context_present: bool,
    pub selected_index_content_chars: usize,
    pub selected_index_materialized_chars: usize,
    pub selected_index_truncated: bool,
    pub protected_context_chars: usize,
    pub prompt_chars: usize,
    pub prompt_within_budget: bool,
}

impl ContextBudgetSummary {
    pub fn unrequested(
        context_window: &ContextWindowSummary,
        selected_index_context: Option<&SelectedIndexPromptContext>,
        max_prompt_chars: usize,
    ) -> Self {
        let (
            selected_index_context_present,
            selected_index_content_chars,
            selected_index_materialized_chars,
            selected_index_truncated,
        ) = selected_index_context
            .map(|context| {
                (
                    true,
                    context.content_char_count,
                    context.materialized_content_char_count,
                    context.content_truncated_for_prompt,
                )
            })
            .unwrap_or((false, 0, 0, false));
        Self {
            requested: false,
            max_prompt_chars,
            max_ledger_events: context_window.max_events,
            max_selected_index_chars: DEFAULT_MAX_SELECTED_INDEX_CONTEXT_CHARS,
            total_events: context_window.total_events,
            included_events: context_window.included_events,
            omitted_events: context_window.omitted_events,
            selected_index_context_present,
            selected_index_content_chars,
            selected_index_materialized_chars,
            selected_index_truncated,
            protected_context_chars: 0,
            prompt_chars: 0,
            prompt_within_budget: true,
        }
    }
}

impl ContextWindowSummary {
    pub fn empty() -> Self {
        Self {
            total_events: 0,
            included_events: 0,
            omitted_events: 0,
            max_events: MAX_LEDGER_CONTEXT_EVENTS,
            first_included_event: None,
            last_included_event: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PromptBuildInput {
    pub task_id: String,
    pub run_id: String,
    pub goal: String,
    pub mode_id: Option<String>,
    pub mode_policy_summary: Option<String>,
    pub mode_instruction_material: Option<String>,
    pub permission_summary: Vec<String>,
    pub tool_plan_summary: Vec<String>,
    pub tool_intent_summary: Vec<String>,
    pub tool_execution_summary: Vec<String>,
    pub subtask_orchestration_summary: Vec<String>,
    pub verification_recovery_diagnostics_summary: Vec<String>,
    #[serde(default, skip_serializing, skip_deserializing)]
    pub selected_index_context: Option<SelectedIndexPromptContext>,
    #[serde(default, skip_serializing, skip_deserializing)]
    pub verification_recovery_context: Option<VerificationRecoveryContextPromptContext>,
    pub context_window: ContextWindowSummary,
    pub context_budget: ContextBudgetSummary,
    pub ledger_summary: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SelectedIndexPromptContext {
    pub prompt_context_id: String,
    pub source_event_id: String,
    pub query_id: String,
    pub selection_id: String,
    pub selection_fingerprint: String,
    pub snapshot_fingerprint: String,
    pub path: String,
    pub file_kind: String,
    pub bytes_read: usize,
    pub content_char_count: usize,
    pub materialized_content_char_count: usize,
    pub content_truncated_for_prompt: bool,
    pub content_sha256: String,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerificationRecoveryContextPromptContext {
    pub context_read_id: String,
    pub source_task_id: String,
    pub source_run_id: String,
    pub recovery_task_id: String,
    pub recovery_run_id: String,
    pub failure_fingerprint: String,
    pub diagnostic_index: usize,
    pub tool_id: String,
    pub check_id: String,
    pub diagnostic_kind: String,
    pub read_path_fingerprint: String,
    pub line: Option<usize>,
    pub column: Option<usize>,
    pub excerpt_start_line: usize,
    pub excerpt_end_line: usize,
    pub excerpt_bytes: usize,
    pub excerpt_sha256: String,
    pub excerpt_truncated: bool,
    pub excerpt: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContextMaterializerInput {
    pub task: TaskRecord,
    pub ledger_events: Vec<LedgerEvent>,
    pub child_completion_summaries: Vec<String>,
    pub selected_index_context: Option<SelectedIndexPromptContext>,
    pub verification_recovery_context: Option<VerificationRecoveryContextPromptContext>,
    pub context_budget: Option<ContextBudget>,
}

pub struct ContextMaterializer;

impl ContextMaterializer {
    pub fn materialize(input: ContextMaterializerInput) -> PromptBuildInput {
        let mode_resolved_payload = input
            .ledger_events
            .iter()
            .rev()
            .find(|event| event.kind == LedgerEventKind::ModeResolved)
            .and_then(|event| event.payload.as_ref());
        let mode_policy_summary = mode_resolved_payload
            .map(format_mode_policy_summary)
            .unwrap_or_else(|| {
                "Mode Policy:
<unresolved>"
                    .to_string()
            });
        let mode_instruction_material = mode_resolved_payload
            .map(format_mode_instruction_material)
            .unwrap_or_else(|| "Mode Instructions:\n<unresolved>".to_string());

        let permission_summary = format_permission_summary(&input.ledger_events);
        let tool_plan_summary = format_tool_plan_summary(&input.ledger_events);
        let tool_intent_summary = format_tool_intent_summary(&input.ledger_events);
        let tool_execution_summary = format_tool_execution_summary(&input.ledger_events);
        let mut subtask_orchestration_summary = input.child_completion_summaries;
        subtask_orchestration_summary
            .extend(format_subtask_orchestration_summary(&input.ledger_events));
        let verification_recovery_diagnostics_summary =
            format_verification_recovery_diagnostics_summary(&input.task);
        let budget = input
            .context_budget
            .unwrap_or_else(|| ContextBudget::default_for_prompt(usize::MAX));
        let (ledger_summary, context_window) =
            format_ledger_context_window(&input.ledger_events, budget.max_ledger_events);
        let selected_index_context = input.selected_index_context.map(|context| {
            materialize_selected_index_context(context, budget.max_selected_index_chars)
        });
        let verification_recovery_context = input.verification_recovery_context;

        let mut prompt_input = PromptBuildInput {
            task_id: input.task.task_id,
            run_id: input.task.run_id,
            goal: input.task.goal,
            mode_id: input.task.mode_id,
            mode_policy_summary: Some(mode_policy_summary),
            mode_instruction_material: Some(mode_instruction_material),
            permission_summary,
            tool_plan_summary,
            tool_intent_summary,
            tool_execution_summary,
            subtask_orchestration_summary,
            verification_recovery_diagnostics_summary,
            selected_index_context,
            verification_recovery_context,
            context_window,
            context_budget: ContextBudgetSummary {
                requested: input.context_budget.is_some(),
                max_prompt_chars: budget.max_prompt_chars,
                max_ledger_events: budget.max_ledger_events,
                max_selected_index_chars: budget.max_selected_index_chars,
                total_events: 0,
                included_events: 0,
                omitted_events: 0,
                selected_index_context_present: false,
                selected_index_content_chars: 0,
                selected_index_materialized_chars: 0,
                selected_index_truncated: false,
                protected_context_chars: 0,
                prompt_chars: 0,
                prompt_within_budget: true,
            },
            ledger_summary,
        };
        prompt_input.context_budget.total_events = prompt_input.context_window.total_events;
        prompt_input.context_budget.included_events = prompt_input.context_window.included_events;
        prompt_input.context_budget.omitted_events = prompt_input.context_window.omitted_events;
        if let Some(context) = prompt_input.selected_index_context.as_ref() {
            prompt_input.context_budget.selected_index_context_present = true;
            prompt_input.context_budget.selected_index_content_chars = context.content_char_count;
            prompt_input
                .context_budget
                .selected_index_materialized_chars = context.materialized_content_char_count;
            prompt_input.context_budget.selected_index_truncated =
                context.content_truncated_for_prompt;
        }
        let mut prompt = PromptBuilder::build(prompt_input.clone());
        while prompt_char_count(&prompt) > budget.max_prompt_chars
            && !prompt_input.ledger_summary.is_empty()
        {
            prompt_input.ledger_summary.remove(0);
            prompt_input.context_window.omitted_events += 1;
            prompt_input.context_window.included_events = prompt_input.ledger_summary.len();
            prompt_input.context_window.first_included_event =
                prompt_input.ledger_summary.first().cloned();
            prompt_input.context_window.last_included_event =
                prompt_input.ledger_summary.last().cloned();
            prompt = PromptBuilder::build(prompt_input.clone());
        }
        prompt_input.context_budget.prompt_chars = prompt_char_count(&prompt);
        prompt_input.context_budget.protected_context_chars = protected_prompt_char_count(&prompt);
        prompt_input.context_budget.prompt_within_budget =
            prompt_input.context_budget.prompt_chars <= budget.max_prompt_chars;
        prompt_input
    }
}

fn format_ledger_context_window(
    events: &[LedgerEvent],
    max_events: usize,
) -> (Vec<String>, ContextWindowSummary) {
    let total_events = events.len();
    let start = total_events.saturating_sub(max_events);
    let included = &events[start..];
    let ledger_summary = included
        .iter()
        .map(|event| format!("{:?}", event.kind))
        .collect::<Vec<_>>();
    let first_included_event = ledger_summary.first().cloned();
    let last_included_event = ledger_summary.last().cloned();
    (
        ledger_summary,
        ContextWindowSummary {
            total_events,
            included_events: included.len(),
            omitted_events: start,
            max_events,
            first_included_event,
            last_included_event,
        },
    )
}

fn materialize_selected_index_context(
    mut context: SelectedIndexPromptContext,
    max_selected_index_chars: usize,
) -> SelectedIndexPromptContext {
    context.content_char_count = context.content.chars().count();
    if context.content_char_count > max_selected_index_chars {
        context.content = context
            .content
            .chars()
            .take(max_selected_index_chars)
            .collect();
        context.content_truncated_for_prompt = true;
    }
    context.materialized_content_char_count = context.content.chars().count();
    context
}

fn format_mode_policy_summary(payload: &serde_json::Value) -> String {
    let mode_id = payload
        .get("mode_id")
        .and_then(|value| value.as_str())
        .unwrap_or("<unknown>");
    let permissions = payload.get("permissions");
    let permission_bool = |name: &str| {
        permissions
            .and_then(|value| value.get(name))
            .and_then(|value| value.as_bool())
            .map(|value| value.to_string())
            .unwrap_or_else(|| "<unknown>".to_string())
    };
    let workspace_write_scopes = payload
        .get("workspace_write_scopes")
        .and_then(|value| value.as_array())
        .map(|scopes| {
            scopes
                .iter()
                .filter_map(format_workspace_write_scope)
                .collect::<Vec<_>>()
                .join("\n")
        })
        .filter(|scopes| !scopes.is_empty())
        .unwrap_or_else(|| "- <none>".to_string());
    let allowed_handoff_targets = payload
        .get("allowed_handoff_targets")
        .and_then(|value| value.as_array())
        .map(|targets| {
            targets
                .iter()
                .filter_map(|target| target.as_str().map(|target| format!("- {target}")))
                .collect::<Vec<_>>()
                .join("\n")
        })
        .filter(|targets| !targets.is_empty())
        .unwrap_or_else(|| "- <none>".to_string());
    let mcp_tool_catalogs = payload
        .get("mcp_tool_catalogs")
        .and_then(|value| value.as_array())
        .map(|catalogs| {
            catalogs
                .iter()
                .filter_map(format_mcp_tool_catalog)
                .collect::<Vec<_>>()
                .join("\n")
        })
        .filter(|catalogs| !catalogs.is_empty())
        .unwrap_or_else(|| "- <none>".to_string());

    format!(
        "Mode Policy:
mode_id: {mode_id}
workspace_write: {}
workspace_write_scopes:
{workspace_write_scopes}
process_exec: {}
can_spawn_subtasks: {}
allowed_handoff_targets:
{allowed_handoff_targets}
codebase_index: {}
network_access: {}
service_control: {}
destructive: {}
read_only: {}
mcp_tool_access: {}
mcp_tool_catalogs:
{mcp_tool_catalogs}",
        permission_bool("workspace_write"),
        permission_bool("process_exec"),
        permission_bool("can_spawn_subtasks"),
        permission_bool("codebase_index"),
        permission_bool("network_access"),
        permission_bool("service_control"),
        permission_bool("destructive"),
        permission_bool("read_only"),
        permission_bool("mcp_tool_access")
    )
}

fn format_workspace_write_scope(scope: &serde_json::Value) -> Option<String> {
    let file_regex = scope.get("file_regex")?.as_str()?;
    let description = scope
        .get("description")
        .and_then(|value| value.as_str())
        .unwrap_or("<none>");
    Some(format!(
        "- file_regex: {file_regex}\n  description: {description}"
    ))
}

fn format_mcp_tool_catalog(catalog: &serde_json::Value) -> Option<String> {
    let server_id = catalog.get("server_id")?.as_str()?;
    let protocol_version = catalog.get("protocol_version")?.as_str()?;
    let config_fingerprint = catalog
        .get("server_config_identity_fingerprint")?
        .as_str()?;
    let catalog_fingerprint = catalog.get("catalog_fingerprint")?.as_str()?;
    let tools = catalog
        .get("tools")?
        .as_array()?
        .iter()
        .filter_map(format_mcp_tool_catalog_entry)
        .collect::<Vec<_>>()
        .join("\n");
    Some(format!(
        "- server_id: {server_id}\n  protocol_version: {protocol_version}\n  server_config_identity_fingerprint: {config_fingerprint}\n  catalog_fingerprint: {catalog_fingerprint}\n  tools:\n{tools}"
    ))
}

fn format_mcp_tool_catalog_entry(tool: &serde_json::Value) -> Option<String> {
    let tool_id = tool.get("tool_id")?.as_str()?;
    let description = tool
        .get("description")
        .and_then(|value| value.as_str())
        .unwrap_or("<none>");
    let input_schema_fingerprint = tool.get("input_schema_fingerprint")?.as_str()?;
    let output_schema_fingerprint = tool
        .get("output_schema_fingerprint")
        .and_then(|value| value.as_str())
        .unwrap_or("<none>");
    let input_schema_summary = tool
        .get("input_schema_summary")
        .and_then(|value| value.as_array())
        .map(|fields| {
            fields
                .iter()
                .filter_map(format_mcp_input_schema_field)
                .collect::<Vec<_>>()
                .join("\n")
        })
        .filter(|fields| !fields.is_empty())
        .unwrap_or_else(|| "    - <none>".to_string());
    Some(format!(
        "  - tool_id: {tool_id}\n    description: {description}\n    input_schema_fingerprint: {input_schema_fingerprint}\n    output_schema_fingerprint: {output_schema_fingerprint}\n    input_schema_summary:\n{input_schema_summary}"
    ))
}

fn format_mcp_input_schema_field(field: &serde_json::Value) -> Option<String> {
    let name = field.get("name")?.as_str()?;
    let value_type = field.get("type")?.as_str()?;
    let required = field
        .get("required")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    Some(format!(
        "    - name: {name}\n      type: {value_type}\n      required: {required}"
    ))
}

fn format_mode_instruction_material(payload: &serde_json::Value) -> String {
    let mode_id = payload
        .get("mode_id")
        .and_then(|value| value.as_str())
        .unwrap_or("<unknown>");
    let display_name = payload
        .get("display_name")
        .and_then(|value| value.as_str())
        .unwrap_or("<unknown>");
    let role_definition = payload
        .get("role_definition")
        .and_then(|value| value.as_str())
        .unwrap_or("<missing>");
    let when_to_use = payload
        .get("when_to_use")
        .and_then(|value| value.as_str())
        .unwrap_or("<none>");
    let description = payload
        .get("description")
        .and_then(|value| value.as_str())
        .unwrap_or("<none>");
    let verification_responsibility = payload
        .get("verification_responsibility")
        .and_then(|value| value.as_str())
        .unwrap_or("<none>");
    let instruction_fingerprint = payload
        .get("instruction_fingerprint")
        .and_then(|value| value.as_str())
        .unwrap_or("<none>");
    let prompt_sections = payload
        .get("prompt_sections")
        .and_then(|value| value.as_array())
        .map(|sections| {
            sections
                .iter()
                .filter_map(format_prompt_section)
                .collect::<Vec<_>>()
                .join("\n")
        })
        .filter(|sections| !sections.is_empty())
        .unwrap_or_else(|| "- <none>".to_string());
    let global_policy_artifacts = payload
        .get("external_modepack_task_provenance")
        .and_then(|value| value.get("global_policy_artifacts"))
        .and_then(|value| value.as_array())
        .map(|artifacts| {
            artifacts
                .iter()
                .filter_map(format_global_policy_artifact)
                .collect::<Vec<_>>()
                .join("\n")
        })
        .filter(|artifacts| !artifacts.is_empty())
        .unwrap_or_else(|| "- <none>".to_string());
    let completion_rules = payload
        .get("completion_rules")
        .and_then(|value| value.as_array())
        .map(|rules| {
            rules
                .iter()
                .filter_map(|rule| rule.as_str().map(|rule| format!("- {rule}")))
                .collect::<Vec<_>>()
                .join("\n")
        })
        .filter(|rules| !rules.is_empty())
        .unwrap_or_else(|| "- <none>".to_string());

    format!(
        "Mode Instructions:
mode_id: {mode_id}
display_name: {display_name}
role_definition: {role_definition}
when_to_use: {when_to_use}
description: {description}
verification_responsibility: {verification_responsibility}
instruction_fingerprint: {instruction_fingerprint}
prompt_sections:
{prompt_sections}
global_policy_artifacts:
{global_policy_artifacts}
completion_rules:
{completion_rules}"
    )
}

fn format_prompt_section(section: &serde_json::Value) -> Option<String> {
    let title = section.get("title")?.as_str()?;
    let source = section.get("source")?.as_str()?;
    let fingerprint = section.get("content_fingerprint")?.as_str()?;
    let content = section.get("content")?.as_str()?;
    Some(format!(
        "- title: {title}\n  source: {source}\n  content_fingerprint: {fingerprint}\n  content:\n{content}"
    ))
}

fn format_global_policy_artifact(artifact: &serde_json::Value) -> Option<String> {
    let category = artifact.get("category")?.as_str()?;
    if category != "rule" {
        return None;
    }
    let relative_path = artifact.get("relative_path")?.as_str()?;
    let title = artifact.get("title")?.as_str()?;
    let fingerprint = artifact.get("content_fingerprint")?.as_str()?;
    let content = artifact.get("content")?.as_str()?;
    Some(format!(
        "- category: {category}\n  relative_path: {relative_path}\n  title: {title}\n  content_fingerprint: {fingerprint}\n  content:\n{content}"
    ))
}

fn format_permission_summary(events: &[LedgerEvent]) -> Vec<String> {
    events
        .iter()
        .filter(|event| event.kind == LedgerEventKind::PermissionChecked)
        .filter_map(|event| {
            let payload = event.payload.as_ref()?;
            let action = payload.get("action")?.as_str()?;
            let allowed = payload.get("allowed")?.as_bool()?;
            let status = if allowed { "allowed" } else { "denied" };
            Some(format!("{action}: {status}"))
        })
        .collect()
}

fn format_tool_plan_summary(events: &[LedgerEvent]) -> Vec<String> {
    events
        .iter()
        .filter(|event| event.kind == LedgerEventKind::ToolPermissionChecked)
        .filter_map(|event| {
            let payload = event.payload.as_ref()?;
            let tool_id = payload.get("tool_id")?.as_str()?;
            let allowed = payload.get("allowed")?.as_bool()?;
            let status = if allowed { "allowed" } else { "denied" };
            Some(format!("{tool_id}: {status}"))
        })
        .collect()
}

fn format_tool_intent_summary(events: &[LedgerEvent]) -> Vec<String> {
    let mut summary = Vec::new();
    for event in events {
        match event.kind {
            LedgerEventKind::ToolIntentPermissionChecked => {
                let Some(payload) = event.payload.as_ref() else {
                    continue;
                };
                let Some(tool_id) = payload.get("tool_id").and_then(|value| value.as_str()) else {
                    continue;
                };
                let Some(allowed) = payload.get("allowed").and_then(|value| value.as_bool()) else {
                    continue;
                };
                let status = if allowed { "allowed" } else { "denied" };
                summary.push(format!("{tool_id}: {status}"));
            }
            LedgerEventKind::ToolIntentRejected => {
                let Some(payload) = event.payload.as_ref() else {
                    continue;
                };
                let tool_id = payload
                    .get("tool_id")
                    .and_then(|value| value.as_str())
                    .unwrap_or("<unknown>");
                summary.push(format!("{tool_id}: rejected"));
            }
            _ => {}
        }
    }
    summary
}

fn format_tool_execution_summary(events: &[LedgerEvent]) -> Vec<String> {
    events
        .iter()
        .filter(|event| {
            matches!(
                event.kind,
                LedgerEventKind::ToolExecutionCompleted
                    | LedgerEventKind::ToolExecutionDenied
                    | LedgerEventKind::ToolExecutionFailed
            )
        })
        .filter_map(|event| {
            let payload = event.payload.as_ref()?;
            let tool_id = payload.get("tool_id")?.as_str()?;
            let status = payload.get("status")?.as_str()?;
            match event.kind {
                LedgerEventKind::ToolExecutionCompleted => {
                    if let Some(git) = payload.get("git") {
                        return format_git_tool_execution_summary(tool_id, status, git);
                    }
                    if let Some(mcp) = payload.get("mcp") {
                        return format_mcp_tool_execution_summary(tool_id, status, mcp);
                    }
                    let bytes_read = payload.get("bytes_read").and_then(|value| value.as_u64());
                    let truncated = payload.get("truncated").and_then(|value| value.as_bool());
                    Some(format!(
                        "{tool_id}: {status} bytes_read={} truncated={}",
                        bytes_read
                            .map(|value| value.to_string())
                            .unwrap_or_else(|| "<unknown>".to_string()),
                        truncated
                            .map(|value| value.to_string())
                            .unwrap_or_else(|| "<unknown>".to_string())
                    ))
                }
                LedgerEventKind::ToolExecutionDenied | LedgerEventKind::ToolExecutionFailed => {
                    let reason = payload
                        .get("reason")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    Some(format!("{tool_id}: {status} reason={reason}"))
                }
                _ => None,
            }
        })
        .collect()
}

fn format_mcp_tool_execution_summary(
    tool_id: &str,
    status: &str,
    mcp: &serde_json::Value,
) -> Option<String> {
    let result_fingerprint = mcp.get("result_fingerprint")?.as_str()?;
    let is_error = mcp
        .get("is_error")
        .and_then(|value| value.as_bool())
        .map(|value| value.to_string())
        .unwrap_or_else(|| "<unknown>".to_string());
    let content_item_count = mcp
        .get("content_item_count")
        .and_then(|value| value.as_u64())
        .map(|value| value.to_string())
        .unwrap_or_else(|| "<unknown>".to_string());
    let materialized_content_item_count = mcp
        .get("materialized_content_item_count")
        .and_then(|value| value.as_u64())
        .map(|value| value.to_string())
        .unwrap_or_else(|| "<unknown>".to_string());
    let content_truncated = mcp
        .get("content_truncated")
        .and_then(|value| value.as_bool())
        .map(|value| value.to_string())
        .unwrap_or_else(|| "<unknown>".to_string());
    let text_chars = mcp
        .get("text_chars")
        .and_then(|value| value.as_u64())
        .map(|value| value.to_string())
        .unwrap_or_else(|| "<unknown>".to_string());
    let materialized_text_chars = mcp
        .get("materialized_text_chars")
        .and_then(|value| value.as_u64())
        .map(|value| value.to_string())
        .unwrap_or_else(|| "<unknown>".to_string());
    let mut lines = vec![format!(
        "{tool_id}: {status} result_fingerprint={result_fingerprint} is_error={is_error} content_item_count={content_item_count} materialized_content_item_count={materialized_content_item_count} text_chars={text_chars} materialized_text_chars={materialized_text_chars} content_truncated={content_truncated}"
    )];
    let content_items = mcp
        .get("content_items")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(format_mcp_result_context_item)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if !content_items.is_empty() {
        lines.push("untrusted_mcp_result_context:".to_string());
        lines.extend(content_items.into_iter().map(|item| format!("  {item}")));
    }
    Some(lines.join("\n"))
}

fn format_git_tool_execution_summary(
    tool_id: &str,
    status: &str,
    git: &serde_json::Value,
) -> Option<String> {
    let result_fingerprint = git.get("result_fingerprint")?.as_str()?;
    let operation = git
        .get("operation")
        .and_then(|value| value.as_str())
        .unwrap_or("<unknown>");
    let summary_line_count = git
        .get("summary_line_count")
        .and_then(|value| value.as_u64())
        .map(|value| value.to_string())
        .unwrap_or_else(|| "<unknown>".to_string());
    let materialized_summary_line_count = git
        .get("materialized_summary_line_count")
        .and_then(|value| value.as_u64())
        .map(|value| value.to_string())
        .unwrap_or_else(|| "<unknown>".to_string());
    let output_truncated = git
        .get("output_truncated")
        .and_then(|value| value.as_bool())
        .map(|value| value.to_string())
        .unwrap_or_else(|| "<unknown>".to_string());
    let mut lines = vec![format!(
        "{tool_id}: {status} operation={operation} result_fingerprint={result_fingerprint} summary_line_count={summary_line_count} materialized_summary_line_count={materialized_summary_line_count} output_truncated={output_truncated}"
    )];
    let summary_lines = git
        .get("summary_lines")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .enumerate()
                .filter_map(|(index, value)| {
                    value
                        .as_str()
                        .map(|text| format!("- line_index={index} text={text}"))
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if !summary_lines.is_empty() {
        lines.push("untrusted_git_result_context:".to_string());
        lines.extend(summary_lines.into_iter().map(|item| format!("  {item}")));
    }
    Some(lines.join("\n"))
}

fn format_mcp_result_context_item(item: &serde_json::Value) -> Option<String> {
    let index = item.get("index").and_then(|value| value.as_u64())?;
    let item_type = item.get("type")?.as_str()?;
    if item_type == "text" {
        let text = item.get("text")?.as_str()?;
        let text_chars = item
            .get("text_chars")
            .and_then(|value| value.as_u64())
            .unwrap_or(0);
        let materialized_text_chars = item
            .get("materialized_text_chars")
            .and_then(|value| value.as_u64())
            .unwrap_or(0);
        let truncated = item
            .get("truncated")
            .and_then(|value| value.as_bool())
            .unwrap_or(false);
        Some(format!(
            "- index={index} type=text text_chars={text_chars} materialized_text_chars={materialized_text_chars} truncated={truncated} text={text}"
        ))
    } else {
        Some(format!(
            "- index={index} type={item_type} unsupported=true text=<not_materialized>"
        ))
    }
}

fn format_subtask_orchestration_summary(events: &[LedgerEvent]) -> Vec<String> {
    events
        .iter()
        .filter_map(|event| {
            let payload = event.payload.as_ref()?;
            match event.kind {
                LedgerEventKind::SubtaskOrchestrationQueued => {
                    let subtask_id = payload
                        .get("subtask_id")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let status = payload
                        .get("status")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let tool_id = payload
                        .get("tool_id")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let queue_position = payload
                        .get("queue_position")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let execution_enabled = payload
                        .get("execution_enabled")
                        .and_then(|value| value.as_bool())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let mut fields = vec![format!(
                        "{subtask_id}: {status} tool_id={tool_id} queue_position={queue_position} execution_enabled={execution_enabled}"
                    )];
                    if let Some(goal) = payload
                        .get("requested_goal_preview")
                        .and_then(|value| value.as_str())
                    {
                        fields.push(format!("requested_goal_preview={goal}"));
                    }
                    if let Some(mode_id) =
                        payload.get("requested_mode_id").and_then(|value| value.as_str())
                    {
                        fields.push(format!("requested_mode_id={mode_id}"));
                    }
                    Some(fields.join(" "))
                }
                LedgerEventKind::SubtaskHandoffPrepared => {
                    let handoff_id = payload
                        .get("handoff_id")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let status = payload
                        .get("status")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let queued_count = payload
                        .get("queued_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let execution_enabled = payload
                        .get("execution_enabled")
                        .and_then(|value| value.as_bool())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let next_action = payload
                        .get("next_action")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    Some(format!(
                        "{handoff_id}: {status} queued_count={queued_count} execution_enabled={execution_enabled} next_action={next_action}"
                    ))
                }
                LedgerEventKind::SubtaskSchedulerReadinessRecorded => {
                    let readiness_id = payload
                        .get("readiness_id")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let readiness_status = payload
                        .get("readiness_status")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let handoff_count = payload
                        .get("handoff_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let queued_count = payload
                        .get("queued_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let dispatch_enabled = payload
                        .get("dispatch_enabled")
                        .and_then(|value| value.as_bool())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let next_action = payload
                        .get("next_action")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    Some(format!(
                        "{readiness_id}: {readiness_status} handoff_count={handoff_count} queued_count={queued_count} dispatch_enabled={dispatch_enabled} next_action={next_action}"
                    ))
                }
                LedgerEventKind::SubtaskDispatchPlanPrepared => {
                    let plan_id = payload
                        .get("plan_id")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let dispatch_plan_status = payload
                        .get("dispatch_plan_status")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let readiness_count = payload
                        .get("readiness_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let queued_count = payload
                        .get("queued_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let dispatch_enabled = payload
                        .get("dispatch_enabled")
                        .and_then(|value| value.as_bool())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let next_action = payload
                        .get("next_action")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    Some(format!(
                        "{plan_id}: {dispatch_plan_status} readiness_count={readiness_count} queued_count={queued_count} dispatch_enabled={dispatch_enabled} next_action={next_action}"
                    ))
                }
                LedgerEventKind::SubtaskDispatchContractPrepared => {
                    let contract_id = payload
                        .get("contract_id")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let dispatch_contract_status = payload
                        .get("dispatch_contract_status")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let plan_count = payload
                        .get("plan_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let queued_count = payload
                        .get("queued_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let eligibility_status = payload
                        .get("eligibility_status")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let dispatch_enabled = payload
                        .get("dispatch_enabled")
                        .and_then(|value| value.as_bool())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let next_action = payload
                        .get("next_action")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    Some(format!(
                        "{contract_id}: {dispatch_contract_status} plan_count={plan_count} queued_count={queued_count} eligibility_status={eligibility_status} dispatch_enabled={dispatch_enabled} next_action={next_action}"
                    ))
                }
                LedgerEventKind::SubtaskDispatchAdmissionEvaluated => {
                    let admission_id = payload
                        .get("admission_id")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let admission_status = payload
                        .get("admission_status")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let contract_count = payload
                        .get("contract_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let queued_count = payload
                        .get("queued_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let execution_gate_status = payload
                        .get("execution_gate_status")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let dispatch_enabled = payload
                        .get("dispatch_enabled")
                        .and_then(|value| value.as_bool())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let next_action = payload
                        .get("next_action")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    Some(format!(
                        "{admission_id}: {admission_status} contract_count={contract_count} queued_count={queued_count} execution_gate_status={execution_gate_status} dispatch_enabled={dispatch_enabled} next_action={next_action}"
                    ))
                }
                LedgerEventKind::SubtaskDispatchReadinessSnapshotRecorded => {
                    let snapshot_id = payload
                        .get("snapshot_id")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let readiness_status = payload
                        .get("readiness_status")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let admission_count = payload
                        .get("admission_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let queued_count = payload
                        .get("queued_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let scheduler_handoff_status = payload
                        .get("scheduler_handoff_status")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let dispatch_enabled = payload
                        .get("dispatch_enabled")
                        .and_then(|value| value.as_bool())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let fingerprint_input_count = payload
                        .get("fingerprint_input_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let next_action = payload
                        .get("next_action")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    Some(format!(
                        "{snapshot_id}: {readiness_status} admission_count={admission_count} queued_count={queued_count} scheduler_handoff_status={scheduler_handoff_status} dispatch_enabled={dispatch_enabled} fingerprint_input_count={fingerprint_input_count} next_action={next_action}"
                    ))
                }
                LedgerEventKind::SubtaskDispatcherGuardVerdictRecorded => {
                    let guard_id = payload
                        .get("guard_id")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let guard_status = payload
                        .get("guard_status")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let snapshot_count = payload
                        .get("snapshot_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let queued_count = payload
                        .get("queued_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let handoff_preflight_status = payload
                        .get("handoff_preflight_status")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let snapshot_validity_status = payload
                        .get("snapshot_validity_status")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let dispatch_enabled = payload
                        .get("dispatch_enabled")
                        .and_then(|value| value.as_bool())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let next_action = payload
                        .get("next_action")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    Some(format!(
                        "{guard_id}: {guard_status} snapshot_count={snapshot_count} queued_count={queued_count} handoff_preflight_status={handoff_preflight_status} dispatch_enabled={dispatch_enabled} snapshot_validity_status={snapshot_validity_status} next_action={next_action}"
                    ))
                }
                LedgerEventKind::SubtaskDispatchDecisionRecorded => {
                    let decision_id = payload
                        .get("decision_id")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let decision_status = payload
                        .get("decision_status")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let guard_count = payload
                        .get("guard_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let candidate_status = payload
                        .get("candidate_status")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let dispatch_candidate_count = payload
                        .get("dispatch_candidate_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let eligible_candidate_count = payload
                        .get("eligible_candidate_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let dispatch_enabled = payload
                        .get("dispatch_enabled")
                        .and_then(|value| value.as_bool())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let next_action = payload
                        .get("next_action")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    Some(format!(
                        "{decision_id}: {decision_status} guard_count={guard_count} candidate_status={candidate_status} dispatch_candidate_count={dispatch_candidate_count} eligible_candidate_count={eligible_candidate_count} dispatch_enabled={dispatch_enabled} next_action={next_action}"
                    ))
                }
                LedgerEventKind::SubtaskDispatchCandidateManifestRecorded => {
                    let manifest_id = payload
                        .get("manifest_id")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let manifest_status = payload
                        .get("manifest_status")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let decision_count = payload
                        .get("decision_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let candidate_count = payload
                        .get("candidate_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let blocked_candidate_count = payload
                        .get("blocked_candidate_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let eligible_candidate_count = payload
                        .get("eligible_candidate_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let dispatch_enabled = payload
                        .get("dispatch_enabled")
                        .and_then(|value| value.as_bool())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let next_action = payload
                        .get("next_action")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    Some(format!(
                        "{manifest_id}: {manifest_status} decision_count={decision_count} candidate_count={candidate_count} blocked_candidate_count={blocked_candidate_count} eligible_candidate_count={eligible_candidate_count} dispatch_enabled={dispatch_enabled} next_action={next_action}"
                    ))
                }
                LedgerEventKind::SubtaskDispatchHandoffEnvelopeRecorded => {
                    let handoff_envelope_id = payload
                        .get("handoff_envelope_id")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let handoff_envelope_status = payload
                        .get("handoff_envelope_status")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let manifest_count = payload
                        .get("manifest_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let candidate_count = payload
                        .get("candidate_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let handoff_ticket_count = payload
                        .get("handoff_ticket_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let replay_guard_status = payload
                        .get("replay_guard_status")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let dispatch_enabled = payload
                        .get("dispatch_enabled")
                        .and_then(|value| value.as_bool())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let next_action = payload
                        .get("next_action")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    Some(format!(
                        "{handoff_envelope_id}: {handoff_envelope_status} manifest_count={manifest_count} candidate_count={candidate_count} handoff_ticket_count={handoff_ticket_count} replay_guard_status={replay_guard_status} dispatch_enabled={dispatch_enabled} next_action={next_action}"
                    ))
                }
                LedgerEventKind::ParentJoinContinuationFingerprintConsumed => {
                    let parent_join_continuation_status = payload
                        .get("parent_join_continuation_status")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let child_completion_fingerprint = payload
                        .get("child_completion_fingerprint")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let child_completion_child_count = payload
                        .get("child_completion_child_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let fingerprint_input_count = payload
                        .get("fingerprint_input_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    Some(format!(
                        "parent_join_continuation: {parent_join_continuation_status} child_completion_fingerprint={child_completion_fingerprint} child_completion_child_count={child_completion_child_count} fingerprint_input_count={fingerprint_input_count}"
                    ))
                }
                _ => None,
            }
        })
        .collect()
}

fn format_verification_recovery_diagnostics_summary(task: &TaskRecord) -> Vec<String> {
    let Some(provenance) = task.verification_recovery_provenance.as_ref() else {
        return Vec::new();
    };
    provenance
        .bounded_cargo_diagnostics
        .iter()
        .map(|diagnostic| {
            let path = diagnostic
                .workspace_relative_path
                .as_deref()
                .unwrap_or("<unknown>");
            let line = diagnostic
                .line
                .map(|value| value.to_string())
                .unwrap_or_else(|| "<unknown>".to_string());
            let column = diagnostic
                .column
                .map(|value| value.to_string())
                .unwrap_or_else(|| "<unknown>".to_string());
            let code = diagnostic.code.as_deref().unwrap_or("<none>");
            format!(
                "{path}:{line}:{column} tool_id={} check_id={} kind={} severity={} code={} truncated={}",
                diagnostic.tool_id,
                diagnostic.check_id,
                diagnostic.diagnostic_kind,
                diagnostic.severity,
                code,
                diagnostic.truncated
            )
        })
        .collect()
}

fn format_context_window_summary(summary: &ContextWindowSummary) -> String {
    format!(
        "total_events: {}\nincluded_events: {}\nomitted_events: {}\nmax_events: {}\nfirst_included_event: {}\nlast_included_event: {}",
        summary.total_events,
        summary.included_events,
        summary.omitted_events,
        summary.max_events,
        summary
            .first_included_event
            .as_deref()
            .unwrap_or("<none>"),
        summary
            .last_included_event
            .as_deref()
            .unwrap_or("<none>")
    )
}

fn format_selected_index_context(context: &SelectedIndexPromptContext) -> String {
    format!(
        "prompt_context_id: {}\nsource_event_id: {}\nquery_id: {}\nselection_id: {}\nselection_fingerprint: {}\nsnapshot_fingerprint: {}\npath: {}\nfile_kind: {}\nbytes_read: {}\ncontent_sha256: {}\ncontent:\n{}",
        context.prompt_context_id,
        context.source_event_id,
        context.query_id,
        context.selection_id,
        context.selection_fingerprint,
        context.snapshot_fingerprint,
        context.path,
        context.file_kind,
        context.bytes_read,
        context.content_sha256,
        context.content
    )
}

fn format_verification_recovery_context(
    context: &VerificationRecoveryContextPromptContext,
) -> String {
    format!(
        "context_read_id: {}\nsource_task_id: {}\nsource_run_id: {}\nrecovery_task_id: {}\nrecovery_run_id: {}\nfailure_fingerprint: {}\ndiagnostic_index: {}\ntool_id: {}\ncheck_id: {}\ndiagnostic_kind: {}\nread_path_fingerprint: {}\nline: {}\ncolumn: {}\nexcerpt_start_line: {}\nexcerpt_end_line: {}\nexcerpt_bytes: {}\nexcerpt_sha256: {}\nexcerpt_truncated: {}\nexcerpt:\n{}",
        context.context_read_id,
        context.source_task_id,
        context.source_run_id,
        context.recovery_task_id,
        context.recovery_run_id,
        context.failure_fingerprint,
        context.diagnostic_index,
        context.tool_id,
        context.check_id,
        context.diagnostic_kind,
        context.read_path_fingerprint,
        context.line.map(|line| line.to_string()).unwrap_or_else(|| "<none>".to_string()),
        context.column.map(|column| column.to_string()).unwrap_or_else(|| "<none>".to_string()),
        context.excerpt_start_line,
        context.excerpt_end_line,
        context.excerpt_bytes,
        context.excerpt_sha256,
        context.excerpt_truncated,
        context.excerpt
    )
}

pub struct PromptBuilder;

impl PromptBuilder {
    pub fn build(input: PromptBuildInput) -> PromptView {
        let mode_id = input.mode_id.as_deref().unwrap_or("<none>");
        let mode_policy_summary = input
            .mode_policy_summary
            .unwrap_or_else(|| "Mode Policy:\n<unresolved>".to_string());
        let mode_instruction_material = input
            .mode_instruction_material
            .unwrap_or_else(|| "Mode Instructions:\n<unresolved>".to_string());
        let permission_checks = if input.permission_summary.is_empty() {
            "- <none>".to_string()
        } else {
            input
                .permission_summary
                .iter()
                .map(|entry| format!("- {entry}"))
                .collect::<Vec<_>>()
                .join("\n")
        };

        let tool_plan = if input.tool_plan_summary.is_empty() {
            "- <none>".to_string()
        } else {
            input
                .tool_plan_summary
                .iter()
                .map(|entry| format!("- {entry}"))
                .collect::<Vec<_>>()
                .join("\n")
        };

        let tool_intent = if input.tool_intent_summary.is_empty() {
            "- <none>".to_string()
        } else {
            input
                .tool_intent_summary
                .iter()
                .map(|entry| format!("- {entry}"))
                .collect::<Vec<_>>()
                .join("\n")
        };

        let tool_execution = if input.tool_execution_summary.is_empty() {
            "- <none>".to_string()
        } else {
            input
                .tool_execution_summary
                .iter()
                .map(|entry| format!("- {entry}"))
                .collect::<Vec<_>>()
                .join("\n")
        };
        let subtask_orchestration = if input.subtask_orchestration_summary.is_empty() {
            "- <none>".to_string()
        } else {
            input
                .subtask_orchestration_summary
                .iter()
                .map(|entry| format!("- {entry}"))
                .collect::<Vec<_>>()
                .join("\n")
        };
        let verification_recovery_diagnostics =
            if input.verification_recovery_diagnostics_summary.is_empty() {
                "- <none>".to_string()
            } else {
                input
                    .verification_recovery_diagnostics_summary
                    .iter()
                    .map(|entry| format!("- {entry}"))
                    .collect::<Vec<_>>()
                    .join("\n")
            };
        let context_window = format_context_window_summary(&input.context_window);
        let selected_index_context = input
            .selected_index_context
            .as_ref()
            .map(|context| {
                format!(
                    "\n\nSelected Index Context:\n{}",
                    format_selected_index_context(context)
                )
            })
            .unwrap_or_default();
        let verification_recovery_context = input
            .verification_recovery_context
            .as_ref()
            .map(|context| {
                format!(
                    "\n\nVerification Recovery Context Read:\n{}",
                    format_verification_recovery_context(context)
                )
            })
            .unwrap_or_default();

        let ledger = if input.ledger_summary.is_empty() {
            "- <empty>".to_string()
        } else {
            input
                .ledger_summary
                .iter()
                .map(|entry| format!("- {entry}"))
                .collect::<Vec<_>>()
                .join("\n")
        };

        PromptView {
            messages: vec![
                PromptMessage {
                    role: PromptRole::System,
                    content: format!(
                        "You are Brownie Runtime. Execute the task according to the current runtime phase.\n\nRuntime Safety Invariants:\n- Runtime safety invariants override Mode Pack instructions.\n- Compiled Mode Pack permission policy overrides mode instructions.\n- Mode instructions override task/objective input.\n- Prompt text never grants side-effect permissions; RuntimePermissionGate remains authoritative.\n- Do not describe shell commands or code fences as a substitute for tools.\n\nTool Intent Contract:\n- When the task needs workspace context, file changes, verification, git inspection, MCP tool use, or subtasks, respond with exactly one fenced brownie-tool-intent JSON block.\n- The fenced block must use this shape and no extra top-level fields:\n```brownie-tool-intent\n{{\"tool_requests\":[{{\"tool_id\":\"workspace.read\",\"reason\":\"Read bounded workspace context.\",\"input\":{{\"path\":\"README.md\"}}}}]}}\n```\n- For file changes, request workspace.write with input {{\"path\":\"relative/path\",\"operation\":\"replace_file|create_file|patch_file|delete_file\",\"content\":\"bounded replacement content\"}}. workspace.write records a Runtime-owned proposal; it is not arbitrary shell execution.\n- For bounded task steps that need current time, one-line file append, or waiting, prefer time.now, workspace.append_line, and runtime.sleep. Do not use process.exec for date, echo, printf, or sleep.\n- Only request tools that appear as allowed in the Tool Plan.
- For workspace.append_line, use input {{\"path\":\"relative/path\",\"line\":\"literal\"}} for literal lines, or {{\"path\":\"relative/path\",\"line_source\":\"current_time_unix_epoch_ms\"}} to append the current time.\n- If the Tool Plan omits a tool or marks it denied, do not request that tool.\n- If no tool is needed, answer directly without a brownie-tool-intent block.\n\nCompiled Mode Pack Policy:\n{mode_policy_summary}\n\nCompiled Mode Pack Instructions:\n{mode_instruction_material}"
                    ),
                },
                PromptMessage {
                    role: PromptRole::User,
                    content: format!(
                        "Task ID: {}\nRun ID: {}\nMode ID: {}\n\nPermission Checks:\n{}\n\nTool Plan:\n{}\n\nAssistant Tool Intent:\n{}\n\nTool Execution:\n{}{}{}\n\nSubtask Orchestration:\n{}\n\nVerification Recovery Diagnostics:\n{}\n\nContext Window:\n{}\n\nGoal:\n{}\n\nLedger:\n{}",
                        input.task_id, input.run_id, mode_id, permission_checks, tool_plan, tool_intent, tool_execution, selected_index_context, verification_recovery_context, subtask_orchestration, verification_recovery_diagnostics, context_window, input.goal, ledger
                    ),
                },
            ],
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TokenBudget {
    pub max_prompt_chars: usize,
}

pub struct SlidingWindowTruncator;

impl SlidingWindowTruncator {
    pub fn truncate(prompt: PromptView, budget: TokenBudget) -> PromptView {
        let total_chars: usize = prompt
            .messages
            .iter()
            .map(|message| message.content.len())
            .sum();
        if total_chars <= budget.max_prompt_chars {
            return prompt;
        }

        let mut messages = Vec::new();
        for message in prompt.messages {
            let protected = matches!(message.role, PromptRole::System)
                || (matches!(message.role, PromptRole::User)
                    && message.content.contains("Goal:\n"));
            if protected {
                messages.push(message);
            }
        }

        PromptView { messages }
    }
}

fn prompt_char_count(prompt: &PromptView) -> usize {
    prompt
        .messages
        .iter()
        .map(|message| message.content.chars().count())
        .sum()
}

fn protected_prompt_char_count(prompt: &PromptView) -> usize {
    prompt
        .messages
        .iter()
        .filter(|message| {
            matches!(message.role, PromptRole::System)
                || (matches!(message.role, PromptRole::User) && message.content.contains("Goal:\n"))
        })
        .map(|message| message.content.chars().count())
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;
    use brownie_store::LedgerEventKind;

    fn task_record() -> TaskRecord {
        TaskRecord {
            task_id: "task_1".into(),
            run_id: "run_1".into(),
            goal: "Ship Phase 1.2".into(),
            mode_id: Some("orchestrator".into()),
            status: brownie_protocol::TaskStatus::Running,
            parent_task_id: None,
            parent_run_id: None,
            source_candidate_id: None,
            source_handoff_envelope_id: None,
            source_handoff_envelope_fingerprint: None,
            source_intent_summary: None,
            recovery_cycle_provenance: None,
            verification_recovery_provenance: None,
            patch_apply_recovery_provenance: None,
            verification_recovery_retry_provenance: None,
            llm_provider_failure_retry_provenance: None,
            product_continuation_provenance: None,
            product_objective_continuation_provenance: None,
            product_loop_stop_recovery_provenance: None,
            headless_run_recovery_identity: None,
            runtime_deadline: None,
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: "2026-01-01T00:00:01Z".into(),
        }
    }

    #[test]
    fn prompt_builder_builds_deterministic_messages() {
        let context_window = ContextWindowSummary {
            total_events: 2,
            included_events: 2,
            omitted_events: 0,
            max_events: MAX_LEDGER_CONTEXT_EVENTS,
            first_included_event: Some("TaskStarted".into()),
            last_included_event: Some("TaskRunning".into()),
        };
        let prompt = PromptBuilder::build(PromptBuildInput {
            task_id: "task_1".into(),
            run_id: "run_1".into(),
            goal: "Test goal".into(),
            mode_id: Some("orchestrator".into()),
            mode_policy_summary: Some("Mode Policy:\nmode_id: orchestrator".into()),
            mode_instruction_material: Some("Mode Instructions:\n<none>".into()),
            permission_summary: vec![],
            tool_plan_summary: vec![],
            tool_intent_summary: vec![],
            tool_execution_summary: vec![],
            subtask_orchestration_summary: vec![],
            verification_recovery_diagnostics_summary: vec![],
            selected_index_context: None,
            verification_recovery_context: None,
            context_window: context_window.clone(),
            context_budget: ContextBudgetSummary::unrequested(&context_window, None, usize::MAX),
            ledger_summary: vec!["TaskStarted".into(), "TaskRunning".into()],
        });

        assert_eq!(prompt.messages.len(), 2);
        assert_eq!(prompt.messages[0].role, PromptRole::System);
        assert!(prompt.messages[0].content.contains("Tool Intent Contract:"));
        assert!(prompt.messages[0]
            .content
            .contains("```brownie-tool-intent"));
        assert!(prompt.messages[0]
            .content
            .contains("workspace.write records a Runtime-owned proposal"));
        assert!(prompt.messages[0].content.contains("workspace.append_line"));
        assert!(prompt.messages[0].content.contains("runtime.sleep"));
        assert_eq!(prompt.messages[1].role, PromptRole::User);
        assert!(prompt.messages[1].content.contains("Task ID: task_1"));
        assert!(prompt.messages[1]
            .content
            .contains("- TaskStarted\n- TaskRunning"));
    }

    #[test]
    fn prompt_builder_includes_selected_index_context_when_provided() {
        let selected_index_context = SelectedIndexPromptContext {
            prompt_context_id: "ctx_0123456789abcdef".into(),
            source_event_id: "event_9".into(),
            query_id: "query_0123456789abcdef".into(),
            selection_id: "selection_0123456789abcdef".into(),
            selection_fingerprint: format!("sha256:{}", "a".repeat(64)),
            snapshot_fingerprint: format!("sha256:{}", "b".repeat(64)),
            path: "src/runtime/query.rs".into(),
            file_kind: "Rust".into(),
            bytes_read: 25,
            content_char_count: 21,
            materialized_content_char_count: 21,
            content_truncated_for_prompt: false,
            content_sha256: format!("sha256:{}", "c".repeat(64)),
            content: "pub fn selected() {}\n".into(),
        };
        let context_window = ContextWindowSummary {
            total_events: 2,
            included_events: 2,
            omitted_events: 0,
            max_events: MAX_LEDGER_CONTEXT_EVENTS,
            first_included_event: Some("TaskStarted".into()),
            last_included_event: Some("TaskRunning".into()),
        };
        let prompt = PromptBuilder::build(PromptBuildInput {
            task_id: "task_1".into(),
            run_id: "run_1".into(),
            goal: "Use selected code context".into(),
            mode_id: Some("orchestrator".into()),
            mode_policy_summary: Some("Mode Policy:\nmode_id: orchestrator".into()),
            mode_instruction_material: Some("Mode Instructions:\n<none>".into()),
            permission_summary: vec![],
            tool_plan_summary: vec![],
            tool_intent_summary: vec![],
            tool_execution_summary: vec![],
            subtask_orchestration_summary: vec![],
            verification_recovery_diagnostics_summary: vec![],
            selected_index_context: Some(selected_index_context.clone()),
            verification_recovery_context: None,
            context_window: context_window.clone(),
            context_budget: ContextBudgetSummary::unrequested(
                &context_window,
                Some(&selected_index_context),
                usize::MAX,
            ),
            ledger_summary: vec!["TaskStarted".into(), "TaskRunning".into()],
        });

        assert!(prompt.messages[1]
            .content
            .contains("Selected Index Context:"));
        assert!(prompt.messages[1]
            .content
            .contains("source_event_id: event_9"));
        assert!(prompt.messages[1]
            .content
            .contains("path: src/runtime/query.rs"));
        assert!(prompt.messages[1].content.contains("pub fn selected() {}"));
    }

    #[test]
    fn context_materializer_includes_task_goal_and_ledger_summary() {
        let input = ContextMaterializerInput {
            task: task_record(),
            ledger_events: vec![LedgerEvent {
                event_id: "event_1".into(),
                task_id: "task_1".into(),
                run_id: "run_1".into(),
                kind: LedgerEventKind::TaskStarted,
                timestamp: "2026-01-01T00:00:00Z".into(),
                payload: None,
                payload_envelope: None,
            }],
            child_completion_summaries: vec![],
            selected_index_context: None,
            verification_recovery_context: None,
            context_budget: None,
        };

        let materialized = ContextMaterializer::materialize(input);
        assert_eq!(materialized.goal, "Ship Phase 1.2");
        assert_eq!(materialized.ledger_summary, vec!["TaskStarted"]);
        assert_eq!(materialized.context_window.total_events, 1);
        assert_eq!(materialized.context_window.included_events, 1);
        assert_eq!(materialized.context_window.omitted_events, 0);
        assert_eq!(
            materialized.mode_policy_summary,
            Some("Mode Policy:\n<unresolved>".into())
        );
        assert_eq!(
            materialized.mode_instruction_material,
            Some("Mode Instructions:\n<unresolved>".into())
        );
    }

    #[test]
    fn context_materializer_includes_bounded_verification_recovery_diagnostics() {
        let mut task = task_record();
        task.verification_recovery_provenance =
            Some(brownie_protocol::VerificationRecoveryProvenance {
                source_task_id: "task_source".into(),
                source_run_id: "run_source".into(),
                failure_fingerprint: "sha256:abc".into(),
                required_verifier_count: 1,
                passed_verifier_count: 0,
                failed_verifier_count: 1,
                failed_verifier_tool_ids: vec!["verification.cargo_check".into()],
                failure_reasons: vec!["verification.cargo_check:Failed".into()],
                bounded_cargo_diagnostics: vec![brownie_protocol::BoundedCargoDiagnostic {
                    tool_id: "verification.cargo_check".into(),
                    check_id: "cargo_check".into(),
                    diagnostic_kind: "compile_error".into(),
                    severity: "error".into(),
                    code: Some("E0412".into()),
                    test_name_hash: None,
                    workspace_relative_path: Some("src/lib.rs".into()),
                    line: Some(7),
                    column: Some(12),
                    truncated: false,
                }],
            });
        let materialized = ContextMaterializer::materialize(ContextMaterializerInput {
            task,
            ledger_events: vec![],
            child_completion_summaries: vec![],
            selected_index_context: None,
            verification_recovery_context: None,
            context_budget: None,
        });

        assert_eq!(
            materialized.verification_recovery_diagnostics_summary,
            vec![
                "src/lib.rs:7:12 tool_id=verification.cargo_check check_id=cargo_check kind=compile_error severity=error code=E0412 truncated=false"
            ]
        );
        let prompt = PromptBuilder::build(materialized);
        assert!(prompt.messages[1]
            .content
            .contains("Verification Recovery Diagnostics:"));
        assert!(prompt.messages[1].content.contains("src/lib.rs:7:12"));
        assert!(!prompt.messages[1].content.contains("MissingType"));
    }

    #[test]
    fn context_materializer_bounds_ledger_summary_to_recent_events() {
        let kinds = [
            LedgerEventKind::TaskStarted,
            LedgerEventKind::ModeResolved,
            LedgerEventKind::PermissionChecked,
            LedgerEventKind::ToolPlanned,
            LedgerEventKind::ToolPermissionChecked,
            LedgerEventKind::ToolPlanApproved,
            LedgerEventKind::AgentLoopStarted,
            LedgerEventKind::PromptBuilt,
            LedgerEventKind::LlmRequestCreated,
            LedgerEventKind::LlmResponseReceived,
            LedgerEventKind::ToolIntentParsed,
            LedgerEventKind::ToolIntentPermissionChecked,
            LedgerEventKind::ToolExecutionRequested,
            LedgerEventKind::ToolExecutionCompleted,
            LedgerEventKind::TaskCompleted,
        ];
        let input = ContextMaterializerInput {
            task: task_record(),
            ledger_events: kinds
                .iter()
                .enumerate()
                .map(|(index, kind)| LedgerEvent {
                    event_id: format!("event_{index}"),
                    task_id: "task_1".into(),
                    run_id: "run_1".into(),
                    kind: kind.clone(),
                    timestamp: "2026-01-01T00:00:00Z".into(),
                    payload: None,
                    payload_envelope: None,
                })
                .collect(),
            child_completion_summaries: vec![],
            selected_index_context: None,
            verification_recovery_context: None,
            context_budget: None,
        };

        let materialized = ContextMaterializer::materialize(input);
        assert_eq!(materialized.context_window.total_events, kinds.len());
        assert_eq!(
            materialized.context_window.included_events,
            MAX_LEDGER_CONTEXT_EVENTS
        );
        assert_eq!(materialized.context_window.omitted_events, 3);
        assert_eq!(materialized.ledger_summary.len(), MAX_LEDGER_CONTEXT_EVENTS);
        assert_eq!(materialized.ledger_summary.first().unwrap(), "ToolPlanned");
        assert_eq!(materialized.ledger_summary.last().unwrap(), "TaskCompleted");
        assert!(!materialized
            .ledger_summary
            .contains(&"TaskStarted".to_string()));

        let prompt = PromptBuilder::build(materialized);
        assert!(prompt.messages[1].content.contains("Context Window:"));
        assert!(prompt.messages[1].content.contains("omitted_events: 3"));
        assert!(prompt.messages[1]
            .content
            .contains("first_included_event: ToolPlanned"));
    }

    #[test]
    fn context_materializer_shrinks_ledger_to_fit_prompt_budget() {
        let events = [
            LedgerEventKind::TaskStarted,
            LedgerEventKind::PermissionChecked,
            LedgerEventKind::ToolPlanned,
            LedgerEventKind::ToolIntentParsed,
            LedgerEventKind::ToolExecutionRequested,
            LedgerEventKind::ToolExecutionCompleted,
        ]
        .iter()
        .enumerate()
        .map(|(index, kind)| LedgerEvent {
            event_id: format!("event_{index}"),
            task_id: "task_1".into(),
            run_id: "run_1".into(),
            kind: kind.clone(),
            timestamp: "2026-01-01T00:00:00Z".into(),
            payload: None,
            payload_envelope: None,
        })
        .collect::<Vec<_>>();
        let empty_ledger_prompt =
            PromptBuilder::build(ContextMaterializer::materialize(ContextMaterializerInput {
                task: task_record(),
                ledger_events: vec![],
                child_completion_summaries: vec![],
                selected_index_context: None,
                verification_recovery_context: None,
                context_budget: None,
            }));
        let budget = prompt_char_count(&empty_ledger_prompt) + 40;

        let materialized = ContextMaterializer::materialize(ContextMaterializerInput {
            task: task_record(),
            ledger_events: events.clone(),
            child_completion_summaries: vec![],
            selected_index_context: None,
            verification_recovery_context: None,
            context_budget: Some(ContextBudget {
                max_prompt_chars: budget,
                max_ledger_events: events.len(),
                max_selected_index_chars: 0,
            }),
        });

        assert!(materialized.context_budget.prompt_within_budget);
        assert!(materialized.ledger_summary.len() < events.len());
        assert_eq!(
            materialized.context_window.omitted_events,
            events.len() - materialized.ledger_summary.len()
        );
        assert_eq!(
            materialized.context_window.included_events,
            materialized.ledger_summary.len()
        );
        let prompt = PromptBuilder::build(materialized);
        assert!(prompt_char_count(&prompt) <= budget);
    }

    #[test]
    fn context_materializer_includes_mode_policy_summary_from_ledger() {
        let input = ContextMaterializerInput {
            task: task_record(),
            ledger_events: vec![LedgerEvent {
                event_id: "event_1".into(),
                task_id: "task_1".into(),
                run_id: "run_1".into(),
                kind: LedgerEventKind::ModeResolved,
                timestamp: "2026-01-01T00:00:00Z".into(),
                payload: Some(serde_json::json!({
                    "mode_id": "orchestrator",
                    "display_name": "Orchestrator",
                    "permissions": {
                        "read_only": true,
                        "workspace_write": false,
                        "process_exec": false,
                        "network_access": false,
                        "service_control": false,
                        "destructive": false,
                        "can_spawn_subtasks": true,
                        "codebase_index": true,
                        "mcp_tool_access": true
                    },
                    "workspace_write_scopes": [{
                        "file_regex": "\\.md$",
                        "description": "Markdown documentation only"
                    }],
                    "allowed_handoff_targets": ["reviewer-lite"],
                    "mcp_tool_catalogs": [{
                        "server_id": "github",
                        "protocol_version": "2026-07-28",
                        "server_config_identity_fingerprint": "sha256:config",
                        "catalog_fingerprint": "sha256:catalog",
                        "tools": [{
                            "tool_id": "mcp.github.search_code",
                            "description": "Search code through a bounded MCP catalog.",
                            "input_schema_fingerprint": "sha256:input",
                            "input_schema_summary": [{
                                "name": "query",
                                "type": "string",
                                "required": true
                            }]
                        }]
                    }]
                })),
                payload_envelope: None,
            }],
            child_completion_summaries: vec![],
            selected_index_context: None,
            verification_recovery_context: None,
            context_budget: None,
        };

        let materialized = ContextMaterializer::materialize(input);
        let summary = materialized.mode_policy_summary.expect("mode summary");
        assert!(summary.contains("mode_id: orchestrator"));
        assert!(summary.contains("workspace_write: false"));
        assert!(summary.contains("workspace_write_scopes:"));
        assert!(summary.contains("file_regex: \\.md$"));
        assert!(summary.contains("description: Markdown documentation only"));
        assert!(summary.contains("can_spawn_subtasks: true"));
        assert!(summary.contains("allowed_handoff_targets:"));
        assert!(summary.contains("- reviewer-lite"));
        assert!(summary.contains("codebase_index: true"));
        assert!(summary.contains("mcp.github.search_code"));
        assert!(summary.contains("description: Search code through a bounded MCP catalog."));
        assert!(summary.contains("name: query"));
        assert!(summary.contains("type: string"));
        assert!(summary.contains("required: true"));
        assert!(!summary.contains("inputSchema"));
    }

    #[test]
    fn modepack_instructions_materialize_as_protected_system_policy() {
        let custom_instruction =
            "Coordinate ordinary work through least-privilege specialists only.\nA workflow is complete only when required quality gates have exit_status=0.";
        let input = ContextMaterializerInput {
            task: task_record(),
            ledger_events: vec![LedgerEvent {
                event_id: "event_1".into(),
                task_id: "task_1".into(),
                run_id: "run_1".into(),
                kind: LedgerEventKind::ModeResolved,
                timestamp: "2026-01-01T00:00:00Z".into(),
                payload: Some(serde_json::json!({
                    "mode_id": "orchestrator",
                    "display_name": "AgentModes Orchestrator",
                    "role_definition": "You are a workflow orchestrator.",
                    "when_to_use": "Use for complex multi-step work.",
                    "description": "Multi-mode task coordinator.",
                    "prompt_sections": [{
                        "title": "customInstructions",
                        "source": "AgentModes.customInstructions",
                        "content_fingerprint": format!("sha256:{}", "a".repeat(64)),
                        "content": custom_instruction
                    }],
                    "verification_responsibility": "Mode orchestrator carries AgentModes verification workflow responsibility.",
                    "instruction_fingerprint": format!("sha256:{}", "b".repeat(64)),
                    "permissions": {
                        "read_only": true,
                        "workspace_write": false,
                        "process_exec": false,
                        "network_access": false,
                        "service_control": false,
                        "destructive": false,
                        "can_spawn_subtasks": false,
                        "codebase_index": false
                    },
                    "external_modepack_task_provenance": {
                        "global_policy_artifacts": [{
                            "category": "rule",
                            "relative_path": "rules/runtime-safety.md",
                            "title": "Runtime Safety",
                            "content_fingerprint": format!("sha256:{}", "c".repeat(64)),
                            "content": "Global rules are protected policy text only."
                        }]
                    }
                })),
                payload_envelope: None,
            }],
            child_completion_summaries: vec![],
            selected_index_context: None,
            verification_recovery_context: None,
            context_budget: Some(ContextBudget {
                max_prompt_chars: 128,
                max_ledger_events: 0,
                max_selected_index_chars: 0,
            }),
        };

        let materialized = ContextMaterializer::materialize(input);
        let prompt = PromptBuilder::build(materialized);
        assert_eq!(prompt.messages[0].role, PromptRole::System);
        assert!(prompt.messages[0]
            .content
            .contains("Runtime Safety Invariants:"));
        assert!(prompt.messages[0].content.contains(custom_instruction));
        assert!(prompt.messages[0]
            .content
            .contains("global_policy_artifacts:"));
        assert!(prompt.messages[0]
            .content
            .contains("relative_path: rules/runtime-safety.md"));
        assert!(prompt.messages[0]
            .content
            .contains("Global rules are protected policy text only."));
        assert!(!prompt.messages[1].content.contains(custom_instruction));

        let truncated = SlidingWindowTruncator::truncate(
            prompt,
            TokenBudget {
                max_prompt_chars: 64,
            },
        );
        assert!(truncated.messages[0].content.contains(custom_instruction));
    }

    #[test]
    fn modepack_catalog_artifacts_are_not_globally_materialized() {
        let input = ContextMaterializerInput {
            task: task_record(),
            ledger_events: vec![LedgerEvent {
                event_id: "event_1".into(),
                task_id: "task_1".into(),
                run_id: "run_1".into(),
                kind: LedgerEventKind::ModeResolved,
                timestamp: "2026-01-01T00:00:00Z".into(),
                payload: Some(serde_json::json!({
                    "mode_id": "orchestrator",
                    "display_name": "AgentModes Orchestrator",
                    "role_definition": "You are a workflow orchestrator.",
                    "prompt_sections": [],
                    "permissions": {
                        "read_only": true,
                        "workspace_write": false,
                        "process_exec": false,
                        "network_access": false,
                        "service_control": false,
                        "destructive": false,
                        "can_spawn_subtasks": false,
                        "codebase_index": false
                    },
                    "external_modepack_task_provenance": {
                        "global_policy_artifacts": [
                            {
                                "category": "rule",
                                "relative_path": "rules/00-agentmodes-compact-mode-contract.md",
                                "title": "Global Rule",
                                "content_fingerprint": format!("sha256:{}", "1".repeat(64)),
                                "content": "Global rules are protected by default."
                            },
                            {
                                "category": "skill",
                                "relative_path": "skills/tdd-quality-gate/SKILL.md",
                                "title": "TDD Quality Gate",
                                "content_fingerprint": format!("sha256:{}", "2".repeat(64)),
                                "content": "Skill content requires explicit selection."
                            },
                            {
                                "category": "command",
                                "relative_path": "commands/tdd-quality-gate.md",
                                "title": "TDD Quality Gate Command",
                                "content_fingerprint": format!("sha256:{}", "3".repeat(64)),
                                "content": "Command content requires explicit invocation."
                            },
                            {
                                "category": "contract",
                                "relative_path": "docs/contracts/task-packet-v1.md",
                                "title": "Task Packet",
                                "content_fingerprint": format!("sha256:{}", "4".repeat(64)),
                                "content": "Contract content requires explicit reference."
                            }
                        ]
                    }
                })),
                payload_envelope: None,
            }],
            child_completion_summaries: vec![],
            selected_index_context: None,
            verification_recovery_context: None,
            context_budget: None,
        };

        let materialized = ContextMaterializer::materialize(input);
        let prompt = PromptBuilder::build(materialized);
        let system = &prompt.messages[0].content;

        assert!(system.contains("Global rules are protected by default."));
        assert!(system.contains("relative_path: rules/00-agentmodes-compact-mode-contract.md"));
        assert!(!system.contains("Skill content requires explicit selection."));
        assert!(!system.contains("skills/tdd-quality-gate/SKILL.md"));
        assert!(!system.contains("Command content requires explicit invocation."));
        assert!(!system.contains("commands/tdd-quality-gate.md"));
        assert!(!system.contains("Contract content requires explicit reference."));
        assert!(!system.contains("docs/contracts/task-packet-v1.md"));
    }

    #[test]
    fn context_materializer_includes_permission_summary() {
        let input = ContextMaterializerInput {
            task: task_record(),
            ledger_events: vec![LedgerEvent {
                event_id: "event_1".into(),
                task_id: "task_1".into(),
                run_id: "run_1".into(),
                kind: LedgerEventKind::PermissionChecked,
                timestamp: "2026-01-01T00:00:00Z".into(),
                payload: Some(serde_json::json!({
                    "mode_id": "orchestrator",
                    "action": "WriteWorkspace",
                    "allowed": false,
                    "reason": "Mode orchestrator does not allow workspace writes."
                })),
                payload_envelope: None,
            }],
            child_completion_summaries: vec![],
            selected_index_context: None,
            verification_recovery_context: None,
            context_budget: None,
        };

        let materialized = ContextMaterializer::materialize(input);
        assert_eq!(
            materialized.permission_summary,
            vec!["WriteWorkspace: denied"]
        );
        let prompt = PromptBuilder::build(materialized);
        assert!(prompt.messages[1].content.contains("Permission Checks:"));
        assert!(prompt.messages[1]
            .content
            .contains("- WriteWorkspace: denied"));
    }

    #[test]
    fn context_materializer_includes_assistant_tool_intent_summary() {
        let input = ContextMaterializerInput {
            task: task_record(),
            ledger_events: vec![
                LedgerEvent {
                    event_id: "event_1".into(),
                    task_id: "task_1".into(),
                    run_id: "run_1".into(),
                    kind: LedgerEventKind::ToolIntentPermissionChecked,
                    timestamp: "2026-01-01T00:00:00Z".into(),
                    payload: Some(serde_json::json!({"tool_id":"workspace.read","allowed":true})),
                    payload_envelope: None,
                },
                LedgerEvent {
                    event_id: "event_2".into(),
                    task_id: "task_1".into(),
                    run_id: "run_1".into(),
                    kind: LedgerEventKind::ToolIntentRejected,
                    timestamp: "2026-01-01T00:00:01Z".into(),
                    payload: Some(
                        serde_json::json!({"tool_id":"unknown.tool","reason":"Unknown tool id."}),
                    ),
                    payload_envelope: None,
                },
            ],
            child_completion_summaries: vec![],
            selected_index_context: None,
            verification_recovery_context: None,
            context_budget: None,
        };

        let materialized = ContextMaterializer::materialize(input);
        assert_eq!(
            materialized.tool_intent_summary,
            vec!["workspace.read: allowed", "unknown.tool: rejected"]
        );
    }

    #[test]
    fn context_materializer_and_prompt_include_tool_execution_summary() {
        let input = ContextMaterializerInput {
            task: task_record(),
            ledger_events: vec![LedgerEvent {
                event_id: "event_1".into(),
                task_id: "task_1".into(),
                run_id: "run_1".into(),
                kind: LedgerEventKind::ToolExecutionCompleted,
                timestamp: "2026-01-01T00:00:00Z".into(),
                payload: Some(serde_json::json!({
                    "tool_id": "workspace.read",
                    "status": "Completed",
                    "bytes_read": 123,
                    "truncated": false,
                    "output_preview": "# Brownie"
                })),
                payload_envelope: None,
            }],
            child_completion_summaries: vec![],
            selected_index_context: None,
            verification_recovery_context: None,
            context_budget: None,
        };

        let materialized = ContextMaterializer::materialize(input);
        assert_eq!(
            materialized.tool_execution_summary,
            vec!["workspace.read: Completed bytes_read=123 truncated=false"]
        );
        let prompt = PromptBuilder::build(materialized);
        assert!(prompt.messages[1].content.contains("Tool Execution:"));
        assert!(prompt.messages[1]
            .content
            .contains("- workspace.read: Completed bytes_read=123 truncated=false"));
    }

    #[test]
    fn context_materializer_includes_bounded_untrusted_mcp_result_context() {
        let input = ContextMaterializerInput {
            task: task_record(),
            ledger_events: vec![LedgerEvent {
                event_id: "event_1".into(),
                task_id: "task_1".into(),
                run_id: "run_1".into(),
                kind: LedgerEventKind::ToolExecutionCompleted,
                timestamp: "2026-01-01T00:00:00Z".into(),
                payload: Some(serde_json::json!({
                    "tool_id": "mcp.github.search_code",
                    "status": "Completed",
                    "mcp": {
                        "request_fingerprint": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                        "result_fingerprint": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                        "is_error": false,
                        "content_item_count": 1,
                        "materialized_content_item_count": 1,
                        "text_chars": 17,
                        "materialized_text_chars": 17,
                        "content_truncated": false,
                        "content_items": [{
                            "index": 0,
                            "type": "text",
                            "text": "MCP_RESULT_7f91c2",
                            "text_chars": 17,
                            "materialized_text_chars": 17,
                            "truncated": false
                        }]
                    }
                })),
                payload_envelope: None,
            }],
            child_completion_summaries: vec![],
            selected_index_context: None,
            verification_recovery_context: None,
            context_budget: None,
        };

        let materialized = ContextMaterializer::materialize(input);
        assert_eq!(materialized.tool_execution_summary.len(), 1);
        let prompt = PromptBuilder::build(materialized);
        assert!(prompt.messages[1]
            .content
            .contains("untrusted_mcp_result_context"));
        assert!(prompt.messages[1].content.contains("MCP_RESULT_7f91c2"));
        assert!(prompt.messages[1]
            .content
            .contains("result_fingerprint=sha256:"));
        assert!(!prompt.messages[1].content.contains(r#""jsonrpc":"2.0""#));
    }

    #[test]
    fn context_materializer_and_prompt_include_subtask_orchestration_summary() {
        let input = ContextMaterializerInput {
            task: task_record(),
            ledger_events: vec![
                LedgerEvent {
                    event_id: "event_1".into(),
                    task_id: "task_1".into(),
                    run_id: "run_1".into(),
                    kind: LedgerEventKind::SubtaskOrchestrationQueued,
                    timestamp: "2026-01-01T00:00:00Z".into(),
                    payload: Some(serde_json::json!({
                        "subtask_id": "subtask_run_1_1",
                        "tool_id": "subtask.spawn",
                        "status": "Queued",
                        "queue_position": 1,
                        "execution_enabled": false,
                        "requested_goal_preview": "Review parser boundary.",
                        "requested_mode_id": "implementer",
                        "input_summary": {
                            "has_path": false,
                            "field_count": 2
                        }
                    })),
                    payload_envelope: None,
                },
                LedgerEvent {
                    event_id: "event_2".into(),
                    task_id: "task_1".into(),
                    run_id: "run_1".into(),
                    kind: LedgerEventKind::SubtaskHandoffPrepared,
                    timestamp: "2026-01-01T00:00:01Z".into(),
                    payload: Some(serde_json::json!({
                        "handoff_id": "subtask_handoff_run_1_1",
                        "status": "Prepared",
                        "queued_count": 1,
                        "execution_enabled": false,
                        "next_action": "await_future_runtime_scheduler"
                    })),
                    payload_envelope: None,
                },
                LedgerEvent {
                    event_id: "event_3".into(),
                    task_id: "task_1".into(),
                    run_id: "run_1".into(),
                    kind: LedgerEventKind::SubtaskSchedulerReadinessRecorded,
                    timestamp: "2026-01-01T00:00:02Z".into(),
                    payload: Some(serde_json::json!({
                        "readiness_id": "subtask_scheduler_readiness_run_1_1",
                        "readiness_status": "Blocked",
                        "handoff_count": 1,
                        "queued_count": 1,
                        "dispatch_enabled": false,
                        "next_action": "await_runtime_scheduler_dispatch"
                    })),
                    payload_envelope: None,
                },
                LedgerEvent {
                    event_id: "event_4".into(),
                    task_id: "task_1".into(),
                    run_id: "run_1".into(),
                    kind: LedgerEventKind::SubtaskDispatchPlanPrepared,
                    timestamp: "2026-01-01T00:00:03Z".into(),
                    payload: Some(serde_json::json!({
                        "plan_id": "subtask_dispatch_plan_run_1_1",
                        "dispatch_plan_status": "Blocked",
                        "readiness_count": 1,
                        "queued_count": 1,
                        "dispatch_enabled": false,
                        "next_action": "await_runtime_subtask_dispatcher"
                    })),
                    payload_envelope: None,
                },
                LedgerEvent {
                    event_id: "event_5".into(),
                    task_id: "task_1".into(),
                    run_id: "run_1".into(),
                    kind: LedgerEventKind::SubtaskDispatchContractPrepared,
                    timestamp: "2026-01-01T00:00:04Z".into(),
                    payload: Some(serde_json::json!({
                        "contract_id": "subtask_dispatch_contract_run_1_1",
                        "dispatch_contract_status": "Blocked",
                        "plan_count": 1,
                        "queued_count": 1,
                        "eligibility_status": "Blocked",
                        "dispatch_enabled": false,
                        "next_action": "await_dispatch_contract_implementation"
                    })),
                    payload_envelope: None,
                },
                LedgerEvent {
                    event_id: "event_6".into(),
                    task_id: "task_1".into(),
                    run_id: "run_1".into(),
                    kind: LedgerEventKind::SubtaskDispatchAdmissionEvaluated,
                    timestamp: "2026-01-01T00:00:05Z".into(),
                    payload: Some(serde_json::json!({
                        "admission_id": "subtask_dispatch_admission_run_1_1",
                        "admission_status": "Blocked",
                        "contract_count": 1,
                        "queued_count": 1,
                        "execution_gate_status": "Blocked",
                        "dispatch_enabled": false,
                        "next_action": "await_dispatch_admission_preconditions"
                    })),
                    payload_envelope: None,
                },
                LedgerEvent {
                    event_id: "event_7".into(),
                    task_id: "task_1".into(),
                    run_id: "run_1".into(),
                    kind: LedgerEventKind::SubtaskDispatchReadinessSnapshotRecorded,
                    timestamp: "2026-01-01T00:00:06Z".into(),
                    payload: Some(serde_json::json!({
                        "snapshot_id": "subtask_dispatch_readiness_snapshot_run_1_1",
                        "readiness_status": "Blocked",
                        "admission_count": 1,
                        "queued_count": 1,
                        "scheduler_handoff_status": "Blocked",
                        "dispatch_enabled": false,
                        "fingerprint_input_count": 12,
                        "next_action": "await_dispatch_readiness_snapshot_handoff"
                    })),
                    payload_envelope: None,
                },
                LedgerEvent {
                    event_id: "event_8".into(),
                    task_id: "task_1".into(),
                    run_id: "run_1".into(),
                    kind: LedgerEventKind::SubtaskDispatcherGuardVerdictRecorded,
                    timestamp: "2026-01-01T00:00:07Z".into(),
                    payload: Some(serde_json::json!({
                        "guard_id": "subtask_dispatcher_guard_run_1_1",
                        "guard_status": "Blocked",
                        "snapshot_count": 1,
                        "queued_count": 1,
                        "handoff_preflight_status": "Blocked",
                        "dispatch_enabled": false,
                        "snapshot_validity_status": "Current",
                        "next_action": "await_dispatcher_guard_preconditions"
                    })),
                    payload_envelope: None,
                },
                LedgerEvent {
                    event_id: "event_9".into(),
                    task_id: "task_1".into(),
                    run_id: "run_1".into(),
                    kind: LedgerEventKind::SubtaskDispatchDecisionRecorded,
                    timestamp: "2026-01-01T00:00:08Z".into(),
                    payload: Some(serde_json::json!({
                        "decision_id": "subtask_dispatch_decision_run_1_1",
                        "decision_status": "Blocked",
                        "guard_count": 1,
                        "candidate_status": "Blocked",
                        "dispatch_candidate_count": 1,
                        "eligible_candidate_count": 0,
                        "dispatch_enabled": false,
                        "next_action": "await_dispatch_decision_preconditions"
                    })),
                    payload_envelope: None,
                },
                LedgerEvent {
                    event_id: "event_10".into(),
                    task_id: "task_1".into(),
                    run_id: "run_1".into(),
                    kind: LedgerEventKind::SubtaskDispatchCandidateManifestRecorded,
                    timestamp: "2026-01-01T00:00:09Z".into(),
                    payload: Some(serde_json::json!({
                        "manifest_id": "subtask_dispatch_candidate_manifest_run_1_1",
                        "manifest_status": "Blocked",
                        "decision_count": 1,
                        "candidate_count": 1,
                        "blocked_candidate_count": 1,
                        "eligible_candidate_count": 0,
                        "dispatch_enabled": false,
                        "next_action": "await_dispatch_candidate_manifest_preconditions"
                    })),
                    payload_envelope: None,
                },
                LedgerEvent {
                    event_id: "event_11".into(),
                    task_id: "task_1".into(),
                    run_id: "run_1".into(),
                    kind: LedgerEventKind::SubtaskDispatchHandoffEnvelopeRecorded,
                    timestamp: "2026-01-01T00:00:10Z".into(),
                    payload: Some(serde_json::json!({
                        "handoff_envelope_id": "subtask_dispatch_handoff_envelope_run_1_1",
                        "handoff_envelope_status": "Blocked",
                        "manifest_count": 1,
                        "candidate_count": 1,
                        "handoff_ticket_count": 0,
                        "replay_guard_status": "Blocked",
                        "dispatch_enabled": false,
                        "next_action": "await_dispatch_handoff_envelope_preconditions"
                    })),
                    payload_envelope: None,
                },
            ],
            child_completion_summaries: vec![],
            selected_index_context: None,
            verification_recovery_context: None,
            context_budget: None,
        };

        let materialized = ContextMaterializer::materialize(input);
        assert_eq!(
            materialized.subtask_orchestration_summary,
            vec![
                "subtask_run_1_1: Queued tool_id=subtask.spawn queue_position=1 execution_enabled=false requested_goal_preview=Review parser boundary. requested_mode_id=implementer",
                "subtask_handoff_run_1_1: Prepared queued_count=1 execution_enabled=false next_action=await_future_runtime_scheduler",
                "subtask_scheduler_readiness_run_1_1: Blocked handoff_count=1 queued_count=1 dispatch_enabled=false next_action=await_runtime_scheduler_dispatch",
                "subtask_dispatch_plan_run_1_1: Blocked readiness_count=1 queued_count=1 dispatch_enabled=false next_action=await_runtime_subtask_dispatcher",
                "subtask_dispatch_contract_run_1_1: Blocked plan_count=1 queued_count=1 eligibility_status=Blocked dispatch_enabled=false next_action=await_dispatch_contract_implementation",
                "subtask_dispatch_admission_run_1_1: Blocked contract_count=1 queued_count=1 execution_gate_status=Blocked dispatch_enabled=false next_action=await_dispatch_admission_preconditions",
                "subtask_dispatch_readiness_snapshot_run_1_1: Blocked admission_count=1 queued_count=1 scheduler_handoff_status=Blocked dispatch_enabled=false fingerprint_input_count=12 next_action=await_dispatch_readiness_snapshot_handoff",
                "subtask_dispatcher_guard_run_1_1: Blocked snapshot_count=1 queued_count=1 handoff_preflight_status=Blocked dispatch_enabled=false snapshot_validity_status=Current next_action=await_dispatcher_guard_preconditions",
                "subtask_dispatch_decision_run_1_1: Blocked guard_count=1 candidate_status=Blocked dispatch_candidate_count=1 eligible_candidate_count=0 dispatch_enabled=false next_action=await_dispatch_decision_preconditions",
                "subtask_dispatch_candidate_manifest_run_1_1: Blocked decision_count=1 candidate_count=1 blocked_candidate_count=1 eligible_candidate_count=0 dispatch_enabled=false next_action=await_dispatch_candidate_manifest_preconditions",
                "subtask_dispatch_handoff_envelope_run_1_1: Blocked manifest_count=1 candidate_count=1 handoff_ticket_count=0 replay_guard_status=Blocked dispatch_enabled=false next_action=await_dispatch_handoff_envelope_preconditions"
            ]
        );
        let prompt = PromptBuilder::build(materialized);
        assert!(prompt.messages[1]
            .content
            .contains("Subtask Orchestration:"));
        assert!(prompt.messages[1]
            .content
            .contains("- subtask_run_1_1: Queued tool_id=subtask.spawn queue_position=1 execution_enabled=false requested_goal_preview=Review parser boundary. requested_mode_id=implementer"));
        assert!(prompt.messages[1]
            .content
            .contains("- subtask_handoff_run_1_1: Prepared queued_count=1 execution_enabled=false next_action=await_future_runtime_scheduler"));
        assert!(prompt.messages[1]
            .content
            .contains("- subtask_scheduler_readiness_run_1_1: Blocked handoff_count=1 queued_count=1 dispatch_enabled=false next_action=await_runtime_scheduler_dispatch"));
        assert!(prompt.messages[1]
            .content
            .contains("- subtask_dispatch_plan_run_1_1: Blocked readiness_count=1 queued_count=1 dispatch_enabled=false next_action=await_runtime_subtask_dispatcher"));
        assert!(prompt.messages[1]
            .content
            .contains("- subtask_dispatch_contract_run_1_1: Blocked plan_count=1 queued_count=1 eligibility_status=Blocked dispatch_enabled=false next_action=await_dispatch_contract_implementation"));
        assert!(prompt.messages[1]
            .content
            .contains("- subtask_dispatch_admission_run_1_1: Blocked contract_count=1 queued_count=1 execution_gate_status=Blocked dispatch_enabled=false next_action=await_dispatch_admission_preconditions"));
        assert!(prompt.messages[1]
            .content
            .contains("- subtask_dispatch_readiness_snapshot_run_1_1: Blocked admission_count=1 queued_count=1 scheduler_handoff_status=Blocked dispatch_enabled=false fingerprint_input_count=12 next_action=await_dispatch_readiness_snapshot_handoff"));
        assert!(prompt.messages[1]
            .content
            .contains("- subtask_dispatcher_guard_run_1_1: Blocked snapshot_count=1 queued_count=1 handoff_preflight_status=Blocked dispatch_enabled=false snapshot_validity_status=Current next_action=await_dispatcher_guard_preconditions"));
        assert!(prompt.messages[1]
            .content
            .contains("- subtask_dispatch_decision_run_1_1: Blocked guard_count=1 candidate_status=Blocked dispatch_candidate_count=1 eligible_candidate_count=0 dispatch_enabled=false next_action=await_dispatch_decision_preconditions"));
        assert!(prompt.messages[1]
            .content
            .contains("- subtask_dispatch_candidate_manifest_run_1_1: Blocked decision_count=1 candidate_count=1 blocked_candidate_count=1 eligible_candidate_count=0 dispatch_enabled=false next_action=await_dispatch_candidate_manifest_preconditions"));
        assert!(prompt.messages[1]
            .content
            .contains("- subtask_dispatch_handoff_envelope_run_1_1: Blocked manifest_count=1 candidate_count=1 handoff_ticket_count=0 replay_guard_status=Blocked dispatch_enabled=false next_action=await_dispatch_handoff_envelope_preconditions"));
    }

    #[test]
    fn context_materializer_includes_child_completion_summaries_before_parent_events() {
        let input = ContextMaterializerInput {
            task: task_record(),
            ledger_events: vec![LedgerEvent {
                event_id: "event_1".into(),
                task_id: "task_1".into(),
                run_id: "run_1".into(),
                kind: LedgerEventKind::SubtaskHandoffPrepared,
                timestamp: "2026-01-01T00:00:00Z".into(),
                payload: Some(serde_json::json!({
                    "handoff_id": "subtask_handoff_run_1_1",
                    "status": "Prepared",
                    "queued_count": 1,
                    "execution_enabled": false,
                    "next_action": "await_future_runtime_scheduler"
                })),
                            payload_envelope: None,
            }],
            child_completion_summaries: vec![
                "completed_child task_id=task_child source_candidate_id=subtask_1 completion_summary_preview=done".into(),
            ],
            selected_index_context: None,
            verification_recovery_context: None,
            context_budget: None,
        };

        let materialized = ContextMaterializer::materialize(input);
        assert_eq!(
            materialized.subtask_orchestration_summary[0],
            "completed_child task_id=task_child source_candidate_id=subtask_1 completion_summary_preview=done"
        );
        assert!(materialized.subtask_orchestration_summary[1]
            .contains("subtask_handoff_run_1_1: Prepared"));
        let prompt = PromptBuilder::build(materialized);
        assert!(prompt.messages[1]
            .content
            .contains("completed_child task_id=task_child"));
    }

    #[test]
    fn truncator_preserves_system_message_and_task_goal() {
        let prompt = PromptView {
            messages: vec![
                PromptMessage {
                    role: PromptRole::System,
                    content: "system".into(),
                },
                PromptMessage {
                    role: PromptRole::Assistant,
                    content: "x".repeat(1000),
                },
                PromptMessage {
                    role: PromptRole::User,
                    content: "Goal:\nkeep me".into(),
                },
            ],
        };

        let truncated = SlidingWindowTruncator::truncate(
            prompt,
            TokenBudget {
                max_prompt_chars: 10,
            },
        );
        assert_eq!(truncated.messages.len(), 2);
        assert_eq!(truncated.messages[0].content, "system");
        assert!(truncated.messages[1].content.contains("keep me"));
    }
}
