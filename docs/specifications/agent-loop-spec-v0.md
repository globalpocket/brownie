# Agent Loop Specification v0

## Purpose

The Brownie agent loop is the runtime authority that advances a task from creation to completion. It must be implemented as an explicit Rust state machine, not as implicit prompt-only behavior.

## Scope

This specification covers the observable task execution behavior Brownie intends to reimplement from Zoo Code-style agent workflows.

## State model

The initial state set is:

```text
TaskCreated
LoadMode
BuildContext
BuildPrompt
CallLlm
ParseAssistantOutput
DecideAction
ExecuteTool
ApplyPatch
SpawnSubtask
Wait
AskUser
Retry
Complete
Failed
Cancelled
```

The Rust crate `brownie-agent-loop` owns this state model. Phase 1.1 includes only a no-op skeleton entry point that accepts task metadata and returns `Completed` with a completion summary; it does not build prompts, call an LLM, execute tools, parse AgentModes, index code, use Qdrant, or use llama-server.

## Runtime authority

The runtime, not the LLM, decides whether an action is allowed.

The invariant is:

```text
LLM instruction < Runtime permission
```

Examples:

- If a mode has no workspace write permission, `apply_patch` is rejected even if the LLM asks to edit.
- If a mode cannot spawn subtasks, subtask creation is rejected even if the LLM asks for delegation.
- If required verification has not run, a completion claim is not accepted.

## Completion gates

A task can enter `Complete` only when all configured completion gates pass.

Initial gates:

- Required artifacts exist or are explicitly marked not applicable.
- Required tool calls have completed.
- Required verification has completed.
- No unresolved tool call remains.
- No unresolved subtask remains.
- File edits, if any, have associated diff records.
- A completion report has been recorded.

## Tool execution

Tool execution is mediated by `brownie-tools` and policy compiled from AgentModes.

Tool results must be recorded into the run ledger. Large tool output can be compacted for prompt materialization, but the ledger remains the source of truth.

M7.1 allows task-scoped execution for the fixed `verification.cargo_fmt_check` verifier when the active mode has `ExecuteProcess`. The agent loop may request it for verification-like goals, and the runtime records bounded `ToolExecution*` evidence that headless callers can inspect. This does not authorize generic `process.exec`: callers cannot provide commands, argv, cwd, environment, stdin, shell, or timeouts, and verifier ledger evidence must remain free of raw stdout, stderr, command strings, raw input JSON, file content, absolute paths, canonical paths, environment values, and secrets.

M7.2 allows the agent loop to request the fixed `verification.cargo_check` verifier for compile and type-check goals when the active mode has `ExecuteProcess`. The runtime executes the request through the same controlled tool path as standalone `tool.execute`, requires `Cargo.toml` and `Cargo.lock`, rejects workspaces with `build.rs` in this phase, runs only `cargo check --workspace --all-targets --locked --offline`, uses an isolated target directory outside the workspace, sets Cargo dependency-fetch offline mode, and records only bounded `ToolExecution*` evidence. R3.1 clarifies that this is not OS-level network isolation and not compile-time code sandboxing: verifier metadata must report `cargo_dependency_fetch_offline=true`, `os_network_isolated=false`, `compile_time_code_sandboxed=false`, and `trusted_workspace_required=true`. This still does not authorize generic `process.exec`, caller-supplied commands, argv, cwd, environment, stdin, shell, package/feature/target selection, timeout overrides, raw stdout/stderr, raw input JSON, target directory paths, file content, absolute paths, canonical paths, environment values, network access, git execution, service control, arbitrary tests, or workspace mutation.

M29.1 allows the agent loop to request the fixed `verification.cargo_test` verifier for Rust test verification goals when the active mode has `ExecuteProcess`. The runtime executes it through the same controlled tool path as standalone `tool.execute`, requires `Cargo.toml` and `Cargo.lock`, runs only `cargo test --workspace --all-targets --locked --offline`, uses an isolated target directory outside the workspace, sets Cargo dependency-fetch offline mode, and records only bounded `ToolExecution*` evidence. Metadata must honestly report `cargo_dependency_fetch_offline=true`, `os_network_isolated=false`, `compile_time_code_sandboxed=false`, `test_code_executed=true` for launched runs, and `trusted_workspace_required=true`.

M30.1 makes failed launched `verification.cargo_test` evidence actionable for recovery without exposing raw test output. Failed cargo-test tool evidence may include at most five bounded diagnostics with hashed test names and optional sanitized panic locations. The failed verification completion gate and verification recovery provenance carry those diagnostics through existing task and recovery surfaces, so a headless recovery task can choose a next read or repair direction without raw stdout/stderr, rendered panic messages, assertion values, source snippets, raw test names, commands, environment, absolute paths, canonical paths, or file content.

M31.1 allows a current admitted verification recovery `task.run` request to include `verification_recovery_context_read` for exactly one diagnostic from the task's current recovery provenance. The runtime requires explicit authorization, source task/run IDs, expected failure fingerprint, a bounded diagnostic index, a bounded excerpt budget, current recovery provenance, `ReadWorkspace`, and a safe existing regular UTF-8 workspace file before reading. The excerpt is prompt-only in-memory context; ledger and RPC evidence expose only hashes, diagnostic metadata, line range, byte count, truncation, redaction, replay state, and next action. It does not add a new RPC, generic workspace read, report, history, inspection, codebase query, shell/git/network/service execution, workspace mutation, or raw prompt/file/output exposure.

M7.3 promotes requested controlled verifier evidence from advisory ledger data to a runtime completion gate. Before terminal task status is recorded, `task.run` re-reads the current run ledger and requires every task-scoped `verification.cargo_fmt_check`, `verification.cargo_check`, or `verification.cargo_test` request to have fresh terminal passed evidence. Passing evidence preserves `Completed`; denied, rejected, failed, timed-out, spawn-failed, missing, malformed, or stale evidence forces `Failed` and returns bounded `verification_completion_gate` metadata for headless recovery. Tasks that request no controlled verifier keep their existing completion behavior.

M51.1 adds an accepted-completion state transition to the existing terminal `task.run` replay path. `task.run` may include one optional `completion_acceptance` envelope with `authorize_completion_acceptance=true`, source run id, acceptance id, and expected completion result fingerprint. The runtime re-reads the current task record and run ledger before mutation, requires the addressed task/run to be terminal `Completed`, requires current terminal completion evidence and matching fingerprint, and denies failed, missing, stale, or malformed verifier completion gate evidence. Success appends bounded `TaskCompletionAccepted` evidence and returns bounded `completion_acceptance` metadata; replay of the same acceptance id/fingerprint returns the existing metadata without duplicate `TaskCompletionAccepted` or `TaskRunning` events. This adds no RPC, report, digest, history, readiness, verdict, inspection, automatic acceptance, provider/tool execution, workspace mutation, or VSIX-owned policy, and the ledger/result shape excludes raw prompts, provider responses, final response content, file content, stdout/stderr, commands, environment values, request bodies, raw ledger payloads, secrets, and absolute or canonical paths.

M51.2 makes accepted completion actionable for headless callers through existing `headless.run.drive`. After a headless drive reaches terminal completed progress, the runtime derives an optional bounded `accepted_completion` route only from current `TaskCompletionAccepted` evidence that matches the latest completed task/run, terminal completion fingerprint, and verifier-gate context. The route returns ids, `AcceptedComplete`, SHA-256 fingerprints, replay state, verifier-gate status, and `close_headless_run`; it does not add a new RPC, append another acceptance event, or require caller-side ledger interpretation. Completed but unaccepted tasks and stale, malformed, failed, cancelled, non-terminal, or mismatched evidence do not produce the route, and replay remains duplicate-free.

M51.3 lets `headless.run.drive` turn that accepted-completion boundary into one bounded product stop/continue decision when explicitly authorized. The request supplies a decision id, expected accepted-completion, terminal-completion, completion-closure, and product-evidence fingerprints, and bounded product gate metadata. Rust derives `product_complete`, `continue_development`, or `blocked_by_product_evidence`, records one bounded `HeadlessRunProductCompletionDecisionRecorded` event, persists the decision as bounded ledger evidence, and replays it without duplicate mutation. M51.3.1 additionally treats the accepted-completion, terminal-completion, and completion-closure fingerprints as the unique product decision boundary: an exact decision replay is allowed, but a different decision id, product status, or product-evidence fingerprint for that same boundary is denied before ledger append. Missing, stale, malformed, wrapper-only, or insufficient product evidence fails closed as `blocked_by_product_evidence` or request denial; raw Product Charter or manifest text, prompts, provider responses, final responses, file content, raw ledger payloads, diagnostics, commands, environment values, paths, and secrets are not stored or returned.

M52.1 moves the product evidence matrix for that same decision boundary into the runtime-owned drive path. M52.2 makes that authority project-generic: a caller may provide an explicit `product_evidence_derivation` envelope naming the current phase/milestone, one safe JSON `project_completion_policy` artifact, and one to thirty-two policy-declared evidence artifacts with expected SHA-256 values. The runtime re-reads those artifacts, rejects unsafe paths, missing files, symlinks, non-regular or non-UTF-8 files, stale hashes, incomplete policy gates, and request artifacts that do not exactly match policy membership, then derives one bounded `product_evidence_matrix` from policy gate metadata and current accepted-completion/closure facts. The matrix includes a `product_completion_claim` boolean in its payload and fingerprint. The drive records one `HeadlessRunProductEvidenceMatrixDerived` event and replays it without duplicate ledger mutation. A following `product_completion_decision` can reference the derived matrix fingerprint, and the runtime fills product gate categories/counts/status booleans from that matrix instead of trusting caller-owned product truth; if the caller requests `product_complete` while the derived claim is false, the request is denied before `HeadlessRunProductCompletionDecisionRecorded` can be appended. The matrix and decision expose only bounded ids, phase/milestone labels, category names, counts, booleans, next actions, artifact path identifiers, artifact hashes, claim state, and SHA-256 fingerprints; raw charter/spec/manifest/file text, prompts, provider responses, final responses, raw ledger payloads, diagnostics, commands, environment values, absolute or canonical paths, and secrets remain excluded.

M8.1 lets the caller continue from that bounded terminal failure without inventing an external retry ledger. `task.start` may include `verification_recovery_source`; the runtime validates the source failed task/run and expected verifier failure fingerprint before creating a `Created` recovery task. Admission is idempotent per failure fingerprint, returns `next_action=run_recovery_task_explicitly`, and does not auto-run the recovery task, call an LLM, execute a verifier, or mutate the workspace.

M8.2 lets the caller explicitly run the admitted recovery task through the existing `task.run` RPC. The runtime revalidates stored recovery provenance against the latest source task/run verifier-gate failure before appending `TaskRunning`, then permits approved `workspace.write` intent to create at most one recovery-scoped patch proposal through the existing WriteWorkspace permission and proposal pipeline. R3.2 requires the recovery run to produce exactly one valid recovery-scoped repair proposal before the task may complete. The response includes bounded `verification_recovery_repair` metadata with source and recovery IDs, failure fingerprint, failed verifier tool IDs, gate status, proposal ID/count when passed, bounded failure reason when failed, `apply_enabled=false`, next action, and replay status. Missing, ambiguous, invalid-provenance, or not-applicable repair proposal evidence forces terminal `TaskFailed`, and a later authorized recovery start for the same failure fingerprint may create a fresh recovery task instead of replaying that failed gate forever. M8.2 still does not apply the proposal, retry verification, run shell/git/network/service actions, or expose raw output, commands, prompts, provider responses, file content, paths, environment values, tool input, or raw request bodies.

M8.3 lets the caller explicitly retry failed verification after a recovery-scoped proposal has been applied through `proposal.apply`. `task.start` may include `verification_recovery_retry_source`; the runtime validates the latest source failure evidence, recovery task provenance, recovery-scoped proposal evidence, successful apply result, expected failure fingerprint, expected apply fingerprint, and `authorize_verification_retry=true` before creating or replaying one retry task. Explicit `task.run` on that retry task revalidates the same source/recovery/proposal/apply evidence before appending `TaskRunning`, then executes exactly the failed M7 verifier tool IDs through existing controlled verifier executors and `ExecuteProcess` permission checks. R3.2 requires terminal retry verifier evidence to match a runtime-owned requirement fingerprint derived from the retry/apply provenance; completion gates expose only bounded requirement ID, source kind, source apply ID, and SHA-256 fingerprint metadata. The response includes bounded `verification_recovery_retry` metadata with source, recovery, retry, proposal, apply, fingerprint, retried verifier, passed verifier, failed verifier, retry status, replay, and next-action fields. M8.3 does not create proposals, apply patches, mutate workspace files, run shell/git/network/service actions, accept caller-supplied verifier commands, or expose raw stdout/stderr, commands, prompts, provider responses, file content, paths, environment values, tool input, or raw request bodies.

R3.3 allows prompt materialization for admitted verification recovery tasks to include bounded cargo check diagnostics from `verification_recovery_provenance`. Each entry is limited to verifier identity, diagnostic kind, severity, optional code, workspace-relative path, line, column, and truncation state. The prompt builder must not include raw compiler messages, rendered diagnostics, source snippets, stdout/stderr, commands, environment values, absolute paths, canonical paths, file content, raw prompts, or provider responses.

M18.1 lets a headless caller use `headless.continue_once` to admit one recovery task from failed verifier-gate evidence without switching back to caller-owned `task.start` orchestration. The caller supplies fresh progress evidence plus `verification_recovery_source`; the runtime reuses the existing recovery admission checks, persists bounded continuation evidence, and routes the caller to `run_recovery_task_explicitly`. It does not run the recovery task, create or apply proposals, execute verifiers, call an LLM, mutate the workspace, or introduce a background loop.

M18.2 brings that explicit recovery task run step into the headless continuation contract. `headless.continue_once` may include `verification_recovery_run_target` with source task/run IDs, recovery task/run IDs, an expected failure fingerprint, and `authorize_recovery_run=true`. After stale-progress rejection and recovery provenance revalidation, the runtime executes the existing recovery `task.run` path once and returns bounded repair-gate metadata with the next route set to recovery proposal review when the gate passes. Replay of the same continuation returns the same recovery task run result without duplicate running, proposal, decision, or terminal task evidence. It does not apply patches, retry verifiers, launch provider/shell/git/network/service work, or expose raw prompt, provider response, file content, command, output, path, environment, tool input, or raw request payload data.

M27.2 extends the same explicit continuation model to failed `patch_file` apply recovery. `headless.continue_once` may include `patch_apply_recovery_source` to admit or replay one recovery task from latest exact-source patch apply failure evidence, or `patch_apply_recovery_run_target` to run one current admitted recovery task after revalidating source run, proposal, apply, source apply fingerprint, and failure fingerprint. Admission returns a route to `run_recovery_task_explicitly`; execution returns the existing bounded `patch_apply_recovery_repair` result and routes passed repair gates to `review_and_authorize_recovery_proposal`. The runtime still rejects stale progress first, requires explicit authorization for the run target, and keeps replay idempotent. It does not approve or apply proposals, mutate the workspace, introduce a new RPC, or expose raw file, patch, prompt, provider response, command output, environment, or absolute path data.

M28.1 extends `headless.continue_once` with `patch_apply_recovery_apply_target`
for the next explicit patch recovery boundary. The target applies one already
approved recovery-scoped `patch_file` proposal by delegating to existing
`proposal.apply` after rechecking fresh aggregate progress, explicit one-time
authorization, M27 source/recovery/proposal provenance, exact-source path
binding, expected source apply and failure fingerprints, and expected target
SHA-256. The request-only patch hunk payload is passed only to the existing
apply authority. Successful continuation returns bounded `proposal_apply_result`
metadata and an inspect-progress route; replay returns the same apply result
without another apply or duplicate continuation evidence. The continuation does
not create a new RPC, approve proposals, apply without authorization, duplicate
mutation policy, run shell/git/network/service actions, or expose raw file
content, raw hunks, raw diffs, prompts, provider responses, command output,
environment, absolute paths, canonical paths, or secrets.

M9.6 allows prompt materialization for ordinary `task.run` requests to include one validated selected index read. The runtime accepts optional `selected_index_context`, validates it before `TaskRunning` against prior `CodebaseIndexSelectionReadCompleted` evidence, and requires the stored task mode to allow both `ReadWorkspace` and `IndexCodebase`. When accepted, `PromptBuilder` adds a `Selected Index Context` section containing the selected file content for the in-memory LLM request only. `CodebaseIndexPromptContextMaterialized`, `PromptBuilt`, `SecondPassPromptBuilt`, and `TaskRunResult.selected_index_prompt_context` remain summary-only: prompt previews are redacted, and no ledger/result/diagnostic payload may store raw selected paths, raw selected file content, snippets, diffs, stdout/stderr, commands, environment values, raw prompts, provider responses, absolute paths, canonical paths, or secrets.

M11.1 allows a headless caller to ask the runtime to continue once from the
current aggregate task progress state. `headless.continue_once` validates
`authorize=true` and expected `task.list.progress_overview` fingerprint/sequence
before selecting one eligible runnable task and invoking the existing `task.run`
path. The agent loop itself is unchanged: it is still entered only through
`task.run`, and M11.1 does not add background scheduling, repeated execution,
parent-join execution, recovery retry execution, proposal apply, or new
workspace/tool permissions.

M11.2 does not change agent-loop execution. It changes the headless continuation
contract around the loop: a repeated `headless.continue_once` call with an
already-recorded `continuation_id` replays the selected task/run outcome from
bounded runtime state instead of entering the agent loop again. The returned
`next_route` is an explicit caller route only; it does not start recovery,
apply, verification retry, parent join, scheduling, or additional loop work.

M11.3 still does not add scheduler-owned or VSIX-owned loop execution. It lets a
headless caller authorize a small `max_steps` budget on the existing
`headless.continue_once` method. Each budget step reuses the same one-step
runtime contract and therefore enters the agent loop only through `task.run`.
The runtime stops at stale progress, no eligible task, a still-running selected
task, explicit recovery/apply/verifier/parent-join boundaries, or budget
exhaustion.

M16.1 lets the same headless continuation contract cross one post-apply
verification boundary without running another task. `headless.continue_once` may
accept explicit verification retry authorization plus the existing
source/recovery/proposal/apply fingerprint envelope and create or replay exactly
one verification recovery retry task. The next action is to run that retry task
explicitly through `task.run`; M16.1 does not execute verifiers, apply patches,
call providers, start a scheduler, or move routing policy into the VSIX.

M16.2 lets `headless.continue_once` run one already-admitted verification
recovery retry task when the caller supplies the retry task/run handles,
proposal/apply handles, expected failure and apply fingerprints, and
`authorize_verification_retry_run = true`. The runtime checks current aggregate
progress and matching retry provenance before entering `TaskRunning`, then
delegates to the existing retry `task.run` path. Replay returns the same bounded
retry outcome without duplicate running or verifier evidence. M16.2 does not
admit another retry task, apply patches, run providers, start recovery
automatically, schedule a loop, or add a new RPC.

M17.1 adds `headless.run.advance` as a runtime-owned run-control session
primitive. A caller explicitly authorizes one named `session_id`, supplies the
expected session sequence, and for a new session supplies current
`task.list.progress_overview` fingerprint and aggregate sequence. The runtime
executes at most three existing `headless.continue_once` steps, derives per-step
continuation IDs from the session and sequence, persists a bounded session
checkpoint with start/post progress handles, and records bounded
`HeadlessRunSessionAdvanced` evidence for executed steps. Repeating an already
committed sequence returns the persisted checkpoint with `replayed=true` without
duplicate `TaskRunning` or run-session evidence. The next sequence starts from
the prior checkpoint, so the caller does not reconstruct raw progress handles.
Stale starting progress and wrong session sequence fail before task execution.
This remains explicit caller-driven work: no scheduler, background worker,
automatic apply, automatic recovery, provider expansion, shell/git/network/
service expansion, VSIX policy, raw prompts, provider responses, file content,
commands, stdout, stderr, environment values, secrets, or raw paths.

M17.2 adds `headless.run.drive` for bounded run-control from an existing
session checkpoint. The caller supplies `authorize=true`, a bounded `session_id`
and `drive_id`, the expected current session sequence, and small drive budgets.
The runtime requires an existing M17.1 checkpoint, derives later session
sequences, executes repeated existing session advances, persists a bounded drive
checkpoint, and stops at a safe existing route boundary or budget limit.
Repeating the same drive id returns the persisted drive result with
`replayed=true` and does not duplicate task execution or run-session evidence.
This is not a scheduler or background loop and does not add automatic apply,
automatic recovery, provider, shell, git, network, service, or VSIX-owned policy
behavior.

M50.1 extends the existing `headless.run.drive` entry point with a bounded
journey-admission path for the first development-objective step. A caller may
set `expected_start_session_sequence=0` only with `journey_admission`, which
requires `authorize_journey_start=true`, a bounded `journey_id`, and a normal
task-start envelope. Rust validates the request before task creation, rejects
malformed or mixed-route admission, delegates to existing `task.start`, derives
the start progress checkpoint, and drives the new task through the same
run-control stop boundaries. The returned `journey` metadata and persisted
checkpoint contain only bounded handles, progress fingerprints, closure status,
next action, replay state, and a journey fingerprint. Replaying the same
journey with matching identity returns the committed result without duplicating
task, advance, drive, or journey evidence.

M50.2 adds the first runtime-derived post-admission continuation on the same
entry point. A caller may provide `journey_route_resume` for a current
`FetchSelectedModePackCandidateExplicitly` boundary with explicit resume
authorization, expected journey fingerprint, expected route kind, and expected
registry-selection checkpoint fingerprint. The caller does not provide
`modepack_selected_candidate_fetch_target` on the successful path. Rust derives
that target from bounded registry-selection checkpoint evidence, executes it
through existing run-control authority, records bounded route-resume evidence,
and replays the same drive/resume identity without duplicating fetch, advance,
drive, or resume ledger effects. Missing authorization, stale fingerprints,
unsupported route kind, missing subordinate checkpoint, and mixed explicit
targets fail closed before route side effects.

M50.3 adds the next runtime-derived post-admission continuation on the same
entry point. A caller may provide `journey_route_resume` for a current
`VerifySelectedModePackCandidateProvenanceExplicitly` boundary with explicit
resume authorization, expected journey fingerprint, expected route kind, and
expected selected-candidate fetch checkpoint fingerprint. The caller does not
provide `modepack_selected_candidate_provenance_verification_target` on the
successful path. Rust derives that target from persisted selected-candidate
fetch checkpoint evidence, executes it through existing run-control authority,
records bounded route-resume evidence, and replays the same drive/resume
identity without duplicating provenance verification, advance, drive, or resume
ledger effects. Missing authorization, stale fingerprints, unsupported route
kind, missing fetch checkpoint evidence, and mixed explicit targets fail closed
before route side effects. The route resume does not expose raw provenance
statements, signatures, public keys, Mode Pack payloads, prompts, file content,
commands, stdout, stderr, environment values, secrets, or raw paths.

M50.4 adds the third runtime-derived post-admission Mode Pack continuation on
the same entry point. A caller may provide `journey_route_resume` for a current
`ApproveVerifiedModePackCandidateExplicitly` boundary with explicit resume
authorization, expected journey fingerprint, expected route kind, and expected
selected-candidate provenance-verification checkpoint fingerprint. The caller
does not provide `modepack_selected_candidate_approval_target` on the
successful path. Rust derives that target from persisted provenance
verification plus fetch checkpoint evidence, executes it through existing
run-control authority, records bounded route-resume evidence, and replays the
same drive/resume identity without duplicating candidate approval, advance,
drive, or resume ledger effects. Missing authorization, stale fingerprints,
unsupported route kind, missing provenance or fetch checkpoint evidence,
checkpoint mismatch, and mixed explicit targets fail closed before route side
effects. The route resume does not expose raw provenance statements,
signatures, public keys, Mode Pack payloads, prompts, file content, commands,
stdout, stderr, environment values, secrets, or raw paths.

M50.5 adds the fourth runtime-derived post-admission Mode Pack continuation on
the same entry point. A caller may provide `journey_route_resume` for a current
`ReplaceActiveWithApprovedModePackCandidateExplicitly` boundary with explicit
resume authorization, expected journey fingerprint, expected route kind, and
expected selected-candidate approval checkpoint fingerprint. The caller does
not provide `modepack_selected_approved_candidate_replacement_target` on the
successful path. Rust derives that target from persisted approval, provenance,
fetch, registry-selection, and active Mode Pack evidence, executes it through
existing run-control replacement authority, records bounded route-resume
evidence, and replays the same drive/resume identity without duplicating active
replacement, candidate consumption, advance, drive, or resume ledger effects.
Missing authorization, stale fingerprints, unsupported route kind, missing
approval / provenance / fetch / selection / current-active evidence, checkpoint
mismatch, and mixed explicit targets fail closed before route side effects. The
route resume does not expose raw provenance statements, signatures, public
keys, Mode Pack payloads, prompts, file content, commands, stdout, stderr,
environment values, secrets, or raw paths.

M50.6 adds the runtime-owned closure boundary for the same Golden Journey. A
caller may provide `journey_closure` on `headless.run.drive` after the
replacement route-resume drive has committed, with explicit closure
authorization, expected journey fingerprint, source replacement drive id, and
expected replacement resume fingerprint. The caller does not provide
completion-finalization bypass fields or reconstruct ledger evidence. Rust
validates the journey checkpoint, replacement route-resume checkpoint, selected
approved candidate replacement checkpoint, active Mode Pack activation, current
progress, no remaining routes, and terminal completion evidence before
committing completion finalization and bounded `HeadlessJourneyClosed` ledger
evidence. Replay is idempotent and returns the same closure metadata without
duplicating finalization or closure events.

M50.7 adds a bounded `journey_execution` envelope to the same
`headless.run.drive` entry point. A caller explicitly authorizes one Golden
Journey execution and supplies either an initial bounded `task_start` for
admission or a post-admission expected journey fingerprint plus optional latest
execution checkpoint fingerprint. Rust then owns the next-boundary selection:
it reuses the existing admission, route-resume, replacement, and closure
authority, persists a bounded execution checkpoint after each committed
boundary, and resumes from that checkpoint after an interrupted response
without requiring caller-supplied `journey_route_resume`, `journey_closure`, or
Mode Pack target envelopes on the successful execution path. Replay does not
duplicate task start, drive, route-resume, replacement, finalization, closure,
or execution ledger evidence, and execution metadata remains limited to
bounded handles, boundary classes, route kinds, hashes, fingerprints, replay
state, and next action.

M50.8 requires `journey_execution` to reconcile already committed child-drive
boundaries before choosing any new Golden Journey work. If the outer execution
checkpoint is missing or behind, the runtime may recover the admission, fetch,
provenance, approval, replacement, and closure boundaries from persisted drive
checkpoints after validating session, drive, journey, route-kind, sequence, and
SHA-256 source/resume evidence. Closure recovery also replays the task
completion boundary and `HeadlessJourneyExecuted` ledger event idempotently.
This preserves the same authorization and bounded metadata contract while
removing caller-side recovery choreography after an interrupted response.

R3.1 adds bounded timeout-containment evidence to those same controlled verifier results. On supported Unix platforms, the runtime launches verifier commands in a process group and attempts process-tree termination on timeout. The result records only support, attempt, success, and bounded reason fields. Unsupported platforms report lack of process-tree timeout support honestly.

## Subtasks

Subtasks must not dump full transcript history back to a parent task.

A parent receives a compact result:

```text
- task id
- assigned mode
- goal
- result summary
- changed files
- tests run
- verification evidence
- unresolved issues
```

## Phase 1.1 skeleton

`AgentLoop::run_noop` is the only executable loop path in Phase 1.1. It exists so the Rust runtime calls the AgentLoop crate while advancing task state from `Created` to `Running` to `Completed`.

## Non-goals for v0

- Production implementation of all Zoo Code loop behaviors.
- Parallel subtask scheduling.
- Distributed task execution.
- Full UI timeline implementation.

## Phase 1.2 fake LLM path

Phase 1.2 adds `AgentLoop::run_with_fake_llm` as the minimal executable prompt path. The loop accepts a materialized `PromptBuildInput`, builds a deterministic `PromptView`, converts that view to an in-process fake LLM request, and returns `Completed` with the deterministic fake response.

This path is local-only. It does not call a real LLM API, open an OpenAI-compatible HTTP client, parse AgentModes, execute tools, fetch or activate Mode Packs, use Qdrant, use llama-server, or run an indexer.

The runtime records prompt and fake-LLM lifecycle metadata in the run ledger around this path. Full prompt text is not persisted by default; the ledger stores counts and short previews only.


## Phase 2.0 LLM provider boundary

Phase 2.0 routes LLM calls through a provider abstraction. The Fake provider remains the default and no external LLM API is contacted unless `BROWNIE_LLM_PROVIDER=openai-compatible` and the required OpenAI-compatible environment configuration are present. The `llm.status` JSON-RPC method reports provider, enabled state, model, base URL, and a non-secret reason; it never returns API keys or Authorization headers. Task ledger LLM request events store only provider/model/message_count metadata, and response events store only provider/content_preview. Streaming and additional tool execution capabilities remain out of scope. See `docs/specifications/llm-provider-spec-v0.md`.

## M5 subtask orchestration queue

M5 records approved `subtask.spawn` intent as runtime-owned queue state. The parent run ledger receives `SubtaskOrchestrationQueued`, and later prompt materialization includes a compact `Subtask Orchestration` summary.

This is not parallel scheduling or child task execution. No subtask is launched, no workspace file is written, no patch is applied, and no process, network, or service-control capability is added.

## M5.1 subtask handoff preparation

M5.1 advances queued subtask evidence into parent-run handoff state. The runtime appends `SubtaskHandoffPrepared` after queueing approved `subtask.spawn` intent, and prompt materialization summarizes that prepared handoff for later passes.

This remains a scheduling foundation only. No child task is launched, no workspace file is written, no patch is applied, and no process, network, or service-control capability is added.

## M5.2 subtask scheduler readiness

M5.2 evaluates prepared subtask handoff state for scheduler readiness. The runtime appends `SubtaskSchedulerReadinessRecorded` after `SubtaskHandoffPrepared`, records that dispatch remains blocked, and exposes the blocker in later prompt materialization.

This is still not child execution. No child task is launched, no workspace file is written, no patch is applied, and no process, network, or service-control capability is added.

## M5.3 subtask dispatch plan preparation

M5.3 converts scheduler-readiness evidence into deterministic parent-run dispatch plan state. The runtime appends `SubtaskDispatchPlanPrepared` after `SubtaskSchedulerReadinessRecorded`, records why dispatch is still blocked, and exposes the plan blocker in later prompt materialization.

This remains planning only. No child task is launched, no workspace file is written, no patch is applied, and no process, network, or service-control capability is added.

## M5.4 subtask dispatch contract preparation

M5.4 converts dispatch-plan evidence into deterministic parent-run dispatch contract and eligibility-gate state. The runtime appends `SubtaskDispatchContractPrepared` after `SubtaskDispatchPlanPrepared`, records the required preconditions for future dispatch, and exposes the contract blocker in later prompt materialization.

This remains contract preparation only. No child task is launched, no workspace file is written, no patch is applied, and no process, network, or service-control capability is added.

## M5.5 subtask dispatch admission evaluation

M5.5 converts dispatch-contract evidence into deterministic parent-run dispatch admission and execution-gate state. The runtime appends `SubtaskDispatchAdmissionEvaluated` after `SubtaskDispatchContractPrepared`, records which preconditions still block admission, and exposes the execution gate blocker in later prompt materialization.

This remains admission evaluation only. No child task is launched, no workspace file is written, no patch is applied, and no process, network, or service-control capability is added.

## M5.6 subtask dispatch readiness snapshot

M5.6 converts dispatch-admission evidence into deterministic parent-run dispatcher-readiness snapshot state. The runtime appends `SubtaskDispatchReadinessSnapshotRecorded` after `SubtaskDispatchAdmissionEvaluated`, records a stable readiness fingerprint and scheduler handoff blocker, and exposes the snapshot in later prompt materialization.

## M5.7 subtask dispatcher guard verdict

M5.7 converts dispatcher-readiness snapshot evidence into deterministic parent-run dispatcher guard verdict state. The runtime appends `SubtaskDispatcherGuardVerdictRecorded` after `SubtaskDispatchReadinessSnapshotRecorded`, records the snapshot fingerprint validity and scheduler handoff preflight blocker, and exposes the guard verdict in later prompt materialization.

This remains guard verdict recording only. No child task is launched, no workspace file is written, no patch is applied, and no process, network, or service-control capability is added.

## M5.8 subtask dispatch decision

M5.8 converts dispatcher guard verdict evidence into deterministic parent-run dispatch decision and dispatch candidate state. The runtime appends `SubtaskDispatchDecisionRecorded` after `SubtaskDispatcherGuardVerdictRecorded`, records `dispatch_decision = "Denied"`, per-candidate blocked counts, and a guard-verdict-derived denial reason, and exposes the decision in later prompt materialization.

This remains dispatch decision recording only. No child task is launched, no scheduler handoff is performed, no workspace file is written, no patch is applied, and no process, network, or service-control capability is added.

## M5.9 subtask dispatch candidate manifest

M5.9 converts dispatch decision evidence into deterministic parent-run per-candidate manifest state. The runtime appends `SubtaskDispatchCandidateManifestRecorded` after `SubtaskDispatchDecisionRecorded`, records queued candidate ids, blocked candidate ids, candidate manifest fingerprint evidence, and a decision-derived candidate denial reason, and exposes the manifest in later prompt materialization.

This remains candidate manifest recording only. No child task is launched, no scheduler handoff is performed, no workspace file is written, no patch is applied, and no process, network, or service-control capability is added.

## M5.10 subtask dispatch handoff envelope

M5.10 converts candidate manifest evidence into deterministic parent-run dispatch handoff envelope and replay guard blocker state. The runtime appends `SubtaskDispatchHandoffEnvelopeRecorded` after `SubtaskDispatchCandidateManifestRecorded`, records the manifest id, candidate ids, handoff envelope fingerprint, replay guard status, and blocked handoff ticket preflight state, and exposes the envelope in later prompt materialization.

This remains handoff envelope recording only. No child task is launched, no scheduler handoff is performed, no workspace file is written, no patch is applied, and no process, network, or service-control capability is added.

## M5.15 structured subtask materialization input

M5.15 gives `subtask.spawn` a bounded structured input surface. Approved requests may include an optional child `goal` and optional child `mode_id`; invalid shape, unknown fields, unsafe `mode_id` syntax, and unresolved modes are rejected before queueing or child materialization.

Valid structured input changes the runtime entity rather than adding another blocked parent-run wrapper: `requested_goal_preview` becomes the materialized child task goal, and `requested_mode_id` becomes the child mode. Parent runs still do not auto-run children, and no scheduler handoff, process execution, network access, service control, patch apply, or workspace write capability is added.

## M5.16 multi-candidate child materialization

M5.16 lets one accepted handoff envelope materialize one queued child task for each distinct covered candidate. The agent loop still performs no scheduler handoff and does not run those children automatically; it only creates controlled runtime entities with parent/source provenance and candidate-scoped replay protection.

Each child keeps the per-candidate sanitized `source_intent_summary`, requested goal, and requested mode when present. Explicit child `task.run` remains the only execution path, and no process execution, network access, service control, patch apply, or workspace write capability is added.

## M5.17-M5.18 controlled parent join continuation

Once controlled children have been explicitly run to completion, a completed parent can be explicitly continued through `task.run`. The continuation receives only bounded child completion summaries as context; it does not run children, schedule work, or expose raw child prompts, raw provider responses, files, command output, environment values, raw tool input objects, or serialized request bodies.

M5.18 adds replay protection for that join point. The runtime records a deterministic summary-safe child completion fingerprint when parent continuation is admitted, and it rejects another parent agent-loop pass for the same fingerprint before `TaskRunning` is appended. If the controlled child result evidence materially changes, the new fingerprint can be admitted separately.

## M53.1 product continuation task admission

M53.1 extends existing `task.start` with a `product_continuation_source` envelope. The envelope must provide explicit authorization, source task/run/decision ids, and expected decision, accepted-completion, terminal-completion, completion-closure, and product-evidence SHA-256 fingerprints. The Rust runtime re-reads the source task and run ledger before creating any task, requires the current product decision to be `continue_development` with `next_action = plan_next_phase`, and records bounded `product_continuation_provenance` on the admitted task and `TaskStarted` evidence.

This is task admission only. Exact replay returns the same continuation task/run without another `TaskStarted` event, while product-complete, blocked-by-product-evidence, stale, malformed, unauthorized, or conflicting evidence is denied before continuation task creation. The admitted task is not run automatically, no provider/verifier/apply/shell/git/network/service/workspace mutation path is invoked, and metadata excludes raw prompts, provider responses, final responses, file content, diffs, command output, environment values, raw ledger payloads, absolute paths, canonical paths, and secrets.

M53.1.1 requires replay to bind the admitted continuation task to the original
request intent as well as the source decision. If a continuation task already
exists for the source task/run/decision fingerprint, `task.start` may replay it
only when `product_continuation_provenance`, `goal`, and `mode_id` all match the
new request. A different goal or mode for the same source decision is an
admission conflict and must fail before task creation or replay. The source
decision's bounded `remaining_capability` is copied into
`product_continuation_provenance`; malformed or over-budget capability metadata
is rejected as invalid product-continuation evidence.

M53.2 revalidates that stored `product_continuation_provenance` at the existing
`task.run` boundary for Created product-continuation tasks. The runtime must
reload the source task/run ledger, require the latest source product decision to
match the provenance decision id and all expected fingerprints, and require the
decision to remain `continue_development` with `next_action = plan_next_phase`
before `TaskRunning` is appended. Superseded, terminal-product, malformed, or
fingerprint-mismatched source evidence fails closed before provider, verifier,
tool, apply, shell, git, network, service, or workspace side effects. Already
terminal continuation tasks keep existing `task.run` replay behavior.

M54.1 allows the existing product completion decision to carry optional bounded
`technical_debt_carry_forward` evidence when the decision is
`continue_development`. Each item is runtime-validated bounded ASCII metadata
only: debt id, summary, source milestone, source phase, optional PR reference,
target capability, status, and next action. Rust sorts the items, derives a
deterministic SHA-256 carry-forward fingerprint, records the bounded evidence in
the product-decision ledger payload, and copies the fingerprint plus item
summaries into `product_continuation_provenance` during
`task.start(product_continuation_source)`. Matching evidence replays
duplicate-free; conflicting carry-forward evidence for the same persisted
decision fails closed. The feature adds no new RPC, standalone debt report,
automatic execution, workspace mutation, raw prompt/provider/file/diff/output
payload, command, environment, path, or secret exposure.

M54.2 changes the same product-completion decision surface from caller-owned
carry-forward replacement to runtime-derived technical-debt state. When a task
was admitted from product-continuation provenance, its prior open/deferred debt
is the previous state. The request may add bounded new open debt and may provide
explicit transitions for prior debt to `resolved`, `superseded`, or `deferred`.
The runtime derives the next active debt set; omission is not a deletion. Debt
items have bounded `classification` values of `blocking`,
`required_before_release`, or `post_v0`, and active statuses of `open` or
`deferred`. Closing transitions require a SHA-256
`closure_evidence_fingerprint`. Product completion is denied while blocking or
required-before-release debt remains active, while post-v0 debt can remain
visible without blocking completion. Continued development carries the derived
active debt state into `product_continuation_provenance`.

M55.1 makes the existing `headless.run.drive` journey admission boundary atomic or cleanly recoverable for late commit failures. A failed checkpoint write after initial task creation must remove the just-created task/run. A failed `HeadlessJourneyStarted` ledger append after checkpoint persistence must remove the matching checkpoint and just-created task/run. A retry for the same request must create exactly one committed journey admission, while exact replay of a committed admission and conflicting replay denial retain existing behavior. This adds no new RPC, generic transaction engine, report, history, readiness, inspection, shell/git/network/service execution, workspace mutation, VSIX-owned policy, or raw data exposure.

M56.1 allows the existing `headless.run.drive` journey admission request to
bind one arbitrary repository coding objective to selected index context before
the first coding task runs. The optional `journey_admission.objective_context`
requires explicit authorization, a bounded objective id, a SHA-256 objective
fingerprint, and one selected index read result. The runtime validates selected
context evidence before task creation, records bounded objective/index/context
metadata on the journey checkpoint and `HeadlessJourneyStarted` event, and
passes the selected context through the first `headless.run.advance` and
`headless.continue_once` into `task.run`. Exact replay is duplicate-free;
changed objective or selected-context evidence for the same journey id is
rejected before mutation. Persisted metadata must not store raw selected file
content, raw selected paths, prompts, provider responses, command output,
environment values, absolute paths, canonical paths, raw requests, raw ledger
payloads, or secrets.

M56.2 continues the arbitrary-repository Golden Journey through the existing
`headless.run.drive` response and checkpoint shape. When the M56.1 admitted
task/run produces exactly one `Valid` and `Pending` non-recovery
`WorkspacePatchProposed` event, the runtime returns
`objective_proposal_candidate` metadata and mirrors it in journey metadata as
`proposal_candidate`. The bounded candidate contains only ids, status labels,
counts, source event id/kind, operation, approval/validation states, SHA-256
objective/context/path/candidate fingerprints, replay state, and
`review_and_authorize_objective_proposal`. The runtime must deny zero,
ambiguous, malformed, invalid, blocked, non-pending, stale, conflicting, or
recovery-scoped proposal evidence before candidate side effects. This phase is
non-mutating: it does not approve, reject, preflight, apply, run providers,
execute shell/git/tests, access network/services, or expose raw prompts,
provider responses, proposed content, file content, hunks, diffs, command
output, environment values, raw requests, raw ledger payloads, absolute paths,
canonical paths, or secrets.
