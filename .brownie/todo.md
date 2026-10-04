- [ ] E-22b-release-artifact-provenance-binding: Patch only `scripts/release-supply-chain-artifact-evidence.mjs` and `scripts/guard-supply-chain-artifact-evidence.test.mjs`:
  Route: implementation.
  Source TODO: 2026-10-04 review: CI run, commit, artifact SHA, clean source, and source-to-artifact identity are not mechanically bound.
  Depends on: <none>.
  Completion condition: Supply-chain artifact evidence fails closed unless generated artifacts are bound to implementation_commit, tested_commit, workflow_run_id, artifact_sha256, platform, architecture, and clean checkout identity.
  Forbidden changes: do not invent artifact hashes, do not accept dirty source as release-ready, do not weaken existing supply-chain evidence failures, and do not declare Product Ready.
  Verification: run `pnpm --workspace-root guard:supply-chain-artifact-evidence:test` and `pnpm --workspace-root guard:supply-chain-artifact-evidence`.

- [ ] E-22c-runtime-artifact-e2e-evidence: Patch only `scripts/release-runtime-operational-evidence.mjs` and `scripts/guard-runtime-operational-evidence.test.mjs`:
  Route: implementation.
  Source TODO: 2026-10-04 review: generated artifacts are not yet installed and exercised for Mode Pack load, minimal task, ledger generation, resume, and replay rejection.
  Depends on: E-22b-release-artifact-provenance-binding.
  Completion condition: Runtime operational evidence represents artifact E2E checks as executable fail-closed evidence for install/run, Base Mode Pack load, minimal task execution, ledger generation, forced stop/resume, and stale/replay rejection.
  Forbidden changes: do not replace E2E evidence with version/help smoke only, do not mark unavailable platforms as satisfied, and do not declare Runtime Product Ready.
  Verification: run `pnpm --workspace-root release:runtime-operational-evidence:test` and `pnpm --workspace-root guard:runtime-operational-evidence`.

- [ ] E-22d-runtime-stateful-soak-evidence: Patch only `scripts/release-runtime-operational-evidence.mjs` and `scripts/guard-runtime-operational-evidence.test.mjs`:
  Route: implementation.
  Source TODO: 2026-10-04 review: stateful soak does not yet cover process loss, duplicate side effects, ledger/workspace consistency, or finite convergence.
  Depends on: E-22c-runtime-artifact-e2e-evidence.
  Completion condition: Runtime operational evidence fails closed unless stateful soak evidence covers process loss recovery, duplicate side-effect rejection, ledger/workspace consistency, resume/replay, and finite convergence.
  Forbidden changes: do not count version-only loops as stateful soak, do not weaken Golden Journey evidence, and do not declare Runtime Product Ready.
  Verification: run `pnpm --workspace-root release:runtime-operational-evidence:test` and `pnpm --workspace-root guard:runtime-operational-evidence`.

- [ ] E-22e-release-contract-trace-binding-guard: Patch only `scripts/guard-release-contract.mjs` and `scripts/guard-release-contract.test.mjs`:
  Route: implementation.
  Source TODO: 2026-10-04 review: Release Contract is not mechanically bound to latest commit, workflow run, artifact SHA, and executable evidence.
  Depends on: E-22d-runtime-stateful-soak-evidence.
  Completion condition: Release Contract guard rejects sufficient artifact/runtime evidence when implementation_commit, tested_commit, workflow_run_id, artifact_sha256, clean source identity, or executable evidence references are null, stale, or inconsistent with actual target shape.
  Forbidden changes: do not edit docs in this implementation leaf, do not mark Runtime Release Ready, do not delete required evidence fields, and do not bypass fail-closed Release Contract checks.
  Verification: run `pnpm --workspace-root guard:release-contract:test` and `pnpm --workspace-root guard:release-contract`.

- [ ] E-22f-release-contract-audit-doc-sync: Patch only `docs/architecture/runtime-release-contract.json` and `docs/architecture/runtime-release-readiness-audit.json`:
  Route: documentation.
  Source TODO: 2026-10-04 review: Release documents still contain stale E-17/RRP-8.7/4376c0a references after implementation moved ahead.
  Depends on: E-22e-release-contract-trace-binding-guard.
  Completion condition: Release Contract and Readiness Audit describe the same current executable evidence gates, latest audited main relationship, and fail-closed Product Ready status without stale E-17/RRP-8.7/4376c0a authority claims.
  Forbidden changes: do not claim Product Ready, do not hide remaining Release Ops blockers, and do not alter unrelated phase history.
  Verification: run `pnpm --workspace-root guard:release-contract` and `pnpm --workspace-root guard:runtime-release-readiness`.

- [ ] E-22g-final-judgment-manifest-doc-sync: Patch only `docs/architecture/final-product-ready-judgment.md` and `docs/architecture/phase-value-manifest.json`:
  Route: documentation.
  Source TODO: 2026-10-04 review: Final Judgment and Phase Manifest still contain stale blocker generation references after implementation moved ahead.
  Depends on: E-22f-release-contract-audit-doc-sync.
  Completion condition: Final Judgment and Phase Manifest describe the same E-22 Release evidence status as the Contract/Audit, keep Runtime Product Ready false until executable evidence passes, and preserve owner-controlled Release Ops blocker separation.
  Forbidden changes: do not claim Product Ready, do not hide remaining Release Ops blockers, and do not alter unrelated phase history.
  Verification: run `pnpm --workspace-root guard:phase-value`, `pnpm --workspace-root guard:release-contract`, and `pnpm --workspace-root guard:runtime-release-readiness`.

- [ ] E-20i-runtime-release-ops-blocker: Blocker: Owner-controlled Runtime Release Ops environment is required for clean CI build, artifact upload/provenance, and GitHub Release publication.
  Route: blocker.
  Source TODO: E-20i-release-ops-blocker.
  Depends on: <none>.
  Completion condition: Release engineering owner provides or documents the Runtime Release Ops authority needed for clean CI builds, artifact upload/provenance binding, and GitHub Release publication. Customer or Enterprise production deployment credentials are explicitly out of Runtime Product Ready scope and must not block the OSS Runtime release.
  Forbidden changes: do not attempt to configure external CI/CD, create credentials, publish a GitHub Release, or request customer/Enterprise production deployment credentials.
  Verification: inspect/blocker/fail-closed until Release Ops owner provides evidence of clean CI/artifact/provenance/publication authority or documents the remaining owner-controlled Runtime Release requirement.

- [x] E-21c-clean-release-workspace-impl-1: Patch only `scripts/release-supply-chain-artifact-evidence.mjs` and `scripts/guard-supply-chain-artifact-evidence.test.mjs` to replace Brownie-owned blocker E-21c-release-ops-todo-split-clean-release-workspace with executable Release evidence handling:
  Route: implementation.
  Source TODO: TODO-refine-brownie-owned-blockers-59fb1bfdd8bc.
  Depends on: <none>.
  Completion condition: Release evidence requires a clean dedicated source checkout identity before artifact evidence can satisfy Product Ready gates. The original E-21c-release-ops-todo-split-clean-release-workspace blocker is removed only because this leaf provides bounded implementation work with existing verification.
  Forbidden changes: do not edit unrelated files, do not invent release evidence values, do not weaken fail-closed guards, and do not declare Runtime Product Ready.
  Verification: run `pnpm --workspace-root guard:supply-chain-artifact-evidence:test` and `pnpm --workspace-root guard:supply-chain-artifact-evidence`.

- [x] E-21c-runtime-operational-evidence-impl-2: Patch only `scripts/release-runtime-operational-evidence.mjs` and `scripts/guard-runtime-operational-evidence.test.mjs` to replace Brownie-owned blocker E-21c-release-ops-todo-split-artifact-e2e-smoke with executable Release evidence handling:
  Route: implementation.
  Source TODO: TODO-refine-brownie-owned-blockers-59fb1bfdd8bc.
  Depends on: E-21c-clean-release-workspace-impl-1.
  Completion condition: Runtime operational evidence models the requested release operation as executable fail-closed evidence instead of a blocker placeholder. The original E-21c-release-ops-todo-split-artifact-e2e-smoke blocker is removed only because this leaf provides bounded implementation work with existing verification.
  Forbidden changes: do not edit unrelated files, do not invent release evidence values, do not weaken fail-closed guards, and do not declare Runtime Product Ready.
  Verification: run `pnpm --workspace-root release:runtime-operational-evidence:test` and `pnpm --workspace-root guard:runtime-operational-evidence`.

- [x] E-21c-runtime-operational-evidence-impl-3: Patch only `scripts/release-runtime-operational-evidence.mjs` and `scripts/guard-runtime-operational-evidence.test.mjs` to replace Brownie-owned blocker E-21c-release-ops-todo-split-artifact-lifecycle with executable Release evidence handling:
  Route: implementation.
  Source TODO: TODO-refine-brownie-owned-blockers-59fb1bfdd8bc.
  Depends on: E-21c-runtime-operational-evidence-impl-2.
  Completion condition: Runtime operational evidence models the requested release operation as executable fail-closed evidence instead of a blocker placeholder. The original E-21c-release-ops-todo-split-artifact-lifecycle blocker is removed only because this leaf provides bounded implementation work with existing verification.
  Forbidden changes: do not edit unrelated files, do not invent release evidence values, do not weaken fail-closed guards, and do not declare Runtime Product Ready.
  Verification: run `pnpm --workspace-root release:runtime-operational-evidence:test` and `pnpm --workspace-root guard:runtime-operational-evidence`.

- [x] E-21c-runtime-operational-evidence-impl-4: Patch only `scripts/release-runtime-operational-evidence.mjs` and `scripts/guard-runtime-operational-evidence.test.mjs` to replace Brownie-owned blocker E-21c-release-ops-todo-split-golden-journey with executable Release evidence handling:
  Route: implementation.
  Source TODO: TODO-refine-brownie-owned-blockers-59fb1bfdd8bc.
  Depends on: E-21c-runtime-operational-evidence-impl-3.
  Completion condition: Runtime operational evidence models the requested release operation as executable fail-closed evidence instead of a blocker placeholder. The original E-21c-release-ops-todo-split-golden-journey blocker is removed only because this leaf provides bounded implementation work with existing verification.
  Forbidden changes: do not edit unrelated files, do not invent release evidence values, do not weaken fail-closed guards, and do not declare Runtime Product Ready.
  Verification: run `pnpm --workspace-root release:runtime-operational-evidence:test` and `pnpm --workspace-root guard:runtime-operational-evidence`.

- [x] E-21c-runtime-operational-evidence-impl-5: Patch only `scripts/release-runtime-operational-evidence.mjs` and `scripts/guard-runtime-operational-evidence.test.mjs` to replace Brownie-owned blocker E-21c-release-ops-todo-split-stateful-soak with executable Release evidence handling:
  Route: implementation.
  Source TODO: TODO-refine-brownie-owned-blockers-59fb1bfdd8bc.
  Depends on: E-21c-runtime-operational-evidence-impl-4.
  Completion condition: Runtime operational evidence models the requested release operation as executable fail-closed evidence instead of a blocker placeholder. The original E-21c-release-ops-todo-split-stateful-soak blocker is removed only because this leaf provides bounded implementation work with existing verification.
  Forbidden changes: do not edit unrelated files, do not invent release evidence values, do not weaken fail-closed guards, and do not declare Runtime Product Ready.
  Verification: run `pnpm --workspace-root release:runtime-operational-evidence:test` and `pnpm --workspace-root guard:runtime-operational-evidence`.

- [x] E-21c-owner-governance-reproducibility-impl-7: Patch only `scripts/release-owner-governance-evidence.mjs` and `scripts/guard-owner-governance-evidence.test.mjs` to replace Brownie-owned blocker E-21c-release-ops-todo-split-owner-governance-reproducibility with executable Release evidence handling:
  Route: implementation.
  Source TODO: TODO-refine-brownie-owned-blockers-59fb1bfdd8bc.
  Depends on: <none>.
  Completion condition: Owner governance evidence generation and validation are fail-closed and reproducible when GitHub API data is unavailable or stale. The original E-21c-release-ops-todo-split-owner-governance-reproducibility blocker is removed only because this leaf provides bounded implementation work with existing verification.
  Forbidden changes: do not edit unrelated files, do not invent release evidence values, do not weaken fail-closed guards, and do not declare Runtime Product Ready.
  Verification: run `pnpm --workspace-root release:owner-governance-evidence:test` and `pnpm --workspace-root guard:owner-governance-evidence`.

