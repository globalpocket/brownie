# Brownie Run Inspection Protocol v0

Phase 1.10 adds read-only inspection APIs for completed or in-progress task runs. These APIs are intended for the VSIX output channel and future progress UI, not for modifying runtime state.

## JSON-RPC methods

- `run.events` accepts `{ "run_id": string }` and returns `{ "run_id": string, "events": LedgerEventSummary[] }`.
- `run.inspect` accepts `{ "run_id": string }` and returns `{ "run": RunInspectSummary }`.
- `task.inspect` accepts `{ "task_id": string }` and returns `{ "task": TaskRecord, "run": RunInspectSummary }`.

Unknown `run_id` or `task_id` values return JSON-RPC `-32602 invalid params` errors so clients can distinguish typos from empty runs.

## Sanitized event summaries

`LedgerEventSummary` contains event identity, task/run identity, kind, timestamp, and a sanitized optional payload. Inspection never returns full file content. Payloads are allowlisted to preview and metadata keys such as `output_preview`, `prompt_preview`, `content_preview`, `bytes_read`, `truncated`, `reason`, `model`, `message_count`, `provider`, mode metadata, permission decisions, and tool IDs.

Keys such as `content`, `full_content`, `file_content`, and `raw_output` are removed even if future ledger producers accidentally include them.

## Run inspection summary

`RunInspectSummary` reports:

- `run_id`
- optional `task_id`
- optional task `status`
- `event_count`
- `has_tool_execution_completed`
- `has_second_pass`
- `final_response_preview`, preferring `SecondPassLlmResponseReceived.content_preview` over `LlmResponseReceived.content_preview`
- a compact human-readable `timeline`

The APIs do not call real LLM services, do not execute tools, and do not perform writes.
