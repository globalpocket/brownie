# M7 Controlled Verification Execution Closeout Review

## Scope

- M7.1 Controlled Cargo Fmt Verification Execution
- M7.2 Controlled Cargo Check Verification Execution
- M7.3 Verification Evidence Completion Gate
- final M7 implementation PR: #138
- verification mode: `m7_closeout_verification`
- closeout decision: `MILESTONE_COMPLETE`

This report closes M7 by capability evidence, not by endpoint count or CI status alone. M7's purpose was to move Brownie from externally verified autonomous work toward Rust-owned verification execution and completion gating. The milestone is complete because Brownie can now execute two fixed verifier tools under runtime permission authority and can use their bounded evidence to prevent overclaiming task completion.

## Product Capability Delivered

Before M7, Brownie could safely mutate workspace files through `proposal.apply`, but validation still lived outside the runtime in local automation or GitHub CI. After M7, Brownie can:

- execute a fixed `verification.cargo_fmt_check` verifier through `tool.execute` and task-scoped tool execution;
- execute a fixed `verification.cargo_check` verifier through the same runtime-owned tool path;
- require `ExecuteProcess` permission before launching either verifier;
- deny generic `process.exec` even when controlled verifiers are allowed;
- reject caller-supplied commands, argv, cwd, environment, stdin, shell, timeout, package, feature, target, path, and unknown verifier inputs as applicable;
- run cargo check with `--workspace --all-targets --locked --offline`;
- redirect cargo check artifacts to a runtime-owned isolated target directory outside the workspace and clean it best-effort;
- reject cargo check workspaces with `build.rs` in this phase;
- record bounded `ToolExecution*` ledger evidence only;
- keep raw stdout, raw stderr, command strings, raw input JSON, environment values, target directory paths, file content, absolute paths, canonical paths, prompts, provider responses, and secrets out of RPC and ledger payloads;
- make requested `verification.cargo_fmt_check` and `verification.cargo_check` evidence a `task.run` completion gate;
- turn task completion into terminal failure when required verifier evidence is denied, rejected, failed, timed out, spawn-failed, missing, malformed, stale, or not passed.

This materially advances `headless_autonomous_development`, `runtime_permission_enforcement`, `controlled_workspace_tools`, `persistent_structured_ledger`, and `agent_loop`.

## Capability Inventory

| Phase | PR | Capability |
| --- | --- | --- |
| M7.1 | #136 | Adds fixed Rust-owned `verification.cargo_fmt_check` execution with permission gating, bounded process metadata, and generic `process.exec` denial. |
| M7.2 | #137 | Adds fixed Rust-owned `verification.cargo_check` execution with offline locked cargo check, isolated target artifacts, bounded metadata, and strict input rejection. |
| M7.3 | #138 | Promotes current-run controlled verifier evidence into a `task.run` completion gate so requested verification must pass before terminal completion. |

## Architecture Outcome

M7 keeps the VSIX thin and keeps execution policy in the Rust runtime:

- verifier execution is exposed through the existing runtime tool path;
- `ExecuteProcess` permission applies to fixed verifier tools only;
- `process.exec` remains a non-executable planning surface;
- task-scoped verifier intents are recorded as bounded ledger events;
- terminal task status is decided by runtime-owned current-run ledger evidence, not by LLM text;
- completion-gate metadata is bounded and replay-safe;
- headless callers can route failed verifier tasks to recovery without scraping raw command output.

## Evidence

Relevant merged PR evidence:

- PR #136 merged M7.1 controlled cargo fmt verification execution at `5e2887f9d8cc2ff57470935136664e2dba63ff42`.
- PR #137 merged M7.2 controlled cargo check verification execution at `af7158c1e69d7afabafa26ff942a6b3731c42c27`.
- PR #138 merged M7.3 verification evidence completion gate at `c78258ffde382337310052db6f2e16ed0a20a7e0`.
- Each M7 PR passed GitHub CI `check`.
- `docs/architecture/runtime-overview.md` documents the M7 controlled verification boundary.
- `docs/specifications/agent-loop-spec-v0.md` documents M7 controlled verifier execution and completion gates.
- `docs/architecture/phase-value-manifest.m7.1.json`, `docs/architecture/phase-value-manifest.m7.2.json`, and `docs/architecture/phase-value-manifest.m7.3.json` archive the value gates for the three M7 runtime phases.

Relevant implementation evidence:

- `crates/brownie-tools/src/lib.rs` defines and validates `verification.cargo_fmt_check` and `verification.cargo_check`.
- `crates/brownie-runtime/src/lib.rs` routes fixed verifier execution through runtime permissions and stores bounded terminal evidence.
- `crates/brownie-runtime/src/lib.rs` evaluates `verification_completion_gate` before terminal task status.
- `crates/brownie-protocol/src/lib.rs` exposes bounded `TaskRunVerificationCompletionGate` result metadata.

Relevant validation evidence:

- PR #138 GitHub CI `check`: pass.
- Local M7.3 validation before PR #138: `cargo fmt --check`, `cargo check --workspace`, `cargo test --workspace`, `pnpm install`, `pnpm guard:diagnostics`, `pnpm guard:phase-value`, `pnpm --filter brownie-vsix check`, `pnpm --filter brownie-vsix test`, `pnpm --filter brownie-vsix build`, and `git diff --check`: pass.
- M7 closeout preparation validation: `pnpm guard:diagnostics`, `pnpm guard:phase-value`, and `git diff --check HEAD~1...HEAD`: pass.
- Open PR list before closeout report branch creation: empty.
- `main` and `origin/main` pointed at merge commit `c78258ffde382337310052db6f2e16ed0a20a7e0`.

## Completion Criteria Verification

M7 closeout satisfies the required criteria:

1. Brownie has real runtime-owned verification execution.
2. Verification execution is fixed and allowlisted, not generic shell execution.
3. Verifier launch is gated by runtime permissions.
4. Generic `process.exec` remains denied.
5. Caller-supplied command, argv, cwd, environment, stdin, shell, and timeout controls are rejected.
6. Cargo check uses locked offline execution and isolated target artifacts.
7. Verifier results are structured and bounded.
8. Raw stdout, stderr, commands, environment, paths, prompts, provider responses, file content, and secrets are not exposed.
9. Task-scoped verifier evidence is recorded in the structured ledger.
10. `task.run` completion consumes verifier evidence before terminal completion.
11. Failed, denied, rejected, missing, stale, timed-out, or malformed verifier evidence fails closed.
12. CI and behavior tests cover successful verification, failed verification, denied verification, input rejection, and bounded metadata.

## Remaining Technical Debt

| Item | Severity | Classification | Why it does not block M7 closeout |
| --- | --- | --- | --- |
| Cargo check rejects workspaces with `build.rs`. | Medium | Non-blocking safety boundary debt | The restriction is conservative and documented. It prevents uncontrolled build-script execution in the first compile verifier. |
| Cargo test, clippy, pnpm, git, service, and custom verifier execution are unavailable. | Medium | Deferred verifier expansion | M7 intentionally delivered the smallest useful fixed verifier set. Additional verifier types need separate value gates and safety design. |
| Verification failure recovery is manual and caller-driven. | High | Next strategic capability gap | M7 returns bounded failed verifier evidence and recovery metadata, but it does not yet perform controlled repair or retry loops. This is the next milestone, not an M7 blocker. |
| Verifier output remains fully redacted except for bounded metadata. | Low | Deliberate safety tradeoff | Raw output redaction preserves ledger safety. Future repair planning may need bounded diagnostic summaries without raw output. |
| Historical diagnostics wrapper surfaces remain verbose. | Medium | Non-blocking consolidation debt | R2.1 guards and phase-value checks prevent wrapper-only regression. Consolidation should happen only when it removes real complexity. |

## Blocker Classification

No M7 blocker remains.

Non-blockers:

- build-script/proc-macro verification support;
- additional verifier tools;
- bounded diagnostic summaries for repair planning;
- controlled verification failure recovery;
- legacy diagnostics wrapper consolidation.

These do not prevent Brownie from executing fixed runtime-owned verification and enforcing verifier evidence before task completion.

## Why No M7.4 Is Created

An additional M7 phase is rejected unless it adds a distinct runtime verification capability that blocks closeout. The obvious candidates do not meet that bar now:

- Another readiness, report, digest, history, verdict, preview, or inspection surface would be wrapper-only.
- A third fixed verifier before closeout would be incremental verifier expansion, not completion of the M7 core loop.
- Generic shell, git, network, service, and arbitrary test execution exceed the M7 safety boundary.
- Verification failure recovery is real work, but it is downstream of M7: M7 supplies the evidence; the next milestone should consume it for controlled recovery.

## Product Charter Alignment

M7 aligns with the Product Charter because it adds real runtime capability:

- thin VSIX: the VSIX can surface verifier state but does not own verifier policy;
- Rust-owned execution authority: verifier launch and terminal task status are decided in Rust;
- explicit agent loop: verifier evidence now affects `task.run` completion;
- runtime-enforced permissions: verifier execution requires `ExecuteProcess`;
- controlled workspace tools: verification is fixed and bounded, not arbitrary process access;
- persistent structured ledger: verifier evidence and completion gate results are recorded as structured metadata;
- headless long-running autonomous development: callers can trust verification-backed completion and route failed verification without raw output scraping.

M7 also respects the non-goals:

- it does not replicate Zoo Code source;
- it does not optimize for endpoint count;
- it does not add wrapper-only progress;
- it does not treat CI success alone as product value.

## Decision

`MILESTONE_COMPLETE`

## Decision Rationale

M7 should close because its core promise is delivered: Brownie can execute bounded fixed verification under Rust authority and can prevent requested verification failures from being reported as successful task completion. Remaining gaps are either future verifier expansion or controlled recovery work. Extending M7 with another report or another similar verifier would dilute the milestone without materially changing the runtime loop.

## Next Strategic Capability

Selected next milestone: `M8 Controlled Recovery Execution`

Primary Product Charter capability advanced:

- `headless_autonomous_development`

Related capabilities:

- `agent_loop`
- `controlled_workspace_tools`
- `runtime_permission_enforcement`
- `persistent_structured_ledger`

## Next Milestone Rationale

After M7, Brownie can mutate workspace files and verify requested formatting and compile/type-check evidence inside the runtime. The remaining headless autonomy gap is recovery: when verification fails, a caller can see bounded failure metadata, but Brownie does not yet convert that evidence into a controlled recovery attempt, bounded repair proposal, retry admission, or explicit next-run state transition under runtime authority.

The next milestone should therefore add the smallest controlled recovery execution capability. It should consume existing bounded failure evidence, preserve Rust runtime authority, avoid raw verifier output leakage, and keep recovery actions explicit and replay-safe. It must not turn into a new report chain or generic shell execution path.

## Next Milestone Boundary

M8 planning must preserve these boundaries:

- no generic shell execution;
- no git mutation;
- no network access by default;
- no service control;
- no automatic workspace mutation without existing proposal approval and apply authorization gates;
- no raw stdout/stderr, prompt, provider response, file content, command string, environment value, absolute path, canonical path, or secret in ledger or RPC responses;
- recovery must be derived from bounded runtime evidence;
- retry or repair admission must be replay-safe and must not duplicate consumed actions;
- Rust runtime remains the execution, permission, and state authority.

## State Transition

Closeout input state:

- `current_milestone`: `M7 Controlled Verification Execution`
- `current_phase`: `M7.3.planning`
- `status`: `milestone_closeout`
- `last_reviewed_pr`: `138`
- `latest_pr`: `null`
- `work_branch`: `null`

Closeout output state after closeout PR merge:

- `current_milestone`: `M8 Controlled Recovery Execution`
- `current_phase`: `M8.planning`
- `status`: `planning_required`
- `active_prompt`: `null`
- `latest_pr`: `null`
- `work_branch`: `null`

The next scheduled run after this report merges should perform `planning_required` for the first bounded M8 phase. It must define a real runtime recovery execution capability, not another verification report or readiness wrapper.
