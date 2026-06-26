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
