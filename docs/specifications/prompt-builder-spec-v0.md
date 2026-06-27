# Prompt Builder Specification v0

## Purpose

The Phase 1.2 prompt builder defines the first deterministic prompt view used by Brownie Runtime. It exists to make prompt construction testable before real LLM integration.

## Inputs

`ContextMaterializer` produces `PromptBuildInput` from persisted runtime data:

```text
task_id
run_id
goal
mode_id
ledger_summary
```

The task goal comes from `TaskRecord`. The ledger summary comes from the persisted run ledger. Prompt materialization must not truncate or delete ledger records.

## Prompt shape

`PromptBuilder` emits a fixed prompt view with two messages:

1. `System`: identifies Brownie Runtime and states that real LLM/tool execution is disabled in the current phase.
2. `User`: includes task id, run id, mode id, current goal, and deterministic ledger summary lines.

## Persistence rule

Phase 1.2 records prompt lifecycle metadata in the run ledger, but it does not persist the full prompt by default. Ledger payloads may include message counts and short previews.

## Non-goals

- Real LLM calls.
- OpenAI-compatible HTTP client implementation.
- AgentModes parser implementation.
- Tool execution.
- Mode Pack fetch or activation.
- Qdrant, llama-server, or indexer integration.

## Phase 1.3 mode policy prompt summary

`PromptBuildInput` includes an optional mode policy summary materialized from the run ledger. `ContextMaterializer` reads the latest `ModeResolved` event and formats the resolved mode and key permissions for prompt construction.

`PromptBuilder` includes the mode policy summary in the prompt view. This is informational for Phase 1.3 only; permission enforcement is reserved for later runtime phases and remains authoritative over any LLM instruction.

If no `ModeResolved` event is available, the materialized prompt input uses `Mode Policy:\n<unresolved>` as a fallback summary.

## Phase 1.4 permission gate update

Phase 1.4 adds the `RuntimePermissionGate` foundation. Runtime permission checks are based on compiled mode policy capabilities and override LLM instructions.

Runtime actions are `ReadWorkspace`, `WriteWorkspace`, `ExecuteProcess`, `AccessNetwork`, `ControlService`, `DestructiveOperation`, and `SpawnSubtask`. Phase 1.4 records permission decisions only; it does not execute real tools, write files, apply patches, execute processes, call real LLM APIs, parse AgentModes YAML, fetch Mode Packs, or implement Qdrant/llama-server/indexer behavior.

The runtime protocol includes `permission.check`. Task runs append `PermissionChecked` ledger events for minimum checks and append `PermissionDenied` when a checked action is denied. `ModeResolved` stores a full permission snapshot so prompt materialization can summarize active mode capabilities.

## Phase 1.5 tool planning update

Phase 1.5 adds dry-run tool planning before future tool execution. Tool definitions and plans are declarative only and do not perform file reads, file writes, process execution, subtask spawning, network access, service control, or destructive operations. Planned tools are evaluated through `RuntimePermissionGate`; denied dry-run items are recorded but do not fail `task.run` in Phase 1.5. See `docs/specifications/tool-planning-spec-v0.md`.

## Phase 1.6 assistant tool intent dry-run

Phase 1.6 adds assistant tool intent parsing from fenced `brownie-tool-intent` JSON blocks. The runtime validates all requested tool IDs against `BuiltinToolRegistry` and evaluates valid requests with `RuntimePermissionGate`. Denied or rejected assistant tool intent is recorded for inspection, but no tool is executed and `task.run` remains allowed to complete in this phase.

## Phase 1.8 task-scoped read-only execution

Phase 1.8 introduces task-scoped execution for approved assistant `workspace.read` tool intents only. Assistant tool intent requests may include an `input` object; omitted input is treated as `{}`, and non-object input is rejected before permission evaluation.

During `task.run`, denied intents, rejected intents, and non-read tool intents are not executed. Even if another tool intent is permission-approved for planning or policy purposes, Phase 1.8 does not execute write, process, subtask, network, service, or destructive operations.

For approved `workspace.read` intents with explicit `input.path`, the runtime records `ToolExecutionRequested`, `ToolExecutionPermissionChecked`, and one terminal `ToolExecutionCompleted`, `ToolExecutionDenied`, or `ToolExecutionFailed` ledger event. The ledger stores execution metadata and a bounded output preview only; full file content is not persisted to the ledger. `task.run` remains `Completed` even if this read-only execution fails in Phase 1.8.

## Phase 1.9 tool feedback loop

Phase 1.9 introduces a second-pass Fake LLM feedback loop inside `task.run` after an approved `workspace.read` execution completes. The runtime re-reads the task ledger, materializes the tool execution summary into the next prompt, builds a second-pass prompt, and records `SecondPassPromptBuilt`, `SecondPassLlmRequestCreated`, and `SecondPassLlmResponseReceived` ledger events.

The second pass runs only when at least one `ToolExecutionCompleted` event exists. `workspace.read` results are summarized into prompt materialization as metadata such as status, `bytes_read`, and `truncated`; full file content is not persisted in the ledger. Phase 1.9 does not add write, process, network, service-control, destructive, or subtask execution, and it continues to use only the in-process Fake LLM.
