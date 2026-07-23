# M8 Controlled Recovery Execution Closeout Review

## Scope

- M8.1 Verification Failure Recovery Task Admission
- M8.2 Controlled Recovery Repair Proposal From Verifier Failure
- M8.3 Controlled Recovery Verification Retry Execution
- final M8 implementation PR: #142
- verification mode: `m8_closeout_verification`
- closeout decision: `MILESTONE_COMPLETE`

This report closes M8 by capability evidence, not by endpoint count or CI status alone. M8's purpose was to consume bounded verifier-failure evidence and advance the runtime from a failed task into an explicit, replay-safe recovery path. The milestone is complete because Brownie can now admit a recovery task, run that recovery task into a bounded repair proposal, consume approved `proposal.apply` evidence, and explicitly retry the failed verifier set under Rust runtime authority.

## Product Capability Delivered

Before M8, Brownie could execute fixed verifiers and fail a task when required verifier evidence did not pass, but recovery remained external. After M8, Brownie can:

- validate terminal verifier-gate failure evidence and admit exactly one recovery task for a failure fingerprint;
- return bounded recovery admission metadata with `next_action=run_recovery_task_explicitly`;
- explicitly run the admitted recovery task through the existing `task.run` path;
- revalidate recovery provenance before `TaskRunning`;
- create at most one recovery-scoped repair proposal through the existing `workspace.write` proposal pipeline;
- keep `proposal.apply` as the only workspace mutation authority;
- validate latest successful recovery-scoped apply evidence before retry admission;
- admit or replay exactly one verification retry task for the source/recovery/proposal/apply fingerprint tuple;
- explicitly run the retry task through existing controlled verifier executors;
- execute exactly the failed verifier tool IDs, restricted to `verification.cargo_fmt_check` and `verification.cargo_check`;
- return bounded retry outcome metadata with retried, passed, and failed verifier IDs;
- replay terminal recovery repair and retry outcomes without duplicate task-running, proposal, or verifier-execution evidence;
- keep raw stdout, raw stderr, command strings, prompts, provider responses, file content, absolute paths, canonical paths, raw request bodies, tool input, environment values, and secrets out of retry admission and retry outcome surfaces.

This materially advances `headless_autonomous_development`, `runtime_permission_enforcement`, `controlled_workspace_tools`, `persistent_structured_ledger`, and `agent_loop`.

## Capability Inventory

| Phase | PR | Capability |
| --- | --- | --- |
| M8.1 | #140 | Adds `task.start` recovery admission from terminal verifier-gate failure evidence, with bounded recovery provenance and replay by failure fingerprint. |
| M8.2 | #141 | Adds explicit recovery task execution through `task.run`, revalidating source failure evidence and creating one recovery-scoped repair proposal without applying it. |
| M8.3 | #142 | Adds explicit verification retry admission and execution from source/recovery/proposal/apply evidence, executing only the failed controlled verifier set and replaying terminal retry outcomes. |

## Architecture Outcome

M8 keeps the VSIX thin and keeps recovery authority in the Rust runtime:

- failed verifier evidence is derived from the structured ledger, not raw command output;
- recovery task admission uses existing `task.start`, not a new RPC;
- recovery execution uses existing `task.run`, not an out-of-band automation path;
- repair proposals stay inside the existing `workspace.write` proposal model;
- `proposal.apply` remains the only mutating workspace path;
- retry admission consumes bounded apply result evidence and requires explicit retry authorization;
- verifier retry execution reuses the existing controlled verifier tools and `ExecuteProcess` permission gates;
- terminal retry replay returns existing bounded outcome evidence without appending duplicate ledger events;
- all recovery state is durable enough for a headless caller to decide the next explicit action.

## Evidence

Relevant merged PR evidence:

- PR #140 merged M8.1 verification recovery admission at `1d08bb7944af1de272a5e3347a48063fb91b371e`.
- PR #141 merged M8.2 recovery repair proposal execution at `ae330cba6433191139945ed6daf8ebf9269b60d3`.
- PR #142 merged M8.3 recovery verification retry execution at `1c9493bc920acb107fe378e43dbd6d80cf01f7a2`.
- Each M8 implementation PR passed GitHub CI `check`.
- `docs/architecture/phase-value-manifest.m8.1.json`, `docs/architecture/phase-value-manifest.m8.2.json`, and `docs/architecture/phase-value-manifest.m8.3.json` archive the value gates for the three M8 runtime phases.

Relevant implementation evidence:

- `crates/brownie-runtime/src/lib.rs` validates recovery sources, revalidates recovery and retry provenance, creates recovery-scoped proposals, executes retry verifier tools, and returns bounded recovery outcomes.
- `crates/brownie-store/src/lib.rs` stores verification recovery and retry provenance and provides replay lookup for recovery and retry tasks.
- `crates/brownie-protocol/src/lib.rs` exposes bounded recovery source, admission, provenance, repair outcome, and retry outcome types.
- `extensions/brownie-vsix/src/runtime/protocol.ts` validates the bounded recovery and retry protocol surfaces without moving policy into the VSIX.

Relevant validation evidence:

- PR #142 GitHub CI `check`: pass.
- Local M8.3 validation before PR #142: `cargo fmt --check`, `cargo check --workspace`, `cargo test --workspace`, `pnpm install --frozen-lockfile`, `pnpm guard:diagnostics`, `pnpm guard:phase-value`, `pnpm --filter brownie-vsix check`, `pnpm --filter brownie-vsix test`, `pnpm --filter brownie-vsix build`, and `git diff --check`: pass.
- M8 phase-complete validation: `pnpm guard:diagnostics`, `pnpm guard:phase-value`, and `git diff --check`: pass.
- Open PR list before closeout report branch creation: empty.
- `main` pointed at M8.3 merge commit `1c9493bc920acb107fe378e43dbd6d80cf01f7a2`.

## Completion Criteria Verification

M8 closeout satisfies the required criteria:

1. Brownie can recover from verifier-gate failure evidence without raw ledger scraping.
2. Recovery admission is explicit and replay-safe.
3. Recovery task execution is explicit and revalidates latest source failure evidence.
4. Recovery task execution creates a bounded repair proposal rather than applying workspace changes directly.
5. Recovery-scoped proposals remain under existing approval, preflight, and apply gates.
6. Retry admission requires latest successful apply evidence and explicit retry authorization.
7. Retry task identity is replay-safe for the source/recovery/proposal/apply fingerprint tuple.
8. Retry execution revalidates source, recovery, proposal, and apply evidence before `TaskRunning`.
9. Retry execution runs exactly the failed controlled verifier set.
10. Retry execution uses existing `ExecuteProcess` permission gates and controlled verifier executors.
11. Terminal repair and retry replay paths do not duplicate durable ledger evidence.
12. Raw command output, prompts, provider responses, file content, paths, environment values, raw request bodies, and secrets remain out of recovery RPC and ledger surfaces.

## Remaining Technical Debt

| Item | Severity | Classification | Why it does not block M8 closeout |
| --- | --- | --- | --- |
| Recovery retry apply fingerprints are a runtime helper rather than a named protocol concept. | Medium | Non-blocking protocol documentation debt | The fingerprint is deterministic and covered by behavior tests. Naming it can be done when another recovery feature consumes it. |
| Recovery proposal quality depends on bounded LLM/tool-intent behavior and does not expose raw verifier output. | Medium | Deliberate safety tradeoff | M8 proves the control path, not advanced repair synthesis. Raw output remains intentionally unavailable. |
| Retry execution supports only M7 verifier tools. | Medium | Deferred verifier expansion | The bounded verifier set is consistent with M7. More verifiers need separate safety design. |
| Successful retry does not automatically mark or resume the original failed source task. | Medium | Future workflow capability | M8 provides durable retry outcome evidence and next actions. Automatic source-task completion or continuation would be a distinct capability. |
| Codebase discovery remains limited to prompt/context assembly and explicit workspace reads. | High | Next strategic capability gap | Recovery can now loop, but the runtime still lacks a first-class codebase index for choosing relevant files in larger tasks. |
| Historical diagnostics wrapper surfaces remain verbose. | Medium | Non-blocking consolidation debt | R2.1 and phase-value guards prevent wrapper-only regression. Consolidation should happen only when it removes real complexity. |

## Blocker Classification

No M8 blocker remains.

Non-blockers:

- named apply-fingerprint protocol documentation;
- richer bounded repair synthesis;
- additional verifier tools;
- automatic original-task completion after retry success;
- codebase indexing;
- legacy diagnostics wrapper consolidation.

These do not prevent Brownie from performing the M8 verifier-failure recovery loop under Rust runtime authority.

## Why No M8.4 Is Created

An additional M8 phase is rejected unless it adds a distinct runtime execution capability that blocks closeout. The obvious candidates do not meet that bar now:

- Another recovery report, digest, history, readiness, or inspection surface would be wrapper-only.
- Repackaging the M8.3 retry outcome under a new response shape would duplicate an existing concept.
- Adding another small retry status endpoint would not change runtime behavior.
- Generic shell, git, network, service, or arbitrary test execution would exceed the M8 safety boundary.
- Automatic completion of the original source task after retry success is real future workflow work, but it is not required for the M8 recovery loop to be usable by a headless caller.

## Product Charter Alignment

M8 aligns with the Product Charter because it adds real runtime capability:

- thin VSIX: the VSIX validates protocol shape but does not own recovery policy;
- Rust-owned execution authority: recovery admission, repair proposal creation, apply-evidence validation, retry admission, and retry execution are enforced in Rust;
- explicit agent loop: recovery and retry are explicit task lifecycle steps;
- runtime-enforced permissions: repair proposal creation and retry verifier execution use existing mode policy gates;
- controlled workspace tools: recovery can propose and consume approved apply evidence without bypassing proposal.apply;
- persistent structured ledger: recovery provenance, repair proposal metadata, apply evidence, and retry outcomes are durable bounded records;
- headless long-running autonomous development: callers receive deterministic next actions and can continue through failure, repair, apply, retry, and replay without raw data scraping.

M8 also respects the non-goals:

- it does not replicate Zoo Code source;
- it does not optimize for endpoint count;
- it does not add wrapper-only progress;
- it does not treat CI success alone as product value.

## Decision

`MILESTONE_COMPLETE`

## Decision Rationale

M8 should close because its core promise is delivered: Brownie can move from verifier-gated task failure into a controlled recovery attempt, produce a reviewable repair proposal, validate explicit apply evidence, retry the failed verifier set, and persist bounded replay-safe recovery outcome evidence. Remaining gaps are future workflow or indexing capabilities, not blockers to M8's recovery execution milestone.

## Next Strategic Capability

Selected next milestone: `M9 Runtime Codebase Indexing`

Primary Product Charter capability advanced:

- `codebase_indexing`

Related capabilities:

- `context_management`
- `headless_autonomous_development`
- `persistent_structured_ledger`
- `runtime_permission_enforcement`

## Next Milestone Rationale

After M8, Brownie can think, mutate, verify, and recover under runtime authority for bounded tasks. The next major autonomy gap is codebase discovery: headless tasks still rely on prompt-provided context, explicit workspace reads, and recent ledger evidence. Brownie does not yet have a runtime-owned index that can inventory workspace files, classify safe source files, track content fingerprints, and provide bounded retrieval handles for context planning.

The next milestone should therefore add the smallest codebase indexing execution capability. The first phase should avoid semantic overreach and focus on a deterministic runtime-owned workspace inventory/index that can be built, refreshed, persisted, and queried through bounded metadata. It should not expose raw file content by default, mutate the workspace, run shell/git/network commands, or move policy into the VSIX.

## Next Milestone Boundary

M9 planning must preserve these boundaries:

- no workspace mutation;
- no shell, git, network, service, or arbitrary process execution;
- no raw file content, raw diffs, prompts, provider responses, stdout, stderr, environment values, absolute paths, canonical paths, or secrets in index RPC or ledger surfaces;
- workspace-relative paths only;
- protected paths denied;
- parent traversal denied;
- bounded file size and entry count limits;
- deterministic index fingerprints for replay and refresh decisions;
- Rust runtime remains the indexing, permission, and state authority;
- VSIX may display/query index state but must not own indexing policy.

## State Transition

Closeout input state:

- `current_milestone`: `M8 Controlled Recovery Execution`
- `current_phase`: `M8.closeout`
- `status`: `milestone_closeout`
- `last_reviewed_pr`: `142`
- `latest_pr`: `null`
- `work_branch`: `null`

Closeout output state after closeout PR merge:

- `current_milestone`: `M9 Runtime Codebase Indexing`
- `current_phase`: `M9.planning`
- `status`: `planning_required`
- `active_prompt`: `null`
- `latest_pr`: `null`
- `work_branch`: `null`

The next scheduled run after this report merges should perform `planning_required` for the first bounded M9 phase. It must define a real runtime-owned codebase indexing capability, not another recovery report, diagnostics wrapper, or readiness surface.
