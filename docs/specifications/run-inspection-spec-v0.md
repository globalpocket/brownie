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
- `has_subtask_orchestration_queued`
- `subtask_queue_count`
- `has_subtask_handoff_prepared`
- `subtask_handoff_count`
- `has_subtask_scheduler_readiness`
- `subtask_scheduler_readiness_count`
- `has_subtask_dispatch_plan_prepared`
- `subtask_dispatch_plan_count`
- `has_subtask_dispatch_contract_prepared`
- `subtask_dispatch_contract_count`
- `has_subtask_dispatch_admission_evaluated`
- `subtask_dispatch_admission_count`
- `has_subtask_dispatch_readiness_snapshot`
- `subtask_dispatch_readiness_snapshot_count`
- `has_second_pass`
- `final_response_preview`, preferring `SecondPassLlmResponseReceived.content_preview` over `LlmResponseReceived.content_preview`
- a compact human-readable `timeline`

The APIs do not call real LLM services, do not execute tools, and do not perform writes.

## M5.1 subtask orchestration inspection

Run inspection reports both queued subtask orchestration evidence and prepared handoff state. `has_subtask_orchestration_queued` / `subtask_queue_count` count `SubtaskOrchestrationQueued` events, while `has_subtask_handoff_prepared` / `subtask_handoff_count` count `SubtaskHandoffPrepared` events. These fields are summary-only and do not imply child task execution.

## M5.2 subtask scheduler readiness inspection

Run inspection also reports scheduler readiness evidence for prepared subtask handoff state. `has_subtask_scheduler_readiness` / `subtask_scheduler_readiness_count` count `SubtaskSchedulerReadinessRecorded` events. These fields indicate that the runtime evaluated dispatch readiness; in M5.2 dispatch remains blocked and no child task execution is implied.

## M5.3 subtask dispatch plan inspection

Run inspection also reports prepared dispatch plan evidence. `has_subtask_dispatch_plan_prepared` / `subtask_dispatch_plan_count` count `SubtaskDispatchPlanPrepared` events. These fields indicate that the runtime converted readiness evidence into a deterministic dispatch plan; in M5.3 dispatch remains blocked and no child task execution is implied.

## M5.4 subtask dispatch contract inspection

Run inspection also reports prepared dispatch contract evidence. `has_subtask_dispatch_contract_prepared` / `subtask_dispatch_contract_count` count `SubtaskDispatchContractPrepared` events. These fields indicate that the runtime converted dispatch-plan evidence into a deterministic dispatch contract and eligibility gate; in M5.4 dispatch remains blocked and no child task execution is implied.

## M5.5 subtask dispatch admission inspection

Run inspection also reports evaluated dispatch admission evidence. `has_subtask_dispatch_admission_evaluated` / `subtask_dispatch_admission_count` count `SubtaskDispatchAdmissionEvaluated` events. These fields indicate that the runtime converted dispatch-contract evidence into a deterministic admission decision and execution gate; in M5.5 dispatch remains blocked and no child task execution is implied.

## M5.6 subtask dispatch readiness snapshot inspection

Run inspection also reports dispatch readiness snapshot evidence. `has_subtask_dispatch_readiness_snapshot` / `subtask_dispatch_readiness_snapshot_count` count `SubtaskDispatchReadinessSnapshotRecorded` events. These fields indicate that the runtime converted dispatch-admission evidence into a stable dispatcher-readiness snapshot and scheduler handoff blocker; in M5.6 dispatch remains blocked and no child task execution is implied.

## Phase 2.1 LLM metadata redaction

Run inspection may show LLM provider metadata and `LlmRequestFailed` / `SecondPassLlmRequestFailed` summaries, but all secret-bearing values must be redacted. API keys, Authorization headers, Bearer tokens, and URL query strings are not inspection data. `BROWNIE_LLM_STRICT` and fallback-to-Fake status are observable through `llm.status`; request ledger metadata may include redacted `base_url` and `strict` so users can verify which configured provider path was used.

## Phase 2.3 OpenAI-compatible smoke and redaction clarification

Phase 2.3 requires deterministic mock-server coverage for config-profile opt-in to the OpenAI-compatible provider. The mock path validates `POST /v1/chat/completions`, the `model` field, system/user messages, presence of an `Authorization` header without logging its value, successful response parsing, and strict failures for non-2xx, malformed JSON, and missing choices.

CI must not require a live local or external LLM endpoint. Optional live local endpoint smoke steps are documented in `docs/specifications/openai-compatible-smoke-spec-v0.md`.

Run inspection/event metadata may include provider, model, redacted base URL, and strict mode. It must not include API key values, `Authorization`, or `Bearer` token values.

Unknown `BROWNIE_LLM_PROVIDER` values must not silently become Fake. Status reports `provider=Unknown`, `enabled=false`, and a safe explanatory reason; strict task runs fail.
