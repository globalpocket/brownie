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

## Phase 2.1 LLM metadata redaction

Run inspection may show LLM provider metadata and `LlmRequestFailed` / `SecondPassLlmRequestFailed` summaries, but all secret-bearing values must be redacted. API keys, Authorization headers, Bearer tokens, and URL query strings are not inspection data. `BROWNIE_LLM_STRICT` and fallback-to-Fake status are observable through `llm.status`; request ledger metadata may include redacted `base_url` and `strict` so users can verify which configured provider path was used.

## Phase 2.3 OpenAI-compatible smoke and redaction clarification

Phase 2.3 requires deterministic mock-server coverage for config-profile opt-in to the OpenAI-compatible provider. The mock path validates `POST /v1/chat/completions`, the `model` field, system/user messages, presence of an `Authorization` header without logging its value, successful response parsing, and strict failures for non-2xx, malformed JSON, and missing choices.

CI must not require a live local or external LLM endpoint. Optional live local endpoint smoke steps are documented in `docs/specifications/openai-compatible-smoke-spec-v0.md`.

Run inspection/event metadata may include provider, model, redacted base URL, and strict mode. It must not include API key values, `Authorization`, or `Bearer` token values.

Unknown `BROWNIE_LLM_PROVIDER` values must not silently become Fake. Status reports `provider=Unknown`, `enabled=false`, and a safe explanatory reason; strict task runs fail.
