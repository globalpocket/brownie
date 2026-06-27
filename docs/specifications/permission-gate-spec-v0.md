# Permission Gate Spec v0

Phase 1.4 introduces the runtime permission gate foundation. The gate is a runtime-enforced policy boundary and takes precedence over any LLM instruction or generated plan.

## Runtime actions

`RuntimePermissionGate` evaluates these actions against a `CompiledModePolicy` permission snapshot:

- `ReadWorkspace` — always allowed.
- `WriteWorkspace` — controlled by `workspace_write`.
- `ExecuteProcess` — controlled by `process_exec`.
- `AccessNetwork` — controlled by `network_access`.
- `ControlService` — controlled by `service_control`.
- `DestructiveOperation` — controlled by `destructive`.
- `SpawnSubtask` — controlled by `can_spawn_subtasks`.

The `read_only` field is informational for summaries. Individual capabilities are authoritative for gate decisions.

## JSON-RPC

`permission.check` accepts a built-in `mode_id` and action name, resolves the mode through the built-in registry, and returns an allowed/denied decision with a human-readable reason. Unknown modes return JSON-RPC `-32602`.

## Ledger events

`task.run` records `PermissionChecked` events for minimum Phase 1.4 checks: `ReadWorkspace`, `SpawnSubtask`, `WriteWorkspace`, and `ExecuteProcess`. Denied checks also append a `PermissionDenied` event with the same payload.

Phase 1.4 does not execute real tools, apply file edits, execute processes, call real LLM APIs, fetch Mode Packs, parse AgentModes YAML, or implement Qdrant/llama-server/indexer wrappers.

## Phase 1.5 tool planning update

Phase 1.5 adds dry-run tool planning before future tool execution. Tool definitions and plans are declarative only and do not perform file reads, file writes, process execution, subtask spawning, network access, service control, or destructive operations. Planned tools are evaluated through `RuntimePermissionGate`; denied dry-run items are recorded but do not fail `task.run` in Phase 1.5. See `docs/specifications/tool-planning-spec-v0.md`.

## Phase 1.6 assistant tool intent dry-run

Phase 1.6 adds assistant tool intent parsing from fenced `brownie-tool-intent` JSON blocks. The runtime validates all requested tool IDs against `BuiltinToolRegistry` and evaluates valid requests with `RuntimePermissionGate`. Denied or rejected assistant tool intent is recorded for inspection, but no tool is executed and `task.run` remains allowed to complete in this phase.

## Phase 1.7 read-only tool execution note

Phase 1.7 adds standalone `tool.execute` for permission-gated `workspace.read` execution only. All writes, process execution, subtasks, network access, service control, and destructive operations remain non-executable. `task.run` does not automatically execute tools in Phase 1.7. See `docs/specifications/tool-execution-spec-v0.md` for workspace boundary, protected path, truncation, UTF-8, and ledger behavior.
