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

- [ ] E-14a-owner-evidence-section: Patch only `docs/architecture/final-product-ready-judgment.md` with owner governance evidence:
  Source TODO: E-14a: Write the final Product Ready judgment input memo.
  Read only `docs/architecture/final-product-ready-judgment.md` and
  `.brownie/release-evidence/owner-governance-evidence.json`. Replace the
  existing `## Owner/External Publication Decisions` section in the judgment
  document; do not insert a second section with the same heading. The section
  must classify owner-governance evidence as fail-closed for independent
  reviews and remote CI provenance when the evidence says so, and must mention
  satisfied protected tag and integrity authority evidence when present. Do not
  edit JSON files. The next tool intent must be a complete fenced
  `brownie-tool-intent` JSON block ending with a line containing exactly three
  backticks.
- [ ] E-14a-supply-chain-evidence-section: Patch only `docs/architecture/final-product-ready-judgment.md` with supply-chain evidence:
  Source TODO: E-14a: Write the final Product Ready judgment input memo.
  Read only `docs/architecture/final-product-ready-judgment.md` and
  `.brownie/release-evidence/supply-chain-artifact-evidence.json`. Add or
  update a bounded section describing supply-chain/artifact evidence and
  fail-closed blockers. Do not edit JSON files.
- [ ] E-14a-final-summary: Patch only `docs/architecture/final-product-ready-judgment.md` with the final judgment summary:
  Source TODO: E-14a: Write the final Product Ready judgment input memo.
  Read only `docs/architecture/final-product-ready-judgment.md`. Add or update
  a final summary that states which Runtime-owned release blockers are
  satisfied, which remain fail-closed, and which items are owner/external
  publication decisions. Verification: run `pnpm --workspace-root check`.
- [ ] E-14b: Update release contract/readiness audit only if E-14a proves a
  Runtime-owned judgment change is required:
  Route: release-judgment/contract.
  Files: `docs/architecture/runtime-release-contract.json` and
  `docs/architecture/runtime-release-readiness-audit.json`.
  Use `docs/architecture/final-product-ready-judgment.md` as the input. If the
  memo shows only owner/external blockers remain, keep `runtime_release_ready`
  false and record the remaining fail-closed state without counting it as a
  Runtime implementation defect. If Runtime-owned blockers remain, preserve
  them as release-blocking evidence. Do not set `runtime_release_ready=true`
  unless every release-blocking Runtime-owned condition is satisfied by current
  evidence.
  Verification: run `pnpm --workspace-root release:gate -- --dry-run`,
  `pnpm --workspace-root guard:runtime-release-readiness`, and
  `pnpm --workspace-root guard:release-contract`.
- [ ] E-14c: Verify and package the final Product Ready judgment PR:
  Route: release-judgment/verification.
  Files: `docs/architecture/final-product-ready-judgment.md`,
  `docs/architecture/runtime-release-contract.json`, and
  `docs/architecture/runtime-release-readiness-audit.json`.
  Run the full local check path, confirm owner-governance evidence remains
  fail-closed for owner/external decisions when applicable, and leave the queue
  ready for PR creation/merge.
  Verification: run `pnpm --workspace-root check`,
  `pnpm --workspace-root guard:owner-governance-evidence`, and
  `pnpm --workspace-root phase-loop:implementation-preflight`.

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
