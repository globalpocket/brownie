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

## Runtime LLM Provider Execution Boundary

M13.1 makes controlled provider failures an actionable `task.run` outcome. When
real-provider selection or completion fails under strict execution, the Rust
runtime still marks the task terminal `Failed`, but now returns bounded
`llm_provider_failure` metadata on `TaskRunResult` and records the same
classification on `LlmRequestFailed` or `SecondPassLlmRequestFailed` events.
The outcome includes provider kind, model, request phase, deterministic failure
class, retryability, next action, failure fingerprint, and a bounded redacted
reason preview.

This boundary covers configuration, task-run network authorization, sensitive
prompt denial, non-2xx HTTP status, transport/timeout, invalid provider JSON,
and missing provider content classes. Replaying `task.run` for the same failed
task returns the same structured failure outcome without appending duplicate
`TaskRunning` or provider request events. The VSIX mirrors the protocol shape
but does not own provider policy.

The provider failure outcome must not expose raw prompts, raw provider
responses, raw request bodies, file content, stdout, stderr, commands,
environment values, API keys, secrets, absolute paths, or canonical paths. It
does not add a provider report, status wrapper, history, digest, readiness
surface, automatic retry, or network/sensitive-guard bypass.

M13.2 adds the first runtime-owned retry admission step for those structured
provider failures. A caller may pass `llm_provider_failure_retry_source` to the
existing `task.start` method with source task/run IDs, the expected current
`failure_fingerprint`, and `authorize_provider_failure_retry=true`. The runtime
requires the source task to be terminal `Failed`, re-reads the source run ledger,
requires the latest bounded `llm_provider_failure` evidence to match the
expected fingerprint, and admits only retryable classes such as `http_status`,
`transport_or_timeout`, `invalid_provider_response`, `missing_provider_content`,
or retryable `unknown_provider_failure`.

Admission creates or replays exactly one retry task and records bounded
`llm_provider_failure_retry_provenance` on the retry task's `TaskStarted` event.
It returns `llm_provider_failure_retry_admission` with source IDs, retry IDs,
failure class, fingerprint, `retry_running_enabled=false`, replay state, and
`next_action=run_llm_provider_retry_task_explicitly`. Admission itself does not
call a provider, append `TaskRunning`, automatically execute the retry task,
bypass provider network or sensitive prompt guards, or expose raw prompts,
provider responses, request bodies, file content, command output, environment
values, secrets, absolute paths, or canonical paths.

M13.3 closes the explicit retry execution boundary. When a caller later runs a
retry task that carries `llm_provider_failure_retry_provenance`, `task.run`
revalidates that stored provenance against the current source task and source
run ledger before appending `TaskRunning` or making any provider request. Stale,
missing, malformed, or currently non-retryable source failure evidence is denied
before provider execution. Valid retry tasks proceed through the existing task-run
provider path, so task-run network authorization, sensitive prompt scanning,
request budgets, strict/fallback behavior, and provider selection remain
unchanged. Replaying a terminal retry task reuses the existing terminal replay
path without duplicate `TaskRunning` or provider failure events.

M15.2 adds a runtime permission check to that provider boundary. Before strict
OpenAI-compatible `task.run` may enter real-provider execution, the Rust runtime
revalidates the running task's resolved mode policy for `AccessNetwork`. The
process-level task-run network guard, provider configuration, request budget,
and sensitive prompt guard still apply; the new check binds the external
provider side effect to runtime mode permission at the point of use. Modes that
lack `AccessNetwork`, or missing/malformed mode evidence, fail closed with
bounded provider-failure metadata before provider request/response ledger
evidence or an external provider hit. Fake-provider and non-strict fallback
paths remain no-network-compatible.

## R1 architecture recovery

R1 freezes the Phase 3 diagnostics wrapper chain and redirects follow-up work to diagnostics API consolidation. New phases must not extend the `proposal.reviewQueueDiagnostics...Digest...Report...History` pattern.

See `docs/architecture/diagnostics-api-consolidation.md`, `docs/architecture/phase-value-gate.md`, `docs/architecture/phase-value-manifest.json`, and `docs/architecture/diagnostics-legacy-api-metadata.json` for the inventory, deprecation plan, value/review guard, and R1.1 enforcement metadata.

## Controlled Apply Boundary

Patch proposal generation remains a dry-run `workspace.write` path: tool intent parsing and task execution do not directly modify files. Beginning with M6.1, the runtime-owned `proposal.apply` RPC is the only workspace mutation path. M6.1 supports one approved `replace_file` proposal for one existing regular UTF-8 file with explicit authorization, approval freshness, expected target SHA-256 verification, latest preflight validation, protected-path denial, parent traversal denial, symlink rejection, temporary sibling writes, atomic replacement, post-write SHA-256 verification, and a bounded apply-result ledger event.

M6.2 extends the same `proposal.apply` authority to one approved `create_file` proposal for one absent target in an existing safe parent directory. Create-file apply requires `authorize=true`, current unconsumed approval, `expected_target_absent=true`, a fresh latest preflight proving absence, parent directory and symlink checks, no-overwrite atomic creation from a temporary sibling file, post-write SHA-256 verification, and the same bounded apply-result ledger event shape.

M6.3 extends the same `proposal.apply` authority to one approved `delete_file` proposal for one existing regular UTF-8 workspace file. Delete-file apply requires `authorize=true`, current unconsumed approval, caller-provided `expected_target_sha256`, omitted replacement content, a fresh latest preflight proving the target remains the approved regular non-symlink file, bounded removal, parent directory sync when possible, post-delete absence verification, and the same bounded apply-result ledger event shape.

M25.1 extends the same Rust-owned apply authority to one approved `patch_file` proposal for an existing regular UTF-8 workspace file. The proposal is created from request-only `old_text` and `new_text` hunk fields, requires the old text to match exactly once during proposal validation, records only `hunk_count` and a SHA-256 hunk fingerprint, and omits raw hunk text from ledger evidence. Apply revalidates the approved fingerprint, current approval, expected target SHA-256, latest preflight, safe path, non-symlink file kind, UTF-8 content, and exact single-hunk context before using the existing temporary sibling and atomic replacement path with post-write SHA-256 verification.

M26.1 extends that patch authority to one approved multi-hunk `patch_file`
proposal for one existing regular UTF-8 workspace file. The proposal accepts a
request-only `hunks` list of two to five old/new text hunks, requires every old
text to match exactly once, rejects overlapping hunk ranges, records only
`hunk_count` and an aggregate SHA-256 hunk fingerprint, and keeps raw hunk text
out of ledger evidence. Apply requires caller-provided `patch_hunks`, revalidates
the aggregate fingerprint, current approval, expected target SHA-256, latest
preflight, safe path, non-symlink file kind, UTF-8 content, and all exact
non-overlapping hunk contexts before constructing one patched file body in memory
and using the existing temporary sibling and atomic replacement path.
M27.1 adds patch apply failure recovery admission. A caller may pass bounded `patch_apply_recovery_source` evidence to `task.start` for a latest recoverable failed `patch_file` apply result. The runtime validates source run/proposal/apply IDs, expected apply and failure fingerprints, operation, recoverable failure class, and explicit authorization before creating or replaying one recovery task. Explicit `task.run` revalidates the same source evidence before running and marks any generated `workspace.write` proposal as `patch_apply_recovery_repair` with bounded source IDs, fingerprints, failure class, hunk count, and hunk fingerprint. It does not apply the proposal, approve it, run verifiers, expose raw hunk text or file content, or add a report/readiness/history wrapper.

M27.1.1 hardens that recovery primitive before headless routing. Patch apply recovery source evidence must be a strict latest denied `patch_file` apply receipt for the same proposal, with `applied=false`, `authorization_consumed=false`, exactly one recoverable failed check, no blocked checks, a safe normalized workspace-relative source path, a hunk count from one to five, and a valid SHA-256 hunk fingerprint. Older failed apply receipts are rejected after any newer apply result for the same proposal. Recovery-scoped proposal marking and repair-gate replay both require the generated proposal path to normalize to the source path. Unrelated-path proposals, malformed paths, malformed hunk metadata, blocked receipts, and multi-failure receipts fail closed without workspace mutation.

M27.2 routes that exact-source patch recovery primitive through `headless.continue_once`. A caller may provide fresh progress evidence plus bounded `patch_apply_recovery_source` to admit or replay one recovery task, or provide a current `patch_apply_recovery_run_target` with recovery task/run IDs, source run/proposal/apply IDs, expected source apply and failure fingerprints, and `authorize_patch_apply_recovery_run=true` to run the admitted recovery task exactly once through the existing `task.run` path. The runtime rejects stale aggregate progress before admission or execution, revalidates the exact M27.1.1 source/provenance evidence before running, records bounded continuation decisions, and routes successful repair output to `review_and_authorize_recovery_proposal`. Replay of the same continuation returns the same admission or task-run result without duplicating running, proposal, decision, or terminal task evidence. The continuation does not approve or apply recovery proposals, mutate workspace files, execute shell/git/network/service actions, expose raw file or patch content, or move policy into the VSIX.

M28.1 extends that continuation boundary from proposal review to approved patch
recovery apply. A caller may provide `patch_apply_recovery_apply_target` to
`headless.continue_once` for one approved recovery-scoped `patch_file` proposal
that originated from the targeted M27 recovery task/run. The runtime requires
fresh aggregate progress, explicit `authorize_patch_apply_recovery_apply=true`,
source run/proposal/apply IDs, recovery task/run/proposal IDs, expected source
apply and failure fingerprints, expected target SHA-256, and request-only patch
hunk payload. It revalidates M27 exact-source provenance and recovery proposal
scope before delegating mutation to existing `proposal.apply`. Successful apply
records bounded continuation evidence with source/recovery/proposal/apply
handles and returns the existing bounded apply result plus an inspect-progress
route. Replay of the same continuation returns the already-recorded apply result
without reapplying or duplicating apply, continuation, task, or proposal events.
This phase does not add a new RPC, approve proposals automatically, apply
without explicit authorization, duplicate mutation policy in the headless layer,
or expose raw file content, raw hunks, raw diffs, prompts, provider responses,
command output, environment, absolute paths, canonical paths, or secrets.


Controlled apply must not run shell or git commands, use network access, create parent directories, overwrite existing targets during create, remove files outside the approved `delete_file` path, mutate directories, perform multi-file transactions, expose canonical paths or absolute paths, or return/store raw file content, raw diffs, raw input JSON, stdout, stderr, environment values, or secrets. Failure paths should preserve the original file or absent target whenever possible, clean partial temporary files, and must not consume apply authorization before successful atomic mutation and verification.

M14.1 adds the first bounded multi-file mutation path to the same
`proposal.apply` authority for two to five approved `replace_file` proposals.
M23.1 extends that transaction boundary to two to five approved `create_file`
proposals. The Rust runtime admits only homogeneous create transactions, requires
per-item `expected_target_absent=true`, revalidates latest absence preflights and
safe existing parents, rejects symlinks and overlaps, prepares temporary sibling
files before target creation, uses no-overwrite atomic create, verifies per-item
post-write SHA-256 values, and records bounded transaction result evidence
without raw file content or raw diffs.
M24.1 extends the same transaction boundary to two to five approved
`delete_file` proposals. The Rust runtime admits only homogeneous delete
transactions, requires per-item expected target SHA-256 values, revalidates
latest preflights and current regular UTF-8 non-symlink targets, rejects unsafe
or overlapping paths, deletes only approved targets, syncs parent directories
where possible, verifies post-delete absence per item, and records bounded
transaction evidence without raw file content or raw diffs.
M14.2 adds bounded recovery for that transaction path. A caller may include
`transaction_recovery_source` with source run, apply, transaction, and expected
source fingerprint fields plus a recovery `transaction_items` set. The Rust
runtime re-reads latest transaction result ledger evidence, admits only partial
failed source transactions, verifies already-applied source items still match
their recorded post-write hashes, rejects already-recovered sources, and then
applies only eligible failed or not-applied replacement proposals through the
same temporary sibling, atomic replacement, and post-write SHA-256 checks.

Transaction recovery does not add a recovery report, preview, history, digest,
readiness surface, new RPC, automatic recovery, rollback of already-applied
files, create/delete/mixed transaction scope, shell/git/network/test/service
execution, or VSIX-owned policy. Ledger and RPC results expose only bounded
source transaction metadata, recovery status, per-item hashes and counts, and
check names; they must not contain raw file content, raw replacement content,
raw diffs, raw request bodies, raw ledger payloads, absolute paths, canonical
paths, stdout, stderr, command strings, environment values, provider responses,
prompts, or secrets.

M15.1 hardens the same side-effecting `proposal.apply` authority with apply-time
`WriteWorkspace` permission revalidation. After explicit apply authorization is
present, but before authorization can be consumed or any temporary file, atomic
replacement, deletion, transaction item, or recovery write can occur, the Rust
runtime reconstructs the source run's stored mode policy and checks
`RuntimeAction::WriteWorkspace`. Missing, malformed, unknown, or read-only mode
evidence fails closed. The runtime records bounded `PermissionChecked` and, on
denial, `PermissionDenied` evidence with only mode ID, required action, decision,
reason, apply/proposal identifiers, and operation class.

Apply-time permission revalidation does not add a new RPC, readiness report,
history, digest, preview, inspection surface, VSIX-owned policy, or new mutation
operation. It preserves existing approval, preflight, hash, path, file-kind,
symlink, content-bound, sensitive-scan, transaction, recovery, temporary sibling,
atomic write, and post-write verification gates after permission passes.

## Controlled Verification Boundary

M7.1 introduces the first runtime-owned verification execution path. The built-in `verification.cargo_fmt_check` tool is the only executable verifier in this slice: it requires `ExecuteProcess` permission, runs exactly `cargo fmt --check` at the workspace root, rejects caller-supplied command, argv, cwd, environment, stdin, shell, timeout, or unknown fields, and reports bounded status metadata through `tool.execute` and task-scoped `ToolExecution*` ledger events.

M7.2 extends that fixed-verifier model with `verification.cargo_check`. The tool requires `ExecuteProcess`, accepts only `{}` or `{ "check_id": "cargo_check" }`, runs exactly `cargo check --workspace --all-targets --locked --offline`, requires workspace `Cargo.toml` and `Cargo.lock`, rejects workspaces containing `build.rs` in this phase, uses a runtime-owned isolated Cargo target directory outside the workspace, sets Cargo dependency-fetch offline mode, removes the isolated target directory after execution, and records only bounded verifier metadata.

M29.1 adds `verification.cargo_test` as the next fixed verifier. It requires `ExecuteProcess`, accepts only `{}` or `{ "check_id": "cargo_test" }`, runs exactly `cargo test --workspace --all-targets --locked --offline`, requires workspace `Cargo.toml` and `Cargo.lock`, uses a runtime-owned isolated Cargo target directory outside the workspace, sets Cargo dependency-fetch offline mode, removes the isolated target directory after execution, and records only bounded verifier metadata. Because this verifier executes trusted workspace test code, it reports `test_code_executed=true` on launched runs and does not claim OS network isolation or compile-time sandboxing.

M7.3 makes requested controlled verifier evidence a `task.run` completion gate. Before recording `AgentLoopCompleted` and the terminal task event, the runtime re-reads the current run ledger, derives the required verifier set from task-scoped `verification.cargo_fmt_check`, `verification.cargo_check`, and `verification.cargo_test` intents, and requires each requested verifier to have a fresh terminal `ToolExecutionCompleted` event with `verification_status = "Passed"`. Denied, rejected, failed, timed-out, spawn-failed, missing, malformed, or stale verifier evidence turns the task terminal status into `Failed` and records bounded `verification_completion_gate_*` metadata on the terminal task event and `TaskRunResult`.

M8.1 turns terminal failed verifier-gate evidence into an explicit recovery task admission path on the existing `task.start` RPC. A caller may provide `verification_recovery_source` with source task/run IDs, an expected failure fingerprint, and `authorize_recovery=true`. The Rust runtime re-reads the source task and ledger, requires the source to be terminal `Failed` because of a current failed verification completion gate, verifies the fingerprint, and then creates or replays exactly one `Created` recovery task/run for that failure fingerprint. Recovery admission records bounded `verification_recovery_provenance` on the task record and recovery `TaskStarted` event, returns bounded `verification_recovery_admission` metadata with `recovery_running_enabled=false` and `next_action=run_recovery_task_explicitly`, and does not run the recovery task.

M8.2 allows that admitted recovery task to be run explicitly through the existing `task.run` RPC. Before appending `TaskRunning`, the runtime re-reads the source task and source run ledger, revalidates the stored recovery provenance against the latest failed verifier-gate evidence, and rejects stale recovery tasks. During the recovery run, approved `workspace.write` intent still goes through the existing permission gate and dry-run proposal path, creating at most one recovery-scoped `WorkspacePatchProposed` event annotated with bounded source task/run IDs, recovery task/run IDs, the failure fingerprint, and failed verifier tool IDs. R3.2 makes the repair handoff fail closed: `task.run` returns bounded `verification_recovery_repair` metadata with `gate_status=Passed`, the proposal handle, proposal count, `apply_enabled=false`, and `next_action=review_and_authorize_recovery_proposal` only when exactly one valid recovery-scoped proposal exists. Missing, ambiguous, invalid-provenance, or not-applicable repair proposals force terminal `TaskFailed` and return `gate_status=Failed`, a bounded `failure_reason`, proposal count, and `next_action=inspect_recovery_repair_gate_failure`; replay returns the same bounded outcome without duplicating `TaskRunning` or `WorkspacePatchProposed`. A failed repair-gate attempt is not replay-locked forever: a later `task.start` with the same source failure fingerprint may admit a fresh recovery task so corrected mode or goal inputs can produce an applicable proposal. This phase does not apply patches, retry verifiers, run shell/git/network/service actions, or expose raw output, commands, prompts, file content, paths, environment values, or raw request bodies.

M8.3 lets the caller continue after an approved recovery proposal has been applied through `proposal.apply`. `task.start` may include `verification_recovery_retry_source` with source task/run IDs, recovery task/run IDs, proposal/apply IDs, expected failure and apply fingerprints, and `authorize_verification_retry=true`. The runtime revalidates the latest source failure evidence, recovery task provenance, recovery-scoped proposal evidence, and successful apply result before creating or replaying one retry task for that source/recovery/proposal/apply tuple. Explicit `task.run` on the retry task revalidates the same evidence before appending `TaskRunning`, executes exactly the failed M7 verifier tool IDs through existing `ExecuteProcess` permission checks and controlled verifier executors, returns bounded `verification_recovery_retry` outcome metadata, and replays terminal retry outcomes without duplicate `TaskRunning`, `ToolExecutionRequested`, or terminal tool evidence. R3.2 additionally binds retry verifier evidence to a runtime-owned requirement derived from retry/apply provenance; generated verifier events and the completion gate carry a bounded requirement ID, source kind, source apply ID, and SHA-256 requirement fingerprint. Retry execution does not create proposals, apply patches, mutate the workspace, run generic shell/git/network/service actions, expose raw command output, or accept caller-supplied verifier commands.

R3.3 makes failed `verification.cargo_check` recovery actionable without raw log exposure. The controlled verifier runs Cargo with structured JSON output, keeps captured stdout/stderr internal to the verifier, and emits at most five `bounded_cargo_diagnostics` entries with tool ID, check ID, diagnostic kind, severity, optional code, normalized workspace-relative path, line, column, and truncation state. The runtime sanitizes those entries before ledger insertion, includes them on failed verification completion gates and `VerificationRecoveryProvenance`, and materializes them into recovery prompts. It must not persist raw stdout/stderr, rendered compiler diagnostics, source snippets, commands, environment values, absolute or canonical paths, file content, provider responses, or raw prompt text.

M30.1 extends the same bounded diagnostic path to failed launched `verification.cargo_test` runs. The verifier keeps raw test output internal, derives at most five `bounded_cargo_diagnostics` entries with `tool_id=verification.cargo_test`, `check_id=cargo_test`, bounded diagnostic kind, severity, deterministic `test_name_hash`, optional sanitized workspace-relative panic location, and truncation state, and never persists raw test names, rendered panic text, assertion values, stdout, stderr, commands, environment, absolute paths, canonical paths, or file content. The runtime reuses the existing sanitizer, ledger payload, failed verification completion gate, recovery provenance, and recovery prompt materialization paths; no new RPC, report, digest, history, readiness, preview, capability, or inspection surface is added.

M31.1 lets an admitted verification recovery `task.run` explicitly authorize one diagnostic-guided workspace context read from its current `VerificationRecoveryProvenance`. The runtime revalidates the source task/run, expected failure fingerprint, current provenance, `ReadWorkspace` permission, sanitized workspace-relative path, existing regular UTF-8 file kind, symlink rejection, and byte budget before reading. The selected excerpt is injected only into the in-memory recovery prompt. Ledger events and `TaskRunResult.verification_recovery_context_read` store only bounded metadata, hashes, line ranges, byte counts, redaction status, replay status, and `next_action=run_recovery_task_with_context`; they never store raw excerpts, file content, prompts, provider responses, stdout/stderr, commands, environment values, absolute paths, canonical paths, or secrets. Replay reconstructs the bounded summary without rereading file content or duplicating context evidence.

M18.1 extends `headless.continue_once` across the failed-verifier recovery admission boundary. A headless caller may provide bounded `verification_recovery_source` evidence with `authorize_recovery=true`; the runtime still rejects stale progress first, reuses the existing M8.1 recovery admission validator, creates or replays exactly one recovery task, records a bounded continuation decision, and returns `next_route.kind=run_recovery_task_explicitly`. The continuation does not run the admitted recovery task, create proposals, apply patches, execute verifiers, call providers, mutate workspace files, schedule background work, or move policy into the VSIX.

M18.2 extends `headless.continue_once` across the next recovery boundary. A headless caller may provide bounded `verification_recovery_run_target` evidence with recovery task/run IDs, source task/run IDs, an expected failed-verifier fingerprint, and `authorize_recovery_run=true`. The runtime rejects stale aggregate progress before execution, validates the targeted recovery task is current, created or queued, and still carries matching verification recovery provenance, then delegates to the existing M8.2 recovery `task.run` path exactly once. Successful repair-gate execution returns the bounded `verification_recovery_repair` task result and routes to `review_and_authorize_recovery_proposal`; replaying the same `continuation_id` returns the same task run result without duplicating `TaskRunning`, `WorkspacePatchProposed`, `HeadlessContinuationDecisionRecorded`, or terminal task evidence. The continuation does not apply proposals, retry verifiers, call providers, run shell/git/network/service actions, schedule background work, expose raw data, or move policy into the VSIX.

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

## External Mode Pack Execution Policy Boundary

M12.1 lets external Mode Pack modes constrain `subtask.spawn` handoff targets
with bounded `allowed_handoff_targets`, and the Rust runtime denies unknown or
unlisted requested child mode ids before subtask queueing or child
materialization.

M12.2 extends that runtime boundary to controlled child execution. Children
materialized from external Mode Pack handoff envelopes carry bounded
`external_modepack_child_provenance` in their `TaskStarted` evidence. Before a
queued child can enter `TaskRunning`, `task.run` validates the current external
Mode Pack child policy fingerprint against the captured provenance. Missing,
malformed, stale, or mismatched provenance is denied before LLM/provider/tool
work. Built-in parent/child behavior remains compatible when no external Mode
Pack handoff provenance is required.

M21.1 extends execution-time policy revalidation to direct tasks started from a
workspace Mode Pack mode. `task.start` records bounded
`external_modepack_task_provenance` in the `ModeResolved` event for direct
external modes, including only the source kind, modepack name, schema version,
`.brownie/modepack.json` source token, mode id, and policy fingerprint. Before
`task.run` can append `TaskRunning`, the runtime re-reads the current workspace
Mode Pack and requires the captured policy fingerprint to match. Deleted,
malformed, or changed Mode Pack policy is denied with bounded
`ExternalModePackTaskProvenanceDenied` evidence before provider, tool,
workspace, or child-materialization behavior. Built-in mode tasks and M12.2
external child provenance remain on their existing paths.

M12.4 binds that direct-task path to active Mode Pack snapshots. When
`task.start` resolves an external mode from a runtime-owned active snapshot, the
stored provenance includes the active snapshot source kind, source token,
policy fingerprint, and activation fingerprint. Before `task.run` enters
`TaskRunning`, Rust re-reads the current active snapshot and requires those
bounded identifiers to match. Active replacement, rollback, missing modes,
malformed provenance, or policy/activation fingerprint mismatch is denied before
provider, tool, workspace, verifier, or child-materialization side effects.
Legacy live-workspace Mode Pack tasks keep the existing live-file revalidation
path, and built-in modes are unaffected.

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

M11.2 makes `headless.continue_once` replay-safe for callers that lose a
response after the runtime records a continuation decision. When a bounded
`continuation_id` already has `HeadlessContinuationDecisionRecorded` evidence,
the Rust runtime returns `replayed=true` with the same selected task/run handles
and does not append another decision or `TaskRunning` event. Terminal selected
tasks return bounded reconstructed `TaskRunResult` evidence when available;
still-running selected tasks return `task_in_progress`. Every replay and
post-step execution result includes one bounded `next_route` describing the next
explicit caller action, such as inspect progress, start verifier recovery,
review a recovery proposal, start verification retry, or run a parent task. The
route is metadata only and never executes recovery, apply, verifier, parent
join, shell, git, network, service, scheduler, or loop actions.

M16.1 extends the same headless continuation authority across one post-apply
verification boundary. A caller may include bounded
`verification_recovery_retry_source` evidence, `authorize_verification_retry =
true`, and current aggregate progress handles in `headless.continue_once`. The
runtime rejects stale progress before any retry admission, reuses the existing
M8.3 source/recovery/proposal/apply validation, and creates or replays exactly
one verification recovery retry task. The response routes the caller to
`run_verification_retry_task_explicitly`; it does not apply proposals, run the
retry task, execute verifiers, call providers, mutate files, schedule a loop, or
move policy into the VSIX.

M16.2 lets that retry route execute under the same continuation contract. A
caller may include bounded `verification_recovery_retry_run_target` evidence
with retry task/run IDs, proposal/apply IDs, expected failure and apply
fingerprints, and `authorize_verification_retry_run = true`. The runtime checks
current aggregate progress before `TaskRunning`, requires the target to be the
already-admitted retry task with matching provenance, and delegates to the
existing `task.run` retry execution path. The response returns the bounded
`verification_recovery_retry` outcome and next route. Replay returns the same
terminal retry outcome without duplicate continuation decisions, `TaskRunning`,
verifier request, or terminal tool evidence. M16.2 does not create another
retry task, apply proposals, mutate files, run providers, start recovery
automatically, schedule a loop, or move policy into the VSIX.

M17.1 adds `headless.run.advance` for runtime-owned headless run sessions. A
caller supplies `authorize=true`, a bounded `session_id`, expected session
sequence, optional `advance_id`, and for the first sequence the current
`task.list.progress_overview` fingerprint and aggregate sequence. The runtime
derives per-step continuation IDs, executes up to three existing
`headless.continue_once` steps, writes bounded `HeadlessRunSessionAdvanced`
evidence for executed steps, persists a session checkpoint, and lets the next
sequence advance from that checkpoint without caller-reconstructed raw progress
handles. Repeating a committed sequence returns the checkpoint with
`replayed=true` and does not duplicate `TaskRunning` or run-session evidence.
The method remains explicit caller-driven work: it adds no scheduler,
background worker, automatic apply/recovery, provider execution expansion,
shell/git/network/service expansion, VSIX-owned policy, or raw prompt/provider/
file/command/output/environment/path exposure.

M17.2 adds `headless.run.drive` as a bounded drive-to-stop-boundary primitive
for an existing M17.1 session checkpoint. A caller explicitly authorizes one
`drive_id`, names the session, supplies the expected current session sequence,
and sets a small `max_advances` and per-advance step budget. The Rust runtime
derives subsequent session sequences, invokes existing `headless.run.advance`
behavior, persists a replay-safe drive checkpoint, and stops when the drive
budget is exhausted or when the next route leaves the safe progress overview
continuation boundary. Replaying the same drive id returns the persisted drive
result without duplicating `TaskRunning`, `HeadlessRunSessionAdvanced`, or drive
evidence. This remains explicit caller-driven work and does not add a
scheduler, background worker, automatic recovery/apply, provider expansion,
shell/git/network/service expansion, VSIX policy, or raw data exposure.

M50.1 adds the first runtime-owned golden-journey admission boundary to the same
drive method. When a caller supplies `expected_start_session_sequence=0` plus a
bounded `journey_admission`, Rust validates the journey id, explicit
authorization, task-start envelope, empty-session expectation, budgets, and
route exclusivity before creating a task. The task is created through existing
`task.start` authority, then driven through existing run-control behavior to the
first safe stop boundary. The store persists a bounded journey checkpoint and
the drive result returns bounded `journey` metadata: journey/task/run/session/
drive handles, start/post progress fingerprints and aggregate sequences,
closure status, next action, replay state, and deterministic fingerprint.
Matching replay returns the committed journey without duplicate task, advance,
drive, or journey evidence; conflicting admission fails closed without creating
a new task. This does not add a new RPC, scheduler, generic workflow engine,
automatic apply/recovery/provider/Mode Pack/parent-join step, shell/git/
network/service action, VSIX-owned policy, or raw prompt/provider/file/command/
output/environment/path exposure.

M50.2 extends `headless.run.drive` with one bounded `journey_route_resume`
envelope for an already-admitted journey whose current route is
`FetchSelectedModePackCandidateExplicitly`. The caller supplies explicit resume
authorization, the journey id, expected journey fingerprint, expected current
session sequence, route kind, drive id, and expected source registry-selection
checkpoint fingerprint. The Rust runtime rejects mixed caller-supplied Mode
Pack targets, journey admission, context budgets, completion finalization, stale
fingerprints, missing checkpoints, and unsupported route kinds before side
effects. For the supported route, it derives
`modepack_selected_candidate_fetch_target` from persisted registry-selection
evidence, delegates execution to existing run-control continuation authority,
persists bounded route-resume ledger evidence, and returns
`journey_route_resume` metadata. Replaying the same drive id and resume identity
returns the committed metadata without duplicating fetch, drive, or resume
evidence. The metadata is limited to bounded handles, route kind, source
checkpoint fingerprint, derived target class, result advance/continuation ids,
post-route progress, replay state, next action, and resume fingerprint.

M50.3 extends the same `journey_route_resume` envelope to the next supported
Mode Pack boundary, `VerifySelectedModePackCandidateProvenanceExplicitly`. The
caller supplies explicit resume authorization, journey identity, expected
journey fingerprint, expected current session sequence, expected route kind,
drive id, and expected selected-candidate fetch checkpoint fingerprint. The
successful request must not include a caller-built provenance verification
target. Rust derives `modepack_selected_candidate_provenance_verification_target`
from persisted selected-candidate fetch checkpoint evidence, revalidates the
latest progress and checkpoint fingerprint before route side effects, delegates
to existing continuation authority, persists bounded route-resume evidence, and
returns the same bounded `journey_route_resume` metadata shape with
`derived_target_class` set to
`modepack_selected_candidate_provenance_verification_target`. Replay of the same
drive and resume identity returns committed metadata without duplicating
provenance verification, advance, drive, or route-resume evidence. RPC and
ledger surfaces must not expose raw provenance statements, signatures, public
keys, Mode Pack payloads, prompts, file content, commands, outputs,
environment values, or raw paths.

M50.4 extends `journey_route_resume` to
`ApproveVerifiedModePackCandidateExplicitly`, the next Mode Pack boundary after
runtime-derived provenance verification. The successful request supplies
explicit resume authorization, journey identity, expected journey fingerprint,
expected current session sequence, expected route kind, drive id, and expected
selected-candidate provenance-verification checkpoint fingerprint. It does not
include a caller-built `modepack_selected_candidate_approval_target`. Rust
loads the provenance-verification checkpoint, verifies it matches the latest
session progress, loads the referenced selected-candidate fetch checkpoint,
checks provenance/fetch evidence consistency, derives
`modepack_selected_candidate_approval_target`, delegates to existing
continuation authority, persists bounded route-resume evidence, and returns the
same bounded metadata shape with `derived_target_class` set to
`modepack_selected_candidate_approval_target`. Replay of the same drive and
resume identity returns committed metadata without duplicating approval, drive,
or route-resume evidence. RPC and ledger surfaces remain bounded to handles,
hashes, fingerprints, route classes, replay state, and next actions; raw Mode
Pack payloads, provenance material, prompts, provider data, file content,
command output, environment values, secrets, and raw paths stay out of
route-resume responses and ledger payloads.

M50.5 extends `journey_route_resume` to
`ReplaceActiveWithApprovedModePackCandidateExplicitly`, the first active Mode
Pack mutation boundary after runtime-derived approval. The successful request
supplies explicit resume authorization, journey identity, expected journey
fingerprint, expected current session sequence, expected route kind, drive id,
and expected selected-candidate approval checkpoint fingerprint. It does not
include a caller-built
`modepack_selected_approved_candidate_replacement_target`. Rust loads the
approval checkpoint, verifies it matches the latest session progress, loads the
referenced provenance-verification and fetch checkpoints, checks approval /
provenance / fetch evidence consistency, derives the approved-candidate
replacement target, delegates to existing replacement continuation authority,
persists bounded route-resume evidence, and returns the same bounded metadata
shape with `derived_target_class` set to
`modepack_selected_approved_candidate_replacement_target`. Replay of the same
drive and resume identity returns committed metadata without duplicating active
replacement, candidate consumption, drive, or route-resume evidence. RPC and
ledger surfaces remain bounded to handles, hashes, fingerprints, route classes,
replay state, and next actions; raw Mode Pack payloads, provenance material,
prompts, provider data, file content, command output, environment values,
secrets, and raw paths stay out of route-resume responses and ledger payloads.

M50.6 adds a bounded `journey_closure` envelope on existing
`headless.run.drive` so the Rust runtime can close a Golden Journey from the
approved-candidate replacement evidence produced by M50.5. The request supplies
explicit closure authorization, journey identity, expected journey fingerprint,
source replacement drive id, expected replacement resume fingerprint, expected
current session sequence, unit budgets, and an explicit drive id. Rust loads the
journey checkpoint, source replacement drive checkpoint, referenced selected
approved candidate replacement checkpoint, and current active Mode Pack
snapshot; verifies replacement route kind, resume fingerprint, committed
replacement and candidate consumption evidence, active activation fingerprint,
complete progress closure, no remaining routes, and terminal completion
evidence; then records bounded completion finalization and
`HeadlessJourneyClosed` evidence. Replay returns the committed closure metadata
without duplicating finalization or closure ledger events. The closure path is
not a new RPC and rejects journey admission, route resume, caller-supplied Mode
Pack targets, context budgets, completion-finalization bypass fields, non-unit
budgets, stale evidence, and raw payload exposure.

M50.7 adds bounded Golden Journey execution checkpointing to the same
`headless.run.drive` method through `journey_execution`. The Rust runtime can
admit the initial journey from a bounded task-start envelope, continue from an
already-admitted journey using its expected fingerprint, derive the next
supported Golden Journey boundary from persisted session and Mode Pack
checkpoints, and persist `HeadlessJourneyExecutionCheckpoint` evidence after
each committed boundary. A restarted caller can resubmit the same authorized
execution or include the latest execution checkpoint fingerprint; the runtime
then returns or continues from committed evidence without caller-owned
per-boundary drive ids, source checkpoint fingerprints, route-resume envelopes,
closure envelopes, or explicit Mode Pack targets. The execution result and
ledger evidence expose only bounded handles, boundary classes, route kinds,
drive and execution fingerprints, replay state, completion state, and next
action, never raw prompts, provider responses, Mode Pack payloads, provenance
material, file content, command output, environment values, secrets, absolute
paths, or canonical paths.

M50.8 closes the interrupted-boundary reconciliation gap in that execution
path. Before selecting new work, `journey_execution` now scans committed child
drive checkpoints for the Golden Journey fetch, provenance, approval,
replacement, and closure boundaries, validates their journey identity, route
kind, child drive id, sequence, and SHA-256 source/resume evidence, and then
advances the outer execution checkpoint from that bounded persisted metadata.
Recovering the closure checkpoint marks the task complete if needed and appends
`HeadlessJourneyExecuted` idempotently, so a restarted headless caller can
resubmit the same authorized execution after a process interruption without
caller-owned per-boundary envelopes or duplicate side effects.

M11.3 extends the same method with an optional caller-authorized
`max_steps` budget from 1 to 3. A budget greater than 1 requires a
`continuation_id`; the runtime derives per-step continuation ids, executes or
replays each step through the existing one-step contract, refreshes expected
progress handles only from the prior step's post-run overview, and stops when
the budget is exhausted or when the next route leaves `inspect_progress_overview`.
The bounded result includes step count, executed count, replayed count, stop
reason, and per-step summary metadata. It remains explicit caller-driven work:
it does not add a scheduler, background loop, recovery execution, proposal
apply, verification retry, parent join execution, shell/git/network/service
actions, or VSIX-owned continuation policy.

M12.1 adds Rust-owned handoff target admission for external Mode Pack modes that
request `can_spawn_subtasks`. `brownie-modepack` compiles a bounded
`allowed_handoff_targets` list into `CompiledModePolicy`, `ModeResolved` persists
that policy snapshot, and `task.run` reconstructs it before evaluating
`subtask.spawn` tool intents. The existing permission gate still decides whether
the active mode may spawn subtasks at all; the new admission step denies an
unknown or non-allow-listed requested `input.mode_id` before any
`SubtaskOrchestrationQueued` event or controlled child `TaskRecord` can be
created. Denial evidence records only active mode id, requested mode id, reason,
request reason, required action, and bounded input summary. Built-in modes keep
their current behavior because they do not declare an allow-list.

Generic `process.exec` remains listed as a non-executable planning surface. The runtime denies it even for modes that may execute controlled verifiers. Verifier results expose only check id, verifier status, launch/timeout flags, exit code, duration, byte counts, truncation flags, redaction status, and bounded reason strings. Cargo-backed verifiers may additionally expose bounded safety metadata such as isolated target cleanup, offline Cargo dependency fetch, no OS network isolation guarantee, no compile-time sandbox guarantee, trusted workspace requirement, and for `verification.cargo_test` whether workspace test code actually executed. They must not expose raw stdout, stderr, command strings, environment values, stdin, raw input JSON, file content, canonical paths, absolute paths, shell execution, git execution, network access, service control, or arbitrary caller-selected test execution.

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

## Task-Run Completion Evidence

M22.1 makes terminal agent-loop completion evidence a first-class `task.run`
contract. Terminal task-run results that reach `AgentLoopCompleted` include
bounded `completion_evidence` with final state, terminal task status, the stable
completion result fingerprint, summary preview/truncation metadata,
final-response presence/count metadata, and whether the response was reconstructed
from replay. The same evidence is persisted on terminal task events so a
headless caller can prove the accepted completion without scanning raw ledger
shape or trusting provider text. Replaying a terminal task reconstructs that
evidence from runtime-owned ledger events and returns it without appending
duplicate `TaskRunning`, `AgentLoopCompleted`, or terminal task events. The
evidence never includes raw prompts, provider responses, final response content,
file content, stdout/stderr, commands, environment values, secrets, or absolute
or canonical paths.

M22.2 routes that completion evidence through the existing headless run-control
surface. `headless.run.advance` now includes optional terminal completion
evidence on each executed step and on the advance result when a task-run step
reaches a terminal `Completed`, `Failed`, or `Cancelled` boundary.
`headless.run.drive` carries the same bounded evidence as its terminal stop
evidence when it stops because the selected task reached that boundary. The
fingerprint matches the direct `task.run` completion evidence, and replayed
advance/drive calls return the persisted evidence without duplicate task or
headless ledger mutation. Budget, stale-progress, and no-runnable-work stops do
not invent terminal completion evidence. These headless results remain bounded
and expose no raw prompt, provider response, final response content, file
content, stdout/stderr, command, environment value, secret, absolute path, or
canonical path.

M51.1 extends the existing terminal `task.run` replay path with an optional
`completion_acceptance` envelope. A caller can explicitly authorize acceptance
of a current terminal `Completed` task/run by supplying the source run id, an
acceptance id, and the expected completion result fingerprint. Before appending
state, the Rust runtime re-reads the task and run ledger, requires the current
task status and terminal completion evidence to be `Completed`, verifies the
expected fingerprint, and rejects failed, missing, stale, or malformed verifier
completion gate evidence. A successful transition appends one bounded
`TaskCompletionAccepted` event and returns bounded `completion_acceptance`
metadata with accepted state, ids, SHA-256 fingerprints, verifier-gate status,
replay state, and next action. Replaying the same acceptance id and fingerprint
returns the persisted acceptance without duplicating `TaskCompletionAccepted` or
`TaskRunning` evidence. This does not add a new RPC, report, digest, history,
readiness, verdict, inspection, automatic acceptance, provider/tool execution,
workspace mutation, or VSIX-owned policy, and it stores no raw prompts,
provider responses, final response content, file content, stdout/stderr,
commands, environment values, request bodies, raw ledger payloads, secrets, or
absolute or canonical paths.

M51.2 connects that accepted-completion state to existing headless run-control.
When `headless.run.drive` reaches a terminal completed scope, the Rust runtime
re-reads the latest completed task/run ledger and derives bounded
`accepted_completion` route metadata only if current `TaskCompletionAccepted`
evidence matches the latest terminal completion fingerprint and verifier-gate
context. The route gives a headless caller a deterministic `close_headless_run`
boundary without a new RPC or caller-side ledger interpretation. Replaying the
same drive checkpoint returns the same bounded accepted-completion metadata and
does not append another `TaskRunning` or `TaskCompletionAccepted` event. Completed
but unaccepted tasks, malformed acceptance evidence, stale fingerprints, failed
or non-terminal evidence, and raw prompt/provider/file/output/path/request
payloads remain excluded from the route.

M51.3 lets the same `headless.run.drive` boundary record a runtime-owned product
completion stop/continue decision after accepted completion is routable. A
caller may replay the drive with explicit `product_completion_decision`
authorization, expected accepted-completion, terminal-completion,
completion-closure, and product-evidence fingerprints, plus bounded product
gate metadata. Rust derives one of `product_complete`, `continue_development`,
or `blocked_by_product_evidence`, appends one bounded
`HeadlessRunProductCompletionDecisionRecorded` event, persists the decision as bounded ledger evidence, and replays it without duplicate task, drive,
acceptance, finalization, or product-decision events. Invalid, incomplete, or
wrapper-only product evidence yields `blocked_by_product_evidence` with
`repair_product_completion_evidence` rather than a false product-complete
claim. M51.3.1 binds replay to the accepted-completion, terminal-completion,
and completion-closure fingerprint boundary so a later request with a different
decision id or product status for the same boundary fails closed before a second
product-decision event can be appended. The ledger and RPC result expose only
ids, statuses, counts, category names, next action, and SHA-256 fingerprints;
raw Product Charter or manifest
text, prompts, provider responses, final responses, file content, raw ledger
payloads, diagnostics, commands, environment values, absolute paths, canonical
paths, and secrets remain excluded.

M52.1 moves the product evidence source for that decision path into the Rust
runtime. M52.2 removes the remaining Brownie-specific ownership boundary from
that derivation path: `headless.run.drive` now accepts an explicitly authorized
`product_evidence_derivation` envelope with one safe JSON
`project_completion_policy` artifact and one to thirty-two policy-declared
evidence artifacts. The runtime requires expected SHA-256 values for the policy
and every evidence artifact, rejects missing, non-regular, non-UTF-8,
symlinked, unsafe, stale-hash, or policy-mismatched evidence, derives a bounded
product evidence matrix from the policy gate and completion ledger facts,
records one bounded `HeadlessRunProductEvidenceMatrixDerived` event, and
replays it without duplicate mutation. The matrix includes a
`product_completion_claim` boolean committed into the matrix fingerprint. A
later `product_completion_decision` may reference the derived matrix
fingerprint so category/count/boolean product evidence is filled from
runtime-derived matrix metadata rather than caller-owned category truth, and a
`product_complete` request is denied before ledger mutation when the derived
policy claim is false. The matrix exposes only bounded ids, phase/milestone
strings, category names, counts, booleans, next action, artifact path
identifiers, artifact SHA-256 values, claim state, and matrix fingerprints; raw
Product Charter, manifest, spec, ledger, prompt, provider, file, command,
output, environment, absolute path, canonical path, and secret data remain
excluded.

M53.1 turns the `continue_development` product decision into a runtime-owned
next-task admission boundary. Existing `task.start` accepts a bounded
`product_continuation_source` envelope with explicit authorization and expected
decision, accepted-completion, terminal-completion, completion-closure, and
product-evidence fingerprints. Rust re-reads the source task/run ledger,
requires the current `HeadlessRunProductCompletionDecisionRecorded` event to be
`continue_development` with `next_action = plan_next_phase`, and creates or
replays exactly one `Created` continuation task with bounded
`product_continuation_provenance`. The admitted task is not automatically run;
the caller must invoke existing `task.run` authority. Product-complete,
blocked-by-product-evidence, stale, malformed, unauthorized, or conflicting
continuation evidence fails closed before continuation task creation, and
ledger/RPC metadata remains limited to bounded ids, statuses, next actions,
replay state, and SHA-256 fingerprints.

M53.1.1 tightens that admission replay identity. A repeated product-continuation
`task.start` request replays an existing continuation task only when the source
decision provenance, requested `goal`, and requested `mode_id` all match. A
same-source request with a different goal or mode fails closed before replaying
or creating a task, preventing restart-time request drift from silently reusing
the wrong continuation task. The provenance also preserves the source
decision's bounded `remaining_capability`, while keeping admission task-only:
there is still no continuation routing, automatic run, provider/verifier/apply
execution, workspace mutation, raw prompt/response/file/output exposure, or new
inspection/report surface.

M53.2 keeps existing `task.run` as the explicit execution boundary for admitted
product-continuation tasks. Before a Created product-continuation task can append
`TaskRunning`, Rust re-reads the source task/run ledger and requires the latest
source product decision to still match the stored `product_continuation_provenance`
and remain `continue_development` with `next_action = plan_next_phase`. Stale,
superseded, `product_complete`, or `blocked_by_product_evidence` source state is
rejected before execution side effects. Terminal task-run replay remains the
existing duplicate-free replay path rather than re-failing because source product
evidence changed after the continuation task already ran.

M54.1 adds bounded runtime-owned technical-debt carry-forward to that same
product-decision and continuation-admission path. A `continue_development`
product completion decision may include `technical_debt_carry_forward` items;
Rust validates bounded ASCII debt ids, summaries, milestone/phase/PR references,
status, next action, and target capability, sorts the items by debt id, derives
a SHA-256 fingerprint, and persists only that bounded metadata in the product
decision ledger payload. Exact replay requires the same carry-forward evidence,
and product-continuation admission copies the carry-forward fingerprint and
bounded item summaries into `product_continuation_provenance`. No new RPC,
standalone debt registry, report, automatic execution, provider/verifier/apply
call, shell/git/network/service action, workspace mutation, or raw prompt,
provider response, file content, diff, command output, path, environment, or
secret exposure is introduced.

M54.2 turns that carry-forward evidence into a runtime-derived debt state
transition. At the existing product-completion decision boundary, Rust reads the
current task's `product_continuation_provenance` when present, treats its
open/deferred carry-forward items as the previous active debt set, then applies
bounded caller-supplied new debt items and explicit debt transitions. Prior
open/deferred debt is automatically kept unless a valid `resolved`,
`superseded`, or `deferred` transition names it. Resolved and superseded
transitions require a SHA-256 `closure_evidence_fingerprint`; unknown,
duplicate, malformed, oversized, raw-looking, non-ASCII, or conflicting debt
state changes fail before ledger mutation. Runtime-understood debt
classifications are `blocking`, `required_before_release`, and `post_v0`, and
active statuses are `open` and `deferred`. A `product_complete` decision is
rejected while any blocking or required-before-release debt remains active.
`post_v0` debt may remain visible at product completion. For
`continue_development`, the derived active debt state and fingerprint are copied
into product-continuation provenance, so later phases cannot drop prior debt by
omission.

M24.2 extends the existing `proposal.apply` transaction recovery path for
partial `delete_file_transaction` evidence. A recovery call supplies
`transaction_recovery_source` plus one to five delete recovery items; the Rust
runtime validates the source run, apply id, transaction id, fingerprint,
partial-failed delete operation, unrecovered source state, and absence of
already-applied source delete items before it admits any remaining targets.
Eligible recovery targets are current approved unconsumed `delete_file`
proposals with fresh preflight, expected target hash matches, regular UTF-8
files, safe workspace-relative paths, no symlinks, and matching approved
deletion diffs. Successful recovery deletes the remaining files, verifies
post-delete absence, consumes authorization, and records bounded
`delete_file_transaction_recovery` evidence with no raw file content, raw diffs,
commands, environment values, secrets, absolute paths, or canonical paths.

M55.1 closes the M50.1 journey-admission atomicity gap. During an existing `headless.run.drive` journey admission, if the runtime creates the initial task but cannot persist the journey checkpoint, it removes that just-created task/run before returning failure. If the checkpoint is written but bounded `HeadlessJourneyStarted` ledger evidence cannot be committed, the runtime removes the matching checkpoint and the just-created task/run. Retries therefore either replay an already committed journey or start from no journey side effects; they do not need external orphan-task cleanup. Cleanup is scoped by matching task id, run id, and checkpoint equality, and no raw prompt, provider response, file content, diff, stdout/stderr, command, environment, absolute path, canonical path, raw request, raw ledger payload, or secret is exposed.

M56.1 extends that same journey-admission boundary for arbitrary repository
coding objectives. `headless.run.drive` can carry one authorized
`journey_admission.objective_context` with a bounded objective id/fingerprint
and one prior `CodebaseIndexSelectionReadCompleted` result. Rust validates the
selected index evidence before task creation, persists only bounded objective,
query, selection, snapshot, source-event, count, and SHA-256 provenance on the
journey checkpoint and `HeadlessJourneyStarted` event, then forwards the
selected context to the first admitted `task.run`. Exact replay returns the
same task/run and objective-context metadata; conflicting objective or selected
context evidence is denied before a duplicate task can be created.

M56.2 extends the same `headless.run.drive` result/checkpoint boundary from
admitted objective-context task/run to one objective-scoped workspace proposal
candidate. After the admitted run has durable `WorkspacePatchProposed` evidence,
Rust derives a bounded `objective_proposal_candidate` only when exactly one
non-recovery proposal is `Valid` and `Pending`. The candidate binds
journey/session/drive ids, source task/run ids, proposal id, operation,
validation and approval status, source event id/kind, objective/context
fingerprints, a path fingerprint, and a deterministic candidate fingerprint.
Ready candidates set `next_route.kind` and `next_action` to
`review_and_authorize_objective_proposal`; zero, multiple, malformed, invalid,
blocked, non-pending, stale, or conflicting evidence fails closed without
approval, preflight, apply, provider, shell, git, network, service, or verifier
execution. Exact replay verifies the persisted candidate fingerprint and does
not duplicate task, proposal, drive checkpoint, or drive-completed evidence.

M56.3 consumes that objective proposal candidate through `headless.continue_once`
without adding a new RPC. The caller supplies
`objective_proposal_authorization_preflight_target` with the journey/session/drive
ids, task/run/proposal/source event ids, expected objective/context/path/candidate
fingerprints, expected `Valid`/`Pending` labels, and an authorization token
fingerprint. Rust verifies the latest journey checkpoint, source drive route,
candidate identity, source proposal event, and current proposal status before any
side effect. It then approves that exact proposal once, refreshes or creates the
latest preflight snapshot/apply plan, persists a bounded continuation checkpoint,
and routes to `apply_authorized_objective_proposal_explicitly`. Replay returns the
same `objective_proposal_authorization_preflight_result` without duplicate
approval, preflight, apply-plan, or checkpoint side effects. This remains
non-mutating: it does not apply workspace changes and exposes no raw prompt,
provider response, proposed content, file content, diff, command output,
environment value, raw request, raw ledger payload, absolute path, canonical path,
secret, or raw authorization token.

M56.4 consumes the authorized objective proposal through `headless.continue_once`
with `objective_proposal_apply_target`. Rust verifies the M56.3
authorization/preflight checkpoint, journey/session/drive/task/run/proposal
identity, proposal/source-event evidence, expected status labels, target hash,
and one-time authorization before delegating to the existing `proposal.apply`
replace-file authority. Success records bounded apply evidence and routes to
`verify_objective_apply_explicitly`; exact replay returns the checkpointed apply
result without a second mutation.

M56.5 consumes that apply checkpoint through `headless.continue_once` with
`objective_apply_verification_target`. Rust validates the objective apply
decision, provenance, operation/status labels, consumed authorization, apply and
path fingerprints, and expected post-write hash, then recomputes the current
target SHA-256 through workspace-relative resolution. A match writes bounded
verification evidence and routes to `accept_objective_completion_explicitly`;
a mismatch writes bounded mismatch evidence and routes to
`start_verification_recovery_explicitly`. The route does not perform additional
workspace mutation and never exposes raw file content, diffs, prompts, commands,
environment, raw requests, paths, tokens, or secrets.

M56.6 consumes the verified acceptance route through the same
`headless.continue_once` surface with `objective_completion_acceptance_target`.
Rust validates explicit completion-acceptance authorization, current progress,
the M56.5 verification checkpoint decision, journey/session/drive/task/run/
proposal/apply identity, operation/status labels, path/apply/current-target
hashes, verification status, route kind, and verification fingerprint before
recording bounded objective completion acceptance evidence. Exact replay returns
the same acceptance decision without duplicate ledger or checkpoint mutation;
missing authorization, stale progress, mismatched evidence, non-verified
checkpoints, and conflicting replay fail closed. The checkpoint and ledger event
store only bounded ids, hashes, status, route, sequence, and replay metadata and
exclude raw file content, proposed content, diffs, prompts, provider responses,
stdout/stderr, commands, environment values, raw requests, raw ledger payloads,
absolute paths, canonical paths, tokens, and secrets.

M57.1 routes product-continuation task admission through the existing
`headless.continue_once` surface with `product_continuation_admission_target`.
Rust validates explicit admission authorization, current aggregate progress, the
source product-completion decision, accepted-completion, terminal-completion,
completion-closure, product-evidence, requested goal, and requested mode before
delegating to the existing product-continuation admission authority. Success
creates or replays exactly one Created continuation task, records bounded
`HeadlessContinuationDecisionRecorded` evidence, returns
`next_route.kind=run_product_continuation_task_explicitly`, and never appends
`TaskRunning`. Generic continuation replay ignores this product-admission route
evidence so it cannot be mistaken for a runnable task-selection decision.

M57.2 consumes the M57.1 product-continuation admission route through the existing `headless.continue_once` surface with `product_continuation_run_target`. Rust validates explicit run authorization, current aggregate progress, bounded continuation task/run identity, source task/run and product-decision identity, expected decision and product-evidence fingerprints, admission route evidence, and current product-continuation provenance before delegating to existing `task.run` authority. Success records bounded `HeadlessContinuationDecisionRecorded` evidence with route kind `product_continuation_run` and returns the bounded `task_run_result`; exact replay validates the same request fingerprint and reconstructs the run result without duplicate `TaskRunning`, provider/tool, terminal, or continuation-decision evidence. The route adds no JSON-RPC method, report, readiness, preview, inspection, provider expansion, workspace mutation expansion, shell/git/network/service execution, raw prompt, provider response, file content, diff, command output, environment value, raw request, raw ledger payload, absolute path, canonical path, token, or secret exposure.

M58.1 lets `headless.run.drive` consume those product-continuation route
boundaries without adding a new RPC. The drive and advance envelopes now accept
one explicit `product_continuation_admission_target` or
`product_continuation_run_target`, require the persisted session checkpoint to
carry the matching admission or run route, and forward the target to the existing
M57 `headless.continue_once` implementation. Drive replay validates the
product-continuation request identity before returning a persisted result, so a
conflicting replay target fails closed instead of silently reusing stale drive
evidence. Admission remains non-running, run execution still delegates to
`task.run`, and outputs stay limited to bounded ids, hashes, route metadata,
progress fingerprints, and task-run evidence.

M58.2 moves the next slice of that product-continuation drive control under
Rust runtime authority. `headless.run.advance` and `headless.run.drive` now
accept one bounded `product_continuation_derived_target` that authorizes the
runtime to derive either an admission target or a run target from the current
persisted product-continuation route. Admission derivation requires the
checkpoint route `admit_product_continuation_task_explicitly` plus a bounded
continuation goal, reads the latest current product-completion decision evidence,
reconstructs the existing M57 admission target, and delegates to
`headless.continue_once`. Run derivation requires route
`run_product_continuation_task_explicitly`, validates the referenced
continuation task/run and product-continuation provenance, reconstructs the
existing M57 run target, and delegates to `task.run` through the same
continuation path. Replay validates the derived request identity against the
bounded subordinate admission/run evidence before returning persisted drive or
advance results. The runtime still executes only one derived product-continuation
route step per advance, adds no JSON-RPC method or report surface, and persists
only bounded ids, route data, and SHA-256 fingerprints.

M59.1 extends that derived target boundary from one step to a bounded sequence
inside the existing `headless.run.drive` RPC. When a drive request supplies
`product_continuation_derived_target` with an explicit `max_advances` budget,
the first advance behaves as M58.2 did. After a successful derived admission or
run advance, the runtime re-reads the latest persisted session checkpoint; if
the next route is still `admit_product_continuation_task_explicitly` or
`run_product_continuation_task_explicitly`, the same bounded derivation
authorization is applied to the next advance. If the latest route is missing,
stale, denied, failed, terminal, or no longer a product-continuation route, the
drive stops closed with a bounded stop reason before another side effect.
Exact drive replay returns the persisted sequence result without duplicate
continuation, task-running, drive-advance, provider/tool, or ledger side
effects. The sequence remains bounded by the existing drive and continue
budgets, adds no JSON-RPC method or report surface, and persists only bounded
ids, route metadata, stop reasons, replay state, and SHA-256 fingerprints.

M60.1 admits a product-loop stop recovery task through the existing
`headless.continue_once` surface with `product_loop_stop_recovery_target`.
M60.1.1 tightens that boundary: Rust now classifies persisted drive-stop
evidence before recovery admission, denies terminal product-complete and
budget-exhausted stops before task creation, and admits only concrete
recoverable faults such as `product_continuation_checkpoint_missing`. Successful
admission creates a Created recovery task with typed
`product_loop_stop_recovery_provenance` on `TaskRecord` and bounded
`TaskStarted` evidence. Direct `task.run` re-reads the source session/drive
checkpoint and revalidates drive fingerprint, stop reason, stop class, progress
fingerprint, end sequence, optional next-route fingerprint, and recovery
boundary fingerprint before `TaskRunning`; stale or terminal evidence fails
closed without provider/tool/workspace side effects.

M61.1 removes the caller-authored goal requirement from runtime-derived
product objective admission. When `headless.run.advance` or `headless.run.drive`
consumes a persisted `admit_product_continuation_task_explicitly` route through
`product_continuation_derived_target`, the caller may omit `continuation_goal`.
Rust then revalidates the current `continue_development` product decision,
requires bounded non-empty `remaining_capability`, derives a generic bounded
goal from that remaining capability, and creates or replays one
product-continuation task with typed
`product_objective_continuation_provenance` on `TaskRecord` and bounded
`TaskStarted` evidence. M61.1.1 tightens the objective identity so the
remaining capability and its SHA-256 fingerprint are bound into provenance and
the derived objective fingerprint; changing the remaining capability changes the
runtime-authored goal and replay identity, while completed transition labels
remain provenance context rather than the next objective text. Existing
caller-supplied product-continuation admission remains compatible. The derived
path adds no JSON-RPC method, no report/readiness/inspection surface, and no
automatic provider/tool/workspace, shell, git, network, or service execution.

M61.2 binds that runtime-derived product objective into the existing
`headless.run.drive` journey-admission boundary. `journey_admission` may now
name a `product_objective_continuation_source` instead of caller-authored
`task_start` text. Rust re-reads the continuation task, requires current typed
`product_objective_continuation_provenance`, revalidates the source
`continue_development` product decision and remaining-capability fingerprints,
and admits the existing Created continuation task as the journey start. The
journey checkpoint, metadata, and `HeadlessJourneyStarted` event carry only
bounded ids, route labels, remaining-capability metadata, and SHA-256
fingerprints. Exact replay revalidates the source and returns the persisted
journey without duplicating task, checkpoint, or event state; conflicting,
missing, stale, terminal, or blocked source evidence fails closed before a new
journey checkpoint is committed. Caller-authored `task_start` journey admission
remains compatible, and no new RPC, report wrapper, automatic provider/tool
execution, or workspace mutation is added.

M62.1 lets the Rust runtime select the next Product DoD gap from the existing
project completion policy derivation path. When `product_completion_claim` is
false, the policy must include bounded `product_dod_remaining_gaps` metadata;
Rust validates every gap, rejects unsupported status, duplicate ids, missing
required fields, or missing open required gaps before product evidence matrix
ledger mutation, then deterministically selects the highest-priority open
required gap and fingerprints it into the derived matrix. A following
`product_completion_decision` that references that derived matrix may omit
caller-authored `remaining_capability`; Rust derives the effective remaining
capability from the selected gap, returns bounded selected-gap metadata, and
denies `product_complete` while the matrix still has an open required Product
DoD gap. The extension only validates the bounded protocol shape. No new RPC,
report/readiness/inspection surface, provider/tool execution, shell, git,
network, service, or workspace mutation is added, and raw policy, artifact,
prompt, provider, stdout/stderr, command, environment, path, and secret content
remain excluded.
