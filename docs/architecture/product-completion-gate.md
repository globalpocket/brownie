# Product Completion Gate

Brownie phase and milestone completion must be supported by bounded, machine-checkable product evidence. CI success, PR merge status, source-token presence, endpoint count, or manifest existence are not sufficient completion evidence.

The executable gate is `scripts/guard-product-completion.mjs`. It validates the current phase-value manifest and rejects completion claims that do not map to the Product Charter, do not name a concrete capability transition, do not include behavior evidence, omit safety/debt review, or try to close product work with wrapper-only/report-only output.

## Required Evidence

A completion claim must include:

- Product Charter strategic capability mapping.
- Concrete capability transition.
- User, runtime, or development-control capability gain.
- Behavior evidence from tests or executable guards.
- Safety boundary and non-goals.
- Rejected alternatives.
- Unresolved technical debt classification.
- Next capability rationale or milestone exit rationale.
- Runtime release scope separated from external control-plane, adapter, and
  commercial solution readiness.

## Wrapper Boundary

Wrapper-only, report-only, readiness-only, digest-only, history-only, verdict-only, inspection-only, preview-only, and summary-only phases cannot be accepted as product completion. A bounded blocker-removal phase may pass only when it explicitly names the blocker removed and does not claim product runtime completion.

## Runtime Release DoD

The current phase-value manifest must include
`product_completion_gate.release_readiness_scope` with:

- `runtime_release_dod`: runtime-owned task/run/journey state, agent loop,
  Mode Pack policy, permissions, controlled tools, workspace proposal/apply,
  replay/stale/conflict protection, and completion/finalization evidence.
- `runtime_boundary_contracts`: bounded Run Request, Runtime Event, Control
  Command, and Run Result/Attestation contracts.
- `external_control_plane_responsibilities`: scheduler, queue, worker, lease,
  retry policy, hosted isolation, Secret Provider, metrics, alerts, SLA, HA,
  tenant, and billing responsibilities that remain outside Runtime release.
- `external_adapter_responsibilities`: GitHub/GitLab, PR, review,
  notification, SIEM/OTel, language verifier adapter, and customer system
  integrations that remain outside Runtime release.
- `commercial_solution_readiness`: packaging, operations, administration, and
  enterprise readiness items that can be tracked after Runtime release.

`external_responsibility_not_release_blocking` must be `true`. Machine-readable
technical debt may mark active `runtime` items as `blocking` or
`required_before_release`; `external_control_plane`, `external_adapter`, and
`commercial_solution` items must remain nonblocking `post_v0` readiness items.
Runtime-selected Product DoD gaps with `required=true` must also use
`responsibility_domain="runtime"`.

Missing generic runtime boundary contracts can block Runtime release. Missing
scheduler, daemon, job queue, Docker/Kubernetes isolation, Vault integration,
tenant administration, monitoring/SLA, billing, GitHub App, GitLab adapter,
notification adapter, or broad language verifier catalog cannot block Runtime
release by itself.

## Safety Boundary

The guard reads bounded repository JSON/text only. It does not read external automation state, raw prompts, provider responses, workspace file content, stdout, stderr, environment values, absolute paths, canonical paths, secrets, or credentials. It does not mutate repository files, Git state, runtime state, ledger files, provider state, or workspace files.
