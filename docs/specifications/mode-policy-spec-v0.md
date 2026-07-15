# Mode Policy Spec v0

## Phase 1.3 scope

Phase 1.3 introduces the runtime-side foundation for mode policies without implementing the full AgentModes parser or Mode Pack lifecycle.

In scope:

- `CompiledModePolicy` in `brownie-agentmodes`.
- A static built-in stub registry containing `orchestrator`, `implementer`, and `verifier`.
- Resolution of `mode_id` to a compiled policy during `task.start`.
- Ledger recording of compact `ModeResolved` summaries.
- Prompt materialization of the resolved mode policy summary.
- JSON-RPC `mode.list` and `mode.get` methods.

Out of scope:

- AgentModes YAML parsing.
- Mode Pack fetch, validation, activation, or hot updates.
- Tool execution and runtime permission enforcement.
- Real LLM API calls.

## Policy precedence

Runtime permission policy is authoritative and is designed to override any LLM instruction. Phase 1.3 only resolves, stores, and exposes policy summaries; later phases will enforce permissions at runtime boundaries.

## Phase 1.4 permission gate update

Phase 1.4 adds the `RuntimePermissionGate` foundation. Runtime permission checks are based on compiled mode policy capabilities and override LLM instructions.

Runtime actions are `ReadWorkspace`, `WriteWorkspace`, `ExecuteProcess`, `AccessNetwork`, `ControlService`, `DestructiveOperation`, and `SpawnSubtask`. Phase 1.4 records permission decisions only; it does not execute real tools, write files, apply patches, execute processes, call real LLM APIs, parse AgentModes YAML, fetch Mode Packs, or implement Qdrant/llama-server/indexer behavior.

The runtime protocol includes `permission.check`. Task runs append `PermissionChecked` ledger events for minimum checks and append `PermissionDenied` when a checked action is denied. `ModeResolved` stores a full permission snapshot so prompt materialization can summarize active mode capabilities.

## M2 local Mode Pack policy update

M2 keeps the built-in stub registry, then appends locally loaded Mode Pack modes from `.brownie/modepack.json` when present. The runtime uses this merged policy set for `mode.list`, `mode.get`, `permission.check`, and explicit `mode_id` resolution in `task.start`.

Built-in modes remain available and remain the default when `task.start` omits `mode_id`. Local Mode Pack modes must use unique `mode_id` values that do not duplicate existing runtime modes. Unsupported permission expansion is rejected at load time: local modes must be read-only and cannot enable workspace writes, process execution, network access, service control, or destructive operations.

For running tasks, the resolved policy is snapshotted into the `ModeResolved` ledger payload. `task.run` prefers that snapshot over re-reading the current Mode Pack file.
