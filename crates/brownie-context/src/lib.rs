//! Context materialization and sliding window truncation crate.

use brownie_protocol::TaskRecord;
use brownie_store::LedgerEvent;
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
            ledger_summary,
        }
    }
}

pub struct PromptBuilder;

impl PromptBuilder {
    pub fn build(input: PromptBuildInput) -> PromptView {
        let mode_id = input.mode_id.as_deref().unwrap_or("<none>");
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
                        "Task ID: {}\nRun ID: {}\nMode ID: {}\nGoal:\n{}\n\nLedger:\n{}",
                        input.task_id, input.run_id, mode_id, input.goal, ledger
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
