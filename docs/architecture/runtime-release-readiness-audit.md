# Brownie Runtime Release Readiness Audit

This audit is the bounded source of truth for the Runtime Release Readiness P0/P1 finite closure campaign. It does not declare Brownie Runtime release-ready; it records the remaining Runtime-owned blockers and keeps external platform, adapter, commercial, BDK, Enterprise, and Assurance work outside the Runtime release gate.

Audited main: `19d4d81ba365fbaa9f8801473dc59606644a04f6`

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

RRP-4 closes the durable schema version and migration blocker: Runtime/store now
owns `.brownie/store-schema.json` as the release-level durable store schema
manifest for local Runtime state. `TaskStore::ensure_durable_schema` creates the
v1 manifest for new stores, adopts missing-manifest v1-shaped layouts under an
exclusive migration lock, and fails closed for malformed, wrong-id, non-current,
unsupported-migration, or future-version manifests before durable mutation.
`BrownieStore::from_env_or_cwd` gates store-backed Runtime methods before
durable JSON-RPC work proceeds, while store-free status remains outside the
durable gate. The manifest records bounded compatibility metadata only; it does not
ledger raw prompts, provider responses, file contents, paths, secrets,
environment values, executable contents, or process output.

RRP-5 closes protocol/event canonization: the canonical ownership map at
`docs/architecture/runtime-protocol-event-canonical-map.json` now binds Runtime
JSON-RPC method groups, the generated proposal diagnostics compatibility family,
coarse event domains, durable ledger variants, the CLI transport subset, VSIX
validators/client calls, and protocol docs. The
`guard:protocol-event-canonization` check extracts Runtime `METHOD_*`
constants, dispatch arms, `EventKind`, and `LedgerEventKind` variants, then
fails on unmapped methods/events or declared anchor drift. The existing
CI-invoked VSIX check path runs this guard.

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

| ID | Priority | Classification | Status | Responsibility | Release classification | Evidence summary | Next action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `runtime-release-debt-reaudit` | P0 | Runtime Release debt reaudit | implemented sufficient | Runtime | closed | Required specs, manifests, guards, crates, CLI, VSIX, and CI were reaudited and are now backed by a machine guard. | Use this artifact as the source for the remaining bounded closure phases. |
| `runtime-boundary-protocol-contracts` | P0 | Boundary Protocol gaps | implemented sufficient | Runtime | closed | RRP-1 adds a canonical Runtime boundary contract and compatibility matrix, and the release-readiness guard validates required surfaces, method subset, anchors, and non-authority language. | Use the guarded canonical boundary contract while closing the remaining Runtime Release Readiness blockers. |
| `explicit-cancel-command` | P0 | Cancel semantics | implemented sufficient | Runtime | closed | RRP-2 adds `task.cancel` as a caller-authorized Runtime boundary with task/run identity, freshness checks, bounded cancel fingerprinting, single `TaskCancelled` terminal evidence, exact replay semantics, and VSIX thin validation. | Use `task.cancel` as the explicit cancellation boundary while closing the remaining blockers. |
| `real-process-loss-recovery-e2e` | P0 | Real process loss Recovery E2E | implemented sufficient | Runtime | closed | RRP-3.1 keeps the RRP-3 real process-loss baseline and adds execution-scoped lock retention across live `tools/call`, latest-state terminal append validation, nonblocking recovery skip for live owners, concurrent recovery no-duplicate coverage, live recovery no-op coverage, and CI-required execution through the existing VSIX check path. | Use RRP-3/RRP-3.1 process-loss and race-safety evidence as the local Runtime recovery baseline while closing the remaining Runtime Release Readiness blockers. |
| `durable-schema-version-and-migration` | P0 | Durable schema version/migration | implemented sufficient | Runtime | closed | RRP-4 adds `.brownie/store-schema.json`, strict manifest validation, locked v1 initialization/adoption, store-backed Runtime gating, and fail-closed behavior for malformed or future durable schema manifests before task/run/journey/checkpoint/ledger mutation. | Use the RRP-4 durable schema gate as the local Runtime v1 migration baseline while closing the remaining blockers. |
| `runtime-release-guard-ci` | P0 | CI Release Gate | partial | Runtime | required before release | RRP-3.1 adds the process-loss E2E to the existing VSIX check script that CI invokes; RRP-4 adds durable schema evidence/tests; RRP-5 and RRP-6 add protocol/event and module-decomposition guards to that same CI-invoked path. Direct `.github` workflow wiring remains blocked by missing OAuth `workflow` scope, and full release-gate hardening remains open for frozen install, fmt, audit/SBOM/secret/dependency, and complete release policy coverage. | Close direct workflow wiring and remaining full CI release-gate hardening in the dedicated CI phase when workflow-scope credentials are available. |
| `mcp-runtime-safety-policy` | P0 | MCP Runtime Safety Policy finite closure | implemented sufficient | closed | A follow-on MCP safety campaign is registered without replacing the MCP-first architecture; MCP-S1 result semantics, MCP-S1.1 protocol-conformance correction, MCP-S2 tool-level Brownie safety policy, MCP-S3 annotation provenance/drift checks, MCP-S4 tool-level approval binding, MCP-S4.1 approval consumption/retry safety, MCP-S5 runtime input/output schema validation, MCP-S6 secret reference contract, and MCP-S7 executable identity are closed. MCP stdio execution is now result-safe, policy-bound, annotation/catalog drift checked, approval-state-bound, schema-validated, secret-reference scoped, and executable-identity pinned before launch. | Use this closed MCP safety baseline while continuing the other Runtime Release Readiness P0/P1 blockers. |
| `oss-release-technical-basis` | P1 | OSS Release technical basis | owner decision waiting | Owner | owner decision | Cargo workspace remains `UNLICENSED` and `publish = false`. | Owner must decide license/publish posture before OSS Release Ready. |
| `protocol-event-canonization` | P1 | Protocol/Event canonization | implemented sufficient | Runtime | closed | RRP-5 adds a canonical protocol/event ownership map and drift guard covering Runtime methods/dispatch, Rust protocol types, store/events enums, CLI transport subset, VSIX validators/client calls, docs anchors, and generated proposal diagnostics compatibility. | Use the guarded map as the release baseline while closing the remaining blockers. |
| `runtime-module-decomposition-reevaluation` | P1 | Runtime module decomposition reevaluation | implemented sufficient | Runtime | closed | RRP-6 adds a finite module-decomposition assessment with source metrics and hotspot counts, physically moves `task.list` transport-bound ownership into `task_progress.rs`, and adds a guard/test suite that fails closed on metric drift, missing boundary tokens, or task-list ownership regressions. | Use the guarded RRP-6 module decomposition assessment as the release baseline while closing the remaining Runtime-owned blockers. |
| `platform-deadline-durability-hardening` | P1 | Platform/deadline/durability hardening | partial | Runtime | required before release | Local Runtime owns deadlines, stale conflicts, recovery probes, and durable write ordering; release hardening remains open. | Audit and harden local Runtime deadline/durability semantics only. |
| `hosted-scheduler-daemon-worker-fleet` | P2 | Hosted control plane | runtime-outside | External Control Plane | post-v0 | Scheduler, daemon, queue, worker fleet, leases, hosted isolation, metrics, alerts, SLA, and billing remain outside Runtime release. | Track outside Runtime Release Readiness. |
| `forge-notification-adapters` | P2 | Forge/notification adapters | runtime-outside | External Adapter | post-v0 | GitHub/GitLab App, PR workflows, Slack/Teams/email, SIEM, OTel, and customer integrations remain external adapter readiness. | Track outside Runtime Release Readiness. |
| `enterprise-commercial-readiness` | P2 | Enterprise/commercial readiness | runtime-outside | Commercial Solution | post-v0 | Tenant admin, SSO/RBAC server, customer admin UI, certified stack, continuity assurance, and BDK/Enterprise/Assurance products are outside this campaign. | Do not block Brownie Runtime release on these items. |

Runtime Release Ready remains `false` while the remaining required-before-release
Runtime P0/P1 items remain open: `runtime-release-guard-ci` and
`platform-deadline-durability-hardening`.
