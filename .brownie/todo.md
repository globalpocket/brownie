# Brownie TODO Queue

This file is the shared priority queue between the external Brownie phase-loop
controller and Brownie itself.

`phase-loop.md` remains the execution prompt and product boundary contract.
`.brownie/todo.md` is the ordered list of concrete work items Brownie should consume.
The external controller may add, remove, or reorder unchecked items. Brownie may
refine the list when evidence changes, but must keep the list small, concrete,
and ordered by priority.

Current synchronization note:

- The execution-time `origin/main` after `git fetch` is authoritative. Do not
  treat a commit SHA embedded in this document as live repository authority.
- PR #393 added this queue.
- PR #394 embeds the first unchecked TODO and a bounded queue snapshot into each
  generated per-run prompt.
- PR #395 expanded this queue from the external Product Ready gap analysis.
- PR #398 added durable TODO claim records for selected supervisor work.
- PR #400 added TODO queue generation/fingerprint CAS state and made durable
  claims the only empty-queue in-progress liveness signal.
- PR #401 added structured CLI JSON validation, deterministic progress
  fingerprints, persisted stagnation counts, and no-progress classification.
- PR #403 hardened effective prompt artifacts, added truncation metadata, and
  retries with a fresh claim when TODO changes are detected before Runtime
  start.
- PR #404 added child-inclusive stop behavior and interruptible supervisor
  waits so stop requests can terminate backoff, long Brownie runs, and
  supervisor-managed children without waiting for the next natural wakeup.
- PR #405 repaired Runtime/CLI unknown-nonterminal continuation by returning a
  bounded product-loop stop recovery target instead of repeatedly routing
  `drive_budget_exhausted` + `inspect_progress_overview` back to generic
  resume.
- PR #406 extended that recovery classification to the live
  `budget_exhausted` + `unknown_nonterminal` + `inspect_progress_overview`
  shape observed after PR #405, so both budget-stop spellings produce the same
  finite product-loop recovery target.
- PR #407 extended the same recovery classification across non-implementation
  overview routes, covering the internal `next_route: inspect_progress_overview`
  case that CLI JSON otherwise projects as another generic resume.
- R-19 adds a dedicated Ledger Contract single-source guard so LedgerEventKind,
  payload schema classification, schema fingerprint, Runtime validator dispatch,
  generated payload fixtures, release-gate wiring, and CI-reachable VSIX check
  wiring cannot drift independently.
- R-20 adds repo-fixed historical ledger fixtures for schema-v1 load/resume
  compatibility and fail-closed replay/read rejection, with release-gate and
  CI-reachable guard coverage.
- E-01 resynchronizes the current phase manifest, Runtime Release Contract,
  release-readiness audit, and semantic contract authority to the latest
  execution-time `origin/main` after R-20, replacing stale current
  RRP-8.4/RRP-8.6 fingerprint authority while keeping historical evidence
  entries intact.
- PR #452 closed the previous Runtime-owned Product Ready blocker queue, but the
  f7f845a follow-up audit reopened Release evidence authenticity,
  confidentiality, cross-platform E2E, and semantic guard blockers. Runtime
  Product Ready remains false until those evidence blockers and independent
  owner reviews close.
- Runtime Product Ready is not reached.

## Queue protocol

- Pending work is represented by unchecked Markdown task items: `- [ ] ...`.
- The first unchecked item is the highest-priority pending TODO.
- The supervisor must create or reuse a durable active claim before invoking
  Brownie. The active claim, not TODO deletion, is the record that work started.
- The supervisor must maintain durable queue generation/fingerprint state and
  reject stale snapshots when external TODO reordering/additions are detected
  during new-claim selection.
- The supervisor must drive Brownie with validated structured JSON output and
  persist deterministic progress fingerprints. Repeated identical non-progress
  fingerprints must be classified as `no_progress` instead of healthy success.
- The supervisor must harden generated effective prompts with `0600`, bounded
  size, retention, prompt/queue fingerprints, and truncation metadata. It must
  fail closed when the selected TODO cannot be embedded completely and must
  retry with a fresh claim when the TODO queue changes before Runtime start.
- The supervisor must honor stop requests during interval/backoff waits and
  must terminate supervisor-managed Runtime child processes with graceful
  termination, bounded force timeout, process-group handling where safe, and
  descendant/orphan-child cleanup evidence.
- Brownie must keep exactly one active bounded slice per invocation. If work is
  incomplete, it must leave a concrete follow-up TODO naming the remaining
  blocker or next implementation step.
- Do not use checked items as durable completion evidence. Completed work must
  be supported by implementation, tests, CI, PR/merge evidence, and the normal
  phase-loop audit artifacts.
- If this queue has no unchecked Product Ready items and there is no durable
  in-progress claim, the phase-loop supervisor should stop instead of starting
  another Brownie run.

## Product Ready Blocking Queue

### P0/P1: Release engineering and evidence


- [ ] E-16a-supply-chain-clean-source-binding: Patch only `scripts/release-supply-chain-artifact-evidence.mjs` and related guard tests so generated supply-chain evidence fails closed on dirty source during local development but can record a clean tested source commit for release validation:
  Route: implementation.
  Depends on: <none>.
  Completion condition: supply-chain evidence can be regenerated from a clean source tree without `source_tree_dirty:true`, while dirty-tree evidence remains fail-closed.
  Forbidden changes: do not mark Runtime Release Ready and do not weaken dirty-tree validation.
  Verification: run `pnpm --workspace-root guard:supply-chain-artifact-evidence:test`, `pnpm --workspace-root guard:supply-chain-artifact-evidence`, and `pnpm --workspace-root check`.

- [ ] E-16b-artifact-smoke-execution: Patch only release artifact smoke collection and guard fixtures so artifact smoke is executable and no longer `not_executed` when configured artifacts are present:
  Route: implementation.
  Depends on: E-16a-supply-chain-clean-source-binding.
  Completion condition: `.brownie/release-evidence/supply-chain-artifact-evidence.json` can contain satisfied artifact_smoke evidence with required E2E smoke steps for the configured artifact set.
  Forbidden changes: do not replace E2E smoke with `brownie --version` only, and do not store raw paths/stdout/stderr.
  Verification: run `pnpm --workspace-root guard:supply-chain-artifact-evidence:test`, `pnpm --workspace-root guard:supply-chain-artifact-evidence`, and `pnpm --workspace-root check`.

- [ ] E-16c-runtime-artifact-lifecycle-evidence: Patch only runtime operational evidence collection and guard tests so artifact_lifecycle can be satisfied for the configured local/VM targets or records exact target-specific blockers:
  Route: implementation.
  Depends on: E-16b-artifact-smoke-execution.
  Completion condition: runtime operational evidence no longer has `artifact_lifecycle:failed` for available configured targets, or records bounded target-specific blockers that keep the queue actionable.
  Forbidden changes: do not persist absolute paths, SSH aliases, raw command output, or EncodedCommand values.
  Verification: run `pnpm --workspace-root guard:runtime-operational-evidence:test`, `pnpm --workspace-root guard:runtime-operational-evidence`, and `pnpm --workspace-root check`.

- [ ] E-16d-stateful-soak-execution: Patch only runtime operational evidence collection and guard tests so stateful soak evidence is executed instead of `not_executed`:
  Route: implementation.
  Depends on: E-16c-runtime-artifact-lifecycle-evidence.
  Completion condition: `.brownie/release-evidence/runtime-operational-evidence.json` records satisfied stateful soak steps for task transition, ledger/workspace consistency, resume/replay, duplicate side-effect rejection, process-loss recovery, and finite convergence.
  Forbidden changes: do not use version-only soak and do not store raw process output or local paths.
  Verification: run `pnpm --workspace-root guard:runtime-operational-evidence:test`, `pnpm --workspace-root guard:runtime-operational-evidence`, and `pnpm --workspace-root check`.
