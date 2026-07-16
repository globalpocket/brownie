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
{"jsonrpc":"2.0","id":2,"result":{"task_id":"task_<uuid>","run_id":"run_<uuid>","status":"Completed","agent_loop":{"final_state":"Completed","completion_summary":"LLM agent loop completed for task_<uuid>"}}}
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

## Phase 1.2 `task.run` behavior

In Phase 1.2, the `task.run` JSON-RPC request and response shape are unchanged, but the runtime now connects the task to prompt materialization and a deterministic local fake LLM adapter.

For a `Created` task, the runtime performs this ordered lifecycle:

```text
TaskStarted
TaskRunning
PromptBuilt
LlmRequestCreated
LlmResponseReceived
TaskCompleted
```

The response still reports `Completed` on success. The additional ledger events contain metadata only, such as message counts, fake model name, and short previews. Full prompt text is not persisted by default.

The fake LLM adapter is deterministic and local-only. Phase 1.2 performs no real LLM network calls and does not introduce tool execution, AgentModes parsing, Mode Pack fetch or activation, Qdrant, llama-server, or indexing behavior.

## M1 agent-loop runtime summary

M1 makes the existing Rust-owned agent-loop execution visible on the task runtime path without adding a new RPC. During `task.run`, the runtime records `AgentLoopStarted` and `AgentLoopCompleted` ledger events around the agent-loop call. Successful responses include an `agent_loop` summary with `final_state` and `completion_summary`, allowing VSIX and headless callers to confirm that the runtime path exercised the agent loop rather than only observing task status.

## Phase 1.3 mode protocol methods

Phase 1.3 adds `mode.list` and `mode.get` JSON-RPC methods backed by the built-in stub mode registry. These methods do not fetch or parse external AgentModes repositories.

`mode.list` returns `{ "modes": ModeSummary[] }`, where each summary includes `mode_id`, `display_name`, `role_definition`, and permission booleans. `mode.get` accepts `{ "mode_id": string }` and returns one `ModeSummary`.

Unknown mode IDs passed to `mode.get` return JSON-RPC `-32602 invalid params`. `task.start` applies the same unknown-mode rejection, while omitted or `null` `mode_id` defaults to `orchestrator`.

## M2 local Mode Pack runtime behavior

M2 extends the existing mode RPCs without adding a new endpoint. When `.brownie/modepack.json` exists under the workspace root, `mode.list`, `mode.get`, `permission.check`, and explicit `task.start` mode resolution include local Mode Pack modes after validating the file through the Rust `brownie-modepack` crate.

Invalid Mode Pack files fail these mode-resolution paths with an internal runtime error rather than silently falling back. Local Mode Pack modes must not duplicate existing mode IDs and must remain read-only without workspace write, process execution, network access, service control, or destructive permissions.

`task.start` records the resolved policy snapshot in the run ledger. `task.run` uses that ledger snapshot so already-started tasks are not affected by later edits to `.brownie/modepack.json`.

## Phase 1.4 permission gate update

Phase 1.4 adds the `RuntimePermissionGate` foundation. Runtime permission checks are based on compiled mode policy capabilities and override LLM instructions.

Runtime actions are `ReadWorkspace`, `WriteWorkspace`, `ExecuteProcess`, `AccessNetwork`, `ControlService`, `DestructiveOperation`, and `SpawnSubtask`. Phase 1.4 records permission decisions only; it does not execute real tools, write files, apply patches, execute processes, call real LLM APIs, parse AgentModes YAML, fetch Mode Packs, or implement Qdrant/llama-server/indexer behavior.

The runtime protocol includes `permission.check`. Task runs append `PermissionChecked` ledger events for minimum checks and append `PermissionDenied` when a checked action is denied. `ModeResolved` stores a full permission snapshot so prompt materialization can summarize active mode capabilities.

## Phase 1.5 tool planning update

Phase 1.5 adds dry-run tool planning before future tool execution. Tool definitions and plans are declarative only and do not perform file reads, file writes, process execution, subtask spawning, network access, service control, or destructive operations. Planned tools are evaluated through `RuntimePermissionGate`; denied dry-run items are recorded but do not fail `task.run` in Phase 1.5. See `docs/specifications/tool-planning-spec-v0.md`.

## Phase 1.6 assistant tool intent dry-run

Phase 1.6 adds assistant tool intent parsing from fenced `brownie-tool-intent` JSON blocks. The runtime validates all requested tool IDs against `BuiltinToolRegistry` and evaluates valid requests with `RuntimePermissionGate`. Denied or rejected assistant tool intent is recorded for inspection, but no tool is executed and `task.run` remains allowed to complete in this phase.

## Phase 1.7 read-only tool execution note

Phase 1.7 adds standalone `tool.execute` for permission-gated `workspace.read` execution only. All writes, process execution, subtasks, network access, service control, and destructive operations remain non-executable. `task.run` does not automatically execute tools in Phase 1.7. See `docs/specifications/tool-execution-spec-v0.md` for workspace boundary, protected path, truncation, UTF-8, and ledger behavior.

## Phase 1.8 task-scoped read-only execution

Phase 1.8 introduces task-scoped execution for approved assistant `workspace.read` tool intents only. Assistant tool intent requests may include an `input` object; omitted input is treated as `{}`, and non-object input is rejected before permission evaluation.

During `task.run`, denied intents, rejected intents, and non-read tool intents are not executed. Even if another tool intent is permission-approved for planning or policy purposes, Phase 1.8 does not execute write, process, subtask, network, service, or destructive operations.

For approved `workspace.read` intents with explicit `input.path`, the runtime records `ToolExecutionRequested`, `ToolExecutionPermissionChecked`, and one terminal `ToolExecutionCompleted`, `ToolExecutionDenied`, or `ToolExecutionFailed` ledger event. The ledger stores execution metadata and a bounded output preview only; full file content is not persisted to the ledger. `task.run` remains `Completed` even if this read-only execution fails in Phase 1.8.

## Phase 1.9 tool feedback loop

Phase 1.9 introduces a second-pass Fake LLM feedback loop inside `task.run` after an approved `workspace.read` execution completes. The runtime re-reads the task ledger, materializes the tool execution summary into the next prompt, builds a second-pass prompt, and records `SecondPassPromptBuilt`, `SecondPassLlmRequestCreated`, and `SecondPassLlmResponseReceived` ledger events.

The second pass runs only when at least one `ToolExecutionCompleted` event exists. `workspace.read` results are summarized into prompt materialization as metadata such as status, `bytes_read`, and `truncated`; full file content is not persisted in the ledger. Phase 1.9 does not add write, process, network, service-control, destructive, or subtask execution, and it continues to use only the in-process Fake LLM.

## M4 bounded task context window

M4 strengthens the existing `task.run` prompt materialization path without adding a new endpoint. The runtime-owned `ContextMaterializer` now assembles a deterministic bounded ledger context window for prompts. The prompt `Ledger` section includes only the latest 12 ledger event kinds, while a `Context Window` section records `total_events`, `included_events`, `omitted_events`, `max_events`, `first_included_event`, and `last_included_event`.

`PromptBuilt` and `SecondPassPromptBuilt` ledger payloads persist the same summary-only context evidence as `context_total_events`, `context_included_events`, `context_omitted_events`, `context_max_events`, `context_window_bounded`, `context_first_included_event`, and `context_last_included_event`. These fields let callers and future agent-loop stages reason about bounded context reuse without exposing raw prompt text when sensitive guards redact previews.

M4 does not add patch apply, direct workspace mutation, unrestricted process execution, network fetch, service-control, destructive actions, or new diagnostics wrapper RPCs. It only changes how existing task/run context is selected, summarized, and recorded.

## Phase 1.10 run inspection methods

The runtime exposes read-only `run.events`, `run.inspect`, and `task.inspect` JSON-RPC methods. They return sanitized ledger previews and run summaries only; full file content and raw tool output are not returned through inspection responses. Unknown run or task IDs return `-32602 invalid params`.


## Phase 2.0 LLM provider boundary

Phase 2.0 routes LLM calls through a provider abstraction. The Fake provider remains the default and no external LLM API is contacted unless `BROWNIE_LLM_PROVIDER=openai-compatible` and the required OpenAI-compatible environment configuration are present. The `llm.status` JSON-RPC method reports provider, enabled state, model, base URL, and a non-secret reason; it never returns API keys or Authorization headers. Task ledger LLM request events store only provider/model/message_count metadata, and response events store only provider/content_preview. Streaming and additional tool execution capabilities remain out of scope. See `docs/specifications/llm-provider-spec-v0.md`.

## Phase 2.1 LLM status and failure events

`llm.status` returns `provider`, `enabled`, `model`, `base_url`, `reason`, `strict`, and `will_fallback_to_fake`. `will_fallback_to_fake` is true only when OpenAI-compatible was requested, required configuration is missing, and `BROWNIE_LLM_STRICT` is not true. No API key or Authorization/Bearer value is returned.

Ledger event kinds include `LlmRequestFailed` and `SecondPassLlmRequestFailed`. When a configured provider call fails during `task.run`, the runtime records the redacted failure event, records `TaskFailed`, marks the task Failed, and returns JSON-RPC `-32603`. Disabled OpenAI-compatible with `strict=false` falls back to Fake and does not emit a failure event. Phase 2.1 does not add streaming or any new workspace.write, process.exec, network tool, service-control, destructive, or subtask-spawn execution capability.

## Phase 2.2 `runtime.config.get`

`runtime.config.get` returns a sanitized view of the active runtime configuration with `config_source`, optional `config_path`, optional `active_profile`, and the same `llm_status` shape returned by `llm.status`. `LlmStatusResult` includes `config_source` and `active_profile`. Secrets such as direct API keys, Authorization headers, and bearer tokens are never returned.

## Phase 2.3 OpenAI-compatible smoke and redaction clarification

Phase 2.3 requires deterministic mock-server coverage for config-profile opt-in to the OpenAI-compatible provider. The mock path validates `POST /v1/chat/completions`, the `model` field, system/user messages, presence of an `Authorization` header without logging its value, successful response parsing, and strict failures for non-2xx, malformed JSON, and missing choices.

CI must not require a live local or external LLM endpoint. Optional live local endpoint smoke steps are documented in `docs/specifications/openai-compatible-smoke-spec-v0.md`.

Run inspection/event metadata may include provider, model, redacted base URL, and strict mode. It must not include API key values, `Authorization`, or `Bearer` token values.

Unknown `BROWNIE_LLM_PROVIDER` values must not silently become Fake. Status reports `provider=Unknown`, `enabled=false`, and a safe explanatory reason; strict task runs fail.

## Phase 2.4 `runtime.diagnostics.get`

`runtime.diagnostics.get` returns `config_source`, optional `active_profile`, sanitized `llm_status`, and diagnostics with `severity`, `code`, `message`, and optional `subject`. The method is read-only and does not contact external LLM endpoints. It prefers structured diagnostics over JSON-RPC errors when config parsing or validation fails.

## Phase 2.5 LLM health

Phase 2.5 adds the explicit `llm.health` JSON-RPC method, specified in `docs/specifications/llm-health-spec-v0.md`. `runtime.diagnostics.get` remains read-only and no-network. Endpoint readiness checks are only performed by `llm.health` when `allow_network=true`; Fake health remains no-network. OpenAI-compatible health uses `GET {base_url}/models`, does not persist response bodies, does not write run ledgers, and redacts API keys, Authorization/Bearer values, and query-string secrets.

## Phase 2.6 real-provider task.run guard

`BROWNIE_LLM_ALLOW_TASK_RUN_NETWORK=true` is required before strict enabled OpenAI-compatible `task.run` may make network LLM calls. The default is false. `llm.status` and `runtime.config.get` expose `task_run_network_allowed`; `runtime.diagnostics.get` reports `TASK_RUN_NETWORK_ALLOWED` or `TASK_RUN_NETWORK_NOT_ALLOWED` for strict enabled OpenAI-compatible profiles. Missing guard is a warning in diagnostics and a pre-network `task.run` error. Non-strict OpenAI-compatible `task.run` falls back to Fake. See `docs/specifications/real-provider-task-run-smoke-spec-v0.md`.

## Phase 2.7 LLM request budget note

See [LLM Request Budget Spec v0](llm-request-budget-spec-v0.md). Runtime provider requests are bounded by the resolved budget, status/config responses include the budget summary, diagnostics report default/profile/env/invalid budget sources, and ledger/inspection payloads keep prompt and response previews only.

## Phase 2.8 prompt sensitive guard

Runtime LLM configuration includes `sensitive_guard` (`off`, `warn`, `fail`) with `BROWNIE_LLM_SENSITIVE_GUARD` as the highest-priority override. Fake defaults to `warn`; OpenAI-compatible defaults to `fail`. Provider calls are preceded by budget validation and prompt sensitive-content scanning. In fail mode, findings block the provider call and task failure metadata records only categories, counts, message indexes, and guard mode. Matched secret text, full prompt text, and full provider responses must not be persisted or exposed through status, diagnostics, ledger, or inspection APIs.

## `tool.intent.parse` trust boundary

Provider responses are untrusted input. The `tool.intent.parse` method parses fenced `brownie-tool-intent` blocks, validates parser limits and schemas, runs `workspace.read` path preflight, and returns only parser metadata plus summaries.

`ToolIntentDecisionSummary` contains `input_summary`:

```json
{"has_path":true,"field_count":1}
```

It must not contain a raw `input` field. Raw provider responses and raw `brownie-tool-intent` JSON are never returned by this RPC. Rejected requests include stable rejection codes such as `malformed_json`, `invalid_schema`, `unknown_tool`, and `invalid_input` without echoing raw input JSON.

Ledger and inspection surfaces follow the same trust boundary: parser metadata, rejection codes, and input summaries may be stored or displayed; raw provider responses and raw intent JSON must not be stored or displayed.

## `proposal.list`

Phase 3.0 adds `proposal.list` with params `{ "run_id": string }`. The result is `{ "run_id": string, "proposals": [...] }`, where each proposal summary contains `proposal_id`, `path`, `operation`, `content_preview`, `content_chars`, and `truncated`. Unknown runs return `-32602`.

## Phase 3.1 proposal validation and inspection

`proposal.list` summaries now include `validation_status`, `validation_reason`, `diff_preview`, `diff_truncated`, and `diff_redacted` in addition to the Phase 3.0 fields. Allowed validation statuses are `Valid`, `Invalid`, and `Blocked`.

`proposal.inspect` accepts `{ "run_id": string, "proposal_id": string }` and returns `{ "proposal": WorkspacePatchProposalSummary }`. Empty IDs, unknown runs, and unknown proposals return JSON-RPC `-32602`.

Diff previews are synthetic unified diff previews only. They are capped before ledger storage and RPC exposure. Sensitive-like proposed content redacts `content_preview` and suppresses diff preview; sensitive-like existing target content also suppresses diff preview. The runtime still does not apply patches or write files for `workspace.write`.

## Phase 3.2 `proposal.approve` / `proposal.reject`

`proposal.approve` accepts `{ "run_id": string, "proposal_id": string, "reason"?: string }` and returns `{ "proposal": WorkspacePatchProposalSummary, "apply_plan": WorkspacePatchApplyPlanSummary }`. The proposal must exist, be `Valid`, and have `approval_status` `Pending`; otherwise the runtime returns JSON-RPC `-32602`. The method records `WorkspacePatchApproved` and `WorkspacePatchApplyPlanCreated` ledger events only. It does not write files and does not apply patches.

`proposal.reject` accepts `{ "run_id": string, "proposal_id": string, "reason"?: string }` and returns `{ "proposal": WorkspacePatchProposalSummary }`. The proposal must exist and be `Pending`; otherwise the runtime returns `-32602`. The method records `WorkspacePatchRejected` only and does not write files.

`WorkspacePatchProposalSummary` now includes `approval_status`, `approval_reason`, `approved_at`, `rejected_at`, and may include summary-only `latest_apply_plan`. Forbidden raw fields remain excluded from all proposal and apply-plan responses.

## Phase 3.3 `proposal.preflight`

`proposal.preflight` accepts `{ "run_id": string, "proposal_id": string }` and returns `{ "proposal": WorkspacePatchProposalSummary, "snapshot": WorkspacePatchPreflightSnapshotSummary, "apply_plan": WorkspacePatchApplyPlanSummary }`. The proposal must exist, be `Approved`, and have `validation_status = Valid`; otherwise the runtime returns JSON-RPC `-32602`.

`WorkspacePatchPreflightSnapshotSummary` contains metadata only: `proposal_id`, `snapshot_id`, workspace-relative `path`, `canonical_path_hash`, `file_exists`, `file_kind` (`File`, `Directory`, `Missing`, `Other`, or `Unreadable`), `file_size_bytes`, `file_modified_unix_ms`, `file_sha256`, `captured_at`, `stale`, and `stale_reason`. The runtime hashes canonical paths instead of returning absolute paths, and it never returns file content, raw content, full content, patches, diffs, or raw input JSON.

`WorkspacePatchProposalSummary` includes `latest_snapshot` and `approval_reason_redacted`. Secret-like approval or rejection reasons are represented as `[redacted]` and are not stored raw. Preflight appends ledger metadata only and never writes files or applies patches.

## Phase 3.4 `proposal.readiness`

`proposal.readiness` accepts `{ "run_id": string, "proposal_id": string }` and returns `{ "proposal": WorkspacePatchProposalSummary, "report": WorkspacePatchReadinessReportSummary }`. Empty IDs, unknown runs, and unknown proposals return JSON-RPC `-32602`.

`WorkspacePatchReadinessReportSummary` contains `proposal_id`, `report_id`, `readiness_status`, `readiness_reason`, `readiness_fingerprint`, `fingerprint_input_count`, `generated_at`, a bounded checklist of `WorkspacePatchReadinessCheckSummary`, and a deterministic human-readable summary. Allowed readiness statuses are `Ready`, `NotReady`, and `Blocked`; allowed check statuses are `Pass`, `Fail`, `Blocked`, and `Skipped`.

The method uses the reconstructed proposal summary and latest preflight snapshot. It does not need a fresh target-file read in normal operation, does not write files, and does not apply patches. `Ready` means ready for final human review, not ready to apply; the `apply_not_implemented` check is always `Skipped` with the Phase 3.4 reason.

`WorkspacePatchReadinessReportCreated` is appended as summary-only ledger metadata. Readiness reports, checklists, snapshots, and ledger payloads must not expose raw file content, raw proposed content, raw input JSON, full patch content, raw diffs, canonical absolute paths, absolute paths, or secret-like text. Forbidden raw field names are `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, and `file_content`.

## Phase 3.5 `proposal.applyCapability`

`proposal.applyCapability` accepts `{ "run_id": string, "proposal_id": string }` and returns `{ "proposal": WorkspacePatchProposalSummary, "capability": WorkspacePatchApplyCapabilitySummary }`. Empty IDs, unknown runs, and unknown proposals return JSON-RPC `-32602`.

`WorkspacePatchApplyCapabilitySummary` contains summary metadata only: `proposal_id`, `capability_id`, `apply_supported`, `apply_enabled`, `mode`, `reason`, `required_gates`, `can_apply_now`, `checked_at`, `check_count`, `failed_checks`, `blocked_checks`, and a bounded checklist of `WorkspacePatchApplyCapabilityCheckSummary`. In Phase 3.5, `apply_supported`, `apply_enabled`, and `can_apply_now` are always `false`; `mode` is always `dry_run_only`; and `reason` is `Patch apply is not implemented in Phase 3.5.`

`proposal.applyCapability` is an inspect-only design contract. It may inspect existing proposal state and append a summary-only `WorkspacePatchApplyCapabilityChecked` ledger event. It must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.6 `proposal.applyDryRun`

`proposal.applyDryRun` accepts `{ "run_id": string, "proposal_id": string }` and returns `{ "proposal": WorkspacePatchProposalSummary, "dry_run": WorkspacePatchApplyDryRunSummary }`. Empty IDs, unknown runs, and unknown proposals return JSON-RPC `-32602`.

`WorkspacePatchApplyDryRunSummary` contains summary metadata only: `proposal_id`, `dry_run_id`, `dry_run_status`, `dry_run_reason`, `checked_at`, `required_gates`, `check_count`, `failed_checks`, `blocked_checks`, `no_patch_applied`, `apply_executed`, `workspace_files_changed`, and a bounded checklist of `WorkspacePatchApplyDryRunCheckSummary`. In Phase 3.6, dry-run inspection never applies a patch and never writes workspace files, so `no_patch_applied` is always `true`, `apply_executed` is always `false`, and `workspace_files_changed` is always `false`.

`proposal.applyDryRun` appends `WorkspacePatchApplyDryRunChecked` with summary-only metadata. It may inspect existing proposal, approval, preflight, readiness, and apply-disabled state, but it must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## M3 controlled apply readiness fingerprint

M3 strengthens the existing `proposal.readiness` and `proposal.applyDryRun` paths without adding a new endpoint. `proposal.readiness` records a `readiness_fingerprint` over stable summary-only proposal evidence, approval state, latest preflight snapshot metadata, and readiness checklist status. `proposal.applyDryRun` recomputes that fingerprint from the current reconstructed proposal state and fails the `readiness_fingerprint_current` gate when the latest readiness report no longer matches current evidence.

The fingerprint is summary-only. It must not include raw file content, raw diffs, raw input JSON, canonical absolute paths, shell command text, stdout/stderr, environment values, or network-derived content. M3 still never applies patches, writes workspace files, runs shell or git commands, fetches network resources, or authorizes apply.

## Phase 3.7 `proposal.applyDryRunHistory`

`proposal.applyDryRunHistory` accepts `{ "run_id": string, "proposal_id": string }` and returns `{ "proposal": WorkspacePatchProposalSummary, "history": WorkspacePatchApplyDryRunHistorySummary }`. Empty IDs, unknown runs, and unknown proposals return JSON-RPC `-32602`.

`WorkspacePatchApplyDryRunHistorySummary` contains `proposal_id`, `dry_run_count`, `latest_dry_run`, `dry_runs`, and `generated_at`. `dry_runs` is bounded to the 10 newest `WorkspacePatchApplyDryRunHistoryEntry` values in newest-first order; `dry_run_count` reports the full number of matching dry-run checks reconstructed from the ledger. `latest_dry_run` is the newest matching entry or `null` when no dry-run checks exist.

Each history entry is summary-only metadata reconstructed from sanitized `WorkspacePatchApplyDryRunChecked` payloads: `proposal_id`, `dry_run_id`, `dry_run_status`, `dry_run_reason`, `checked_at`, `required_gates`, `check_count`, `failed_checks`, `blocked_checks`, `no_patch_applied`, `apply_executed`, and `workspace_files_changed`. Every exposed entry must report `no_patch_applied = true`, `apply_executed = false`, and `workspace_files_changed = false`.

`proposal.applyDryRunHistory` appends no ledger event. It must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.8 `proposal.auditTrail`

`proposal.auditTrail` accepts `{ "run_id": string, "proposal_id": string }` and returns `{ "proposal": WorkspacePatchProposalSummary, "audit_trail": WorkspacePatchAuditTrailSummary }`. Empty IDs, unknown runs, and unknown proposals return JSON-RPC `-32602`.

`WorkspacePatchAuditTrailSummary` contains `proposal_id`, `event_count`, `latest_event`, `events`, and `generated_at`. `event_count` reports the total proposal lifecycle entries reconstructed from the ledger. `events` contains up to the 50 newest lifecycle entries in ledger order, and `latest_event` identifies the newest lifecycle entry even when the returned list is bounded.

Each `WorkspacePatchAuditTrailEntry` contains `event_id`, `audit_event`, `event_kind`, `timestamp`, `proposal_id`, `summary`, and `metadata`. Audit event names are stable high-level lifecycle names such as `proposal_created`, `proposal_approved`, `proposal_rejected`, `preflight_snapshot_created`, `apply_plan_created`, `readiness_checked`, `apply_capability_checked`, and `apply_dry_run_checked`.

`proposal.auditTrail` is reconstructed from existing sanitized ledger events and appends no ledger event. It must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.9 `proposal.reviewBundle`

`proposal.reviewBundle` accepts `{ "run_id": string, "proposal_id": string }` and returns `{ "proposal": WorkspacePatchProposalSummary, "review_bundle": WorkspacePatchReviewBundleSummary }`. Empty IDs, unknown runs, and unknown proposals return JSON-RPC `-32602`.

`WorkspacePatchReviewBundleSummary` contains `proposal_id`, `review_status`, `review_reason`, `latest_readiness`, `latest_apply_capability`, `latest_apply_dry_run`, `audit_event_count`, `latest_audit_event`, `required_next_actions`, and `generated_at`. `review_status` is `Complete` when the latest readiness, apply capability, and apply dry-run signals all exist, otherwise `NeedsAction`. Missing signals are listed as RPC names in `required_next_actions`.

The latest signal fields are compact `WorkspacePatchReviewSignalSummary` values containing only `status`, optional `reason`, optional `generated_at`, and optional `source_id`. `latest_audit_event` reuses the sanitized `WorkspacePatchAuditTrailEntry` shape.

`proposal.reviewBundle` is reconstructed from existing sanitized ledger events and appends no ledger event. It must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.10 `proposal.reviewVerdict`

`proposal.reviewVerdict` accepts `{ "run_id": string, "proposal_id": string }` and returns `{ "proposal": WorkspacePatchProposalSummary, "review_verdict": WorkspacePatchReviewVerdictSummary }`. Empty IDs, unknown runs, and unknown proposals return JSON-RPC `-32602`.

`WorkspacePatchReviewVerdictSummary` contains `proposal_id`, `verdict_status`, `verdict_reason`, `evidence_status`, `blocking_reasons`, `missing_signals`, `latest_review_bundle_status`, `apply_authorized`, and `generated_at`. Allowed verdict statuses are `ReadyForHumanReview`, `NeedsSignals`, and `BlockedForReview`. `apply_authorized` is always `false`.

`NeedsSignals` is returned when readiness, apply capability, or apply dry-run evidence is missing. `BlockedForReview` is returned when latest readiness is not `Ready`, dry-run evidence is incomplete or indicates patch application or workspace file changes, or proposal evidence is blocked or redacted. Apply capability values of `false` are expected safety-boundary evidence and are not apply authorization.

`proposal.reviewVerdict` is reconstructed from existing sanitized ledger events and appends no ledger event. It must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.11 `proposal.reviewReport`

`proposal.reviewReport` accepts `{ "run_id": string, "proposal_id": string }` and returns `{ "proposal": WorkspacePatchProposalSummary, "review_report": WorkspacePatchReviewReportSummary }`. Empty IDs, unknown runs, and unknown proposals return JSON-RPC `-32602`.

`WorkspacePatchReviewReportSummary` is summary-only and contains `proposal_id`, `report_status`, `report_reason`, `review_bundle`, `review_verdict`, `audit_event_count`, `recent_audit_events`, `required_next_actions`, `apply_authorized`, and `generated_at`. `report_status` is `Complete` only when the review bundle is complete and the verdict is `ReadyForHumanReview`, `NeedsAction` when signals are missing, and `Blocked` when the verdict is `BlockedForReview`. `recent_audit_events` contains at most the five newest sanitized lifecycle entries in newest-first order. `apply_authorized` is always `false`.

`proposal.reviewReport` is reconstructed from existing sanitized ledger events and appends no ledger event. It must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.12 `proposal.reviewQueue`

`proposal.reviewQueue` accepts `{ "run_id": string }` and returns `{ "review_queue": WorkspacePatchReviewQueueSummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueSummary` is summary-only and contains `run_id`, `queue_status`, `queue_reason`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `items`, `required_next_actions`, and `generated_at`. Each item contains compact proposal identifiers and review status fields: `proposal_id`, `path`, `validation_status`, `approval_status`, `report_status`, `report_reason`, `verdict_status`, `review_status`, `audit_event_count`, `latest_audit_event`, `required_next_actions`, `apply_authorized`, and `generated_at`.

`queue_status` is `Blocked` when any queue item is blocked, `NeedsAction` when no item is blocked and at least one item needs action, and `Complete` only when all queue items are complete. `apply_authorized` is always `false` for every item. `proposal.reviewQueue` is reconstructed from existing sanitized ledger events and appends no ledger event. It must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.13 `proposal.reviewQueueDiagnostics`

`proposal.reviewQueueDiagnostics` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics": WorkspacePatchReviewQueueDiagnosticsSummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueDiagnosticsSummary` is summary-only and contains `run_id`, `diagnostics_status`, `diagnostics_reason`, `queue_status`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `check_count`, `failed_checks`, `blocked_checks`, `checks`, `required_next_actions`, `apply_authorized`, and `generated_at`. Each check contains `name`, `status`, and `reason`.

Diagnostics reconstruct the existing `proposal.reviewQueue` summary and validate compact consistency checks such as count/status agreement, `apply_authorized=false` on all queue items, compact review evidence presence, and deduplicated required next actions. `diagnostics_status` is `Blocked` when consistency checks fail or queue evidence is blocked, `NeedsAction` when checks pass but the queue still needs action, and `Complete` when checks pass and the queue is complete. `apply_authorized` is always `false`. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.14 `proposal.reviewQueueDiagnosticsHistory`

`proposal.reviewQueueDiagnosticsHistory` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_history": WorkspacePatchReviewQueueDiagnosticsHistorySummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueDiagnosticsHistorySummary` is summary-only and contains `run_id`, `history_status`, `history_reason`, `diagnostics_count`, `latest_diagnostics`, `entries`, `apply_authorized`, and `generated_at`. Each entry contains `diagnostics_id`, `diagnostics_status`, `queue_status`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_checks`, `blocked_checks`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The history surface reconstructs the latest `proposal.reviewQueueDiagnostics` summary on demand and returns it as a bounded one-entry history. `history_status` mirrors the latest diagnostics status. `diagnostics_count` is the number of bounded entries returned. `apply_authorized` is always `false` on the history and every entry. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.15 `proposal.reviewQueueDiagnosticsReport`

`proposal.reviewQueueDiagnosticsReport` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_report": WorkspacePatchReviewQueueDiagnosticsReportSummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueDiagnosticsReportSummary` is summary-only and contains `run_id`, `report_status`, `report_reason`, `queue_status`, `diagnostics_status`, `diagnostics_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_checks`, `blocked_checks`, `required_next_actions`, `latest_diagnostics`, `apply_authorized`, and `generated_at`.

The report surface reconstructs the latest review queue diagnostics history on demand and returns a bounded operator report over queue and diagnostics state. `report_status` mirrors the diagnostics status. `latest_diagnostics` is the latest bounded diagnostics history entry when available. `apply_authorized` is always `false`. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.16 `proposal.reviewQueueDiagnosticsDigest`

`proposal.reviewQueueDiagnosticsDigest` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest": WorkspacePatchReviewQueueDiagnosticsDigestSummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueDiagnosticsDigestSummary` is summary-only and contains `run_id`, `digest_status`, `digest_reason`, `queue_status`, `diagnostics_status`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest surface reconstructs the latest diagnostics report on demand and returns a compact dashboard-oriented status payload. `digest_status` mirrors the report status, and `required_next_action_count` matches the bounded `required_next_actions` length. `apply_authorized` is always `false`. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.17 `proposal.reviewQueueDiagnosticsDigestHistory`

`proposal.reviewQueueDiagnosticsDigestHistory` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_history": WorkspacePatchReviewQueueDiagnosticsDigestHistorySummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueDiagnosticsDigestHistorySummary` is summary-only and contains `run_id`, `history_status`, `history_reason`, `digest_count`, `latest_digest`, `entries`, `apply_authorized`, and `generated_at`. Each entry contains `digest_id`, `digest_status`, `queue_status`, `diagnostics_status`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest history surface reconstructs the latest diagnostics digest on demand and returns it as a bounded one-entry history. `history_status` mirrors the latest digest status. `digest_count` is the number of bounded entries returned. `apply_authorized` is always `false` on the history and every entry. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.18 `proposal.reviewQueueDiagnosticsDigestReport`

`proposal.reviewQueueDiagnosticsDigestReport` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report": WorkspacePatchReviewQueueDiagnosticsDigestReportSummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportSummary` is summary-only and contains `run_id`, `report_status`, `report_reason`, `digest_status`, `history_status`, `digest_count`, `latest_digest`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report surface reconstructs the latest diagnostics digest history on demand and summarizes it for operators. `report_status` mirrors the digest history status. `digest_count` is the number of bounded digest history entries represented. `apply_authorized` is always `false`. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.19 `proposal.reviewQueueDiagnosticsDigestReportHistory`

`proposal.reviewQueueDiagnosticsDigestReportHistory` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_history": WorkspacePatchReviewQueueDiagnosticsDigestReportHistorySummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportHistorySummary` is summary-only and contains `run_id`, `history_status`, `history_reason`, `report_count`, `latest_report`, `entries`, `apply_authorized`, and `generated_at`. Each entry contains `report_id`, `report_status`, `digest_status`, `history_status`, `digest_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report history surface reconstructs the latest diagnostics digest report on demand and returns it as a bounded one-entry history. `history_status` mirrors the latest report status. `report_count` is the number of bounded entries returned. `apply_authorized` is always `false` on the history and every entry. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.20 `proposal.reviewQueueDiagnosticsDigestReportVerdict`

`proposal.reviewQueueDiagnosticsDigestReportVerdict` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictSummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictSummary` is summary-only and contains `run_id`, `verdict_status`, `verdict_reason`, `history_status`, `report_status`, `report_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict surface reconstructs the latest diagnostics digest report history on demand and summarizes it for operators. `verdict_status` mirrors the digest report history status. `apply_authorized` is always `false`. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.21 `proposal.reviewQueueDiagnosticsDigestReportVerdictHistory`

`proposal.reviewQueueDiagnosticsDigestReportVerdictHistory` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_history": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictHistorySummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictHistorySummary` is summary-only and contains `run_id`, `history_status`, `history_reason`, `verdict_count`, `latest_verdict`, `entries`, `apply_authorized`, and `generated_at`. Each entry contains `verdict_id`, `verdict_status`, `history_status`, `report_status`, `report_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict history surface reconstructs the latest diagnostics digest report verdict on demand and returns it as a bounded one-entry history. `history_status` mirrors the latest verdict status. `verdict_count` is the number of bounded entries returned. `apply_authorized` is always `false` on the history and every entry. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.22 `proposal.reviewQueueDiagnosticsDigestReportVerdictReport`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReport` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportSummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportSummary` is summary-only and contains `run_id`, `report_status`, `report_reason`, `history_status`, `verdict_status`, `verdict_count`, `latest_verdict`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report surface reconstructs the latest diagnostics digest report verdict history on demand and summarizes it for operators. `report_status` mirrors the verdict history status. `apply_authorized` is always `false`. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.23 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistory`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistory` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistorySummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistorySummary` is summary-only and contains `run_id`, `history_status`, `history_reason`, `report_count`, `latest_report`, `entries`, `apply_authorized`, and `generated_at`. Each entry contains `report_id`, `report_status`, `history_status`, `verdict_status`, `verdict_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history surface reconstructs the latest diagnostics digest report verdict report on demand and returns it as a bounded one-entry history. `history_status` mirrors the latest report status. `report_count` is the number of bounded entries returned. `apply_authorized` is always `false` on the history and every entry. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.24 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigest`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigest` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestSummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestSummary` is summary-only and contains `run_id`, `digest_status`, `digest_reason`, `history_status`, `report_status`, `report_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest surface reconstructs the latest diagnostics digest report verdict report history on demand and summarizes it for dashboards. `digest_status` mirrors the history status. `report_status` mirrors the latest report status when available. `apply_authorized` is always `false`. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.25 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistory`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistory` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistorySummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistorySummary` is summary-only and contains `run_id`, `history_status`, `history_reason`, `digest_count`, `latest_digest`, `entries`, `apply_authorized`, and `generated_at`. Each entry contains `digest_id`, `digest_status`, `history_status`, `report_status`, `report_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history surface reconstructs the latest diagnostics digest report verdict report history digest on demand and returns it as a bounded one-entry history. `history_status` mirrors the latest digest status. `digest_count` is the number of bounded entries returned. `apply_authorized` is always `false` on the history and every entry. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.26 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReport`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReport` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportSummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportSummary` is summary-only and contains `run_id`, `report_status`, `report_reason`, `history_status`, `digest_status`, `digest_count`, `latest_digest`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history report surface reconstructs the latest diagnostics digest report verdict report history digest history on demand and summarizes it for operators. `report_status` mirrors the history status. `digest_status` mirrors the latest digest status when available. `apply_authorized` is always `false`. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.27 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistory`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistory` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistorySummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistorySummary` is summary-only and contains `run_id`, `history_status`, `history_reason`, `report_count`, `latest_report`, `entries`, `apply_authorized`, and `generated_at`. Each entry contains `report_id`, `report_status`, `history_status`, `digest_status`, `digest_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history report history surface reconstructs the latest diagnostics digest report verdict report history digest history report on demand and returns it as a bounded one-entry history. `history_status` mirrors the latest report status. `report_count` is the number of bounded entries returned. `apply_authorized` is always `false` on the history and every entry. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.28 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigest`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigest` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestSummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestSummary` is summary-only and contains `run_id`, `digest_status`, `digest_reason`, `history_status`, `report_status`, `report_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history report history digest surface reconstructs the latest diagnostics digest report verdict report history digest history report history on demand and summarizes it for dashboards. `digest_status` mirrors the history status. `report_status` mirrors the latest report status when available. `required_next_action_count` matches the bounded `required_next_actions` length. `apply_authorized` is always `false`. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.29 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistory`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistory` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistorySummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistorySummary` is summary-only and contains `run_id`, `history_status`, `history_reason`, `digest_count`, `latest_digest`, `entries`, `apply_authorized`, and `generated_at`. Each entry contains `digest_id`, `digest_status`, `history_status`, `report_status`, `report_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history report history digest history surface reconstructs the latest diagnostics digest report verdict report history digest history report history digest on demand and returns it as a bounded one-entry history. `history_status` mirrors the latest digest status. `digest_count` is the number of bounded entries returned. `apply_authorized` is always `false` on the history and every entry. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.30 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReport`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReport` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary` is summary-only and contains `run_id`, `report_status`, `report_reason`, `history_status`, `digest_status`, `digest_count`, `latest_digest`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history report history digest history report surface reconstructs the latest diagnostics digest report verdict report history digest history report history digest history on demand and summarizes it for operators. `report_status` mirrors the history status. `digest_status` mirrors the latest digest status when available. `required_next_action_count` matches the bounded `required_next_actions` length. `apply_authorized` is always `false`. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.31 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary` is summary-only and contains `run_id`, `history_status`, `history_reason`, `report_count`, `latest_report`, `entries`, `apply_authorized`, and `generated_at`. Each entry contains `report_id`, `report_status`, `history_status`, `digest_status`, `digest_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history report history digest history report history surface reconstructs the latest diagnostics digest report verdict report history digest history report history digest history report on demand and returns it as a bounded one-entry history. `history_status` mirrors the latest report status. `report_count` is the number of bounded entries returned. `apply_authorized` is always `false` on the history and every entry. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.32 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary` is summary-only and contains `run_id`, `digest_status`, `digest_reason`, `history_status`, `report_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history report history digest history report history digest surface reconstructs the latest diagnostics digest report verdict report history digest history report history digest history report history on demand and returns compact digest fields for digest status, history status, report count, proposal counts, check counts, and required next actions. `digest_status` mirrors the history status. `required_next_action_count` matches the bounded `required_next_actions` length. `apply_authorized` is always `false`. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.33 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary` is summary-only and contains `run_id`, `history_status`, `history_reason`, `digest_count`, `latest_digest`, `entries`, `apply_authorized`, and `generated_at`. Each entry contains `digest_id`, `digest_status`, `history_status`, `report_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history report history digest history report history digest history surface reconstructs the latest diagnostics digest report verdict report history digest history report history digest history report history digest on demand and returns it as a bounded one-entry history. `history_status` mirrors the latest digest status. `digest_count` is the number of bounded entries returned. `apply_authorized` is always `false` on the history and every entry. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.34 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary` is summary-only and contains `run_id`, `report_status`, `report_reason`, `history_status`, `digest_status`, `digest_count`, `latest_digest`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history report history digest history report history digest history report surface reconstructs the latest diagnostics digest report verdict report history digest history report history digest history report history digest history on demand and summarizes it for operators. `report_status` mirrors the history status. `digest_status` mirrors the latest digest status when available. `required_next_action_count` matches the bounded `required_next_actions` length. `apply_authorized` is always `false`. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.35 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary` is summary-only and contains `run_id`, `history_status`, `history_reason`, `report_count`, `latest_report`, `entries`, `apply_authorized`, and `generated_at`. Each entry contains `report_id`, `report_status`, `history_status`, `digest_status`, `digest_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history report history digest history report history digest history report history surface reconstructs the latest diagnostics digest report verdict report history digest history report history digest history report history digest history report on demand and returns it as a bounded one-entry history. `history_status` mirrors the latest report status. `report_count` is the number of bounded entries returned. `apply_authorized` is always `false` on the history and every entry. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.36 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary` is summary-only and contains `run_id`, `digest_status`, `digest_reason`, `history_status`, `report_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history report history digest history report history digest history report history digest surface reconstructs the current diagnostics digest report verdict report history digest history report history digest history report history digest history report history on demand and returns compact dashboard fields. `digest_status` mirrors the history status. Count fields and required next actions are derived from the latest report entry when available. `required_next_action_count` matches the bounded `required_next_actions` length. `apply_authorized` is always `false`. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.37 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary }`. Empty IDs return JSON-RPC `-32602`. Unknown runs, or runs without an available Phase 3.36 digest, return a summary-only empty history with `digest_count = 0`, `latest_digest = null`, `entries = []`, and `apply_authorized = false`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary` is summary-only and contains `run_id`, `history_status`, `history_reason`, `digest_count`, `latest_digest`, `entries`, `apply_authorized`, and `generated_at`. Each entry contains `digest_id`, `digest_status`, `history_status`, `report_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history report history digest history report history digest history report history digest history surface reconstructs the latest diagnostics digest report verdict report history digest history report history digest history report history digest history report history digest on demand and returns it as a bounded history. `history_status` mirrors the latest digest status when available, and reports a blocked empty history when no digest is available. `digest_count` is the number of bounded entries returned. `apply_authorized` is always `false` on the history and every entry. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.38 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary }`. Empty IDs return JSON-RPC `-32602`. Unknown runs, or runs without an available Phase 3.37 history entry, return a summary-only report with `digest_count = 0`, `latest_digest = null`, zero count fields, and `apply_authorized = false`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary` is summary-only and contains `run_id`, `report_status`, `report_reason`, `history_status`, `digest_status`, `digest_count`, `latest_digest`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history report history digest history report history digest history report history digest history report surface reuses the Phase 3.37 history inspection path as its source of truth and summarizes the latest digest when available. `report_status` mirrors the history status. `digest_status` mirrors the latest digest status when available and otherwise mirrors the empty history status. Count fields and required next actions are derived only from the latest digest. `required_next_action_count` matches the bounded `required_next_actions` length. `apply_authorized` is always `false`. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.39 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary }`. Empty IDs return JSON-RPC `-32602`. Unknown runs, or runs without an available Phase 3.38 report entry, return a summary-only empty history with `report_count = 0`, `latest_report = null`, `entries = []`, and `apply_authorized = false`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary` is summary-only and contains `run_id`, `history_status`, `history_reason`, `report_count`, `latest_report`, `entries`, `apply_authorized`, and `generated_at`. Each entry contains `report_id`, `report_status`, `history_status`, `digest_status`, `digest_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history report history digest history report history digest history report history digest history report history surface reuses the Phase 3.38 report inspection path as its source of truth and returns a bounded one-entry history when a report exists. `history_status` mirrors the latest report status. `report_count` is the number of bounded entries returned and matches `entries.length`. Each entry's `required_next_action_count` matches its bounded `required_next_actions` length. `apply_authorized` is always `false` on the history and every entry. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.40 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary }`. Empty IDs return JSON-RPC `-32602`. Unknown runs, or runs without an available Phase 3.39 report history entry, return a summary-only digest with zero count fields, empty `required_next_actions`, and `apply_authorized = false`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary` is summary-only and contains `run_id`, `digest_status`, `digest_reason`, `history_status`, `report_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history report history digest history report history digest history report history digest history report history digest surface reuses the Phase 3.39 report history inspection path as its source of truth and returns compact digest fields. `digest_status` mirrors the report history status. Count fields and required next actions are derived from the latest report when available. `required_next_action_count` matches the bounded `required_next_actions` length. `apply_authorized` is always `false`. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.41 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary }`. Empty IDs return JSON-RPC `-32602`. Unknown runs, or runs without an available Phase 3.40 digest, return a summary-only empty history with `digest_count = 0`, `latest_digest = null`, `entries = []`, and `apply_authorized = false`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary` is summary-only and contains `run_id`, `history_status`, `history_reason`, `digest_count`, `latest_digest`, `entries`, `apply_authorized`, and `generated_at`. Each entry contains `digest_id`, `digest_status`, `history_status`, `report_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history report history digest history report history digest history report history digest history report history digest history surface reuses the Phase 3.40 digest inspection path as its source of truth and returns a bounded one-entry history when a digest exists. `history_status` mirrors the latest digest status. `digest_count` is the number of bounded entries returned and matches `entries.length`. Each entry's `required_next_action_count` matches its bounded `required_next_actions` length. `apply_authorized` is always `false` on the history and every entry. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.42 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary }`. Empty IDs return JSON-RPC `-32602`. Unknown runs, or runs without an available Phase 3.41 digest history entry, return a summary-only report with `digest_count = 0`, `latest_digest = null`, zero count fields, empty `required_next_actions`, and `apply_authorized = false`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary` is summary-only and contains `run_id`, `report_status`, `report_reason`, `history_status`, `digest_count`, `latest_digest`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history report history digest history report history digest history report history digest history report history digest history report surface reuses the Phase 3.41 digest history inspection path as its source of truth and summarizes the latest digest when available. `report_status` mirrors the history status. Count fields and required next actions are derived from the latest digest. `required_next_action_count` matches the bounded `required_next_actions` length. `apply_authorized` is always `false` on the report and nested latest digest. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.43 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary }`. Empty IDs return JSON-RPC `-32602`. Unknown runs, or runs without an available Phase 3.42 report, return a summary-only empty history with `report_count = 0`, `latest_report = null`, `entries = []`, and `apply_authorized = false`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary` is summary-only and contains `run_id`, `history_status`, `history_reason`, `report_count`, `latest_report`, `entries`, `apply_authorized`, and `generated_at`. Each entry contains `report_id`, `report_status`, `history_status`, `digest_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history report history digest history report history digest history report history digest history report history digest history report history surface reuses the Phase 3.42 report inspection path as its source of truth and returns a bounded one-entry history when a report exists. `history_status` mirrors the latest report status. `report_count` is the number of bounded entries returned and matches `entries.length`. Each entry's `required_next_action_count` matches its bounded `required_next_actions` length. `apply_authorized` is always `false` on the history and every entry. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.44 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary }`. Empty IDs return JSON-RPC `-32602`. Unknown runs, or runs without available Phase 3.43 history, return a summary-only empty digest with zero counts, empty `required_next_actions`, and `apply_authorized = false`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary` is summary-only and contains `run_id`, `digest_status`, `digest_reason`, `history_status`, `report_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history report history digest history report history digest history report history digest history report history digest history report history digest surface reuses the Phase 3.43 history inspection path as its source of truth and returns compact digest fields. `digest_status` mirrors the history status. Count fields and required next actions are derived from the latest report when available. `required_next_action_count` matches the bounded `required_next_actions` length. `apply_authorized` is always `false`. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.45 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary }`. Empty IDs return JSON-RPC `-32602`. Unknown runs, or runs without available Phase 3.44 digest, return a summary-only empty history with `digest_count = 0`, `latest_digest = null`, `entries = []`, and `apply_authorized = false`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary` is summary-only and contains `run_id`, `history_status`, `history_reason`, `digest_count`, `latest_digest`, `entries`, `apply_authorized`, and `generated_at`. Each entry is a `WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary` containing `digest_id`, `digest_status`, `history_status`, `report_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history report history digest history report history digest history report history digest history report history digest history report history digest history surface reuses the Phase 3.44 digest inspection path as its source of truth and returns a bounded summary-only history. `digest_count` equals `entries.length`, and each entry's `required_next_action_count` equals `required_next_actions.length`. `latest_digest` is either `null` or one of the same compact entry shapes. `apply_authorized` is always `false` at the top level and inside entries. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.46 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary }`. Empty IDs return JSON-RPC `-32602`. Unknown runs, or runs without available Phase 3.45 history, return a summary-only empty report with `digest_count = 0`, `latest_digest = null`, zero aggregate counts, empty `required_next_actions`, and `apply_authorized = false`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary` is summary-only and contains `run_id`, `report_status`, `report_reason`, `history_status`, `digest_count`, `latest_digest`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history report history digest history report history digest history report history digest history report history digest history report history digest history report surface reuses the Phase 3.45 history inspection path as its source of truth and returns compact report fields. Count fields and required next actions are derived from `latest_digest` when available. `required_next_action_count` matches the bounded `required_next_actions` length. `apply_authorized` is always `false` at the top level and inside `latest_digest`. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.47 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary }`. Empty IDs return JSON-RPC `-32602`. Unknown runs, or runs without available Phase 3.46 report content, return a summary-only empty history with `report_count = 0`, `latest_report = null`, `entries = []`, and `apply_authorized = false`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary` is summary-only and contains `run_id`, `history_status`, `history_reason`, `report_count`, `latest_report`, `entries`, `apply_authorized`, and `generated_at`. Each entry is a `WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary` containing `report_id`, `report_status`, `history_status`, `digest_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history report history digest history report history digest history report history digest history report history digest history report history digest history report history surface reuses the Phase 3.46 report inspection path as its source of truth and returns a bounded summary-only history. `report_count` equals `entries.length`, and each entry's `required_next_action_count` equals `required_next_actions.length`. `latest_report` is either `null` or one of the same compact entry shapes. `apply_authorized` is always `false` at the top level and inside entries. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.48 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary }`. Empty IDs return JSON-RPC `-32602`. Unknown runs, or runs without available Phase 3.47 history content, return a summary-only empty digest with `report_count = 0`, zero aggregate counts, empty `required_next_actions`, and `apply_authorized = false`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary` is summary-only and contains `run_id`, `digest_status`, `digest_reason`, `history_status`, `report_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history report history digest history report history digest history report history digest history report history digest history report history digest history report history digest surface reuses the Phase 3.47 history inspection path as its source of truth and returns compact digest fields. Count fields and required next actions are derived from `latest_report` when available. `required_next_action_count` matches the bounded `required_next_actions` length. `apply_authorized` is always `false`. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.49 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary }`. Empty IDs return JSON-RPC `-32602`. Unknown runs, or runs without available Phase 3.48 digest content, return a summary-only empty history with `digest_count = 0`, `latest_digest = null`, `entries = []`, and `apply_authorized = false`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary` is summary-only and contains `run_id`, `history_status`, `history_reason`, `digest_count`, `latest_digest`, `entries`, `apply_authorized`, and `generated_at`. Each entry is a `WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary` containing `digest_id`, `digest_status`, `history_status`, `report_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history report history digest history report history digest history report history digest history report history digest history report history digest history report history digest history surface reuses the Phase 3.48 digest inspection path as its source of truth and returns a bounded summary-only history. `digest_count` equals `entries.length`, and each entry's `required_next_action_count` equals `required_next_actions.length`. `latest_digest` is either `null` or one of the same compact entry shapes. `apply_authorized` is always `false` at the top level and inside entries. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.50 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary }`. Empty IDs return JSON-RPC `-32602`. Unknown runs, or runs without available Phase 3.49 history content, return a compact summary-only empty report with `digest_count = 0`, `latest_digest = null`, zero aggregate counts, empty `required_next_actions`, and `apply_authorized = false`.

The report exposes only `run_id`, `report_status`, `report_reason`, `history_status`, `digest_count`, `latest_digest`, aggregate proposal/check counts, bounded `required_next_actions`, `apply_authorized=false`, and `generated_at`. If present, `latest_digest` is the Phase 3.49 summary-only latest digest entry. Top-level and nested `required_next_action_count` values must match their array lengths. The method appends no ledger event, never authorizes apply, and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw reports, raw digests, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, `file_content`, command strings, stdout, stderr, environment values, or serialized request bodies.

## Phase 3.51 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary }`. Empty IDs return JSON-RPC `-32602`. Unknown runs, or runs without available Phase 3.50 report content, return a summary-only empty history with `report_count = 0`, `latest_report = null`, `entries = []`, and `apply_authorized = false`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary` is summary-only and contains `run_id`, `history_status`, `history_reason`, `report_count`, `latest_report`, `entries`, `apply_authorized`, and `generated_at`. Each entry is a `WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary` containing `report_id`, `report_status`, `history_status`, `digest_count`, aggregate proposal/check counts, `required_next_action_count`, bounded `required_next_actions`, `apply_authorized`, and `generated_at`. The endpoint reuses the Phase 3.50 report builder, appends no ledger event, never authorizes apply, and exposes no raw content, diffs, paths, command strings, stdout, stderr, environment values, or serialized request bodies.

## M5 subtask orchestration queue

M5 introduces runtime-owned subtask orchestration state without spawning subtasks. During `task.run`, an approved assistant `subtask.spawn` intent appends one `SubtaskOrchestrationQueued` ledger event. The event is summary-only and includes `subtask_id`, `parent_task_id`, `parent_run_id`, `tool_id`, `required_action`, `status = "Queued"`, `queue_position`, `request_reason`, `input_summary`, `execution_enabled = false`, and a high-level reason.

`run.events` returns these fields through the normal sanitized ledger summary path, and `run.inspect` / `task.inspect` expose `has_subtask_orchestration_queued` and `subtask_queue_count`. M5 does not launch child tasks, execute process commands, access the network, control services, apply patches, write workspace files, or persist raw `input`, raw provider responses, raw prompts, raw file content, command strings, stdout, stderr, environment values, or serialized request bodies.

## M5.1 subtask handoff preparation

M5.1 consumes queued subtask orchestration evidence inside `task.run` without spawning child tasks. When a run has one or more `SubtaskOrchestrationQueued` events, the runtime appends one `SubtaskHandoffPrepared` ledger event before completion. The event is summary-only and includes `handoff_id`, `parent_task_id`, `parent_run_id`, `status = "Prepared"`, `queued_count`, `queued_subtask_ids`, `source_event_count`, `execution_enabled = false`, `next_action = "await_future_runtime_scheduler"`, and a high-level reason.

`run.events` returns the sanitized handoff fields, and `run.inspect` / `task.inspect` expose `has_subtask_handoff_prepared` and `subtask_handoff_count`. M5.1 does not launch child tasks, execute process commands, access the network, control services, apply patches, write workspace files, or persist raw `input`, raw provider responses, raw prompts, raw file content, command strings, stdout, stderr, environment values, or serialized request bodies.

## M5.2 subtask scheduler readiness

M5.2 evaluates prepared subtask handoff evidence inside `task.run` without spawning child tasks. When a run has one or more `SubtaskHandoffPrepared` events, the runtime appends one `SubtaskSchedulerReadinessRecorded` ledger event before completion. The event is summary-only and includes `readiness_id`, `parent_task_id`, `parent_run_id`, `handoff_id`, `handoff_count`, `queued_count`, `source_event_count`, `status = "Blocked"`, `readiness_status = "Blocked"`, `readiness_reason`, `check_count`, `blocked_checks`, `execution_enabled = false`, `dispatch_enabled = false`, `next_action = "await_runtime_scheduler_dispatch"`, and a high-level reason.

`run.events` returns the sanitized readiness fields, and `run.inspect` / `task.inspect` expose `has_subtask_scheduler_readiness` and `subtask_scheduler_readiness_count`. M5.2 does not launch child tasks, execute process commands, access the network, control services, apply patches, write workspace files, or persist raw `input`, raw provider responses, raw prompts, raw file content, command strings, stdout, stderr, environment values, or serialized request bodies.

## M5.3 subtask dispatch plan preparation

M5.3 consumes scheduler-readiness evidence inside `task.run` without spawning child tasks. When a run has one or more `SubtaskSchedulerReadinessRecorded` events, the runtime appends one `SubtaskDispatchPlanPrepared` ledger event before completion. The event is summary-only and includes `plan_id`, `parent_task_id`, `parent_run_id`, `readiness_id`, `readiness_count`, `queued_count`, `source_event_count`, `status = "Blocked"`, `dispatch_plan_status = "Blocked"`, `dispatch_reason`, `required_capability`, `check_count`, `blocked_checks`, `execution_enabled = false`, `dispatch_enabled = false`, `next_action = "await_runtime_subtask_dispatcher"`, and a high-level reason.

`run.events` returns the sanitized dispatch-plan fields, and `run.inspect` / `task.inspect` expose `has_subtask_dispatch_plan_prepared` and `subtask_dispatch_plan_count`. M5.3 does not launch child tasks, execute process commands, access the network, control services, apply patches, write workspace files, or persist raw `input`, raw provider responses, raw prompts, raw file content, command strings, stdout, stderr, environment values, or serialized request bodies.

## M5.4 subtask dispatch contract preparation

M5.4 consumes dispatch-plan evidence inside `task.run` without spawning child tasks. When a run has one or more `SubtaskDispatchPlanPrepared` events, the runtime appends one `SubtaskDispatchContractPrepared` ledger event before completion. The event is summary-only and includes `contract_id`, `parent_task_id`, `parent_run_id`, `plan_id`, `plan_count`, `queued_count`, `source_event_count`, `status = "Blocked"`, `dispatch_contract_status = "Blocked"`, `eligibility_status = "Blocked"`, `dispatch_contract_reason`, `required_capability`, `required_preconditions`, `check_count`, `blocked_checks`, `execution_enabled = false`, `dispatch_enabled = false`, `next_action = "await_dispatch_contract_implementation"`, and a high-level reason.

`run.events` returns the sanitized dispatch-contract fields, and `run.inspect` / `task.inspect` expose `has_subtask_dispatch_contract_prepared` and `subtask_dispatch_contract_count`. M5.4 does not launch child tasks, execute process commands, access the network, control services, apply patches, write workspace files, or persist raw `input`, raw provider responses, raw prompts, raw file content, command strings, stdout, stderr, environment values, or serialized request bodies.

## M5.5 subtask dispatch admission evaluation

M5.5 consumes dispatch-contract evidence inside `task.run` without spawning child tasks. When a run has one or more `SubtaskDispatchContractPrepared` events, the runtime appends one `SubtaskDispatchAdmissionEvaluated` ledger event before completion. The event is summary-only and includes `admission_id`, `parent_task_id`, `parent_run_id`, `contract_id`, `contract_count`, `queued_count`, `source_event_count`, `status = "Blocked"`, `admission_status = "Blocked"`, `execution_gate_status = "Blocked"`, `admission_reason`, `required_capability`, `precondition_count`, `satisfied_precondition_count`, `blocked_preconditions`, `check_count`, `blocked_checks`, `execution_enabled = false`, `dispatch_enabled = false`, `next_action = "await_dispatch_admission_preconditions"`, and a high-level reason.

`run.events` returns the sanitized dispatch-admission fields, and `run.inspect` / `task.inspect` expose `has_subtask_dispatch_admission_evaluated` and `subtask_dispatch_admission_count`. M5.5 does not launch child tasks, execute process commands, access the network, control services, apply patches, write workspace files, or persist raw `input`, raw provider responses, raw prompts, raw file content, command strings, stdout, stderr, environment values, or serialized request bodies.

## M5.6 subtask dispatch readiness snapshot

M5.6 consumes dispatch-admission evidence inside `task.run` without spawning child tasks. When a run has one or more `SubtaskDispatchAdmissionEvaluated` events, the runtime appends one `SubtaskDispatchReadinessSnapshotRecorded` ledger event before completion. The event is summary-only and includes `snapshot_id`, `parent_task_id`, `parent_run_id`, `admission_id`, `admission_count`, `queued_count`, `source_event_count`, `status = "Blocked"`, `readiness_status = "Blocked"`, `scheduler_handoff_status = "Blocked"`, `readiness_reason`, `required_capability`, `precondition_count`, `satisfied_precondition_count`, `blocked_preconditions`, `check_count`, `blocked_checks`, `readiness_fingerprint`, `fingerprint_input_count`, `execution_enabled = false`, `dispatch_enabled = false`, `next_action = "await_dispatch_readiness_snapshot_handoff"`, and a high-level reason.

`run.events` returns the sanitized dispatch-readiness snapshot fields, and `run.inspect` / `task.inspect` expose `has_subtask_dispatch_readiness_snapshot` and `subtask_dispatch_readiness_snapshot_count`. M5.6 does not launch child tasks, execute process commands, access the network, control services, apply patches, write workspace files, or persist raw `input`, raw provider responses, raw prompts, raw file content, command strings, stdout, stderr, environment values, or serialized request bodies.

## M5.7 subtask dispatcher guard verdict

M5.7 consumes dispatch-readiness snapshot evidence inside `task.run` without spawning child tasks. When a run has one or more `SubtaskDispatchReadinessSnapshotRecorded` events, the runtime appends one `SubtaskDispatcherGuardVerdictRecorded` ledger event before completion. The event is summary-only and includes `guard_id`, `parent_task_id`, `parent_run_id`, `snapshot_id`, `snapshot_count`, `queued_count`, `source_event_count`, `status = "Blocked"`, `guard_status = "Blocked"`, `scheduler_handoff_status = "Blocked"`, `handoff_preflight_status = "Blocked"`, `snapshot_validity_status`, `snapshot_fingerprint`, `snapshot_fingerprint_count`, `fingerprint_input_count`, `guard_reason`, `required_capability`, `precondition_count`, `satisfied_precondition_count`, `blocked_preconditions`, `check_count`, `blocked_checks`, `execution_enabled = false`, `dispatch_enabled = false`, `next_action = "await_dispatcher_guard_preconditions"`, and a high-level reason.

`run.events` returns the sanitized dispatcher-guard verdict fields, and `run.inspect` / `task.inspect` expose `has_subtask_dispatcher_guard_verdict` and `subtask_dispatcher_guard_verdict_count`. M5.7 does not launch child tasks, execute process commands, access the network, control services, apply patches, write workspace files, or persist raw `input`, raw provider responses, raw prompts, raw file content, command strings, stdout, stderr, environment values, or serialized request bodies.

## M5.8 subtask dispatch decision

M5.8 consumes dispatcher guard verdict evidence inside `task.run` without spawning child tasks. When a run has one or more `SubtaskDispatcherGuardVerdictRecorded` events, the runtime appends one `SubtaskDispatchDecisionRecorded` ledger event before completion. The event is summary-only and includes `decision_id`, `parent_task_id`, `parent_run_id`, `guard_id`, `guard_count`, `snapshot_id`, `queued_count`, `source_event_count`, `status = "Blocked"`, `decision_status = "Blocked"`, `candidate_status = "Blocked"`, `dispatch_decision = "Denied"`, `dispatch_denial_reason`, `handoff_preflight_status`, `guard_status`, `snapshot_validity_status`, `snapshot_fingerprint`, `snapshot_fingerprint_count`, `fingerprint_input_count`, `dispatch_candidate_count`, `eligible_candidate_count`, `blocked_candidate_count`, `required_capability`, `precondition_count`, `satisfied_precondition_count`, `blocked_preconditions`, `check_count`, `blocked_checks`, `execution_enabled = false`, `dispatch_enabled = false`, `next_action = "await_dispatch_decision_preconditions"`, and a high-level reason.

`run.events` returns the sanitized dispatch-decision fields, and `run.inspect` / `task.inspect` expose `has_subtask_dispatch_decision` and `subtask_dispatch_decision_count`. M5.8 does not launch child tasks, execute process commands, access the network, control services, apply patches, write workspace files, or persist raw `input`, raw provider responses, raw prompts, raw file content, command strings, stdout, stderr, environment values, or serialized request bodies.

## M5.9 subtask dispatch candidate manifest

M5.9 consumes dispatch decision evidence inside `task.run` without spawning child tasks. When a run has one or more `SubtaskDispatchDecisionRecorded` events and queued subtask ids, the runtime appends one `SubtaskDispatchCandidateManifestRecorded` ledger event before completion. The event is summary-only and includes `manifest_id`, `parent_task_id`, `parent_run_id`, `decision_id`, `decision_count`, `guard_id`, `snapshot_id`, `queued_count`, `source_event_count`, `status = "Blocked"`, `manifest_status = "Blocked"`, `candidate_status = "Blocked"`, `dispatch_decision = "Denied"`, `candidate_denial_reason`, `candidate_count`, `dispatch_candidate_count`, `eligible_candidate_count`, `blocked_candidate_count`, `candidate_ids`, `eligible_candidate_ids`, `blocked_candidate_ids`, `candidate_manifest_fingerprint`, `snapshot_fingerprint`, `fingerprint_input_count`, `required_capability`, `precondition_count`, `satisfied_precondition_count`, `blocked_preconditions`, `check_count`, `blocked_checks`, `execution_enabled = false`, `dispatch_enabled = false`, `next_action = "await_dispatch_candidate_manifest_preconditions"`, and a high-level reason.

`run.events` returns the sanitized candidate-manifest fields, and `run.inspect` / `task.inspect` expose `has_subtask_dispatch_candidate_manifest` and `subtask_dispatch_candidate_manifest_count`. M5.9 does not launch child tasks, execute process commands, access the network, control services, apply patches, write workspace files, or persist raw `input`, raw provider responses, raw prompts, raw file content, command strings, stdout, stderr, environment values, or serialized request bodies.
