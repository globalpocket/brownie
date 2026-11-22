import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const source = readFileSync(new URL("../phase-loop.sh", import.meta.url), "utf8");

function shellFunction(name) {
  const matches = [...source.matchAll(new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?^\\}`, "gm"))];
  assert.equal(matches.length, 1, name);
  return matches[0][0];
}

function runSupervisor(t, retryCap, runtimeBody) {
  const cwd = mkdtempSync(join(tmpdir(), "brownie-supervisor-failure-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const result = spawnSync("bash", ["-s", "--", String(retryCap)], {
    cwd,
    encoding: "utf8",
    timeout: 10_000,
    input: `
set -u
SUPERVISOR_LOG=supervisor.log
STOP_FILE=unused-stop
PID_FILE=pid
PHASE_LOOP_DEFERRED_SIGNAL_FILE=deferred
PHASE_LOOP_TERMINAL_FAILURE_RETRY_CAP="$1"
PHASE_LOOP_FAILURE_BACKOFF_SECONDS=2
PHASE_LOOP_MAX_FAILURE_BACKOFF_SECONDS=4
load_env() { :; }
acquire_lock() { :; }
write_supervisor_owner() { :; }
write_status() { printf '%s|%s|%s\\n' "$1" "$2" "$4" >> status.log; }
now_utc() { printf '%s' fixture; }
phase_loop_watch_continuation_liveness() { :; }
stop_if_todo_empty() { :; }
phase_loop_require_operational_configuration() { :; }
validate_runtime_authorization_rebaseline_cap() { :; }
phase_loop_reconcile_pending_review() { return 1; }
active_todo_claim_exists() { return 1; }
interruptible_sleep() {
  printf 'sleep=%s\\n' "$1"
  if [ "$CONSECUTIVE_FAILURES" -eq 3 ]; then exit 0; fi
}
_run_brownie_once() { ${runtimeBody}; }
${shellFunction("validate_terminal_failure_retry_cap")}
${shellFunction("run_brownie_once")}
${shellFunction("supervise")}
supervise
`,
  });
  assert.ifError(result.error);
  return {
    ...result,
    log: readFileSync(join(cwd, "supervisor.log"), "utf8"),
    state: readFileSync(join(cwd, "status.log"), "utf8"),
  };
}

test("negative retry cap stops the supervisor before a runtime attempt or backoff", (t) => {
  const result = runSupervisor(t, -1, "exit 91");
  assert.equal(result.status, 78);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /expected a finite non-negative integer/);
  assert.match(result.state, /^blocked\|invalid_terminal_failure_retry_cap\|78$/m);
  assert.equal(result.log.match(/reason=invalid_terminal_failure_retry_cap/g)?.length, 1);
  assert.doesNotMatch(result.log, /backoff=/);
});

test("retryable run failure retains capped backoff", (t) => {
  const result = runSupervisor(t, 1, "printf 'attempt\\n'; return 1");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "attempt\nsleep=2\nattempt\nsleep=4\nattempt\nsleep=4\n");
  assert.doesNotMatch(result.log, /permanent_failure/);
});
