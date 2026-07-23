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
