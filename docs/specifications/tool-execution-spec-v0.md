# Brownie Tool Execution Spec v0

## Phase 1.7 scope

Phase 1.7 introduces the minimum read-only execution foundation. The only executable tool is `workspace.read`.

All write, patch, process, subtask, network, service-control, and destructive tools remain non-executable. `task.run` continues to parse and dry-run evaluate assistant tool intents, but it does not automatically execute tools.

## `tool.execute`

`tool.execute` is a standalone JSON-RPC method for explicit tool execution. Because it has no task context in Phase 1.7, callers must provide `mode_id` so the runtime can evaluate the request through `RuntimePermissionGate` before any execution dispatch.

Example request:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tool.execute",
  "params": {
    "mode_id": "orchestrator",
    "tool_id": "workspace.read",
    "input": { "path": "README.md" }
  }
}
```

Unknown `mode_id` is rejected as invalid params (`-32602`). Permission denial returns a tool result with status `Denied` and a reason in `output`.

## `workspace.read`

Input:

```json
{ "path": "README.md" }
```

Completed output:

```json
{
  "path": "README.md",
  "content": "...",
  "truncated": false,
  "bytes_read": 123
}
```

Large files are capped at 65536 bytes and return `truncated: true`.

## Workspace boundary and protected paths

`workspace.read` treats `path` as workspace-root relative. Absolute paths and `..` path traversal are rejected. The runtime canonicalizes both workspace root and target path, then rejects any target outside the workspace root.

Phase 1.7 does not list directories. It rejects protected workspace paths under `.git`, `.brownie`, `node_modules`, and `target`. `.brownie` is protected because run ledgers and internal runtime state require explicit future diagnostics rather than broad tool access.

Binary or invalid UTF-8 files fail safely instead of returning raw bytes.

## Ledger behavior

The store defines future task-scoped event kinds: `ToolExecutionRequested`, `ToolExecutionPermissionChecked`, `ToolExecutionCompleted`, `ToolExecutionDenied`, and `ToolExecutionFailed`.

Standalone `tool.execute` does not write run ledger events in Phase 1.7 because it is not attached to a task/run. A future task-scoped execution path may use these event kinds when automatic execution is introduced.
