- [x] E-22b-release-artifact-provenance-binding: Patch only `scripts/release-supply-chain-artifact-evidence.mjs` and `scripts/guard-supply-chain-artifact-evidence.test.mjs`:
  Route: implementation.
  Source TODO: 2026-10-04 review: CI run, commit, artifact SHA, clean source, and source-to-artifact identity are not mechanically bound.
  Depends on: <none>.
  Completion condition: Supply-chain artifact evidence fails closed unless generated artifacts are bound to implementation_commit, tested_commit, workflow_run_id, artifact_sha256, platform, architecture, and clean checkout identity.
  Forbidden changes: do not invent artifact hashes, do not accept dirty source as release-ready, do not weaken existing supply-chain evidence failures, and do not declare Product Ready.
  Verification: run `pnpm --workspace-root guard:supply-chain-artifact-evidence:test` and `pnpm --workspace-root guard:supply-chain-artifact-evidence`.

- [x] E-22c-runtime-artifact-e2e-evidence: Patch only `scripts/release-runtime-operational-evidence.mjs` and `scripts/guard-runtime-operational-evidence.test.mjs`:
  Route: implementation.
  Source TODO: 2026-10-04 review: generated artifacts are not yet installed and exercised for Mode Pack load, minimal task, ledger generation, resume, and replay rejection.
  Depends on: E-22b-release-artifact-provenance-binding.
  Completion condition: Runtime operational evidence represents artifact E2E checks as executable fail-closed evidence for install/run, Base Mode Pack load, minimal task execution, ledger generation, forced stop/resume, and stale/replay rejection.
  Forbidden changes: do not replace E2E evidence with version/help smoke only, do not mark unavailable platforms as satisfied, and do not declare Runtime Product Ready.
  Verification: run `pnpm --workspace-root release:runtime-operational-evidence:test` and `pnpm --workspace-root guard:runtime-operational-evidence`.

- [x] E-22d-runtime-stateful-soak-evidence: Patch only `scripts/release-runtime-operational-evidence.mjs` and `scripts/guard-runtime-operational-evidence.test.mjs`:
  Route: implementation.
  Source TODO: 2026-10-04 review: stateful soak does not yet cover process loss, duplicate side effects, ledger/workspace consistency, or finite convergence.
  Depends on: E-22c-runtime-artifact-e2e-evidence.
  Completion condition: Runtime operational evidence fails closed unless stateful soak evidence covers process loss recovery, duplicate side-effect rejection, ledger/workspace consistency, resume/replay, and finite convergence.
  Forbidden changes: do not count version-only loops as stateful soak, do not weaken Golden Journey evidence, and do not declare Runtime Product Ready.
  Verification: run `pnpm --workspace-root release:runtime-operational-evidence:test` and `pnpm --workspace-root guard:runtime-operational-evidence`.

- [x] E-22e-release-contract-trace-binding-guard: Patch only `scripts/guard-release-contract.mjs` and `scripts/guard-release-contract.test.mjs`:
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

- [x] E-22e-replan-stalled-leaf-16e2c69e67bb: Patch only `.brownie/todo.md` and `.brownie/todo-breakdown.md` to replan stalled Brownie TODO leaf into implementable child TODOs:
  Route: todo-decomposition.
  Source TODO: E-22e-release-contract-trace-binding-guard.
  Depends on: <none>.
  Completion condition: Stalled TODO `E-22e-release-contract-trace-binding-guard` is superseded by implementable child leaves that preserve the parent intent, exact patch targets, existing verification commands, and ledger coverage.
  Failure evidence: invalid_patch_followed_by_no_progress; same_progress_count=1.
  Forbidden changes: do not implement the release-evidence fix here, do not weaken guards/tests, do not invent evidence values, and do not declare Runtime Product Ready.
  Verification: run `pnpm --workspace-root guard:todo-decomposition` and `pnpm --workspace-root phase-loop:todo-queue-integrity`.

- [x] E-22e-guard-release-contract-impl-1: Patch only `scripts/guard-release-contract.mjs` to add implementation_commit, tested_commit, workflow_run_id, artifact_sha256, and clean source identity validation:
  Route: implementation.
  Source TODO: E-22e-replan-stalled-leaf-16e2c69e67bb.
  Depends on: <none>.
  Completion condition: Guard script rejects release when any required evidence field is null, stale, or inconsistent with actual target shape.
  Forbidden changes: do not edit docs, do not mark Runtime Release Ready, do not delete required evidence fields, and do not bypass fail-closed checks.
  Verification: run `pnpm --workspace-root guard:release-contract:test` and `pnpm --workspace-root guard:release-contract`.

- [x] E-22e-guard-release-contract-impl-2: Patch only `scripts/guard-release-contract.test.mjs` to add test cases for null/stale/inconsistent evidence rejection:
  Route: implementation.
  Source TODO: E-22e-replan-stalled-leaf-16e2c69e67bb.
  Depends on: E-22e-guard-release-contract-impl-1.
  Completion condition: Test suite covers all fail-closed paths for missing, stale, and inconsistent evidence fields.
  Forbidden changes: do not weaken existing guard tests, do not invent evidence values, and do not mark tests passing without actual guard implementation.
  Verification: run `pnpm --workspace-root guard:release-contract:test`.

- [ ] E-22f-1-release-contract-json-sync: Patch only `docs/architecture/runtime-release-contract.json` to update Release Contract evidence gates and remove stale E-17/RRP-8.7/4376c0a references:
  Route: documentation.
  Source TODO: E-22f-release-contract-audit-doc-sync.
  Depends on: E-22e-release-contract-trace-binding-guard.
  Completion condition: runtime-release-contract.json describes current executable evidence gates, latest audited main relationship, and fail-closed Product Ready status without stale authority claims.
  Forbidden changes: do not claim Product Ready, do not hide remaining Release Ops blockers, and do not alter unrelated phase history.
  Verification: run `pnpm --workspace-root guard:release-contract`.

- [ ] E-22f-2-release-readiness-audit-sync: Patch only `docs/architecture/runtime-release-readiness-audit.json` to update Readiness Audit evidence gates and remove stale E-17/RRP-8.7/4376c0a references:
  Route: documentation.
  Source TODO: E-22f-release-contract-audit-doc-sync.
  Depends on: E-22f-1-release-contract-json-sync.
  Completion condition: runtime-release-readiness-audit.json describes the same current executable evidence gates as runtime-release-contract.json and preserves fail-closed Product Ready status.
  Forbidden changes: do not claim Product Ready, do not hide remaining Release Ops blockers, and do not alter unrelated phase history.
  Verification: run `pnpm --workspace-root guard:runtime-release-readiness`.

- [x] E-22f-replan-stalled-leaf-83d8a9c3a915: Patch only `.brownie/todo.md` and `.brownie/todo-breakdown.md` to replan stalled Brownie TODO leaf into implementable child TODOs:
  Route: todo-decomposition.
  Source TODO: E-22f-1-release-contract-json-sync.
  Depends on: <none>.
  Completion condition: Patch `.brownie/todo.md` and `.brownie/todo-breakdown.md` so stalled TODO `E-22f-1-release-contract-json-sync` is replaced or superseded by implementable child leaves that preserve the parent intent, exact patch targets, existing verification commands, and ledger coverage.
  Failure evidence: same_todo_apply_rejection_threshold; same_progress_count=1.
  Forbidden changes: do not implement the release-evidence fix here, do not weaken guards/tests, do not invent evidence values, and do not declare Runtime Product Ready.
  Verification: run `pnpm --workspace-root guard:todo-decomposition` and `pnpm --workspace-root phase-loop:todo-queue-integrity`.

- [ ] E-22f-1-release-contract-json-sync-doc: Patch only `docs/architecture/runtime-release-contract.json` to update Release Contract evidence gates while preserving the guard-owned `phase` value:
  Route: documentation.
  Source TODO: E-22f-replan-stalled-leaf-83d8a9c3a915.
  Depends on: E-22e-release-contract-trace-binding-guard.
  Completion condition: Release Contract JSON describes current executable evidence gates (supply-chain artifact binding, runtime operational evidence, stateful soak evidence) without stale E-17/4376c0a authority claims, while keeping `phase` as the guard-owned contract identifier `RRP-8.7`.
  Forbidden changes: do not change `phase` away from `RRP-8.7`, do not claim Product Ready, do not hide remaining blockers, do not alter unrelated phase history.
  Verification: run `pnpm --workspace-root guard:release-contract` and inspect `docs/architecture/runtime-release-contract.json` for stale references.

- [ ] E-22f-2-release-readiness-audit-doc: Patch only `docs/architecture/runtime-release-readiness-audit.json` to sync audit with current Release Contract:
  Route: documentation.
  Source TODO: E-22f-replan-stalled-leaf-83d8a9c3a915.
  Depends on: E-22f-1-release-contract-json-sync-doc.
  Completion condition: Readiness Audit JSON matches Release Contract evidence gates and reflects E-22 Release status without stale authority claims.
  Forbidden changes: do not claim Product Ready, do not hide remaining blockers, do not alter unrelated phase history.
  Verification: run `pnpm --workspace-root guard:runtime-release-readiness`.
