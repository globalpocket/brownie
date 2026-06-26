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
