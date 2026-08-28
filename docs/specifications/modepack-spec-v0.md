# Mode Pack Specification v0

## Purpose

Brownie treats AgentModes as an external Mode Pack.

`brownie-modepack` manages retrieval, validation, compilation, activation, and rollback of Mode Pack snapshots.

## Core rule

Brownie executes a validated snapshot, not a live branch.

## Snapshot lifecycle

- check for a newer revision
- fetch a candidate revision
- show differences
- validate mode definitions
- compile policies
- activate the candidate
- rollback when needed

## Lock data

The active snapshot should record:

- modepack name
- repository location
- branch or tag
- commit id
- schema version
- compilation time

## Running task rule

A running task keeps the Mode Pack snapshot selected at task start. Later Mode Pack activation applies only to new tasks unless an explicit task migration is implemented.

## M2 local runtime slice

M2 adds a local-only Mode Pack snapshot path at `.brownie/modepack.json`. The file is parsed by `brownie-modepack` and may contribute additional compiled modes to existing runtime mode paths:

- `mode.list`
- `mode.get`
- `permission.check`
- `task.start`

The M2 JSON schema is intentionally minimal:

```json
{
  "name": "local-agentmodes",
  "schema_version": 1,
  "modes": [
    {
      "mode_id": "reviewer-lite",
      "display_name": "Reviewer Lite",
      "role_definition": "Review local changes without writing files.",
      "permissions": {
        "read_only": true,
        "workspace_write": false,
        "process_exec": false,
        "network_access": false,
        "service_control": false,
        "destructive": false,
        "can_spawn_subtasks": false,
        "codebase_index": false
      },
      "completion_rules": ["Stop after reporting local review findings."]
    }
  ]
}
```

M2 does not fetch remote Mode Packs. M9.2 permits Mode Packs to opt into metadata-only codebase indexing with `codebase_index`; omitted fields default to `false` for compatibility. `task.start` stores the resolved policy summary in `ModeResolved`, and `task.run` reconstructs the policy from that ledger snapshot so later Mode Pack edits do not change already-started tasks.

MP-1 allows external Mode Packs to declare trusted `workspace_write` and
`process_exec` capability bits for editor, tester, and integrator-style modes.
`read_only` is summary metadata and must not be combined with side-effect
capabilities. Network access, service control, and destructive operations remain
unsupported external capabilities and are rejected fail-closed during Mode Pack
validation. The runtime compiles declared capability bits into policy data and
continues to require every side effect to pass `RuntimePermissionGate`; prompt
text, role definitions, and completion rules cannot grant capability authority.
MP-1 does not add Mode Pack entrypoint selection, AgentModes compiler expansion,
generic workspace editing, generic process execution, Git capability, delegation
execution, or Rust-owned workflow sequencing.

## MP-2 default entrypoint

MP-2 adds an optional top-level `entrypoints.default` field to the Mode Pack
schema:

```json
{
  "name": "local-agentmodes",
  "schema_version": 1,
  "entrypoints": {
    "default": "external-orchestrator"
  },
  "modes": [
    {
      "mode_id": "external-orchestrator",
      "display_name": "External Orchestrator",
      "role_definition": "Select the workflow route.",
      "permissions": {
        "read_only": true,
        "workspace_write": false,
        "process_exec": false,
        "network_access": false,
        "service_control": false,
        "destructive": false,
        "can_spawn_subtasks": false,
        "codebase_index": false
      }
    }
  ]
}
```

The default entrypoint must reference a mode in the same compiled snapshot. The
mode id reference is normalized with the same bounded ASCII shape as handoff
targets: non-empty, 64 characters or fewer, and limited to letters, digits,
`.`, `_`, and `-`. Unknown, blank, or unsupported values fail closed during Mode
Pack validation.

For the CLI primary run path, `brownie run "<objective>"` starts a headless
journey without a CLI-selected mode. The runtime resolves that omitted journey
task mode to the active Mode Pack snapshot's `entrypoints.default` when present.
If no active snapshot exists, the runtime may resolve the local workspace Mode
Pack default. If no Mode Pack default exists, the legacy built-in headless
fallback remains `implementer`. Direct low-level `task.start` omitted-mode
behavior remains the built-in runtime default policy and is not a Mode Pack
workflow selector.

Active Mode Pack snapshot summaries store `default_entrypoint`, and active
compiled-policy and activation fingerprints include it. Journey start
fingerprints are computed from the runtime-resolved effective task start, so
replay and stale-conflict checks bind the same entrypoint decision instead of
letting the CLI choose or rewrite workflow policy. `ModeResolved` continues to
store the task-pinned policy and external Mode Pack provenance, and every
side-effect still passes `RuntimePermissionGate`.

## M12.1 handoff target admission

M12.1 lets an external Mode Pack mode with `can_spawn_subtasks=true` declare an
`allowed_handoff_targets` array. The array is required for spawning external
modes, capped at 16 entries, and each target id must be non-empty, duplicate-free,
64 characters or fewer, and limited to ASCII letters, digits, `.`, `_`, and `-`.
Modes without `can_spawn_subtasks` must omit the field or leave it empty.

At runtime, `subtask.spawn` admission first uses the existing permission gate for
`SpawnSubtask`, then verifies that the requested `input.mode_id` exists and is in
the active mode policy's `allowed_handoff_targets` when that policy declares one.
Denied targets append bounded denial evidence before subtask queueing or child
materialization. Built-in modes keep unrestricted legacy handoff behavior by
storing no target allow-list.

## M12.2 controlled child snapshot provenance

M12.2 carries the external Mode Pack policy boundary from parent admission into
controlled child execution. When a child task is materialized from an external
Mode Pack handoff target, the child `TaskStarted` evidence stores bounded
`external_modepack_child_provenance`: source kind, Mode Pack name, schema
version, workspace-relative Mode Pack path, child mode id, policy fingerprint,
parent run id, and handoff envelope identifiers.

`task.run` validates that provenance before recording `TaskRunning` for the
queued child. Missing, malformed, stale, or mismatched external Mode Pack child
provenance is denied before provider or tool execution. The denial evidence is
bounded and must not include raw Mode Pack JSON, raw prompts, provider
responses, file content, stdout, stderr, commands, environment values, secrets,
request bodies, absolute paths, or canonical paths.

## Non-goals for v0

- Vendoring AgentModes into Brownie.
- Changing active mode definitions during a running task.
