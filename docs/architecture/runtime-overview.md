# Brownie Runtime Architecture Overview

## Summary

Brownie uses a thin Code-OSS VSIX and a Rust runtime.

```text
Code-OSS / Brownie VSIX
  -> protocol boundary
Brownie Runtime
  -> Agent Loop
  -> AgentModes compatibility
  -> Context manager
  -> Tools
  -> LLM client
  -> llama-server wrapper
  -> Qdrant wrapper
  -> Indexer
  -> Store
  -> Events
```

## VSIX responsibility

The VSIX owns:

- Code-OSS activation
- command registration
- workspace bridge
- editor bridge
- terminal bridge
- Custom Agent UI adapter surface
- runtime process startup
- event display

The VSIX should not own agent policy.

## Runtime responsibility

The Rust runtime owns:

- task lifecycle
- agent-loop state transitions
- mode policy enforcement
- prompt materialization
- tool routing
- LLM request routing
- wrapper coordination
- indexing coordination
- ledger persistence
- event emission

## Boundary principle

The runtime is the execution authority. The VSIX presents state and connects Code-OSS capabilities.

## R1 architecture recovery

R1 freezes the Phase 3 diagnostics wrapper chain and redirects follow-up work to diagnostics API consolidation. New phases must not extend the `proposal.reviewQueueDiagnostics...Digest...Report...History` pattern.

See `docs/architecture/diagnostics-api-consolidation.md`, `docs/architecture/phase-value-gate.md`, `docs/architecture/phase-value-manifest.json`, and `docs/architecture/diagnostics-legacy-api-metadata.json` for the inventory, deprecation plan, value/review guard, and R1.1 enforcement metadata.

## Controlled Apply Boundary

Patch proposal generation remains a dry-run `workspace.write` path: tool intent parsing and task execution do not directly modify files. Beginning with M6.1, the runtime-owned `proposal.apply` RPC is the only workspace mutation path. M6.1 supports one approved `replace_file` proposal for one existing regular UTF-8 file with explicit authorization, approval freshness, expected target SHA-256 verification, latest preflight validation, protected-path denial, parent traversal denial, symlink rejection, temporary sibling writes, atomic replacement, post-write SHA-256 verification, and a bounded apply-result ledger event.

M6.2 extends the same `proposal.apply` authority to one approved `create_file` proposal for one absent target in an existing safe parent directory. Create-file apply requires `authorize=true`, current unconsumed approval, `expected_target_absent=true`, a fresh latest preflight proving absence, parent directory and symlink checks, no-overwrite atomic creation from a temporary sibling file, post-write SHA-256 verification, and the same bounded apply-result ledger event shape.

M6.3 extends the same `proposal.apply` authority to one approved `delete_file` proposal for one existing regular UTF-8 workspace file. Delete-file apply requires `authorize=true`, current unconsumed approval, caller-provided `expected_target_sha256`, omitted replacement content, a fresh latest preflight proving the target remains the approved regular non-symlink file, bounded removal, parent directory sync when possible, post-delete absence verification, and the same bounded apply-result ledger event shape.

Controlled apply must not run shell or git commands, use network access, create parent directories, overwrite existing targets during create, remove files outside the approved `delete_file` path, mutate directories, perform multi-file transactions, expose canonical paths or absolute paths, or return/store raw file content, raw diffs, raw input JSON, stdout, stderr, environment values, or secrets. Failure paths should preserve the original file or absent target whenever possible, clean partial temporary files, and must not consume apply authorization before successful atomic mutation and verification.

## Controlled Verification Boundary

M7.1 introduces the first runtime-owned verification execution path. The built-in `verification.cargo_fmt_check` tool is the only executable verifier in this slice: it requires `ExecuteProcess` permission, runs exactly `cargo fmt --check` at the workspace root, rejects caller-supplied command, argv, cwd, environment, stdin, shell, timeout, or unknown fields, and reports bounded status metadata through `tool.execute` and task-scoped `ToolExecution*` ledger events.

M7.2 extends that fixed-verifier model with `verification.cargo_check`. The tool requires `ExecuteProcess`, accepts only `{}` or `{ "check_id": "cargo_check" }`, runs exactly `cargo check --workspace --all-targets --locked --offline`, requires workspace `Cargo.toml` and `Cargo.lock`, rejects workspaces containing `build.rs` in this phase, uses a runtime-owned isolated Cargo target directory outside the workspace, sets Cargo dependency-fetch offline mode, removes the isolated target directory after execution, and records only bounded verifier metadata.

M7.3 makes requested controlled verifier evidence a `task.run` completion gate. Before recording `AgentLoopCompleted` and the terminal task event, the runtime re-reads the current run ledger, derives the required verifier set from task-scoped `verification.cargo_fmt_check` and `verification.cargo_check` intents, and requires each requested verifier to have a fresh terminal `ToolExecutionCompleted` event with `verification_status = "Passed"`. Denied, rejected, failed, timed-out, spawn-failed, missing, malformed, or stale verifier evidence turns the task terminal status into `Failed` and records bounded `verification_completion_gate_*` metadata on the terminal task event and `TaskRunResult`.

M8.1 turns terminal failed verifier-gate evidence into an explicit recovery task admission path on the existing `task.start` RPC. A caller may provide `verification_recovery_source` with source task/run IDs, an expected failure fingerprint, and `authorize_recovery=true`. The Rust runtime re-reads the source task and ledger, requires the source to be terminal `Failed` because of a current failed verification completion gate, verifies the fingerprint, and then creates or replays exactly one `Created` recovery task/run for that failure fingerprint. Recovery admission records bounded `verification_recovery_provenance` on the task record and recovery `TaskStarted` event, returns bounded `verification_recovery_admission` metadata with `recovery_running_enabled=false` and `next_action=run_recovery_task_explicitly`, and does not run the recovery task.

M8.2 allows that admitted recovery task to be run explicitly through the existing `task.run` RPC. Before appending `TaskRunning`, the runtime re-reads the source task and source run ledger, revalidates the stored recovery provenance against the latest failed verifier-gate evidence, and rejects stale recovery tasks. During the recovery run, approved `workspace.write` intent still goes through the existing permission gate and dry-run proposal path, creating at most one recovery-scoped `WorkspacePatchProposed` event annotated with bounded source task/run IDs, recovery task/run IDs, the failure fingerprint, and failed verifier tool IDs. R3.2 makes the repair handoff fail closed: `task.run` returns bounded `verification_recovery_repair` metadata with `gate_status=Passed`, the proposal handle, proposal count, `apply_enabled=false`, and `next_action=review_and_authorize_recovery_proposal` only when exactly one valid recovery-scoped proposal exists. Missing, ambiguous, invalid-provenance, or not-applicable repair proposals force terminal `TaskFailed` and return `gate_status=Failed`, a bounded `failure_reason`, proposal count, and `next_action=inspect_recovery_repair_gate_failure`; replay returns the same bounded outcome without duplicating `TaskRunning` or `WorkspacePatchProposed`. A failed repair-gate attempt is not replay-locked forever: a later `task.start` with the same source failure fingerprint may admit a fresh recovery task so corrected mode or goal inputs can produce an applicable proposal. This phase does not apply patches, retry verifiers, run shell/git/network/service actions, or expose raw output, commands, prompts, file content, paths, environment values, or raw request bodies.

M8.3 lets the caller continue after an approved recovery proposal has been applied through `proposal.apply`. `task.start` may include `verification_recovery_retry_source` with source task/run IDs, recovery task/run IDs, proposal/apply IDs, expected failure and apply fingerprints, and `authorize_verification_retry=true`. The runtime revalidates the latest source failure evidence, recovery task provenance, recovery-scoped proposal evidence, and successful apply result before creating or replaying one retry task for that source/recovery/proposal/apply tuple. Explicit `task.run` on the retry task revalidates the same evidence before appending `TaskRunning`, executes exactly the failed M7 verifier tool IDs through existing `ExecuteProcess` permission checks and controlled verifier executors, returns bounded `verification_recovery_retry` outcome metadata, and replays terminal retry outcomes without duplicate `TaskRunning`, `ToolExecutionRequested`, or terminal tool evidence. R3.2 additionally binds retry verifier evidence to a runtime-owned requirement derived from retry/apply provenance; generated verifier events and the completion gate carry a bounded requirement ID, source kind, source apply ID, and SHA-256 requirement fingerprint. Retry execution does not create proposals, apply patches, mutate the workspace, run generic shell/git/network/service actions, expose raw command output, or accept caller-supplied verifier commands.

R3.3 makes failed `verification.cargo_check` recovery actionable without raw log exposure. The controlled verifier runs Cargo with structured JSON output, keeps captured stdout/stderr internal to the verifier, and emits at most five `bounded_cargo_diagnostics` entries with tool ID, check ID, diagnostic kind, severity, optional code, normalized workspace-relative path, line, column, and truncation state. The runtime sanitizes those entries before ledger insertion, includes them on failed verification completion gates and `VerificationRecoveryProvenance`, and materializes them into recovery prompts. It must not persist raw stdout/stderr, rendered compiler diagnostics, source snippets, commands, environment values, absolute or canonical paths, file content, provider responses, or raw prompt text.

## Runtime Codebase Indexing Boundary

M9.1 introduces `codebase.index.build`, the first runtime-owned codebase
indexing execution path. M9.2 hardens that path before query exposure: the Rust
runtime now requires `mode_id`, checks `RuntimeAction::IndexCodebase`, validates
canonical root containment including intermediate symlink rejection, opens files
through a bounded no-follow handle path where supported, enforces total
visited-entry and per-directory entry limits, and commits snapshot/current/ledger
state through a locked index store with temporary sibling files and a compact
commit marker.

M9.2.1 closes the remaining M9.2 integrity debt before M9.3 filtering. Platforms
without safe no-follow file reads fail closed before a successful snapshot is
committed. Queued directories are revalidated for symlink replacement and
canonical workspace containment immediately before reading. Per-directory
truncation keeps a bounded lexicographic selection instead of the first
filesystem-order entries, so unchanged directory contents produce stable bounded
snapshots. Index build locks include owner metadata and a nonce; safely stale
locks can be reclaimed without removing active locks.

Successful builds append `CodebaseIndexSnapshotBuilt`; denied indexing modes may
append bounded `CodebaseIndexPermissionChecked` evidence and never append a
successful build event. `force_refresh` is recorded only as
`requested_force_refresh` until cache reuse exists.

M9.3 keeps the same `codebase.index.build` RPC but filters ignored and sensitive
files before successful snapshot persistence. The indexer loads root
`.gitignore`, `.brownieignore`, and `.rooignore` files through bounded no-follow
reads, rejects symlinked or non-UTF-8 ignore policy files, skips ignored paths,
skips common sensitive path names before file reads, and skips UTF-8 files whose
content triggers the existing sensitive-content detector before hashing. Runtime
outputs expose only bounded numeric evidence through `skipped_ignored`,
`skipped_sensitive`, `ignore_rule_files_loaded`, `ignore_rule_count`, and
`sensitive_finding_count`. Raw ignore patterns, matched secret values, file
content, absolute paths, and canonical paths remain outside RPC responses,
snapshot manifests, and ledger payloads. Successful builds now report
`next_action = "build_bounded_index_query_file_selection"`.

M9.4 adds `codebase.index.query`, the first bounded consumption surface for the
latest persisted index snapshot. The Rust runtime requires `mode_id`, checks
`RuntimeAction::IndexCodebase`, reads `.brownie/codebase-index/current.json`
only after authorization, rejects missing or malformed current snapshots, and
returns deterministic file-selection handles instead of file content. The query
result contains only snapshot identity, query/selection fingerprints,
workspace-relative paths, file kinds, byte/line metadata, optional content
hashes, scores, and bounded match reasons. Successful queries append summary-only
`CodebaseIndexQueryCompleted` ledger events without raw query text or selected
paths and return
`next_action = "read_selected_files_with_controlled_workspace_read"`.

M9.5 adds the executable follow-up step for those selection handles without
adding a new JSON-RPC method. Callers invoke `tool.execute` with
`tool_id = "codebase.index.selection.read"` and one selected path plus the
bounded query/selection/snapshot evidence from M9.4. The built-in tool registry
checks `ReadWorkspace`, then the Rust runtime checks
`RuntimeAction::IndexCodebase` before reading current index state or file
content. The runtime recomputes the selection fingerprint, requires matching
`CodebaseIndexQueryCompleted` evidence, validates the latest current snapshot
and selected entry metadata, delegates to the controlled workspace read
boundary, and verifies the post-read SHA-256 before returning bounded UTF-8
content. Successful reads append summary-only
`CodebaseIndexSelectionReadCompleted` events with ids, fingerprints, counts,
byte counts, file kind, content hash, verification status, and read-path
fingerprint; the ledger does not store raw query text, raw selected paths, raw
file content, snippets, diffs, commands, stdout/stderr, environment values,
absolute paths, canonical paths, prompts, provider responses, or secrets.

M9.6 connects those selected reads to actual agent execution without adding a
new JSON-RPC method. `task.run` accepts one optional `selected_index_context`
whose shape matches a prior successful `CodebaseIndexSelectionReadResult`.
Before `TaskRunning`, the Rust runtime validates the selected-read ids,
fingerprints, snapshot identity, read-path fingerprint, file kind, byte count,
truncation state, content SHA-256, source event kind, and `next_action` against
the summary-only `CodebaseIndexSelectionReadCompleted` codebase-index ledger
event. The stored task mode must allow both `ReadWorkspace` and
`IndexCodebase`. Successful validation appends one summary-only
`CodebaseIndexPromptContextMaterialized` task ledger event, feeds raw selected
content only into the in-memory `Selected Index Context` prompt section, redacts
`PromptBuilt` and `SecondPassPromptBuilt` previews, and returns bounded
`selected_index_prompt_context` metadata. Task ledgers, task-run results,
diagnostics, and prompt-preview payloads do not store raw selected file content
or raw selected paths.

The VSIX remains a protocol client and does not own indexing policy. M9 does not
yet implement semantic symbols, chunks, embeddings, Qdrant writes, retrieval,
reranking, LLM calls, shell/git/network execution, service control, or workspace
mutation. Snapshot manifests, ledger events, and RPC responses must not expose
raw file content, snippets, diffs, absolute paths, canonical paths, raw prompts,
provider responses, stdout/stderr, environment values, commands, or secrets.

## Runtime Progress Visualization Boundary

M10.1 adds the first runtime-owned progress visualization model. Existing
`run.inspect` and `task.inspect` responses now include `run.progress_snapshot`,
a bounded classifier derived from persisted `TaskRecord` status, controlled child
task state, and already-recorded run ledger evidence. The classifier reports
lifecycle phase, current stage, one explicit next action, replay-safe source
fingerprint, latest verification state, separated agent-loop/task terminal
evidence, and child/verifier/recovery/apply/index-context counts and booleans.
Persisted `TaskRecord.status` is authoritative: historical `TaskRunning` and
`AgentLoopStarted` ledger evidence is only a no-record fallback, and cannot
override persisted `Created`, `Queued`, `Completed`, `Failed`, or `Cancelled`
status. Failed or cancelled parent status also outranks controlled child state.
The source fingerprint is computed from bounded derived state such as task
status, latest verification state, parent-join readiness,
recovery/apply/index-context signals, child status counts, task terminal event
kind, and the chosen lifecycle/stage/action.
Verification completion gates are recognized only when a runtime-owned terminal
task event (`TaskCompleted`, `TaskFailed`, or `TaskCancelled`) carries the bounded
gate schema. Recovery repair `gate_status` values and gate-shaped payloads on
non-terminal events are not treated as verification completion gate failures.

This is not a new JSON-RPC method, diagnostics wrapper, report, digest, history,
readiness check, execution preview, live in-flight progress observer,
same-runtime concurrent inspector, asynchronous runtime executor, or VSIX policy
layer. M10.1 reports between-step, blocked-state, terminal, recovery, and child
next-action progress from persisted runtime state; a future `M10.3 Concurrent
Runtime Progress Observation` phase may add concurrent observation with a
separate safety design. Inspection remains read-only: it appends no ledger event,
creates no child task, consumes no parent join state, applies no patch, runs no
verifier, calls no LLM provider, reads no workspace file, and performs no
shell/git/network/service action. Snapshot fields must not expose raw prompts,
provider responses, file content, snippets, diffs, stdout/stderr, command
strings, environment values, raw request bodies, absolute paths, canonical paths,
or secrets.

M10.2 extends the same milestone through `task.list` by adding
`progress_overview`, a runtime-owned aggregate over the listed task set. The
overview returns runnable task IDs, blocked task IDs, terminal task IDs,
parent-join-ready task IDs, parent/child graph nodes and edges, bounded
next-action sets, status/stage counts, an aggregate sequence, and a source fingerprint. It is computed
from persisted `TaskRecord` state, controlled child provenance already loaded
for the task listing, and bounded terminal-outcome plus parent-run consumption
evidence for completed parent-join candidates, so headless callers can choose the next explicit action
without wrapping `run.inspect` across every task or teaching the VSIX to infer a
task graph. Parent-join-ready IDs require terminal controlled children and no
consumed parent-join continuation fingerprint for the current child result fingerprint.

M10.2 remains read-only. Listing tasks does not execute tasks, consume
parent-join state, append ledger events, read workspace files, run verifiers,
apply patches, call providers, or start an asynchronous executor. It also avoids
0-100% progress percentages and keeps aggregate persisted progress separate from
future live concurrent observation work reserved for M10.3.

M11.1 adds the first bounded headless autonomous development control primitive.
The new `headless.continue_once` JSON-RPC method accepts `authorize=true`, an
expected `task.list.progress_overview.source_fingerprint`, and an expected
`aggregate_sequence`. The Rust runtime recomputes the current aggregate progress
state, rejects stale callers before any ledger mutation, selects exactly one
eligible `Created` or controlled `Queued` task whose next action is
`run_task_explicitly`, records bounded `HeadlessContinuationDecisionRecorded`
evidence on that selected task, and then delegates to the existing `task.run`
admission path.

`headless.continue_once` is not an autonomous loop, scheduler, async executor,
live progress observer, or selected-next-action preview. It executes at most one
task per request and selects no fallback candidate if selected task admission
fails. M11.1 excludes parent-join-ready completed parent execution, verification
retry execution, proposal apply, verifier expansion, shell/git/network/service
actions, and VSIX-owned task-selection policy. Its result and ledger evidence
stay summary-only and must not include raw prompts, provider responses, file
contents, ledger payloads, stdout/stderr, commands, environment values, raw
request bodies, absolute paths, canonical paths, secrets, or percentages.

Generic `process.exec` remains listed as a non-executable planning surface. The runtime denies it even for modes that may execute the controlled verifier. Verifier results expose only check id, verifier status, launch/timeout flags, exit code, duration, byte counts, truncation flags, redaction status, and bounded reason strings. They must not expose raw stdout, stderr, command strings, environment values, stdin, raw input JSON, file content, canonical paths, absolute paths, shell execution, git execution, network access, service control, or arbitrary test execution.

## R3 Verifier Integrity Recovery

R3.1 corrects the controlled verifier evidence boundary. `verification.cargo_check` no longer reports Cargo offline mode as OS-level network isolation. Its bounded metadata distinguishes `cargo_dependency_fetch_offline=true`, `os_network_isolated=false`, `compile_time_code_sandboxed=false`, and `trusted_workspace_required=true`, while preserving truthful `target_dir_isolated` and `cleanup_succeeded` fields. Controlled verifier timeout results also report bounded process-tree containment metadata: whether process-tree timeout is supported, whether a kill was attempted, whether it succeeded, and a bounded reason. On Unix, verifier processes are launched in a runtime-owned process group and timeout attempts terminate that process group. Unsupported platforms report the unsupported boundary honestly rather than claiming containment.

The Phase 3.5-3.51 wrapper-chain history is archived in `docs/architecture/diagnostics-wrapper-history.md`, with the endpoint inventory and deprecation plan in `docs/architecture/diagnostics-api-consolidation.md`. After R1.1, the next milestone is M1 Agent Loop Integration (`agent_loop_integration`).

## Subtask Recovery Outcomes

Recovery-cycle budget exhaustion is surfaced through the existing parent task.run response and parent inspection path as `recovery_cycle_budget_outcome`. The outcome is derived from bounded runtime ledger evidence and reports only budget status, exceeded depth, max depth, parent join admission id, blocked candidate count, disabled child materialization/running signals, and next action. Repeated parent task.run for an already-budget-exhausted parent replays the existing outcome without adding parent TaskRunning, ParentJoinContinuationFingerprintConsumed, SubtaskDispatchHandoffEnvelopeRecorded, child TaskRecord, or child TaskRunning evidence.

When an existing parent task.run materializes newly controlled queued children, the response can include `child_orchestration_outcome`. The outcome exposes only bounded child-orchestration handles: parent run id, newly materialized controlled queued children by task id/count, queued child task id/count, `child_running_enabled=false`, and `next_action=run_child_task_explicitly`. It does not expose raw child prompts, provider output, tool input, stdout, stderr, scheduler handoff, or any child auto-run behavior; callers use existing parent inspection output and explicit child task.run to continue.

If the initial parent task.run response is lost or retried while those children are still queued and before any parent-join continuation has been consumed, the same `child_orchestration_outcome` contract can be replayed from existing queued controlled child TaskRecords before parent admission. The replay path returns `run_child_task_explicitly` handles without adding parent TaskRunning, parent join consumption, handoff envelope, child TaskRecord, child TaskRunning, scheduler handoff, or raw child data.

If a parent-join continuation task.run response is lost or retried after the consumed parent-join continuation has already materialized queued continuation children, the same bounded `child_orchestration_outcome` contract can also be replayed from existing queued continuation child TaskRecords tied to that parent join admission id. This replay is scoped to the latest consumed parent-join continuation and accepted continuation handoff fingerprints, so it returns stable `run_child_task_explicitly` child handles without duplicating materialization, adding TaskRunning evidence, requiring raw ledger scraping, exposing raw child data, or introducing scheduler handoff.

When an explicit controlled child task.run reaches `Completed` or `Failed` with complete runtime-owned parent provenance, the child response can include `parent_join_readiness_outcome`. The outcome exposes only bounded parent task/run ids, child task/run ids, child terminal status, controlled child terminal/pending/non-runnable counts, pending controlled child task ids, non-runnable controlled child task ids, `parent_join_ready`, `parent_running_enabled=false`, and an explicit next action; it does not expose raw child goals, parent prompts, provider output, file content, commands, stdout/stderr, env, tool input, serialized request bodies, raw failure payloads, scheduler handoff, or parent auto-run behavior. The response path derives the signal from runtime-owned child TaskRecords sharing the parent run, appends no parent TaskRunning event, consumes no parent join state, records no parent handoff envelope, and leaves explicit parent task.run as the only continuation step. If any controlled sibling remains runnable and pending, the outcome reports `parent_join_ready=false` and `next_action=run_remaining_child_tasks_explicitly`; if a sibling is non-runnable such as `Running` or `Cancelled`, it reports `next_action=inspect_non_runnable_child_tasks` instead of recommending an invalid rerun. Only after every controlled child for that parent run is `Completed` or `Failed` does it report `parent_join_ready=true` and `next_action=run_parent_task_explicitly`.

Existing parent run.inspect and task.inspect can also expose `parent_join_readiness_summary` for eligible parent runs. The summary is derived from runtime-owned controlled child TaskRecords and reports only bounded parent task/run ids, controlled child terminal/pending/non-runnable counts, pending controlled child task ids, non-runnable controlled child task ids, `parent_join_ready`, `parent_running_enabled=false`, and the next explicit action. Parent inspection reports `run_remaining_child_tasks_explicitly` only while runnable controlled children remain pending, reports `inspect_non_runnable_child_tasks` when a `Running` or `Cancelled` controlled child would make rerun guidance invalid, and reports `run_parent_task_explicitly` only when all controlled children are terminal and the child result-set fingerprint has not already been consumed by a parent join. Inspecting the parent remains read-only: it appends no parent TaskRunning event, consumes no parent join state, records no handoff envelope, creates no child TaskRecord, runs no child task, exposes no raw child or parent data, and adds no diagnostics RPC or scheduler handoff behavior.

Direct controlled child task.inspect can expose a child-scoped `parent_join_readiness_summary` when the inspected child has complete runtime-owned parent provenance. The summary includes only bounded parent task/run ids, inspected child task/run ids, inspected child status, controlled child terminal/pending/non-runnable counts, pending controlled child task ids, non-runnable controlled child task ids, `parent_join_ready`, `parent_running_enabled=false`, and the next explicit action. Child inspection reports `run_remaining_child_tasks_explicitly` for runnable pending child sets, `inspect_non_runnable_child_tasks` for `Running` or `Cancelled` controlled children, and `run_parent_task_explicitly` only when every controlled child is terminal and the parent join result set is still unconsumed. Direct child inspection remains read-only: it appends no TaskRunning event, consumes no parent join state, records no handoff envelope, creates no child TaskRecord, runs no child task, exposes no raw child or parent data, and adds no diagnostics RPC or scheduler handoff behavior.

Consumed parent-join direct child task.inspect can also expose `consumed_parent_join_recovery_summary` when the inspected controlled child is part of a terminal child result set that was already consumed by an explicit parent task.run, or when the inspected child was materialized from that consumed join. The summary reports only bounded parent task/run ids, inspected child task/run ids/status, `parent_join_consumed=true`, the consumed terminal controlled child count, continuation controlled child counts, runnable continuation child task ids, non-runnable continuation child task ids, terminal continuation child count, `parent_running_enabled=false`, and one next explicit action. It reports `run_continuation_child_tasks_explicitly` only when continuation children are runnable, `inspect_non_runnable_continuation_child_tasks` when any continuation child is `Running` or `Cancelled`, and `inspect_parent_task` when the consumed join has no recoverable continuation child handles. It never reports `run_parent_task_explicitly` from the consumed summary, never exposes stale continuation child handles from older cycles, and remains read-only: it appends no TaskRunning event, consumes no parent join state, records no handoff envelope, creates no child TaskRecord, runs no child task, exposes no raw child or parent data, and adds no diagnostics RPC or scheduler handoff behavior.

Parent run.inspect and parent task.inspect can expose the same consumed parent-join recovery through the nested `run.consumed_parent_join_recovery_summary` when a completed parent run has already consumed a terminal controlled child result set. The parent-scoped summary omits inspected-child fields and reports only bounded parent task/run ids, `parent_join_consumed=true`, consumed terminal controlled child count, continuation runnable/non-runnable/terminal counts, continuation child task ids, `parent_running_enabled=false`, and one next explicit action. It reports `run_continuation_child_tasks_explicitly` only for runnable continuation handles, `inspect_non_runnable_continuation_child_tasks` when any continuation child is `Running` or `Cancelled`, and `inspect_parent_task` when no continuation handles are recoverable from the latest consumed join. Parent inspection never reports `run_parent_task_explicitly` from the consumed summary, scopes continuation handles to the latest relevant consumed join, and remains read-only: it appends no TaskRunning event, consumes no parent join state, records no handoff envelope, creates no child TaskRecord, runs no parent or child task, exposes no raw child or parent data, and adds no diagnostics RPC or scheduler handoff behavior.
