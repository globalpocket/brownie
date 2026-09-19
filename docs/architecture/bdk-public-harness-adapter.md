# BDK public harness adapter

Brownie BDK should adopt the reusable ideas from public software-agent
harnesses instead of growing every workflow branch as custom shell logic.

The first target is compatibility at the boundary, not a wholesale dependency
swap. Brownie keeps its Runtime, Ledger, Mode Pack policy, release evidence,
and actor separation. The adapter makes Brownie runs look like a public
software-agent harness by emitting typed trajectory events and validating them
with repository guards.

## Public harness concepts used

The adapter is shaped by these public harness patterns:

- OpenHands-style event-sourced agent execution: every important transition is
  a typed event, not only a text log line.
- SWE-agent-style software repair loop: issue/TODO selection, read, patch,
  test, submit, or fail with a bounded reason.
- LangGraph-style explicit state transitions: the workflow state determines
  which branch may run next.
- eval-harness style replay: failures become fixtures that can be tested
  before changing prompts, models, or skills.

Brownie does not treat those systems as authority. Their value is the portable
shape of the harness: trajectory, typed tools, state transitions, verification,
and replayable failures.

## Trajectory contract

Each BDK run should be convertible to JSONL events that follow
`docs/architecture/bdk-trajectory.schema.json`.

Required event families:

- `todo.claimed`
- `workflow.routed`
- `skill.selected`
- `tool.read`
- `tool.write_proposed`
- `tool.write_applied`
- `verification.run`
- `progress.classified`
- `todo.completed`
- `todo.replanned`
- `todo.blocked`

The event stream is the durable unit for analysis. Human-readable logs remain
useful, but workflow decisions should be recoverable from structured events.

## Harness feedback

`scripts/bdk-public-harness-evaluate.mjs` reads Brownie trajectory JSONL and
turns public-harness failures into bounded feedback. The phase-loop stores that
feedback in the private controller state and injects it into the next effective
prompt for the same active claim. This closes the loop:

```text
trajectory -> harness evaluation -> BDK feedback -> next prompt correction
```

The feedback is intentionally private controller state. Public release evidence
should contain only sanitized summaries, not local paths, raw process output, or
private runtime file names.

## State machine

The public-harness-compatible state machine is:

```text
todo.claimed
  -> workflow.routed
  -> skill.selected
  -> tool.read | tool.write_proposed | todo.replanned | todo.blocked
  -> tool.write_applied
  -> verification.run
  -> progress.classified
  -> todo.completed | todo.replanned | todo.blocked
```

Every transition must name the active TODO id and active claim id. A run that
cannot identify both must fail closed before touching the workspace.

## Patch/Create precheck

Before a write proposal, the harness must classify every bounded target:

- `Patch only` requires the target to exist.
- `Create only` requires the target not to exist.
- a generated child TODO must be present both in `.brownie/todo.md` and
  `.brownie/todo-breakdown.md`.

This precheck directly addresses the observed failure where Brownie generated a
leaf that said `Patch only scripts/guard-release-evidence-semantic-consistency.mjs`
even though that file did not exist, and also forgot the matching breakdown
entry.

## Eval fixtures

Every repeated no-progress class should become a small fixture. The first
fixture class for this adapter is:

```json
{
  "failure_class": "todo_leaf_target_mismatch",
  "selected_todo": "Patch only `missing-file.mjs`",
  "expected_recovery": "rewrite leaf to Create only or create the target before claiming Patch only"
}
```

Future fixtures should cover duplicate symbol generation, stale TODO claims,
missing breakdown entries, and read-only discovery loops.

## Adoption boundary

The adapter allows Brownie to consume or compare against public harnesses, but
does not import them as runtime authority. A future integration may map Brownie
events into OpenHands/SWE-agent/LangGraph-compatible datasets. Until then, the
repository guard verifies that Brownie emits enough structure to evaluate and
replay its own failures.
