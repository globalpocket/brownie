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
- `IndexCodebase` — controlled by `codebase_index`.
- `UseMcpTool` — controlled by `mcp_tool_access` plus structured MCP allow-list provenance.
- `UseGitCapability` — controlled by `process_exec` in the compiled mode
  policy, but exposed only through runtime-owned bounded Git capabilities.

The `read_only` field is informational for summaries. Individual capabilities are authoritative for gate decisions. Prompt text, role definitions, and completion rules cannot grant permissions that are not present in the compiled mode policy.

MCP tool execution is a runtime action, not a text-derived capability. A mode
must have compiled `mcp_tool_access`, the server/tool pair must appear in the
structured Mode Pack allow-list, and the current catalog entry must match
task-pinned MCP provenance before Runtime may call a normalized
`mcp.<server_id>.<tool_name>` tool. See `mcp-client-spec-v0.md`.

MP-3.1 adds scoped workspace-write checks for compiled AgentModes policy. When a
mode has `workspace_write=true` and no `workspace_write_scopes`, the action bit
continues to allow generic writes subject to later proposal/apply checks. When
scopes are present, `RuntimePermissionGate` must also check the requested
workspace-relative path against the compiled static scope, such as an AgentModes
`edit.fileRegex`. A path outside the compiled scope is denied even though the
mode has the general write bit. Prompt prose cannot widen or add scopes.

MP-4 wires those scoped checks into generic workspace editing. Assistant
`workspace.write` intent is checked against the concrete requested path before
proposal admission, and `proposal.apply` repeats the check against the
task-pinned proposal path before mutation. Approval and preflight evidence do
not grant permission; they only satisfy additional apply gates after
`RuntimePermissionGate` allows the scoped write.

MP-7 adds dedicated runtime-owned Git capability execution. `git.status`,
`git.diff`, and `git.commit` require `UseGitCapability` at point of use and
must stay scoped to the admitted workspace repository. `git.commit` accepts only
a bounded commit message and creates a commit from already staged changes; argv,
cwd, environment, stdin, shell, remote, path, branch, ref, revision, push,
remote mutation, branch deletion, and PR creation remain outside this
capability. Ledger evidence is summary-only and must not persist raw diffs, raw
file content, raw commit message text, command strings, environment values,
absolute paths, canonical paths, credentials, or secrets. Replays of the same
commit intent must not create duplicate commits.

MP-7.1 clarifies that `UseGitCapability` is narrower than generic process
execution. A mode with `process_exec` can pass this gate only for the runtime's
fixed Git capability ids and only after task/workspace provenance establishes
the admitted repository. The gate does not authorize caller-supplied commands,
argv, cwd, environment, stdin, shell, timeouts, remotes, branches, refs, pushes,
PRs, service control, destructive operations, network access, or workspace
write mutation. `git.status` and `git.diff` outputs may become bounded
`untrusted_git_result_context` for the next agent step, but that context is
below runtime and Mode Pack policy and cannot create or widen authority.
Timeout, oversize, and process-lifecycle evidence is safety telemetry only; it
does not substitute for durable permission checks.

## JSON-RPC

`permission.check` accepts a built-in `mode_id` and action name, resolves the mode through the built-in registry, and returns an allowed/denied decision with a human-readable reason. Unknown modes return JSON-RPC `-32602`.

## Ledger events

`task.run` records `PermissionChecked` events for minimum Phase 1.4 checks: `ReadWorkspace`, `SpawnSubtask`, `WriteWorkspace`, and `ExecuteProcess`. Denied checks also append a `PermissionDenied` event with the same payload.

Phase 1.4 does not execute real tools, apply file edits, execute processes, call real LLM APIs, fetch Mode Packs, parse AgentModes YAML, or implement Qdrant/llama-server/indexer wrappers.

MP-1 permits external Mode Pack policies to compile trusted `workspace_write`
and `process_exec` bits into the same permission snapshot shape used by built-in
modes. `RuntimePermissionGate` remains the final authority for `WriteWorkspace`
and `ExecuteProcess`, including active Mode Pack snapshots and task-pinned
`ModeResolved` policy. Contradictory `read_only=true` plus side-effect
capability declarations are invalid, and unsupported external network, service
control, and destructive capabilities remain fail-closed.

M9.2 adds `IndexCodebase` as the runtime action for `codebase.index.build`.
The check is performed in Rust before scanning. The action allows bounded
metadata-only index construction and does not imply workspace writes, process
execution, network access, service control, destructive operations, query,
retrieval, chunks, embeddings, or Qdrant writes.

M12.1 keeps `SpawnSubtask` as the permission bit for subtask capability and adds
a second Rust-owned admission check for external Mode Pack handoff targets. A
mode that may spawn subtasks can still be denied for a specific `subtask.spawn`
request when the requested `input.mode_id` is unknown or absent from that mode's
`allowed_handoff_targets`. This denial is recorded as bounded tool-intent
evidence before queueing, and it does not create or materialize a child task.

MP-3.2A adds the bounded `$modepack/*` handoff selector for large external Mode
Packs. The selector does not bypass `SpawnSubtask`; the active policy must still
allow subtask spawning, the requested child mode must resolve from the
task-pinned Mode Pack policy, and self-dispatch through the selector is denied
before queueing. Explicit target lists remain bounded, and the selector cannot
be mixed with explicit targets.

## Phase 1.5 tool planning update

Phase 1.5 adds dry-run tool planning before future tool execution. Tool definitions and plans are declarative only and do not perform file reads, file writes, process execution, subtask spawning, network access, service control, or destructive operations. Planned tools are evaluated through `RuntimePermissionGate`; denied dry-run items are recorded but do not fail `task.run` in Phase 1.5. See `docs/specifications/tool-planning-spec-v0.md`.

## Phase 1.6 assistant tool intent dry-run

Phase 1.6 adds assistant tool intent parsing from fenced `brownie-tool-intent` JSON blocks. The runtime validates all requested tool IDs against `BuiltinToolRegistry` and evaluates valid requests with `RuntimePermissionGate`. Denied or rejected assistant tool intent is recorded for inspection, but no tool is executed and `task.run` remains allowed to complete in this phase.

## Phase 1.7 read-only tool execution note

Phase 1.7 adds standalone `tool.execute` for permission-gated `workspace.read` execution only. All writes, process execution, subtasks, network access, service control, and destructive operations remain non-executable. `task.run` does not automatically execute tools in Phase 1.7. See `docs/specifications/tool-execution-spec-v0.md` for workspace boundary, protected path, truncation, UTF-8, and ledger behavior.
