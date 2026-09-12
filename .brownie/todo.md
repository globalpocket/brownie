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

- [ ] E-15a-runtime-operational-evidence-redaction: Remove forbidden local
  details from runtime operational evidence and add a fail-closed guard:
  Route: release-evidence/confidentiality. Source concern: the current
  `.brownie/release-evidence/runtime-operational-evidence.json` may contain
  absolute local paths, SSH host aliases, raw stdout/stderr, encoded shell
  commands, or local worktree details while Release documents declare those are
  not valid release evidence. Implement or update the collector and guard so
  runtime operational evidence stores only bounded statuses, counts, hashes,
  relative paths, command identifiers, and non-sensitive summaries. Add tests
  that reject `/Users/`, `/home/`, `C:/Users/`, SSH host aliases, raw process
  output fields, PowerShell `EncodedCommand`, and local worktree paths. Keep
  `runtime_release_ready` false. Verification: run the new/updated guard tests,
  `pnpm --workspace-root guard:runtime-operational-evidence`, and
  `pnpm --workspace-root check`.
- [ ] E-15b-artifact-provenance-current-main-binding: Bind release artifacts,
  tested commit, workflow run, and provenance to the latest authoritative
  `origin/main` commit:
  Route: release-evidence/provenance. Source concern: release contract and
  supply-chain evidence must not mark artifact/SBOM/provenance conditions
  implemented while `implementation_commit`, `tested_commit`,
  `workflow_run_id`, `artifact_sha256`, or audited base data are null, stale,
  dirty, or inconsistent with current main. Update collectors, evidence files,
  and guards so final artifact evidence names one source commit, one clean
  source tree state, one workflow or local release invocation, and one checksum
  set for the artifacts actually recorded. If artifacts are not regenerated in
  this task, fail closed with explicit blockers instead of claiming satisfied
  evidence. Keep `runtime_release_ready` false. Verification: run
  `pnpm --workspace-root guard:supply-chain-artifact-evidence`,
  `pnpm --workspace-root guard:release-contract`, and relevant guard tests.
- [ ] E-15c-cross-platform-artifact-e2e-smoke-contract: Replace shallow
  artifact smoke with per-target executable E2E smoke requirements:
  Route: release-evidence/cross-platform-e2e. Source concern: the existing
  four-target smoke evidence is too shallow if it only proves
  `brownie --version` and `brownie help run`; Release Contract requires Base
  Mode Pack load, a minimal task run, Ledger generation, forced stop/resume,
  and stale/replay rejection for each released artifact/OS target. Update the
  local artifact smoke runner, evidence schema, and guard so each target is
  either satisfied by bounded per-target E2E evidence or explicitly fail-closed
  with the missing target/reason. Do not rely on macOS-only Golden Journey as
  cross-platform artifact evidence. Keep `runtime_release_ready` false.
  Verification: run artifact smoke guard tests and
  `pnpm --workspace-root guard:runtime-operational-evidence`.
- [ ] E-15d-runtime-soak-evidence-stateful: Replace the 100-run version-only
  soak with stateful Runtime soak evidence:
  Route: release-evidence/soak. Source concern: repeating `brownie --version`
  does not prove Runtime durability. Define and implement soak evidence that
  exercises task state transitions, Ledger/workspace consistency, resume/replay
  handling, no duplicate side effects, process-loss recovery, bounded
  Mode Pack/LLM/MCP paths where available, and finite convergence. The guard
  must reject version/help-only soak evidence as insufficient. Keep
  `runtime_release_ready` false unless all release evidence and independent
  owner reviews are complete. Verification: run soak guard tests and
  `pnpm --workspace-root check`.
- [ ] E-15e-release-contract-audit-phase-resync: Resynchronize Release
  Contract, Release Readiness Audit, Phase Manifest, and final judgment after
  E-15a through E-15d:
  Route: release-judgment/resync. Source concern: after evidence hardening, the
  release documents must accurately reflect current main, current artifacts,
  fail-closed missing evidence, and owner-controlled independent reviews. Remove
  stale base commit references such as old audited commits when they are no
  longer authoritative; do not mark evidence implemented unless the new guards
  prove the semantic evidence, not just status strings. Keep
  `runtime_release_ready` false while `independent_reviews` remains incomplete.
  Verification: run `pnpm --workspace-root guard:runtime-release-readiness`,
  `pnpm --workspace-root guard:release-contract`,
  `pnpm --workspace-root guard:phase-value`, and `pnpm --workspace-root check`.
- [ ] E-15f-release-evidence-semantic-consistency-guard: Add a semantic
  consistency guard that cross-checks release contract statuses against
  evidence contents:
  Route: release-guards/semantic-consistency. Source concern: guards must not
  accept JSON status strings that contradict evidence fields. Add a guard and
  tests that fail when satisfied release conditions have null/stale
  implementation/tested/artifact commits, dirty source trees, missing workflow
  provenance, missing or mismatched artifact checksums, shallow smoke evidence,
  version-only soak evidence, or forbidden confidential evidence fields.
  Wire the guard into VSIX `check`, release gate dry-run command inventory, and
  phase value manifest. Keep `runtime_release_ready` false unless all semantic
  checks and owner reviews are complete. Verification: run the new guard tests,
  `pnpm --workspace-root guard:phase-value`, and `pnpm --workspace-root check`.
- [ ] E-15g-pr435-stale-phase-loop-pr-hygiene: Resolve stale Phase Loop PR
  #435:
  Route: release-ops/pr-hygiene. Source concern: PR #435 remains open against
  `main` while latest main appears to include or supersede its CI/phase-loop
  work, and the PR is currently dirty. Verify whether all useful changes from
  #435 are already included in current `origin/main`. If fully superseded,
  close the PR with a concise comment that cites the superseding merged PRs or
  current evidence. If not superseded, create a bounded follow-up TODO naming
  the exact missing file/change instead of merging stale conflicting work.
  Verification: record the PR state and conclusion in bounded release-ops
  evidence or a TODO update; do not change release readiness based solely on PR
  hygiene.

## Tracked but not Product Ready blocking

These items are intentionally not part of the Product Ready blocking queue above
unless the owner explicitly promotes them.

### Brownie Developers Kit / Product expansion

- Phase Loop Supervisor as a maintained BDK component.
- Durable job queue, workspace lease, cancel/timeout/retry/backoff, and
  one-job-one-workspace/process isolation.
- GitHub/GitLab MCP or BDK adapter PR flows, not Runtime-native GitHub APIs.
- Language verifier adapters and validation packs for Node, Python, Java, Go,
  and other ecosystems.
- Local secret-provider adapter, Mode Pack package/install/update, registry
  client, approval UI/CLI, developer diagnostics, SDKs, samples, installer,
  updater, compatibility matrix, and independent BDK/Runtime versioning.

### Enterprise / separate product line

- Multi-tenant control plane, SSO/SAML/OIDC, organization RBAC, central approval
  UI, Vault/KMS, tenant isolation, quota/billing, monitoring/alerts, SLO/SLA,
  SIEM export, long-term audit retention, managed update, continuity assurance,
  certified stacks, blue/green rollout, on-prem/offline update, HA, backup, DR,
  and partner operations portal.

### Owner decisions and GitHub settings

- OSS license selection.
- Public `publish=true/false` posture.
- Branch protection, required checks, protected tags, signing authority or
  integrity alternative.
- Independent reviews for release workflow, permission model, Ledger Contract,
  Mode Pack trust boundary, and Release Ready logic.
- `SECURITY.md`, `CONTRIBUTING.md`, and vulnerability report channel.


- [ ] E-15a-redaction-collector: Patch only `scripts/release-runtime-operational-evidence.mjs` to sanitize runtime operational evidence:
  Source TODO: TODO-decompose-blocked-queue-71820ffb9fb9: Decompose the currently blocked Product Ready TODO queue into implementable leaf TODOs:
  Store only bounded statuses, counts, hashes, relative paths, command identifiers, and non-sensitive summaries. Remove absolute local paths, SSH host aliases, raw stdout/stderr, encoded shell commands, and local worktree details from persisted evidence.
  Verification: run `pnpm --workspace-root guard:runtime-operational-evidence:test`.
- [ ] E-15a-redaction-guard: Patch only `scripts/guard-runtime-operational-evidence.mjs` and `scripts/guard-runtime-operational-evidence.test.mjs` to reject forbidden local evidence fields:
  Source TODO: TODO-decompose-blocked-queue-71820ffb9fb9: Decompose the currently blocked Product Ready TODO queue into implementable leaf TODOs:
  Add fail-closed checks and tests for `/Users/`, `/home/`, `C:/Users/`, SSH host aliases, raw process output fields, PowerShell `EncodedCommand`, and local worktree paths.
  Verification: run `pnpm --workspace-root guard:runtime-operational-evidence:test` and `pnpm --workspace-root guard:runtime-operational-evidence`.
- [ ] E-15b-provenance-collector: Patch only `scripts/release-supply-chain-artifact-evidence.mjs` to bind artifact evidence to one current clean source commit:
  Source TODO: TODO-decompose-blocked-queue-71820ffb9fb9: Decompose the currently blocked Product Ready TODO queue into implementable leaf TODOs:
  Record current source commit, clean/dirty state, release invocation identity, artifact paths, and checksum set for the artifacts actually collected. Missing workflow run or artifact SHA must remain explicit fail-closed blockers.
  Verification: run `pnpm --workspace-root guard:supply-chain-artifact-evidence:test` and `pnpm --workspace-root guard:supply-chain-artifact-evidence`.
- [ ] E-15b-release-contract-binding-guard: Patch only `scripts/guard-release-contract.mjs` and its tests to reject stale/null commit and artifact binding fields:
  Source TODO: TODO-decompose-blocked-queue-71820ffb9fb9: Decompose the currently blocked Product Ready TODO queue into implementable leaf TODOs:
  Fail when implemented artifact/SBOM/provenance conditions have null/stale implementation commit, tested commit, workflow run ID, artifact SHA-256, dirty source tree, or mismatched current main evidence.
  Verification: run `pnpm --workspace-root guard:release-contract:test` and `pnpm --workspace-root guard:release-contract`.
- [ ] E-15c-artifact-smoke-runner-contract: Patch only local artifact smoke collection scripts to require per-target E2E smoke fields:
  Source TODO: TODO-decompose-blocked-queue-71820ffb9fb9: Decompose the currently blocked Product Ready TODO queue into implementable leaf TODOs:
  For each released artifact/OS target, require Base Mode Pack load, minimal task run, Ledger generation, forced stop/resume, and stale/replay rejection, or record a target-specific fail-closed reason.
  Verification: run the artifact smoke guard tests and `pnpm --workspace-root guard:runtime-operational-evidence`.
- [ ] E-15d-stateful-soak-contract: Patch only runtime operational evidence collection and guard tests to replace version-only 100-run soak with stateful soak evidence:
  Source TODO: TODO-decompose-blocked-queue-71820ffb9fb9: Decompose the currently blocked Product Ready TODO queue into implementable leaf TODOs:
  Require task state transitions, Ledger/workspace consistency, resume/replay handling, no duplicate side effects, process-loss recovery, bounded Mode Pack/LLM/MCP paths where available, and finite convergence. Reject version/help-only soak evidence.
  Verification: run soak guard tests and `pnpm --workspace-root check`.
- [ ] E-15e-release-doc-resync-after-evidence: Patch only release judgment/contract/audit/manifest documents after E-15a through E-15d are implemented:
  Source TODO: TODO-decompose-blocked-queue-71820ffb9fb9: Decompose the currently blocked Product Ready TODO queue into implementable leaf TODOs:
  Resynchronize current main, current artifacts, fail-closed missing evidence, and owner-controlled independent reviews. Do not mark `runtime_release_ready=true` while independent reviews remain incomplete.
  Verification: run `pnpm --workspace-root guard:runtime-release-readiness`, `pnpm --workspace-root guard:release-contract`, `pnpm --workspace-root guard:phase-value`, and `pnpm --workspace-root check`.
- [ ] E-15f-semantic-consistency-guard: Add a release evidence semantic consistency guard and tests:
  Source TODO: TODO-decompose-blocked-queue-71820ffb9fb9: Decompose the currently blocked Product Ready TODO queue into implementable leaf TODOs:
  Fail when release contract statuses contradict evidence contents, including stale/null commits, dirty trees, missing workflow provenance, missing or mismatched artifact checksums, shallow smoke, version-only soak, or forbidden confidential fields. Wire into VSIX `check`, release gate dry-run inventory, and phase value manifest.
  Verification: run the new guard tests, `pnpm --workspace-root guard:phase-value`, and `pnpm --workspace-root check`.
- [ ] E-15g-pr435-hygiene-evidence: Resolve stale Phase Loop PR #435 with bounded evidence or a follow-up TODO:
  Source TODO: TODO-decompose-blocked-queue-71820ffb9fb9: Decompose the currently blocked Product Ready TODO queue into implementable leaf TODOs:
  Verify whether all useful changes from #435 are included in current `origin/main`. If superseded, close the PR with a concise comment citing superseding evidence. If not, update `.brownie/todo.md` with the exact missing file/change instead of merging stale conflicting work.
  Verification: record the PR state and conclusion in bounded release-ops evidence or TODO update.
