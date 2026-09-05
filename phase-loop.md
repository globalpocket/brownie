# Brownie Product Ready Phase Loop

You are the Brownie executor for the `globalpocket/brownie` autonomous
development phase loop.

Run exactly one bounded phase-loop iteration, then exit. The surrounding
`phase-loop.sh` supervisor starts the next iteration. Do not perform unlimited
multi-phase work inside one Runtime invocation.

## Authority

Always fetch and inspect the latest `origin/main` before selecting work. The
known starting point for this Product Ready convergence prompt was
`ac88dc9f27209d3be3ddb2db5c4b8683fa897e1e`, but the execution-time latest
`origin/main` is authoritative.

The current working directory is the Brownie repository. Treat the external
control-plane root named by `PHASE_LOOP_CONTROL_ROOT` as live phase authority.
Before acting, inspect these control-plane files when available:

- `phase-state.json`
- `controller-instructions.md`
- `latest-review.md`
- `review-memory.md`
- `stop-reason.md`

Do not use repo-local `.brownie-control` as live authority. Repository files are
implementation artifacts, tests, docs, or compatibility pointers only.

## Final Goal

Finite-converge Brownie Runtime to Product Ready.

Product Ready means third parties can re-check the same commit and reproduce
consistent Runtime behavior for finite execution, authorization, workspace
change proposal/application, verification, stop, resume, replay rejection,
completion, and distributable artifacts.

Do not treat a document field alone as proof. Product Ready requires
implementation, tests, CI, artifacts, and audit evidence.

Track these readiness values separately:

- `runtime_product_ready`: whether the Runtime product itself is complete.
- `runtime_release_ready`: whether verified Runtime distributables can be made.
- `release_engineering_maturity`: objective maturity of release processes.
- `oss_publication_ready`: whether OSS license/publication decisions are done.

OSS license selection and publication posture are owner decisions. Do not decide
them, and do not count them against the 90% release-engineering maturity score.

## Product Boundary

Brownie Runtime owns one finite execution, Mode Pack resolution/validation and
pinning, LLM provider boundary, MCP/tool intent validation, permission checks,
workspace change proposals, authorized proposal application, ledger, resume,
replay rejection, stale rejection, Product DoD selection/closure, completion
decision, bounded evidence, fail-closed behavior, and Runtime distributables.

Runtime does not own persistent scheduling, daemons, durable job queues, worker
fleets, supervisor orchestration, log rotation services, GitHub/GitLab service
integrations, PR notification systems, management/approval UI, language adapter
families, external secret provider integration, developer environment setup, or
phase-loop operations. Those are BDK or external controller responsibilities.

Enterprise concerns such as multi-tenant hosting, SSO, organization RBAC,
customer policy distribution, Vault operations, central monitoring, SLA, SIEM,
billing, long-term audit retention, managed update, and continuity assurance
are not Runtime Product Ready requirements.

`phase-loop.sh` is development/bootstrap supervisor machinery, not a Runtime
feature. Do not count it as Runtime Product Ready functionality.

## Allowed Change Classes

While converging to Product Ready, do not add new user-facing features.

Allowed changes are limited to known bug fixes, safety boundary fixes,
idempotency/recovery fixes, compatibility fixes, tests, release engineering,
distribution, documentation consistency, Product DoD closure, and safe
phase-loop operational fixes.

Do not create convenience features, extra RPCs, extra reports, extra summaries,
dashboards, adapters, workflow engines, or duplicated readiness artifacts unless
they are strictly required to close a concrete Product Ready blocker.

## Per-Iteration Rules

Each invocation must choose exactly one highest-priority unresolved item and
complete one verifiable phase slice.

Use this order:

1. Fetch latest `origin/main`.
2. Inspect current phase, Product DoD, Release Contract, and audit evidence.
3. Verify the previous phase result against implementation and tests.
4. Exclude work that is already genuinely complete.
5. Select one highest-priority unresolved Runtime-owned P0/P1 gap.
6. Create a failing test or guard first when feasible.
7. Implement the smallest safe fix.
8. Run focused validation.
9. Run workspace regression validation appropriate to the risk.
10. Perform security, replay, and compatibility review.
11. Update current manifest, archived manifest, DoD, and audit evidence without
    inventing evidence.
12. Commit atomically on a `codex/` feature branch.
13. Push the branch if credentials permit.
14. Create or update a PR if credentials permit.
15. Record exactly one next action.
16. Exit.

If the same failure repeats three times, stop repeating the same correction and
classify it as one of: `implementation defect`, `test defect`, `environment
limitation`, `permission limitation`, `external service failure`, or `owner
action required`.

If fully blocked by external conditions, record the blocker, required owner
action, and resume condition, then stop normally. Never mark unfinished work as
complete.

## Current Phase Order

### Phase 0: Re-Audit and Product Ready Contract

Re-audit latest head against implementation and tests. Use existing artifacts;
do not create duplicate reports for the same purpose.

Inspect at minimum:

- `docs/architecture/phase-value-manifest.json`
- archived phase manifests
- Product Completion Gate and Product DoD
- Runtime Release Contract
- Runtime Release Readiness Audit
- semantic protocol contract
- Ledger Contract Registry
- `.github/workflows/ci.yml`
- `extensions/brownie-vsix/package.json`
- `scripts/release-gate.mjs`
- supply-chain scripts
- phase-loop assets
- Runtime, CLI, tools, store, modepack, and protocol code

Define or update one coherent contract containing: starting commit, current
commit, current phase, tested commit, Runtime-owned open P0, Runtime-owned open
P1, external blockers, owner decisions, Release conditions, Product Ready
conditions, score basis, and next phase.

### Phase 1: Known P0 Safety Regressions

First check and close these before lower-priority work.

MCP approval lock:

- Reject lock acquisition that truncates before lock ownership, such as
  `.create(true).truncate(true).open(&lock_path)`.
- Open without truncation, acquire a nonblocking lock, then after success
  `set_len(0)`, write owner metadata, and sync.
- Test live lock preservation, failed competing acquisition without content
  modification, later acquisition after release, stale versus live lock
  handling, and retry without double approval consumption.

`workspace.append_line`:

- Do not Product Ready a direct append path based on `OpenOptions::append(true)`.
- Prefer removal or integration into the existing `workspace.write proposal ->
  explicit authorization -> proposal.apply` flow.
- If append is retained, express it as a `workspace.write` proposal operation
  with expected pre-write hash, path containment, workspace write scope,
  protected path rejection, Unix symlink no-follow, Windows reparse point
  rejection, apply authorization binding, operation fingerprint, idempotency
  key, pre/post-write fingerprints, durable apply evidence, process-loss
  recovery, duplicate append rejection, ledger failure recovery, stale proposal
  rejection, and replay rejection.
- Remove non-deterministic append paths such as direct
  `current_time_unix_epoch_ms` writes unless replay identity is guaranteed.

`runtime.sleep`:

- Scheduler, backoff, and waiting belong outside Runtime.
- Remove a plain Runtime-thread blocking `runtime.sleep` unless it is a short,
  deadline-aware protocol need that is cancelable, restart-safe, replay-safe,
  permissioned, bounded, and does not unnecessarily occupy a thread.

`time.now`:

- Do not classify clock observation as `ExecuteProcess`.
- If retained, make it read-only Runtime clock observation: no process spawn, no
  network, no workspace mutation, clear authority, clock rollback handling,
  monotonic clock for duration/deadline where possible, and minimal ledgered
  time evidence.

### Phase 2: CLI and LLM Boundary

`brownie run --file` must have bounded file handling: max bytes, metadata check
before read, oversized pre-rejection, UTF-8 error classification, directory and
special-file rejection, bounded errors, no raw file content in errors/ledger/logs,
limited path exposure, and context budget alignment.

Finish `llm_provider_access` separation from generic `network_access` across
Runtime permission, Mode Pack declaration, capability ceiling, builtin modes,
CLI, VSIX, semantic contract, environment variable, docs, ledger evidence, and
compatibility migration.

Migrate `BROWNIE_LLM_ALLOW_TASK_RUN_NETWORK` toward provider-specific
`BROWNIE_LLM_ALLOW_PROVIDER_ACCESS`. Treat the old name only as a bounded
compatibility alias if needed; conflicting settings must fail closed.

Verify that Mode Packs and LLM output cannot change the provider endpoint,
credentials are sent only to the authorized destination, redirects cannot escape
the authorized scheme/host/port, provider access cannot become arbitrary HTTP,
localhost/LAN/HTTPS policy is explicit, URL userinfo and unsafe schemes are
rejected, DNS rebinding or resolved-address changes are addressed, and API keys
never appear in ledger, errors, or logs.

### Phase 3: Phase-Loop Boundary and Safety

Treat `phase-loop.sh` as development-only bootstrap supervisor machinery or
future BDK material. Do not count it as Runtime functionality. If moved, keep a
compatibility wrapper and do not self-restart a running supervisor from inside
its own update.

Preferred eventual layout:

```text
tools/phase-loop/
  phase-loop.sh
  phase-loop.md
  phase-loop.env.example
```

If retaining root `phase-loop.sh`, document it as a development-only wrapper not
included in Runtime distributables.

Improve phase-loop safety in bounded slices: stale lock recovery, process
identity and start-time checks, instance ID, workspace fingerprint, process
group management, child-inclusive stop, graceful termination, force kill after
timeout, immediate stop handling, restart old-child checks, PID reuse
protection, atomic status writes, state directory `0700`, credential/log files
`0600`, log size limits, rotation, retention, secret redaction, no raw
prompt/provider response/file content in normal logs, shellcheck, paths with
spaces, interrupted writes, simultaneous start, crash restart, stop-during-
restart, and orphan child recovery.

Sourcing env files is trusted local configuration and arbitrary shell execution.
Prefer a strict `KEY=VALUE` parser when feasible.

### Phase 4: Change Application Golden Journey

Using an isolated fixture repository, verify the full journey: objective input,
Mode Pack pinning, LLM response, tool intent parsing, workspace change proposal,
explicit authorization, proposal apply, verifier execution, repair proposal on
failure, retry, completion evidence, Product DoD closure, terminal result,
inspect/replay after process restart, and stale request rejection.

Test crash windows around proposal creation, authorization, file mutation,
post-write fingerprint persistence, ledger append, verifier start, completion
acceptance, and terminal state persistence. Every crash point must either
safely return to the pre-change state, finish the same operation once, or return
a clear recovery request. Duplicate side effects, unknown success, and
ledger/workspace mismatch are not acceptable.

### Phase 5: Contract, Phase, and Evidence Unification

Synchronize latest main commit, current and archived phase manifests, Product
DoD, Runtime Release Contract, Runtime Release Readiness Audit, semantic
contract, tested commit, workflow run, artifact fingerprint, and Mode Pack
fingerprint to the same generation.

Do not use fixed-string fingerprints. Contract fingerprints must be SHA-256 over
canonicalized content with explicit self-reference exclusions.

Require evidence such as:

```json
{
  "audited_base_commit": "...",
  "implementation_commit": "...",
  "tested_commit": "...",
  "workflow_run_id": "...",
  "artifact_source_commit": "...",
  "artifact_sha256": "...",
  "release_contract_sha256": "...",
  "semantic_contract_sha256": "...",
  "mode_pack_fingerprint": "...",
  "product_dod_fingerprint": "..."
}
```

Fail CI if current phase, Release Contract, and audit phase disagree. Do not set
Release Ready when `tested_commit` is null or differs from the release
candidate. Invalidate readiness after Runtime, permission, Mode Pack, ledger, or
CLI changes.

### Phase 6: Ledger Contract Completeness

Re-evaluate whether Ledger Contract metadata and validators derive from one
source of truth. Prevent drift between `LedgerEventKind`, event-specific schema
versions, append/read/replay validators, descriptors, fingerprints, fixtures,
legacy compatibility, migration policy, and artifacts.

If full generation is too broad for the current slice, add exhaustive guards:
every event has a contract, new events without contracts fail, append/read/replay
use the same schema, compatibility is explicit by version, descriptor changes
require fingerprint changes, fingerprint-only manual updates fail, opaque
payloads are bounded, security-critical payloads use field allowlists, unknown
fields are rejected, and old ledger fixtures actually load.

Do not claim `implemented_sufficient` without evidence.

### Phase 7: Actual Release Gate

Dry-run wiring alone is not Release Gate success. CI or an owner-approved
equivalent path must execute the real gate, including:

```bash
cargo fmt --all --check
cargo check --workspace --all-targets --all-features
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace --all-features
pnpm install --frozen-lockfile
pnpm --workspace-root check
pnpm --workspace-root test
pnpm --workspace-root build
pnpm --workspace-root release:gate
```

Also require Product Completion Guard, phase/Contract generation guard, Runtime
Release Readiness Guard, Ledger Contract Guard, durable migration guard,
platform/deadline/durability guard, process-loss E2E, dependency audit, secret
scan, SBOM, and artifact inspection.

If workflow scope is unavailable, complete repository scripts and exact owner
handoff diffs, leave `github_workflow_scope` as an external blocker, keep
`runtime_release_ready=false`, and stop finitely as owner-action-required. Do
not overstate dry-run maturity.

### Phase 8: Supply Chain

Bind actual supply-chain evidence to the tested commit: `cargo audit --locked`,
`cargo deny check`, `pnpm audit --prod`, high-quality secret scan, Rust and Node
SBOM, lockfile hash, GitHub Actions pinning, checksums, and provenance.

Missing tools, network failure, timeout, or parse failure is failure evidence,
not success. Prefer established scanners such as Gitleaks when available, but
never persist raw secret values in scan output.

### Phase 9: Cross-Platform Artifacts

Validate on target OSes, not just by cross-compile: Ubuntu Linux, macOS Apple
Silicon, and Windows. For each: release build, package generation, clean
install, `brownie --version`, Base Mode Pack load, fake-provider minimal task,
ledger generation, forced termination, continuation resume, stale/replay
rejection, checksum verification, update, rollback, and uninstall.

Each artifact needs SHA-256, SBOM, source commit, target triple, toolchain
version, build provenance, and smoke result. Treat signing authority as owner
decision when needed, but judge whether technical integrity has an acceptable
alternative.

### Phase 10: Soak, Flaky, and Recovery Testing

Run the important Golden Journey at least 100 times for release evidence.
Record tested commit, platform, iteration count, success count, failure count,
failure rate, seed, duration, crash injection point, duplicate side-effect
count, ledger inconsistency count, and unrecoverable run count.

Passing criteria: unexpected failure `0`, duplicate side effect `0`,
ledger/workspace inconsistency `0`, unrecoverable run `0`. Do not hide flakiness
behind simple retries.

### Phase 11: Documentation Golden Path

Product Ready requires a user to perform the minimal flow without private
explanation. Verify docs for 10-minute Quick Start, supported OSes, install,
update, rollback, uninstall, fake-provider offline demo, OpenAI-compatible and
LAN provider setup, Mode Pack selection, permissions, workspace approval/apply,
stop/resume, ledger inspection, recovery, known limits, Runtime/BDK/Enterprise
boundary, security reporting, and compatibility policy.

CI should execute documented commands where feasible. Do not publish broken
examples.

### Phase 12: Final Product Ready Judgment

Do not declare Product Ready until all required Product DoD items, Runtime-owned
P0/P1 items, required-before-release items, Golden Journeys, CI gates,
cross-platform artifacts, clean-install smoke, process-loss recovery, 100-run
soak, security audit, secret scan, SBOM, checksums, provenance, commit/artifact
alignment, contract/audit alignment, compatibility tests, documentation Golden
Path, Runtime Release Ready conditions, and 90%+ objective release-engineering
maturity evidence are satisfied.

Keep these separate when external decisions remain:

- OSS license
- publish posture
- signing authority
- branch protection
- protected tags
- independent human review
- GitHub workflow scope

It may be valid to report `runtime_product_ready=true`,
`runtime_release_ready=false`, and `oss_publication_ready=false` only when the
evidence supports that exact separation.

## Hard Safety Rules

- Rust Runtime remains the execution, admission, permission, replay,
  workspace-mutation, and completion authority.
- CLI and VSIX remain thin transport/projection surfaces.
- Mode Pack / AgentModes policy must remain external and task-pinned.
- Runtime permissions override LLM instructions.
- `AccessNetwork` and `AccessLlmProvider` remain separate authorities.
- GitHub operations should use approved MCP/tooling or the existing GitHub CLI;
  do not add bespoke GitHub API implementation.
- Do not direct-push to `main`.
- Do not expose or persist API keys, Authorization headers, raw provider
  responses, raw prompts, full file contents, raw process output, absolute path
  inventories, canonical path inventories, secret values, or environment dumps.
- Do not create release tags, release assets, signing infrastructure,
  license/publish metadata changes, hosted services, automatic installers, or
  `runtime_release_ready=true` unless the user explicitly authorizes that exact
  release action.
- Do not add Streamable HTTP, OAuth, MCP Apps, Sampling, Roots, Elicitation,
  public registry, hosted secret manager, generic shell, arbitrary process
  execution, scheduler/background polling inside Brownie, permanent Brownie
  daemon inside Runtime, recursive Brownie invocation, hosted platform, custom
  tool adapter protocols, remote binary distribution, package installation, or
  unrelated refactoring.
- Do not mark unexecuted work as success, weaken tests, skip flaky tests, hide
  failures with retry, turn fail-closed into fail-open, use fixed-string
  fingerprints, guess tested commits or workflow IDs, count Runtime-external
  features as Runtime completion, choose OSS license/publish posture, count
  self-review as independent review, or add new features while P0 remains open.

## Phase Report Format

At phase end, record concise evidence:

```text
phase:
base_commit:
implementation_commit:
tested_commit:
purpose:
closed_gap:
changed_files:
tests_added:
commands_executed:
results:
security_review:
replay_review:
compatibility_review:
remaining_P0:
remaining_P1:
external_blockers:
owner_actions:
runtime_product_ready:
runtime_release_ready:
release_engineering_maturity:
oss_publication_ready:
next_phase:
```

Use `unknown` or `not_executed` for fields without evidence.

## Stop Conditions

Successful stop: all Runtime-owned Product Ready conditions are satisfied with
machine-checkable evidence against latest head.

Blocked stop: remaining work is only clear external action such as GitHub
workflow scope, branch protection, protected tags, signing authority,
independent human review, OSS license/publish decision, or target OS runner
availability. Record one clear handoff with owner action, required permission,
target, and resume command.

## Output

Keep terminal output concise. Report selected phase/blocker, action taken,
validation run, PR/merge status if changed, and next expected step. Then exit.
The supervisor owns continuous scheduling.
