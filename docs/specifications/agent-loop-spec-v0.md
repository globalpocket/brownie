# Agent Loop Specification v0

## Purpose

The Brownie agent loop is the runtime authority that advances a task from creation to completion. It must be implemented as an explicit Rust state machine, not as implicit prompt-only behavior.

## Scope

This specification covers the observable task execution behavior Brownie intends to reimplement from Zoo Code-style agent workflows.

## State model

The initial state set is:

```text
TaskCreated
LoadMode
BuildContext
BuildPrompt
CallLlm
ParseAssistantOutput
DecideAction
ExecuteTool
ApplyPatch
SpawnSubtask
Wait
AskUser
Retry
Complete
Failed
Cancelled
```

The Rust crate `brownie-agent-loop` owns this state model. Phase 1.1 includes only a no-op skeleton entry point that accepts task metadata and returns `Completed` with a completion summary; it does not build prompts, call an LLM, execute tools, parse AgentModes, index code, use Qdrant, or use llama-server.

## Runtime authority

The runtime, not the LLM, decides whether an action is allowed.

The invariant is:

```text
LLM instruction < Runtime permission
```

Examples:

- If a mode has no workspace write permission, `apply_patch` is rejected even if the LLM asks to edit.
- If a mode cannot spawn subtasks, subtask creation is rejected even if the LLM asks for delegation.
- If required verification has not run, a completion claim is not accepted.

## Completion gates

A task can enter `Complete` only when all configured completion gates pass.

Initial gates:

- Required artifacts exist or are explicitly marked not applicable.
- Required tool calls have completed.
- Required verification has completed.
- No unresolved tool call remains.
- No unresolved subtask remains.
- File edits, if any, have associated diff records.
- A completion report has been recorded.

## Tool execution

Tool execution is mediated by `brownie-tools` and policy compiled from AgentModes.

Tool results must be recorded into the run ledger. Large tool output can be compacted for prompt materialization, but the ledger remains the source of truth.

## Subtasks

Subtasks must not dump full transcript history back to a parent task.

A parent receives a compact result:

```text
- task id
- assigned mode
- goal
- result summary
- changed files
- tests run
- verification evidence
- unresolved issues
```

## Phase 1.1 skeleton

`AgentLoop::run_noop` is the only executable loop path in Phase 1.1. It exists so the Rust runtime calls the AgentLoop crate while advancing task state from `Created` to `Running` to `Completed`.

## Non-goals for v0

- Production implementation of all Zoo Code loop behaviors.
- Parallel subtask scheduling.
- Distributed task execution.
- Full UI timeline implementation.

## Phase 1.2 fake LLM path

Phase 1.2 adds `AgentLoop::run_with_fake_llm` as the minimal executable prompt path. The loop accepts a materialized `PromptBuildInput`, builds a deterministic `PromptView`, converts that view to an in-process fake LLM request, and returns `Completed` with the deterministic fake response.

This path is local-only. It does not call a real LLM API, open an OpenAI-compatible HTTP client, parse AgentModes, execute tools, fetch or activate Mode Packs, use Qdrant, use llama-server, or run an indexer.

The runtime records prompt and fake-LLM lifecycle metadata in the run ledger around this path. Full prompt text is not persisted by default; the ledger stores counts and short previews only.


## Phase 2.0 LLM provider boundary

Phase 2.0 routes LLM calls through a provider abstraction. The Fake provider remains the default and no external LLM API is contacted unless `BROWNIE_LLM_PROVIDER=openai-compatible` and the required OpenAI-compatible environment configuration are present. The `llm.status` JSON-RPC method reports provider, enabled state, model, base URL, and a non-secret reason; it never returns API keys or Authorization headers. Task ledger LLM request events store only provider/model/message_count metadata, and response events store only provider/content_preview. Streaming and additional tool execution capabilities remain out of scope. See `docs/specifications/llm-provider-spec-v0.md`.

## M5 subtask orchestration queue

M5 records approved `subtask.spawn` intent as runtime-owned queue state. The parent run ledger receives `SubtaskOrchestrationQueued`, and later prompt materialization includes a compact `Subtask Orchestration` summary.

This is not parallel scheduling or child task execution. No subtask is launched, no workspace file is written, no patch is applied, and no process, network, or service-control capability is added.

## M5.1 subtask handoff preparation

M5.1 advances queued subtask evidence into parent-run handoff state. The runtime appends `SubtaskHandoffPrepared` after queueing approved `subtask.spawn` intent, and prompt materialization summarizes that prepared handoff for later passes.

This remains a scheduling foundation only. No child task is launched, no workspace file is written, no patch is applied, and no process, network, or service-control capability is added.

## M5.2 subtask scheduler readiness

M5.2 evaluates prepared subtask handoff state for scheduler readiness. The runtime appends `SubtaskSchedulerReadinessRecorded` after `SubtaskHandoffPrepared`, records that dispatch remains blocked, and exposes the blocker in later prompt materialization.

This is still not child execution. No child task is launched, no workspace file is written, no patch is applied, and no process, network, or service-control capability is added.

## M5.3 subtask dispatch plan preparation

M5.3 converts scheduler-readiness evidence into deterministic parent-run dispatch plan state. The runtime appends `SubtaskDispatchPlanPrepared` after `SubtaskSchedulerReadinessRecorded`, records why dispatch is still blocked, and exposes the plan blocker in later prompt materialization.

This remains planning only. No child task is launched, no workspace file is written, no patch is applied, and no process, network, or service-control capability is added.

## M5.4 subtask dispatch contract preparation

M5.4 converts dispatch-plan evidence into deterministic parent-run dispatch contract and eligibility-gate state. The runtime appends `SubtaskDispatchContractPrepared` after `SubtaskDispatchPlanPrepared`, records the required preconditions for future dispatch, and exposes the contract blocker in later prompt materialization.

This remains contract preparation only. No child task is launched, no workspace file is written, no patch is applied, and no process, network, or service-control capability is added.

## M5.5 subtask dispatch admission evaluation

M5.5 converts dispatch-contract evidence into deterministic parent-run dispatch admission and execution-gate state. The runtime appends `SubtaskDispatchAdmissionEvaluated` after `SubtaskDispatchContractPrepared`, records which preconditions still block admission, and exposes the execution gate blocker in later prompt materialization.

This remains admission evaluation only. No child task is launched, no workspace file is written, no patch is applied, and no process, network, or service-control capability is added.

## M5.6 subtask dispatch readiness snapshot

M5.6 converts dispatch-admission evidence into deterministic parent-run dispatcher-readiness snapshot state. The runtime appends `SubtaskDispatchReadinessSnapshotRecorded` after `SubtaskDispatchAdmissionEvaluated`, records a stable readiness fingerprint and scheduler handoff blocker, and exposes the snapshot in later prompt materialization.

## M5.7 subtask dispatcher guard verdict

M5.7 converts dispatcher-readiness snapshot evidence into deterministic parent-run dispatcher guard verdict state. The runtime appends `SubtaskDispatcherGuardVerdictRecorded` after `SubtaskDispatchReadinessSnapshotRecorded`, records the snapshot fingerprint validity and scheduler handoff preflight blocker, and exposes the guard verdict in later prompt materialization.

This remains guard verdict recording only. No child task is launched, no workspace file is written, no patch is applied, and no process, network, or service-control capability is added.

## M5.8 subtask dispatch decision

M5.8 converts dispatcher guard verdict evidence into deterministic parent-run dispatch decision and dispatch candidate state. The runtime appends `SubtaskDispatchDecisionRecorded` after `SubtaskDispatcherGuardVerdictRecorded`, records `dispatch_decision = "Denied"`, per-candidate blocked counts, and a guard-verdict-derived denial reason, and exposes the decision in later prompt materialization.

This remains dispatch decision recording only. No child task is launched, no scheduler handoff is performed, no workspace file is written, no patch is applied, and no process, network, or service-control capability is added.
