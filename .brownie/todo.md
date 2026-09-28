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

- [ ] E-19h-release-contract-trace-fields: Patch only `docs/architecture/runtime-release-contract.json` and `docs/architecture/runtime-release-readiness-audit.json` to keep trace binding evidence fail-closed until real values exist:
  Route: documentation.
  Source TODO: E-19h-release-contract-trace-binding.
  Depends on: <none>.
  Completion condition: Release Contract and readiness audit expose explicit blockers when current tested commit, workflow run id, or artifact SHA bindings are missing or pending.
  Forbidden changes: do not replace missing values with invented placeholders, do not mark evidence implemented without generated evidence, and do not declare Runtime Release Ready.
  Verification: run `pnpm --workspace-root guard:release-contract` and `pnpm --workspace-root guard:runtime-release-readiness`.

- [ ] E-19i-generation-sync-semantic-guard: Patch only `scripts/guard-release-evidence-semantic-consistency.mjs`, `scripts/guard-release-evidence-semantic-consistency.test.mjs`, `docs/architecture/phase-value-manifest.json`, `docs/architecture/final-product-ready-judgment.md`, `docs/architecture/runtime-release-contract.json`, and `docs/architecture/runtime-release-readiness-audit.json` so E-19 generation labels, commit authority, audited base, final judgment, and release evidence blockers are synchronized or rejected.
  Route: implementation.
  Depends on: E-19h-release-contract-trace-fields.
  Completion condition: semantic consistency rejects stale E-17/RRP-8.7-era judgments, stale audited base commits, and mismatched TODO/Phase/Contract/Audit generation labels when Product Ready remains false.
  Forbidden changes: do not delete historical phase manifests, do not declare Product Ready, and do not weaken existing semantic consistency checks.
  Verification: run `pnpm --workspace-root guard:release-evidence-semantic-consistency:test`, `pnpm --workspace-root guard:release-evidence-semantic-consistency`, and `pnpm --workspace-root guard:phase-value`.

- [ ] E-19j-branch-protection-verification-plan: Patch only `docs/architecture/runtime-release-contract.json`, `docs/architecture/runtime-release-readiness-audit.json`, and `.brownie/todo.md` to keep branch protection and required status checks as explicit owner-verification blockers until a verified snapshot, GitHub CLI authority, or alternate review authority is available.
  Route: documentation.
  Depends on: E-19i-generation-sync-semantic-guard.
  Completion condition: owner governance blockers distinguish “not configured” from “not verifiable by current GitHub App” and leave a concrete owner-action TODO instead of treating API 403 as success or failure.
  Forbidden changes: do not claim branch protection is satisfied from inaccessible GitHub App responses, do not remove owner-controlled blockers, and do not declare Runtime Release Ready.
  Verification: run `pnpm --workspace-root guard:release-contract`.
- [ ] E-19k-remaining-release-evidence-blocker: Blocker: release evidence remains incomplete after E-19 TODO injection, and Product Ready must remain false until Golden Journey, artifact E2E, lifecycle, stateful soak, provenance binding, dependency audit sync, and owner-verifiable branch protection are closed.
  Route: release-ops.
  Depends on: <none>.
  Completion condition: remaining release blocker evidence is explicitly identified and Product Ready is not inferred from a queue that only contains blockers.
  Forbidden changes: do not patch workspace files for this blocker; do not declare Runtime Product Ready, Runtime Release Ready, or public Release Ready.
  Verification: blocker: release evidence remains fail-closed and no workspace file is patched until the next concrete executable evidence TODO is available.
