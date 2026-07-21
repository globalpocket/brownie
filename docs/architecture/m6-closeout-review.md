# M6 Controlled Apply Execution Closeout Review

## Scope

- M6.1 Controlled Replace-File Apply
- M6.2 Controlled Create-File Apply
- M6.3 Controlled Delete-File Apply
- final M6 implementation PR: #134
- verification mode: `m6_closeout_verification`
- closeout decision: `MILESTONE_COMPLETE`

This report closes M6 by capability evidence, not by endpoint count or CI status alone. M6's purpose was to move Brownie from controlled apply readiness into actual Rust-owned workspace mutation. The milestone is complete because Brownie can now replace, create, and delete one file at a time through the existing `proposal.apply` authority with explicit authorization, latest preflight checks, bounded result evidence, and runtime-owned safety gates.

## Product Capability Delivered

Before M6, `workspace.write` could produce reviewable proposals, approval state, preflight evidence, readiness reports, and review artifacts, but it could not mutate the workspace. After M6, Brownie can:

- apply one approved `replace_file` proposal to one existing regular UTF-8 workspace file;
- apply one approved `create_file` proposal to one absent workspace file under an existing safe parent directory;
- apply one approved `delete_file` proposal to remove one existing regular UTF-8 workspace file;
- require explicit `authorize=true` for every mutation;
- require current approval and unconsumed apply authorization;
- require latest preflight evidence before mutation;
- verify expected target SHA-256 for replace and delete;
- verify expected target absence for create;
- reject protected paths, parent traversal, directories, symlinks, unsafe parents, and unsupported operations;
- use bounded write/delete behavior with atomic replacement or no-overwrite creation where applicable;
- verify post-write hash or post-delete absence before marking apply successful;
- record `WorkspacePatchApplyResultRecorded` with bounded metadata only;
- return bounded RPC results that headless callers can use without parsing raw file contents or raw ledger payloads.

This materially advances `controlled_workspace_tools`, `runtime_permission_enforcement`, `persistent_structured_ledger`, and `headless_autonomous_development`.

## Capability Inventory

| Phase | PR | Capability |
| --- | --- | --- |
| M6.1 | #132 | Approved `replace_file` proposal becomes one authorized atomic replacement of one existing regular UTF-8 workspace file through Rust-owned `proposal.apply`. |
| M6.2 | #133 | Approved `create_file` proposal becomes one authorized no-overwrite creation of one absent regular UTF-8 workspace file in an existing safe parent directory. |
| M6.3 | #134 | Approved `delete_file` proposal becomes one authorized bounded removal of one existing regular UTF-8 workspace file with post-delete absence verification. |

## Architecture Outcome

M6 keeps the VSIX thin and keeps policy in the Rust runtime:

- `workspace.write` remains proposal generation, not direct mutation.
- `proposal.approve` remains approval recording, not direct mutation.
- `proposal.preflight` remains metadata capture, not direct mutation.
- `proposal.apply` is the single side-effecting workspace mutation RPC.
- Replace/create/delete share the same approval, freshness, replay, ledger, and bounded-result model.
- The runtime owns path safety, protected-path denial, symlink denial, file-kind checks, hash/absence checks, bounded mutation, post-mutation verification, authorization consumption, and ledger recording.
- The VSIX protocol and client can request apply, but they do not decide policy.

## Evidence

Relevant merged PR evidence:

- PR #132 merged M6.1 controlled replace-file apply.
- PR #133 merged M6.2 controlled create-file apply.
- PR #134 merged M6.3 controlled delete-file apply.
- `docs/architecture/runtime-overview.md` documents the M6.1, M6.2, and M6.3 controlled apply boundaries.
- `docs/specifications/patch-proposal-spec-v0.md` documents proposal generation, validation, preflight, and apply semantics for `replace_file`, `create_file`, and `delete_file`.
- `docs/architecture/phase-value-manifest.m6.1.json`, `docs/architecture/phase-value-manifest.m6.2.json`, and `docs/architecture/phase-value-manifest.m6.3.json` archive the value gates for the three M6 runtime mutation phases.

Relevant validation evidence:

- PR #134 GitHub CI `check`: pass.
- Local M6.3 validation before PR #134: `cargo fmt --check`, `cargo check --workspace`, `cargo test --workspace`, `pnpm install`, `pnpm guard:diagnostics`, `pnpm guard:phase-value`, `pnpm --filter brownie-vsix check`, `pnpm --filter brownie-vsix test`, `pnpm --filter brownie-vsix build`, and `git diff --check`: pass.
- Open PR list after PR #134 merge: empty.
- `main` and `origin/main` point at merge commit `1d37f7b0ede0cd5052fdb15f6a6920f30a653539`.

## Completion Criteria Verification

M6 closeout satisfies the required criteria:

1. Brownie has at least one real runtime-owned workspace mutation path.
2. The mutation path is `proposal.apply`, not a readiness wrapper or preview.
3. Replace, create, and delete are all represented as distinct proposal operations.
4. Each operation is one file per apply and workspace-relative only.
5. Every mutation requires explicit caller authorization.
6. Approval must be current and unconsumed.
7. The runtime validates latest preflight evidence before mutation.
8. The runtime rejects protected paths, traversal, directories, symlinks, and unsupported operations.
9. Successful apply records a bounded ledger event and returns a bounded RPC result.
10. Raw file content, raw diffs, raw provider output, raw prompts, stdout, stderr, environment values, secrets, canonical paths, and absolute paths are not stored or returned by apply results.
11. Failure paths preserve the original file or absent target whenever the failure happens before mutation.
12. CI and behavior tests prove successful mutation plus denial/failure paths.

## Remaining Technical Debt

| Item | Severity | Classification | Why it does not block M6 closeout |
| --- | --- | --- | --- |
| Apply response replay and idempotency after a lost caller response needs a clearer first-class recovery path. | Medium | Non-blocking runtime recovery debt | Successful apply already records bounded ledger evidence and consumes authorization. The gap is ergonomic recovery and idempotent response reconstruction, not absence of controlled mutation. |
| `proposal.apply` now has operation-specific branching for replace/create/delete. | Medium | Non-blocking maintainability debt | The branching is bounded and covered by behavior tests. Refactoring it would not add a new Product Charter capability by itself. |
| Multi-file transactions, arbitrary rename, directory mutation, and recursive deletion are unavailable. | Medium | Deferred feature scope | M6 intentionally scoped to one-file primitives. Broader mutation requires a separate value gate and safety design. |
| Runtime-owned verification command execution is unavailable. | High | Next strategic capability gap | Brownie can mutate files safely, but validation still happens outside the runtime. This is a reason to move to the next milestone, not to extend M6. |
| Historical diagnostics and review wrapper surfaces remain verbose. | Medium | Non-blocking consolidation debt | R2.1 guards and M6 value gates prevent wrapper-only regression. Consolidation can happen later if it removes real complexity. |
| Rust protocol, VSIX protocol, validators, and tests duplicate exact response keys. | Low | Boundary duplication debt | Duplication is deliberate at the protocol boundary and currently catches drift. Schema generation can be evaluated later. |

## Blocker Classification

No M6 blocker remains.

Non-blockers:

- apply replay/idempotency ergonomics;
- internal apply branching;
- wider mutation primitives;
- verification execution;
- wrapper-surface consolidation;
- protocol validator duplication.

These do not prevent Brownie from safely applying one approved replace/create/delete file mutation under Rust runtime authority.

## Why No M6.4 Is Created

An additional M6 phase is rejected unless it adds a distinct runtime capability that blocks closeout. The obvious candidates do not meet that bar for M6:

- Another readiness, report, digest, history, verdict, preview, or inspection surface would be wrapper-only.
- Refactoring `proposal.apply` branching is maintainability work, not a new runtime capability.
- Multi-file transactions, rename, directory mutation, shell execution, git execution, network, and service control exceed the M6 one-file safety boundary.
- Apply replay/idempotency recovery is real debt, but current ledger evidence is sufficient for safe stop-and-inspect behavior. It should be reconsidered only as a bounded future phase if a concrete lost-response blocker is reproduced.

## Product Charter Alignment

M6 aligns with the Product Charter because it adds real runtime capability:

- thin VSIX: the VSIX requests apply but does not own policy;
- Rust-owned execution authority: mutation gates and writes are enforced in Rust;
- runtime-enforced permissions: proposal generation and apply require runtime policy and approval;
- controlled workspace tools: replace/create/delete are mediated operations, not raw shell access;
- persistent structured ledger: apply results are recorded as structured bounded metadata;
- headless long-running autonomous development: callers receive deterministic status, failed checks, consumed authorization state, and post-mutation evidence.

M6 also respects the non-goals:

- it does not replicate Zoo Code source;
- it does not optimize for endpoint count;
- it does not add wrapper-only progress;
- it does not treat CI success alone as product value.

## Decision

`MILESTONE_COMPLETE`

## Decision Rationale

M6 should close because its core promise is delivered: an approved proposal can now become an actual bounded workspace mutation under Rust runtime authority. Replace, create, and delete cover the minimum useful single-file mutation set for autonomous development. Remaining gaps are either future capabilities or maintainability work, not evidence that M6's runtime mutation boundary is incomplete.

## Next Strategic Capability

Selected next milestone: `M7 Controlled Verification Execution`

Primary Product Charter capability advanced:

- `headless_autonomous_development`

Related capabilities:

- `controlled_workspace_tools`
- `runtime_permission_enforcement`
- `persistent_structured_ledger`
- `agent_loop`

## Next Milestone Rationale

After M6, Brownie can safely change workspace files, but it cannot yet verify those changes from inside the Rust-owned runtime. The current automation can run `cargo`, `pnpm`, and GitHub CI externally, but Brownie's headless runtime cannot request a bounded verification action, enforce command permissions, capture sanitized output metadata, record verification evidence, or use that evidence as a completion gate.

The next milestone should therefore add the smallest controlled verification execution capability. It should not be generic shell execution. A suitable first phase candidate is a bounded allowlisted verification command path, such as one configured repository check with timeout, working-directory containment, sanitized output preview, exit-code recording, and ledger evidence. Network, secrets, service control, interactive processes, arbitrary shell, and mutation should remain out of scope unless separately authorized by runtime policy.

## Next Milestone Boundary

M7 planning must preserve these boundaries:

- no arbitrary shell execution;
- no git mutation;
- no network access by default;
- no service control;
- no interactive process control;
- no raw stdout/stderr persistence;
- no environment or secret exposure;
- no completion claim based on unverified caller text;
- verification evidence must be bounded, structured, and replay-safe;
- Rust runtime remains the execution and permission authority.

## State Transition

Closeout input state:

- `current_milestone`: `M6 Controlled Apply Execution`
- `current_phase`: `M6.closeout`
- `status`: `milestone_closeout`
- `last_reviewed_pr`: `134`
- `latest_pr`: `null`
- `work_branch`: `null`

Closeout output state:

- `current_milestone`: `M7 Controlled Verification Execution`
- `current_phase`: `M7.planning`
- `status`: `planning_required`
- `active_prompt`: `null`
- `latest_pr`: `null`
- `work_branch`: `null`

The next scheduled run should perform `planning_required` for the first bounded M7 phase. It must define a real runtime verification execution capability, not another report or readiness wrapper.
