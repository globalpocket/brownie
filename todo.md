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

### P1: Runtime / CLI boundary

- [ ] R-16: Migrate `BROWNIE_LLM_ALLOW_TASK_RUN_NETWORK` toward
  `BROWNIE_LLM_ALLOW_PROVIDER_ACCESS`; conflicting settings must fail closed.
- [ ] R-17: Complete `llm_provider_access` separation from generic
  `network_access` across Runtime permissions, Mode Packs, CLI, VSIX, semantic
  contract, docs, ledger evidence, and compatibility migration.
- [ ] R-18: Define Runtime distribution-time Mode Pack trust validation for
  pinned commits, signatures, trust roots, and revocation evidence.
- [ ] R-19: Enforce Ledger Contract single-source correctness: event kind,
  schema, validator, fingerprint, and fixture additions must be CI-gated
  together.
- [ ] R-20: Prove old-ledger compatibility with real historical fixtures for
  load, resume, and replay rejection.

### P0/P1: Release engineering and evidence

- [ ] E-01: Resynchronize phase manifests, Product DoD, Runtime Release
  Contract, release audit, and semantic contract so they point to the same
  current commit and do not retain stale RRP-8.4/RRP-8.6 fingerprints.
- [ ] E-02: Replace fixed readiness fingerprint strings with canonical content
  SHA-256 evidence and invalidate evidence whenever latest head changes.
- [ ] E-03: Populate release evidence fields with current values:
  implementation commit, tested commit, workflow run ID, artifact SHA-256, and
  audited base commit.
- [ ] E-04: Expand CI to include `cargo fmt --all --check`,
  `cargo check --workspace --all-targets --all-features`,
  `cargo clippy --workspace --all-targets --all-features -- -D warnings`,
  `cargo test --workspace --all-features`, frozen pnpm install, root
  check/test/build, executable release gate, Product Completion Guard, and
  process-loss E2E.
- [ ] E-05: Add Linux, macOS, and Windows CI coverage for Runtime release
  readiness where feasible.
- [ ] E-06: Update CI runtime versions and pin GitHub Actions by commit SHA
  where release-gate maturity requires it.
- [ ] E-07: Run and enforce supply-chain checks: `cargo audit --locked`,
  `cargo deny check`, production `pnpm audit`, high-signal secret scan, Rust and
  Node SBOM, lockfile hashes, artifact SHA-256, and build provenance.
- [ ] E-08: Ensure supply-chain tooling absence, scan failure, and network
  failure cannot be treated as successful release evidence.
- [ ] E-09: Produce and verify distributable artifacts for Ubuntu Linux, macOS
  Apple Silicon, and Windows.
- [ ] E-10: For each artifact, verify clean install, `brownie --version`, Base
  Mode Pack load, fake-provider task, ledger generation, forced-stop resume,
  stale/replay rejection, checksum verification, update, rollback, uninstall,
  and source commit match.
- [ ] E-11: Run Golden Journey in an isolated fixture repository across proposal,
  authorization, mutation, ledger append, verifier, and completion crash
  windows.
- [ ] E-12: Run a 100-iteration soak test and record failure rate, seed,
  duration, duplicate side effects, ledger/workspace consistency, and
  unrecoverable-run count.
- [ ] E-13: Write the Documentation Golden Path only after the executable path
  and evidence are current.
- [ ] E-14: Perform final Product Ready judgment without counting unresolved OSS
  publication decisions against Runtime technical maturity.

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
