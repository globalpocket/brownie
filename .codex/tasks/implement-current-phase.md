# Implement Current Brownie Phase

This scheduled task implements the current Brownie phase only when the phase loop state allows it.

## Source of Truth

`.brownie-control/phase-state.json` is the only source of truth for phase loop state. Do not infer state from PRs, branches, commits, comments, or prior chat messages when it conflicts with this file.

## Hard Stop Rules

- Run only when `phase-state.json.status` is exactly `ready_to_implement`.
- If status is anything else, report that no work is needed and stop.
- If the task fails, write the reason to `stop_reason_path`, set status to `blocked`, and stop.
- Never auto-merge a PR.
- Never push directly to `main`.
- Never continue automatically from `blocked`.
- Do not copy code from Zoo Code or ZooCodeCustom.
- Do not add apply / process.exec / network / service control behavior unless the phase prompt explicitly requires it.
- Preserve Brownie's existing safety policy and no-write / no-apply boundaries.

## Procedure

1. Read `.brownie-control/phase-state.json`.
2. Confirm `project` is `brownie` and `status` is `ready_to_implement`.
3. Read the path in `current_phase_prompt_path`.
4. Create or switch to a phase branch named from `current_phase`, using a safe branch name such as `codex/phase-3.4`.
5. Implement only the requested current phase.
6. Keep edits scoped to the phase prompt and existing repository patterns.
7. Run:

```bash
cargo fmt --check
cargo check --workspace
cargo test --workspace
pnpm --filter brownie-vsix check
pnpm --filter brownie-vsix test
pnpm --filter brownie-vsix build
```

8. If a verification command is unavailable because the repository lacks that toolchain/package, record the exact reason in the PR body. Treat real test/check failures as blocking unless the phase prompt explicitly allows otherwise.
9. Commit the implementation on the phase branch.
10. Push the phase branch. Do not push to `main`.
11. Create a PR. Do not merge it.
12. Update `.brownie-control/phase-state.json`:
    - Set `latest_pr` to the created PR number.
    - Set `status` to `awaiting_review`.
13. Leave `current_phase` unchanged until the review task accepts the PR and plans the next phase.

## Failure Handling

On any failure that prevents a valid PR from being opened:

1. Write a clear failure summary to the path in `stop_reason_path`.
2. Update `.brownie-control/phase-state.json` with `status: "blocked"`.
3. Preserve `latest_pr` unless a new PR was successfully created.
4. Stop. Do not retry indefinitely and do not start the review task.
