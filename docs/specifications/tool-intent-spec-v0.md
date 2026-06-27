# Tool Intent Spec v0

Phase 1.6 introduces assistant tool intent parsing as a dry-run-only path. Assistant output may include a fenced `brownie-tool-intent` JSON block with a top-level `tool_requests` array. Each request contains a `tool_id` and a human-readable `reason`.

The runtime parses these blocks without executing any tool. Every assistant-requested tool is validated against the `BuiltinToolRegistry`; malformed JSON, malformed request items, and unknown tool IDs are rejected safely and recorded as rejected intent.

Validated assistant tool intent is evaluated by `RuntimePermissionGate` using the compiled mode policy. Runtime permissions take precedence over assistant intent. Denied and rejected tool intent does not execute and does not fail `task.run` in Phase 1.6.

Real tool execution, file reads, file writes, patch application, process command execution, subtask spawning, real LLM API calls, and OpenAI-compatible HTTP clients remain non-goals for this phase.

## Phase 1.7 read-only tool execution note

Phase 1.7 adds standalone `tool.execute` for permission-gated `workspace.read` execution only. All writes, process execution, subtasks, network access, service control, and destructive operations remain non-executable. `task.run` does not automatically execute tools in Phase 1.7. See `docs/specifications/tool-execution-spec-v0.md` for workspace boundary, protected path, truncation, UTF-8, and ledger behavior.
