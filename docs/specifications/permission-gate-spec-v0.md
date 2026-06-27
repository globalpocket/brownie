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
