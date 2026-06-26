//! Agent loop state-machine crate.

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

pub struct AgentLoop;

impl AgentLoop {
    pub fn run_noop(input: AgentLoopInput) -> AgentLoopResult {
        AgentLoopResult {
            final_state: AgentLoopState::Completed,
            completion_summary: format!("No-op agent loop completed for {}", input.task_id),
        }
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
}
