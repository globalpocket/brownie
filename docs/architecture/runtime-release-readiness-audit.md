# Brownie Runtime Release Readiness Audit

This audit is the bounded source of truth for the Runtime Release Readiness P0/P1 finite closure campaign. It does not declare Brownie Runtime release-ready; it records the remaining Runtime-owned blockers and keeps external platform, adapter, commercial, BDK, Enterprise, and Assurance work outside the Runtime release gate.

Audited main: `db3a217cf0b38475ea7fb614bb2541f14325b544`

RRP-1 adds the guarded canonical Runtime boundary contract at
`docs/architecture/runtime-boundary-canonical-contract.json`. The Runtime
release-readiness guard validates that contract for required boundary surfaces,
method subset, CLI/VSIX/Runtime/spec anchors, compatibility matrix entries, and
non-authority language through the existing VSIX-invoked check path.

RRP-2 adds the explicit Runtime-owned `task.cancel` command. Cancellation now
requires caller authorization, task/run identity, current-state freshness,
bounded cancel request fingerprinting, and exact durable replay evidence before
terminal `TaskCancelled` evidence can be produced or reused.

MCP-S4.1 records a post-closeout corrective to the MCP Runtime Safety baseline:
approval-required MCP execution now uses Runtime-owned monotonic approval state,
public `mcp.tool.approve`, pre-spawn atomic claim, consumed/outcome-unknown
terminalization, and retry/reuse denial from durable attempt evidence.

RRP-3 closes local real process-loss recovery E2E for MCP approval execution:
claim serialization now uses an OS-owned advisory file lock over a
non-authoritative residual lock file, `headless.run.recovery_probe` invokes
Runtime-owned unfinished approval recovery so latest `executing` evidence
monotonically converges to `outcome_unknown` exactly once, and
`test:rrp3-process-loss` launches actual `brownie-runtime` child processes,
kills/restarts Runtime across stale-lock, executing-before-spawn, mid-tool-call,
independent-process race, and terminal-consumed windows, and verifies at most
one fake MCP `tools/call`.

RRP-3.1 closes the MCP execution/recovery race found after RRP-3: Runtime now
retains the approval claim lock from `executing` evidence through the actual
`tools/call` and terminal append, terminalization rereads latest matching
approval state and refuses terminal-to-terminal or changed-fingerprint
transitions, recovery uses a nonblocking attempt on the same lock and skips live
owners without ledger mutation, and the existing CI-invoked VSIX check path now
runs `pnpm --workspace-root test:rrp3-process-loss`. Direct `.github` workflow
wiring remains blocked by missing OAuth `workflow` scope and is left to the
dedicated CI hardening phase.

RRP-4.1 corrects the durable schema migration closure: Runtime/store now
advances the local durable store schema from v1 to v2 through an explicit
migration registry, persists a bounded `migration_in_progress` marker before
migration work, writes the v2 `store-layout.json` marker through the synced
atomic helper, and replaces `.brownie/store-schema.json` with current v2 only
after the marker validates. First-touch recovery resumes interrupted v1-to-v2
migration idempotently after process loss at the in-progress manifest write, the
layout marker write, or the current v2 manifest write. Existing v1 task state,
run ledger order, and headless checkpoint fingerprints are preserved
byte-for-byte before post-migration resume mutation. Conflicting partial
migration state, corrupt manifests, future versions, newer minimum-runtime
versions, missing current layout markers, and unsupported migration states fail
closed before durable mutation. The manifests record bounded compatibility
metadata only; they do not ledger raw prompts, provider responses, file
contents, paths, secrets, environment values, executable contents, or process
output.

RRP-5 remains a partial protocol/event canonization baseline: the canonical
ownership map at
`docs/architecture/runtime-protocol-event-canonical-map.json` now binds Runtime
JSON-RPC method groups, the generated proposal diagnostics compatibility family,
coarse event domains, durable ledger variants, the CLI transport subset, VSIX
validators/client calls, and protocol docs. The
`guard:protocol-event-canonization` check extracts Runtime `METHOD_*`
constants, dispatch arms, `EventKind`, and `LedgerEventKind` variants, then
fails on unmapped methods/events or declared anchor drift. The existing
CI-invoked VSIX check path runs this guard. RRP-5.1 remains required before
release for a machine-readable Rust-generated semantic protocol schema,
Rust-serialize-to-JSON-to-TypeScript golden contracts, required/optional/null,
enum and error-payload semantics, backward compatibility, unknown field/variant
policy, and durable event migration coupling.

RRP-6 closes runtime module decomposition reevaluation: the finite assessment
at `docs/architecture/runtime-module-decomposition-assessment.json` records
Runtime source metrics, production/test split, public/private item counts, and
authority-hotspot counts for state mutation, durable writes, permission,
recovery, RPC dispatch, approval, MCP, Product DoD, and diagnostics. The phase
also moves the `task.list` handler and task-list transport-bound helpers into
`crates/brownie-runtime/src/task_progress.rs`, colocating them with task
progress projection authority. The `guard:runtime-module-decomposition` check
validates the assessment against live source, required boundary tokens, lib.rs
ceilings, task-progress ownership, and non-authority rules, and the existing
CI-invoked VSIX check path runs this guard.

RRP-7.1 closes the reopened local Runtime platform/deadline/durability blocker:
`TaskStore::write_task_state` uses the shared synced atomic write helper, Unix
parent-directory sync is a checked durable-write step, MCP stdio response wait
and child-exit wait share one absolute `RuntimeDeadline`, late child exits are
bounded by the same timeout budget and record process-tree kill evidence, task
terminal updates can require current status plus `updated_at` freshness before
completion/cancel overwrites, and deterministic durable write failpoints cover
disk-full, truncated-temp, and rename-denial cases. The
`guard:platform-deadline-durability` check now requires those implementation
tokens, behavior tests, and bounded cross-platform boundary statements through
the existing CI-invoked VSIX check path. This does not claim Windows/macOS
durability parity, hosted process management, direct workflow hardening, or
Runtime Release Ready.

| ID | Priority | Classification | Status | Responsibility | Release classification | Evidence summary | Next action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `runtime-release-debt-reaudit` | P0 | Runtime Release debt reaudit | implemented sufficient | Runtime | closed | Required specs, manifests, guards, crates, CLI, VSIX, and CI were reaudited and are now backed by a machine guard. | Use this artifact as the source for the remaining bounded closure phases. |
| `runtime-boundary-protocol-contracts` | P0 | Boundary Protocol gaps | implemented sufficient | Runtime | closed | RRP-1 adds a canonical Runtime boundary contract and compatibility matrix, and the release-readiness guard validates required surfaces, method subset, anchors, and non-authority language. | Use the guarded canonical boundary contract while closing the remaining Runtime Release Readiness blockers. |
| `explicit-cancel-command` | P0 | Cancel semantics | implemented sufficient | Runtime | closed | RRP-2 adds `task.cancel` as a caller-authorized Runtime boundary with task/run identity, freshness checks, bounded cancel fingerprinting, single `TaskCancelled` terminal evidence, exact replay semantics, and VSIX thin validation. | Use `task.cancel` as the explicit cancellation boundary while closing the remaining blockers. |
| `real-process-loss-recovery-e2e` | P0 | Real process loss Recovery E2E | implemented sufficient | Runtime | closed | RRP-3.1 keeps the RRP-3 real process-loss baseline and adds execution-scoped lock retention across live `tools/call`, latest-state terminal append validation, nonblocking recovery skip for live owners, concurrent recovery no-duplicate coverage, live recovery no-op coverage, and CI-required execution through the existing VSIX check path. | Use RRP-3/RRP-3.1 process-loss and race-safety evidence as the local Runtime recovery baseline while closing the remaining Runtime Release Readiness blockers. |
| `durable-schema-version-and-migration` | P0 | Durable schema version/migration | implemented sufficient | Runtime | closed | RRP-4.1 adds an explicit v1-to-v2 migration registry, `migration_in_progress` crash marker, v2 `store-layout.json` marker, real process-loss migration resume at each durable checkpoint, v1 task/run/ledger fixture preservation, and partial migration conflict rejection before task/run/journey/checkpoint/ledger mutation. | Use the RRP-4.1 durable schema migration and interrupted recovery baseline while closing RRP-5.1 and then the CI release gate. |
| `runtime-release-guard-ci` | P0 | CI Release Gate | partial | Runtime | required before release | RRP-3.1 adds the process-loss E2E to the existing VSIX check script that CI invokes; RRP-4.1 adds durable schema migration behavior tests plus a guard that detects deletion/drift of the migration evidence, but direct `.github` workflow wiring remains blocked by missing OAuth `workflow` scope; RRP-5, RRP-6, RRP-7, and RRP-7.1 add protocol/event, module-decomposition, platform/deadline/durability, absolute deadline, failure-injection, and terminal-race guards to that same CI-invoked path. Full release-gate hardening remains open for frozen install, fmt, audit/SBOM/secret/dependency, and complete release policy coverage. | Close direct workflow wiring and remaining full CI release-gate hardening only after RRP-5.1 closes and workflow-scope credentials or an owner-approved equivalent CI-hardening path are available. |
| `mcp-runtime-safety-policy` | P0 | MCP Runtime Safety Policy finite closure | implemented sufficient | closed | A follow-on MCP safety campaign is registered without replacing the MCP-first architecture; MCP-S1 result semantics, MCP-S1.1 protocol-conformance correction, MCP-S2 tool-level Brownie safety policy, MCP-S3 annotation provenance/drift checks, MCP-S4 tool-level approval binding, MCP-S4.1 approval consumption/retry safety, MCP-S5 runtime input/output schema validation, MCP-S6 secret reference contract, and MCP-S7 executable identity are closed. MCP stdio execution is now result-safe, policy-bound, annotation/catalog drift checked, approval-state-bound, schema-validated, secret-reference scoped, and executable-identity pinned before launch. | Use this closed MCP safety baseline while continuing the other Runtime Release Readiness P0/P1 blockers. |
| `oss-release-technical-basis` | P1 | OSS Release technical basis | owner decision waiting | Owner | owner decision | Cargo workspace remains `UNLICENSED` and `publish = false`. | Owner must decide license/publish posture before OSS Release Ready. |
| `protocol-event-canonization` | P1 | Protocol/Event canonization | partial | Runtime | required before release | RRP-5 adds a canonical ownership/drift map, but RRP-5.1 is still required for machine-readable Rust-generated semantic protocol schema, golden Rust-to-TypeScript contracts, payload semantics, compatibility, unknown-field policy, and durable event migration coupling. | Close RRP-5.1 after RRP-7.1. |
| `runtime-module-decomposition-reevaluation` | P1 | Runtime module decomposition reevaluation | implemented sufficient | Runtime | closed | RRP-6 adds a finite module-decomposition assessment with source metrics and hotspot counts, physically moves `task.list` transport-bound ownership into `task_progress.rs`, and adds a guard/test suite that fails closed on metric drift, missing boundary tokens, or task-list ownership regressions. | Use the guarded RRP-6 module decomposition assessment as the release baseline while closing the remaining Runtime-owned blockers. |
| `platform-deadline-durability-hardening` | P1 | Platform/deadline/durability hardening | implemented sufficient | Runtime | closed | RRP-7.1 shares one absolute MCP stdio deadline across response and child-exit waits, bounds late child exits with process-tree kill evidence, checks task terminal status freshness before completion/cancel overwrites, and adds deterministic durable write failure-injection tests for disk-full, truncated-temp, and rename-denial cases. | Use the guarded RRP-7.1 baseline while closing RRP-5.1 before the CI release gate. |
| `hosted-scheduler-daemon-worker-fleet` | P2 | Hosted control plane | runtime-outside | External Control Plane | post-v0 | Scheduler, daemon, queue, worker fleet, leases, hosted isolation, metrics, alerts, SLA, and billing remain outside Runtime release. | Track outside Runtime Release Readiness. |
| `forge-notification-adapters` | P2 | Forge/notification adapters | runtime-outside | External Adapter | post-v0 | GitHub/GitLab App, PR workflows, Slack/Teams/email, SIEM, OTel, and customer integrations remain external adapter readiness. | Track outside Runtime Release Readiness. |
| `enterprise-commercial-readiness` | P2 | Enterprise/commercial readiness | runtime-outside | Commercial Solution | post-v0 | Tenant admin, SSO/RBAC server, customer admin UI, certified stack, continuity assurance, and BDK/Enterprise/Assurance products are outside this campaign. | Do not block Brownie Runtime release on these items. |

Runtime Release Ready remains `false` while the remaining required-before-release
Runtime P0/P1 items remain open: `runtime-release-guard-ci`,
and `protocol-event-canonization`.
