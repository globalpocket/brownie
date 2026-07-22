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

## Phase 1.8 task-scoped read-only execution

Phase 1.8 introduces task-scoped execution for approved assistant `workspace.read` tool intents only. Assistant tool intent requests may include an `input` object; omitted input is treated as `{}`, and non-object input is rejected before permission evaluation.

During `task.run`, denied intents, rejected intents, and non-read tool intents are not executed. Even if another tool intent is permission-approved for planning or policy purposes, Phase 1.8 does not execute write, process, subtask, network, service, or destructive operations.

For approved `workspace.read` intents with explicit `input.path`, the runtime records `ToolExecutionRequested`, `ToolExecutionPermissionChecked`, and one terminal `ToolExecutionCompleted`, `ToolExecutionDenied`, or `ToolExecutionFailed` ledger event. The ledger stores execution metadata and a bounded output preview only; full file content is not persisted to the ledger. `task.run` remains `Completed` even if this read-only execution fails in Phase 1.8.

## Phase 1.9 tool feedback loop

Phase 1.9 introduces a second-pass Fake LLM feedback loop inside `task.run` after an approved `workspace.read` execution completes. The runtime re-reads the task ledger, materializes the tool execution summary into the next prompt, builds a second-pass prompt, and records `SecondPassPromptBuilt`, `SecondPassLlmRequestCreated`, and `SecondPassLlmResponseReceived` ledger events.

The second pass runs only when at least one `ToolExecutionCompleted` event exists. `workspace.read` results are summarized into prompt materialization as metadata such as status, `bytes_read`, and `truncated`; full file content is not persisted in the ledger. Phase 1.9 does not add write, process, network, service-control, destructive, or subtask execution, and it continues to use only the in-process Fake LLM.

## M7.1 controlled cargo fmt verification execution

M7.1 adds one executable verifier: `verification.cargo_fmt_check`. It requires `RuntimeAction::ExecuteProcess`, but it does not make generic `process.exec` executable. The fixed verifier runs exactly `cargo fmt --check` from the workspace root. Its input may be `{}` or `{ "check_id": "cargo_fmt_check" }`; command, argv, args, cwd, env, stdin, shell, timeout, timeout_ms, and unknown fields are rejected before launch.

Standalone `tool.execute` may execute `verification.cargo_fmt_check` when the selected mode has `ExecuteProcess` permission. Task-scoped assistant intents use the same executor and record `ToolExecutionRequested`, `ToolExecutionPermissionChecked`, and a terminal `ToolExecutionCompleted`, `ToolExecutionDenied`, or `ToolExecutionFailed` event. Modes without `ExecuteProcess` record denial without launching a process.

Verifier output and ledger payloads are bounded metadata only: `check_id`, `verification_status`, `process_launched`, `exit_code`, `timed_out`, `duration_ms`, `standard_output_bytes`, `standard_error_bytes`, truncation flags, `output_redacted`, and a bounded reason when applicable. Raw stdout, stderr, command strings, raw input JSON, environment values, stdin, file content, canonical paths, absolute paths, shell execution, git execution, network access, service control, and arbitrary test execution remain out of scope.

## M7.2 controlled cargo check verification execution

M7.2 adds the second executable verifier: `verification.cargo_check`. It requires `RuntimeAction::ExecuteProcess`, reuses `tool.execute` and task-scoped `task.run`, and still does not make generic `process.exec` executable. The fixed verifier runs exactly `cargo check --workspace --all-targets --locked --offline`. Its input may be `{}` or `{ "check_id": "cargo_check" }`; command, argv, args, cwd, env, stdin, shell, timeout, timeout_ms, package, features, target, path, and unknown fields are rejected before launch.

The runtime preflight requires workspace `Cargo.toml` and an existing `Cargo.lock`, and rejects `build.rs` files in this phase so caller-requested compilation cannot execute build scripts. Cargo check uses a runtime-owned isolated target directory outside the workspace, sets offline Cargo execution metadata, removes the isolated target directory after execution, and never stores the isolated path or environment values in RPC responses or ledger payloads.

Verifier output and ledger payloads remain bounded metadata only. In addition to the M7.1 verifier fields, `verification.cargo_check` may expose `target_dir_isolated`, `network_disabled`, and `cleanup_succeeded`. Raw stdout, stderr, command strings, raw input JSON, environment values, target directory paths, stdin, file content, canonical paths, absolute paths, shell execution, git execution, network access, service control, arbitrary caller-selected tests, and workspace mutation remain out of scope.
