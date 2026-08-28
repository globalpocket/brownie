# CLI External Loop Spec v0

Brownie CLI is an invocation primitive for external controllers. Brownie does
not own a scheduler, daemon, permanent loop, sleep cycle, cron registration,
launchd/systemd timer, or self-spawning recursive process. An external
controller may invoke `brownie run "<objective>"` or `brownie resume`, wait as
it chooses, and invoke Brownie again.

Each CLI invocation reads durable runtime state, asks the Rust runtime for one
bounded unit of progress, lets the runtime persist checkpoints, ledger entries,
task state, and journey state, then exits. The next invocation must recover from
runtime durable state rather than process memory.

`brownie run "<objective>"` starts a new runtime-owned objective journey. The
runtime owns journey admission, task/run identity, idempotency, replay safety,
and completion/finalization. Repeated intentional `run` invocations may create
independent objectives; external loops that intend to continue an active
objective should call `brownie resume` after the initial admission.

`brownie resume` selects an eligible CLI-created headless execution from durable
runtime evidence and performs bounded progress. It must not rely on the previous
CLI process, conversation context, or in-memory state. If the runtime exposes a
scoped headless route candidate, the CLI passes that scope back to the runtime
instead of broadening selection by goal text, timestamps, id similarity, or
workspace alone.

## Responsibility Boundary

Brownie owns task/run/journey durable state, agent-loop behavior, resume and
continuation decisions, mode selection, Mode Pack interpretation, LLM calls,
workspace operations, tool execution, verification, checkpointing, completion,
failure and blocked states, replay and stale-request protection, runtime-level
concurrency safety, and bounded machine-readable execution results.

The external controller owns only when to invoke Brownie, how often to invoke
it, how long to wait, which scheduler or parent process mechanism is used,
external review, and whether to submit a new objective. Brownie must not assume
the controller is a shell loop, cron job, launchd timer, systemd timer, Codex
automation, CI/CD runner, or parent process.

## Safety Contract

Brownie must not implement `while true`, sleeps, scheduler registration,
launchd/systemd/cron setup, self-spawning timers, or recursive process loops.

Concurrent invocations are expected to be possible because the external
controller is outside Brownie. Duplicate mutation prevention, stale request
rejection, checkpoint replay, scoped resume, and active journey completion
remain runtime-owned. The CLI may carry runtime-provided scope identifiers
between bounded runtime calls in the same process, but it must not introduce a
shell-lock-only source of truth or duplicate runtime policy.

If the CLI process exits during LLM work, tool execution, patch application,
verification, completion handling, runtime transport timeout, process kill, or
machine reboot, the next invocation must resume from durable runtime state. The
JSON result should classify the process outcome without treating transport loss
as objective failure by itself.

## JSON Automation Contract

`brownie --json run "<objective>"` and `brownie --json resume` preserve their
existing bounded public projections and add a stable automation contract:

```json
{
  "status": "task_executed",
  "task_id": "task_...",
  "run_id": "run_...",
  "journey_id": "cli.run....journey",
  "next_action": "inspect_progress_overview",
  "stop_reason": "budget_exhausted",
  "continuation_required": true,
  "completed": false,
  "blocked": false,
  "retryable": true,
  "terminal_failure": false,
  "controller_action": "invoke_again",
  "stop_class": "continuation_required",
  "automation": {
    "status": "task_executed",
    "task_id": "task_...",
    "run_id": "run_...",
    "journey_id": "cli.run....journey",
    "next_action": "inspect_progress_overview",
    "stop_reason": "budget_exhausted",
    "continuation_required": true,
    "completed": false,
    "blocked": false,
    "retryable": true,
    "terminal_failure": false,
    "controller_action": "invoke_again",
    "stop_class": "continuation_required"
  }
}
```

External controllers should prefer `automation.controller_action`:

- `invoke_again`: call Brownie again when the controller is ready.
- `stop`: stop because the objective completed or no actionable work remains.
- `wait`: wait for external conditions before calling again.
- `return_to_human`: return control to a human or supervising system.

JSON error envelopes use the same process-level fields. Runtime communication
failure and runtime timeout are retryable process failures. Invalid invocation,
runtime unavailable, runtime error, and invalid runtime response are
non-retryable unless an external supervisor changes configuration or code.

## Exit Code Contract

Exit code `0` means the CLI invocation succeeded at the process level. The JSON
automation fields classify whether progress completed, should continue, should
wait, or found no actionable work.

Exit code `64` means invalid invocation or configuration.

Exit code `69` means the runtime is unavailable or the requested command is not
implemented by this CLI surface.

Exit code `70` means runtime communication, timeout, invalid response, or
runtime error. In JSON mode, `retryable=true` distinguishes transport timeout or
communication failure from non-retryable invalid runtime responses or runtime
errors.
