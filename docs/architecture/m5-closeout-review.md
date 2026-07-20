# M5 Subtask Orchestration Closeout Review

## Scope

- M5.1 through M5.38
- final reviewed PR: #129
- verification mode: `m5_closeout_verification`
- closeout decision: `M5_COMPLETE`

This report verifies that Brownie's M5 Subtask Orchestration milestone was closed by evidence, not by state-only advancement. The current external state may remain at `controlled_apply_readiness.planning` / `planning_blocked` because M5 closeout artifacts, review memory, and Product Charter alignment support that transition.

## Product Capability Delivered

M5 delivered runtime-owned subtask orchestration inside Brownie's no-write / no-apply boundary. Pre-M5, approved `subtask.spawn` intent could not safely become controlled runtime child work with explicit parent/child lifecycle recovery. By M5.38, Brownie can:

- queue approved `subtask.spawn` intent without auto-running children;
- materialize controlled child `TaskRecord` entities from handoff evidence;
- preserve parent task/run, source candidate, handoff envelope, source intent, requested goal, and requested mode provenance;
- run controlled children only through explicit `task.run`;
- expose bounded child status and result evidence from parent/child inspection;
- consume completed or failed child evidence through explicit parent continuation;
- prevent duplicate parent joins through replay fingerprints and atomic admission;
- materialize continuation and recovery children without scheduler handoff or child auto-run;
- bound recovery cycles and surface budget exhaustion;
- replay lost parent responses without mutating runtime state;
- guide a headless caller to the next explicit action without raw ledger scans.

This materially advances `subtask_orchestration` and `headless_autonomous_development` while preserving Brownie's safety boundary.

## Architecture Outcome

M5 ended with the following architecture outcome:

- Parent/child task model: controlled child tasks are first-class `TaskRecord` entities with parent/source provenance and explicit lifecycle admission.
- Handoff envelope: accepted handoff evidence can materialize one or more controlled queued children, while duplicate prevention is scoped to parent run, source candidate, and handoff fingerprint.
- Continuation admission: parent continuation consumes bounded terminal child evidence through explicit `task.run`, not through background scheduling.
- Replay protection: parent join identity uses bounded result fingerprints and atomic admission behavior rather than preview text.
- Recovery cycles: failed children can be recovered through bounded parent continuation and recovery child materialization, with repeated cycles capped by budget.
- Provenance enforcement: controlled child and recovery child `task.run` paths validate parent/source provenance before admission.
- Readiness/inspection surfaces: parent and child result/inspection surfaces expose bounded next-action guidance for remaining children, parent joins, and non-runnable children.
- Consumed join recovery: after parent join consumption, parent and child inspection can recover continuation child handles or safe inspection guidance without stale parent rerun advice.

## Evidence

Relevant PR and review evidence:

- PR #129 / M5.38 is confirmed as the final reviewed and merged M5 implementation PR.
- `latest-review.md` records `M5_COMPLETE` and PR #129 / M5.38 as the closeout point.
- `review-memory.md` records accepted and merged reviews through PR #129, followed by manual re-review rejecting M5.39 and a closeout review choosing `M5_COMPLETE`.
- `m5-closeout-review.md` exists in the external automation root and requires a decision among `M5_COMPLETE`, `M5_CLOSEOUT_REFACTOR_REQUIRED`, and `M5_BLOCKED`.
- Product Charter identifies Brownie as an independent Rust-owned autonomous development runtime with thin Code-OSS VSIX, agent loop, external Mode Packs, runtime-enforced permissions, controlled tools, persistent state, and headless long-running workflows.

Relevant M5 runtime capability sequence:

| Phase | Outcome |
| --- | --- |
| M5.1-M5.10 | Prepared queued subtask, handoff, dispatch readiness, candidate, and envelope evidence while keeping execution blocked. |
| M5.11 | Materialized controlled queued child `TaskRecord` from accepted handoff envelope. |
| M5.12 | Admitted controlled queued child into explicit `task.run`. |
| M5.13 | Exposed bounded parent-side child inspection. |
| M5.14-M5.16 | Added sanitized source intent, structured input, requested goal/mode, and multi-candidate materialization. |
| M5.17-M5.21 | Added explicit parent join/continuation, replay protection, atomic admission, continuation child materialization, and multi-cycle orchestration. |
| M5.22-M5.29 | Added failed-child recovery, recovery child join cycles, provenance guards, recovery budget guard, budget outcome, and stable replay. |
| M5.30-M5.32 | Added child orchestration outcome and replay from lost initial or parent-join responses. |
| M5.33-M5.36 | Added child and parent inspection readiness for parent joins, including set-aware child readiness. |
| M5.37-M5.38 | Added direct-child and parent-centric consumed-parent-join recovery guidance. |

Relevant invariants:

- no scheduler auto-dispatch;
- no child auto-run;
- no external worker;
- no unrestricted process execution;
- no network bypass;
- no service control;
- no patch apply;
- no direct workspace mutation;
- no raw prompt, provider response, file content, stdout, stderr, environment, raw tool input, request body, or failure payload exposure;
- no resumption of the Phase 3 diagnostics wrapper chain.

## Completion Criteria Verification

M5 closeout satisfies the required criteria:

1. M5.1 through M5.38 capability summary exists in this report and in review memory.
2. PR #129 is treated as the final reviewed PR.
3. Closeout decision is explicit: `M5_COMPLETE`.
4. The decision is one of the allowed closeout decisions.
5. Unresolved M5 issues are classified below as technical debt, not runtime blockers.
6. M5.39 is rejected because it would add another admission/surface layer without a required new runtime capability for M5 completion.
7. The next milestone is `controlled_apply_readiness`, selected to advance controlled workspace tool readiness rather than extend M5.
8. The transition aligns with Product Charter goals and non-goals.
9. External state transition rationale is recorded in `latest-review.md`, `review-memory.md`, `stop-reason.md`, and this report.
10. Implementation remains unstarted: no branch, commit, push, PR, Rust change, TypeScript change, patch apply, or controlled apply implementation was performed by this verification task.

## Remaining Technical Debt

| Item | Severity | Why it does not justify M5.39 | Target future milestone |
| --- | --- | --- | --- |
| Child and parent consumed-join recovery summaries duplicate concepts. | Medium | Consolidation would simplify API shape, but current runtime recovery works and is bounded. | Controlled apply readiness planning or later architecture cleanup. |
| `next_action=inspect_parent_task` can be self-referential in parent inspection. | Medium | It is a guidance naming/state issue, not a correctness failure in child materialization, parent join, or recovery. | Future orchestration model cleanup. |
| M5.30-M5.38 increased outcome/readiness/recovery surface area. | Medium | Additional M5 phases would likely worsen surface growth. The right move is consolidation, not M5.39. | Protocol/model consolidation before or during controlled workspace tool design. |
| Rust protocol, VSIX protocol, validators, and tests duplicate exact-key contracts. | Low | Duplication is deliberate at the protocol boundary and currently supports safety validation. | Future protocol schema generation or shared validator design. |
| Phase value guard can be modified by the PR under review. | Low | This is review process debt, not a blocker for completed M5 runtime capability. | Automation/review policy hardening. |

## Closeout Risks

- Duplication: child/parent recovery and readiness models should be unified before adding more orchestration surfaces.
- Self-referential next action: parent inspection should avoid guidance that points to itself without state change.
- Inspection surface growth: future work should consolidate summaries rather than add new wrappers.
- Non-blocking unresolved issues: all known issues are maintainability, naming, or review-policy risks, not evidence that M5's core runtime operations fail.

## Decision

`M5_COMPLETE`

## Decision Rationale

M5 should end at M5.38 because the milestone's core runtime capabilities are present and reviewed: controlled child materialization, explicit child execution, parent continuation, replay protection, recovery cycles, provenance enforcement, lost-response replay, and consumed-join recovery. The remaining issues are technical debt and API consolidation work.

M5.39 should not be created from the current roadmap because its proposed resume-token admission guard would add another M5-specific surface after the caller already has bounded next-action recovery. It may become relevant only if a future milestone identifies a concrete stale-execution blocker that cannot be addressed by consolidating existing models.

## Next Strategic Capability

Selected next milestone: `controlled_apply_readiness`

Primary Product Charter capability advanced: `controlled_workspace_tools`

Related capabilities:

- `runtime_permission_enforcement`: controlled apply readiness must define runtime-owned permission gates before any workspace-affecting operation exists.
- `controlled_workspace_tools`: Brownie needs a safe path from orchestration/planning to controlled workspace tool readiness.
- `headless_autonomous_development`: headless operation requires bounded, replay-safe, permission-aware apply readiness instead of raw file or shell access.

This has higher product value than M5.39 because Brownie can already orchestrate subtasks, but still cannot safely approach workspace-affecting tools. The Product Charter explicitly includes controlled tools and runtime-enforced permissions, and explicitly rejects observability-only or endpoint-count progress.

## Controlled Apply Readiness Planning Boundary

This closeout verification does not implement controlled apply. It only records planning scope for the next milestone:

- apply authority must be owned by the Rust runtime;
- human approval boundary must be explicit;
- approval expiry must be represented;
- stale content checks must be required;
- expected hash validation must gate writes;
- atomic write semantics must be designed before implementation;
- backup/rollback behavior must be specified;
- symlink handling must be explicit and safe;
- path traversal prevention must be enforced;
- file kind validation must be defined;
- post-apply hash verification must be required;
- failure recovery must be specified;
- git diff verification must be separated from mutation authority;
- test execution boundary must be separate from apply authority;
- shell/network permissions must remain separate from workspace mutation authority;
- headless operation must use bounded approval/readiness evidence, not implicit apply.

No patch apply, workspace mutation, process execution expansion, network bypass, service control, or implementation phase starts from this document.

## State Transition

Previous closeout state:

- `current_phase`: `M5.closeout`
- `status`: `planning_blocked`
- `last_reviewed_pr`: `129`
- `latest_pr`: `null`
- `work_branch`: `null`

Verified normalized state:

- `current_phase`: `controlled_apply_readiness.planning`
- `status`: `planning_blocked`
- `last_reviewed_pr`: `129`
- `latest_pr`: `null`
- `work_branch`: `null`

The transition is valid because closeout decision is `M5_COMPLETE`, PR #129 is the final reviewed M5 PR, and the next milestone is planning-only. Implementation remains blocked until a separate, explicit planning prompt is approved. The active prompt is intentionally `null` so the scheduled loop will not accidentally reuse the M5 closeout prompt or begin implementation.
