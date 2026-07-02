# Phase 3.4 Implementation Prompt

## Phase

3.4 = Apply readiness report / user-visible final pre-apply review

## Objective

Add a user-visible final pre-apply review surface for Brownie. This phase must improve apply readiness reporting only. It must not execute apply, write user files, commit changes, start or stop services, add network behavior, or introduce any hidden process execution beyond the explicitly requested test/check commands.

## Safety Boundaries

- Do not auto-merge any PR.
- Do not push directly to `main`.
- Do not add apply execution, patch application, file write, shell execution, network access, or service control capabilities unless this prompt explicitly requests them.
- Do not copy code from Zoo Code or ZooCodeCustom.
- Preserve Brownie's existing safety policy and no-write / no-apply boundaries.
- Do not expose raw content, raw input, absolute paths, or canonical paths in user-visible output.
- Do not automatically continue from a blocked state.

## Required Implementation

1. Locate the existing pre-apply, apply-planning, safety, ledger, protocol, runtime, and VSIX surfaces in the repository.
2. Add or extend an apply readiness report that is visible to the user before any apply-capable phase.
3. The report must summarize readiness without exposing raw content, raw input, absolute paths, canonical paths, or unsafe implementation details.
4. The report must include enough structured information for the operator to understand:
   - Whether the current request is apply-ready.
   - Which safety gates were checked.
   - Which capabilities remain disabled.
   - Which follow-up action is expected from the operator.
5. Keep the phase strictly review/report oriented. No real apply path should be enabled in this phase.
6. Keep protocol, runtime, VSIX, and ledger sanitizer types aligned where applicable.
7. Update docs/spec files when behavior, protocol fields, or operator-facing output changes.
8. Add focused tests covering the readiness report and safety redaction behavior.

## Required Verification

Run the following commands before creating the PR:

```bash
cargo fmt --check
cargo check --workspace
cargo test --workspace
pnpm --filter brownie-vsix check
pnpm --filter brownie-vsix test
pnpm --filter brownie-vsix build
```

If a command cannot run because the repository does not currently contain that toolchain or package, record the exact reason in the PR body and in the phase implementation summary. Do not silently skip commands.

## PR Requirements

- Create a branch for this phase using the current phase from `.brownie-control/phase-state.json`.
- Open a PR for the implementation.
- Do not merge the PR.
- Do not push directly to `main`.
- Include a concise implementation summary, safety notes, and verification results in the PR body.

## Completion Criteria

The phase is complete only when:

- The requested readiness report behavior is implemented.
- Safety boundaries remain intact.
- Tests and docs/spec updates have been added where needed.
- Required verification has been run or explicitly explained if unavailable.
- A PR has been opened and recorded in `.brownie-control/phase-state.json`.
