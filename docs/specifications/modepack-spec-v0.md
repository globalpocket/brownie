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

M2 does not fetch remote Mode Packs. It rejects Mode Pack modes that request workspace writes, process execution, network access, service control, destructive operations, or non-read-only permissions. M9.2 permits Mode Packs to opt into metadata-only codebase indexing with `codebase_index`; omitted fields default to `false` for compatibility. `task.start` stores the resolved policy summary in `ModeResolved`, and `task.run` reconstructs the policy from that ledger snapshot so later Mode Pack edits do not change already-started tasks.

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

## Non-goals for v0

- Vendoring AgentModes into Brownie.
- Changing active mode definitions during a running task.
