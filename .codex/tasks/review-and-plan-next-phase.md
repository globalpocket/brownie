# Review Current Brownie Phase And Plan Next Phase

This scheduled task reviews the latest phase PR and writes the next phase prompt only when the phase loop state allows it.

## Source of Truth

`.brownie-control/phase-state.json` is the only source of truth for phase loop state. Do not infer state from PRs, branches, commits, comments, or prior chat messages when it conflicts with this file.

## Hard Stop Rules

- Run only when `phase-state.json.status` is exactly `awaiting_review`.
- If status is anything else, report that no review is needed and stop.
- If `latest_pr` is missing, write the reason to `stop_reason_path`, set status to `blocked`, and stop.
- Never auto-merge a PR.
- Never push directly to `main`.
- Never continue automatically from `blocked`.
- Do not copy code from Zoo Code or ZooCodeCustom.
- Do not add apply / process.exec / network / service control behavior unless the reviewed phase prompt explicitly requires it.
- Preserve Brownie's existing safety policy and no-write / no-apply boundaries.

## Procedure

1. Read `.brownie-control/phase-state.json`.
2. Confirm `project` is `brownie` and `status` is `awaiting_review`.
3. Read `latest_pr`.
4. Fetch PR metadata, changed files, diff, check results, and relevant discussion for `latest_pr`.
5. Read the path in `current_phase_prompt_path`.
6. Review the PR against the current phase prompt and Brownie safety constraints.
7. Check at least:
   - Phase instruction fit.
   - Unauthorized feature additions.
   - no-write / no-apply safety boundary preservation.
   - raw content / raw input / absolute path / canonical path exposure.
   - Protocol / runtime / VSIX type alignment.
   - Ledger sanitizer updates where applicable.
   - Tests added or updated.
   - Docs/spec updates where applicable.
   - Rust and VSIX verification status.
8. Write the review result to the path in `latest_review_path` using the exact format below.
9. If accepted, write a complete next phase implementation prompt to the path in `next_phase_prompt_path`.
10. If accepted, copy the generated next phase prompt into `current_phase_prompt_path`.
11. If accepted, update `.brownie-control/phase-state.json`:
    - Set `last_reviewed_pr` to `latest_pr`.
    - Set `latest_pr` to `null`.
    - Advance `current_phase` only to the next justified phase.
    - Set `status` to `ready_to_implement`.
12. If blocked, write the reason to `stop_reason_path`, set status to `blocked`, and stop.

## Review Output Format

Write `.brownie-control/latest-review.md` exactly in this structure:

```text
# Review Result

Verdict:
- Accepted / Accepted with follow-up / Blocked

Reviewed PR:
- PR number:
- Title:
- Merge commit:

What changed:
- ...

Positive findings:
- ...

Concerns:
- ...

Scores:
- Phase fit:
- Safety:
- Protocol alignment:
- Tests:
- Docs:
- Next phase readiness:

Next action:
- Continue to next phase / Create fix phase / Stop
```

## Next Phase Decision Rules

Do not skip phases. The expected sequence is:

- `3.4` = Apply readiness report / user-visible final pre-apply review
- `3.5` = Apply capability design without execution
- `3.6` = Operator-controlled apply dry-run mode
- `3.7` = Minimal controlled apply, still no git commit
- `3.8` = Post-apply inspection and rollback metadata

If the review finds a serious defect, do not advance to the next normal phase. Instead, create a fix phase such as `3.4.1` or `3.5.1`, write a complete fix-phase prompt, update `current_phase` to that fix phase, and set status to `ready_to_implement`.

## Failure Handling

On any failure that prevents a reliable review:

1. Write a clear failure summary to the path in `stop_reason_path`.
2. Update `.brownie-control/phase-state.json` with `status: "blocked"`.
3. Leave `current_phase` unchanged.
4. Stop. Do not retry indefinitely and do not start implementation.
