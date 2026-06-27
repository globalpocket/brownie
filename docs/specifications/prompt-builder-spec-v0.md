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
