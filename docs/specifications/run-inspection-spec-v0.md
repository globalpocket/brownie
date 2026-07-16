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
- `has_subtask_dispatcher_guard_verdict`
- `subtask_dispatcher_guard_verdict_count`
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

## M5.7 subtask dispatcher guard verdict inspection

Run inspection also reports dispatcher guard verdict evidence. `has_subtask_dispatcher_guard_verdict` / `subtask_dispatcher_guard_verdict_count` count `SubtaskDispatcherGuardVerdictRecorded` events. These fields indicate that the runtime consumed dispatch-readiness snapshots into a deterministic dispatcher guard verdict and scheduler handoff preflight blocker; in M5.7 dispatch remains blocked and no child task execution is implied.

## M5.8 subtask dispatch decision inspection

Run inspection also reports dispatch decision evidence. `has_subtask_dispatch_decision` / `subtask_dispatch_decision_count` count `SubtaskDispatchDecisionRecorded` events. These fields indicate that the runtime consumed dispatcher guard verdicts into deterministic dispatch decision and per-candidate denial state; in M5.8 dispatch remains denied and no child task execution is implied.

## M5.9 subtask dispatch candidate manifest inspection

Run inspection also reports dispatch candidate manifest evidence. `has_subtask_dispatch_candidate_manifest` / `subtask_dispatch_candidate_manifest_count` count `SubtaskDispatchCandidateManifestRecorded` events. These fields indicate that the runtime consumed dispatch decisions into deterministic per-queued-subtask candidate manifest and blocker state; in M5.9 dispatch remains denied and no child task execution is implied.

## M5.10 subtask dispatch handoff envelope inspection

Run inspection also reports dispatch handoff envelope evidence. `has_subtask_dispatch_handoff_envelope` / `subtask_dispatch_handoff_envelope_count` count `SubtaskDispatchHandoffEnvelopeRecorded` events. These fields indicate that the runtime consumed candidate manifests into deterministic handoff envelope / replay guard state; scheduler handoff remains disabled and no child task execution is implied.

## M5.11 child task relation inspection

Run inspection reports controlled child materialization with `child_task_count` and `child_task_ids`. These fields are derived from persisted child `TaskRecord` state whose `parent_run_id` matches the inspected run. They expose parent-child relation evidence only; a child listed here is `Queued` and has not executed an LLM loop or scheduler handoff in M5.11.

## M5.12 queued child run inspection

After M5.12, a child listed by parent `run.inspect` may still be `Queued`, or it may have entered the existing child `task.run` lifecycle through an explicit call on the child task id. Reviewers can use the listed `child_task_ids` with `task.inspect` to observe the child status and provenance fields: `parent_task_id`, `parent_run_id`, `source_candidate_id`, `source_handoff_envelope_id`, and `source_handoff_envelope_fingerprint`.

M5.12 does not add scheduler auto-dispatch. Parent run inspection proves relation only; child execution evidence belongs to the child task/run ledger and appears only after explicit `task.run` admission for that child.

## M5.13 parent child result summaries

Parent run inspection now includes `child_tasks`, a structured summary list aligned with `child_task_ids`. Each item reports child identity, run id, status, parent/source provenance, child ledger event count, `has_agent_loop_completed`, `completion_final_state`, `completion_summary_preview`, and sanitized `final_response_preview` when available.

Queued children appear with `status = "Queued"`, their child ledger event count, and no completion preview. After an explicit child `task.run`, parent inspection reflects the child terminal status and sanitized completion evidence without mutating the parent ledger or auto-running additional children.

Child summaries are inspection data only. They must not include raw prompts, raw provider responses, raw file content, command strings, stdout, stderr, environment values, or serialized request bodies.

## M5.14 child task source intent summaries

Materialized child tasks now carry a sanitized `source_intent_summary` derived from the approved `subtask.spawn` source intent. Parent `run.inspect` / `task.inspect` child summaries expose the same summary so callers can understand why a child exists without reading raw parent prompts or raw tool input bodies.

The summary includes `tool_id`, `required_action`, bounded `request_reason`, and bounded `input_summary`. It must not include raw `input`, raw prompts, provider responses, file content, command output, environment values, or serialized request bodies. Parent inspection remains observational and does not auto-run child tasks.

## Phase 2.1 LLM metadata redaction

Run inspection may show LLM provider metadata and `LlmRequestFailed` / `SecondPassLlmRequestFailed` summaries, but all secret-bearing values must be redacted. API keys, Authorization headers, Bearer tokens, and URL query strings are not inspection data. `BROWNIE_LLM_STRICT` and fallback-to-Fake status are observable through `llm.status`; request ledger metadata may include redacted `base_url` and `strict` so users can verify which configured provider path was used.

## Phase 2.3 OpenAI-compatible smoke and redaction clarification

Phase 2.3 requires deterministic mock-server coverage for config-profile opt-in to the OpenAI-compatible provider. The mock path validates `POST /v1/chat/completions`, the `model` field, system/user messages, presence of an `Authorization` header without logging its value, successful response parsing, and strict failures for non-2xx, malformed JSON, and missing choices.

CI must not require a live local or external LLM endpoint. Optional live local endpoint smoke steps are documented in `docs/specifications/openai-compatible-smoke-spec-v0.md`.

Run inspection/event metadata may include provider, model, redacted base URL, and strict mode. It must not include API key values, `Authorization`, or `Bearer` token values.

Unknown `BROWNIE_LLM_PROVIDER` values must not silently become Fake. Status reports `provider=Unknown`, `enabled=false`, and a safe explanatory reason; strict task runs fail.
