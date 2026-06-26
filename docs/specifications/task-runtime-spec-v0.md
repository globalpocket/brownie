# Task Runtime Specification v0

## Purpose

Phase 1.0 adds the minimal task lifecycle authority to the Rust runtime. It does not implement the agent loop, LLM calls, tool execution, AgentModes parsing, indexing, Qdrant, or llama-server integration.

## TaskRecord

A task is persisted as a `TaskRecord` in `.brownie/runs/<run_id>/state.json`.

```text
task_id: string
run_id: string
goal: string
mode_id: string | null
status: TaskStatus
created_at: RFC3339 timestamp
updated_at: RFC3339 timestamp
```

## TaskStatus

Phase 1.0 defines these status values:

- `Created`: the runtime accepted and persisted the task.
- `Failed`: reserved for minimal failure reporting.

No `Running` or `Completed` transitions are performed in Phase 1.0 because the full agent loop is a non-goal.

## Run storage

The runtime treats the workspace root as `BROWNIE_WORKSPACE_ROOT` when set, otherwise the current working directory. Run data is stored under:

```text
.brownie/
└─ runs/
   └─ <run_id>/
      ├─ state.json
      └─ ledger.jsonl
```

## RunLedger

`ledger.jsonl` is append-only JSON Lines. Phase 1.0 emits one event when a task is created:

```text
event_id: string
task_id: string
run_id: string
kind: TaskStarted
timestamp: RFC3339 timestamp
```

The persisted ledger is separate from any future prompt window truncation behavior.

## Phase 1.0 non-goals

- No LLM calls.
- No full agent loop.
- No AgentModes parser, Mode Pack fetch, or Mode Pack activation.
- No tool execution.
- No Qdrant wrapper.
- No llama-server wrapper.
- No codebase indexer.
