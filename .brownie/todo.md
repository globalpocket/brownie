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


- [ ] E-16a-artifact-source-local-producer: Patch only `scripts/release-local-artifact.mjs` to record artifact source identity at build time:
  Route: implementation.
  Source TODO: E-16a-artifact-source-identity.
  Depends on: <none>.
  Completion condition: local artifact evidence records the source commit and clean-tree state used to build the artifact, without storing absolute paths or raw command output.
  Forbidden changes: do not mark Runtime Release Ready and do not weaken artifact checksum generation.
  Verification: run `pnpm --workspace-root guard:supply-chain-artifact-evidence:test` and `pnpm --workspace-root guard:supply-chain-artifact-evidence`.

- [ ] E-16a-artifact-source-linux-producer: Patch only `scripts/release-linux-x64-docker-artifact.mjs` to record artifact source identity at build time:
  Route: implementation.
  Source TODO: E-16a-artifact-source-identity.
  Depends on: E-16a-artifact-source-local-producer.
  Completion condition: linux docker artifact evidence records the source commit and clean-tree state used to build the artifact, without storing host paths, container paths, or raw command output.
  Forbidden changes: do not edit local artifact generation or loosen docker artifact checksum generation.
  Verification: run `pnpm --workspace-root guard:supply-chain-artifact-evidence:test` and `pnpm --workspace-root guard:supply-chain-artifact-evidence`.

- [ ] E-16a-clean-source-collector: Patch only `scripts/release-supply-chain-artifact-evidence.mjs` to bind collected artifacts to clean source identity:
  Route: implementation.
  Source TODO: E-16a-supply-chain-clean-source-binding.
  Depends on: E-16a-artifact-source-linux-producer.
  Completion condition: generated supply-chain evidence distinguishes current clean tested source from dirty local state and records artifact source identity when artifact evidence provides it.
  Forbidden changes: do not fabricate source identity for artifacts that lack producer evidence.
  Verification: run `pnpm --workspace-root guard:supply-chain-artifact-evidence:test` and `pnpm --workspace-root guard:supply-chain-artifact-evidence`.

- [ ] E-16a-clean-source-guard: Patch only `scripts/guard-supply-chain-artifact-evidence.mjs` to fail closed on dirty, stale, or missing artifact source binding:
  Route: implementation.
  Source TODO: E-16a-supply-chain-clean-source-binding.
  Depends on: E-16a-clean-source-collector.
  Completion condition: the supply-chain guard rejects dirty source evidence and rejects satisfied artifact provenance when artifact source identity is absent or not bound to the tested source commit.
  Forbidden changes: do not edit Runtime readiness documents or loosen artifact checksum validation.
  Verification: run `pnpm --workspace-root guard:supply-chain-artifact-evidence:test` and `pnpm --workspace-root guard:supply-chain-artifact-evidence`.

- [ ] E-16a-clean-source-test: Patch only `scripts/guard-supply-chain-artifact-evidence.test.mjs` to cover clean and dirty source binding:
  Route: implementation.
  Source TODO: E-16a-supply-chain-clean-source-binding.
  Depends on: E-16a-clean-source-guard.
  Completion condition: tests prove clean current artifact source binding is accepted and dirty, stale, or missing binding remains fail-closed.
  Forbidden changes: do not modify production collector or guard logic from this test-only leaf.
  Verification: run `pnpm --workspace-root guard:supply-chain-artifact-evidence:test` and `pnpm --workspace-root guard:supply-chain-artifact-evidence`.

- [ ] E-16b-artifact-smoke-steps-guard: Patch only `scripts/guard-supply-chain-artifact-evidence.mjs` to require E2E artifact smoke steps:
  Route: implementation.
  Source TODO: E-16b-artifact-smoke-execution.
  Depends on: E-16a-clean-source-test.
  Completion condition: artifact smoke evidence is rejected unless each target records base mode pack load, minimal task run, ledger generation, forced stop/resume, and stale/replay rejection.
  Forbidden changes: do not accept `brownie --version` or help-only smoke as E2E evidence.
  Verification: run `pnpm --workspace-root guard:supply-chain-artifact-evidence:test` and `pnpm --workspace-root guard:supply-chain-artifact-evidence`.

- [ ] E-16b-artifact-smoke-collector: Patch only `scripts/release-supply-chain-artifact-evidence.mjs` to collect bounded E2E smoke evidence:
  Route: implementation.
  Source TODO: E-16b-artifact-smoke-execution.
  Depends on: E-16b-artifact-smoke-steps-guard.
  Completion condition: configured artifact targets produce sanitized artifact smoke records or target-specific fail-closed blockers without raw paths or command output.
  Forbidden changes: do not store absolute paths, SSH host aliases, raw stdout, raw stderr, or PowerShell EncodedCommand values.
  Verification: run `pnpm --workspace-root guard:supply-chain-artifact-evidence:test` and `pnpm --workspace-root guard:supply-chain-artifact-evidence`.

- [ ] E-16b-artifact-smoke-test: Patch only `scripts/guard-supply-chain-artifact-evidence.test.mjs` to cover artifact smoke E2E requirements:
  Route: implementation.
  Source TODO: E-16b-artifact-smoke-execution.
  Depends on: E-16b-artifact-smoke-collector.
  Completion condition: tests reject version/help-only smoke and accept sanitized smoke records containing the required E2E step statuses.
  Forbidden changes: do not modify production collector or guard logic from this test-only leaf.
  Verification: run `pnpm --workspace-root guard:supply-chain-artifact-evidence:test` and `pnpm --workspace-root guard:supply-chain-artifact-evidence`.

- [ ] E-16c-artifact-lifecycle-collector: Patch only `scripts/release-runtime-operational-evidence.mjs` to collect artifact lifecycle evidence:
  Route: implementation.
  Source TODO: E-16c-runtime-artifact-lifecycle-evidence.
  Depends on: E-16b-artifact-smoke-test.
  Completion condition: runtime operational evidence records sanitized per-target artifact lifecycle status or bounded target-specific fail-closed blockers.
  Forbidden changes: do not persist absolute paths, SSH aliases, raw command output, local worktree paths, or EncodedCommand values.
  Verification: run `pnpm --workspace-root guard:runtime-operational-evidence:test` and `pnpm --workspace-root guard:runtime-operational-evidence`.

- [ ] E-16c-artifact-lifecycle-guard: Patch only `scripts/guard-runtime-operational-evidence.mjs` to reject incomplete artifact lifecycle evidence:
  Route: implementation.
  Source TODO: E-16c-runtime-artifact-lifecycle-evidence.
  Depends on: E-16c-artifact-lifecycle-collector.
  Completion condition: the guard rejects missing artifact lifecycle target status and accepts sanitized satisfied or fail-closed target records.
  Forbidden changes: do not weaken redaction checks or accept raw process output fields.
  Verification: run `pnpm --workspace-root guard:runtime-operational-evidence:test` and `pnpm --workspace-root guard:runtime-operational-evidence`.

- [ ] E-16c-artifact-lifecycle-test: Patch only `scripts/guard-runtime-operational-evidence.test.mjs` to cover artifact lifecycle evidence:
  Route: implementation.
  Source TODO: E-16c-runtime-artifact-lifecycle-evidence.
  Depends on: E-16c-artifact-lifecycle-guard.
  Completion condition: tests reject missing or raw artifact lifecycle evidence and accept sanitized satisfied or fail-closed target records.
  Forbidden changes: do not modify production collector or guard logic from this test-only leaf.
  Verification: run `pnpm --workspace-root guard:runtime-operational-evidence:test` and `pnpm --workspace-root guard:runtime-operational-evidence`.

- [ ] E-16d-stateful-soak-collector: Patch only `scripts/release-runtime-operational-evidence.mjs` to execute stateful soak evidence:
  Route: implementation.
  Source TODO: E-16d-stateful-soak-execution.
  Depends on: E-16c-artifact-lifecycle-test.
  Completion condition: runtime operational evidence records stateful soak steps for transitions, ledger/workspace consistency, resume/replay, duplicate side-effect rejection, process-loss recovery, and finite convergence.
  Forbidden changes: do not use version-only soak and do not store raw process output or local paths.
  Verification: run `pnpm --workspace-root guard:runtime-operational-evidence:test` and `pnpm --workspace-root guard:runtime-operational-evidence`.

- [ ] E-16d-stateful-soak-guard: Patch only `scripts/guard-runtime-operational-evidence.mjs` to reject version-only soak evidence:
  Route: implementation.
  Source TODO: E-16d-stateful-soak-execution.
  Depends on: E-16d-stateful-soak-collector.
  Completion condition: the guard rejects `brownie --version` repetition as soak evidence and accepts only stateful soak records with the required Runtime behaviors.
  Forbidden changes: do not mark Runtime Release Ready or weaken artifact lifecycle validation.
  Verification: run `pnpm --workspace-root guard:runtime-operational-evidence:test` and `pnpm --workspace-root guard:runtime-operational-evidence`.

- [ ] E-16d-stateful-soak-test: Patch only `scripts/guard-runtime-operational-evidence.test.mjs` to cover stateful soak requirements:
  Route: implementation.
  Source TODO: E-16d-stateful-soak-execution.
  Depends on: E-16d-stateful-soak-guard.
  Completion condition: tests reject version-only soak and accept stateful soak records with transitions, ledger/workspace consistency, resume/replay, duplicate side-effect rejection, process-loss recovery, and finite convergence.
  Forbidden changes: do not modify production collector or guard logic from this test-only leaf.
  Verification: run `pnpm --workspace-root guard:runtime-operational-evidence:test` and `pnpm --workspace-root guard:runtime-operational-evidence`.
