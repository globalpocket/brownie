# Task Runtime Specification v0

## Purpose

Phase 1.1 extends the minimal task lifecycle authority in the Rust runtime with no-op task execution. It does not implement LLM calls, tool execution, AgentModes parsing, indexing, Qdrant, or llama-server integration.

## TaskRecord

A task is persisted as a `TaskRecord` in `.brownie/runs/<run_id>/state.json`.

```text
task_id: string
run_id: string
goal: string
mode_id: string | null
status: TaskStatus
created_at: RFC3339 timestamp
updated_at: RFC3339 timestamp
```

## TaskStatus

Phase 1.1 defines these status values:

- `Created`: the runtime accepted and persisted the task.
- `Running`: `task.run` has started the no-op AgentLoop skeleton.
- `Completed`: the no-op AgentLoop skeleton completed successfully.
- `Failed`: reserved for runtime or future AgentLoop failure reporting.
- `Cancelled`: reserved for future cancellation handling.

In Phase 1.1, only `Created -> Running -> Completed` is implemented.

## Run storage

The runtime treats the workspace root as `BROWNIE_WORKSPACE_ROOT` when set, otherwise the current working directory. Run data is stored under:

```text
.brownie/
└─ runs/
   └─ <run_id>/
      ├─ state.json
      └─ ledger.jsonl
```

## RunLedger

`ledger.jsonl` is append-only JSON Lines. Phase 1.1 emits task lifecycle events:

```text
event_id: string
task_id: string
run_id: string
kind: TaskStarted | TaskRunning | TaskCompleted | TaskFailed | TaskCancelled
timestamp: RFC3339 timestamp
```

The persisted ledger is separate from any future prompt window truncation behavior.

## `task.run`

`task.run` advances a `Created` task to `Running`, calls the no-op AgentLoop skeleton, then persists `Completed`. The runtime updates `state.json` and appends `TaskRunning` and `TaskCompleted` events to `ledger.jsonl`. Running an unknown task or a task that is not `Created` returns invalid params.

## Phase 1.1 non-goals

- No LLM calls.
- No full agent loop.
- No AgentModes parser, Mode Pack fetch, or Mode Pack activation.
- No tool execution.
- No Qdrant wrapper.
- No llama-server wrapper.
- No codebase indexer.

## Phase 1.2 prompt and fake LLM execution

Phase 1.2 changes `task.run` from the no-op loop to a minimal prompt/fake-LLM path while keeping the runtime as the task lifecycle authority.

The implemented transition remains:

```text
Created -> Running -> Completed
```

After writing `TaskRunning`, the runtime reads the run ledger, materializes prompt input from the current task and ledger events, builds a prompt through the agent loop, creates a local fake LLM request, receives a deterministic fake response, writes `Completed` to `state.json`, and appends `TaskCompleted`.

Phase 1.2 ledger event kinds are:

```text
TaskStarted
TaskRunning
PromptBuilt
LlmRequestCreated
LlmResponseReceived
TaskCompleted
TaskFailed
TaskCancelled
```

`LedgerEvent` may include an optional `payload` object. Prompt and LLM events store safe metadata such as `provider`, `message_count`, `model`, `prompt_preview`, and `content_preview`. Full prompt text is not persisted by default.

Phase 1.2 still does not call a real LLM API, implement an OpenAI-compatible HTTP client, execute tools, parse AgentModes, fetch or activate Mode Packs, use Qdrant, use llama-server, or run an indexer.

## Phase 1.3 mode resolution during task.start

`task.start` resolves the requested `mode_id` before creating a task record. If `mode_id` is omitted or `null`, the runtime uses the default built-in `orchestrator` policy and stores `mode_id: "orchestrator"` in `state.json`.

If a caller supplies an unknown `mode_id`, `task.start` returns JSON-RPC `-32602 invalid params` and does not create a task. This prevents tasks from running without a resolved runtime policy.

After task creation, the run ledger records `TaskStarted` followed by `ModeResolved`. The `ModeResolved` payload stores a compact policy summary rather than the full policy.

## M8.1 verification failure recovery task admission

`task.start` may include an optional `verification_recovery_source` object. This is not a new task execution path; it is an admission guard for creating a durable recovery task from terminal M7 verifier-gate failure evidence.

The source object contains `source_task_id`, `source_run_id`, `expected_failure_fingerprint`, and `authorize_recovery`. The runtime re-reads the source `TaskRecord` and source run ledger before admission. It requires the source task to be terminal `Failed`, the source run ID to match, the latest derived `verification_completion_gate` to be `Failed`, the terminal task event to carry failed verifier-gate metadata, authorization to be explicit, and the expected fingerprint to match the bounded runtime-derived fingerprint.

On success, the runtime creates a new `Created` recovery task or replays the existing recovery task for the same failure fingerprint. The recovery `TaskRecord` stores optional `verification_recovery_provenance` with source task/run IDs, failure fingerprint, verifier counts, failed verifier tool IDs, and bounded failure reasons. Existing task records without this field deserialize as `null`.

The recovery run ledger records `TaskStarted` with the same bounded provenance plus `recovery_running_enabled=false` and `next_action=run_recovery_task_explicitly`. Admission does not append `TaskRunning`, call an LLM, execute a verifier, run shell/git/tests, mutate the workspace, or expose raw stdout, stderr, command strings, environment values, prompts, provider responses, raw file content, or raw tool input.

## Phase 1.4 permission gate update

Phase 1.4 adds the `RuntimePermissionGate` foundation. Runtime permission checks are based on compiled mode policy capabilities and override LLM instructions.

Runtime actions are `ReadWorkspace`, `WriteWorkspace`, `ExecuteProcess`, `AccessNetwork`, `ControlService`, `DestructiveOperation`, `SpawnSubtask`, and `IndexCodebase`. Phase 1.4 records permission decisions only; it does not execute real tools, write files, apply patches, execute processes, call real LLM APIs, parse AgentModes YAML, fetch Mode Packs, or implement Qdrant/llama-server/indexer behavior.

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

M4 keeps `task.run` as the runtime-owned context assembly path and bounds the ledger context materialized into prompts. Prompt materialization now includes a `Context Window` summary and limits the prompt `Ledger` section to the latest 12 ledger event kinds. Older events are counted as omitted instead of being copied into the prompt.

`PromptBuilt` and `SecondPassPromptBuilt` ledger events record summary-only context evidence: total, included, omitted, and maximum event counts plus first/last included event kinds. This makes context selection deterministic and inspectable for future autonomous runs without persisting raw prompt text, raw file content, raw tool output, or raw provider responses.

M4 does not add patch apply, direct workspace mutation, process execution, network access, service-control, destructive actions, or diagnostics wrapper capability.

## M1 agent-loop runtime summary

M1 keeps `task.run` as the runtime-owned execution path and exposes the agent-loop transition directly. The runtime records `AgentLoopStarted` before invoking the Rust `brownie-agent-loop` path and records `AgentLoopCompleted` before the terminal task status update. The `task.run` result includes `agent_loop.final_state` and `agent_loop.completion_summary`, so callers can distinguish a completed agent-loop execution from a bare task status update.

## Phase 1.10 task inspection

`task.inspect` is the preferred task-centric inspection method for VSIX clients. It returns the persisted `TaskRecord` plus the associated sanitized `RunInspectSummary` without changing task state or executing additional work.


## Phase 2.0 LLM provider boundary

Phase 2.0 routes LLM calls through a provider abstraction. The Fake provider remains the default and no external LLM API is contacted unless `BROWNIE_LLM_PROVIDER=openai-compatible` and the required OpenAI-compatible environment configuration are present. The `llm.status` JSON-RPC method reports provider, enabled state, model, base URL, and a non-secret reason; it never returns API keys or Authorization headers. Task ledger LLM request events store only provider/model/message_count metadata, and response events store only provider/content_preview. Streaming and additional tool execution capabilities remain out of scope. See `docs/specifications/llm-provider-spec-v0.md`.

## Phase 2.1 strict provider behavior

`task.run` selects Fake unless `BROWNIE_LLM_PROVIDER=openai-compatible` is explicitly set. With complete OpenAI-compatible configuration it uses that provider and records redacted provider metadata (`provider`, `model`, `message_count`, `base_url`, `strict`) in `LlmRequestCreated` and `SecondPassLlmRequestCreated`. API keys are never stored.

If OpenAI-compatible configuration is incomplete, `BROWNIE_LLM_STRICT=false` (default) falls back to Fake. `BROWNIE_LLM_STRICT=true` fails the run, writes `LlmRequestFailed` and `TaskFailed`, and returns `-32603`. If an enabled OpenAI-compatible request fails, the runtime writes `LlmRequestFailed` or `SecondPassLlmRequestFailed` with a redacted high-level reason and marks the task Failed. Streaming and additional execution capabilities remain out of scope.

## Phase 2.2 task LLM provider selection

`task.run` resolves its LLM provider using the same priority as `llm.status`: explicit environment override, workspace `.brownie/config.json` active profile, then default Fake. Runtime permissions remain authoritative over LLM instructions, and Phase 2.2 does not add streaming or new tool execution capabilities.

## Phase 2.6 real-provider task.run guard

`BROWNIE_LLM_ALLOW_TASK_RUN_NETWORK=true` is required before strict enabled OpenAI-compatible `task.run` may make network LLM calls. The default is false. `llm.status` and `runtime.config.get` expose `task_run_network_allowed`; `runtime.diagnostics.get` reports `TASK_RUN_NETWORK_ALLOWED` or `TASK_RUN_NETWORK_NOT_ALLOWED` for strict enabled OpenAI-compatible profiles. Missing guard is a warning in diagnostics and a pre-network `task.run` error. Non-strict OpenAI-compatible `task.run` falls back to Fake. See `docs/specifications/real-provider-task-run-smoke-spec-v0.md`.

## Phase 2.7 LLM request budget note

See [LLM Request Budget Spec v0](llm-request-budget-spec-v0.md). Runtime provider requests are bounded by the resolved budget, status/config responses include the budget summary, diagnostics report default/profile/env/invalid budget sources, and ledger/inspection payloads keep prompt and response previews only.

## Phase 2.8 prompt sensitive guard

Runtime LLM configuration includes `sensitive_guard` (`off`, `warn`, `fail`) with `BROWNIE_LLM_SENSITIVE_GUARD` as the highest-priority override. Fake defaults to `warn`; OpenAI-compatible defaults to `fail`. Provider calls are preceded by budget validation and prompt sensitive-content scanning. In fail mode, findings block the provider call and task failure metadata records only categories, counts, message indexes, and guard mode. Matched secret text, full prompt text, and full provider responses must not be persisted or exposed through status, diagnostics, ledger, or inspection APIs.

## Phase 3.0 patch proposal dry-run path

During `task.run`, approved `workspace.read` intents continue to use read-only execution. Approved `workspace.write` intents are not executed; they create `WorkspacePatchProposed` ledger events with bounded preview metadata only. Denied write intents create no proposal.

## M8.2 verification recovery repair proposal

An admitted verification recovery task may be run only through the existing explicit `task.run` path. Before recording `TaskRunning`, the runtime re-reads the source task and source run ledger and revalidates the recovery task's stored `verification_recovery_provenance` against the latest failed verifier-gate evidence. If the source task, source run, terminal gate evidence, failed verifier set, or failure fingerprint no longer matches, `task.run` returns `-32602` before creating new run evidence.

When the revalidated recovery run contains approved `workspace.write` intent and the active mode has `WriteWorkspace`, the runtime may append one recovery-scoped `WorkspacePatchProposed` event through the existing proposal path. The event adds only bounded recovery metadata: source task/run IDs, recovery task/run IDs, failure fingerprint, failed verifier tool IDs, and a boolean recovery marker. A recovery task that has already proposed a repair does not create another recovery proposal on replay or repeated execution.

`TaskRunResult` includes `verification_recovery_repair` for admitted recovery task runs. R3.2 makes this an explicit gate: exactly one valid recovery-scoped proposal returns `gate_status=Passed`, the proposal handle, `proposal_count=1`, `replayed`, `apply_enabled=false`, and `next_action=review_and_authorize_recovery_proposal`. Missing, ambiguous, invalid-provenance, or not-applicable repair proposal evidence forces terminal `TaskFailed` and returns `gate_status=Failed`, bounded `failure_reason`, proposal count, `replayed`, `apply_enabled=false`, and `next_action=inspect_recovery_repair_gate_failure`. Failed repair-gate attempts are not replay-locked forever: a subsequent authorized recovery start for the same source failure fingerprint can admit a fresh recovery task. This is a repair proposal handoff only. It does not apply patches, retry verifiers, execute shell/git/network/service actions, or expose raw stdout, stderr, command strings, prompts, provider responses, file content, paths, environment values, raw tool input, or raw request bodies.

R3.3 extends failed `verification.cargo_check` evidence with `bounded_cargo_diagnostics`. The runtime derives these entries only from the controlled Cargo JSON stream, sanitizes them before ledger insertion, and caps them at five. Entries may include only tool ID, check ID, diagnostic kind, severity, optional code, workspace-relative path, line, column, and truncation state. Failed verification completion gates and `VerificationRecoveryProvenance` carry the same bounded entries so recovery tasks can target the failure without raw log access. They must not include raw compiler messages, rendered diagnostics, source snippets, stdout/stderr, commands, environment values, absolute paths, canonical paths, or file content.

## Phase 3.1 patch proposal validation

Approved `workspace.write` intents remain dry-run proposals only: task execution does not write files and does not apply patches. For `replace_file` proposals, the runtime validates the target path and current target file, scans proposed and existing content for sensitive-like data, and stores only bounded previews.

Valid proposals may include a capped synthetic unified diff preview. Blocked proposals suppress or redact previews when proposed or existing content looks sensitive. Proposal inspection is available through `proposal.list` and `proposal.inspect`; neither RPC returns full proposed content, raw provider responses, raw intent JSON, raw input, or full diffs.

## Phase 3.2 patch approval gate

The task runtime treats workspace-write proposals as dry-run records until a future phase implements apply. Human approval and rejection are represented by ledger events and reflected in `proposal.list` / `proposal.inspect`, but approval does not modify the workspace.

After `proposal.approve`, the runtime creates an apply-plan summary. Historical Phase 3.2 plans were blocked because apply was unimplemented; after M6.1, the plan can report controlled apply availability, but approval still cannot be mistaken for execution. Only a separate `proposal.apply` request with explicit one-time authorization and an expected target hash may mutate a workspace file. Full proposed content, raw provider responses, raw intent JSON, raw input JSON, patches, and full diffs remain excluded from ledger payloads and RPC responses.

## Phase 3.3 patch preflight

After a patch proposal is approved, callers may invoke `proposal.preflight` to capture metadata needed for stale detection before any future apply implementation. Preflight records a snapshot with SHA-256 hashes for the canonical path and readable regular-file content, records a blocked apply plan, and updates proposal inspection with `latest_snapshot`.

Phase 3.3 preserves the no-write/no-apply guarantee: approval and preflight are ledger-only operations and do not modify workspace files. The runtime redacts secret-like approval and rejection reasons before storing or returning them.

## Phase 3.4 proposal readiness

After approval and preflight, callers may invoke `proposal.readiness` to create a final human-review report. The report summarizes whether the proposal is `Ready`, `NotReady`, or `Blocked` by relying on ledger reconstruction and the latest preflight snapshot rather than applying the patch.

Readiness does not write workspace files, does not apply patches, and does not run process, network, service-control, destructive, or subtask actions. A `Ready` report means the proposal is ready for final human review only; patch apply remains unimplemented in Phase 3.4.

## M3 controlled apply readiness fingerprint

M3 records a summary-only readiness fingerprint when `proposal.readiness` runs. The fingerprint covers stable proposal metadata, approval state, latest preflight snapshot metadata, and readiness checklist outcomes. `proposal.applyDryRun` recomputes the fingerprint and fails a `readiness_fingerprint_current` gate if the latest readiness report is stale relative to current proposal evidence.

The M3 fingerprint is a readiness gate only. It does not enable patch apply, does not write workspace files, and does not expose raw file content, raw diffs, raw input JSON, canonical absolute paths, process output, environment values, or network-derived content.

Readiness ledger events are summary-only and must exclude raw content fields (`content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, `file_content`) and secret-like text.

## M6.1 controlled replace-file apply

M6.1 adds `proposal.apply` as the first runtime-owned workspace mutation path. It is limited to one approved `replace_file` proposal for one existing regular UTF-8 workspace-relative target. It requires explicit one-time authorization, approval freshness, latest preflight validation, expected target SHA-256 verification, protected path and parent traversal denial, symlink rejection, bounded replacement content, temporary sibling file creation, flush/sync, atomic replacement, post-write SHA-256 verification, and a bounded apply-result ledger event.

`proposal.apply` does not run shell, git, tests, network, service control, directory mutation, file creation, file deletion, arbitrary rename, or multi-file transactions. Replacement content is request input only and must not be persisted in the ledger or returned in RPC responses. Failure paths should preserve the original target, clean partial temporary files, and must not consume apply authorization before verified success.

## M7.3 verification evidence completion gate

M7.3 keeps `task.run` as the runtime-owned task lifecycle authority and adds a terminal completion gate for task-scoped controlled verifier requests. If a run requests `verification.cargo_fmt_check` or `verification.cargo_check`, the runtime re-reads the current run ledger before terminal status and requires fresh terminal `ToolExecutionCompleted` evidence with `verification_status = "Passed"` for every requested verifier.

When all required verifier evidence passes, `task.run` may complete and returns bounded `verification_completion_gate` metadata. When required verifier evidence is denied, rejected, failed, timed out, spawn-failed, missing, malformed, or stale, `task.run` records `AgentLoopCompleted` with final state `Failed`, persists terminal `TaskFailed`, and includes bounded gate metadata on the terminal event and RPC result. Runs without controlled verifier requests retain their prior completion behavior.

## M5 subtask orchestration queue

M5 keeps `task.run` as the only runtime-owned execution path and adds a deterministic queue record for approved `subtask.spawn` assistant intent. The runtime appends `SubtaskOrchestrationQueued` with a stable parent run reference, queue position, summary-only input metadata, and `execution_enabled = false`.

Queued subtask evidence is available through the ledger, through `run.inspect` / `task.inspect` summary counts, and through prompt materialization for later feedback passes. M5 does not create child tasks, run subprocesses, access the network, control services, apply patches, or write workspace files.

## M5.1 subtask handoff preparation

M5.1 turns queued subtask evidence into deterministic parent-run handoff state. After approved `subtask.spawn` intent has been queued, `task.run` appends a summary-only `SubtaskHandoffPrepared` event that records which queued subtask ids were consumed, how many source events were used, and that execution remains disabled.

The handoff state is visible through the ledger, through `run.inspect` / `task.inspect` summary counts, and through prompt materialization. M5.1 does not create child tasks, run subprocesses, access the network, control services, apply patches, or write workspace files.

## M5.2 subtask scheduler readiness

M5.2 turns prepared handoff state into deterministic scheduler readiness evidence. After `SubtaskHandoffPrepared` exists, `task.run` appends a summary-only `SubtaskSchedulerReadinessRecorded` event that records how many handoffs were evaluated, how many queued subtasks they cover, and why dispatch remains blocked.

The readiness state is visible through the ledger, through `run.inspect` / `task.inspect` summary counts, and through prompt materialization. M5.2 does not create child tasks, run subprocesses, access the network, control services, apply patches, or write workspace files.

## M5.3 subtask dispatch plan preparation

M5.3 turns scheduler-readiness evidence into deterministic parent-run dispatch plan state. After `SubtaskSchedulerReadinessRecorded` exists, `task.run` appends a summary-only `SubtaskDispatchPlanPrepared` event that records which readiness evidence was consumed, how many queued subtasks the plan covers, and why dispatch remains blocked.

The dispatch plan is visible through the ledger, through `run.inspect` / `task.inspect` summary counts, and through prompt materialization. M5.3 does not create child tasks, run subprocesses, access the network, control services, apply patches, or write workspace files.

## M5.4 subtask dispatch contract preparation

M5.4 turns dispatch-plan evidence into deterministic parent-run dispatch contract and eligibility-gate state. After `SubtaskDispatchPlanPrepared` exists, `task.run` appends a summary-only `SubtaskDispatchContractPrepared` event that records which dispatch plan was consumed, how many queued subtasks it covers, which preconditions future dispatch must satisfy, and why dispatch remains blocked.

The dispatch contract is visible through the ledger, through `run.inspect` / `task.inspect` summary counts, and through prompt materialization. M5.4 does not create child tasks, run subprocesses, access the network, control services, apply patches, or write workspace files.

## M5.5 subtask dispatch admission evaluation

M5.5 turns dispatch-contract evidence into deterministic parent-run dispatch admission and execution-gate state. After `SubtaskDispatchContractPrepared` exists, `task.run` appends a summary-only `SubtaskDispatchAdmissionEvaluated` event that records which contract was evaluated, how many queued subtasks it covers, which preconditions remain blocked, and why execution admission remains denied.

The dispatch admission decision is visible through the ledger, through `run.inspect` / `task.inspect` summary counts, and through prompt materialization. M5.5 does not create child tasks, run subprocesses, access the network, control services, apply patches, or write workspace files.

## M5.6 subtask dispatch readiness snapshot

M5.6 turns dispatch-admission evidence into deterministic parent-run dispatcher-readiness snapshot state. After `SubtaskDispatchAdmissionEvaluated` exists, `task.run` appends a summary-only `SubtaskDispatchReadinessSnapshotRecorded` event that records which admission evidence was snapshotted, how many queued subtasks it covers, which preconditions remain blocked, and a stable readiness fingerprint for future scheduler comparison.

The dispatch readiness snapshot is visible through the ledger, through `run.inspect` / `task.inspect` summary counts, and through prompt materialization. M5.6 does not create child tasks, run subprocesses, access the network, control services, apply patches, or write workspace files.

## M5.7 subtask dispatcher guard verdict

M5.7 turns dispatch-readiness snapshot evidence into deterministic parent-run dispatcher guard verdict state. After `SubtaskDispatchReadinessSnapshotRecorded` exists, `task.run` appends a summary-only `SubtaskDispatcherGuardVerdictRecorded` event that records which readiness snapshot was evaluated, whether the snapshot fingerprint is current for the handoff guard, which scheduler handoff preflight checks remain blocked, and why dispatch remains denied.

The dispatcher guard verdict is visible through the ledger, through `run.inspect` / `task.inspect` summary counts, and through prompt materialization. M5.7 does not create child tasks, run subprocesses, access the network, control services, apply patches, or write workspace files.

## M5.8 subtask dispatch decision

M5.8 turns dispatcher guard verdict evidence into deterministic parent-run dispatch decision state. After `SubtaskDispatcherGuardVerdictRecorded` exists, `task.run` appends a summary-only `SubtaskDispatchDecisionRecorded` event that records which guard was evaluated, whether dispatch is denied, how many queued subtasks are candidate-blocked, and which guard-derived checks explain the denial.

The dispatch decision is visible through the ledger, through `run.inspect` / `task.inspect` summary counts, and through prompt materialization. M5.8 does not create child tasks, hand off scheduler work, run subprocesses, access the network, control services, apply patches, or write workspace files.

## M5.9 subtask dispatch candidate manifest

M5.9 turns dispatch decision evidence into deterministic parent-run per-candidate manifest state. After `SubtaskDispatchDecisionRecorded` exists, `task.run` appends a summary-only `SubtaskDispatchCandidateManifestRecorded` event that records which decision was evaluated, which queued subtask ids are dispatch candidates, which candidates remain blocked, and which decision-derived checks explain the denial.

The candidate manifest is visible through the ledger, through `run.inspect` / `task.inspect` summary counts, and through prompt materialization. M5.9 does not create child tasks, hand off scheduler work, run subprocesses, access the network, control services, apply patches, or write workspace files.

## M5.10 subtask dispatch handoff envelope

M5.10 turns candidate manifest evidence into deterministic parent-run dispatch handoff envelope and replay guard blocker state. After `SubtaskDispatchCandidateManifestRecorded` exists, `task.run` appends a summary-only `SubtaskDispatchHandoffEnvelopeRecorded` event that records which manifest was evaluated, which queued candidate ids are covered by the handoff envelope, why the replay guard remains blocked, and which handoff-ticket checks prevent scheduler dispatch.

The handoff envelope is visible through the ledger, through `run.inspect` / `task.inspect` summary counts, and through prompt materialization. M5.10 does not create child tasks, hand off scheduler work, run subprocesses, access the network, control services, apply patches, or write workspace files.

## M5.11 controlled child task materialization

M5.11 materializes one controlled child `TaskRecord` from an accepted parent-run handoff envelope. The child stores `parent_task_id`, `parent_run_id`, `source_candidate_id`, `source_handoff_envelope_id`, and `source_handoff_envelope_fingerprint`, starts with `status = Queued`, and receives only its own `TaskStarted` ledger event. Parent `task.run` does not run the child.

## M5.12 explicit queued child task run admission

M5.12 allows an explicit `task.run` call on a controlled queued child task. The admission gate accepts `TaskStatus::Created` tasks as before, and accepts `TaskStatus::Queued` only when the child has complete parent/source provenance and the parent ledger contains matching handoff envelope evidence for the candidate and fingerprint.

Once admitted, the child uses the existing task-run lifecycle and terminal status rules. Completed, failed, cancelled, and already-running tasks remain non-rerunnable. This phase does not add scheduler auto-dispatch, external workers, process execution expansion, network bypass, service control, patch apply, direct workspace mutation paths, or another blocked summary event wrapper.

## M5.13 parent child run result inspection

M5.13 makes child run state visible from the parent inspection path. `RunInspectSummary` keeps `child_task_count` and `child_task_ids`, and adds `child_tasks` with structured summaries for each persisted child whose `parent_run_id` matches the inspected parent run.

Each child summary is derived from child `TaskRecord` state and child ledger metadata. It reports child status, provenance, event count, completion final state, bounded completion summary preview, and sanitized final response preview when available. It does not run child tasks, mutate the parent ledger, expose raw prompts/provider responses/file content/command output, or add scheduler handoff.

## M5.17 parent join continuation

M5.17 permits explicit `task.run` on a completed parent task only when every controlled child for the parent run is also completed and has completed agent-loop evidence. The parent receives bounded child completion summaries and remains responsible for its own agent-loop pass; child tasks are not run automatically.

## M5.18 parent join continuation replay guard

M5.18 records a deterministic summary-safe child completion fingerprint when parent join continuation is admitted. The same completed child result fingerprint cannot start another parent agent-loop pass, while materially different completed child evidence can produce a new fingerprint and be admitted. The guard is enforced before the parent status changes back to `Running`.

## M5.14 child task source intent materialization

M5.14 stores a sanitized `source_intent_summary` on controlled child `TaskRecord` state when the child is materialized from an accepted handoff envelope. The summary is reconstructed from the parent run's approved `SubtaskOrchestrationQueued` evidence and includes only `tool_id`, `required_action`, bounded `request_reason`, and bounded `input_summary`.

The child goal is derived from the approved source intent request reason and stable source candidate id. This keeps child task state useful for explicit child `task.run` without adding scheduler auto-dispatch, external workers, raw input persistence, patch apply, process execution expansion, network bypass, service control, direct workspace mutation, or another blocked summary event wrapper.

## M5.25 recovery-cycle child provenance

M5.25 extends controlled child `TaskRecord` state with optional `recovery_cycle_provenance`. The field is set only when a child is materialized from an accepted parent-join handoff envelope with `parent_join_recovery_cycle = true`; it is `null` for normal tasks, initial child materialization, and non-recovery parent-join continuations.

The persisted object is `RecoveryCycleChildProvenance`. It includes `parent_join_admission_id`, `parent_join_child_completion_fingerprint`, `parent_join_child_completion_child_count`, `parent_join_terminal_failed_child_count`, `parent_join_terminal_completed_child_count`, `parent_join_recovery_cycle`, and `parent_join_recovery_cycle_depth`. Counts describe the bounded terminal controlled-child set admitted by the parent join; failed plus completed counts must equal the child completion child count. Recovery-cycle depth is the parent-join cycle depth and must be at least 1 for recovery-cycle children.

Materialization is fail-closed for parent-join provenance. If a parent-join envelope has `parent_join_admission_id`, all provenance fields are validated before creating a child; missing fields, empty admission IDs, malformed `sha256:<64 lowercase hex>` completion fingerprints, inconsistent counts, or invalid recovery/depth combinations reject materialization and leave child state unchanged. Existing state files without `recovery_cycle_provenance` remain readable as `null`.

The child `TaskStarted` payload, direct `task.inspect`, and parent `run.inspect` / `task.inspect` child summaries expose the same bounded object. The field never contains raw prompts, raw provider responses, raw file content, command strings, stdout, stderr, environment values, raw tool input objects, serialized request bodies, raw failure payloads, or unbounded error text.
