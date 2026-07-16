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

## M5 subtask orchestration queue

Approved `subtask.spawn` assistant intent is not executed in M5. Instead, `task.run` records a summary-only `SubtaskOrchestrationQueued` ledger event with `status = "Queued"`, queue position, `request_reason`, and `input_summary`. The ledger event must not include raw request input or raw provider output.

Denied or rejected `subtask.spawn` intent follows the existing denied/rejected tool-intent path. M5 does not add child task execution, process execution, network access, service control, patch apply, or direct workspace mutation.

## M5.1 subtask handoff preparation

After approved `subtask.spawn` intent is queued, `task.run` may consume the queued evidence into a summary-only `SubtaskHandoffPrepared` event. This handoff record references queued subtask ids and marks `execution_enabled = false`; it must not include raw request input or raw provider output.

M5.1 does not execute the requested subtask. It only prepares deterministic parent-run handoff state for future runtime scheduling.

## M5.2 subtask scheduler readiness

After prepared handoff state exists, `task.run` may evaluate it into a summary-only `SubtaskSchedulerReadinessRecorded` event. This readiness record references the handoff, records `dispatch_enabled = false`, and includes deterministic blocked checks explaining why the handoff is not yet scheduler-ready.

M5.2 does not execute the requested subtask. It only records scheduler-readiness evidence for future runtime dispatch.

## M5.3 subtask dispatch plan preparation

After scheduler-readiness state exists, `task.run` may convert it into a summary-only `SubtaskDispatchPlanPrepared` event. This dispatch plan record references the readiness evidence, records `dispatch_enabled = false`, and includes deterministic blocked checks explaining why no child task can be dispatched yet.

M5.3 does not execute the requested subtask. It only records dispatch-plan evidence for future runtime dispatch.

## M5.4 subtask dispatch contract preparation

After dispatch-plan state exists, `task.run` may convert it into a summary-only `SubtaskDispatchContractPrepared` event. This dispatch contract record references the dispatch plan, records `dispatch_enabled = false`, includes required preconditions for future dispatch, and preserves deterministic blocked checks explaining why the contract is not executable yet.

M5.4 does not execute the requested subtask. It only records dispatch-contract and eligibility-gate evidence for future runtime dispatch.

## M5.5 subtask dispatch admission evaluation

After dispatch-contract state exists, `task.run` may evaluate it into a summary-only `SubtaskDispatchAdmissionEvaluated` event. This admission record references the dispatch contract, records `dispatch_enabled = false`, includes blocked preconditions for future dispatch, and preserves deterministic execution-gate checks explaining why no child task can be admitted yet.

M5.5 does not execute the requested subtask. It only records dispatch-admission and execution-gate evidence for future runtime dispatch.

## M5.6 subtask dispatch readiness snapshot

After dispatch-admission state exists, `task.run` may snapshot it into a summary-only `SubtaskDispatchReadinessSnapshotRecorded` event. This readiness snapshot references the admission decision, records `dispatch_enabled = false`, includes a stable readiness fingerprint, and preserves deterministic scheduler handoff checks explaining why no child task can be handed off yet.

M5.6 does not execute the requested subtask. It only records dispatcher-readiness snapshot and scheduler handoff evidence for future runtime dispatch.
