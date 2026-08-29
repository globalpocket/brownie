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
existing bounded public projections and add a stable top-level automation
contract. Runtime headless execution results include a structured
`execution_outcome`; the CLI validates that runtime-owned outcome, projects it
into the public `automation` object, and omits the raw outcome from bounded
`run` / `resume` projections to keep installed CLI output bounded. Older
runtime results may be projected through the legacy exact-status compatibility
path, marked with `outcome_source = "legacy_cli_projection"`, but the CLI must
not classify outcomes by substring heuristics. That compatibility path is a
bounded migration boundary for older runtime responses; new runtime headless
responses are expected to carry `execution_outcome`.

```json
{
  "ok": true,
  "command": "resume",
  "exit_code": 0,
  "resume": {
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
    "controller_action": "resume",
    "stop_class": "continuation_required",
    "automation": {
      "schema_version": 1,
      "outcome_scope": "objective",
      "status": "continuation_required",
      "class": "continuation_required",
      "outcome_source": "runtime",
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
      "controller_action": "resume",
      "stop_class": "continuation_required",
      "next_invocation": {
        "command": "resume",
        "arguments": []
      }
    }
  },
  "automation": {
    "schema_version": 1,
    "outcome_scope": "objective",
    "status": "continuation_required",
    "class": "continuation_required",
    "outcome_source": "runtime",
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
    "controller_action": "resume",
    "stop_class": "continuation_required",
    "next_invocation": {
      "command": "resume",
      "arguments": []
    }
  }
}
```

External controllers should prefer `automation.controller_action`:

- `resume`: continue the same active objective with `brownie resume`.
- `stop`: stop because the objective completed or no actionable work remains.
- `wait`: wait for external conditions before calling again.
- `retry`: retry the same process-level invocation after retryable transport or
  runtime communication loss.
- `return_to_supervisor`: return control to the supervising system because the
  CLI invocation cannot safely decide the next step.

These are the only valid controller actions. `brownie run "<objective>"` starts
a new objective journey; automation continuation must use `brownie resume` or
the top-level `automation.next_invocation.command == "resume"`. Reissuing
`brownie run` for continuation is a new-objective admission request, not resume.

Stale progress is not terminal failure. Runtime-owned stale progress outcomes
are projected as `status = "stale_retry"`, `controller_action = "resume"`,
`blocked = false`, `terminal_failure = false`, and `retryable = true`, allowing
the next resume invocation to re-evaluate durable runtime state.

When resuming, the runtime exposes a canonical `selected_headless_route` inside
the bounded task progress overview. The CLI validates that selected route and
passes its scope back to the runtime; it must not sort route candidates or make
its own candidate choice.

JSON error envelopes use the same process-level fields. Runtime communication
failure and runtime timeout are retryable process failures. Invalid invocation,
runtime unavailable, runtime error, and invalid runtime response are
non-retryable unless an external supervisor changes configuration or code.
Process-level error automation uses `schema_version = 1`,
`outcome_scope = "process"`, and the finite controller actions above.

A retryable process-level failure from `brownie run "<objective>"` has unknown
objective admission unless the runtime returned task/run/journey identity before
the transport failed. Unknown run admission must not prescribe an unscoped
`brownie resume`, because that can resume an older unrelated journey, and must
not prescribe blind `brownie run` replay, because that can duplicate an objective
that was admitted before response loss. When the CLI generated a bounded run
identity before dispatch, the process-level JSON includes `recovery_identity`
with the `session_id`, `drive_id`, `journey_id`, and objective fingerprint used
for the attempted runtime request. It still uses
`process_admission_state = "unknown"`, leaves `task_id`, `run_id`, and
`next_invocation` null, and sets
`recovery_recommendation = "supervisor_reconcile_or_probe_runtime_state"` until
runtime-owned evidence can prove `persisted`, `not_persisted`, or `unknown`.

A retryable process-level failure from `brownie resume` may expose
`next_invocation.command = "resume"` because the process-level invocation is
already a continuation attempt and does not admit a new objective. Successful
runtime-owned objective outcomes continue to use `controller_action = "resume"`
and `next_invocation.command = "resume"` when bounded progress should continue.

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
