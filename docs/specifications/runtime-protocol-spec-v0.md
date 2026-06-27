# Runtime Protocol Specification v0

## Purpose

Brownie VSIX and Brownie Runtime communicate through a stable protocol boundary.

The runtime uses newline-delimited JSON (NDJSON) JSON-RPC 2.0 messages over stdio as the initial process boundary.

```text
Code-OSS / Brownie VSIX
  -> stdio NDJSON JSON-RPC
Brownie Runtime
```

## Framing

The runtime reads stdin one line at a time. Each non-empty line is one complete JSON-RPC request. For every request line, the runtime writes exactly one JSON-RPC response line to stdout and flushes stdout before reading the next request.

Empty input lines are ignored. Invalid JSON produces a JSON-RPC parse error response with code `-32700` and a `null` id.

For direct smoke testing without a JSON-RPC request, the runtime binary may still emit the bare status object when stdin is attached to a terminal.

## Workspace root and store path

The runtime resolves its workspace root in this order:

1. `BROWNIE_WORKSPACE_ROOT`
2. current working directory

Task run data is stored under:

```text
.brownie/
└─ runs/
   └─ <run_id>/
      ├─ state.json
      └─ ledger.jsonl
```

`state.json` contains the persisted `TaskRecord`. `ledger.jsonl` contains append-only RunLedger events, one JSON object per line.

## `runtime.status`

Request line:

```json
{"jsonrpc":"2.0","id":1,"method":"runtime.status"}
```

Expected response line:

```json
{"jsonrpc":"2.0","id":1,"result":{"name":"brownie-runtime","version":"0.1.0","status":"Ready"}}
```

## `task.start`

Creates a persisted task record and appends a `TaskStarted` ledger event. Runtime is the authority for task IDs, run IDs, status, and persistence.

Request line:

```json
{"jsonrpc":"2.0","id":1,"method":"task.start","params":{"goal":"Implement something","mode_id":"orchestrator"}}
```

Expected response line:

```json
{"jsonrpc":"2.0","id":1,"result":{"task_id":"task_<uuid>","run_id":"run_<uuid>","status":"Created"}}
```

`goal` must be non-empty after trimming whitespace. Empty goals return `-32602`.

## `task.get`

Returns a persisted task by `task_id`.

Request line:

```json
{"jsonrpc":"2.0","id":2,"method":"task.get","params":{"task_id":"task_<uuid>"}}
```

Expected response result shape:

```json
{
  "task_id": "task_<uuid>",
  "run_id": "run_<uuid>",
  "goal": "Implement something",
  "mode_id": "orchestrator",
  "status": "Created | Running | Completed | Failed | Cancelled",
  "created_at": "2026-06-26T00:00:00Z",
  "updated_at": "2026-06-26T00:00:00Z"
}
```

Missing tasks return `-32602` in Phase 1.0.

## `task.run`

Runs a `Created` task through the Phase 1.1 no-op AgentLoop skeleton. The runtime is authoritative for transitions and persists `Running` and `Completed` state changes before returning.

Request line:

```json
{"jsonrpc":"2.0","id":2,"method":"task.run","params":{"task_id":"task_<uuid>"}}
```

Expected response line:

```json
{"jsonrpc":"2.0","id":2,"result":{"task_id":"task_<uuid>","run_id":"run_<uuid>","status":"Completed"}}
```

Unknown tasks and tasks whose status is not `Created` return `-32602`. Phase 1.1 does not call an LLM, execute tools, parse AgentModes, use Qdrant, use llama-server, or run an indexer.

## `task.list`

Returns all persisted tasks discovered in `.brownie/runs/*/state.json`.

Request line:

```json
{"jsonrpc":"2.0","id":3,"method":"task.list"}
```

Expected response result shape:

```json
{"tasks":[{"task_id":"task_<uuid>","run_id":"run_<uuid>","goal":"Implement something","mode_id":"orchestrator","status":"Created","created_at":"2026-06-26T00:00:00Z","updated_at":"2026-06-26T00:00:00Z"}]}
```

## Errors

The runtime returns JSON-RPC errors for protocol failures that it can report:

- `-32700` for parse errors.
- `-32600` for invalid requests, including invalid JSON-RPC versions.
- `-32601` for unknown methods.
- `-32602` for invalid params, including empty task goals and missing task IDs.
- `-32603` for internal errors.

## Rule

The VSIX is a presentation and workspace bridge. Runtime policy and task execution remain in Rust.

## Phase 1.2 `task.run` behavior

In Phase 1.2, the `task.run` JSON-RPC request and response shape are unchanged, but the runtime now connects the task to prompt materialization and a deterministic local fake LLM adapter.

For a `Created` task, the runtime performs this ordered lifecycle:

```text
TaskStarted
TaskRunning
PromptBuilt
LlmRequestCreated
LlmResponseReceived
TaskCompleted
```

The response still reports `Completed` on success. The additional ledger events contain metadata only, such as message counts, fake model name, and short previews. Full prompt text is not persisted by default.

The fake LLM adapter is deterministic and local-only. Phase 1.2 performs no real LLM network calls and does not introduce tool execution, AgentModes parsing, Mode Pack fetch or activation, Qdrant, llama-server, or indexing behavior.

## Phase 1.3 mode protocol methods

Phase 1.3 adds `mode.list` and `mode.get` JSON-RPC methods backed by the built-in stub mode registry. These methods do not fetch or parse external AgentModes repositories.

`mode.list` returns `{ "modes": ModeSummary[] }`, where each summary includes `mode_id`, `display_name`, `role_definition`, and permission booleans. `mode.get` accepts `{ "mode_id": string }` and returns one `ModeSummary`.

Unknown mode IDs passed to `mode.get` return JSON-RPC `-32602 invalid params`. `task.start` applies the same unknown-mode rejection, while omitted or `null` `mode_id` defaults to `orchestrator`.

## Phase 1.4 permission gate update

Phase 1.4 adds the `RuntimePermissionGate` foundation. Runtime permission checks are based on compiled mode policy capabilities and override LLM instructions.

Runtime actions are `ReadWorkspace`, `WriteWorkspace`, `ExecuteProcess`, `AccessNetwork`, `ControlService`, `DestructiveOperation`, and `SpawnSubtask`. Phase 1.4 records permission decisions only; it does not execute real tools, write files, apply patches, execute processes, call real LLM APIs, parse AgentModes YAML, fetch Mode Packs, or implement Qdrant/llama-server/indexer behavior.

The runtime protocol includes `permission.check`. Task runs append `PermissionChecked` ledger events for minimum checks and append `PermissionDenied` when a checked action is denied. `ModeResolved` stores a full permission snapshot so prompt materialization can summarize active mode capabilities.

## Phase 1.5 tool planning update

Phase 1.5 adds dry-run tool planning before future tool execution. Tool definitions and plans are declarative only and do not perform file reads, file writes, process execution, subtask spawning, network access, service control, or destructive operations. Planned tools are evaluated through `RuntimePermissionGate`; denied dry-run items are recorded but do not fail `task.run` in Phase 1.5. See `docs/specifications/tool-planning-spec-v0.md`.

## Phase 1.6 assistant tool intent dry-run

Phase 1.6 adds assistant tool intent parsing from fenced `brownie-tool-intent` JSON blocks. The runtime validates all requested tool IDs against `BuiltinToolRegistry` and evaluates valid requests with `RuntimePermissionGate`. Denied or rejected assistant tool intent is recorded for inspection, but no tool is executed and `task.run` remains allowed to complete in this phase.

## Phase 1.7 read-only tool execution note

Phase 1.7 adds standalone `tool.execute` for permission-gated `workspace.read` execution only. All writes, process execution, subtasks, network access, service control, and destructive operations remain non-executable. `task.run` does not automatically execute tools in Phase 1.7. See `docs/specifications/tool-execution-spec-v0.md` for workspace boundary, protected path, truncation, UTF-8, and ledger behavior.

## Phase 1.8 task-scoped read-only execution

Phase 1.8 introduces task-scoped execution for approved assistant `workspace.read` tool intents only. Assistant tool intent requests may include an `input` object; omitted input is treated as `{}`, and non-object input is rejected before permission evaluation.

During `task.run`, denied intents, rejected intents, and non-read tool intents are not executed. Even if another tool intent is permission-approved for planning or policy purposes, Phase 1.8 does not execute write, process, subtask, network, service, or destructive operations.

For approved `workspace.read` intents with explicit `input.path`, the runtime records `ToolExecutionRequested`, `ToolExecutionPermissionChecked`, and one terminal `ToolExecutionCompleted`, `ToolExecutionDenied`, or `ToolExecutionFailed` ledger event. The ledger stores execution metadata and a bounded output preview only; full file content is not persisted to the ledger. `task.run` remains `Completed` even if this read-only execution fails in Phase 1.8.

## Phase 1.9 tool feedback loop

Phase 1.9 introduces a second-pass Fake LLM feedback loop inside `task.run` after an approved `workspace.read` execution completes. The runtime re-reads the task ledger, materializes the tool execution summary into the next prompt, builds a second-pass prompt, and records `SecondPassPromptBuilt`, `SecondPassLlmRequestCreated`, and `SecondPassLlmResponseReceived` ledger events.

The second pass runs only when at least one `ToolExecutionCompleted` event exists. `workspace.read` results are summarized into prompt materialization as metadata such as status, `bytes_read`, and `truncated`; full file content is not persisted in the ledger. Phase 1.9 does not add write, process, network, service-control, destructive, or subtask execution, and it continues to use only the in-process Fake LLM.

## Phase 1.10 run inspection methods

The runtime exposes read-only `run.events`, `run.inspect`, and `task.inspect` JSON-RPC methods. They return sanitized ledger previews and run summaries only; full file content and raw tool output are not returned through inspection responses. Unknown run or task IDs return `-32602 invalid params`.
