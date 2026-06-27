# Task Runtime Specification v0

## Purpose

Phase 1.1 extends the minimal task lifecycle authority in the Rust runtime with no-op task execution. It does not implement LLM calls, tool execution, AgentModes parsing, indexing, Qdrant, or llama-server integration.

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

Phase 1.1 defines these status values:

- `Created`: the runtime accepted and persisted the task.
- `Running`: `task.run` has started the no-op AgentLoop skeleton.
- `Completed`: the no-op AgentLoop skeleton completed successfully.
- `Failed`: reserved for runtime or future AgentLoop failure reporting.
- `Cancelled`: reserved for future cancellation handling.

In Phase 1.1, only `Created -> Running -> Completed` is implemented.

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

`ledger.jsonl` is append-only JSON Lines. Phase 1.1 emits task lifecycle events:

```text
event_id: string
task_id: string
run_id: string
kind: TaskStarted | TaskRunning | TaskCompleted | TaskFailed | TaskCancelled
timestamp: RFC3339 timestamp
```

The persisted ledger is separate from any future prompt window truncation behavior.

## `task.run`

`task.run` advances a `Created` task to `Running`, calls the no-op AgentLoop skeleton, then persists `Completed`. The runtime updates `state.json` and appends `TaskRunning` and `TaskCompleted` events to `ledger.jsonl`. Running an unknown task or a task that is not `Created` returns invalid params.

## Phase 1.1 non-goals

- No LLM calls.
- No full agent loop.
- No AgentModes parser, Mode Pack fetch, or Mode Pack activation.
- No tool execution.
- No Qdrant wrapper.
- No llama-server wrapper.
- No codebase indexer.

## Phase 1.2 prompt and fake LLM execution

Phase 1.2 changes `task.run` from the no-op loop to a minimal prompt/fake-LLM path while keeping the runtime as the task lifecycle authority.

The implemented transition remains:

```text
Created -> Running -> Completed
```

After writing `TaskRunning`, the runtime reads the run ledger, materializes prompt input from the current task and ledger events, builds a prompt through the agent loop, creates a local fake LLM request, receives a deterministic fake response, writes `Completed` to `state.json`, and appends `TaskCompleted`.

Phase 1.2 ledger event kinds are:

```text
TaskStarted
TaskRunning
PromptBuilt
LlmRequestCreated
LlmResponseReceived
TaskCompleted
TaskFailed
TaskCancelled
```

`LedgerEvent` may include an optional `payload` object. Prompt and fake-LLM events store metadata such as `message_count`, `model`, `prompt_preview`, and `content_preview`. Full prompt text is not persisted by default.

Phase 1.2 still does not call a real LLM API, implement an OpenAI-compatible HTTP client, execute tools, parse AgentModes, fetch or activate Mode Packs, use Qdrant, use llama-server, or run an indexer.

## Phase 1.3 mode resolution during task.start

`task.start` resolves the requested `mode_id` before creating a task record. If `mode_id` is omitted or `null`, the runtime uses the default built-in `orchestrator` policy and stores `mode_id: "orchestrator"` in `state.json`.

If a caller supplies an unknown `mode_id`, `task.start` returns JSON-RPC `-32602 invalid params` and does not create a task. This prevents tasks from running without a resolved runtime policy.

After task creation, the run ledger records `TaskStarted` followed by `ModeResolved`. The `ModeResolved` payload stores a compact policy summary rather than the full policy.

## Phase 1.4 permission gate update

Phase 1.4 adds the `RuntimePermissionGate` foundation. Runtime permission checks are based on compiled mode policy capabilities and override LLM instructions.

Runtime actions are `ReadWorkspace`, `WriteWorkspace`, `ExecuteProcess`, `AccessNetwork`, `ControlService`, `DestructiveOperation`, and `SpawnSubtask`. Phase 1.4 records permission decisions only; it does not execute real tools, write files, apply patches, execute processes, call real LLM APIs, parse AgentModes YAML, fetch Mode Packs, or implement Qdrant/llama-server/indexer behavior.

The runtime protocol includes `permission.check`. Task runs append `PermissionChecked` ledger events for minimum checks and append `PermissionDenied` when a checked action is denied. `ModeResolved` stores a full permission snapshot so prompt materialization can summarize active mode capabilities.
