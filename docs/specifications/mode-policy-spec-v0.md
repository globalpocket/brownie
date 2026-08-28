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

Runtime actions are `ReadWorkspace`, `WriteWorkspace`, `ExecuteProcess`, `AccessNetwork`, `ControlService`, `DestructiveOperation`, `SpawnSubtask`, and `IndexCodebase`. Phase 1.4 records permission decisions only; it does not execute real tools, write files, apply patches, execute processes, call real LLM APIs, parse AgentModes YAML, fetch Mode Packs, or implement Qdrant/llama-server/indexer behavior.

The runtime protocol includes `permission.check`. Task runs append `PermissionChecked` ledger events for minimum checks and append `PermissionDenied` when a checked action is denied. `ModeResolved` stores a full permission snapshot so prompt materialization can summarize active mode capabilities.

## M2 local Mode Pack policy update

M2 keeps the built-in stub registry, then loads active or workspace Mode Pack
modes from `.brownie/modepack.json` when present. MP-3.1 permits an active
Mode Pack mode to reuse a built-in fallback id; the external policy shadows the
built-in policy for `mode.list`, `mode.get`, `permission.check`, explicit
`mode_id` resolution in `task.start`, and omitted `brownie run` entrypoint
resolution when the active Mode Pack default selects it.

Built-in modes remain available for ids not supplied by the active/workspace
Mode Pack and remain the default when `task.start` omits `mode_id`. Mode Pack
modes must still use unique `mode_id` values within the Mode Pack itself.
Unsupported permission expansion is rejected at load time: local modes cannot
enable network access, service control, or destructive operations.

For running tasks, the resolved policy is snapshotted into the `ModeResolved` ledger payload. `task.run` prefers that snapshot over re-reading the current Mode Pack file.

## MP-3 AgentModes workflow policy fields

MP-3 extends `CompiledModePolicy` so representative AgentModes YAML can compile
into stable runtime policy without moving AgentModes workflow decisions into
Rust. In addition to the permission bits, compiled modes may carry
`when_to_use`, `description`, bounded `prompt_sections`,
`workspace_write_scopes`, `allowed_handoff_targets`, and an
`instruction_fingerprint`.

MP-3.1 requires structured source data, not prose keywords, for runtime
semantics. `when_to_use` remains mode-selection metadata and does not become a
completion rule. Prompt prose and role definitions do not grant verification
ownership, completion authority, side-effect capability, or delegation
authority. Structured `edit` metadata such as `fileRegex` is preserved as
`workspace_write_scopes`; if scopes are present, workspace write permission is
valid only for paths matching a compiled scope.

Compiled external capability is effective capability, not merely declared
capability. The compiler/runtime materialization must intersect declared groups
with source trust and the runtime global capability ceiling. Trust is not a
permission source; it can only narrow side-effect authority. Untrusted
repository-local policy cannot grant process execution to itself.

`ModeResolved` stores the full effective policy for the admitted task, including
the instruction fields. `task.run` reconstructs policy from that task-pinned
snapshot, and active Mode Pack fingerprints include the same fields. Later edits
to a live Mode Pack file therefore cannot alter role text, custom instructions,
write scopes, handoff targets, or other compiled workflow policy for an already
admitted task.

Policy precedence is fixed: runtime safety invariants override compiled Mode
Pack permission policy, compiled permission policy overrides mode instructions,
mode instructions override task/objective text, and prompt text never grants
side-effect authority. `RuntimePermissionGate` remains the final authority for
workspace writes, process execution, network/service/destructive actions, and
subtask spawning.

Prompt materialization must show task-pinned effective policy, not live
Mode Pack drift. The protected system policy summary includes effective
permission bits, `workspace_write_scopes`, and `allowed_handoff_targets` from
the admitted `ModeResolved` payload so the model sees the same constrained
capability surface that `RuntimePermissionGate` enforces.
