# Brownie TODO Queue

This file is the shared priority queue between the external Brownie phase-loop
controller and Brownie itself.

`phase-loop.md` remains the execution prompt and product boundary contract.
`todo.md` is the ordered list of concrete work items Brownie should consume.
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

- [ ] E-15a: Teach runtime operational evidence to execute artifact lifecycle
  checks through local release targets:
  Route: implementation.
  Files: `scripts/release-runtime-operational-evidence.mjs`,
  `scripts/guard-runtime-operational-evidence.test.mjs`,
  `docs/architecture/local-release-targets.schema.json`, and
  `docs/architecture/local-release-targets.example.json` if schema/example
  changes are needed.
  Implement bounded SSH/local delegation for target-host artifact lifecycle
  checks using the existing `docs/architecture/local-release-targets.*`
  contract and the optional local manifest `.brownie/local-release-targets.json`.
  Do not read or require a repository-tracked
  `docs/architecture/local-release-targets.json`; if the local manifest is
  missing, invalid, incompatible, unreachable, or any target execution fails,
  keep evidence fail-closed and do not mark `runtime_release_ready` or
  `release_ready` true.
  Verification: run
  `pnpm --workspace-root release:runtime-operational-evidence:test`,
  `pnpm --workspace-root guard:runtime-operational-evidence:test`,
  `pnpm --workspace-root guard:runtime-operational-evidence`, and
  `pnpm --workspace-root guard:release-contract`.

- [ ] E-15b: Regenerate runtime operational evidence after E-15a on the
  configured Linux and Windows VM targets:
  Route: implementation/evidence.
  Files: `.brownie/release-evidence/runtime-operational-evidence.json` and any
  target-local artifact lifecycle evidence files produced under
  `.brownie/release-evidence/`.
  Run the delegated artifact lifecycle against Linux and Windows targets from
  `docs/architecture/local-release-targets.*`, confirm each target records
  checksum verification, install/version/help execution, update, rollback, and
  uninstall evidence, and leave only real remaining blockers in
  `fail_closed_reasons`.
  Verification: run `pnpm --workspace-root release:runtime-operational-evidence`
  followed by `pnpm --workspace-root guard:runtime-operational-evidence` and
  `pnpm --workspace-root release:gate -- --dry-run`.

- [ ] E-16a-fixture-objective: Make the Golden Journey fixture request a deterministic workspace mutation:
  Source TODO: E-16a: Make the runtime operational Golden Journey fixture exercise the
  Patch only `scripts/release-runtime-operational-evidence.mjs`. Do not read
  or patch `scripts/release-gate.mjs`. In `buildGoldenJourneySection`, replace
  the current `fs.writeFileSync(path.join(fixtureFull, 'objective.md'), ...)`
  objective text with a deterministic request to create or update
  `golden-journey-output.md` inside the fixture with a short completion note.
  Keep the change to one `workspace.write` patch hunk against the existing
  objective string. This leaf is complete when the fixture objective clearly
  requires one repository-local workspace mutation that the CLI JSON run can
  expose as proposal/apply lifecycle evidence.
- [ ] E-16a-fixture-assertions: Require proposal/apply/post-apply/completion evidence before satisfying Golden Journey:
  Source TODO: E-16a: Make the runtime operational Golden Journey fixture exercise the
  Patch `scripts/release-runtime-operational-evidence.mjs` so `golden_journey_fixture.status` remains failed unless proposal preflight, explicit authorization/apply, workspace mutation, post-apply verification, and accepted completion are all observed.
- [ ] E-16a-fixture-guard: Cover Golden Journey fail-closed and satisfied cases:
  Source TODO: E-16a: Make the runtime operational Golden Journey fixture exercise the
  Add `scripts/guard-runtime-operational-evidence.test.mjs` coverage proving incomplete Golden Journey lifecycle evidence is rejected and complete lifecycle evidence is accepted.

- [ ] E-16b: Regenerate runtime operational evidence after E-16a and prove the
  Golden Journey fixture is satisfied:
  Route: implementation/evidence.
  Files: `.brownie/release-evidence/runtime-operational-evidence.json` and
  `.brownie/release-evidence/golden-journey-fixture/`.
  The regenerated evidence must show `golden_journey_fixture.status` as
  `satisfied`, all Golden Journey commands passing, and lifecycle evidence for
  proposal preflight, apply, post-apply verification, and completion all true.
  Verification: run `pnpm --workspace-root release:runtime-operational-evidence`
  followed by `pnpm --workspace-root guard:runtime-operational-evidence` and
  `pnpm --workspace-root release:gate -- --dry-run`.

- [ ] E-13: Write the Documentation Golden Path after E-15b and E-16b are
  current:
  Route: documentation.
  Files: `README.md`, `docs/architecture/runtime-release-contract.json`,
  `docs/architecture/runtime-release-readiness-audit.json`, and any
  Product-Ready/Golden-Path document that already exists.
  Document the local VM artifact lifecycle path, Golden Journey fixture path,
  release evidence regeneration commands, expected fail-closed behavior, and
  the exact command sequence a maintainer should run before final Product Ready
  judgment. Do not claim Runtime Product Ready unless E-14 closes it.
  Verification: run `pnpm --workspace-root guard:runtime-release-readiness`,
  `pnpm --workspace-root guard:release-contract`, and
  `pnpm --workspace-root guard:product-completion`.

- [ ] E-14: Perform final Product Ready judgment after E-13:
  Route: release-judgment.
  Files: `docs/architecture/runtime-release-contract.json`,
  `docs/architecture/runtime-release-readiness-audit.json`,
  `.brownie/release-evidence/runtime-operational-evidence.json`,
  `.brownie/release-evidence/owner-governance-evidence.json`, and
  `.brownie/release-evidence/supply-chain-artifact-evidence.json`.
  Recompute current release evidence on `origin/main`, distinguish Runtime
  technical maturity from unresolved OSS publication decisions, and update the
  release contract/readiness audit only when every Runtime-owned blocker is
  satisfied. If any owner-controlled or external publication decision remains,
  record it as owner/external fail-closed evidence without counting it against
  Runtime technical maturity. Do not set `runtime_release_ready=true` unless
  every release-blocking Runtime-owned condition is satisfied by evidence.
  Verification: run `pnpm --workspace-root release:gate -- --dry-run`,
  `pnpm --workspace-root guard:runtime-release-readiness`,
  `pnpm --workspace-root guard:release-contract`,
  `pnpm --workspace-root guard:owner-governance-evidence`, and the full CI
  check path before PR creation.

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
