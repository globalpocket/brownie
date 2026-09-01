# Runtime Boundary And Release DoD Spec v0

## Purpose

Brownie Runtime release readiness is bounded to the Rust runtime contract. It is
not a claim that every external control plane, hosted service, enterprise
adapter, or commercial operations feature exists.

This spec separates three layers:

1. Brownie Runtime.
2. External Control Plane.
3. External Adapter or UI.

## Brownie Runtime Responsibilities

Brownie Runtime owns:

- task, run, journey, checkpoint, ledger, and durable state authority;
- the agent loop state machine and bounded finite execution steps;
- AgentModes Mode Pack read, validation, pinning, policy materialization, and
  point-of-use permission enforcement;
- controlled tool execution, workspace boundaries, proposal/apply behavior,
  approval semantics, and completion/finalization decisions;
- idempotency, stale request rejection, replay protection, crash recovery,
  conflict handling, and cancellation safety;
- Product DoD selection, closure evidence, refusal, and technical debt
  carry-forward inside the runtime release boundary;
- generic protocol boundaries for external controllers and adapters.

The runtime may expose safe metadata, hashes, bounded ids, counts, statuses, and
next actions. It must not ledger raw prompts, provider responses, raw file
content, full command output, absolute paths, canonical paths, environment
values, or secrets.

## External Control Plane Responsibilities

The External Control Plane owns operational orchestration outside the runtime:

- schedulers, background polling, job queues, leases, workers, retry policy, and
  permanent process supervision;
- OS, container, VM, or Kubernetes isolation;
- tenant management, quota, SLA, HA, metrics, alerting, billing, and hosted
  operations;
- the concrete Secret Provider backing secret references.

The runtime can define generic request, event, command, result, approval, secret
reference, scope, and attestation contracts for this layer. Absence of a hosted
control-plane product does not block Brownie Runtime release.

## External Adapter And UI Responsibilities

External adapters and UIs own product integrations and human surfaces outside
the runtime:

- GitHub, GitLab, PR, review, notification, Slack, Teams, email, SIEM, and OTel
  integrations;
- customer-specific systems and enterprise admin UI;
- language-specific verifier adapters beyond the generic controlled verifier
  contract;
- PR creation, update, merge, and hosted review workflows.

The runtime can expose local Git inspection, local Git mutation, local commit,
remote communication, push, forge API, PR create/update, and PR merge as
separate capability categories. Implementing every forge adapter is not a
Runtime release prerequisite.

## Boundary Contracts

Runtime release requires these generic contracts to remain executable and
machine-checkable:

- Run Request: bounded objective or continuation identity, pinned Mode Pack
  identity, workspace and execution scope handles, idempotency key, deadline or
  execution constraints, secret references rather than secret values, requested
  isolation profile metadata, approval policy, and expected fingerprints.
- Runtime Event: append-only bounded ledger events for run start/end, state
  transitions, progress, permission decisions, tool intents/results, human
  approval waits, retryable failures, terminal failures, cancellation,
  recovery, Product DoD selection/closure, completion refusal, and runtime /
  Mode Pack / LLM / toolchain identifiers, with no raw prompt, file, command,
  environment, path, or secret material.
- Control Command: explicit caller-authorized commands such as continue,
  inspect, approve, deny, cancel, retry, recover, apply, or finalize, each
  bound to current run state, target fingerprint, and continuation identity so
  stale approvals and commands fail closed.
- Run Result and Attestation: bounded status, artifact references,
  verification results, runtime / Mode Pack / LLM / toolchain identifiers,
  policy fingerprints, ledger references, unresolved items, failure
  classification, recovery history, replay state, selected scopes, completion
  evidence, verifier evidence, and refusal/blocker reasons.

These contracts are runtime release blockers when missing or stale because they
define how the runtime safely composes with external systems.

## Release DoD Split

Brownie Runtime Release DoD contains only runtime-owned behavior and generic
boundary contracts. Items such as scheduler services, daemon hosting, Docker or
Kubernetes isolation, Vault integration, tenant administration, hosted metrics,
SLA dashboards, GitHub App productization, GitLab adapters, billing, customer
admin UI, and language ecosystem coverage are Commercial Solution Readiness or
External Adapter readiness, not Runtime Release DoD.

Machine-readable Product DoD and technical debt evidence must use a
`responsibility_domain`:

- `runtime`: may be `blocking` or `required_before_release` when active.
- `external_control_plane`: must not be Runtime release blocking.
- `external_adapter`: must not be Runtime release blocking.
- `commercial_solution`: must not be Runtime release blocking.

Runtime-selected Product DoD gaps with `required=true` must use
`responsibility_domain="runtime"`. External-domain work may remain visible as
`post_v0` readiness evidence, but it cannot prevent a Runtime release decision.
