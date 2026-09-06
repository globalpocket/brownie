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
- Runtime Product Ready is not reached.

## Queue protocol

- Pending work is represented by unchecked Markdown task items: `- [ ] ...`.
- The first unchecked item is the highest-priority pending TODO.
- Until durable claim-state support is implemented, do not rely on deleting a
  TODO as the only record that work started. That legacy rule has a lost-work
  crash window and must be fixed by the first BDK/Supervisor TODO below.
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

### P0: Phase Loop / BDK Supervisor

- [ ] B-01: Replace remove-on-start TODO consumption with a durable atomic claim
  protocol: `pending`, `claimed`, `in_progress`, `blocked`, `completed`, stable
  claim IDs, fsync/sync evidence, and restart-safe recovery.
- [ ] B-02: Add TODO queue compare-and-swap protection with queue generation,
  content fingerprint, stale snapshot rejection, and safe handling of external
  reordering/additions.
- [ ] B-03: Replace dirty-worktree/non-main-branch heuristics for in-progress
  work with explicit durable claim state so unrelated changes or abandoned
  branches do not keep an empty queue alive forever.
- [ ] B-04: Add deterministic progress fingerprints for each supervisor run
  using commit, selected TODO/phase, route, closure, applied/accepted/finalized
  state, and next action.
- [ ] B-05: Persist stagnation counts across supervisor restarts and classify
  repeated identical progress fingerprints as `no_progress` instead of healthy
  success.
- [ ] B-06: Drive Brownie with structured CLI output such as
  `brownie --json run --file` and validate against a stable schema instead of
  parsing human text.
- [ ] B-07: Split successful process exit from actual product progress:
  `exit 0` without workspace change, accepted completion, or blocker
  classification must not reset progress health.
- [ ] B-08: Harden generated effective prompts from PR #394: avoid durable raw
  prompt storage where possible, or enforce `0600`, size limits, retention,
  redaction, and prompt/queue fingerprints instead of keeping sensitive content.
- [ ] B-09: Detect truncation when embedding TODO and base prompt snapshots;
  record bounded metadata and fail closed when the selected TODO is incomplete.
- [ ] B-10: Detect TODO changes between queue read and Runtime start using queue
  fingerprint/generation and retry with a fresh claim when stale.
- [ ] B-11: Add child-inclusive stop behavior for supervisor-managed Runtime
  processes, including graceful termination, bounded force timeout, process
  group handling, and orphan child recovery.
- [ ] B-12: Make supervisor waits interruptible so stop requests are honored
  during backoff and long Brownie timeouts.

### P0: Brownie Runtime safety

- [ ] R-01: Fix MCP approval lock acquisition so live lock content is never
  truncated before ownership; add competing-acquisition, process-loss,
  stale-lock, retry, and double-consumption tests.
- [ ] R-02: Remove direct `workspace.append_line` or route it through the
  authorized `workspace.write` proposal/apply path with hash, permission,
  fingerprint, idempotency, durable evidence, and replay rejection.
- [ ] R-03: Remove unbounded Runtime-thread `runtime.sleep`; if any short
  protocol wait remains, prove cancel, deadline, restart, replay, permission,
  and boundedness behavior.
- [ ] R-04: Reclassify `time.now` as read-only Runtime clock observation rather
  than `ExecuteProcess`, with bounded ledger evidence and rollback/duration
  handling where applicable.
- [ ] R-05: Repair sensitive prompt detection so it no longer always returns an
  empty result; support low-false-positive detection or an explicit documented
  override.
- [ ] R-06: Enforce `sensitive_guard=fail` before provider transmission; setting
  and behavior must agree and fail closed.
- [ ] R-07: Stop persisting `prompt_preview` when key-like or sensitive input is
  detected; record only classification, counts, and bounded evidence.
- [ ] R-08: Prove provider egress constraints: fixed scheme/host/port, userinfo
  rejection, redirect escape prevention, DNS rebinding or resolved-address
  change handling, and no arbitrary HTTP escalation.
- [ ] R-09: Repair Runtime/CLI continuation so repeated `unknown_nonterminal` +
  `inspect_progress_overview` runs return structured progress, blocker, or
  executable candidates and finite termination inside a run.
- [ ] R-10: Invalidate safety/readiness evidence automatically when permission,
  Mode Pack, ledger, or other Runtime-safety code changes after the tested head.

### P1: Runtime / CLI boundary

- [ ] R-11: Bound `brownie run --file` by configurable maximum byte size aligned
  with context budget.
- [ ] R-12: Add metadata checks before reading `run --file` input and reject
  oversized files before content read.
- [ ] R-13: Reject directories, FIFOs, devices, sockets, and other non-regular
  files for `run --file`.
- [ ] R-14: Return bounded structured UTF-8 errors for invalid `run --file`
  input.
- [ ] R-15: Prevent file path and content leakage from `run --file` errors,
  ledger, and logs; avoid absolute paths and raw input bodies.
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
