//! Agent loop state-machine crate.

use brownie_context::{PromptBuildInput, PromptBuilder, PromptRole, PromptView};
use brownie_llm::{
    enforce_prompt_sensitive_guard, FakeLlmProvider, LlmMessage, LlmProvider, LlmRequest,
    LlmRequestBudget, LlmResponse, PromptSensitiveGuardMode, PromptSensitiveScanResult,
};
use std::time::Instant;

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
    pub sensitive_scan: PromptSensitiveScanResult,
    pub prompt_build_duration_ms: u128,
    pub llm_request_duration_ms: u128,
    pub prompt_chars: usize,
    pub completion_summary: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentLoopSecondPassOutput {
    pub final_state: AgentLoopState,
    pub prompt: PromptView,
    pub llm_request: LlmRequest,
    pub llm_response: LlmResponse,
    pub sensitive_scan: PromptSensitiveScanResult,
    pub prompt_build_duration_ms: u128,
    pub llm_request_duration_ms: u128,
    pub prompt_chars: usize,
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

    pub fn run_with_llm(
        prompt_input: PromptBuildInput,
        provider: &dyn LlmProvider,
        budget: &LlmRequestBudget,
        sensitive_guard_mode: PromptSensitiveGuardMode,
    ) -> anyhow::Result<AgentLoopRunOutput> {
        let (task_id, prompt, llm_request, sensitive_scan, llm_response, measurements) =
            run_llm(prompt_input, provider, budget, sensitive_guard_mode)?;
        Ok(AgentLoopRunOutput {
            final_state: AgentLoopState::Completed,
            prompt,
            llm_request,
            completion_summary: format!("LLM agent loop completed for {task_id}"),
            llm_response,
            sensitive_scan,
            prompt_build_duration_ms: measurements.prompt_build_duration_ms,
            llm_request_duration_ms: measurements.llm_request_duration_ms,
            prompt_chars: measurements.prompt_chars,
        })
    }

    pub fn run_second_pass_with_llm(
        prompt_input: PromptBuildInput,
        provider: &dyn LlmProvider,
        budget: &LlmRequestBudget,
        sensitive_guard_mode: PromptSensitiveGuardMode,
    ) -> anyhow::Result<AgentLoopSecondPassOutput> {
        let (task_id, prompt, llm_request, sensitive_scan, llm_response, measurements) =
            run_llm(prompt_input, provider, budget, sensitive_guard_mode)?;
        Ok(AgentLoopSecondPassOutput {
            final_state: AgentLoopState::Completed,
            prompt,
            llm_request,
            completion_summary: format!("Second-pass LLM agent loop completed for {task_id}"),
            llm_response,
            sensitive_scan,
            prompt_build_duration_ms: measurements.prompt_build_duration_ms,
            llm_request_duration_ms: measurements.llm_request_duration_ms,
            prompt_chars: measurements.prompt_chars,
        })
    }

    pub fn run_with_fake_llm(prompt_input: PromptBuildInput) -> AgentLoopRunOutput {
        Self::run_with_llm(
            prompt_input,
            &FakeLlmProvider,
            &LlmRequestBudget::default(),
            PromptSensitiveGuardMode::Warn,
        )
        .expect("fake provider should not fail")
    }

    pub fn run_second_pass_with_fake_llm(
        prompt_input: PromptBuildInput,
    ) -> AgentLoopSecondPassOutput {
        Self::run_second_pass_with_llm(
            prompt_input,
            &FakeLlmProvider,
            &LlmRequestBudget::default(),
            PromptSensitiveGuardMode::Warn,
        )
        .expect("fake provider should not fail")
    }
}

fn run_llm(
    prompt_input: PromptBuildInput,
    provider: &dyn LlmProvider,
    budget: &LlmRequestBudget,
    sensitive_guard_mode: PromptSensitiveGuardMode,
) -> anyhow::Result<(
    String,
    PromptView,
    LlmRequest,
    PromptSensitiveScanResult,
    LlmResponse,
    AgentLoopMeasurements,
)> {
    let task_id = prompt_input.task_id.clone();
    let prompt_build_started = Instant::now();
    let prompt = PromptBuilder::build(prompt_input);
    let prompt_build_duration_ms = prompt_build_started.elapsed().as_millis();
    let llm_request = LlmRequest {
        model: provider.status().model,
        messages: prompt
            .messages
            .iter()
            .map(|message| LlmMessage {
                role: prompt_role_to_llm_role(&message.role).to_string(),
                content: message.content.clone(),
            })
            .collect(),
    };
    let prompt_chars = llm_request
        .messages
        .iter()
        .map(|m| m.content.chars().count())
        .sum();
    validate_request_budget(&llm_request, budget)?;
    let sensitive_scan =
        enforce_prompt_sensitive_guard(&llm_request.messages, sensitive_guard_mode)?;
    let llm_request_started = Instant::now();
    let llm_response = provider.complete(&llm_request, budget)?;
    let llm_request_duration_ms = llm_request_started.elapsed().as_millis();
    Ok((
        task_id,
        prompt,
        llm_request,
        sensitive_scan,
        llm_response,
        AgentLoopMeasurements {
            prompt_build_duration_ms,
            llm_request_duration_ms,
            prompt_chars,
        },
    ))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct AgentLoopMeasurements {
    prompt_build_duration_ms: u128,
    llm_request_duration_ms: u128,
    prompt_chars: usize,
}

fn validate_request_budget(request: &LlmRequest, budget: &LlmRequestBudget) -> anyhow::Result<()> {
    let message_count = request.messages.len();
    if message_count > budget.max_messages {
        anyhow::bail!(
            "LLM request budget exceeded: message count {} > max_messages {}",
            message_count,
            budget.max_messages
        );
    }
    let prompt_chars: usize = request
        .messages
        .iter()
        .map(|m| m.content.chars().count())
        .sum();
    if prompt_chars > budget.max_prompt_chars {
        anyhow::bail!(
            "LLM request budget exceeded: prompt chars {} > max_prompt_chars {}",
            prompt_chars,
            budget.max_prompt_chars
        );
    }
    Ok(())
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
    use brownie_context::{ContextBudgetSummary, ContextWindowSummary, MAX_LEDGER_CONTEXT_EVENTS};
    use brownie_llm::{LlmProviderKind, LlmProviderStatus, FAKE_LLM_MODEL};
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct CountingProvider {
        calls: AtomicUsize,
    }

    impl LlmProvider for CountingProvider {
        fn status(&self) -> LlmProviderStatus {
            LlmProviderStatus {
                provider: LlmProviderKind::Fake,
                enabled: true,
                model: "counting-provider".into(),
                base_url: None,
                reason: None,
            }
        }

        fn complete(
            &self,
            _request: &LlmRequest,
            _budget: &LlmRequestBudget,
        ) -> anyhow::Result<LlmResponse> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Ok(LlmResponse {
                content: "should not be called".into(),
            })
        }
    }

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
    fn run_with_fake_llm_returns_completed_and_tool_intent_response() {
        let context_window = ContextWindowSummary {
            total_events: 2,
            included_events: 2,
            omitted_events: 0,
            max_events: MAX_LEDGER_CONTEXT_EVENTS,
            first_included_event: Some("TaskStarted".into()),
            last_included_event: Some("TaskRunning".into()),
        };
        let result = AgentLoop::run_with_fake_llm(PromptBuildInput {
            task_id: "task_1".into(),
            run_id: "run_1".into(),
            goal: "test".into(),
            mode_id: None,
            mode_policy_summary: Some("Mode Policy:\n<unresolved>".into()),
            mode_instruction_material: Some("Mode Instructions:\n<unresolved>".into()),
            permission_summary: vec![],
            tool_plan_summary: vec![],
            tool_intent_summary: vec![],
            tool_execution_summary: vec![],
            subtask_orchestration_summary: vec![],
            verification_recovery_diagnostics_summary: vec![],
            selected_index_context: None,
            verification_recovery_context: None,
            context_budget: ContextBudgetSummary::unrequested(&context_window, None, usize::MAX),
            context_window,
            ledger_summary: vec!["TaskStarted".into(), "TaskRunning".into()],
        });

        assert_eq!(result.final_state, AgentLoopState::Completed);
        assert_eq!(result.prompt.messages.len(), 2);
        assert_eq!(result.llm_request.model, FAKE_LLM_MODEL);
        assert!(result.llm_response.content.contains("brownie-tool-intent"));
        assert!(result.llm_response.content.contains("workspace.read"));
    }
    #[test]
    fn run_second_pass_with_fake_llm_returns_completed_and_final_response() {
        let context_window = ContextWindowSummary {
            total_events: 1,
            included_events: 1,
            omitted_events: 0,
            max_events: MAX_LEDGER_CONTEXT_EVENTS,
            first_included_event: Some("ToolExecutionCompleted".into()),
            last_included_event: Some("ToolExecutionCompleted".into()),
        };
        let result = AgentLoop::run_second_pass_with_fake_llm(PromptBuildInput {
            task_id: "task_1".into(),
            run_id: "run_1".into(),
            goal: "test".into(),
            mode_id: None,
            mode_policy_summary: Some("Mode Policy:\n<unresolved>".into()),
            mode_instruction_material: Some("Mode Instructions:\n<unresolved>".into()),
            permission_summary: vec![],
            tool_plan_summary: vec![],
            tool_intent_summary: vec![],
            tool_execution_summary: vec![
                "workspace.read: Completed bytes_read=12 truncated=false".into()
            ],
            subtask_orchestration_summary: vec![],
            verification_recovery_diagnostics_summary: vec![],
            selected_index_context: None,
            verification_recovery_context: None,
            context_budget: ContextBudgetSummary::unrequested(&context_window, None, usize::MAX),
            context_window,
            ledger_summary: vec!["ToolExecutionCompleted".into()],
        });

        assert_eq!(result.final_state, AgentLoopState::Completed);
        assert!(result
            .llm_response
            .content
            .contains("Fake LLM final response after reading workspace context."));
        assert!(!result.llm_response.content.contains("brownie-tool-intent"));
    }

    #[test]
    fn fail_sensitive_guard_stops_before_provider_complete() {
        let context_window = ContextWindowSummary {
            total_events: 0,
            included_events: 0,
            omitted_events: 0,
            max_events: MAX_LEDGER_CONTEXT_EVENTS,
            first_included_event: None,
            last_included_event: None,
        };
        let provider = CountingProvider {
            calls: AtomicUsize::new(0),
        };
        let result = AgentLoop::run_with_llm(
            PromptBuildInput {
                task_id: "task_1".into(),
                run_id: "run_1".into(),
                goal: "inspect api_key=example-local-token".into(),
                mode_id: None,
                mode_policy_summary: Some("Mode Policy:\n<unresolved>".into()),
                mode_instruction_material: Some("Mode Instructions:\n<unresolved>".into()),
                permission_summary: vec![],
                tool_plan_summary: vec![],
                tool_intent_summary: vec![],
                tool_execution_summary: vec![],
                subtask_orchestration_summary: vec![],
                verification_recovery_diagnostics_summary: vec![],
                selected_index_context: None,
                verification_recovery_context: None,
                context_budget: ContextBudgetSummary::unrequested(
                    &context_window,
                    None,
                    usize::MAX,
                ),
                context_window,
                ledger_summary: vec![],
            },
            &provider,
            &LlmRequestBudget::default(),
            PromptSensitiveGuardMode::Fail,
        );
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Prompt sensitive-content guard failed"));
        assert_eq!(provider.calls.load(Ordering::SeqCst), 0);
    }
}
