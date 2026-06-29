# Tool Intent Spec v0

Phase 1.6 introduces assistant tool intent parsing as a dry-run-only path. Assistant output may include a fenced `brownie-tool-intent` JSON block with a top-level `tool_requests` array. Each request contains a `tool_id` and a human-readable `reason`.

The runtime parses these blocks without executing any tool. Every assistant-requested tool is validated against the `BuiltinToolRegistry`; malformed JSON, malformed request items, and unknown tool IDs are rejected safely and recorded as rejected intent.

Validated assistant tool intent is evaluated by `RuntimePermissionGate` using the compiled mode policy. Runtime permissions take precedence over assistant intent. Denied and rejected tool intent does not execute and does not fail `task.run` in Phase 1.6.

Real tool execution, file reads, file writes, patch application, process command execution, subtask spawning, real LLM API calls, and OpenAI-compatible HTTP clients remain non-goals for this phase.

## Phase 1.7 read-only tool execution note

Phase 1.7 adds standalone `tool.execute` for permission-gated `workspace.read` execution only. All writes, process execution, subtasks, network access, service control, and destructive operations remain non-executable. `task.run` does not automatically execute tools in Phase 1.7. See `docs/specifications/tool-execution-spec-v0.md` for workspace boundary, protected path, truncation, UTF-8, and ledger behavior.

## Phase 1.8 task-scoped read-only execution

Phase 1.8 introduces task-scoped execution for approved assistant `workspace.read` tool intents only. Assistant tool intent requests may include an `input` object; omitted input is treated as `{}`, and non-object input is rejected before permission evaluation.

During `task.run`, denied intents, rejected intents, and non-read tool intents are not executed. Even if another tool intent is permission-approved for planning or policy purposes, Phase 1.8 does not execute write, process, subtask, network, service, or destructive operations.

For approved `workspace.read` intents with explicit `input.path`, the runtime records `ToolExecutionRequested`, `ToolExecutionPermissionChecked`, and one terminal `ToolExecutionCompleted`, `ToolExecutionDenied`, or `ToolExecutionFailed` ledger event. The ledger stores execution metadata and a bounded output preview only; full file content is not persisted to the ledger. `task.run` remains `Completed` even if this read-only execution fails in Phase 1.8.

## Phase 1.9 tool feedback loop

Phase 1.9 introduces a second-pass Fake LLM feedback loop inside `task.run` after an approved `workspace.read` execution completes. The runtime re-reads the task ledger, materializes the tool execution summary into the next prompt, builds a second-pass prompt, and records `SecondPassPromptBuilt`, `SecondPassLlmRequestCreated`, and `SecondPassLlmResponseReceived` ledger events.

The second pass runs only when at least one `ToolExecutionCompleted` event exists. `workspace.read` results are summarized into prompt materialization as metadata such as status, `bytes_read`, and `truncated`; full file content is not persisted in the ledger. Phase 1.9 does not add write, process, network, service-control, destructive, or subtask execution, and it continues to use only the in-process Fake LLM.

## Parser hardening and protocol summaries

Provider responses are untrusted input. Tool intent parsing validates fenced block count, block size, request count, request schema, input size, reason length, tool IDs, and `workspace.read` path preflight before any permission evaluation or execution path.

`tool.intent.parse` returns the parser summary and typed `input_summary` values only. It never returns raw provider responses, raw `brownie-tool-intent` JSON, or raw request `input` JSON. Unknown tools and invalid `workspace.read` paths are rejected and are not executed.

Rejected tool intent uses stable codes such as `malformed_json`, `invalid_schema`, `unknown_tool`, and `invalid_input`. Ledger and inspection records for `ToolIntentPermissionChecked`, `ToolIntentApproved`, and `ToolIntentDenied` store parser metadata and summaries only, including `input_summary`; they do not store raw provider responses or raw intent JSON.

## Phase 3.0 workspace.write dry-run proposals

`workspace.write` supports only `replace_file` input for Phase 3.0. The parser preflights `path`, `operation`, and `content`, and invalid input is rejected with `code = "invalid_input"` without returning raw content. Approved intents remain dry-run and produce patch proposals only; the runtime does not write files or apply patches.
