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
