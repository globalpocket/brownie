# Brownie Runtime Release Readiness Audit

This audit is the bounded source of truth for the Runtime Release Readiness P0/P1 finite closure campaign. It does not declare Brownie Runtime release-ready; it records the remaining Runtime-owned blockers and keeps external platform, adapter, commercial, BDK, Enterprise, and Assurance work outside the Runtime release gate.

Audited main: `273e367641f03898e3a04dfaf6f0a37c7692fae3`

RRP-1 adds the guarded canonical Runtime boundary contract at
`docs/architecture/runtime-boundary-canonical-contract.json`. The Runtime
release-readiness guard validates that contract for required boundary surfaces,
method subset, CLI/VSIX/Runtime/spec anchors, compatibility matrix entries, and
non-authority language through the existing VSIX-invoked check path.

RRP-2 adds the explicit Runtime-owned `task.cancel` command. Cancellation now
requires caller authorization, task/run identity, current-state freshness,
bounded cancel request fingerprinting, and exact durable replay evidence before
terminal `TaskCancelled` evidence can be produced or reused.

| ID | Priority | Classification | Status | Responsibility | Release classification | Evidence summary | Next action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `runtime-release-debt-reaudit` | P0 | Runtime Release debt reaudit | implemented sufficient | Runtime | closed | Required specs, manifests, guards, crates, CLI, VSIX, and CI were reaudited and are now backed by a machine guard. | Use this artifact as the source for the remaining bounded closure phases. |
| `runtime-boundary-protocol-contracts` | P0 | Boundary Protocol gaps | implemented sufficient | Runtime | closed | RRP-1 adds a canonical Runtime boundary contract and compatibility matrix, and the release-readiness guard validates required surfaces, method subset, anchors, and non-authority language. | Use the guarded canonical boundary contract while closing the remaining Runtime Release Readiness blockers. |
| `explicit-cancel-command` | P0 | Cancel semantics | implemented sufficient | Runtime | closed | RRP-2 adds `task.cancel` as a caller-authorized Runtime boundary with task/run identity, freshness checks, bounded cancel fingerprinting, single `TaskCancelled` terminal evidence, exact replay semantics, and VSIX thin validation. | Use `task.cancel` as the explicit cancellation boundary while closing the remaining blockers. |
| `real-process-loss-recovery-e2e` | P0 | Real process loss Recovery E2E | partial | Runtime | required before release | Recovery probe exists and has crash-window tests; production-equivalent installed process-loss E2E is still missing. | Add a real crash/restart/recovery E2E through the public CLI/runtime boundary. |
| `durable-schema-version-and-migration` | P0 | Durable schema version/migration | partial | Runtime | required before release | Many payloads carry `schema_version`, but release-level durable store schema migration/fail-closed behavior is not yet proven. | Add durable schema version and migration/fail-closed behavior. |
| `runtime-release-guard-ci` | P0 | CI Release Gate | partial | Runtime | required before release | Existing CI still uses non-frozen pnpm install and does not directly run every release guard test. RRD-1 wired the Runtime release readiness guard into the VSIX check path already invoked by CI, and the guard now supports open-to-closed audit convergence plus terminal `runtime_release_ready=true` acceptance. Full workflow hardening still requires workflow update authority. | Close the remaining CI workflow hardening when workflow update authority is available. |
| `mcp-runtime-safety-policy` | P0 | MCP Runtime Safety Policy finite closure | implemented sufficient | closed | A follow-on MCP safety campaign is registered without replacing the MCP-first architecture; MCP-S1 result semantics, MCP-S1.1 protocol-conformance correction, MCP-S2 tool-level Brownie safety policy, MCP-S3 annotation provenance/drift checks, MCP-S4 tool-level approval binding, MCP-S5 runtime input/output schema validation, MCP-S6 secret reference contract, and MCP-S7 executable identity are closed. MCP stdio execution is now result-safe, policy-bound, annotation/catalog drift checked, approval-bound, schema-validated, secret-reference scoped, and executable-identity pinned before launch. | Use this closed MCP safety baseline while continuing the other Runtime Release Readiness P0/P1 blockers. |
| `oss-release-technical-basis` | P1 | OSS Release technical basis | owner decision waiting | Owner | owner decision | Cargo workspace remains `UNLICENSED` and `publish = false`. | Owner must decide license/publish posture before OSS Release Ready. |
| `protocol-event-canonization` | P1 | Protocol/Event canonization | partial | Runtime | required before release | Protocol and event types exist, but Rust, JSON-RPC, CLI, VSIX, store, events crate, and docs need a guarded ownership map. | Add canonical ownership and drift tests. |
| `runtime-module-decomposition-reevaluation` | P1 | Runtime module decomposition reevaluation | partial | Runtime | required before release | M64.15 left this open; `brownie-runtime/src/lib.rs` still concentrates release-critical behavior. | Reevaluate module boundaries with behavior-preserving extraction only. |
| `platform-deadline-durability-hardening` | P1 | Platform/deadline/durability hardening | partial | Runtime | required before release | Local Runtime owns deadlines, stale conflicts, recovery probes, and durable write ordering; release hardening remains open. | Audit and harden local Runtime deadline/durability semantics only. |
| `hosted-scheduler-daemon-worker-fleet` | P2 | Hosted control plane | runtime-outside | External Control Plane | post-v0 | Scheduler, daemon, queue, worker fleet, leases, hosted isolation, metrics, alerts, SLA, and billing remain outside Runtime release. | Track outside Runtime Release Readiness. |
| `forge-notification-adapters` | P2 | Forge/notification adapters | runtime-outside | External Adapter | post-v0 | GitHub/GitLab App, PR workflows, Slack/Teams/email, SIEM, OTel, and customer integrations remain external adapter readiness. | Track outside Runtime Release Readiness. |
| `enterprise-commercial-readiness` | P2 | Enterprise/commercial readiness | runtime-outside | Commercial Solution | post-v0 | Tenant admin, SSO/RBAC server, customer admin UI, certified stack, continuity assurance, and BDK/Enterprise/Assurance products are outside this campaign. | Do not block Brownie Runtime release on these items. |

Runtime Release Ready remains `false` while the remaining required-before-release
Runtime P0/P1 items remain open.
