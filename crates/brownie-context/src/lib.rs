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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PromptBuildInput {
    pub task_id: String,
    pub run_id: String,
    pub goal: String,
    pub mode_id: Option<String>,
    pub mode_policy_summary: Option<String>,
    pub permission_summary: Vec<String>,
    pub tool_plan_summary: Vec<String>,
    pub tool_intent_summary: Vec<String>,
    pub ledger_summary: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContextMaterializerInput {
    pub task: TaskRecord,
    pub ledger_events: Vec<LedgerEvent>,
}

pub struct ContextMaterializer;

impl ContextMaterializer {
    pub fn materialize(input: ContextMaterializerInput) -> PromptBuildInput {
        let mode_policy_summary = input
            .ledger_events
            .iter()
            .rev()
            .find(|event| event.kind == LedgerEventKind::ModeResolved)
            .and_then(|event| event.payload.as_ref())
            .map(format_mode_policy_summary)
            .unwrap_or_else(|| {
                "Mode Policy:
<unresolved>"
                    .to_string()
            });

        let permission_summary = format_permission_summary(&input.ledger_events);
        let tool_plan_summary = format_tool_plan_summary(&input.ledger_events);
        let tool_intent_summary = format_tool_intent_summary(&input.ledger_events);

        let ledger_summary = input
            .ledger_events
            .iter()
            .map(|event| format!("{:?}", event.kind))
            .collect();

        PromptBuildInput {
            task_id: input.task.task_id,
            run_id: input.task.run_id,
            goal: input.task.goal,
            mode_id: input.task.mode_id,
            mode_policy_summary: Some(mode_policy_summary),
            permission_summary,
            tool_plan_summary,
            tool_intent_summary,
            ledger_summary,
        }
    }
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

    format!(
        "Mode Policy:
mode_id: {mode_id}
workspace_write: {}
process_exec: {}
can_spawn_subtasks: {}
network_access: {}
service_control: {}
destructive: {}
read_only: {}",
        permission_bool("workspace_write"),
        permission_bool("process_exec"),
        permission_bool("can_spawn_subtasks"),
        permission_bool("network_access"),
        permission_bool("service_control"),
        permission_bool("destructive"),
        permission_bool("read_only")
    )
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

pub struct PromptBuilder;

impl PromptBuilder {
    pub fn build(input: PromptBuildInput) -> PromptView {
        let mode_id = input.mode_id.as_deref().unwrap_or("<none>");
        let mode_policy_summary = input
            .mode_policy_summary
            .unwrap_or_else(|| "Mode Policy:\n<unresolved>".to_string());
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
                    content: "You are Brownie Runtime. Execute the task according to the current runtime phase. Real LLM/tool execution is disabled in this phase.".to_string(),
                },
                PromptMessage {
                    role: PromptRole::User,
                    content: format!(
                        "Task ID: {}\nRun ID: {}\nMode ID: {}\n{}\n\nPermission Checks:\n{}\n\nTool Plan:\n{}\n\nAssistant Tool Intent:\n{}\n\nGoal:\n{}\n\nLedger:\n{}",
                        input.task_id, input.run_id, mode_id, mode_policy_summary, permission_checks, tool_plan, tool_intent, input.goal, ledger
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
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: "2026-01-01T00:00:01Z".into(),
        }
    }

    #[test]
    fn prompt_builder_builds_deterministic_messages() {
        let prompt = PromptBuilder::build(PromptBuildInput {
            task_id: "task_1".into(),
            run_id: "run_1".into(),
            goal: "Test goal".into(),
            mode_id: Some("orchestrator".into()),
            mode_policy_summary: Some("Mode Policy:\nmode_id: orchestrator".into()),
            permission_summary: vec![],
            tool_plan_summary: vec![],
            tool_intent_summary: vec![],
            ledger_summary: vec!["TaskStarted".into(), "TaskRunning".into()],
        });

        assert_eq!(prompt.messages.len(), 2);
        assert_eq!(prompt.messages[0].role, PromptRole::System);
        assert!(prompt.messages[0]
            .content
            .contains("Real LLM/tool execution is disabled"));
        assert_eq!(prompt.messages[1].role, PromptRole::User);
        assert!(prompt.messages[1].content.contains("Task ID: task_1"));
        assert!(prompt.messages[1]
            .content
            .contains("- TaskStarted\n- TaskRunning"));
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
            }],
        };

        let materialized = ContextMaterializer::materialize(input);
        assert_eq!(materialized.goal, "Ship Phase 1.2");
        assert_eq!(materialized.ledger_summary, vec!["TaskStarted"]);
        assert_eq!(
            materialized.mode_policy_summary,
            Some("Mode Policy:\n<unresolved>".into())
        );
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
                        "can_spawn_subtasks": true
                    }
                })),
            }],
        };

        let materialized = ContextMaterializer::materialize(input);
        let summary = materialized.mode_policy_summary.expect("mode summary");
        assert!(summary.contains("mode_id: orchestrator"));
        assert!(summary.contains("workspace_write: false"));
        assert!(summary.contains("can_spawn_subtasks: true"));
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
            }],
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
                },
            ],
        };

        let materialized = ContextMaterializer::materialize(input);
        assert_eq!(
            materialized.tool_intent_summary,
            vec!["workspace.read: allowed", "unknown.tool: rejected"]
        );
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
