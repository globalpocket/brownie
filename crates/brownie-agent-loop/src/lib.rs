//! Agent loop state-machine crate.

use brownie_context::{PromptBuildInput, PromptBuilder, PromptRole, PromptView};
use brownie_llm::{FakeLlm, LlmMessage, LlmRequest, LlmResponse};

pub const FAKE_LLM_MODEL: &str = "brownie-fake-llm";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentLoopState {
    Created,
    LoadingMode,
    BuildingContext,
    CallingLlm,
    ParsingResponse,
    ExecutingTool,
    ApplyingPatch,
    SpawningSubtask,
    Waiting,
    Verifying,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentLoopInput {
    pub task_id: String,
    pub run_id: String,
    pub goal: String,
    pub mode_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentLoopResult {
    pub final_state: AgentLoopState,
    pub completion_summary: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentLoopRunOutput {
    pub final_state: AgentLoopState,
    pub prompt: PromptView,
    pub llm_request: LlmRequest,
    pub llm_response: LlmResponse,
    pub completion_summary: String,
}

pub struct AgentLoop;

impl AgentLoop {
    pub fn run_noop(input: AgentLoopInput) -> AgentLoopResult {
        AgentLoopResult {
            final_state: AgentLoopState::Completed,
            completion_summary: format!("No-op agent loop completed for {}", input.task_id),
        }
    }

    pub fn run_with_fake_llm(prompt_input: PromptBuildInput) -> AgentLoopRunOutput {
        let task_id = prompt_input.task_id.clone();
        let prompt = PromptBuilder::build(prompt_input);
        let llm_request = LlmRequest {
            model: FAKE_LLM_MODEL.to_string(),
            messages: prompt
                .messages
                .iter()
                .map(|message| LlmMessage {
                    role: prompt_role_to_llm_role(&message.role).to_string(),
                    content: message.content.clone(),
                })
                .collect(),
        };
        let llm_response = FakeLlm::complete(&llm_request);

        AgentLoopRunOutput {
            final_state: AgentLoopState::Completed,
            prompt,
            llm_request,
            completion_summary: format!("Fake LLM agent loop completed for {task_id}"),
            llm_response,
        }
    }
}

fn prompt_role_to_llm_role(role: &PromptRole) -> &'static str {
    match role {
        PromptRole::System => "system",
        PromptRole::User => "user",
        PromptRole::Assistant => "assistant",
        PromptRole::Tool => "tool",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_noop_completes() {
        let result = AgentLoop::run_noop(AgentLoopInput {
            task_id: "task_1".into(),
            run_id: "run_1".into(),
            goal: "test".into(),
            mode_id: None,
        });

        assert_eq!(result.final_state, AgentLoopState::Completed);
        assert!(result.completion_summary.contains("task_1"));
    }

    #[test]
    fn run_with_fake_llm_returns_completed_and_response() {
        let result = AgentLoop::run_with_fake_llm(PromptBuildInput {
            task_id: "task_1".into(),
            run_id: "run_1".into(),
            goal: "test".into(),
            mode_id: None,
            mode_policy_summary: Some("Mode Policy:\n<unresolved>".into()),
            permission_summary: vec![],
            tool_plan_summary: vec![],
            tool_intent_summary: vec![],
            ledger_summary: vec!["TaskStarted".into(), "TaskRunning".into()],
        });

        assert_eq!(result.final_state, AgentLoopState::Completed);
        assert_eq!(result.prompt.messages.len(), 2);
        assert_eq!(result.llm_request.model, FAKE_LLM_MODEL);
        assert!(result
            .llm_response
            .content
            .starts_with("Fake LLM completed request with 2 messages."));
        assert!(result
            .llm_response
            .content
            .contains("```brownie-tool-intent"));
    }
}
