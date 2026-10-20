#!/usr/bin/env bash
set -eu

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PHASE_LOOP="$REPO_ROOT/phase-loop.sh"
# Claim smoke runs against temporary worker workspaces while the controller
# source remains this checkout.  Pin the fixture baseline to the checked-out
# controller so the smoke suite exercises controller behavior without
# pretending that a PR branch already matches origin/main.
export PHASE_LOOP_APPROVED_CONTROLLER_BASELINE="HEAD"
PHASE_LOOP_CLAIM_SMOKE_TIMEOUT_SECONDS="${PHASE_LOOP_CLAIM_SMOKE_TIMEOUT_SECONDS:-360}"
PHASE_LOOP_CLAIM_SMOKE_SECTION="${PHASE_LOOP_CLAIM_SMOKE_SECTION:-all}"

phase_loop_smoke_cpu_count() {
  local detected=""
  if command -v getconf >/dev/null 2>&1; then
    detected="$(getconf _NPROCESSORS_ONLN 2>/dev/null || true)"
  fi
  case "$detected" in
    ''|*[!0-9]*) detected="" ;;
  esac
  if [ -z "$detected" ] && command -v sysctl >/dev/null 2>&1; then
    detected="$(sysctl -n hw.ncpu 2>/dev/null || true)"
  fi
  case "$detected" in
    ''|*[!0-9]*) detected=2 ;;
  esac
  if [ "$detected" -lt 1 ]; then
    detected=2
  fi
  printf '%s\n' "$detected"
}

# The sections are CPU-heavy.  Default to online CPUs minus four, with a floor
# of two and a cap of six, so an 8-shard run keeps two CPU slots of headroom on
# a normal worker while a 2-core worker never launches all eight at once.  The
# batch size remains configurable for CI hosts with known capacity.
if [ -n "${PHASE_LOOP_CLAIM_SMOKE_BATCH_SIZE:-}" ]; then
  case "$PHASE_LOOP_CLAIM_SMOKE_BATCH_SIZE" in
    ''|*[!0-9]*) echo "PHASE_LOOP_CLAIM_SMOKE_BATCH_SIZE must be a positive integer" >&2; exit 2 ;;
  esac
  if [ "$PHASE_LOOP_CLAIM_SMOKE_BATCH_SIZE" -lt 1 ]; then
    echo "PHASE_LOOP_CLAIM_SMOKE_BATCH_SIZE must be a positive integer" >&2
    exit 2
  fi
else
  phase_loop_smoke_cpu_count_value="$(phase_loop_smoke_cpu_count)"
  PHASE_LOOP_CLAIM_SMOKE_BATCH_SIZE=$((phase_loop_smoke_cpu_count_value - 4))
  if [ "$phase_loop_smoke_cpu_count_value" -eq 1 ]; then
    PHASE_LOOP_CLAIM_SMOKE_BATCH_SIZE=1
  elif [ "$PHASE_LOOP_CLAIM_SMOKE_BATCH_SIZE" -lt 2 ]; then
    PHASE_LOOP_CLAIM_SMOKE_BATCH_SIZE=2
  elif [ "$PHASE_LOOP_CLAIM_SMOKE_BATCH_SIZE" -gt 6 ]; then
    PHASE_LOOP_CLAIM_SMOKE_BATCH_SIZE=6
  fi
fi

# Preserve the historical 45-second bound when the suite is intentionally
# configured for the old eight-way fan-out.  Otherwise give each child a
# bounded amount of headroom proportional to the reduced parallelism; this
# is still below the suite watchdog and avoids false timeout failures caused
# by CPU contention rather than a hung controller.
if [ -z "${PHASE_LOOP_COMMAND_TIMEOUT_SECONDS:-}" ]; then
  case "$PHASE_LOOP_CLAIM_SMOKE_BATCH_SIZE" in
    1) PHASE_LOOP_COMMAND_TIMEOUT_SECONDS=90 ;;
    2) PHASE_LOOP_COMMAND_TIMEOUT_SECONDS=90 ;;
    3|4|5|6) PHASE_LOOP_COMMAND_TIMEOUT_SECONDS=60 ;;
    *) PHASE_LOOP_COMMAND_TIMEOUT_SECONDS=45 ;;
  esac
else
  PHASE_LOOP_COMMAND_TIMEOUT_SECONDS="$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS"
fi
export PHASE_LOOP_CLAIM_SMOKE_BATCH_SIZE PHASE_LOOP_COMMAND_TIMEOUT_SECONDS
if [ "$PHASE_LOOP_CLAIM_SMOKE_SECTION" = "all" ]; then
  printf 'phase-loop claim smoke scheduler: cpus=%s batch_size=%s command_timeout=%ss watchdog=%ss\n' \
    "$(phase_loop_smoke_cpu_count)" "$PHASE_LOOP_CLAIM_SMOKE_BATCH_SIZE" \
    "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP_CLAIM_SMOKE_TIMEOUT_SECONDS" >&2
fi

claim_smoke_section_enabled() {
  [ "$PHASE_LOOP_CLAIM_SMOKE_SECTION" = "all" ] || [ "$PHASE_LOOP_CLAIM_SMOKE_SECTION" = "$1" ]
}

case "$PHASE_LOOP_CLAIM_SMOKE_SECTION" in
  all|core|terminal|completion|terminal-absent|queue|pr|lifecycle|guards|feedback) ;;
  *)
    echo "unknown phase-loop claim smoke section: $PHASE_LOOP_CLAIM_SMOKE_SECTION" >&2
    exit 2
    ;;
esac

(
  sleep "$PHASE_LOOP_CLAIM_SMOKE_TIMEOUT_SECONDS"
  echo "phase-loop claim smoke timed out after ${PHASE_LOOP_CLAIM_SMOKE_TIMEOUT_SECONDS}s" >&2
  kill -TERM "$$" 2>/dev/null || true
) &
claim_smoke_watchdog_pid="$!"
claim_smoke_shard_dir=""
cleanup_claim_smoke() {
  kill "$claim_smoke_watchdog_pid" 2>/dev/null || true
  wait "$claim_smoke_watchdog_pid" 2>/dev/null || true
  if [ -n "$claim_smoke_shard_dir" ] && [ -d "$claim_smoke_shard_dir" ]; then
    rm -rf -- "$claim_smoke_shard_dir"
  fi
}
trap cleanup_claim_smoke EXIT

# The suite contains independent temporary-workspace fixtures. Run those
# sections in parallel so adding another bounded fixture does not turn the
# single serial smoke process into a CI watchdog timeout. Each child gets its
# own controller store and suite watchdog; a failed child still fails the
# aggregate command with its diagnostics.
if [ "$PHASE_LOOP_CLAIM_SMOKE_SECTION" = "all" ]; then
  claim_smoke_shard_dir="$(mktemp -d)"
  # The lifecycle shard owns process-group signal fixtures; keep it out of
  # the other CPU-heavy batches so its bounded child cleanup remains stable.
  claim_smoke_shards=(core terminal completion terminal-absent queue pr guards feedback lifecycle)
  claim_smoke_failed=0
  claim_smoke_batch_size="$PHASE_LOOP_CLAIM_SMOKE_BATCH_SIZE"
  claim_smoke_batch_start=0
  while [ "$claim_smoke_batch_start" -lt "${#claim_smoke_shards[@]}" ]; do
    claim_smoke_pids=()
    claim_smoke_batch_end=$((claim_smoke_batch_start + claim_smoke_batch_size))
    if [ "$claim_smoke_batch_end" -gt "${#claim_smoke_shards[@]}" ]; then
      claim_smoke_batch_end="${#claim_smoke_shards[@]}"
    fi
    for ((claim_smoke_index = claim_smoke_batch_start; claim_smoke_index < claim_smoke_batch_end; claim_smoke_index += 1)); do
      claim_smoke_shard="${claim_smoke_shards[$claim_smoke_index]}"
      claim_smoke_control_root="$claim_smoke_shard_dir/$claim_smoke_shard-control-root"
      mkdir -p "$claim_smoke_control_root"
      PHASE_LOOP_CLAIM_SMOKE_SECTION="$claim_smoke_shard" \
      PHASE_LOOP_CONTROL_ROOT="$claim_smoke_control_root" \
      "$BASH" "$0" >"$claim_smoke_shard_dir/$claim_smoke_shard.stdout.log" 2>"$claim_smoke_shard_dir/$claim_smoke_shard.stderr.log" &
      claim_smoke_pids+=("$!")
    done
    for ((claim_smoke_index = claim_smoke_batch_start; claim_smoke_index < claim_smoke_batch_end; claim_smoke_index += 1)); do
      claim_smoke_shard="${claim_smoke_shards[$claim_smoke_index]}"
      if ! wait "${claim_smoke_pids[$claim_smoke_index - claim_smoke_batch_start]}"; then
        claim_smoke_failed=1
        echo "phase-loop claim smoke shard failed: $claim_smoke_shard" >&2
        cat "$claim_smoke_shard_dir/$claim_smoke_shard.stdout.log" >&2
        cat "$claim_smoke_shard_dir/$claim_smoke_shard.stderr.log" >&2
      fi
    done
    if [ "$claim_smoke_failed" -ne 0 ]; then
      break
    fi
    claim_smoke_batch_start="$claim_smoke_batch_end"
  done
  if [ "$claim_smoke_failed" -ne 0 ]; then
    exit 1
  fi
  exit 0
fi

if ! command -v rg >/dev/null 2>&1; then
  fallback_bin_dir="$(mktemp -d)"
  cat > "$fallback_bin_dir/rg" <<'SH'
#!/usr/bin/env bash
set -eu
quiet=0
if [ "${1:-}" = "-q" ]; then
  quiet=1
  shift
fi
if [ "${1:-}" = "--" ]; then
  shift
fi
pattern="${1:?missing pattern}"
shift
if [ "$quiet" = "1" ]; then
  grep -E -q -- "$pattern" "$@"
else
  grep -E -- "$pattern" "$@"
fi
SH
  chmod +x "$fallback_bin_dir/rg"
  PATH="$fallback_bin_dir:$PATH"
  export PATH
fi

assert_contains() {
  local file="$1"
  local pattern="$2"
  if ! rg -q -- "$pattern" "$file"; then
    echo "expected $file to contain pattern: $pattern" >&2
    exit 1
  fi
}

assert_not_contains() {
  local file="$1"
  local pattern="$2"
  if rg -q -- "$pattern" "$file"; then
    echo "expected $file not to contain pattern: $pattern" >&2
    exit 1
  fi
}

assert_terminal_failure_claim_archived() {
  local claim_dir="$1"
  local blocked_path="$2"
  local ledger_path="$3"
  local selected_prefix="$4"
  local expected_archive_count="$5"
  python3 - "$claim_dir" "$blocked_path" "$ledger_path" "$selected_prefix" "$expected_archive_count" <<'PY'
import json
import pathlib
import sys

claim_dir = pathlib.Path(sys.argv[1])
blocked_path = pathlib.Path(sys.argv[2])
ledger_path = pathlib.Path(sys.argv[3])
selected_prefix = sys.argv[4]
expected_archive_count = int(sys.argv[5])
current_path = claim_dir / "current.json"
assert not current_path.exists(), current_path
archives = sorted(claim_dir.glob("stale-*.json"))
assert len(archives) == expected_archive_count, archives
archived = [json.loads(path.read_text(encoding="utf-8")) for path in archives]
matching = [claim for claim in archived if selected_prefix in str(claim.get("selected_todo", ""))]
assert len(matching) == expected_archive_count, matching
assert all(claim.get("status") == "failed" for claim in matching), matching
assert all(claim.get("archive_reason") == "terminal_failure_retry" for claim in matching), matching
claim_ids = {str(claim.get("claim_id") or "") for claim in matching}
assert all(claim_ids), matching
blocked = [
    json.loads(line)
    for line in blocked_path.read_text(encoding="utf-8").splitlines()
    if line.strip()
]
assert any(
    record.get("terminal_failure") is True
    and record.get("claim_id") in claim_ids
    and selected_prefix in str(record.get("selected_todo", ""))
    for record in blocked
), blocked
ledger_records = [
    json.loads(line)
    for line in ledger_path.read_text(encoding="utf-8").splitlines()
    if line.strip()
]
terminal_events = []
for record in ledger_records:
    if record.get("kind") == "terminal_failure_transaction":
        terminal_events.extend(record.get("events", []))
assert all(
    any(
        event.get("claim_id") == claim_id
        and selected_prefix in str(event.get("selected_todo", ""))
        and "@" in str(event.get("task_id", ""))
        for event in terminal_events
    )
    for claim_id in claim_ids
), (claim_ids, terminal_events)
PY
}

run_with_timeout() {
  local seconds="$1"
  shift
  local expected_exit_codes=0
  if [ "${1:-}" = "--expected-exit" ]; then
    expected_exit_codes="$2"
    shift 2
  fi
  "$@" &
  local child_pid="$!"
  local elapsed=0
  local timed_out=0
  while kill -0 "$child_pid" 2>/dev/null; do
    if [ "$elapsed" -ge "$seconds" ]; then
      echo "command timed out after ${seconds}s: $*" >&2
      kill "$child_pid" 2>/dev/null || true
      sleep 1
      kill -KILL "$child_pid" 2>/dev/null || true
      wait "$child_pid" 2>/dev/null || true
      timed_out=1
      break
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  local child_status=0
  if [ "$timed_out" -eq 1 ]; then
    child_status=124
  elif wait "$child_pid"; then
    child_status=0
  else
    child_status="$?"
  fi
  if [ "$child_status" -ne 0 ]; then
    case ",$expected_exit_codes," in
      *,"$child_status",*) ;;
      *)
    echo "phase-loop claim smoke command failed exit=$child_status: $*" >&2
    if [ -n "${PHASE_LOOP_STATE_DIR:-}" ]; then
      for diagnostic_file in status.json progress-state.json; do
        if [ -f "$PHASE_LOOP_STATE_DIR/$diagnostic_file" ]; then
          echo "--- $PHASE_LOOP_STATE_DIR/$diagnostic_file ---" >&2
          cat "$PHASE_LOOP_STATE_DIR/$diagnostic_file" >&2
        fi
      done
      latest_stdout="$(find "$PHASE_LOOP_STATE_DIR/runs" -name '*.stdout.log' -type f -print 2>/dev/null | LC_ALL=C sort | tail -n 1)"
      latest_stderr="$(find "$PHASE_LOOP_STATE_DIR/runs" -name '*.stderr.log' -type f -print 2>/dev/null | LC_ALL=C sort | tail -n 1)"
      for diagnostic_file in "$latest_stdout" "$latest_stderr"; do
        if [ -n "$diagnostic_file" ] && [ -f "$diagnostic_file" ]; then
          echo "--- $diagnostic_file (tail) ---" >&2
          tail -n 80 "$diagnostic_file" >&2
        fi
      done
      if [ -f "$PHASE_LOOP_STATE_DIR/logs/supervisor.log" ]; then
        echo "--- $PHASE_LOOP_STATE_DIR/logs/supervisor.log (tail) ---" >&2
        tail -n 80 "$PHASE_LOOP_STATE_DIR/logs/supervisor.log" >&2
      fi
    fi
      ;;
    esac
  fi
  return "$child_status"
}

wait_for_pid_exit() {
  local pid="$1"
  local seconds="$2"
  local elapsed=0
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$elapsed" -ge "$seconds" ]; then
      echo "expected pid=$pid to exit within ${seconds}s" >&2
      kill "$pid" 2>/dev/null || true
      sleep 1
      kill -KILL "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
      return 1
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  wait "$pid" 2>/dev/null || true
}

assert_contains "$PHASE_LOOP" "phase-loop-todo-queue-integrity\\.mjs"
assert_contains "$PHASE_LOOP" 'local guard_script="\$ROOT_DIR/scripts/phase-loop-source-baseline-guard\.mjs"'
assert_contains "$PHASE_LOOP" 'node "\$guard_script" --repo "\$ROOT_DIR" --baseline-ref "\$PHASE_LOOP_APPROVED_CONTROLLER_BASELINE"'
assert_contains "$PHASE_LOOP" 'phase-loop-task-ledger\.mjs" record-trajectory --repo "\$PHASE_LOOP_WORKSPACE_ROOT"'
assert_contains "$PHASE_LOOP" "phase-loop-run-state\.mjs"
assert_contains "$PHASE_LOOP" "\.brownie/headless-\*"
assert_contains "$PHASE_LOOP" 'controller-fingerprint "\$controller_fingerprint"'
assert_contains "$PHASE_LOOP" "Zero means the first terminal failure is stable/blocked"
assert_contains "$PHASE_LOOP" "refusing to leave status running"
assert_not_contains "$PHASE_LOOP" 'phase-loop-task-ledger\.mjs" record-trajectory --repo "\$ROOT_DIR"'
assert_not_contains "$PHASE_LOOP" 'phase-loop-task-ledger\.mjs" record-trajectory --repo "\$PHASE_LOOP_STATE_DIR"'
assert_not_contains "$PHASE_LOOP" 'phase-loop-task-ledger\.mjs" record-trajectory --repo "\$STATE_DIR"'
assert_contains "$PHASE_LOOP" 'path == ".brownie/private" or path.startswith\(".brownie/private/"\)'
assert_contains "$PHASE_LOOP" 'and path not in controller_private_paths'
assert_contains "$PHASE_LOOP" "todo_queue_integrity_failed_before_claim"
assert_contains "$PHASE_LOOP" "PHASE_LOOP_TODO_QUEUE_INTEGRITY_FAILED"
assert_contains "$PHASE_LOOP" "baseline_diff_files"
assert_contains "$PHASE_LOOP" "baseline_todo_text"
assert_contains "$PHASE_LOOP" 'claim\["baseline_todo_text"\] = todo_text'
assert_contains "$PHASE_LOOP" 'claim\["baseline_diff_files"\] = baseline_diff_files'
assert_contains "$PHASE_LOOP" "baseline_diff_matches_live_workspace"
assert_contains "$PHASE_LOOP" 'refreshed_selected_todo_from_live_queue'
assert_contains "$PHASE_LOOP" "objective_apply_stalled"
assert_contains "$PHASE_LOOP" "TODO queue repair is a mutually-exclusive controller state"
assert_contains "$PHASE_LOOP" "leaf_execution_policy_lines = \\[\\]"
assert_contains "$PHASE_LOOP" "todo_contract_repair_before_bounded_leaf"
assert_contains "$PHASE_LOOP" "must_preserve_todo_guard_priority"
assert_contains "$PHASE_LOOP" "selected_todo_dirty_baseline_verified_completion"
assert_contains "$PHASE_LOOP" "selected_targets_already_dirty_and_verification_passed"
assert_contains "$PHASE_LOOP" "pruned_completed_dependency_lines"
assert_not_contains "$PHASE_LOOP" "breakdown_only_dependency_pruned"
assert_contains "$PHASE_LOOP" "phase_loop_claim_id"
assert_contains "$PHASE_LOOP" "phase_loop_selected_todo_first_line"
assert_contains "$PHASE_LOOP" "feedback_identity_missing"
assert_contains "$PHASE_LOOP" "progress_projection_claim_id_mismatch"
assert_contains "${BASH_SOURCE[0]}" "timed_out=1"
assert_contains "$PHASE_LOOP" "Every generated leaf ID must be unique within new_text"
assert_contains "$PHASE_LOOP" "A leaf must never depend on itself"
assert_contains "$PHASE_LOOP" "distinct prerequisite TODO ID already present in the live queue"
assert_contains "$PHASE_LOOP" 'never generate a read-only `Read`, `Inspect`, or `Extract` leaf'
assert_contains "$PHASE_LOOP" "phase-loop-pr-actor-guard.mjs"
assert_contains "${BASH_SOURCE[0]}" "phase_loop_smoke_cpu_count"
assert_contains "${BASH_SOURCE[0]}" "PHASE_LOOP_CLAIM_SMOKE_BATCH_SIZE"
assert_contains "${BASH_SOURCE[0]}" 'claim_smoke_batch_size="\$PHASE_LOOP_CLAIM_SMOKE_BATCH_SIZE"'

claim_smoke_private_state_sha256() {
  local state_root="$REPO_ROOT/.brownie/private/phase-loop"
  if [ ! -d "$state_root" ]; then
    printf '%s\n' absent
    return 0
  fi
  find "$state_root" -type f -print0 | LC_ALL=C sort -z | xargs -0 shasum | shasum | awk '{print $1}'
}

# Every scenario below must confine queue mutations to its own TODO/breakdown
# paths.  A smoke fixture must never mutate the repository queue that CI later
# validates, even when the scenario exits through a replan or repair path.
CLAIM_SMOKE_REPO_TODO_SHA256="$(shasum "$REPO_ROOT/.brownie/todo.md" | awk '{print $1}')"
CLAIM_SMOKE_REPO_BREAKDOWN_SHA256="$(shasum "$REPO_ROOT/.brownie/todo-breakdown.md" | awk '{print $1}')"
CLAIM_SMOKE_REPO_PRIVATE_STATE_SHA256="$(claim_smoke_private_state_sha256)"
# Test invocations always use temporary queue/state paths; their durable
# controller store must be isolated as well.  Otherwise phase-loop's default
# store rooted at this repository can leave replan records that alter later
# repository guards despite an unchanged fixture TODO.
CLAIM_SMOKE_BROWNIE_STORE_ROOT="$(mktemp -d)"
export PHASE_LOOP_BROWNIE_STORE_ROOT="$CLAIM_SMOKE_BROWNIE_STORE_ROOT"

assert_repository_state_unchanged() {
  local current_todo_sha256
  local current_breakdown_sha256
  current_todo_sha256="$(shasum "$REPO_ROOT/.brownie/todo.md" | awk '{print $1}')"
  current_breakdown_sha256="$(shasum "$REPO_ROOT/.brownie/todo-breakdown.md" | awk '{print $1}')"
  local current_private_state_sha256
  current_private_state_sha256="$(claim_smoke_private_state_sha256)"
  if [ "$current_todo_sha256" != "$CLAIM_SMOKE_REPO_TODO_SHA256" ] || [ "$current_breakdown_sha256" != "$CLAIM_SMOKE_REPO_BREAKDOWN_SHA256" ] || [ "$current_private_state_sha256" != "$CLAIM_SMOKE_REPO_PRIVATE_STATE_SHA256" ]; then
    echo "phase-loop claim smoke leaked temporary controller state into the repository: todo=${PHASE_LOOP_TODO:-<default>} breakdown=${PHASE_LOOP_TODO_BREAKDOWN:-<default>} workspace=${PHASE_LOOP_WORKSPACE_ROOT:-<default>} state=${PHASE_LOOP_STATE_DIR:-<default>}" >&2
    return 97
  fi
}

claim_smoke_private_state_sha256() {
  local state_root="$REPO_ROOT/.brownie/private/phase-loop"
  if [ ! -d "$state_root" ]; then
    printf '%s\n' absent
    return 0
  fi
  find "$state_root" -type f -print0 | LC_ALL=C sort -z | xargs -0 shasum | shasum | awk '{print $1}'
}

# Every scenario below must confine queue mutations to its own TODO/breakdown
# paths.  A smoke fixture must never mutate the repository queue that CI later
# validates, even when the scenario exits through a replan or repair path.
CLAIM_SMOKE_REPO_TODO_SHA256="$(shasum "$REPO_ROOT/.brownie/todo.md" | awk '{print $1}')"
CLAIM_SMOKE_REPO_BREAKDOWN_SHA256="$(shasum "$REPO_ROOT/.brownie/todo-breakdown.md" | awk '{print $1}')"
CLAIM_SMOKE_REPO_PRIVATE_STATE_SHA256="$(claim_smoke_private_state_sha256)"
# Test invocations always use temporary queue/state paths; their durable
# controller store must be isolated as well.  Otherwise phase-loop's default
# store rooted at this repository can leave replan records that alter later
# repository guards despite an unchanged fixture TODO.
CLAIM_SMOKE_BROWNIE_STORE_ROOT="$(mktemp -d)"
export PHASE_LOOP_BROWNIE_STORE_ROOT="$CLAIM_SMOKE_BROWNIE_STORE_ROOT"

test_workspace="$(mktemp -d)"
git -C "$test_workspace" init -b main >/dev/null
git -C "$test_workspace" -c user.name=Brownie -c user.email=brownie@example.invalid commit --allow-empty -m init >/dev/null
fake_brownie_json="$(mktemp)"
cat > "$fake_brownie_json" <<'SH'
#!/usr/bin/env bash
set -eu
if [ "${1:-}" != "--json" ]; then
  echo "unexpected fake brownie invocation: $*" >&2
  exit 64
fi
case "${2:-}" in
  run)
    if [ "${3:-}" != "--file" ] || [ -z "${4:-}" ]; then
      echo "unexpected fake brownie run invocation: $*" >&2
      exit 64
    fi
    ;;
  resume)
    ;;
  *)
    echo "unexpected fake brownie command: $*" >&2
    exit 64
    ;;
esac
cat <<'JSON'
{
  "command": "run",
  "ok": true,
  "run": {
    "automation": {
      "schema_version": 1,
      "status": "continuation_required",
      "controller_action": "resume",
      "stop_class": "continuation_required",
      "stop_reason": "bounded_progress",
      "completed": false,
      "blocked": false,
      "retryable": true,
      "terminal_failure": false,
      "task_id": "task-smoke",
      "run_id": "run-smoke",
      "journey_id": "journey-smoke",
      "next_action": "inspect_progress_overview",
      "next_invocation": {"command": "resume", "arguments": []}
    },
    "status": "task_executed",
    "session_id": "session-smoke",
    "drive_id": "drive-smoke",
    "task_id": "task-smoke",
    "run_id": "run-smoke",
    "journey_id": "journey-smoke",
    "completion_closure_status": "budget_exhausted",
    "next_action": "inspect_progress_overview",
    "completed": false,
    "blocked": false,
    "retryable": true,
    "terminal_failure": false,
    "controller_action": "resume",
    "stop_class": "continuation_required",
    "stop_reason": "bounded_progress",
    "next_invocation": {"command": "resume", "arguments": []}
  }
}
JSON
SH
chmod +x "$fake_brownie_json"
fake_brownie_legacy_json="$(mktemp)"
cat > "$fake_brownie_legacy_json" <<'SH'
#!/usr/bin/env bash
set -eu
cat <<'JSON'
{
  "automation": {
    "schema_version": 1,
    "status": "continuation_required",
    "controller_action": "resume",
    "stop_class": "continuation_required",
    "stop_reason": "bounded_progress",
    "completed": false,
    "blocked": false,
    "retryable": true,
    "terminal_failure": false,
    "task_id": "task-smoke",
    "run_id": "run-smoke",
    "journey_id": "journey-smoke",
    "next_action": "inspect_progress_overview",
    "next_invocation": {"command": "resume", "arguments": []}
  },
  "status": "task_executed",
  "session_id": "session-smoke",
  "drive_id": "drive-smoke",
  "task_id": "task-smoke",
  "run_id": "run-smoke",
  "journey_id": "journey-smoke",
  "completion_closure_status": "budget_exhausted",
  "next_action": "inspect_progress_overview",
  "completed": false,
  "blocked": false,
  "retryable": true,
  "terminal_failure": false,
  "controller_action": "resume",
  "stop_class": "continuation_required",
  "stop_reason": "bounded_progress",
  "next_invocation": {"command": "resume", "arguments": []}
}
JSON
SH
chmod +x "$fake_brownie_legacy_json"
fake_brownie_workspace_change="$(mktemp)"
cat > "$fake_brownie_workspace_change" <<'SH'
#!/usr/bin/env bash
set -eu
printf 'changed\n' > phase-loop-smoke-progress.txt
cat <<'JSON'
{
  "automation": {
    "schema_version": 1,
    "status": "continuation_required",
    "controller_action": "resume",
    "stop_class": "continuation_required",
    "stop_reason": "bounded_progress",
    "completed": false,
    "blocked": false,
    "retryable": true,
    "terminal_failure": false,
    "task_id": "task-change",
    "run_id": "run-change",
    "journey_id": "journey-change",
    "next_action": "inspect_progress_overview",
    "next_invocation": {"command": "resume", "arguments": []}
  },
  "status": "task_executed",
  "task_id": "task-change",
  "run_id": "run-change",
  "journey_id": "journey-change",
  "completion_closure_status": "budget_exhausted",
  "next_action": "inspect_progress_overview",
  "completed": false,
  "blocked": false,
  "retryable": true,
  "terminal_failure": false,
  "controller_action": "resume",
  "stop_class": "continuation_required",
  "stop_reason": "bounded_progress",
  "next_invocation": {"command": "resume", "arguments": []}
}
JSON
SH
chmod +x "$fake_brownie_workspace_change"
fake_brownie_todo_md_only_apply="$(mktemp)"
cat > "$fake_brownie_todo_md_only_apply" <<'SH'
#!/usr/bin/env bash
set -eu
cat <<'JSON'
{
  "automation": {
    "schema_version": 1,
    "status": "continuation_required",
    "controller_action": "resume",
    "stop_class": "continuation_required",
    "stop_reason": "objective_proposal_candidate_ready",
    "completed": false,
    "blocked": false,
    "retryable": true,
    "terminal_failure": false,
    "task_id": "task-todo-md-only",
    "run_id": "run-todo-md-only",
    "journey_id": "journey-todo-md-only",
    "next_action": "inspect_progress_overview",
    "next_invocation": {"command": "resume", "arguments": []}
  },
  "status": "objective_proposal_applied",
  "task_id": "task-todo-md-only",
  "run_id": "run-todo-md-only",
  "journey_id": "journey-todo-md-only",
  "completion_closure_status": "routed_explicit_action",
  "next_action": "inspect_progress_overview",
  "completed": false,
  "blocked": false,
  "retryable": true,
  "terminal_failure": false,
  "controller_action": "resume",
  "stop_class": "continuation_required",
  "stop_reason": "objective_proposal_candidate_ready",
  "objective_apply_applied": true,
  "objective_apply_apply_status": "Applied",
  "objective_apply_path": "todo.md",
  "next_invocation": {"command": "resume", "arguments": []}
}
JSON
SH
chmod +x "$fake_brownie_todo_md_only_apply"
fake_brownie_no_actionable="$(mktemp)"
cat > "$fake_brownie_no_actionable" <<'SH'
#!/usr/bin/env bash
set -eu
cat <<'JSON'
{
  "automation": {
    "schema_version": 1,
    "status": "no_actionable_work",
    "controller_action": "stop",
    "stop_class": "no_actionable_work",
    "stop_reason": "no_actionable_work",
    "completed": false,
    "blocked": false,
    "retryable": false,
    "terminal_failure": false,
    "task_id": null,
    "run_id": null,
    "journey_id": null,
    "next_action": "inspect_progress_overview",
    "next_invocation": null
  },
  "status": "no_eligible_task",
  "completed": false,
  "blocked": false,
  "retryable": false,
  "terminal_failure": false,
  "controller_action": "stop",
  "stop_class": "no_actionable_work",
  "stop_reason": "no_actionable_work",
  "next_action": "inspect_progress_overview"
}
JSON
SH
chmod +x "$fake_brownie_no_actionable"
fake_brownie_terminal_no_eligible="$(mktemp)"
cat > "$fake_brownie_terminal_no_eligible" <<'SH'
#!/usr/bin/env bash
set -eu
if [ "${PHASE_LOOP_TEST_HEADLESS_ONLY:-0}" = "1" ]; then
  mkdir -p "$PHASE_LOOP_WORKSPACE_ROOT/.brownie/headless-continuations"
  printf '%s\n' '{"headless":"controller-output-only"}' > "$PHASE_LOOP_WORKSPACE_ROOT/.brownie/headless-continuations/fresh-run.json"
fi
if [ "${PHASE_LOOP_TEST_REMOVE_CLAIM:-0}" = "1" ]; then
  rm -f "$PHASE_LOOP_STATE_DIR/todo-claims/current.json"
fi
cat <<'JSON'
{
  "command": "run",
  "ok": true,
  "run": {
    "automation": {
      "schema_version": 1,
      "status": "terminal_failure",
      "controller_action": "stop",
      "stop_class": "terminal_failure",
      "stop_reason": "terminal_task_failed",
      "completed": false,
      "blocked": true,
      "retryable": false,
      "terminal_failure": true,
      "task_id": "task-terminal",
      "run_id": "run-terminal",
      "journey_id": "journey-terminal",
      "next_action": "inspect_progress_overview",
      "next_invocation": null,
      "llm_provider_failure": {
        "failure_fingerprint": "sha256:provider-terminal-no-content",
        "failure_class": "missing_provider_content",
        "retryable": true
      }
    },
    "status": "no_eligible_task",
    "session_id": "session-terminal",
    "drive_id": "drive-terminal",
    "task_id": "task-terminal",
    "run_id": "run-terminal",
    "journey_id": "journey-terminal",
    "completion_closure_status": "no_eligible_task",
    "next_action": "inspect_progress_overview",
    "completed": false,
    "blocked": true,
    "retryable": false,
    "terminal_failure": true,
    "controller_action": "stop",
    "stop_class": "terminal_failure",
    "stop_reason": "terminal_task_failed",
    "next_invocation": null,
    "llm_provider_failure": {
      "failure_fingerprint": "sha256:provider-terminal-no-content",
      "failure_class": "missing_provider_content",
      "retryable": true
    }
  }
}
JSON
SH
chmod +x "$fake_brownie_terminal_no_eligible"
fake_brownie_terminal_no_eligible_counted="$(mktemp)"
cat > "$fake_brownie_terminal_no_eligible_counted" <<SH
#!/usr/bin/env bash
set -eu
count_file="\$PHASE_LOOP_STATE_DIR/terminal-no-eligible-count"
count="\$(cat "\$count_file" 2>/dev/null || printf '0')"
printf '%s\n' "\$((count + 1))" > "\$count_file"
exec "$fake_brownie_terminal_no_eligible" "\$@"
SH
chmod +x "$fake_brownie_terminal_no_eligible_counted"
fake_brownie_terminal_retry_then_success="$(mktemp)"
cat > "$fake_brownie_terminal_retry_then_success" <<SH
#!/usr/bin/env bash
set -eu
attempt_file="\$PHASE_LOOP_STATE_DIR/terminal-retry-then-success.attempt"
attempt="\$(python3 - "\$attempt_file" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
attempt = int(path.read_text(encoding='utf-8')) if path.exists() else 0
attempt += 1
path.write_text(str(attempt), encoding='utf-8')
print(attempt)
PY
)"
if [ "\$attempt" -eq 1 ] && [ "\${PHASE_LOOP_TEST_REMOVE_CLAIM:-0}" = "1" ]; then
  rm -f "\$PHASE_LOOP_STATE_DIR/todo-claims/current.json"
fi
if [ "\$attempt" -ge 2 ]; then
  python3 - "\$PHASE_LOOP_TODO" <<'PY'
import pathlib
import re
import sys

path = pathlib.Path(sys.argv[1])
text = path.read_text(encoding='utf-8')
updated, count = re.subn(r'(?m)^- \[ \] (E-retry-success|E-retry-leaf):', r'- [x] \1:', text, count=1)
assert count == 1, text
path.write_text(updated, encoding='utf-8')
PY
  cat <<'JSON'
{
  "command": "run",
  "ok": true,
  "run": {
    "automation": {
      "schema_version": 1,
      "status": "completed",
      "controller_action": "stop",
      "stop_class": "completed",
      "stop_reason": "task_completed",
      "completed": true,
      "blocked": false,
      "retryable": false,
      "terminal_failure": false
    },
    "status": "completed",
    "completion_closure_status": "completed",
    "completed": true,
    "blocked": false,
    "retryable": false,
    "terminal_failure": false,
    "controller_action": "stop",
    "stop_class": "completed",
    "stop_reason": "task_completed",
    "next_action": "inspect_progress_overview"
  }
}
JSON
else
  exec "$fake_brownie_terminal_no_eligible" "\$@"
fi
SH
chmod +x "$fake_brownie_terminal_retry_then_success"
fake_brownie_completed="$(mktemp)"
cat > "$fake_brownie_completed" <<'SH'
#!/usr/bin/env bash
set -eu
cat <<'JSON'
{
  "command": "run",
  "ok": true,
  "run": {
    "automation": {
      "schema_version": 1,
      "status": "completed",
      "controller_action": "stop",
      "stop_class": "completed",
      "stop_reason": "task_completed",
      "completed": true,
      "blocked": false,
      "retryable": false,
      "terminal_failure": false
    },
    "status": "completed",
    "completion_closure_status": "completed",
    "completed": true,
    "blocked": false,
    "retryable": false,
    "terminal_failure": false,
    "controller_action": "stop",
    "stop_class": "completed",
    "stop_reason": "task_completed",
    "next_action": "inspect_progress_overview"
  }
}
JSON
SH
chmod +x "$fake_brownie_completed"
fake_brownie_completed_tracked_workspace_change="$(mktemp)"
cat > "$fake_brownie_completed_tracked_workspace_change" <<'SH'
#!/usr/bin/env bash
set -eu
if [ "${2:-}" = "run" ]; then
  printf 'completed workspace change from Brownie phase-loop\n' > README.md
fi
cat <<'JSON'
{
  "command": "run",
  "ok": true,
  "run": {
    "automation": {
      "schema_version": 1,
      "status": "completed",
      "controller_action": "stop",
      "stop_class": "completed",
      "stop_reason": "task_completed",
      "completed": true,
      "blocked": false,
      "retryable": false,
      "terminal_failure": false
    },
    "status": "completed",
    "completion_closure_status": "completed",
    "completed": true,
    "blocked": false,
    "retryable": false,
    "terminal_failure": false,
    "controller_action": "stop",
    "stop_class": "completed",
    "stop_reason": "task_completed",
    "next_action": "inspect_progress_overview"
  }
}
JSON
SH
chmod +x "$fake_brownie_completed_tracked_workspace_change"
fake_brownie_objective_apply_pending="$(mktemp)"
cat > "$fake_brownie_objective_apply_pending" <<'SH'
#!/usr/bin/env bash
set -eu
cat <<'JSON'
{
  "command": "run",
  "ok": true,
  "run": {
    "automation": {
      "schema_version": 1,
      "status": "continuation_required",
      "controller_action": "resume",
      "stop_class": "continuation_required",
      "stop_reason": "objective_proposal_candidate_ready",
      "completed": false,
      "blocked": false,
      "retryable": true,
      "terminal_failure": false,
      "task_id": "task-objective-apply",
      "run_id": "run-objective-apply",
      "journey_id": "journey-objective-apply",
      "next_action": "apply_authorized_objective_proposal",
      "next_invocation": {"command": "resume", "arguments": []}
    },
    "status": "no_eligible_task",
    "session_id": "session-objective-apply",
    "drive_id": "drive-objective-apply",
    "task_id": "task-objective-apply",
    "run_id": "run-objective-apply",
    "journey_id": "journey-objective-apply",
    "completion_closure_status": "routed_explicit_action",
    "next_action": "apply_authorized_objective_proposal",
    "completed": false,
    "blocked": false,
    "retryable": true,
    "terminal_failure": false,
    "controller_action": "resume",
    "stop_class": "continuation_required",
    "stop_reason": "objective_proposal_candidate_ready",
    "objective_proposal_preflight_status": "authorized_preflight_ready",
    "objective_proposal_preflight_operation": "patch_file",
    "objective_proposal_preflight_next_action": "apply_authorized_objective_proposal",
    "next_invocation": {"command": "resume", "arguments": []}
  }
}
JSON
SH
chmod +x "$fake_brownie_objective_apply_pending"
fake_brownie_tracked_workspace_change="$(mktemp)"
cat > "$fake_brownie_tracked_workspace_change" <<'SH'
#!/usr/bin/env bash
set -eu
if [ "${2:-}" = "run" ]; then
  printf 'changed by brownie phase-loop\n' > README.md
fi
cat <<'JSON'
{
  "automation": {
    "schema_version": 1,
    "status": "continuation_required",
    "controller_action": "resume",
    "stop_class": "continuation_required",
    "stop_reason": "bounded_progress",
    "completed": false,
    "blocked": false,
    "retryable": true,
    "terminal_failure": false,
    "task_id": "task-tracked-change",
    "run_id": "run-tracked-change",
    "journey_id": "journey-tracked-change",
    "next_action": "inspect_progress_overview",
    "next_invocation": {"command": "resume", "arguments": []}
  },
  "status": "task_executed",
  "task_id": "task-tracked-change",
  "run_id": "run-tracked-change",
  "journey_id": "journey-tracked-change",
  "completion_closure_status": "budget_exhausted",
  "next_action": "inspect_progress_overview",
  "completed": false,
  "blocked": false,
  "retryable": true,
  "terminal_failure": false,
  "controller_action": "resume",
  "stop_class": "continuation_required",
  "stop_reason": "bounded_progress",
  "next_invocation": {"command": "resume", "arguments": []}
}
JSON
SH
chmod +x "$fake_brownie_tracked_workspace_change"
fake_brownie_sleeping_child="$(mktemp)"
cat > "$fake_brownie_sleeping_child" <<'SH'
#!/usr/bin/env bash
set -eu
child_pid_file="${PHASE_LOOP_TEST_CHILD_PID_FILE:?missing child pid file}"
(
  trap '' TERM
  sleep 120
) &
child_pid="$!"
printf '%s\n' "$child_pid" > "$child_pid_file"
wait "$child_pid"
SH
chmod +x "$fake_brownie_sleeping_child"
fake_brownie_invalid_json="$(mktemp)"
cat > "$fake_brownie_invalid_json" <<'SH'
#!/usr/bin/env bash
echo "not json"
SH
chmod +x "$fake_brownie_invalid_json"
fake_brownie_blocked_json="$(mktemp)"
cat > "$fake_brownie_blocked_json" <<'SH'
#!/usr/bin/env bash
set -eu
cat <<'JSON'
{
  "command": "run",
  "ok": true,
  "run": {
    "automation": {
      "schema_version": 1,
      "status": "recoverable_unknown_nonterminal",
      "controller_action": "resume",
      "stop_class": "recoverable_unknown_nonterminal",
      "stop_reason": "budget_exhausted",
      "completed": false,
      "blocked": true,
      "retryable": true,
      "terminal_failure": false,
      "task_id": "task-blocked",
      "run_id": "run-blocked",
      "journey_id": "journey-blocked",
      "next_action": "inspect_progress_overview",
      "next_invocation": {"command": "resume", "arguments": [], "params": {"authorize": true}}
    },
    "status": "task_executed",
    "session_id": "session-blocked",
    "drive_id": "drive-blocked",
    "task_id": "task-blocked",
    "run_id": "run-blocked",
    "journey_id": "journey-blocked",
    "completion_closure_status": "unknown_nonterminal",
    "next_action": "inspect_progress_overview",
    "completed": false,
    "blocked": true,
    "retryable": true,
    "terminal_failure": false,
    "controller_action": "resume",
    "stop_class": "recoverable_unknown_nonterminal",
    "stop_reason": "budget_exhausted",
    "next_invocation": {"command": "resume", "arguments": [], "params": {"authorize": true}}
  }
}
JSON
SH
chmod +x "$fake_brownie_blocked_json"
fake_brownie_must_not_run="$(mktemp)"
cat > "$fake_brownie_must_not_run" <<'SH'
#!/usr/bin/env bash
echo "Brownie should not run for explicit blocker TODO claims" >&2
exit 99
SH
chmod +x "$fake_brownie_must_not_run"

if claim_smoke_section_enabled core; then
state_with_claim="$(mktemp -d)"
prompt_with_claim="$(mktemp)"
todo_with_claim="$(mktemp)"
printf 'base prompt\n' > "$prompt_with_claim"
printf -- '- [ ] B-01: durable claim task\n  with detail\n  Files: `scripts/release-runtime-operational-evidence.mjs`, `docs/architecture/local-release-targets.example.json`.\n- [ ] B-02: next task\n' > "$todo_with_claim"

PHASE_LOOP_STATE_DIR="$state_with_claim" \
PHASE_LOOP_PROMPT="$prompt_with_claim" \
PHASE_LOOP_TODO="$todo_with_claim" \
BROWNIE_BIN="$fake_brownie_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

claim_file="$state_with_claim/todo-claims/current.json"
queue_state_file="$state_with_claim/todo-claims/todo-queue-state.json"
progress_state_file="$state_with_claim/progress-state.json"
prompt_file="$(find "$state_with_claim/runs" -name '*.prompt.md' -print | sort | tail -n 1)"
prompt_meta_file="${prompt_file%.prompt.md}.prompt.meta.json"

python3 - "$claim_file" "$queue_state_file" "$progress_state_file" "$prompt_file" "$prompt_meta_file" <<'PY'
import json
import os
import stat
import sys

path = sys.argv[1]
claim = json.load(open(path, encoding="utf-8"))
queue_state = json.load(open(sys.argv[2], encoding="utf-8"))
progress_state = json.load(open(sys.argv[3], encoding="utf-8"))
prompt_meta = json.load(open(sys.argv[5], encoding="utf-8"))
prompt_text = open(sys.argv[4], encoding="utf-8").read()
mode = stat.S_IMODE(os.stat(path).st_mode)
queue_mode = stat.S_IMODE(os.stat(sys.argv[2]).st_mode)
progress_mode = stat.S_IMODE(os.stat(sys.argv[3]).st_mode)
prompt_mode = stat.S_IMODE(os.stat(sys.argv[4]).st_mode)
prompt_meta_mode = stat.S_IMODE(os.stat(sys.argv[5]).st_mode)
history = [entry["status"] for entry in claim["status_history"]]
assert claim["status"] == "in_progress", claim
assert history[:2] == ["claimed", "in_progress"], claim
assert claim["selected_todo"].startswith("- [ ] B-01: durable claim task"), claim
assert claim["queue_generation"] == 1, claim
assert claim["queue_fingerprint"] == queue_state["fingerprint"], (claim, queue_state)
assert queue_state["generation"] == 1, queue_state
assert progress_state["classification"] == "non_progress_success", progress_state
assert progress_state["meaningful_progress"] is False, progress_state
assert progress_state["continuation_required"] is False, progress_state
assert progress_state["workspace_changed"] is False, progress_state
assert progress_state["progress_projection"]["closure"] == "budget_exhausted", progress_state
assert progress_state["progress_projection"]["stop_class"] == "continuation_required", progress_state
assert progress_state["progress_projection"]["controller_action"] == "resume", progress_state
assert prompt_meta["selected_todo_complete"] is False, prompt_meta
assert prompt_meta["selected_todo_completion_reason"] == "selected_todo_still_unchecked", prompt_meta
assert prompt_meta["context_hints"][:2] == [
    "scripts/release-runtime-operational-evidence.mjs",
    "docs/architecture/local-release-targets.example.json",
], prompt_meta
assert "A valid first response shape is" not in prompt_text, prompt_text
assert "Never copy a prior read request" in prompt_text, prompt_text
assert len(prompt_meta["prompt_sha256"]) == 64, prompt_meta
assert len(prompt_meta["todo_sha256"]) == 64, prompt_meta
assert len(prompt_meta["base_prompt_sha256"]) == 64, prompt_meta
assert mode == 0o600, oct(mode)
assert queue_mode == 0o600, oct(queue_mode)
assert progress_mode == 0o600, oct(progress_mode)
assert prompt_mode == 0o600, oct(prompt_mode)
assert prompt_meta_mode == 0o600, oct(prompt_meta_mode)
PY

state_with_blocked="$(mktemp -d)"
prompt_with_blocked="$(mktemp)"
todo_with_blocked="$(mktemp)"
printf 'base prompt\n' > "$prompt_with_blocked"
printf -- '- [ ] R-09: blocked boundary task\n' > "$todo_with_blocked"

PHASE_LOOP_STATE_DIR="$state_with_blocked" \
PHASE_LOOP_PROMPT="$prompt_with_blocked" \
PHASE_LOOP_TODO="$todo_with_blocked" \
BROWNIE_BIN="$fake_brownie_blocked_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null
test ! -f "$state_with_blocked/stop"
python3 - "$state_with_blocked/status.json" "$state_with_blocked/todo-claims/current.json" <<'PY'
import json
import sys

status = json.load(open(sys.argv[1], encoding="utf-8"))
claim = json.load(open(sys.argv[2], encoding="utf-8"))
assert status["status"] == "blocked_todo_recorded", status
assert status["exit_code"] == "0", status
assert "blocked external-control boundary" in status["detail"], status
assert "will continue with the next unblocked TODO" in status["detail"], status
assert claim["status"] == "blocked", claim
PY
fi

if claim_smoke_section_enabled terminal; then
state_terminal_no_eligible="$(mktemp -d)"
prompt_terminal_no_eligible="$(mktemp)"
todo_terminal_no_eligible="$(mktemp)"
todo_breakdown_terminal_no_eligible="$(mktemp)"
root_breakdown_before="$(shasum "$REPO_ROOT/.brownie/todo-breakdown.md" | awk '{print $1}')"
printf 'base prompt\n' > "$prompt_terminal_no_eligible"
printf -- '- [ ] E-15a-redaction-guard: implement concrete guard task\n' > "$todo_terminal_no_eligible"

set +e
PHASE_LOOP_STATE_DIR="$state_terminal_no_eligible" \
PHASE_LOOP_PROMPT="$prompt_terminal_no_eligible" \
PHASE_LOOP_TODO="$todo_terminal_no_eligible" \
PHASE_LOOP_TODO_BREAKDOWN="$todo_breakdown_terminal_no_eligible" \
BROWNIE_BIN="$fake_brownie_terminal_no_eligible" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
PHASE_LOOP_TEST_HEADLESS_ONLY=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 76 "$PHASE_LOOP" run-once >/dev/null
terminal_no_eligible_exit="$?"
set -e
test "$terminal_no_eligible_exit" = "76"
test "$(shasum "$REPO_ROOT/.brownie/todo-breakdown.md" | awk '{print $1}')" = "$root_breakdown_before"
python3 - "$state_terminal_no_eligible/status.json" "$state_terminal_no_eligible/progress-state.json" "$state_terminal_no_eligible/todo-claims/current.json" "$state_terminal_no_eligible/todo-claims/repair-feedback.json" "$state_terminal_no_eligible/todo-claims/blocked.jsonl" "$test_workspace/.brownie/private/phase-loop/task-ledger.jsonl" <<'PY'
import json
import pathlib
import sys

status = json.load(open(sys.argv[1], encoding="utf-8"))
progress = json.load(open(sys.argv[2], encoding="utf-8"))
claim = json.load(open(sys.argv[3], encoding="utf-8"))
feedback = json.load(open(sys.argv[4], encoding="utf-8"))
blocked_path = pathlib.Path(sys.argv[5])
blocked = [json.loads(line) for line in blocked_path.read_text(encoding="utf-8").splitlines() if line.strip()] if blocked_path.exists() else []
ledger_path = pathlib.Path(sys.argv[6])
ledger = ledger_path.read_text(encoding="utf-8") if ledger_path.exists() else ""
assert status["status"] == "blocked", status
assert "retry_cap=0" in status["detail"], status
assert progress["classification"] == "terminal_failure", progress
assert progress["meaningful_progress"] is False, progress
assert progress["progress_projection"]["blocked_by_terminal_task_failure"] is True, progress
assert progress["progress_projection"]["provider_failure_fingerprint"] == "sha256:provider-terminal-no-content", progress
assert progress["workspace_changed"] is False, progress
assert claim["status"] == "in_progress", claim
assert claim["status_history"][-1]["status"] == "in_progress", claim
assert feedback["kind"] == "phase_loop_terminal_failure_redelegation_required", feedback
assert feedback["claim_id"] == claim["claim_id"], feedback
assert feedback["recovery_state"] == "redelegatable", feedback
assert not blocked, blocked
assert "terminal_failure_transaction" not in ledger, ledger
PY

# A stale terminal-looking claim must be isolated before a retry-cap-zero run.
# The fresh claim is allowed to execute once, but the old claim identity and
# terminal projection may not be inherited or re-recorded as a terminal block.
state_stale_r3="$(mktemp -d)"
prompt_stale_r3="$(mktemp)"
todo_stale_r3="$(mktemp)"
stale_r3_workspace="$(mktemp -d)"
git -C "$stale_r3_workspace" init -b main >/dev/null
git -C "$stale_r3_workspace" -c user.name=Brownie -c user.email=brownie@example.invalid commit --allow-empty -m init >/dev/null
printf 'base prompt\n' > "$prompt_stale_r3"
printf -- '- [ ] E-stale-r3: Patch only `scripts/stale-r3.mjs`:\n  Route: implementation.\n  Verification: run `node --check scripts/stale-r3.mjs`.\n' > "$todo_stale_r3"
mkdir -p "$state_stale_r3/todo-claims" "$state_stale_r3/runs"
python3 - "$state_stale_r3" "$todo_stale_r3" <<'PY'
import json
import pathlib
import sys

state = pathlib.Path(sys.argv[1])
selected = pathlib.Path(sys.argv[2]).read_text(encoding="utf-8").rstrip("\n")
def write(path, value):
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
write(state / "todo-claims/current.json", {
    "schema_version": 1,
    "claim_id": "todo-g541-stale-r3",
    "status": "in_progress",
    "selected_todo": selected,
    "queue_generation": 541,
    "queue_fingerprint": "old-queue",
    "run_stamp": "20261019T071825Z",
    "retry_cap": 0,
})
write(state / "status.json", {"status": "no_progress", "run_id": "old-run", "supervisor_pid": 86793})
write(state / "progress-state.json", {
    "classification": "terminal_failure",
    "run_stamp": "20261019T071825Z",
    "progress_projection": {
        "claim_id": "todo-g541-stale-r3",
        "selected_todo": selected,
        "stop_class": "terminal_failure",
        "stop_reason": "terminal_task_failed",
        "cli_status": "no_eligible_task",
    },
})
write(state / "todo-claims/todo-queue-state.json", {"generation": 541, "fingerprint": "new-queue"})
PY
set +e
PHASE_LOOP_STATE_DIR="$state_stale_r3" \
PHASE_LOOP_PROMPT="$prompt_stale_r3" \
PHASE_LOOP_TODO="$todo_stale_r3" \
BROWNIE_BIN="$fake_brownie_terminal_no_eligible" \
PHASE_LOOP_WORKSPACE_ROOT="$stale_r3_workspace" \
PHASE_LOOP_TERMINAL_FAILURE_RETRY_CAP=0 \
PHASE_LOOP_TEST_HEADLESS_ONLY=1 \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 76 "$PHASE_LOOP" run-once >/dev/null
stale_r3_exit="$?"
set -e
test "$stale_r3_exit" = "76"
python3 - "$state_stale_r3" <<'PY'
import json
import pathlib
import sys

state = pathlib.Path(sys.argv[1])
claim_dir = state / "todo-claims"
claim = json.loads((claim_dir / "current.json").read_text(encoding="utf-8"))
archives = sorted(claim_dir.glob("stale-rebaseline-*.json"))
assert len(archives) == 1, archives
archived = json.loads(archives[0].read_text(encoding="utf-8"))
assert archived["claim_id"] == "todo-g541-stale-r3", archived
assert archived["retry_eligible"] is True, archived
assert archived["recovery_state"] == "redelegatable", archived
assert claim["claim_id"] != "todo-g541-stale-r3", claim
assert claim["status"] == "in_progress", claim
assert claim["retry_cap"] == 0, claim
feedback = json.loads((claim_dir / "repair-feedback.json").read_text(encoding="utf-8"))
assert feedback["kind"] == "phase_loop_terminal_failure_redelegation_required", feedback
assert feedback["recovery_state"] == "redelegatable", feedback
PY

# A positive terminal-failure retry cap permits the configured number of
# additional executions, then suppresses the same TODO on the next claim.
state_terminal_retry_cap="$(mktemp -d)"
prompt_terminal_retry_cap="$(mktemp)"
todo_terminal_retry_cap="$(mktemp)"
terminal_retry_cap_workspace="$(mktemp -d)"
git -C "$terminal_retry_cap_workspace" init -b main >/dev/null
git -C "$terminal_retry_cap_workspace" -c user.name=Brownie -c user.email=brownie@example.invalid commit --allow-empty -m init >/dev/null
printf 'base prompt\n' > "$prompt_terminal_retry_cap"
printf -- '- [ ] E-retry-cap: Patch only `scripts/retry-cap.mjs`:\n  Route: implementation.\n  Verification: run `node --check scripts/retry-cap.mjs`.\n\n- [ ] E-retry-cap-deferred: Blocker: unavailable prerequisite is controlled outside the workspace.\n  Route: documentation.\n  Completion condition: the owner supplies the prerequisite evidence.\n  Verification: blocker: exact missing evidence is named, and no workspace file is patched until it is available.\n' > "$todo_terminal_retry_cap"
for retry_run in 1 2; do
  set +e
  PHASE_LOOP_STATE_DIR="$state_terminal_retry_cap" \
  PHASE_LOOP_PROMPT="$prompt_terminal_retry_cap" \
  PHASE_LOOP_TODO="$todo_terminal_retry_cap" \
  BROWNIE_BIN="$fake_brownie_terminal_no_eligible" \
  PHASE_LOOP_WORKSPACE_ROOT="$terminal_retry_cap_workspace" \
  PHASE_LOOP_TEST_HEADLESS_ONLY=1 \
  PHASE_LOOP_TERMINAL_FAILURE_RETRY_CAP=1 \
  run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 76 "$PHASE_LOOP" run-once >/dev/null
  retry_exit="$?"
  set -e
  test "$retry_exit" = "76"
done
python3 - "$terminal_retry_cap_workspace/.brownie/private/phase-loop/task-ledger.jsonl" <<'PY'
import json
import pathlib
import sys

transactions = []
for line in pathlib.Path(sys.argv[1]).read_text(encoding='utf-8').splitlines():
    if not line.strip():
        continue
    record = json.loads(line)
    if record.get('kind') == 'terminal_failure_transaction':
        transactions.append(record)
same_todo = [
    record for record in transactions
    if any('E-retry-cap:' in str(event.get('selected_todo', '')) for event in record.get('events', []))
]
assert len(same_todo) == 2, same_todo
assert all(event.get('retry_cap') == 1 for record in same_todo for event in record.get('events', [])), same_todo
claim_ids = [
    next(event['claim_id'] for event in record.get('events', []) if 'E-retry-cap:' in str(event.get('selected_todo', '')))
    for record in same_todo
]
assert len(set(claim_ids)) == 2, claim_ids
assert claim_ids[0] != claim_ids[1], claim_ids
PY
set +e
PHASE_LOOP_STATE_DIR="$state_terminal_retry_cap" \
PHASE_LOOP_PROMPT="$prompt_terminal_retry_cap" \
PHASE_LOOP_TODO="$todo_terminal_retry_cap" \
BROWNIE_BIN="$fake_brownie_terminal_no_eligible" \
PHASE_LOOP_WORKSPACE_ROOT="$terminal_retry_cap_workspace" \
PHASE_LOOP_TEST_HEADLESS_ONLY=1 \
PHASE_LOOP_TERMINAL_FAILURE_RETRY_CAP=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 65,75,76 "$PHASE_LOOP" run-once >/dev/null
retry_cap_exhausted_exit="$?"
set -e
case "$retry_cap_exhausted_exit" in
  65|75|76) ;;
  *) echo "unexpected retry-cap exhaustion exit=$retry_cap_exhausted_exit" >&2; exit 1 ;;
esac
assert_terminal_failure_claim_archived \
  "$state_terminal_retry_cap/todo-claims" \
  "$state_terminal_retry_cap/todo-claims/blocked.jsonl" \
  "$terminal_retry_cap_workspace/.brownie/private/phase-loop/task-ledger.jsonl" \
  'E-retry-cap:' 2
python3 - "$terminal_retry_cap_workspace/.brownie/private/phase-loop/task-ledger.jsonl" "$state_terminal_retry_cap/status.json" "$state_terminal_retry_cap/progress-state.json" <<'PY'
import json
import pathlib
import sys

transactions = [
    json.loads(line) for line in pathlib.Path(sys.argv[1]).read_text(encoding='utf-8').splitlines()
    if line.strip() and json.loads(line).get('kind') == 'terminal_failure_transaction'
]
same_todo = [
    record for record in transactions
    if any('E-retry-cap:' in str(event.get('selected_todo', '')) for event in record.get('events', []))
]
assert len(same_todo) == 2, same_todo
status = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding='utf-8'))
progress = json.loads(pathlib.Path(sys.argv[3]).read_text(encoding='utf-8'))
assert status['status'] == 'blocked', status
assert progress['progress_projection']['cli_status'] == 'no_eligible_task', progress
assert progress['progress_projection']['closure'] == 'no_eligible_task', progress
if status['exit_code'] == '75':
    assert 'Failed to claim first pending TODO' in status['detail'], status
elif status['exit_code'] == '65':
    assert 'explicit owner-controlled blocker TODO' in status['detail'], status
else:
    assert status['exit_code'] == '76', status
    assert 'terminal_task_failed' in status['detail'], status
    assert progress['classification'] == 'terminal_failure', progress
PY

# A retry-cap allowance must permit the next execution to complete with a
# fresh claim/attempt rather than colliding with the failed terminal attempt.
state_terminal_retry_success="$(mktemp -d)"
prompt_terminal_retry_success="$(mktemp)"
todo_terminal_retry_success="$(mktemp)"
todo_breakdown_terminal_retry_success="$(mktemp)"
terminal_retry_success_workspace="$(mktemp -d)"
git -C "$terminal_retry_success_workspace" init -b main >/dev/null
git -C "$terminal_retry_success_workspace" config user.name Brownie
git -C "$terminal_retry_success_workspace" config user.email brownie@example.invalid
mkdir -p "$terminal_retry_success_workspace/scripts"
printf 'export const retrySuccess = true;\n' > "$terminal_retry_success_workspace/scripts/retry-success.mjs"
git -C "$terminal_retry_success_workspace" add .
git -C "$terminal_retry_success_workspace" commit -m init >/dev/null
printf 'base prompt\n' > "$prompt_terminal_retry_success"
printf -- '- [ ] E-retry-success: Patch only `scripts/retry-success.mjs`:\n  Route: implementation.\n  Verification: run `node --check scripts/retry-success.mjs`.\n' > "$todo_terminal_retry_success"
printf '# Breakdown\n' > "$todo_breakdown_terminal_retry_success"
set +e
PHASE_LOOP_STATE_DIR="$state_terminal_retry_success" \
PHASE_LOOP_PROMPT="$prompt_terminal_retry_success" \
PHASE_LOOP_TODO="$todo_terminal_retry_success" \
PHASE_LOOP_TODO_BREAKDOWN="$todo_breakdown_terminal_retry_success" \
BROWNIE_BIN="$fake_brownie_terminal_retry_then_success" \
PHASE_LOOP_WORKSPACE_ROOT="$terminal_retry_success_workspace" \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
PHASE_LOOP_TEST_REMOVE_CLAIM=1 \
PHASE_LOOP_TERMINAL_FAILURE_RETRY_CAP=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 76 "$PHASE_LOOP" run-once >/dev/null
retry_success_first_exit="$?"
set -e
test "$retry_success_first_exit" = "76"
test ! -f "$state_terminal_retry_success/todo-claims/current.json"
set +e
PHASE_LOOP_STATE_DIR="$state_terminal_retry_success" \
PHASE_LOOP_PROMPT="$prompt_terminal_retry_success" \
PHASE_LOOP_TODO="$todo_terminal_retry_success" \
PHASE_LOOP_TODO_BREAKDOWN="$todo_breakdown_terminal_retry_success" \
BROWNIE_BIN="$fake_brownie_terminal_retry_then_success" \
PHASE_LOOP_WORKSPACE_ROOT="$terminal_retry_success_workspace" \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
PHASE_LOOP_TEST_REMOVE_CLAIM=1 \
PHASE_LOOP_TERMINAL_FAILURE_RETRY_CAP=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null
retry_success_second_exit="$?"
set -e
test "$retry_success_second_exit" = "0"
python3 - "$terminal_retry_success_workspace/.brownie/private/phase-loop/task-ledger.jsonl" "$state_terminal_retry_success/todo-claims" "$todo_terminal_retry_success" <<'PY'
import json
import pathlib
import sys

ledger = []
terminal_failure_events = []
for line in pathlib.Path(sys.argv[1]).read_text(encoding='utf-8').splitlines():
    if not line.strip():
        continue
    record = json.loads(line)
    if record.get('kind') == 'terminal_failure_transaction':
        terminal_failure_events.extend(record.get('events', []))
    else:
        ledger.append(record)
claim_dir = pathlib.Path(sys.argv[2])
archives = sorted(claim_dir.glob('stale-*.json'))
assert len(archives) == 1, archives
archived_claim = json.loads(archives[0].read_text(encoding='utf-8'))
assert archived_claim['status'] == 'failed', archived_claim
assert archived_claim['archive_reason'] == 'terminal_failure_retry', archived_claim
assert archived_claim['retry_eligible'] is True, archived_claim
assert archived_claim['terminal_recovery_id'], archived_claim
assert archived_claim['selected_todo'].startswith('- [ ] E-retry-success:'), archived_claim
attempts = [event for event in ledger if str(event.get('task_id', '')).startswith('E-retry-success@')]
completed = [event for event in attempts if event.get('to_state') == 'completed']
failed_claim_ids = {event.get('claim_id') for event in terminal_failure_events}
assert terminal_failure_events, terminal_failure_events
assert completed, attempts
assert completed[-1]['claim_id'] not in failed_claim_ids, (completed, terminal_failure_events)
assert len({event.get('claim_id') for event in attempts if event.get('claim_id')}) >= 2, attempts
assert '- [ ] E-retry-success:' not in pathlib.Path(sys.argv[3]).read_text(encoding='utf-8'), pathlib.Path(sys.argv[3]).read_text(encoding='utf-8')
PY

# A retryable terminal failure for a generated leaf must bypass the legacy
# stable-ID/controller short circuit and invoke Runtime while cap remains.
state_terminal_retry_leaf="$(mktemp -d)"
prompt_terminal_retry_leaf="$(mktemp)"
todo_terminal_retry_leaf="$(mktemp)"
terminal_retry_leaf_workspace="$(mktemp -d)"
git -C "$terminal_retry_leaf_workspace" init -b main >/dev/null
git -C "$terminal_retry_leaf_workspace" config user.name Brownie
git -C "$terminal_retry_leaf_workspace" config user.email brownie@example.invalid
mkdir -p "$terminal_retry_leaf_workspace/scripts"
printf 'export const retryLeaf = true;\n' > "$terminal_retry_leaf_workspace/scripts/retry-leaf.mjs"
git -C "$terminal_retry_leaf_workspace" add .
git -C "$terminal_retry_leaf_workspace" commit -m init >/dev/null
printf 'base prompt\n' > "$prompt_terminal_retry_leaf"
printf -- '- [ ] E-retry-leaf: Patch only `scripts/retry-leaf.mjs`:\n  Route: implementation.\n  Source TODO: E-source-parent.\n  Depends on: <none>.\n  Verification: run `node --check scripts/retry-leaf.mjs`.\n' > "$todo_terminal_retry_leaf"
set +e
PHASE_LOOP_STATE_DIR="$state_terminal_retry_leaf" \
PHASE_LOOP_PROMPT="$prompt_terminal_retry_leaf" \
PHASE_LOOP_TODO="$todo_terminal_retry_leaf" \
BROWNIE_BIN="$fake_brownie_terminal_retry_then_success" \
PHASE_LOOP_WORKSPACE_ROOT="$terminal_retry_leaf_workspace" \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
PHASE_LOOP_TERMINAL_FAILURE_RETRY_CAP=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 76 "$PHASE_LOOP" run-once >/dev/null
retry_leaf_first_exit="$?"
set -e
test "$retry_leaf_first_exit" = "76"
set +e
PHASE_LOOP_STATE_DIR="$state_terminal_retry_leaf" \
PHASE_LOOP_PROMPT="$prompt_terminal_retry_leaf" \
PHASE_LOOP_TODO="$todo_terminal_retry_leaf" \
BROWNIE_BIN="$fake_brownie_terminal_retry_then_success" \
PHASE_LOOP_WORKSPACE_ROOT="$terminal_retry_leaf_workspace" \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
PHASE_LOOP_TERMINAL_FAILURE_RETRY_CAP=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null
retry_leaf_second_exit="$?"
set -e
test "$retry_leaf_second_exit" = "0"
test "$(cat "$state_terminal_retry_leaf/terminal-retry-then-success.attempt")" = "2"
assert_not_contains "$todo_terminal_retry_leaf" '- \[ \] E-retry-leaf:'

# Invalid retry caps must fail before claim, ledger, archive, or blocked-state
# writes, and must never invoke the runtime.
invalid_cap_state="$(mktemp -d)"
invalid_cap_workspace="$(mktemp -d)"
invalid_cap_prompt="$(mktemp)"
invalid_cap_todo="$(mktemp)"
git -C "$invalid_cap_workspace" init -b main >/dev/null
git -C "$invalid_cap_workspace" -c user.name=Brownie -c user.email=brownie@example.invalid commit --allow-empty -m init >/dev/null
printf 'base prompt\n' > "$invalid_cap_prompt"
printf -- '- [ ] E-invalid-cap: Patch only `scripts/invalid-cap.mjs`:\n  Route: implementation.\n  Verification: run `node --check scripts/invalid-cap.mjs`.\n' > "$invalid_cap_todo"
invalid_cap_diagnostic="$invalid_cap_state/invalid-cap.stderr"
set +e
PHASE_LOOP_STATE_DIR="$invalid_cap_state" \
PHASE_LOOP_PROMPT="$invalid_cap_prompt" \
PHASE_LOOP_TODO="$invalid_cap_todo" \
BROWNIE_BIN="$fake_brownie_must_not_run" \
PHASE_LOOP_WORKSPACE_ROOT="$invalid_cap_workspace" \
PHASE_LOOP_TERMINAL_FAILURE_RETRY_CAP='not-an-integer' \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 78 "$PHASE_LOOP" run-once >/dev/null 2>"$invalid_cap_diagnostic"
invalid_cap_exit="$?"
set -e
test "$invalid_cap_exit" = "78"
assert_contains "$invalid_cap_diagnostic" 'Invalid PHASE_LOOP_TERMINAL_FAILURE_RETRY_CAP=not-an-integer'
test ! -f "$invalid_cap_state/status.json"
test ! -f "$invalid_cap_state/todo-claims/current.json"
test ! -e "$invalid_cap_state/todo-claims/blocked.jsonl"
test ! -e "$invalid_cap_workspace/.brownie/private/phase-loop/task-ledger.jsonl"

# A terminal recovery ledger write failure must not append blocked evidence or
# leave a retry-eligible claim behind.
ledger_terminal_failure_state="$(mktemp -d)"
ledger_terminal_failure_workspace="$(mktemp -d)"
ledger_terminal_failure_prompt="$(mktemp)"
ledger_terminal_failure_todo="$(mktemp)"
git -C "$ledger_terminal_failure_workspace" init -b main >/dev/null
git -C "$ledger_terminal_failure_workspace" -c user.name=Brownie -c user.email=brownie@example.invalid commit --allow-empty -m init >/dev/null
printf 'base prompt\n' > "$ledger_terminal_failure_prompt"
printf -- '- [ ] E-ledger-terminal-failure: Patch only `scripts/ledger-terminal-failure.mjs`:\n  Route: implementation.\n  Verification: run `node --check scripts/ledger-terminal-failure.mjs`.\n\n- [ ] E-ledger-terminal-blocker: Blocker: external recovery evidence is unavailable.\n  Route: documentation.\n  Completion condition: the owner supplies the recovery evidence.\n  Verification: blocker: exact missing evidence is named before any workspace patch.\n' > "$ledger_terminal_failure_todo"
set +e
PHASE_LOOP_STATE_DIR="$ledger_terminal_failure_state" \
PHASE_LOOP_PROMPT="$ledger_terminal_failure_prompt" \
PHASE_LOOP_TODO="$ledger_terminal_failure_todo" \
BROWNIE_BIN="$fake_brownie_terminal_no_eligible" \
PHASE_LOOP_WORKSPACE_ROOT="$ledger_terminal_failure_workspace" \
PHASE_LOOP_TERMINAL_FAILURE_RETRY_CAP=1 \
PHASE_LOOP_TEST_FAIL_TERMINAL_LEDGER=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 78 "$PHASE_LOOP" run-once >/dev/null
ledger_terminal_failure_exit="$?"
set -e
test "$ledger_terminal_failure_exit" = "78"
python3 - "$ledger_terminal_failure_state/status.json" "$ledger_terminal_failure_state/todo-claims" "$ledger_terminal_failure_workspace/.brownie/private/phase-loop/task-ledger.jsonl" <<'PY'
import json
import pathlib
import sys

status = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
claim_dir = pathlib.Path(sys.argv[2])
ledger_path = pathlib.Path(sys.argv[3])
archives = sorted(claim_dir.glob('stale-*.json'))
assert not archives, archives
claim = json.loads((claim_dir / 'current.json').read_text(encoding='utf-8'))
assert claim['status'] == 'in_progress', claim
assert claim['terminal_failure_recovery_pending'] is True, claim
blocked_path = claim_dir / 'blocked.jsonl'
assert not blocked_path.exists() or (blocked_path.is_file() and not blocked_path.read_text(encoding='utf-8').strip()), blocked_path
ledger = ledger_path.read_text(encoding='utf-8')
assert 'terminal_failure_transaction' not in ledger, ledger
ledger_records = [json.loads(line) for line in ledger.splitlines() if line.strip()]
claim_id = claim['claim_id']
source_task = 'E-ledger-terminal-failure@' + claim_id
assert not any(event.get('task_id') == source_task and event.get('to_state') == 'failed' for event in ledger_records), ledger_records
assert status['status'] == 'blocked', status
assert status['exit_code'] == '78', status
assert 'could not be fully recorded' in status['detail'], status
assert 'refusing to retry' in status['detail'], status
PY
set +e
PHASE_LOOP_STATE_DIR="$ledger_terminal_failure_state" \
PHASE_LOOP_PROMPT="$ledger_terminal_failure_prompt" \
PHASE_LOOP_TODO="$ledger_terminal_failure_todo" \
BROWNIE_BIN="$fake_brownie_terminal_no_eligible_counted" \
PHASE_LOOP_WORKSPACE_ROOT="$ledger_terminal_failure_workspace" \
PHASE_LOOP_TERMINAL_FAILURE_RETRY_CAP=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 76 "$PHASE_LOOP" run-once >/dev/null
ledger_terminal_failure_retry_exit="$?"
set -e
test "$ledger_terminal_failure_retry_exit" = "76"
test "$(cat "$ledger_terminal_failure_state/terminal-no-eligible-count" 2>/dev/null || printf '0')" = "0"
python3 - "$ledger_terminal_failure_state/status.json" "$ledger_terminal_failure_state/todo-claims/current.json" "$ledger_terminal_failure_state/todo-claims/blocked.jsonl" "$ledger_terminal_failure_workspace/.brownie/private/phase-loop/task-ledger.jsonl" <<'PY'
import json
import pathlib
import sys

status = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
claim = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding='utf-8'))
blocked = [json.loads(line) for line in pathlib.Path(sys.argv[3]).read_text(encoding='utf-8').splitlines() if line.strip()]
ledger = [json.loads(line) for line in pathlib.Path(sys.argv[4]).read_text(encoding='utf-8').splitlines() if line.strip()]
assert status['exit_code'] == '76', status
assert claim['status'] == 'failed', claim
assert claim['terminal_failure_recovery_pending'] is False, claim
assert blocked and blocked[-1]['terminal_failure'] is True, blocked
source_task = 'E-ledger-terminal-failure@' + claim['claim_id']
assert any(event.get('task_id') == source_task and event.get('to_state') == 'failed' and event.get('from_state') in ('claimed', 'running') for event in ledger), ledger
PY

# A successful terminal ledger transaction is not complete until blocked.jsonl
# also accepts the evidence. A directory at that path must fail closed and
# retire the claim as non-retryable.
blocked_append_failure_state="$(mktemp -d)"
blocked_append_failure_workspace="$(mktemp -d)"
blocked_append_failure_prompt="$(mktemp)"
blocked_append_failure_todo="$(mktemp)"
git -C "$blocked_append_failure_workspace" init -b main >/dev/null
git -C "$blocked_append_failure_workspace" -c user.name=Brownie -c user.email=brownie@example.invalid commit --allow-empty -m init >/dev/null
mkdir -p "$blocked_append_failure_state/todo-claims/blocked.jsonl"
printf 'base prompt\n' > "$blocked_append_failure_prompt"
printf -- '- [ ] E-blocked-append-failure: Patch only `scripts/blocked-append-failure.mjs`:\n  Route: implementation.\n  Verification: run `node --check scripts/blocked-append-failure.mjs`.\n\n- [ ] E-blocked-append-blocker: Blocker: external recovery evidence is unavailable.\n  Route: documentation.\n  Completion condition: the owner supplies the recovery evidence.\n  Verification: blocker: exact missing evidence is named before any workspace patch.\n' > "$blocked_append_failure_todo"
set +e
PHASE_LOOP_STATE_DIR="$blocked_append_failure_state" \
PHASE_LOOP_PROMPT="$blocked_append_failure_prompt" \
PHASE_LOOP_TODO="$blocked_append_failure_todo" \
BROWNIE_BIN="$fake_brownie_terminal_no_eligible" \
PHASE_LOOP_WORKSPACE_ROOT="$blocked_append_failure_workspace" \
PHASE_LOOP_TERMINAL_FAILURE_RETRY_CAP=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 78 "$PHASE_LOOP" run-once >/dev/null
blocked_append_failure_exit="$?"
set -e
test "$blocked_append_failure_exit" = "78"
python3 - "$blocked_append_failure_state/status.json" "$blocked_append_failure_state/todo-claims" "$blocked_append_failure_workspace/.brownie/private/phase-loop/task-ledger.jsonl" <<'PY'
import json
import pathlib
import sys

status = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
claim_dir = pathlib.Path(sys.argv[2])
ledger = pathlib.Path(sys.argv[3]).read_text(encoding='utf-8')
archives = sorted(claim_dir.glob('stale-*.json'))
assert len(archives) == 1, archives
archive = json.loads(archives[0].read_text(encoding='utf-8'))
assert archive['archive_reason'] == 'terminal_failure_blocked_evidence_failed', archive
assert archive['retry_eligible'] is False, archive
assert not (claim_dir / 'current.json').exists()
assert (claim_dir / 'blocked.jsonl').is_dir()
assert 'terminal_failure_transaction' in ledger, ledger
claim_id = archive['claim_id']
ledger_records = [
    json.loads(line)
    for line in ledger.splitlines()
    if line.strip()
]
assert any(
    event.get('claim_id') == claim_id
    and event.get('to_state') == 'failed'
    and event.get('from_state') in ('claimed', 'running')
    and str(event.get('task_id', '')).endswith('@' + claim_id)
    for record in ledger_records
    for event in (record.get('events', []) if record.get('kind') == 'terminal_failure_transaction' else [record])
), ledger_records
assert status['status'] == 'blocked', status
assert status['exit_code'] == '78', status
assert 'blocked evidence append failed' in status['detail'], status
assert 'refusing to retry' in status['detail'], status
PY
set +e
PHASE_LOOP_STATE_DIR="$blocked_append_failure_state" \
PHASE_LOOP_PROMPT="$blocked_append_failure_prompt" \
PHASE_LOOP_TODO="$blocked_append_failure_todo" \
BROWNIE_BIN="$fake_brownie_terminal_no_eligible_counted" \
PHASE_LOOP_WORKSPACE_ROOT="$blocked_append_failure_workspace" \
PHASE_LOOP_TERMINAL_FAILURE_RETRY_CAP=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 65,75 "$PHASE_LOOP" run-once >/dev/null
blocked_append_failure_retry_exit="$?"
set -e
case "$blocked_append_failure_retry_exit" in
  65|75) ;;
  *) echo "unexpected blocked-append retry exit=$blocked_append_failure_retry_exit" >&2; exit 1 ;;
esac
test "$(cat "$blocked_append_failure_state/terminal-no-eligible-count" 2>/dev/null || printf '0')" = "0"
fi

if claim_smoke_section_enabled completion; then
# Completion must record the terminal ledger transition before mutating the
# live TODO queue. An unwritable ledger keeps both queue and claim retryable.
completion_ledger_failure_state="$(mktemp -d)"
completion_ledger_failure_workspace="$(mktemp -d)"
completion_ledger_failure_prompt="$(mktemp)"
completion_ledger_failure_todo="$(mktemp)"
git -C "$completion_ledger_failure_workspace" init -b main >/dev/null
git -C "$completion_ledger_failure_workspace" -c user.name=Brownie -c user.email=brownie@example.invalid commit --allow-empty -m init >/dev/null
mkdir -p "$completion_ledger_failure_workspace/.brownie/private/phase-loop/task-ledger.jsonl"
printf 'base prompt\n' > "$completion_ledger_failure_prompt"
printf -- '- [ ] E-completion-ledger-failure: Patch only `scripts/completion-ledger-failure.mjs`:\n  Route: implementation.\n  Verification: run `node --check scripts/completion-ledger-failure.mjs`.\n' > "$completion_ledger_failure_todo"
set +e
PHASE_LOOP_STATE_DIR="$completion_ledger_failure_state" \
PHASE_LOOP_PROMPT="$completion_ledger_failure_prompt" \
PHASE_LOOP_TODO="$completion_ledger_failure_todo" \
BROWNIE_BIN="$fake_brownie_completed" \
PHASE_LOOP_WORKSPACE_ROOT="$completion_ledger_failure_workspace" \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 78 "$PHASE_LOOP" run-once >/dev/null
completion_ledger_failure_exit="$?"
set -e
test "$completion_ledger_failure_exit" = "78"
python3 - "$completion_ledger_failure_state/status.json" "$completion_ledger_failure_state/todo-claims/current.json" "$completion_ledger_failure_todo" "$completion_ledger_failure_workspace/.brownie/private/phase-loop/task-ledger.jsonl" <<'PY'
import json
import pathlib
import sys

status = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
claim = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding='utf-8'))
todo = pathlib.Path(sys.argv[3]).read_text(encoding='utf-8')
ledger_path = pathlib.Path(sys.argv[4])
assert status['status'] == 'blocked', status
assert status['exit_code'] == '78', status
assert 'terminal ledger transition failed' in status['detail'], status
assert claim['status'] == 'in_progress', claim
assert '- [ ] E-completion-ledger-failure:' in todo, todo
assert ledger_path.is_dir(), ledger_path
PY

# A completion ledger record does not authorize reverting the claim to
# in_progress when queue cleanup fails. Preserve the completed claim and make
# cleanup the only retryable operation on the next controller invocation.
completion_removal_failure_state="$(mktemp -d)"
completion_removal_failure_workspace="$(mktemp -d)"
completion_removal_failure_prompt="$(mktemp)"
completion_removal_failure_todo="$(mktemp)"
git -C "$completion_removal_failure_workspace" init -b main >/dev/null
git -C "$completion_removal_failure_workspace" -c user.name=Brownie -c user.email=brownie@example.invalid commit --allow-empty -m init >/dev/null
printf 'base prompt\n' > "$completion_removal_failure_prompt"
printf -- '- [ ] E-completion-removal-failure: Patch only `scripts/completion-removal-failure.mjs`:\n  Route: implementation.\n  Verification: run `node --check scripts/completion-removal-failure.mjs`.\n' > "$completion_removal_failure_todo"
completion_removal_failure_runtime_count="$completion_removal_failure_state/runtime-count"
completion_removal_failure_brownie="$(mktemp)"
cat > "$completion_removal_failure_brownie" <<SH
#!/usr/bin/env bash
set -eu
printf 'runtime-invoked\n' >> "$completion_removal_failure_runtime_count"
exit 99
SH
chmod +x "$completion_removal_failure_brownie"
set +e
PHASE_LOOP_STATE_DIR="$completion_removal_failure_state" \
PHASE_LOOP_PROMPT="$completion_removal_failure_prompt" \
PHASE_LOOP_TODO="$completion_removal_failure_todo" \
BROWNIE_BIN="$fake_brownie_completed" \
PHASE_LOOP_WORKSPACE_ROOT="$completion_removal_failure_workspace" \
PHASE_LOOP_TEST_FAIL_COMPLETED_TODO_REMOVAL=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 78 "$PHASE_LOOP" run-once >/dev/null
completion_removal_failure_exit="$?"
set -e
test "$completion_removal_failure_exit" = "78"
python3 - "$completion_removal_failure_state/status.json" "$completion_removal_failure_state/todo-claims/current.json" "$completion_removal_failure_todo" <<'PY'
import json
import pathlib
import sys

status = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
claim = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding='utf-8'))
todo = pathlib.Path(sys.argv[3]).read_text(encoding='utf-8')
assert status['status'] == 'blocked', status
assert status['exit_code'] == '78', status
assert claim['status'] == 'completed', claim
assert claim['completion_cleanup_pending'] is True, claim
assert '- [ ] E-completion-removal-failure:' in todo, todo
PY

set +e
PHASE_LOOP_STATE_DIR="$completion_removal_failure_state" \
PHASE_LOOP_PROMPT="$completion_removal_failure_prompt" \
PHASE_LOOP_TODO="$completion_removal_failure_todo" \
BROWNIE_BIN="$completion_removal_failure_brownie" \
PHASE_LOOP_WORKSPACE_ROOT="$completion_removal_failure_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 75 "$PHASE_LOOP" run-once >/dev/null
completion_removal_cleanup_exit="$?"
set -e
test "$completion_removal_cleanup_exit" = "75"
python3 - "$completion_removal_failure_state/status.json" "$completion_removal_failure_state/todo-claims/current.json" "$completion_removal_failure_todo" <<'PY'
import json
import pathlib
import sys

status = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
claim = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding='utf-8'))
todo = pathlib.Path(sys.argv[3]).read_text(encoding='utf-8')
assert status['status'] == 'stopped', status
assert claim['status'] == 'completed', claim
assert claim['completion_cleanup_pending'] is False, claim
assert '- [ ] E-completion-removal-failure:' not in todo, todo
PY

# If completion cleanup is deferred after Runtime changed tracked workspace
# files, retain a durable PR-publication obligation. A cleanup-only retry must
# publish that already-created completion exactly once and must not invoke
# Runtime again.
completion_pr_cleanup_retry_state="$(mktemp -d)"
completion_pr_cleanup_retry_prompt="$(mktemp)"
completion_pr_cleanup_retry_todo="$(mktemp)"
completion_pr_cleanup_retry_workspace="$(mktemp -d)"
completion_pr_cleanup_retry_remote="$(mktemp -d)"
completion_pr_cleanup_retry_bin="$(mktemp -d)"
completion_pr_cleanup_retry_count="$completion_pr_cleanup_retry_state/pr-create-count"
completion_pr_cleanup_retry_runtime_count="$completion_pr_cleanup_retry_state/runtime-count"
git -C "$completion_pr_cleanup_retry_workspace" init -b main >/dev/null
mkdir -p "$completion_pr_cleanup_retry_workspace/scripts"
cp "$REPO_ROOT/scripts/phase-loop-pr-actor-guard.mjs" "$completion_pr_cleanup_retry_workspace/scripts/phase-loop-pr-actor-guard.mjs"
printf 'base\n' > "$completion_pr_cleanup_retry_workspace/README.md"
git -C "$completion_pr_cleanup_retry_workspace" add .
git -C "$completion_pr_cleanup_retry_workspace" -c user.name=Brownie -c user.email=brownie@example.invalid commit -m init >/dev/null
git -C "$completion_pr_cleanup_retry_remote" init --bare >/dev/null
git -C "$completion_pr_cleanup_retry_workspace" remote add origin "$completion_pr_cleanup_retry_remote"
git -C "$completion_pr_cleanup_retry_workspace" push -u origin main >/dev/null
git -C "$completion_pr_cleanup_retry_workspace" switch -c brownie-agent/smoke-completion-cleanup-pr >/dev/null
printf 'base prompt\n' > "$completion_pr_cleanup_retry_prompt"
printf -- '- [ ] E-completion-cleanup-pr: Patch only `README.md`:\n  Route: implementation.\n  Verification: run `node --check scripts/phase-loop-pr-actor-guard.mjs`.\n' > "$completion_pr_cleanup_retry_todo"
cat > "$completion_pr_cleanup_retry_bin/pnpm" <<'SH'
#!/usr/bin/env bash
exit 0
SH
chmod +x "$completion_pr_cleanup_retry_bin/pnpm"
cat > "$completion_pr_cleanup_retry_bin/gh" <<'SH'
#!/usr/bin/env bash
set -eu
case "${1:-} ${2:-}" in
  "api user")
    printf 'brownie-agent\n'
    ;;
  "auth token")
    printf 'fake-token\n'
    ;;
  "pr view")
    exit 1
    ;;
  "pr create")
    printf '1\n' >> "${FAKE_GH_PR_CREATE_COUNT:?}"
    printf 'https://github.com/globalpocket/brownie/pull/10001\n'
    ;;
  *)
    exit 0
    ;;
esac
SH
chmod +x "$completion_pr_cleanup_retry_bin/gh"
completion_pr_cleanup_retry_brownie="$(mktemp)"
cat > "$completion_pr_cleanup_retry_brownie" <<SH
#!/usr/bin/env bash
set -eu
printf 'runtime-invoked\n' >> "$completion_pr_cleanup_retry_runtime_count"
exit 99
SH
chmod +x "$completion_pr_cleanup_retry_brownie"
set +e
PATH="$completion_pr_cleanup_retry_bin:$PATH" \
FAKE_GH_PR_CREATE_COUNT="$completion_pr_cleanup_retry_count" \
PHASE_LOOP_STATE_DIR="$completion_pr_cleanup_retry_state" \
PHASE_LOOP_PROMPT="$completion_pr_cleanup_retry_prompt" \
PHASE_LOOP_TODO="$completion_pr_cleanup_retry_todo" \
BROWNIE_BIN="$fake_brownie_completed_tracked_workspace_change" \
PHASE_LOOP_WORKSPACE_ROOT="$completion_pr_cleanup_retry_workspace" \
PHASE_LOOP_CREATE_PR_AFTER_PROGRESS=1 \
PHASE_LOOP_TEST_FAIL_COMPLETED_TODO_REMOVAL=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 78 "$PHASE_LOOP" run-once >/dev/null
completion_pr_cleanup_retry_first_exit="$?"
set -e
test "$completion_pr_cleanup_retry_first_exit" = "78"
python3 - "$completion_pr_cleanup_retry_state/todo-claims/current.json" "$completion_pr_cleanup_retry_todo" <<'PY'
import json
import pathlib
import sys

claim = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
todo = pathlib.Path(sys.argv[2]).read_text(encoding='utf-8')
assert claim['status'] == 'completed', claim
assert claim['completion_cleanup_pending'] is True, claim
assert claim['completion_pr_pending'] is True, claim
assert claim['completion_pr_workspace_before'] != claim['completion_pr_workspace_after'], claim
assert '- [ ] E-completion-cleanup-pr:' in todo, todo
PY
test ! -e "$completion_pr_cleanup_retry_count"
set +e
PATH="$completion_pr_cleanup_retry_bin:$PATH" \
FAKE_GH_PR_CREATE_COUNT="$completion_pr_cleanup_retry_count" \
PHASE_LOOP_STATE_DIR="$completion_pr_cleanup_retry_state" \
PHASE_LOOP_PROMPT="$completion_pr_cleanup_retry_prompt" \
PHASE_LOOP_TODO="$completion_pr_cleanup_retry_todo" \
BROWNIE_BIN="$completion_pr_cleanup_retry_brownie" \
PHASE_LOOP_WORKSPACE_ROOT="$completion_pr_cleanup_retry_workspace" \
PHASE_LOOP_CREATE_PR_AFTER_PROGRESS=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null
completion_pr_cleanup_retry_second_exit="$?"
set -e
test "$completion_pr_cleanup_retry_second_exit" = "0"
python3 - "$completion_pr_cleanup_retry_state/status.json" "$completion_pr_cleanup_retry_state/todo-claims/current.json" "$completion_pr_cleanup_retry_todo" "$completion_pr_cleanup_retry_workspace" "$completion_pr_cleanup_retry_count" "$completion_pr_cleanup_retry_runtime_count" <<'PY'
import json
import pathlib
import subprocess
import sys

status = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
claim = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding='utf-8'))
todo = pathlib.Path(sys.argv[3]).read_text(encoding='utf-8')
workspace = sys.argv[4]
pr_count = pathlib.Path(sys.argv[5])
runtime_count = pathlib.Path(sys.argv[6])
assert status['status'] == 'pr_created', status
assert 'pull/10001' in status['detail'], status
assert claim['status'] == 'completed', claim
assert claim['completion_cleanup_pending'] is False, claim
assert claim['completion_pr_pending'] is False, claim
assert any(item.get('note') == 'completion_pr_published' for item in claim['status_history']), claim
assert '- [ ] E-completion-cleanup-pr:' not in todo, todo
assert pr_count.read_text(encoding='utf-8').splitlines() == ['1'], pr_count
assert not runtime_count.exists(), runtime_count
head = subprocess.check_output(['git', '-C', workspace, 'rev-parse', 'HEAD'], text=True).strip()
remote = subprocess.check_output(['git', '-C', workspace, 'rev-parse', 'origin/brownie-agent/smoke-completion-cleanup-pr'], text=True).strip()
assert head == remote, (head, remote)
supervisor = pathlib.Path(pathlib.Path(sys.argv[1]).parent / 'logs' / 'supervisor.log').read_text(encoding='utf-8')
assert 'completed_todo_pr_publish_retry_succeeded=true' in supervisor, supervisor
PY

# A normal completion whose PR publication fails after queue completion must
# retain a durable pending-publish marker. The next invocation publishes the
# same completion without invoking Runtime or selecting another TODO.
completion_pr_publish_failure_state="$(mktemp -d)"
completion_pr_publish_failure_prompt="$(mktemp)"
completion_pr_publish_failure_todo="$(mktemp)"
completion_pr_publish_failure_workspace="$(mktemp -d)"
completion_pr_publish_failure_remote="$(mktemp -d)"
completion_pr_publish_failure_bin="$(mktemp -d)"
completion_pr_publish_failure_count="$completion_pr_publish_failure_state/pr-create-attempts"
completion_pr_publish_failure_runtime_count="$completion_pr_publish_failure_state/runtime-count"
git -C "$completion_pr_publish_failure_workspace" init -b main >/dev/null
mkdir -p "$completion_pr_publish_failure_workspace/scripts"
cp "$REPO_ROOT/scripts/phase-loop-pr-actor-guard.mjs" "$completion_pr_publish_failure_workspace/scripts/phase-loop-pr-actor-guard.mjs"
printf 'base\n' > "$completion_pr_publish_failure_workspace/README.md"
git -C "$completion_pr_publish_failure_workspace" add .
git -C "$completion_pr_publish_failure_workspace" -c user.name=Brownie -c user.email=brownie@example.invalid commit -m init >/dev/null
git -C "$completion_pr_publish_failure_remote" init --bare >/dev/null
git -C "$completion_pr_publish_failure_workspace" remote add origin "$completion_pr_publish_failure_remote"
git -C "$completion_pr_publish_failure_workspace" push -u origin main >/dev/null
git -C "$completion_pr_publish_failure_workspace" switch -c brownie-agent/smoke-completion-pr-retry >/dev/null
printf 'base prompt\n' > "$completion_pr_publish_failure_prompt"
printf -- '- [ ] E-completion-pr-retry: Patch only `README.md`:\n  Route: implementation.\n  Verification: run `node --check scripts/phase-loop-pr-actor-guard.mjs`.\n' > "$completion_pr_publish_failure_todo"
cat > "$completion_pr_publish_failure_bin/pnpm" <<'SH'
#!/usr/bin/env bash
exit 0
SH
chmod +x "$completion_pr_publish_failure_bin/pnpm"
cat > "$completion_pr_publish_failure_bin/gh" <<'SH'
#!/usr/bin/env bash
set -eu
case "${1:-} ${2:-}" in
  "api user")
    printf 'brownie-agent\n'
    ;;
  "auth token")
    printf 'fake-token\n'
    ;;
  "pr view")
    exit 1
    ;;
  "pr create")
    attempts=0
    if [ -f "${FAKE_GH_PR_CREATE_ATTEMPTS:?}" ]; then
      attempts="$(wc -l < "${FAKE_GH_PR_CREATE_ATTEMPTS}")"
    fi
    printf 'attempt\n' >> "${FAKE_GH_PR_CREATE_ATTEMPTS}"
    if [ "$attempts" -eq 0 ]; then
      exit 1
    fi
    printf 'https://github.com/globalpocket/brownie/pull/10002\n'
    ;;
  *)
    exit 0
    ;;
esac
SH
chmod +x "$completion_pr_publish_failure_bin/gh"
completion_pr_publish_failure_brownie="$(mktemp)"
cat > "$completion_pr_publish_failure_brownie" <<SH
#!/usr/bin/env bash
set -eu
printf 'runtime-invoked\n' >> "$completion_pr_publish_failure_runtime_count"
exit 99
SH
chmod +x "$completion_pr_publish_failure_brownie"
set +e
PATH="$completion_pr_publish_failure_bin:$PATH" \
FAKE_GH_PR_CREATE_ATTEMPTS="$completion_pr_publish_failure_count" \
PHASE_LOOP_STATE_DIR="$completion_pr_publish_failure_state" \
PHASE_LOOP_PROMPT="$completion_pr_publish_failure_prompt" \
PHASE_LOOP_TODO="$completion_pr_publish_failure_todo" \
BROWNIE_BIN="$fake_brownie_completed_tracked_workspace_change" \
PHASE_LOOP_WORKSPACE_ROOT="$completion_pr_publish_failure_workspace" \
PHASE_LOOP_CREATE_PR_AFTER_PROGRESS=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null
completion_pr_publish_failure_first_exit="$?"
set -e
test "$completion_pr_publish_failure_first_exit" = "78"
python3 - "$completion_pr_publish_failure_state/status.json" "$completion_pr_publish_failure_state/todo-claims/current.json" "$completion_pr_publish_failure_todo" "$completion_pr_publish_failure_count" "$completion_pr_publish_failure_runtime_count" <<'PY'
import json
import pathlib
import sys

status = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
claim = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding='utf-8'))
todo = pathlib.Path(sys.argv[3]).read_text(encoding='utf-8')
attempts = pathlib.Path(sys.argv[4])
runtime_count = pathlib.Path(sys.argv[5])
assert status['status'] == 'blocked', status
assert status['exit_code'] == '78', status
assert claim['status'] == 'completed', claim
assert claim['completion_pr_pending'] is True, claim
assert any(item.get('note') == 'completion_pr_publish_pending' for item in claim['status_history']), claim
assert '- [ ] E-completion-pr-retry:' not in todo, todo
assert attempts.read_text(encoding='utf-8').splitlines() == ['attempt'], attempts
assert not runtime_count.exists(), runtime_count
PY
set +e
PATH="$completion_pr_publish_failure_bin:$PATH" \
FAKE_GH_PR_CREATE_ATTEMPTS="$completion_pr_publish_failure_count" \
PHASE_LOOP_STATE_DIR="$completion_pr_publish_failure_state" \
PHASE_LOOP_PROMPT="$completion_pr_publish_failure_prompt" \
PHASE_LOOP_TODO="$completion_pr_publish_failure_todo" \
BROWNIE_BIN="$completion_pr_publish_failure_brownie" \
PHASE_LOOP_WORKSPACE_ROOT="$completion_pr_publish_failure_workspace" \
PHASE_LOOP_CREATE_PR_AFTER_PROGRESS=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null
completion_pr_publish_failure_second_exit="$?"
set -e
test "$completion_pr_publish_failure_second_exit" = "0"
python3 - "$completion_pr_publish_failure_state/status.json" "$completion_pr_publish_failure_state/todo-claims/current.json" "$completion_pr_publish_failure_count" "$completion_pr_publish_failure_runtime_count" "$completion_pr_publish_failure_workspace" <<'PY'
import json
import pathlib
import subprocess
import sys

status = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
claim = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding='utf-8'))
attempts = pathlib.Path(sys.argv[3])
runtime_count = pathlib.Path(sys.argv[4])
workspace = sys.argv[5]
assert status['status'] == 'pr_created', status
assert 'pull/10002' in status['detail'], status
assert claim['status'] == 'completed', claim
assert claim['completion_pr_pending'] is False, claim
assert attempts.read_text(encoding='utf-8').splitlines() == ['attempt', 'attempt'], attempts
assert not runtime_count.exists(), runtime_count
head = subprocess.check_output(['git', '-C', workspace, 'rev-parse', 'HEAD'], text=True).strip()
remote = subprocess.check_output(['git', '-C', workspace, 'rev-parse', 'origin/brownie-agent/smoke-completion-pr-retry'], text=True).strip()
assert head == remote, (head, remote)
PY

# Repeated cleanup failure must reassert cleanup_pending without clearing an
# already durable completion_pr_pending marker or any of its workspace/log
# metadata. The third run must complete cleanup and publish that same PR.
completion_pr_marker_preservation_state="$(mktemp -d)"
completion_pr_marker_preservation_prompt="$(mktemp)"
completion_pr_marker_preservation_todo="$(mktemp)"
completion_pr_marker_preservation_workspace="$(mktemp -d)"
completion_pr_marker_preservation_remote="$(mktemp -d)"
completion_pr_marker_preservation_bin="$(mktemp -d)"
completion_pr_marker_preservation_count="$completion_pr_marker_preservation_state/pr-create-count"
completion_pr_marker_preservation_runtime_count="$completion_pr_marker_preservation_state/runtime-count"
git -C "$completion_pr_marker_preservation_workspace" init -b main >/dev/null
mkdir -p "$completion_pr_marker_preservation_workspace/scripts"
cp "$REPO_ROOT/scripts/phase-loop-pr-actor-guard.mjs" "$completion_pr_marker_preservation_workspace/scripts/phase-loop-pr-actor-guard.mjs"
printf 'base\n' > "$completion_pr_marker_preservation_workspace/README.md"
git -C "$completion_pr_marker_preservation_workspace" add .
git -C "$completion_pr_marker_preservation_workspace" -c user.name=Brownie -c user.email=brownie@example.invalid commit -m init >/dev/null
git -C "$completion_pr_marker_preservation_remote" init --bare >/dev/null
git -C "$completion_pr_marker_preservation_workspace" remote add origin "$completion_pr_marker_preservation_remote"
git -C "$completion_pr_marker_preservation_workspace" push -u origin main >/dev/null
git -C "$completion_pr_marker_preservation_workspace" switch -c brownie-agent/smoke-completion-pr-marker-preservation >/dev/null
printf 'base prompt\n' > "$completion_pr_marker_preservation_prompt"
printf -- '- [ ] E-completion-pr-marker-preservation: Patch only `README.md`:\n  Route: implementation.\n  Verification: run `node --check scripts/phase-loop-pr-actor-guard.mjs`.\n' > "$completion_pr_marker_preservation_todo"
cat > "$completion_pr_marker_preservation_bin/pnpm" <<'SH'
#!/usr/bin/env bash
exit 0
SH
chmod +x "$completion_pr_marker_preservation_bin/pnpm"
cat > "$completion_pr_marker_preservation_bin/gh" <<'SH'
#!/usr/bin/env bash
set -eu
case "${1:-} ${2:-}" in
  "api user") printf 'brownie-agent\n' ;;
  "auth token") printf 'fake-token\n' ;;
  "pr view") exit 1 ;;
  "pr create")
    printf '1\n' >> "${FAKE_GH_PR_CREATE_COUNT:?}"
    printf 'https://github.com/globalpocket/brownie/pull/10003\n'
    ;;
  *) exit 0 ;;
esac
SH
chmod +x "$completion_pr_marker_preservation_bin/gh"
completion_pr_marker_preservation_brownie="$(mktemp)"
cat > "$completion_pr_marker_preservation_brownie" <<SH
#!/usr/bin/env bash
set -eu
printf 'runtime-invoked\n' >> "$completion_pr_marker_preservation_runtime_count"
exec "$fake_brownie_completed_tracked_workspace_change" "\$@"
SH
chmod +x "$completion_pr_marker_preservation_brownie"
set +e
PATH="$completion_pr_marker_preservation_bin:$PATH" \
FAKE_GH_PR_CREATE_COUNT="$completion_pr_marker_preservation_count" \
PHASE_LOOP_STATE_DIR="$completion_pr_marker_preservation_state" \
PHASE_LOOP_PROMPT="$completion_pr_marker_preservation_prompt" \
PHASE_LOOP_TODO="$completion_pr_marker_preservation_todo" \
BROWNIE_BIN="$completion_pr_marker_preservation_brownie" \
PHASE_LOOP_WORKSPACE_ROOT="$completion_pr_marker_preservation_workspace" \
PHASE_LOOP_CREATE_PR_AFTER_PROGRESS=1 \
PHASE_LOOP_TEST_FAIL_COMPLETED_TODO_REMOVAL=1 \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 78 "$PHASE_LOOP" run-once >/dev/null
completion_pr_marker_preservation_first_exit="$?"
set -e
test "$completion_pr_marker_preservation_first_exit" = "78"
python3 - "$completion_pr_marker_preservation_state/todo-claims/current.json" <<'PY'
import json
import pathlib
import sys
claim = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
assert claim['completion_cleanup_pending'] is True, claim
assert claim['completion_pr_pending'] is True, claim
assert claim['completion_pr_workspace_before'], claim
assert claim['completion_pr_workspace_after'], claim
assert claim['completion_pr_stdout_log'], claim
assert claim['completion_pr_stderr_log'], claim
PY
set +e
PATH="$completion_pr_marker_preservation_bin:$PATH" \
FAKE_GH_PR_CREATE_COUNT="$completion_pr_marker_preservation_count" \
PHASE_LOOP_STATE_DIR="$completion_pr_marker_preservation_state" \
PHASE_LOOP_PROMPT="$completion_pr_marker_preservation_prompt" \
PHASE_LOOP_TODO="$completion_pr_marker_preservation_todo" \
BROWNIE_BIN="$completion_pr_marker_preservation_brownie" \
PHASE_LOOP_WORKSPACE_ROOT="$completion_pr_marker_preservation_workspace" \
PHASE_LOOP_CREATE_PR_AFTER_PROGRESS=1 \
PHASE_LOOP_TEST_FAIL_COMPLETED_TODO_REMOVAL=1 \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 78 "$PHASE_LOOP" run-once >/dev/null
completion_pr_marker_preservation_second_exit="$?"
set -e
test "$completion_pr_marker_preservation_second_exit" = "78"
python3 - "$completion_pr_marker_preservation_state/todo-claims/current.json" "$completion_pr_marker_preservation_state/status.json" "$completion_pr_marker_preservation_runtime_count" "$completion_pr_marker_preservation_count" <<'PY'
import json
import pathlib
import sys
claim = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
status = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding='utf-8'))
runtime_count = pathlib.Path(sys.argv[3])
pr_count = pathlib.Path(sys.argv[4])
assert status['status'] == 'blocked', status
assert claim['completion_cleanup_pending'] is True, claim
assert claim['completion_pr_pending'] is True, claim
assert claim['completion_pr_workspace_before'], claim
assert claim['completion_pr_workspace_after'], claim
assert claim['completion_pr_stdout_log'], claim
assert claim['completion_pr_stderr_log'], claim
assert runtime_count.read_text(encoding='utf-8').splitlines() == ['runtime-invoked'], runtime_count
assert not pr_count.exists(), pr_count
PY
test ! -e "$completion_pr_marker_preservation_state/stop"
set +e
PATH="$completion_pr_marker_preservation_bin:$PATH" \
FAKE_GH_PR_CREATE_COUNT="$completion_pr_marker_preservation_count" \
PHASE_LOOP_STATE_DIR="$completion_pr_marker_preservation_state" \
PHASE_LOOP_PROMPT="$completion_pr_marker_preservation_prompt" \
PHASE_LOOP_TODO="$completion_pr_marker_preservation_todo" \
BROWNIE_BIN="$completion_pr_marker_preservation_brownie" \
PHASE_LOOP_WORKSPACE_ROOT="$completion_pr_marker_preservation_workspace" \
PHASE_LOOP_CREATE_PR_AFTER_PROGRESS=1 \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null
completion_pr_marker_preservation_third_exit="$?"
set -e
test "$completion_pr_marker_preservation_third_exit" = "0"
python3 - "$completion_pr_marker_preservation_state/status.json" "$completion_pr_marker_preservation_state/todo-claims/current.json" "$completion_pr_marker_preservation_todo" "$completion_pr_marker_preservation_count" "$completion_pr_marker_preservation_runtime_count" <<'PY'
import json
import pathlib
import sys
status = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
claim = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding='utf-8'))
todo = pathlib.Path(sys.argv[3]).read_text(encoding='utf-8')
assert status['status'] == 'pr_created', status
assert claim['completion_cleanup_pending'] is False, claim
assert claim['completion_pr_pending'] is False, claim
assert '- [ ] E-completion-pr-marker-preservation:' not in todo, todo
assert pathlib.Path(sys.argv[4]).read_text(encoding='utf-8').splitlines() == ['1'], pathlib.Path(sys.argv[4]).read_text()
assert pathlib.Path(sys.argv[5]).read_text(encoding='utf-8').splitlines() == ['runtime-invoked'], pathlib.Path(sys.argv[5]).read_text()
PY
test ! -e "$completion_pr_marker_preservation_state/stop"

# If cleanup removes the final TODO and the process is interrupted before
# clearing cleanup_pending, the next run must recover the marker before the
# empty-queue stop gate and publish without Runtime or a stop file.
completion_cleanup_interrupt_state="$(mktemp -d)"
completion_cleanup_interrupt_prompt="$(mktemp)"
completion_cleanup_interrupt_todo="$(mktemp)"
completion_cleanup_interrupt_workspace="$(mktemp -d)"
completion_cleanup_interrupt_remote="$(mktemp -d)"
completion_cleanup_interrupt_bin="$(mktemp -d)"
completion_cleanup_interrupt_count="$completion_cleanup_interrupt_state/pr-create-count"
completion_cleanup_interrupt_runtime_count="$completion_cleanup_interrupt_state/runtime-count"
git -C "$completion_cleanup_interrupt_workspace" init -b main >/dev/null
mkdir -p "$completion_cleanup_interrupt_workspace/scripts"
cp "$REPO_ROOT/scripts/phase-loop-pr-actor-guard.mjs" "$completion_cleanup_interrupt_workspace/scripts/phase-loop-pr-actor-guard.mjs"
printf 'base\n' > "$completion_cleanup_interrupt_workspace/README.md"
git -C "$completion_cleanup_interrupt_workspace" add .
git -C "$completion_cleanup_interrupt_workspace" -c user.name=Brownie -c user.email=brownie@example.invalid commit -m init >/dev/null
git -C "$completion_cleanup_interrupt_remote" init --bare >/dev/null
git -C "$completion_cleanup_interrupt_workspace" remote add origin "$completion_cleanup_interrupt_remote"
git -C "$completion_cleanup_interrupt_workspace" push -u origin main >/dev/null
git -C "$completion_cleanup_interrupt_workspace" switch -c brownie-agent/smoke-completion-cleanup-interrupt >/dev/null
printf 'base prompt\n' > "$completion_cleanup_interrupt_prompt"
printf -- '- [ ] E-completion-cleanup-interrupt: Patch only `README.md`:\n  Route: implementation.\n  Verification: run `node --check scripts/phase-loop-pr-actor-guard.mjs`.\n' > "$completion_cleanup_interrupt_todo"
cat > "$completion_cleanup_interrupt_bin/pnpm" <<'SH'
#!/usr/bin/env bash
exit 0
SH
chmod +x "$completion_cleanup_interrupt_bin/pnpm"
cat > "$completion_cleanup_interrupt_bin/gh" <<'SH'
#!/usr/bin/env bash
set -eu
case "${1:-} ${2:-}" in
  "api user") printf 'brownie-agent\n' ;;
  "auth token") printf 'fake-token\n' ;;
  "pr view") exit 1 ;;
  "pr create")
    printf '1\n' >> "${FAKE_GH_PR_CREATE_COUNT:?}"
    printf 'https://github.com/globalpocket/brownie/pull/10004\n'
    ;;
  *) exit 0 ;;
esac
SH
chmod +x "$completion_cleanup_interrupt_bin/gh"
completion_cleanup_interrupt_brownie="$(mktemp)"
cat > "$completion_cleanup_interrupt_brownie" <<SH
#!/usr/bin/env bash
set -eu
printf 'runtime-invoked\n' >> "$completion_cleanup_interrupt_runtime_count"
exec "$fake_brownie_completed_tracked_workspace_change" "\$@"
SH
chmod +x "$completion_cleanup_interrupt_brownie"
set +e
PATH="$completion_cleanup_interrupt_bin:$PATH" \
FAKE_GH_PR_CREATE_COUNT="$completion_cleanup_interrupt_count" \
PHASE_LOOP_STATE_DIR="$completion_cleanup_interrupt_state" \
PHASE_LOOP_PROMPT="$completion_cleanup_interrupt_prompt" \
PHASE_LOOP_TODO="$completion_cleanup_interrupt_todo" \
BROWNIE_BIN="$completion_cleanup_interrupt_brownie" \
PHASE_LOOP_WORKSPACE_ROOT="$completion_cleanup_interrupt_workspace" \
PHASE_LOOP_CREATE_PR_AFTER_PROGRESS=1 \
PHASE_LOOP_TEST_FAIL_COMPLETED_TODO_REMOVAL=1 \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 78 "$PHASE_LOOP" run-once >/dev/null
completion_cleanup_interrupt_first_exit="$?"
set -e
test "$completion_cleanup_interrupt_first_exit" = "78"
set +e
PATH="$completion_cleanup_interrupt_bin:$PATH" \
FAKE_GH_PR_CREATE_COUNT="$completion_cleanup_interrupt_count" \
PHASE_LOOP_STATE_DIR="$completion_cleanup_interrupt_state" \
PHASE_LOOP_PROMPT="$completion_cleanup_interrupt_prompt" \
PHASE_LOOP_TODO="$completion_cleanup_interrupt_todo" \
BROWNIE_BIN="$completion_cleanup_interrupt_brownie" \
PHASE_LOOP_WORKSPACE_ROOT="$completion_cleanup_interrupt_workspace" \
PHASE_LOOP_CREATE_PR_AFTER_PROGRESS=1 \
PHASE_LOOP_TEST_INTERRUPT_AFTER_COMPLETED_TODO_REMOVAL=1 \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 78 "$PHASE_LOOP" run-once >/dev/null
completion_cleanup_interrupt_second_exit="$?"
set -e
test "$completion_cleanup_interrupt_second_exit" = "78"
python3 - "$completion_cleanup_interrupt_state/todo-claims/current.json" "$completion_cleanup_interrupt_todo" "$completion_cleanup_interrupt_runtime_count" "$completion_cleanup_interrupt_count" <<'PY'
import json
import pathlib
import sys
claim = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
todo = pathlib.Path(sys.argv[2]).read_text(encoding='utf-8')
assert claim['completion_cleanup_pending'] is True, claim
assert claim['completion_pr_pending'] is True, claim
assert '- [ ] E-completion-cleanup-interrupt:' not in todo, todo
assert pathlib.Path(sys.argv[3]).read_text(encoding='utf-8').splitlines() == ['runtime-invoked'], pathlib.Path(sys.argv[3]).read_text()
assert not pathlib.Path(sys.argv[4]).exists(), pathlib.Path(sys.argv[4])
PY
test ! -e "$completion_cleanup_interrupt_state/stop"
set +e
PATH="$completion_cleanup_interrupt_bin:$PATH" \
FAKE_GH_PR_CREATE_COUNT="$completion_cleanup_interrupt_count" \
PHASE_LOOP_STATE_DIR="$completion_cleanup_interrupt_state" \
PHASE_LOOP_PROMPT="$completion_cleanup_interrupt_prompt" \
PHASE_LOOP_TODO="$completion_cleanup_interrupt_todo" \
BROWNIE_BIN="$completion_cleanup_interrupt_brownie" \
PHASE_LOOP_WORKSPACE_ROOT="$completion_cleanup_interrupt_workspace" \
PHASE_LOOP_CREATE_PR_AFTER_PROGRESS=1 \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null
completion_cleanup_interrupt_third_exit="$?"
set -e
test "$completion_cleanup_interrupt_third_exit" = "0"
python3 - "$completion_cleanup_interrupt_state/status.json" "$completion_cleanup_interrupt_state/todo-claims/current.json" "$completion_cleanup_interrupt_todo" "$completion_cleanup_interrupt_count" "$completion_cleanup_interrupt_runtime_count" <<'PY'
import json
import pathlib
import sys
status = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
claim = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding='utf-8'))
todo = pathlib.Path(sys.argv[3]).read_text(encoding='utf-8')
assert status['status'] == 'pr_created', status
assert claim['completion_cleanup_pending'] is False, claim
assert claim['completion_pr_pending'] is False, claim
assert '- [ ] E-completion-cleanup-interrupt:' not in todo, todo
assert pathlib.Path(sys.argv[4]).read_text(encoding='utf-8').splitlines() == ['1'], pathlib.Path(sys.argv[4]).read_text()
assert pathlib.Path(sys.argv[5]).read_text(encoding='utf-8').splitlines() == ['runtime-invoked'], pathlib.Path(sys.argv[5]).read_text()
PY
test ! -e "$completion_cleanup_interrupt_state/stop"

# If recovery and blocked evidence are durable but the final source todo.failed
# transition fails, retain the source claim and close that transition on the
# next run without invoking Runtime a second time.
terminal_source_transition_pending_state="$(mktemp -d)"
terminal_source_transition_pending_prompt="$(mktemp)"
terminal_source_transition_pending_todo="$(mktemp)"
terminal_source_transition_pending_workspace="$(mktemp -d)"
terminal_source_transition_pending_runtime_count="$terminal_source_transition_pending_state/runtime-count"
git -C "$terminal_source_transition_pending_workspace" init -b main >/dev/null
git -C "$terminal_source_transition_pending_workspace" -c user.name=Brownie -c user.email=brownie@example.invalid commit --allow-empty -m init >/dev/null
printf 'base prompt\n' > "$terminal_source_transition_pending_prompt"
printf -- '- [ ] E-final-source-transition-pending: Patch only `scripts/provider-target.mjs`:\n  Route: implementation.\n  Completion condition: provider terminal failure is durably blocked.\n  Verification: run `node --check scripts/provider-target.mjs`.\n' > "$terminal_source_transition_pending_todo"
terminal_source_transition_pending_brownie="$(mktemp)"
cat > "$terminal_source_transition_pending_brownie" <<SH
#!/usr/bin/env bash
set -eu
printf 'runtime-invoked\n' >> "$terminal_source_transition_pending_runtime_count"
exec "$fake_brownie_terminal_no_eligible" "\$@"
SH
chmod +x "$terminal_source_transition_pending_brownie"
set +e
PHASE_LOOP_STATE_DIR="$terminal_source_transition_pending_state" \
PHASE_LOOP_PROMPT="$terminal_source_transition_pending_prompt" \
PHASE_LOOP_TODO="$terminal_source_transition_pending_todo" \
BROWNIE_BIN="$terminal_source_transition_pending_brownie" \
PHASE_LOOP_WORKSPACE_ROOT="$terminal_source_transition_pending_workspace" \
PHASE_LOOP_TERMINAL_FAILURE_RETRY_CAP=0 \
PHASE_LOOP_TEST_FAIL_FINAL_SOURCE_TODO_FAILED_LEDGER=1 \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 78 "$PHASE_LOOP" run-once >/dev/null
terminal_source_transition_pending_first_exit="$?"
set -e
test "$terminal_source_transition_pending_first_exit" = "78"
python3 - "$terminal_source_transition_pending_state/todo-claims/current.json" "$terminal_source_transition_pending_state/todo-claims/blocked.jsonl" "$terminal_source_transition_pending_workspace/.brownie/private/phase-loop/task-ledger.jsonl" "$terminal_source_transition_pending_runtime_count" <<'PY'
import json
import pathlib
import sys
claim = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
blocked = [json.loads(line) for line in pathlib.Path(sys.argv[2]).read_text(encoding='utf-8').splitlines() if line.strip()]
ledger = [json.loads(line) for line in pathlib.Path(sys.argv[3]).read_text(encoding='utf-8').splitlines() if line.strip()]
assert claim['status'] == 'in_progress', claim
assert claim['terminal_failure_source_transition_pending'] is True, claim
assert claim['terminal_failure_source_transition_recovery_id'], claim
assert blocked and blocked[-1]['terminal_failure'] is True, blocked
assert any(record.get('kind') == 'terminal_failure_transaction' for record in ledger), ledger
source_task = 'E-final-source-transition-pending@' + claim['claim_id']
assert not any(event.get('task_id') == source_task and event.get('to_state') == 'failed' for record in ledger for event in (record.get('events', []) if record.get('kind') == 'terminal_failure_transaction' else [record])), ledger
assert pathlib.Path(sys.argv[4]).read_text(encoding='utf-8').splitlines() == ['runtime-invoked'], pathlib.Path(sys.argv[4]).read_text()
PY
test ! -e "$terminal_source_transition_pending_state/stop"
set +e
PHASE_LOOP_STATE_DIR="$terminal_source_transition_pending_state" \
PHASE_LOOP_PROMPT="$terminal_source_transition_pending_prompt" \
PHASE_LOOP_TODO="$terminal_source_transition_pending_todo" \
BROWNIE_BIN="$terminal_source_transition_pending_brownie" \
PHASE_LOOP_WORKSPACE_ROOT="$terminal_source_transition_pending_workspace" \
PHASE_LOOP_TERMINAL_FAILURE_RETRY_CAP=0 \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 76 "$PHASE_LOOP" run-once >/dev/null
terminal_source_transition_pending_second_exit="$?"
set -e
test "$terminal_source_transition_pending_second_exit" = "76"
python3 - "$terminal_source_transition_pending_state/status.json" "$terminal_source_transition_pending_state/todo-claims/current.json" "$terminal_source_transition_pending_workspace/.brownie/private/phase-loop/task-ledger.jsonl" "$terminal_source_transition_pending_runtime_count" <<'PY'
import json
import pathlib
import sys
status = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
claim = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding='utf-8'))
ledger = [json.loads(line) for line in pathlib.Path(sys.argv[3]).read_text(encoding='utf-8').splitlines() if line.strip()]
assert status['status'] == 'blocked', status
assert status['exit_code'] == '76', status
assert claim['status'] == 'failed', claim
assert claim['terminal_failure_source_transition_pending'] is False, claim
assert any(item.get('note') == 'terminal_failure_source_transition_completed' for item in claim['status_history']), claim
source_task = 'E-final-source-transition-pending@' + claim['claim_id']
assert any(event.get('task_id') == source_task and event.get('to_state') == 'failed' and event.get('from_state') in ('claimed', 'running') for record in ledger for event in (record.get('events', []) if record.get('kind') == 'terminal_failure_transaction' else [record])), ledger
assert pathlib.Path(sys.argv[4]).read_text(encoding='utf-8').splitlines() == ['runtime-invoked'], pathlib.Path(sys.argv[4]).read_text()
PY
test ! -e "$terminal_source_transition_pending_state/stop"

# If the supervisor is killed after terminal recovery and blocked evidence are
# durable but before the main loop writes todo.failed, the restart-visible
# source-transition obligation must prevent a second Runtime invocation.
terminal_source_kill_window_state="$(mktemp -d)"
terminal_source_kill_window_prompt="$(mktemp)"
terminal_source_kill_window_todo="$(mktemp)"
terminal_source_kill_window_workspace="$(mktemp -d)"
terminal_source_kill_window_runtime_count="$terminal_source_kill_window_state/runtime-count"
git -C "$terminal_source_kill_window_workspace" init -b main >/dev/null
git -C "$terminal_source_kill_window_workspace" -c user.name=Brownie -c user.email=brownie@example.invalid commit --allow-empty -m init >/dev/null
printf 'base prompt\n' > "$terminal_source_kill_window_prompt"
printf -- '- [ ] E-terminal-source-kill-window: Patch only `scripts/provider-target.mjs`:\n  Route: implementation.\n  Completion condition: source transition remains durable across supervisor interruption.\n  Verification: run `node --check scripts/provider-target.mjs`.\n' > "$terminal_source_kill_window_todo"
terminal_source_kill_window_brownie="$(mktemp)"
cat > "$terminal_source_kill_window_brownie" <<SH
#!/usr/bin/env bash
set -eu
printf 'runtime-invoked\n' >> "$terminal_source_kill_window_runtime_count"
exec "$fake_brownie_terminal_no_eligible" "\$@"
SH
chmod +x "$terminal_source_kill_window_brownie"
set +e
PHASE_LOOP_STATE_DIR="$terminal_source_kill_window_state" \
PHASE_LOOP_PROMPT="$terminal_source_kill_window_prompt" \
PHASE_LOOP_TODO="$terminal_source_kill_window_todo" \
BROWNIE_BIN="$terminal_source_kill_window_brownie" \
PHASE_LOOP_WORKSPACE_ROOT="$terminal_source_kill_window_workspace" \
PHASE_LOOP_TERMINAL_FAILURE_RETRY_CAP=0 \
PHASE_LOOP_TEST_KILL_AFTER_TERMINAL_RECOVERY=1 \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 143 "$PHASE_LOOP" run-once >/dev/null
terminal_source_kill_window_first_exit="$?"
set -e
test "$terminal_source_kill_window_first_exit" = "143"
python3 - "$terminal_source_kill_window_state/todo-claims/terminal-failure-source-transition.pending.json" "$terminal_source_kill_window_state/todo-claims/blocked.jsonl" "$terminal_source_kill_window_runtime_count" <<'PY'
import json
import pathlib
import sys
marker = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
blocked = [json.loads(line) for line in pathlib.Path(sys.argv[2]).read_text(encoding='utf-8').splitlines() if line.strip()]
assert marker['claim']['terminal_failure_source_transition_pending'] is True, marker
assert marker['recovery_id'], marker
assert blocked and blocked[-1]['terminal_failure'] is True, blocked
assert pathlib.Path(sys.argv[3]).read_text(encoding='utf-8').splitlines() == ['runtime-invoked'], pathlib.Path(sys.argv[3]).read_text()
PY
set +e
PHASE_LOOP_STATE_DIR="$terminal_source_kill_window_state" \
PHASE_LOOP_PROMPT="$terminal_source_kill_window_prompt" \
PHASE_LOOP_TODO="$terminal_source_kill_window_todo" \
BROWNIE_BIN="$terminal_source_kill_window_brownie" \
PHASE_LOOP_WORKSPACE_ROOT="$terminal_source_kill_window_workspace" \
PHASE_LOOP_TERMINAL_FAILURE_RETRY_CAP=0 \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 76 "$PHASE_LOOP" run-once >/dev/null
terminal_source_kill_window_second_exit="$?"
set -e
test "$terminal_source_kill_window_second_exit" = "76"
python3 - "$terminal_source_kill_window_state/status.json" "$terminal_source_kill_window_state/todo-claims/current.json" "$terminal_source_kill_window_state/todo-claims/blocked.jsonl" "$terminal_source_kill_window_runtime_count" <<'PY'
import json
import pathlib
import sys
status = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
claim = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding='utf-8'))
blocked = [json.loads(line) for line in pathlib.Path(sys.argv[3]).read_text(encoding='utf-8').splitlines() if line.strip()]
assert status['exit_code'] == '76', status
assert claim['status'] == 'failed', claim
assert claim['terminal_failure_source_transition_pending'] is False, claim
assert any(item.get('note') == 'terminal_failure_source_transition_completed' for item in claim['status_history']), claim
assert len(blocked) == 1, blocked
assert pathlib.Path(sys.argv[4]).read_text(encoding='utf-8').splitlines() == ['runtime-invoked'], pathlib.Path(sys.argv[4]).read_text()
assert not pathlib.Path(sys.argv[2]).parent.joinpath('terminal-failure-source-transition.pending.json').exists()
PY
fi

if claim_smoke_section_enabled terminal-absent; then
# Terminal recovery remains durable when the runtime removes the active claim
# before the controller emits its final trajectory. The next run must not
# recreate the same queue-generation/target attempt.
state_terminal_claim_absent="$(mktemp -d)"
prompt_terminal_claim_absent="$(mktemp)"
todo_terminal_claim_absent="$(mktemp)"
terminal_claim_absent_workspace="$(mktemp -d)"
git -C "$terminal_claim_absent_workspace" init -b main >/dev/null
git -C "$terminal_claim_absent_workspace" -c user.name=Brownie -c user.email=brownie@example.invalid commit --allow-empty -m init >/dev/null
printf 'base prompt\n' > "$prompt_terminal_claim_absent"
printf -- '- [ ] E-15b-provider-terminal: Patch only `scripts/provider-target.mjs`:\n  Route: implementation.\n  Completion condition: provider terminal failure is durably blocked.\n  Verification: run `node --check scripts/provider-target.mjs`.\n' > "$todo_terminal_claim_absent"
set +e
PHASE_LOOP_STATE_DIR="$state_terminal_claim_absent" \
PHASE_LOOP_PROMPT="$prompt_terminal_claim_absent" \
PHASE_LOOP_TODO="$todo_terminal_claim_absent" \
BROWNIE_BIN="$fake_brownie_terminal_no_eligible" \
PHASE_LOOP_WORKSPACE_ROOT="$terminal_claim_absent_workspace" \
PHASE_LOOP_TEST_REMOVE_CLAIM=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null
terminal_claim_absent_exit="$?"
set -e
test "$terminal_claim_absent_exit" = "76"
test ! -f "$state_terminal_claim_absent/todo-claims/current.json"
test ! -e "$state_terminal_claim_absent/todo-claims/terminal-failure-source-transition.pending.json"
python3 - "$state_terminal_claim_absent/status.json" "$state_terminal_claim_absent/todo-claims/blocked.jsonl" "$terminal_claim_absent_workspace/.brownie/private/phase-loop/task-ledger.jsonl" "$state_terminal_claim_absent/bdk-trajectory.jsonl" <<'PY'
import json
import pathlib
import sys

status = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
blocked = [json.loads(line) for line in pathlib.Path(sys.argv[2]).read_text(encoding='utf-8').splitlines() if line.strip()]
ledger = pathlib.Path(sys.argv[3]).read_text(encoding='utf-8')
ledger_records = [
    json.loads(line)
    for line in pathlib.Path(sys.argv[3]).read_text(encoding='utf-8').splitlines()
    if line.strip()
]
bdk_records = [
    json.loads(line)
    for line in pathlib.Path(sys.argv[4]).read_text(encoding='utf-8').splitlines()
    if line.strip()
]
assert status['status'] == 'blocked', status
assert blocked and blocked[-1]['block_reason'] == 'terminal_runtime_failure', blocked
assert blocked[-1]['terminal_failure'] is True, blocked
assert blocked[-1]['provider_failure_fingerprint'] == 'sha256:provider-terminal-no-content', blocked
assert len(blocked[-1]['controller_fingerprint']) == 64, blocked
assert 'terminal_failure_transaction' in ledger, ledger
assert 'E-15b-provider-terminal' in ledger, ledger
assert 'provider-terminal-no-content' in ledger, ledger
assert 'controller_fingerprint' in ledger, ledger
assert '"claim_absent":true' in ledger, ledger
assert 'scripts/provider-target.mjs' in ledger, ledger
assert 'node --check scripts/provider-target.mjs' in ledger, ledger
claim_id = blocked[-1]['claim_id']
assert any(
    event.get('claim_id') == claim_id
    and event.get('to_state') == 'failed'
    and event.get('from_state') in ('claimed', 'running')
    and str(event.get('task_id', '')).endswith('@' + claim_id)
    for record in ledger_records
    for event in (record.get('events', []) if record.get('kind') == 'terminal_failure_transaction' else [record])
), ledger_records
assert any(
    record.get('claim_id') == claim_id
    and any(event.get('type') == 'todo.blocked' for event in record.get('events', []))
    for record in bdk_records
), bdk_records
PY
PHASE_LOOP_STATE_DIR="$state_terminal_claim_absent" \
PHASE_LOOP_PROMPT="$prompt_terminal_claim_absent" \
PHASE_LOOP_TODO="$todo_terminal_claim_absent" \
BROWNIE_BIN="$fake_brownie_terminal_no_eligible" \
PHASE_LOOP_WORKSPACE_ROOT="$terminal_claim_absent_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null || true
python3 - "$state_terminal_claim_absent/todo-claims/current.json" "$terminal_claim_absent_workspace/.brownie/private/phase-loop/task-ledger.jsonl" <<'PY'
import json
import pathlib
import sys

current = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
assert not current['selected_todo'].startswith('- [ ] E-15b-provider-terminal:'), current
transactions = []
for line in pathlib.Path(sys.argv[2]).read_text(encoding='utf-8').splitlines():
    if not line.strip():
        continue
    record = json.loads(line)
    if record.get('kind') == 'terminal_failure_transaction':
        transactions.append(record)
same_todo = [
    record for record in transactions
    if any('E-15b-provider-terminal:' in str(event.get('selected_todo', '')) for event in record.get('events', []))
]
assert len(same_todo) == 1, same_todo
PY

# A stale active claim can be replaced before Runtime starts. If Runtime then
# removes current.json, terminal recovery must use the replacement claim
# snapshot rather than the displaced claim's target/identity.
state_stale_replacement_claim_absent="$(mktemp -d)"
prompt_stale_replacement_claim_absent="$(mktemp)"
todo_stale_replacement_claim_absent="$(mktemp)"
todo_breakdown_stale_replacement_claim_absent="$(mktemp)"
stale_replacement_workspace="$(mktemp -d)"
git -C "$stale_replacement_workspace" init -b main >/dev/null
git -C "$stale_replacement_workspace" config user.name Brownie
git -C "$stale_replacement_workspace" config user.email brownie@example.invalid
mkdir -p "$stale_replacement_workspace/.brownie" "$stale_replacement_workspace/scripts"
printf 'old target\n' > "$stale_replacement_workspace/scripts/old.mjs"
printf 'new target\n' > "$stale_replacement_workspace/scripts/new.mjs"
git -C "$stale_replacement_workspace" add .
git -C "$stale_replacement_workspace" commit -m init >/dev/null
printf 'base prompt\n' > "$prompt_stale_replacement_claim_absent"
printf -- '- [ ] E-stale-replacement-new: Patch only `scripts/new.mjs`:\n  Route: implementation.\n  Verification: run `node --check scripts/new.mjs`.\n' > "$todo_stale_replacement_claim_absent"
printf '# Breakdown\n' > "$todo_breakdown_stale_replacement_claim_absent"
mkdir -p "$state_stale_replacement_claim_absent/todo-claims"
cat > "$state_stale_replacement_claim_absent/todo-claims/current.json" <<'JSON'
{
  "schema_version": 1,
  "claim_id": "todo-g1-old-stale-replacement",
  "selected_todo": "- [ ] E-stale-replacement-old: Patch only `scripts/old.mjs`:\n  Route: implementation.\n  Verification: run `node --check scripts/old.mjs`.\n",
  "status": "in_progress",
  "queue_generation": 1,
  "queue_fingerprint": "old-queue-fingerprint"
}
JSON
set +e
PHASE_LOOP_STATE_DIR="$state_stale_replacement_claim_absent" \
PHASE_LOOP_PROMPT="$prompt_stale_replacement_claim_absent" \
PHASE_LOOP_TODO="$todo_stale_replacement_claim_absent" \
PHASE_LOOP_TODO_BREAKDOWN="$todo_breakdown_stale_replacement_claim_absent" \
BROWNIE_BIN="$fake_brownie_terminal_no_eligible" \
PHASE_LOOP_WORKSPACE_ROOT="$stale_replacement_workspace" \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
PHASE_LOOP_TEST_REMOVE_CLAIM=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 76 "$PHASE_LOOP" run-once >/dev/null
stale_replacement_exit="$?"
set -e
test "$stale_replacement_exit" = "76"
python3 - "$state_stale_replacement_claim_absent/todo-claims" "$stale_replacement_workspace/.brownie/private/phase-loop/task-ledger.jsonl" <<'PY'
import json
import pathlib
import sys

claim_dir = pathlib.Path(sys.argv[1])
ledger_path = pathlib.Path(sys.argv[2])
records = []
for line in ledger_path.read_text(encoding='utf-8').splitlines():
    if line.strip():
        record = json.loads(line)
        if record.get('kind') == 'terminal_failure_transaction':
            records.append(record)
assert len(records) == 1, records
events = records[0]['events']
failed = events[-1]
assert 'E-stale-replacement-new:' in failed['selected_todo'], failed
assert failed['claim_id'] != 'todo-g1-old-stale-replacement', failed
assert failed['claim_id'].startswith('todo-g'), failed
PY
fi

if claim_smoke_section_enabled queue; then
# Queue fixtures are intentionally self-contained.  In particular, this
# section must also run when selected directly by CI, without relying on the
# core shard having initialized any of its variables or workspace files.
queue_workspace="$(mktemp -d)"
git -C "$queue_workspace" init -b main >/dev/null
git -C "$queue_workspace" -c user.name=Brownie -c user.email=brownie@example.invalid commit --allow-empty -m init >/dev/null
queue_original_workspace="$test_workspace"
test_workspace="$queue_workspace"

queue_state_with_claim="$(mktemp -d)"
queue_prompt_with_claim="$(mktemp)"
queue_todo_with_claim="$(mktemp)"
printf 'base prompt\n' > "$queue_prompt_with_claim"
printf -- '- [ ] B-01: durable claim task\n  with detail\n  Files: \`scripts/release-runtime-operational-evidence.mjs\`, \`docs/architecture/local-release-targets.example.json\`.\n- [ ] B-02: next task\n' > "$queue_todo_with_claim"

PHASE_LOOP_STATE_DIR="$queue_state_with_claim" \
PHASE_LOOP_PROMPT="$queue_prompt_with_claim" \
PHASE_LOOP_TODO="$queue_todo_with_claim" \
BROWNIE_BIN="$fake_brownie_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

queue_claim_file="$queue_state_with_claim/todo-claims/current.json"
queue_prompt_file="$(find "$queue_state_with_claim/runs" -name '*.prompt.md' -print | sort | tail -n 1)"

queue_state_with_blocked="$(mktemp -d)"
queue_prompt_with_blocked="$(mktemp)"
queue_todo_with_blocked="$(mktemp)"
printf 'base prompt\n' > "$queue_prompt_with_blocked"
printf -- '- [ ] R-09: blocked boundary task\n' > "$queue_todo_with_blocked"

PHASE_LOOP_STATE_DIR="$queue_state_with_blocked" \
PHASE_LOOP_PROMPT="$queue_prompt_with_blocked" \
PHASE_LOOP_TODO="$queue_todo_with_blocked" \
BROWNIE_BIN="$fake_brownie_blocked_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

state_objective_apply_stalled="$(mktemp -d)"
prompt_objective_apply_stalled="$(mktemp)"
todo_objective_apply_stalled="$(mktemp)"
printf 'base prompt\n' > "$prompt_objective_apply_stalled"
printf -- '- [ ] E-99-objective-apply: Patch only `README.md` to exercise objective apply stall recovery.\n' > "$todo_objective_apply_stalled"

PHASE_LOOP_STATE_DIR="$state_objective_apply_stalled" \
PHASE_LOOP_PROMPT="$prompt_objective_apply_stalled" \
PHASE_LOOP_TODO="$todo_objective_apply_stalled" \
BROWNIE_BIN="$fake_brownie_objective_apply_pending" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

PHASE_LOOP_STATE_DIR="$state_objective_apply_stalled" \
PHASE_LOOP_PROMPT="$prompt_objective_apply_stalled" \
PHASE_LOOP_TODO="$todo_objective_apply_stalled" \
BROWNIE_BIN="$fake_brownie_objective_apply_pending" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

set +e
PHASE_LOOP_STATE_DIR="$state_objective_apply_stalled" \
PHASE_LOOP_PROMPT="$prompt_objective_apply_stalled" \
PHASE_LOOP_TODO="$todo_objective_apply_stalled" \
BROWNIE_BIN="$fake_brownie_objective_apply_pending" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null
objective_apply_stalled_exit="$?"
set -e
test "$objective_apply_stalled_exit" = "76"
python3 - "$state_objective_apply_stalled/status.json" "$state_objective_apply_stalled/progress-state.json" "$state_objective_apply_stalled/todo-claims/current.json" "$state_objective_apply_stalled/todo-claims/repair-feedback.json" <<'PY'
import json
import sys

status = json.load(open(sys.argv[1], encoding="utf-8"))
progress = json.load(open(sys.argv[2], encoding="utf-8"))
claim = json.load(open(sys.argv[3], encoding="utf-8"))
feedback = json.load(open(sys.argv[4], encoding="utf-8"))
projection = progress["progress_projection"]
assert status["status"] == "no_progress", status
assert "objective_apply_stalled" in status["detail"], status
assert progress["classification"] == "no_progress", progress
assert progress["same_progress_count"] == 3, progress
assert projection["objective_apply_pending"] is True, projection
assert projection["objective_apply_stalled"] is True, projection
assert claim["status"] == "in_progress", claim
assert feedback["claim_id"] == claim["claim_id"], feedback
assert feedback["reason"] == "runtime_terminal_failure", feedback
PY

state_all_blocked="$(mktemp -d)"
prompt_all_blocked="$(mktemp)"
todo_all_blocked="$(mktemp)"
todo_breakdown_all_blocked="$(mktemp)"
printf 'base prompt\n' > "$prompt_all_blocked"
printf -- '- [ ] E-22b-generated-leaf: Patch only `scripts/release-supply-chain-artifact-evidence.mjs` to bind one artifact evidence field:\n  Route: implementation.\n  Source TODO: E-22b.\n  Depends on: <none>.\n  Completion condition: the bounded generated leaf either updates its scoped evidence field or is redecomposed after blocking.\n  Forbidden changes: do not edit unrelated files.\n  Verification: run `pnpm --workspace-root guard:supply-chain-artifact-evidence:test`.\n' > "$todo_all_blocked"

PHASE_LOOP_STATE_DIR="$state_all_blocked" \
PHASE_LOOP_PROMPT="$prompt_all_blocked" \
PHASE_LOOP_TODO="$todo_all_blocked" \
PHASE_LOOP_TODO_BREAKDOWN="$todo_breakdown_all_blocked" \
BROWNIE_BIN="$fake_brownie_blocked_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

PHASE_LOOP_STATE_DIR="$state_all_blocked" \
PHASE_LOOP_PROMPT="$prompt_all_blocked" \
PHASE_LOOP_TODO="$todo_all_blocked" \
PHASE_LOOP_TODO_BREAKDOWN="$todo_breakdown_all_blocked" \
BROWNIE_BIN="$fake_brownie_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

python3 - "$state_all_blocked/todo-claims/current.json" "$todo_all_blocked" <<'PY'
import json
import sys

claim = json.load(open(sys.argv[1], encoding="utf-8"))
todo = open(sys.argv[2], encoding="utf-8").read()
assert claim["status"] == "in_progress", claim
assert "TODO-decompose-blocked-queue-" in claim["selected_todo"], claim
assert "Brownie must own the" in claim["selected_todo"], claim
assert "TODO-decompose-blocked-queue-" in todo, todo
assert "decomposition ledger" in todo, todo
PY

decomposition_prompt_file="$(find "$state_all_blocked/runs" -name '*.prompt.md' -print | sort | tail -n 1)"
assert_contains "$decomposition_prompt_file" 'state: `decompose_todo`'
assert_contains "$decomposition_prompt_file" 'decomposition_policy: this invocation is TODO decomposition only'
assert_contains "$decomposition_prompt_file" 'decomposition_write_policy: the only allowed workspace.write targets are the live TODO queue'
assert_contains "$decomposition_prompt_file" 'Prefer one compact `.brownie/todo.md` replacement first'
assert_contains "$decomposition_prompt_file" 'decomposition_leaf_policy: replace the active decomposition request and its broad source TODO with unchecked leaf TODOs'
assert_contains "$decomposition_prompt_file" 'decomposition_verification_policy: `Verification:` must use bounded commands'
assert_contains "$decomposition_prompt_file" 'decomposition_scope_policy: every implementation leaf must name a bounded `Patch only`/`Create only` scope'
assert_contains "$decomposition_prompt_file" 'decomposition_size_policy: keep the next workspace.write compact'
assert_contains "$decomposition_prompt_file" 'decomposition_ledger_policy: update `.brownie/todo-breakdown.md`'
assert_contains "$decomposition_prompt_file" 'let the guard request the breakdown repair next'

state_decomposition_leaf="$(mktemp -d)"
prompt_decomposition_leaf="$(mktemp)"
todo_decomposition_leaf="$(mktemp)"
mkdir -p "$test_workspace/scripts"
printf 'export const evidence = {};\n' > "$test_workspace/scripts/release-supply-chain-artifact-evidence.mjs"
printf 'base prompt\n' > "$prompt_decomposition_leaf"
printf -- '- [ ] E-15b-provenance-collector-a: Patch only `scripts/release-supply-chain-artifact-evidence.mjs` to record one clean current source commit:\n  Route: implementation.\n  Source TODO: TODO-decompose-blocked-queue-71820ffb9fb9: Decompose the currently blocked Product Ready TODO queue into implementable leaf TODOs:\n  Depends on: <none>.\n  Completion condition: the bounded collector path records source commit evidence.\n  Forbidden changes: do not edit unrelated files.\n  Verification: run `pnpm --workspace-root guard:supply-chain-artifact-evidence:test`.\n' > "$todo_decomposition_leaf"

PHASE_LOOP_STATE_DIR="$state_decomposition_leaf" \
PHASE_LOOP_PROMPT="$prompt_decomposition_leaf" \
PHASE_LOOP_TODO="$todo_decomposition_leaf" \
BROWNIE_BIN="$fake_brownie_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

decomposition_leaf_prompt_file="$(find "$state_decomposition_leaf/runs" -name '*.prompt.md' -print | sort | tail -n 1)"
assert_contains "$decomposition_leaf_prompt_file" 'state: `implement`'
assert_not_contains "$decomposition_leaf_prompt_file" 'state: `decompose_todo`'
assert_not_contains "$decomposition_leaf_prompt_file" 'decomposition_policy: this invocation is TODO decomposition only'

state_blocked_decomposition="$(mktemp -d)"
prompt_blocked_decomposition="$(mktemp)"
todo_blocked_decomposition="$(mktemp)"
todo_breakdown_blocked_decomposition="$(mktemp)"
printf 'base prompt\n' > "$prompt_blocked_decomposition"
printf -- '- [ ] E-22b-generated-leaf: Patch only `scripts/release-supply-chain-artifact-evidence.mjs` to bind one artifact evidence field:\n  Route: implementation.\n  Source TODO: E-22b.\n  Depends on: <none>.\n  Completion condition: the bounded generated leaf either updates its scoped evidence field or is redecomposed after blocking.\n  Forbidden changes: do not edit unrelated files.\n  Verification: run `pnpm --workspace-root guard:supply-chain-artifact-evidence:test`.\n' > "$todo_blocked_decomposition"

PHASE_LOOP_STATE_DIR="$state_blocked_decomposition" \
PHASE_LOOP_PROMPT="$prompt_blocked_decomposition" \
PHASE_LOOP_TODO="$todo_blocked_decomposition" \
PHASE_LOOP_TODO_BREAKDOWN="$todo_breakdown_blocked_decomposition" \
BROWNIE_BIN="$fake_brownie_blocked_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

PHASE_LOOP_STATE_DIR="$state_blocked_decomposition" \
PHASE_LOOP_PROMPT="$prompt_blocked_decomposition" \
PHASE_LOOP_TODO="$todo_blocked_decomposition" \
PHASE_LOOP_TODO_BREAKDOWN="$todo_breakdown_blocked_decomposition" \
BROWNIE_BIN="$fake_brownie_blocked_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

set +e
PHASE_LOOP_STATE_DIR="$state_blocked_decomposition" \
PHASE_LOOP_PROMPT="$prompt_blocked_decomposition" \
PHASE_LOOP_TODO="$todo_blocked_decomposition" \
PHASE_LOOP_TODO_BREAKDOWN="$todo_breakdown_blocked_decomposition" \
BROWNIE_BIN="$fake_brownie_blocked_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null
blocked_decomposition_exit="$?"
set -e
test "$blocked_decomposition_exit" = "75"

python3 - "$todo_blocked_decomposition" "$state_blocked_decomposition/status.json" <<'PY'
import json
import re
import sys

todo = open(sys.argv[1], encoding="utf-8").read()
status = json.load(open(sys.argv[2], encoding="utf-8"))
decomposition_items = re.findall(r"TODO-decompose-blocked-queue-", todo)
assert len(decomposition_items) == 1, todo
assert status["status"] == "blocked", status
assert "Failed to claim first pending TODO" in status["detail"], status
PY

# A stale child may retain the generated recovery id in its Source TODO
# provenance after the request itself was removed.  That text must not make
# the controller believe the request is still queued.
state_orphaned_request="$(mktemp -d)"
prompt_orphaned_request="$(mktemp)"
todo_orphaned_request="$(mktemp)"
todo_breakdown_orphaned_request="$(mktemp)"
printf 'base prompt\n' > "$prompt_orphaned_request"
# Keep the stalled source block byte-for-byte stable.  A separate descendant
# carries the historical recovery id in provenance, which is the real
# interrupted-decomposition shape this regression protects.
historical_id="TODO-decompose-blocked-queue-stalled-deadbeefcafe"
printf -- '- [ ] E-22b-generated-leaf: Patch only `scripts/release-supply-chain-artifact-evidence.mjs` to bind one artifact evidence field:\n  Route: implementation.\n  Depends on: <none>.\n  Completion condition: the bounded generated leaf is recovered through a fresh decomposition request.\n  Forbidden changes: do not edit unrelated files.\n  Verification: run `pnpm --workspace-root guard:supply-chain-artifact-evidence:test`.\n\n- [ ] E-22b-generated-child: Keep provenance for the interrupted decomposition:\n  Route: implementation.\n  Source TODO: '"$historical_id"'.\n  Depends on: E-22b-generated-leaf.\n  Completion condition: provenance remains historical only.\n  Forbidden changes: do not edit unrelated files.\n  Verification: run `pnpm --workspace-root guard:supply-chain-artifact-evidence:test`.\n' > "$todo_orphaned_request"
orphan_id="$(python3 - "$todo_orphaned_request" <<'PY'
import hashlib
import pathlib
import sys

todo = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
print("TODO-decompose-blocked-queue-stalled-" + hashlib.sha256(todo.split("\n\n", 1)[0].encode("utf-8")).hexdigest()[:12])
PY
)"
mkdir -p "$state_orphaned_request/todo-claims"
python3 - "$todo_orphaned_request" "$state_orphaned_request/todo-claims/blocked.jsonl" <<'PY'
import hashlib
import json
import pathlib
import sys

todo = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
first_line = todo.splitlines()[0]
pathlib.Path(sys.argv[2]).write_text(json.dumps({
    "block_reason": "stalled_leaf_contract_replan",
    "selected_todo_first_line": first_line,
    "selected_todo_sha256": hashlib.sha256(todo.strip().encode("utf-8")).hexdigest(),
    "todo_id": "E-22b-generated-leaf",
}) + "\n", encoding="utf-8")
PY

PHASE_LOOP_STATE_DIR="$state_orphaned_request" \
PHASE_LOOP_PROMPT="$prompt_orphaned_request" \
PHASE_LOOP_TODO="$todo_orphaned_request" \
PHASE_LOOP_TODO_BREAKDOWN="$todo_breakdown_orphaned_request" \
BROWNIE_BIN="$fake_brownie_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

python3 - "$state_orphaned_request/todo-claims/current.json" "$todo_orphaned_request" "$orphan_id" "$historical_id" <<'PY'
import json
import re
import sys

claim = json.load(open(sys.argv[1], encoding="utf-8"))
todo = open(sys.argv[2], encoding="utf-8").read()
orphan_id = sys.argv[3]
historical_id = sys.argv[4]
assert claim["status"] == "in_progress", claim
selected = claim["selected_todo"]
match = re.match(r"- \[ \] (TODO-decompose-blocked-queue(?:-stalled)?-[0-9a-f]{12}):", selected)
assert match, claim
# The stale Source TODO id remains provenance only.  Recovery must enqueue and
# claim the id derived from the unchanged stalled source block instead.
assert match.group(1) == orphan_id, claim
assert match.group(1) != historical_id, claim
assert selected in todo, todo
assert f"Source TODO: {historical_id}." in todo, todo
PY

printf -- '- [ ] R-09: blocked boundary task\n  Extra context that changes the queue fingerprint.\n- [ ] R-10: next unblocked task\n' > "$queue_todo_with_blocked"

PHASE_LOOP_STATE_DIR="$queue_state_with_blocked" \
PHASE_LOOP_PROMPT="$queue_prompt_with_blocked" \
PHASE_LOOP_TODO="$queue_todo_with_blocked" \
BROWNIE_BIN="$fake_brownie_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

python3 - "$queue_state_with_blocked/todo-claims/current.json" <<'PY'
import json
import sys

claim = json.load(open(sys.argv[1], encoding="utf-8"))
assert claim["status"] == "in_progress", claim
assert claim["selected_todo"].startswith("- [ ] R-09: blocked boundary task"), claim
PY

state_dependency="$(mktemp -d)"
prompt_dependency="$(mktemp)"
todo_dependency="$(mktemp)"
printf 'base prompt\n' > "$prompt_dependency"
printf -- '- [ ] E-15-child: Patch only `scripts/child.mjs`:\n  Route: implementation.\n  Source TODO: E-15.\n  Depends on: E-15-parent.\n  Completion condition: the child change is implemented after the parent is done.\n  Forbidden changes: do not edit unrelated files.\n  Verification: run `pnpm --workspace-root check`.\n- [ ] E-15-parent: Patch only `scripts/parent.mjs`:\n  Route: implementation.\n  Source TODO: E-15.\n  Depends on: <none>.\n  Completion condition: the parent change is implemented before child work starts.\n  Forbidden changes: do not edit unrelated files.\n  Verification: run `pnpm --workspace-root check`.\n' > "$todo_dependency"

PHASE_LOOP_STATE_DIR="$state_dependency" \
PHASE_LOOP_PROMPT="$prompt_dependency" \
PHASE_LOOP_TODO="$todo_dependency" \
BROWNIE_BIN="$fake_brownie_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

dependency_prompt_file="$(find "$state_dependency/runs" -name '*.prompt.md' -print | sort | tail -n 1)"
assert_contains "$dependency_prompt_file" 'dependency_policy: do not work on a TODO whose `Depends on:` entries are still pending'
assert_contains "$dependency_prompt_file" 'implementation_preflight_policy: before any workspace.write'

python3 - "$state_dependency/todo-claims/current.json" <<'PY'
import json
import sys

claim = json.load(open(sys.argv[1], encoding="utf-8"))
assert claim["status"] == "in_progress", claim
assert claim["selected_todo"].startswith("- [ ] E-15-parent:"), claim
PY

assert_contains "$queue_prompt_file" '## Active TODO Claim'
assert_contains "$queue_prompt_file" 'queue_generation'
assert_contains "$queue_prompt_file" 'B-01: durable claim task'

state_explicit_blocker="$(mktemp -d)"
prompt_explicit_blocker="$(mktemp)"
todo_explicit_blocker="$(mktemp)"
printf 'base prompt\n' > "$prompt_explicit_blocker"
cat > "$todo_explicit_blocker" <<'EOF'
- [ ] E-15e-doc-sync-blocker: Blocker: missing owner-controlled independent review evidence for Release workflow, permission model, Ledger Contract, Mode Pack trust boundary, signing/provenance, and Release Ready判定ロジック.
  Route: documentation.
  Depends on: E-15e-release-contract-audit-phase-resync-doc-sync-leaf.
  Completion condition: all six independent human reviews are completed and recorded.
  Forbidden changes: do not patch runtime-release-contract.json until all reviews are complete.
  Verification: blocker: exact missing evidence or field is named, and no workspace file is patched until that evidence is available.

- [ ] E-15f-next: Patch only `scripts/guard-release-contract.mjs`:
  Route: implementation.
  Source TODO: E-15f.
  Depends on: <none>.
  Completion condition: the next TODO remains schedulable after the blocker is recorded.
  Forbidden changes: do not edit unrelated files.
  Verification: run `pnpm --workspace-root guard:release-contract:test`.
EOF

PHASE_LOOP_STATE_DIR="$state_explicit_blocker" \
PHASE_LOOP_PROMPT="$prompt_explicit_blocker" \
PHASE_LOOP_TODO="$todo_explicit_blocker" \
BROWNIE_BIN="$fake_brownie_must_not_run" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

python3 - "$state_explicit_blocker/status.json" "$state_explicit_blocker/todo-claims/current.json" "$state_explicit_blocker/todo-claims/blocked.jsonl" <<'PY'
import json
import pathlib
import sys

status = json.load(open(sys.argv[1], encoding="utf-8"))
claim = json.load(open(sys.argv[2], encoding="utf-8"))
blocked = pathlib.Path(sys.argv[3]).read_text(encoding="utf-8")
assert status["status"] == "blocked_todo_recorded", status
assert status["exit_code"] == "0", status
assert "explicit owner/release blocker" in status["detail"], status
assert claim["status"] == "blocked", claim
assert claim["selected_todo"].startswith("- [ ] E-15e-doc-sync-blocker:"), claim
assert "E-15e-doc-sync-blocker" in blocked, blocked
PY

PHASE_LOOP_STATE_DIR="$state_explicit_blocker" \
PHASE_LOOP_PROMPT="$prompt_explicit_blocker" \
PHASE_LOOP_TODO="$todo_explicit_blocker" \
BROWNIE_BIN="$fake_brownie_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

python3 - "$state_explicit_blocker/todo-claims/current.json" <<'PY'
import json
import sys

claim = json.load(open(sys.argv[1], encoding="utf-8"))
assert claim["status"] == "in_progress", claim
assert claim["selected_todo"].startswith("- [ ] E-15f-next:"), claim
PY

printf '' > "$queue_todo_with_claim"

PHASE_LOOP_STATE_DIR="$queue_state_with_claim" \
PHASE_LOOP_PROMPT="$queue_prompt_with_claim" \
PHASE_LOOP_TODO="$queue_todo_with_claim" \
BROWNIE_BIN="$fake_brownie_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

python3 - "$queue_claim_file" <<'PY'
import json
import sys

claim = json.load(open(sys.argv[1], encoding="utf-8"))
assert claim["status"] == "in_progress", claim
assert claim["selected_todo"].startswith("- [ ] B-01: durable claim task"), claim
assert len(claim["status_history"]) >= 3, claim
PY

state_stagnation="$(mktemp -d)"
prompt_stagnation="$(mktemp)"
todo_stagnation="$(mktemp)"
printf 'base prompt\n' > "$prompt_stagnation"
printf -- '- [ ] B-01: stagnant task\n' > "$todo_stagnation"

PHASE_LOOP_STATE_DIR="$state_stagnation" \
PHASE_LOOP_PROMPT="$prompt_stagnation" \
PHASE_LOOP_TODO="$todo_stagnation" \
BROWNIE_BIN="$fake_brownie_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

PHASE_LOOP_STATE_DIR="$state_stagnation" \
PHASE_LOOP_PROMPT="$prompt_stagnation" \
PHASE_LOOP_TODO="$todo_stagnation" \
BROWNIE_BIN="$fake_brownie_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

if PHASE_LOOP_STATE_DIR="$state_stagnation" \
  PHASE_LOOP_PROMPT="$prompt_stagnation" \
  PHASE_LOOP_TODO="$todo_stagnation" \
  BROWNIE_BIN="$fake_brownie_json" \
  PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
  run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null; then
  echo "expected repeated identical non-progress fingerprint to fail as no_progress" >&2
  exit 1
fi

python3 - "$state_stagnation/status.json" "$state_stagnation/progress-state.json" <<'PY'
import json
import sys

status = json.load(open(sys.argv[1], encoding="utf-8"))
progress = json.load(open(sys.argv[2], encoding="utf-8"))
assert status["status"] == "no_progress", status
assert progress["classification"] == "no_progress", progress
assert progress["same_progress_count"] == 3, progress
assert progress["meaningful_progress"] is False, progress
PY

state_todo_md_only="$(mktemp -d)"
prompt_todo_md_only="$(mktemp)"
todo_todo_md_only="$(mktemp)"
workspace_todo_md_only="$(mktemp -d)"
git -C "$workspace_todo_md_only" init -b main >/dev/null
git -C "$workspace_todo_md_only" -c user.name=Brownie -c user.email=brownie@example.invalid commit --allow-empty -m init >/dev/null
printf 'base prompt\n' > "$prompt_todo_md_only"
printf -- '- [ ] E-08b-next: Finish E-08b after read-budget exhaustion:\n  Source TODO: E-08b: Fail closed on supply-chain scan and network failures.\n' > "$todo_todo_md_only"

PHASE_LOOP_STATE_DIR="$state_todo_md_only" \
PHASE_LOOP_PROMPT="$prompt_todo_md_only" \
PHASE_LOOP_TODO="$todo_todo_md_only" \
BROWNIE_BIN="$fake_brownie_todo_md_only_apply" \
PHASE_LOOP_WORKSPACE_ROOT="$workspace_todo_md_only" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

python3 - "$state_todo_md_only/status.json" "$state_todo_md_only/progress-state.json" "$state_todo_md_only/todo-claims/current.json" "$todo_todo_md_only" <<'PY'
import json
import sys

status = json.load(open(sys.argv[1], encoding="utf-8"))
progress = json.load(open(sys.argv[2], encoding="utf-8"))
claim = json.load(open(sys.argv[3], encoding="utf-8"))
todo = open(sys.argv[4], encoding="utf-8").read()
projection = progress["progress_projection"]
assert status["status"] == "non_progress_success", status
assert progress["classification"] == "non_progress_success", progress
assert progress["meaningful_progress"] is False, progress
assert projection["todo_md_only_apply_blocked_as_progress"] is True, projection
assert projection["selected_todo_first_line_still_pending_after_todo_md_apply"] is True, projection
assert claim["status"] == "in_progress", claim
assert "E-08b-next" in todo, todo
PY

PHASE_LOOP_STATE_DIR="$state_todo_md_only" \
PHASE_LOOP_PROMPT="$prompt_todo_md_only" \
PHASE_LOOP_TODO="$todo_todo_md_only" \
BROWNIE_BIN="$fake_brownie_no_actionable" \
PHASE_LOOP_WORKSPACE_ROOT="$workspace_todo_md_only" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

python3 - "$state_todo_md_only/status.json" "$state_todo_md_only/progress-state.json" "$state_todo_md_only/todo-claims/current.json" "$todo_todo_md_only" <<'PY'
import json
import sys

status = json.load(open(sys.argv[1], encoding="utf-8"))
progress = json.load(open(sys.argv[2], encoding="utf-8"))
claim = json.load(open(sys.argv[3], encoding="utf-8"))
todo = open(sys.argv[4], encoding="utf-8").read()
projection = progress["progress_projection"]
assert status["status"] == "non_progress_success", status
assert progress["classification"] == "non_progress_success", progress
assert progress["meaningful_progress"] is False, progress
assert projection["completed_by_no_actionable_after_apply"] is False, projection
assert claim["status"] == "in_progress", claim
assert "E-08b-next" in todo, todo
PY

state_workspace_progress="$(mktemp -d)"
prompt_workspace_progress="$(mktemp)"
todo_workspace_progress="$(mktemp)"
workspace_progress="$(mktemp -d)"
git -C "$workspace_progress" init -b main >/dev/null
git -C "$workspace_progress" -c user.name=Brownie -c user.email=brownie@example.invalid commit --allow-empty -m init >/dev/null
printf 'base prompt\n' > "$prompt_workspace_progress"
printf -- '- [ ] B-01: workspace progress task\n' > "$todo_workspace_progress"

PHASE_LOOP_STATE_DIR="$state_workspace_progress" \
PHASE_LOOP_PROMPT="$prompt_workspace_progress" \
PHASE_LOOP_TODO="$todo_workspace_progress" \
BROWNIE_BIN="$fake_brownie_workspace_change" \
PHASE_LOOP_WORKSPACE_ROOT="$workspace_progress" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

python3 - "$state_workspace_progress/progress-state.json" <<'PY'
import json
import sys

progress = json.load(open(sys.argv[1], encoding="utf-8"))
assert progress["classification"] == "progress", progress
assert progress["meaningful_progress"] is True, progress
assert progress["workspace_changed"] is True, progress
PY
test_workspace="$queue_original_workspace"
fi

if claim_smoke_section_enabled pr; then
state_pr_progress="$(mktemp -d)"
prompt_pr_progress="$(mktemp)"
todo_pr_progress="$(mktemp)"
workspace_pr_progress="$(mktemp -d)"
remote_pr_progress="$(mktemp -d)"
fake_bin_dir="$(mktemp -d)"
git -C "$workspace_pr_progress" init -b main >/dev/null
mkdir -p "$workspace_pr_progress/scripts"
cp "$REPO_ROOT/scripts/phase-loop-pr-actor-guard.mjs" "$workspace_pr_progress/scripts/phase-loop-pr-actor-guard.mjs"
printf 'base\n' > "$workspace_pr_progress/README.md"
git -C "$workspace_pr_progress" add README.md
git -C "$workspace_pr_progress" -c user.name=Brownie -c user.email=brownie@example.invalid commit -m init >/dev/null
git -C "$remote_pr_progress" init --bare >/dev/null
git -C "$workspace_pr_progress" remote add origin "$remote_pr_progress"
git -C "$workspace_pr_progress" push -u origin main >/dev/null
git -C "$workspace_pr_progress" switch -c brownie-agent/smoke-pr >/dev/null
printf 'base prompt\n' > "$prompt_pr_progress"
printf -- '- [ ] B-01: create PR from tracked Brownie progress\n' > "$todo_pr_progress"
cat > "$fake_bin_dir/pnpm" <<'SH'
#!/usr/bin/env bash
exit 0
SH
chmod +x "$fake_bin_dir/pnpm"
cat > "$fake_bin_dir/gh" <<'SH'
#!/usr/bin/env bash
set -eu
case "${1:-} ${2:-}" in
  "api user")
    printf 'brownie-agent\n'
    ;;
  "auth token")
    printf 'fake-token\n'
    ;;
  "pr view")
    exit 1
    ;;
  "pr create")
    printf 'https://github.com/globalpocket/brownie/pull/9999\n'
    ;;
  *)
    exit 0
    ;;
esac
SH
chmod +x "$fake_bin_dir/gh"

PATH="$fake_bin_dir:$PATH" \
PHASE_LOOP_STATE_DIR="$state_pr_progress" \
PHASE_LOOP_PROMPT="$prompt_pr_progress" \
PHASE_LOOP_TODO="$todo_pr_progress" \
BROWNIE_BIN="$fake_brownie_tracked_workspace_change" \
PHASE_LOOP_WORKSPACE_ROOT="$workspace_pr_progress" \
PHASE_LOOP_CREATE_PR_AFTER_PROGRESS=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

python3 - "$state_pr_progress/status.json" "$workspace_pr_progress" <<'PY'
import json
import subprocess
import sys

status = json.load(open(sys.argv[1], encoding="utf-8"))
workspace = sys.argv[2]
assert status["status"] == "pr_created", status
assert "pull/9999" in status["detail"], status
head = subprocess.check_output(["git", "-C", workspace, "rev-parse", "HEAD"], text=True).strip()
remote = subprocess.check_output(["git", "-C", workspace, "rev-parse", "origin/brownie-agent/smoke-pr"], text=True).strip()
assert head == remote, (head, remote)
message = subprocess.check_output(["git", "-C", workspace, "log", "-1", "--format=%s"], text=True).strip()
assert "create PR from tracked Brownie progress" in message, message
PY

# A normal Runtime completion must publish tracked workspace progress before
# returning success when PR creation is enabled; completion is not an early
# return that bypasses the commit/push/PR path.
state_pr_completed_progress="$(mktemp -d)"
prompt_pr_completed_progress="$(mktemp)"
todo_pr_completed_progress="$(mktemp)"
workspace_pr_completed_progress="$(mktemp -d)"
remote_pr_completed_progress="$(mktemp -d)"
git -C "$workspace_pr_completed_progress" init -b main >/dev/null
mkdir -p "$workspace_pr_completed_progress/scripts"
cp "$REPO_ROOT/scripts/phase-loop-pr-actor-guard.mjs" "$workspace_pr_completed_progress/scripts/phase-loop-pr-actor-guard.mjs"
printf 'base\n' > "$workspace_pr_completed_progress/README.md"
git -C "$workspace_pr_completed_progress" add README.md
git -C "$workspace_pr_completed_progress" -c user.name=Brownie -c user.email=brownie@example.invalid commit -m init >/dev/null
git -C "$remote_pr_completed_progress" init --bare >/dev/null
git -C "$workspace_pr_completed_progress" remote add origin "$remote_pr_completed_progress"
git -C "$workspace_pr_completed_progress" push -u origin main >/dev/null
git -C "$workspace_pr_completed_progress" switch -c brownie-agent/smoke-pr-completed >/dev/null
printf 'base prompt\n' > "$prompt_pr_completed_progress"
printf -- '- [ ] B-01: create PR from completed tracked Brownie progress\n' > "$todo_pr_completed_progress"

PATH="$fake_bin_dir:$PATH" \
PHASE_LOOP_STATE_DIR="$state_pr_completed_progress" \
PHASE_LOOP_PROMPT="$prompt_pr_completed_progress" \
PHASE_LOOP_TODO="$todo_pr_completed_progress" \
BROWNIE_BIN="$fake_brownie_completed_tracked_workspace_change" \
PHASE_LOOP_WORKSPACE_ROOT="$workspace_pr_completed_progress" \
PHASE_LOOP_CREATE_PR_AFTER_PROGRESS=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

python3 - "$state_pr_completed_progress/status.json" "$workspace_pr_completed_progress" <<'PY'
import json
import subprocess
import sys

status = json.load(open(sys.argv[1], encoding="utf-8"))
workspace = sys.argv[2]
assert status["status"] == "pr_created", status
assert "pull/9999" in status["detail"], status
head = subprocess.check_output(["git", "-C", workspace, "rev-parse", "HEAD"], text=True).strip()
remote = subprocess.check_output(["git", "-C", workspace, "rev-parse", "origin/brownie-agent/smoke-pr-completed"], text=True).strip()
assert head == remote, (head, remote)
message = subprocess.check_output(["git", "-C", workspace, "log", "-1", "--format=%s"], text=True).strip()
assert "create PR from completed tracked Brownie progress" in message, message
PY

state_pr_supervise="$(mktemp -d)"
prompt_pr_supervise="$(mktemp)"
todo_pr_supervise="$(mktemp)"
workspace_pr_supervise="$(mktemp -d)"
remote_pr_supervise="$(mktemp -d)"
fake_supervise_bin_dir="$(mktemp -d)"
git -C "$workspace_pr_supervise" init -b main >/dev/null
mkdir -p "$workspace_pr_supervise/scripts"
cp "$REPO_ROOT/scripts/phase-loop-pr-actor-guard.mjs" "$workspace_pr_supervise/scripts/phase-loop-pr-actor-guard.mjs"
printf 'base\n' > "$workspace_pr_supervise/README.md"
git -C "$workspace_pr_supervise" add README.md
git -C "$workspace_pr_supervise" -c user.name=Brownie -c user.email=brownie@example.invalid commit -m init >/dev/null
git -C "$remote_pr_supervise" init --bare >/dev/null
git -C "$workspace_pr_supervise" remote add origin "$remote_pr_supervise"
git -C "$workspace_pr_supervise" push -u origin main >/dev/null
git -C "$workspace_pr_supervise" switch -c brownie-agent/smoke-pr-supervise >/dev/null
printf 'base prompt\n' > "$prompt_pr_supervise"
printf -- '- [ ] B-01: create PR then stop supervisor\n' > "$todo_pr_supervise"
cat > "$fake_supervise_bin_dir/pnpm" <<'SH'
#!/usr/bin/env bash
exit 0
SH
chmod +x "$fake_supervise_bin_dir/pnpm"
cat > "$fake_supervise_bin_dir/gh" <<'SH'
#!/usr/bin/env bash
set -eu
case "${1:-} ${2:-}" in
  "api user")
    printf 'brownie-agent\n'
    ;;
  "auth token")
    printf 'fake-token\n'
    ;;
  "pr view")
    exit 1
    ;;
  "pr create")
    printf 'https://github.com/globalpocket/brownie/pull/9998\n'
    ;;
  *)
    exit 0
    ;;
esac
SH
chmod +x "$fake_supervise_bin_dir/gh"

PATH="$fake_supervise_bin_dir:$PATH" \
PHASE_LOOP_STATE_DIR="$state_pr_supervise" \
PHASE_LOOP_PROMPT="$prompt_pr_supervise" \
PHASE_LOOP_TODO="$todo_pr_supervise" \
BROWNIE_BIN="$fake_brownie_tracked_workspace_change" \
PHASE_LOOP_WORKSPACE_ROOT="$workspace_pr_supervise" \
PHASE_LOOP_CREATE_PR_AFTER_PROGRESS=1 \
PHASE_LOOP_INTERVAL_SECONDS=30 \
run_with_timeout 20 env \
  "PATH=$fake_supervise_bin_dir:$PATH" \
  "PHASE_LOOP_STATE_DIR=$state_pr_supervise" \
  "PHASE_LOOP_PROMPT=$prompt_pr_supervise" \
  "PHASE_LOOP_TODO=$todo_pr_supervise" \
  "BROWNIE_BIN=$fake_brownie_tracked_workspace_change" \
  "PHASE_LOOP_WORKSPACE_ROOT=$workspace_pr_supervise" \
  "PHASE_LOOP_CREATE_PR_AFTER_PROGRESS=1" \
  "PHASE_LOOP_INTERVAL_SECONDS=30" \
  "$PHASE_LOOP" supervise >/dev/null 2>/dev/null

python3 - "$state_pr_supervise/status.json" "$state_pr_supervise/logs/supervisor.log" "$workspace_pr_supervise" <<'PY'
import json
import subprocess
import sys

status = json.load(open(sys.argv[1], encoding="utf-8"))
supervisor_log = open(sys.argv[2], encoding="utf-8").read()
workspace = sys.argv[3]
assert status["status"] == "pr_created", status
assert "pull/9998" in status["detail"], status
assert "pr_created observed; stopping supervisor for review" in supervisor_log, supervisor_log
head = subprocess.check_output(["git", "-C", workspace, "rev-parse", "HEAD"], text=True).strip()
remote = subprocess.check_output(["git", "-C", workspace, "rev-parse", "origin/brownie-agent/smoke-pr-supervise"], text=True).strip()
assert head == remote, (head, remote)
PY

actor_guard_missing_workspace="$(mktemp -d)"
actor_guard_missing_state="$(mktemp -d)"
mkdir -p "$actor_guard_missing_workspace/scripts"
set +e
PATH="$fake_bin_dir:$PATH" \
PHASE_LOOP_STATE_DIR="$actor_guard_missing_state" \
PHASE_LOOP_WORKSPACE_ROOT="$actor_guard_missing_workspace" \
bash -c 'script=$1; set --; source "$script" >/dev/null; phase_loop_require_implementation_pr_actor' _ "$PHASE_LOOP"
actor_guard_missing_exit="$?"
set -e
test "$actor_guard_missing_exit" = "1"

actor_guard_invalid_workspace="$(mktemp -d)"
actor_guard_invalid_state="$(mktemp -d)"
actor_guard_invalid_bin_dir="$(mktemp -d)"
mkdir -p "$actor_guard_invalid_workspace/scripts"
cp "$REPO_ROOT/scripts/phase-loop-pr-actor-guard.mjs" "$actor_guard_invalid_workspace/scripts/phase-loop-pr-actor-guard.mjs"
cat > "$actor_guard_invalid_bin_dir/gh" <<'SH'
#!/usr/bin/env bash
set -eu
if [ "${1:-} ${2:-}" = "api user" ]; then
  printf 'globalpocket\n'
  exit 0
fi
exit 1
SH
chmod +x "$actor_guard_invalid_bin_dir/gh"
set +e
PATH="$actor_guard_invalid_bin_dir:$PATH" \
PHASE_LOOP_STATE_DIR="$actor_guard_invalid_state" \
PHASE_LOOP_WORKSPACE_ROOT="$actor_guard_invalid_workspace" \
bash -c 'script=$1; set --; source "$script" >/dev/null; phase_loop_require_implementation_pr_actor' _ "$PHASE_LOOP"
actor_guard_invalid_exit="$?"
set -e
test "$actor_guard_invalid_exit" = "1"
fi

if claim_smoke_section_enabled lifecycle; then
state_truncated="$(mktemp -d)"
prompt_truncated="$(mktemp)"
todo_truncated="$(mktemp)"
printf 'base line 1\nbase line 2\n' > "$prompt_truncated"
printf -- '- [ ] B-01: truncation metadata task\n- [ ] B-02: hidden from snapshot\n' > "$todo_truncated"

PHASE_LOOP_STATE_DIR="$state_truncated" \
PHASE_LOOP_PROMPT="$prompt_truncated" \
PHASE_LOOP_TODO="$todo_truncated" \
BROWNIE_BIN="$fake_brownie_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
PHASE_LOOP_TODO_SNAPSHOT_LINES=1 \
PHASE_LOOP_BASE_PROMPT_SNAPSHOT_LINES=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

truncated_prompt="$(find "$state_truncated/runs" -name '*.prompt.md' -print | sort | tail -n 1)"
python3 - "${truncated_prompt%.prompt.md}.prompt.meta.json" <<'PY'
import json
import sys

meta = json.load(open(sys.argv[1], encoding="utf-8"))
assert meta["todo_snapshot_truncated"] is True, meta
assert meta["base_prompt_snapshot_truncated"] is True, meta
assert meta["selected_todo_complete"] is False, meta
assert meta["selected_todo_completion_reason"] == "selected_todo_still_unchecked", meta
PY

state_retention="$(mktemp -d)"
prompt_retention="$(mktemp)"
todo_retention="$(mktemp)"
mkdir -p "$state_retention/runs"
printf 'base prompt\n' > "$prompt_retention"
printf -- '- [ ] B-01: retention task\n' > "$todo_retention"
for old in 1 2 3; do
  printf 'old prompt %s\n' "$old" > "$state_retention/runs/20000101T00000${old}Z.prompt.md"
  printf '{}\n' > "$state_retention/runs/20000101T00000${old}Z.prompt.meta.json"
done

PHASE_LOOP_STATE_DIR="$state_retention" \
PHASE_LOOP_PROMPT="$prompt_retention" \
PHASE_LOOP_TODO="$todo_retention" \
BROWNIE_BIN="$fake_brownie_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
PHASE_LOOP_PROMPT_RETENTION_COUNT=2 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

retained_prompt_count="$(find "$state_retention/runs" -name '*.prompt.md' | wc -l | tr -d ' ')"
if [ "$retained_prompt_count" -gt 2 ]; then
  echo "expected prompt retention to keep at most 2 prompts, found $retained_prompt_count" >&2
  exit 1
fi

state_too_large="$(mktemp -d)"
prompt_too_large="$(mktemp)"
todo_too_large="$(mktemp)"
printf 'base prompt\n' > "$prompt_too_large"
printf -- '- [ ] B-01: selected todo too large for configured bound\n' > "$todo_too_large"

if PHASE_LOOP_STATE_DIR="$state_too_large" \
  PHASE_LOOP_PROMPT="$prompt_too_large" \
  PHASE_LOOP_TODO="$todo_too_large" \
  BROWNIE_BIN="$fake_brownie_json" \
  PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
  PHASE_LOOP_SELECTED_TODO_MAX_BYTES=8 \
  run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null 2>/dev/null; then
  echo "expected oversized selected TODO to fail closed before Runtime start" >&2
  exit 1
fi

python3 - "$state_too_large/status.json" <<'PY'
import json
import sys

status = json.load(open(sys.argv[1], encoding="utf-8"))
assert status["status"] == "blocked", status
assert "effective phase-loop prompt" in status["detail"], status
PY

state_stale_claim="$(mktemp -d)"
prompt_stale_claim="$(mktemp)"
todo_stale_claim="$(mktemp)"
printf 'base prompt\n' > "$prompt_stale_claim"
printf -- '- [ ] B-new: fresh queue task\n' > "$todo_stale_claim"

PHASE_LOOP_STATE_DIR="$state_stale_claim" \
PHASE_LOOP_PROMPT="$prompt_stale_claim" \
PHASE_LOOP_TODO="$todo_stale_claim" \
BROWNIE_BIN="$fake_brownie_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
PHASE_LOOP_TEST_MUTATE_TODO_AFTER_PROMPT=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

python3 - "$state_stale_claim/todo-claims/current.json" "$state_stale_claim/todo-claims" "$todo_stale_claim" <<'PY'
import json
import pathlib
import sys

claim = json.load(open(sys.argv[1], encoding="utf-8"))
archive_dir = pathlib.Path(sys.argv[2])
todo_text = pathlib.Path(sys.argv[3]).read_text(encoding="utf-8")
archives = list(archive_dir.glob("stale-*.json"))
assert archives, "missing stale claim archive"
assert claim["claim_id"].startswith("todo-g"), claim
assert claim["selected_todo"].startswith("- [ ] B-new: fresh queue task"), claim
assert "PHASE_LOOP_TEST_MUTATED_TODO_AFTER_PROMPT" in todo_text, todo_text
PY

state_generation="$(mktemp -d)"
prompt_generation="$(mktemp)"
todo_generation="$(mktemp)"
printf 'base prompt\n' > "$prompt_generation"
printf -- '- [ ] B-01: first generation\n' > "$todo_generation"

PHASE_LOOP_STATE_DIR="$state_generation" \
PHASE_LOOP_PROMPT="$prompt_generation" \
PHASE_LOOP_TODO="$todo_generation" \
BROWNIE_BIN="$fake_brownie_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

rm "$state_generation/todo-claims/current.json"
printf -- '- [ ] B-00: externally inserted higher priority\n- [ ] B-01: first generation\n' > "$todo_generation"

PHASE_LOOP_STATE_DIR="$state_generation" \
PHASE_LOOP_PROMPT="$prompt_generation" \
PHASE_LOOP_TODO="$todo_generation" \
BROWNIE_BIN="$fake_brownie_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

python3 - "$state_generation/todo-claims/current.json" "$state_generation/todo-claims/todo-queue-state.json" <<'PY'
import json
import sys

claim = json.load(open(sys.argv[1], encoding="utf-8"))
queue_state = json.load(open(sys.argv[2], encoding="utf-8"))
assert queue_state["generation"] == 2, queue_state
assert claim["queue_generation"] == 2, claim
assert claim["selected_todo"].startswith("- [ ] B-00: externally inserted"), claim
assert claim["queue_fingerprint"] == queue_state["fingerprint"], (claim, queue_state)
PY

state_same_head_queue_growth="$(mktemp -d)"
prompt_same_head_queue_growth="$(mktemp)"
todo_same_head_queue_growth="$(mktemp)"
printf 'base prompt\n' > "$prompt_same_head_queue_growth"
printf -- '- [ ] B-01: stable first task\n' > "$todo_same_head_queue_growth"

PHASE_LOOP_STATE_DIR="$state_same_head_queue_growth" \
PHASE_LOOP_PROMPT="$prompt_same_head_queue_growth" \
PHASE_LOOP_TODO="$todo_same_head_queue_growth" \
BROWNIE_BIN="$fake_brownie_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

printf -- '- [ ] B-01: stable first task\n- [ ] B-02: appended follow-up task\n' > "$todo_same_head_queue_growth"

PHASE_LOOP_STATE_DIR="$state_same_head_queue_growth" \
PHASE_LOOP_PROMPT="$prompt_same_head_queue_growth" \
PHASE_LOOP_TODO="$todo_same_head_queue_growth" \
BROWNIE_BIN="$fake_brownie_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

python3 - "$state_same_head_queue_growth/todo-claims/current.json" "$state_same_head_queue_growth/todo-claims/todo-queue-state.json" "$todo_same_head_queue_growth" <<'PY'
import hashlib
import json
import pathlib
import sys

claim = json.load(open(sys.argv[1], encoding="utf-8"))
queue_state = json.load(open(sys.argv[2], encoding="utf-8"))
todo_text = pathlib.Path(sys.argv[3]).read_text(encoding="utf-8")
fingerprint = hashlib.sha256(todo_text.encode("utf-8")).hexdigest()
assert claim["selected_todo"].startswith("- [ ] B-01: stable first task"), claim
assert claim["queue_fingerprint"] == fingerprint, claim
assert queue_state["fingerprint"] == fingerprint, queue_state
assert claim["queue_generation"] == queue_state["generation"], (claim, queue_state)
assert claim["queue_generation"] == 2, claim
PY

state_legacy="$(mktemp -d)"
prompt_legacy="$(mktemp)"
todo_legacy="$(mktemp)"
mkdir -p "$state_legacy/todo-claims"
printf 'base prompt\n' > "$prompt_legacy"
printf -- '- [ ] B-legacy: migrated claim\n' > "$todo_legacy"
legacy_fingerprint="$(shasum -a 256 "$todo_legacy" | awk '{ print $1 }')"
python3 - "$state_legacy/todo-claims/current.json" "$legacy_fingerprint" "$todo_legacy" <<'PY'
import json
import sys

claim = {
    "schema_version": 1,
    "claim_id": "todo-legacy-claim",
    "selected_todo": "- [ ] B-legacy: migrated claim",
    "queue_fingerprint": sys.argv[2],
    "todo_path": sys.argv[3],
    "created_at": "2026-09-06T00:00:00Z",
    "updated_at": "2026-09-06T00:00:00Z",
    "run_stamp": "legacy",
    "status": "in_progress",
    "status_history": [{"status": "in_progress", "run_stamp": "legacy", "updated_at": "2026-09-06T00:00:00Z"}],
}
with open(sys.argv[1], "w", encoding="utf-8") as handle:
    json.dump(claim, handle)
    handle.write("\n")
PY
chmod 600 "$state_legacy/todo-claims/current.json"

PHASE_LOOP_STATE_DIR="$state_legacy" \
PHASE_LOOP_PROMPT="$prompt_legacy" \
PHASE_LOOP_TODO="$todo_legacy" \
BROWNIE_BIN="$fake_brownie_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

python3 - "$state_legacy/todo-claims/current.json" "$todo_legacy" <<'PY'
import json
import pathlib
import sys

claim = json.load(open(sys.argv[1], encoding="utf-8"))
todo_text = pathlib.Path(sys.argv[2]).read_text(encoding="utf-8")
assert claim["claim_id"] == "todo-legacy-claim", claim
assert claim["queue_generation"] == 2, claim
assert claim["baseline_todo_text"] == todo_text, claim
assert claim["status"] == "in_progress", claim
PY

state_empty="$(mktemp -d)"
prompt_empty="$(mktemp)"
todo_empty="$(mktemp)"
printf 'base prompt\n' > "$prompt_empty"

if PHASE_LOOP_STATE_DIR="$state_empty" \
  PHASE_LOOP_PROMPT="$prompt_empty" \
  PHASE_LOOP_TODO="$todo_empty" \
  BROWNIE_BIN="$fake_brownie_json" \
  PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
  run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null; then
  echo "expected empty queue without an active claim to stop instead of run" >&2
  exit 1
fi

python3 - "$state_empty/status.json" <<'PY'
import json
import sys

status = json.load(open(sys.argv[1], encoding="utf-8"))
assert status["status"] == "stopped", status
PY

test -f "$state_empty/stop"

state_empty_dirty="$(mktemp -d)"
prompt_empty_dirty="$(mktemp)"
todo_empty_dirty="$(mktemp)"
printf 'base prompt\n' > "$prompt_empty_dirty"
git -C "$test_workspace" checkout -b abandoned-work >/dev/null
printf 'unrelated local edit\n' > "$test_workspace/unrelated.txt"

if PHASE_LOOP_STATE_DIR="$state_empty_dirty" \
  PHASE_LOOP_PROMPT="$prompt_empty_dirty" \
  PHASE_LOOP_TODO="$todo_empty_dirty" \
  BROWNIE_BIN="$fake_brownie_json" \
  PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
  run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null; then
  echo "expected empty queue without durable claim to stop even with dirty/non-main workspace" >&2
  exit 1
fi

python3 - "$state_empty_dirty/status.json" <<'PY'
import json
import sys

status = json.load(open(sys.argv[1], encoding="utf-8"))
assert status["status"] == "stopped", status
assert "durable in-progress claim" in status["detail"], status
PY

state_invalid_json="$(mktemp -d)"
prompt_invalid_json="$(mktemp)"
todo_invalid_json="$(mktemp)"
printf 'base prompt\n' > "$prompt_invalid_json"
printf -- '- [ ] B-01: invalid json task\n' > "$todo_invalid_json"

if PHASE_LOOP_STATE_DIR="$state_invalid_json" \
  PHASE_LOOP_PROMPT="$prompt_invalid_json" \
  PHASE_LOOP_TODO="$todo_invalid_json" \
  BROWNIE_BIN="$fake_brownie_invalid_json" \
  PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
  run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null; then
  echo "expected non-JSON CLI output to fail closed" >&2
  exit 1
fi

python3 - "$state_invalid_json/status.json" "$state_invalid_json/todo-claims/current.json" <<'PY'
import json
import sys

status = json.load(open(sys.argv[1], encoding="utf-8"))
claim = json.load(open(sys.argv[2], encoding="utf-8"))
assert status["status"] == "blocked", status
assert "JSON output failed schema validation" in status["detail"], status
assert claim["status"] == "blocked", claim
PY

state_interruptible="$(mktemp -d)"
prompt_interruptible="$(mktemp)"
todo_interruptible="$(mktemp)"
printf 'base prompt\n' > "$prompt_interruptible"
printf -- '- [ ] B-12: interruptible backoff task\n' > "$todo_interruptible"

PHASE_LOOP_STATE_DIR="$state_interruptible" \
PHASE_LOOP_PROMPT="$prompt_interruptible" \
PHASE_LOOP_TODO="$todo_interruptible" \
BROWNIE_BIN="$fake_brownie_invalid_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
PHASE_LOOP_FAILURE_BACKOFF_SECONDS=30 \
PHASE_LOOP_MAX_FAILURE_BACKOFF_SECONDS=30 \
PHASE_LOOP_SLEEP_POLL_SECONDS=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" supervise >/dev/null 2>/dev/null &
interruptible_pid="$!"

for _ in 1 2 3 4 5; do
  if [ -f "$state_interruptible/status.json" ] && rg -q '"status": "blocked"' "$state_interruptible/status.json"; then
    break
  fi
  sleep 1
done

start_epoch="$(date +%s)"
PHASE_LOOP_STATE_DIR="$state_interruptible" "$PHASE_LOOP" stop >/dev/null
wait_for_pid_exit "$interruptible_pid" 8
elapsed=$(( $(date +%s) - start_epoch ))
if [ "$elapsed" -gt 5 ]; then
  echo "expected stop to interrupt supervisor backoff promptly, elapsed=${elapsed}s" >&2
  exit 1
fi

python3 - "$state_interruptible/status.json" <<'PY'
import json
import sys

status = json.load(open(sys.argv[1], encoding="utf-8"))
assert status["status"] == "stopped", status
PY

state_child_stop="$(mktemp -d)"
prompt_child_stop="$(mktemp)"
todo_child_stop="$(mktemp)"
child_pid_file="$state_child_stop/child.pid"
printf 'base prompt\n' > "$prompt_child_stop"
printf -- '- [ ] B-11: child-inclusive stop task\n' > "$todo_child_stop"

PHASE_LOOP_STATE_DIR="$state_child_stop" \
PHASE_LOOP_PROMPT="$prompt_child_stop" \
PHASE_LOOP_TODO="$todo_child_stop" \
BROWNIE_BIN="$fake_brownie_sleeping_child" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
PHASE_LOOP_TEST_CHILD_PID_FILE="$child_pid_file" \
PHASE_LOOP_STOP_GRACE_SECONDS=1 \
PHASE_LOOP_STOP_FORCE_SECONDS=3 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" supervise >/dev/null 2>/dev/null &
child_supervisor_pid="$!"

for _ in 1 2 3 4 5; do
  if [ -s "$child_pid_file" ]; then
    break
  fi
  sleep 1
done
if [ ! -s "$child_pid_file" ]; then
  echo "expected fake Brownie child pid file" >&2
  kill "$child_supervisor_pid" 2>/dev/null || true
  exit 1
fi
child_pid="$(cat "$child_pid_file")"

PHASE_LOOP_STATE_DIR="$state_child_stop" \
PHASE_LOOP_STOP_GRACE_SECONDS=1 \
PHASE_LOOP_STOP_FORCE_SECONDS=3 \
"$PHASE_LOOP" stop >/dev/null
wait_for_pid_exit "$child_supervisor_pid" 8
sleep 1
if kill -0 "$child_pid" 2>/dev/null; then
  echo "expected stop to terminate supervisor-managed child pid=$child_pid" >&2
  kill -KILL "$child_pid" 2>/dev/null || true
  exit 1
fi
fi

if claim_smoke_section_enabled guards; then
exact_workspace="$(mktemp -d)"
git -C "$exact_workspace" init -b main >/dev/null
git -C "$exact_workspace" config user.name Brownie
git -C "$exact_workspace" config user.email brownie@example.invalid
mkdir -p "$exact_workspace/docs"
cat > "$exact_workspace/docs/golden.js" <<'EOF'
export const evidence = {
  status: 'failed',
  release_blocking: true,
  fixture_path: fixtureRoot,
  commands,
};
EOF
git -C "$exact_workspace" add docs/golden.js
git -C "$exact_workspace" commit -m init >/dev/null

fake_brownie_should_not_run="$(mktemp)"
cat > "$fake_brownie_should_not_run" <<'SH'
#!/usr/bin/env bash
echo "Brownie should not run for deterministic exact-line TODO fast path" >&2
exit 99
SH
chmod +x "$fake_brownie_should_not_run"

state_exact_fast_path="$(mktemp -d)"
prompt_exact_fast_path="$(mktemp)"
todo_exact_fast_path="$(mktemp)"
printf 'base prompt\n' > "$prompt_exact_fast_path"
cat > "$todo_exact_fast_path" <<'EOF'
- [ ] E-exact: Patch only `docs/golden.js`.
  In the return object, add exactly one line
  `  lifecycle_evidence: lifecycleEvidence,`
  immediately after the exact line `  fixture_path: fixtureRoot,`. Do not edit
  any other line.
EOF

PHASE_LOOP_STATE_DIR="$state_exact_fast_path" \
PHASE_LOOP_PROMPT="$prompt_exact_fast_path" \
PHASE_LOOP_TODO="$todo_exact_fast_path" \
BROWNIE_BIN="$fake_brownie_should_not_run" \
PHASE_LOOP_WORKSPACE_ROOT="$exact_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

python3 - "$state_exact_fast_path/status.json" "$state_exact_fast_path/todo-claims/current.json" "$todo_exact_fast_path" "$exact_workspace/docs/golden.js" <<'PY'
import json
import pathlib
import sys

status = json.load(open(sys.argv[1], encoding="utf-8"))
claim = json.load(open(sys.argv[2], encoding="utf-8"))
todo = pathlib.Path(sys.argv[3]).read_text(encoding="utf-8")
target = pathlib.Path(sys.argv[4]).read_text(encoding="utf-8")
assert status["status"] == "last_run_succeeded", status
assert "deterministic exact-line TODO fast path" in status["detail"], status
assert claim["status"] == "completed", claim
assert "E-exact" not in todo, todo
assert "  fixture_path: fixtureRoot,\n  lifecycle_evidence: lifecycleEvidence,\n  commands," in target, target
PY

empty_queue_guard_workspace="$(mktemp -d)"
git -C "$empty_queue_guard_workspace" init -b main >/dev/null
git -C "$empty_queue_guard_workspace" config user.name Brownie
git -C "$empty_queue_guard_workspace" config user.email brownie@example.invalid
mkdir -p "$empty_queue_guard_workspace/.brownie" "$empty_queue_guard_workspace/docs/architecture" "$empty_queue_guard_workspace/scripts" "$empty_queue_guard_workspace/docs"
cp "$REPO_ROOT/scripts/guard-todo-decomposition.mjs" "$empty_queue_guard_workspace/scripts/guard-todo-decomposition.mjs"
cp "$REPO_ROOT/scripts/phase-loop-todo-state.mjs" "$empty_queue_guard_workspace/scripts/phase-loop-todo-state.mjs"
printf '{"scripts":{}}\n' > "$empty_queue_guard_workspace/package.json"
printf '{"product_ready":false}\n' > "$empty_queue_guard_workspace/docs/architecture/phase-value-manifest.json"
cat > "$empty_queue_guard_workspace/docs/golden.js" <<'EOF'
export const evidence = {
  status: 'failed',
  release_blocking: true,
  fixture_path: fixtureRoot,
  commands,
};
EOF
git -C "$empty_queue_guard_workspace" add .
git -C "$empty_queue_guard_workspace" commit -m init >/dev/null

state_empty_queue_guard="$(mktemp -d)"
prompt_empty_queue_guard="$(mktemp)"
todo_empty_queue_guard="$empty_queue_guard_workspace/.brownie/todo.md"
printf 'base prompt\n' > "$prompt_empty_queue_guard"
cat > "$todo_empty_queue_guard" <<'EOF'
- [ ] E-empty-queue-exact: Patch only `docs/golden.js`.
  In the return object, add exactly one line
  `  lifecycle_evidence: lifecycleEvidence,`
  immediately after the exact line `  fixture_path: fixtureRoot,`. Do not edit
  any other line.
EOF

empty_queue_guard_ledger="$empty_queue_guard_workspace/.brownie/private/phase-loop/task-ledger.jsonl"
empty_queue_guard_runtime_marker="$state_empty_queue_guard/runtime-invoked"
fake_brownie_empty_queue_cleanup_must_not_run="$(mktemp)"
cat > "$fake_brownie_empty_queue_cleanup_must_not_run" <<SH
#!/usr/bin/env bash
set -eu
printf 'runtime-invoked\n' >> "$empty_queue_guard_runtime_marker"
echo "Brownie must not run during completed TODO cleanup-only retry" >&2
exit 99
SH
chmod +x "$fake_brownie_empty_queue_cleanup_must_not_run"

set +e
PHASE_LOOP_STATE_DIR="$state_empty_queue_guard" \
PHASE_LOOP_PROMPT="$prompt_empty_queue_guard" \
PHASE_LOOP_TODO="$todo_empty_queue_guard" \
BROWNIE_BIN="$fake_brownie_should_not_run" \
PHASE_LOOP_WORKSPACE_ROOT="$empty_queue_guard_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null
empty_queue_guard_exit="$?"
set -e
test "$empty_queue_guard_exit" = "76"

python3 - "$state_empty_queue_guard/todo-claims/current.json" "$todo_empty_queue_guard" "$state_empty_queue_guard/logs/supervisor.log" "$empty_queue_guard_workspace/docs/golden.js" <<'PY'
import json
import pathlib
import sys

claim = json.load(open(sys.argv[1], encoding="utf-8"))
todo = pathlib.Path(sys.argv[2]).read_text(encoding="utf-8")
supervisor_log = pathlib.Path(sys.argv[3]).read_text(encoding="utf-8")
target = pathlib.Path(sys.argv[4]).read_text(encoding="utf-8")
assert claim["status"] == "completed", claim
assert claim["completion_cleanup_pending"] is True, claim
assert "E-empty-queue-exact" in todo, todo
assert "completed_todo_removal_reverted=true" in supervisor_log, supervisor_log
assert "Empty or non-executable TODO queue" in supervisor_log, supervisor_log
assert "  fixture_path: fixtureRoot,\n  lifecycle_evidence: lifecycleEvidence,\n  commands," in target, target
PY

python3 - "$empty_queue_guard_ledger" "$state_empty_queue_guard/todo-claims/current.json" <<'PY'
import json
import pathlib
import sys

ledger = pathlib.Path(sys.argv[1])
claim = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding="utf-8"))
claim_id = claim["claim_id"]
records = [json.loads(line) for line in ledger.read_text(encoding="utf-8").splitlines() if line.strip()]
events = [
    event
    for record in records
    for event in (record.get("events", []) if record.get("kind") in ("replan_transaction", "terminal_failure_transaction") else [record])
]
source_attempt = [event for event in events if event.get("task_id") == f"E-empty-queue-exact@{claim_id}"]
assert source_attempt, events
assert source_attempt[-1]["to_state"] == "completed", source_attempt
assert all(event["to_state"] in ("queued", "claimed", "running", "completed") for event in source_attempt), source_attempt
PY

# Once the decomposition guard condition is repaired, the next invocation must
# retry only queue cleanup. It must not restart Runtime for the completed
# source claim, and it must clear the cleanup marker after successful removal.
printf '{"product_ready":true}\n' > "$empty_queue_guard_workspace/docs/architecture/phase-value-manifest.json"
set +e
PHASE_LOOP_STATE_DIR="$state_empty_queue_guard" \
PHASE_LOOP_PROMPT="$prompt_empty_queue_guard" \
PHASE_LOOP_TODO="$todo_empty_queue_guard" \
BROWNIE_BIN="$fake_brownie_empty_queue_cleanup_must_not_run" \
PHASE_LOOP_WORKSPACE_ROOT="$empty_queue_guard_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 75 "$PHASE_LOOP" run-once >/dev/null
empty_queue_guard_cleanup_exit="$?"
set -e
test "$empty_queue_guard_cleanup_exit" = "75"
test ! -e "$empty_queue_guard_runtime_marker"

python3 - "$state_empty_queue_guard/todo-claims/current.json" "$todo_empty_queue_guard" "$state_empty_queue_guard/logs/supervisor.log" <<'PY'
import json
import pathlib
import sys

claim = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
todo = pathlib.Path(sys.argv[2]).read_text(encoding="utf-8")
supervisor_log = pathlib.Path(sys.argv[3]).read_text(encoding="utf-8")
assert claim["status"] == "completed", claim
assert claim["completion_cleanup_pending"] is False, claim
assert "E-empty-queue-exact" not in todo, todo
assert "completed_todo_cleanup_retry_succeeded=true" in supervisor_log, supervisor_log
PY

verified_noop_e19_workspace="$(mktemp -d)"
git -C "$verified_noop_e19_workspace" init -b main >/dev/null
git -C "$verified_noop_e19_workspace" config user.name Brownie
git -C "$verified_noop_e19_workspace" config user.email brownie@example.invalid
mkdir -p "$verified_noop_e19_workspace/.brownie" "$verified_noop_e19_workspace/docs/architecture" "$verified_noop_e19_workspace/scripts" "$verified_noop_e19_workspace/extensions/brownie-vsix"
cp "$REPO_ROOT/phase-loop.sh" "$verified_noop_e19_workspace/phase-loop.sh"
cp "$REPO_ROOT/package.json" "$verified_noop_e19_workspace/package.json"
cp "$REPO_ROOT/extensions/brownie-vsix/package.json" "$verified_noop_e19_workspace/extensions/brownie-vsix/package.json"
cp "$REPO_ROOT/scripts/phase-loop-claim-smoke.test.sh" "$verified_noop_e19_workspace/scripts/phase-loop-claim-smoke.test.sh"
cp "$REPO_ROOT/scripts/guard-todo-decomposition.mjs" "$verified_noop_e19_workspace/scripts/guard-todo-decomposition.mjs"
cp "$REPO_ROOT/scripts/phase-loop-todo-state.mjs" "$verified_noop_e19_workspace/scripts/phase-loop-todo-state.mjs"
printf '{"product_ready":false}\n' > "$verified_noop_e19_workspace/docs/architecture/phase-value-manifest.json"
cat > "$verified_noop_e19_workspace/.brownie/todo.md" <<'EOF'
- [ ] E-19a-prevent-empty-queue-completion: Patch only `phase-loop.sh` so completed TODO removal is reverted when the resulting `.brownie/todo.md` fails the decomposition guard:
  Route: implementation.
  Source TODO: empty-queue-regression-follow-up-2026-09-22.
  Depends on: <none>.
  Completion condition: release blocker queues cannot become empty while Product Ready is false; attempted completion removal is reverted while the durable claim remains completed with cleanup pending when the guard rejects the resulting queue.
  Forbidden changes: do not weaken `scripts/guard-todo-decomposition.mjs`, do not declare Runtime Product Ready or Runtime Release Ready, and do not remove remaining release blocker TODOs.
  Verification: run `pnpm --workspace-root phase-loop:claim-smoke`, `pnpm --workspace-root guard:todo-decomposition:test`, and `pnpm --workspace-root guard:todo-decomposition`.

- [ ] E-19b-refresh-owner-governance-evidence-after-stable-ci: Blocker: release blocker evidence remains fail-closed until owner governance evidence reflects completed latest-main CI instead of pending checks.
  Verification: inspect latest main CI completion and fail-closed owner governance evidence, then keep the blocker if GitHub checks are still pending or unavailable.
EOF
git -C "$verified_noop_e19_workspace" add .
git -C "$verified_noop_e19_workspace" commit -m init >/dev/null

state_verified_noop_e19="$(mktemp -d)"
prompt_verified_noop_e19="$(mktemp)"
fake_verified_noop_bin_dir="$(mktemp -d)"
printf 'base prompt\n' > "$prompt_verified_noop_e19"
cat > "$fake_verified_noop_bin_dir/pnpm" <<'SH'
#!/usr/bin/env bash
printf 'E-19 verified-noop must not invoke pnpm verification commands\n' >&2
exit 91
SH
chmod +x "$fake_verified_noop_bin_dir/pnpm"

PATH="$fake_verified_noop_bin_dir:$PATH" \
PHASE_LOOP_STATE_DIR="$state_verified_noop_e19" \
PHASE_LOOP_PROMPT="$prompt_verified_noop_e19" \
PHASE_LOOP_TODO="$verified_noop_e19_workspace/.brownie/todo.md" \
BROWNIE_BIN="$fake_brownie_should_not_run" \
PHASE_LOOP_WORKSPACE_ROOT="$verified_noop_e19_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

python3 - "$state_verified_noop_e19/status.json" "$state_verified_noop_e19/todo-claims/current.json" "$verified_noop_e19_workspace/.brownie/todo.md" <<'PY'
import json
import pathlib
import sys

status = json.load(open(sys.argv[1], encoding="utf-8"))
claim = json.load(open(sys.argv[2], encoding="utf-8"))
todo = pathlib.Path(sys.argv[3]).read_text(encoding="utf-8")
assert status["status"] == "last_run_succeeded", status
assert "Selected bounded TODO verification already passed" in status["detail"], status
assert "semantic_wiring_already_present_without_verification_commands" in status["detail"], status
assert claim["status"] == "completed", claim
assert "E-19a-prevent-empty-queue-completion" not in todo, todo
assert "E-19b-refresh-owner-governance-evidence-after-stable-ci" in todo, todo
PY

python3 - "$PHASE_LOOP" <<'PY'
import pathlib
import sys

phase_loop = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
start = phase_loop.index("try_selected_todo_verified_noop_completion_fallback()")
end = phase_loop.index("try_exact_line_todo_fast_path()", start)
verified_noop_source = phase_loop[start:end]
assert "verification_already_passed" not in verified_noop_source, verified_noop_source
assert "selected_todo_dirty_baseline_verified_completion" in verified_noop_source, verified_noop_source
assert "selected_scopes_dirty_at_baseline" in verified_noop_source, verified_noop_source
assert "dirty_baseline_verification_command_not_allowed" in verified_noop_source, verified_noop_source
assert "selected_todo_dirty_baseline_requires_semantic_repair" in verified_noop_source, verified_noop_source
assert "raise SystemExit(1)" in verified_noop_source, verified_noop_source
assert "semantic_wiring_already_present_without_verification_commands" in verified_noop_source, verified_noop_source
PY

release_ops_workspace="$(mktemp -d)"
mkdir -p "$release_ops_workspace/.brownie/release-evidence" "$release_ops_workspace/docs/architecture" "$release_ops_workspace/scripts"
cp "$REPO_ROOT/phase-loop.sh" "$release_ops_workspace/phase-loop.sh"
cp "$REPO_ROOT/scripts/guard-todo-decomposition.mjs" "$release_ops_workspace/scripts/guard-todo-decomposition.mjs"
cp "$REPO_ROOT/scripts/phase-loop-todo-state.mjs" "$release_ops_workspace/scripts/phase-loop-todo-state.mjs"
cp "$REPO_ROOT/scripts/phase-loop-todo-evaluator.mjs" "$release_ops_workspace/scripts/phase-loop-todo-evaluator.mjs"
cp "$REPO_ROOT/scripts/phase-loop-release-ops-blocker.mjs" "$release_ops_workspace/scripts/phase-loop-release-ops-blocker.mjs"
printf '{"scripts":{}}\n' > "$release_ops_workspace/package.json"
printf '{"product_ready":false}\n' > "$release_ops_workspace/docs/architecture/phase-value-manifest.json"
git -C "$release_ops_workspace" init -b main >/dev/null
git -C "$release_ops_workspace" config user.name Brownie
git -C "$release_ops_workspace" config user.email brownie@example.invalid
cat > "$release_ops_workspace/.brownie/release-evidence/owner-governance-evidence.json" <<'EOF'
{
  "schema_version": 1,
  "evidence_id": "brownie-owner-governance-evidence-v1",
  "release_ready": false,
  "runtime_release_ready": false,
  "source_commit": "old",
  "sections": {
    "remote_ci_workflow_provenance": {
      "workflow_head_sha": "old",
      "workflow_conclusion": "success",
      "missing_or_failed_required_check_names": []
    }
  }
}
EOF
git -C "$release_ops_workspace" add .
git -C "$release_ops_workspace" commit -m init >/dev/null
release_ops_head="$(git -C "$release_ops_workspace" rev-parse HEAD)"
python3 - "$release_ops_workspace/.brownie/release-evidence/owner-governance-evidence.json" "$release_ops_head" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
head = sys.argv[2]
data = json.loads(path.read_text(encoding="utf-8"))
data["source_commit"] = head
data["sections"]["remote_ci_workflow_provenance"]["workflow_head_sha"] = head
data["sections"]["remote_ci_workflow_provenance"]["last_verified_at"] = "2026-09-22T00:00:00Z"
path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
PY

release_ops_state="$(mktemp -d)"
release_ops_prompt="$(mktemp)"
printf 'base prompt\n' > "$release_ops_prompt"
cat > "$release_ops_workspace/.brownie/todo.md" <<'EOF'
- [ ] E-release-ops-refresh: Patch only `.brownie/release-evidence/owner-governance-evidence.json` after latest main CI is complete and stable:
  Route: release-ops.
  Source TODO: release-ops-smoke.
  Depends on: <none>.
  Completion condition: owner governance evidence reflects the completed current HEAD CI while release readiness remains fail-closed.
  Forbidden changes: do not declare Runtime Product Ready, Runtime Release Ready, public Release Ready, or alter unrelated release evidence files.
  Verification: inspect latest main CI completion and fail-closed owner governance evidence, then keep the blocker if release readiness remains unavailable.
EOF

PATH="$fake_verified_noop_bin_dir:$PATH" \
PHASE_LOOP_STATE_DIR="$release_ops_state" \
PHASE_LOOP_PROMPT="$release_ops_prompt" \
PHASE_LOOP_TODO="$release_ops_workspace/.brownie/todo.md" \
BROWNIE_BIN="$fake_brownie_should_not_run" \
PHASE_LOOP_WORKSPACE_ROOT="$release_ops_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

python3 - "$release_ops_state/status.json" "$release_ops_state/todo-claims/current.json" "$release_ops_workspace/.brownie/todo.md" <<'PY'
import json
import pathlib
import sys

status = json.load(open(sys.argv[1], encoding="utf-8"))
claim = json.load(open(sys.argv[2], encoding="utf-8"))
todo = pathlib.Path(sys.argv[3]).read_text(encoding="utf-8")
assert status["status"] == "last_run_succeeded", status
assert "release-ops evidence refresh" in status["detail"], status
assert claim["status"] == "completed", claim
assert "E-release-ops-refresh-remaining-blocker" in todo, todo
assert "Patch only `.brownie/release-evidence/owner-governance-evidence.json`" not in todo, todo
assert "Verification: blocker:" in todo, todo
PY

broad_decomposition_state="$(mktemp -d)"
broad_decomposition_prompt="$(mktemp)"
broad_decomposition_todo="$(mktemp)"
broad_decomposition_breakdown="$(mktemp)"
broad_decomposition_workspace="$(mktemp -d)"
git -C "$broad_decomposition_workspace" init -b main >/dev/null
git -C "$broad_decomposition_workspace" config user.name Brownie
git -C "$broad_decomposition_workspace" config user.email brownie@example.invalid
touch "$broad_decomposition_workspace/package.json"
git -C "$broad_decomposition_workspace" add package.json
git -C "$broad_decomposition_workspace" commit -m init >/dev/null
printf 'base prompt\n' > "$broad_decomposition_prompt"
cat > "$broad_decomposition_todo" <<'EOF'
- [ ] E-99-runtime-release-evidence: Replace broad release evidence with complete Product Ready evidence:
  Route: implementation.
  Source concern: this broad task spans multiple independent implementation surfaces.
  Update collectors, guards, evidence files, release documents, and operational tests.
  Ensure provenance, smoke, soak, release contract, and semantic consistency are all fixed.
  Verification: run `pnpm --workspace-root check`.
EOF

fake_brownie_broad_decomposition="$(mktemp)"
cat > "$fake_brownie_broad_decomposition" <<'SH'
#!/usr/bin/env bash
if [ "$1" = "--json" ] && [ "$2" = "run" ]; then
  printf '%s\n' '{"ok":true,"command":"run","exit_code":0,"run":{"status":"no_eligible_task","completed":false,"blocked":true,"terminal_failure":true,"automation":{"status":"terminal_failure","blocked":true,"completed":false,"terminal_failure":true,"controller_action":"stop","stop_class":"terminal_failure","stop_reason":"terminal_task_failed"}}}'
  exit 0
fi
printf '%s\n' '{"ok":true}'
SH
chmod +x "$fake_brownie_broad_decomposition"

PHASE_LOOP_STATE_DIR="$broad_decomposition_state" \
PHASE_LOOP_PROMPT="$broad_decomposition_prompt" \
PHASE_LOOP_TODO="$broad_decomposition_todo" \
PHASE_LOOP_TODO_BREAKDOWN="$broad_decomposition_breakdown" \
PHASE_LOOP_WORKSPACE_ROOT="$broad_decomposition_workspace" \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
BROWNIE_BIN="$fake_brownie_broad_decomposition" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null || true

broad_decomposition_prompt_file="$(find "$broad_decomposition_state/runs" -name '*.prompt.md' -print | sort | tail -n 1)"
python3 - "$broad_decomposition_todo" "$broad_decomposition_prompt_file" <<'PY'
import pathlib
import sys

todo = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
prompt = pathlib.Path(sys.argv[2]).read_text(encoding="utf-8")
assert "TODO-decompose-broad-todo-" in todo, todo
assert "Decompose broad TODO `E-99-runtime-release-evidence`" in todo, todo
assert "state: `decompose_todo`" in prompt, prompt
assert "decomposition_policy: this invocation is TODO decomposition only" in prompt, prompt
assert "replace the active decomposition request and its broad source TODO" in prompt, prompt
assert "Every generated leaf MUST include the exact line `Source TODO: TODO-decompose-broad-todo-" in prompt, prompt
assert "write one or two leaf TODOs in `new_text`" in prompt, prompt
assert "under 900 characters" in prompt, prompt
assert "do not silently discard parent requirements" in prompt, prompt
PY

no_eligible_split_state="$(mktemp -d)"
no_eligible_split_prompt="$(mktemp)"
no_eligible_split_workspace="$(mktemp -d)"
git -C "$no_eligible_split_workspace" init -b main >/dev/null
git -C "$no_eligible_split_workspace" config user.name Brownie
git -C "$no_eligible_split_workspace" config user.email brownie@example.invalid
mkdir -p "$no_eligible_split_workspace/.brownie" "$no_eligible_split_workspace/docs" "$no_eligible_split_workspace/scripts"
printf '{"scripts":{"check":"node --check scripts/b.mjs"}}\n' > "$no_eligible_split_workspace/package.json"
printf 'status: pending\n' > "$no_eligible_split_workspace/docs/a.md"
printf 'export const ok = true;\n' > "$no_eligible_split_workspace/scripts/b.mjs"
printf 'base prompt\n' > "$no_eligible_split_prompt"
cat > "$no_eligible_split_workspace/.brownie/todo.md" <<'EOF'
- [ ] E-20g-final-judgment-sync: Patch only `docs/a.md`, `scripts/b.mjs` to synchronize final judgment and guard coverage:
  Route: implementation.
  Source TODO: E-20.
  Depends on: E-20f.
  Completion condition: final judgment and guard coverage are synchronized without claiming Product Ready prematurely.
  Forbidden changes: do not edit unrelated files.
  Verification: run `pnpm --workspace-root check`.

- [ ] E-20h-next: Patch only `scripts/next.mjs`:
  Route: implementation.
  Source TODO: E-20.
  Depends on: E-20g-final-judgment-sync.
  Completion condition: the next step runs only after the final-judgment synchronization anchor is closed.
  Forbidden changes: do not edit unrelated files.
  Verification: run `pnpm --workspace-root check`.
EOF
printf '# Breakdown\n' > "$no_eligible_split_workspace/.brownie/todo-breakdown.md"
git -C "$no_eligible_split_workspace" add .
git -C "$no_eligible_split_workspace" commit -m init >/dev/null

set +e
PHASE_LOOP_STATE_DIR="$no_eligible_split_state" \
PHASE_LOOP_PROMPT="$no_eligible_split_prompt" \
PHASE_LOOP_TODO="$no_eligible_split_workspace/.brownie/todo.md" \
PHASE_LOOP_TODO_BREAKDOWN="$no_eligible_split_workspace/.brownie/todo-breakdown.md" \
PHASE_LOOP_WORKSPACE_ROOT="$no_eligible_split_workspace" \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
BROWNIE_BIN="$fake_brownie_terminal_no_eligible" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null || true

PHASE_LOOP_STATE_DIR="$no_eligible_split_state" \
PHASE_LOOP_PROMPT="$no_eligible_split_prompt" \
PHASE_LOOP_TODO="$no_eligible_split_workspace/.brownie/todo.md" \
PHASE_LOOP_TODO_BREAKDOWN="$no_eligible_split_workspace/.brownie/todo-breakdown.md" \
PHASE_LOOP_WORKSPACE_ROOT="$no_eligible_split_workspace" \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
PHASE_LOOP_TEST_MUTATE_TODO_AFTER_PROMPT=1 \
BROWNIE_BIN="$fake_brownie_terminal_no_eligible" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 75,76 "$PHASE_LOOP" run-once >/dev/null
no_eligible_split_exit="$?"
set -e
case "$no_eligible_split_exit" in
  0|75|76) ;;
  *)
    echo "unexpected no-eligible fixture exit=$no_eligible_split_exit" >&2
    exit 1
    ;;
esac

if [ "$no_eligible_split_exit" = "0" ]; then
python3 - "$no_eligible_split_workspace/.brownie/todo.md" "$no_eligible_split_workspace/.brownie/todo-breakdown.md" "$no_eligible_split_state/status.json" "$no_eligible_split_workspace/.brownie/private/phase-loop/todo-replans" "$no_eligible_split_workspace/.brownie/private/phase-loop/task-ledger.jsonl" <<'PY'
import json
import pathlib
import re
import sys

todo = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
breakdown = pathlib.Path(sys.argv[2]).read_text(encoding="utf-8")
status = json.loads(pathlib.Path(sys.argv[3]).read_text(encoding="utf-8"))
replan_dir = pathlib.Path(sys.argv[4])
ledger_path = pathlib.Path(sys.argv[5])
records = list(replan_dir.glob("*.json"))
claim_archives = list(pathlib.Path(sys.argv[3]).parent.glob("todo-claims/completed-no-eligible-multitarget-split-*.json"))
assert "- [x] E-20g-final-judgment-sync:" in todo, todo
assert "- [ ] E-20g-final-judgment-sync-target-01: Patch only `docs/a.md`" in todo, todo
assert "- [ ] E-20g-final-judgment-sync-target-02: Patch only `scripts/b.mjs`" in todo, todo
assert "Source TODO: E-20g-final-judgment-sync." in todo, todo
assert "Depends on: E-20g-final-judgment-sync-target-01." in todo, todo
assert "Depends on: E-20g-final-judgment-sync." in todo, todo
assert "E-20g-final-judgment-sync no-eligible multi-target split" in breakdown, breakdown
assert status["status"] == "last_run_succeeded", status
assert "no_eligible_task multi-target leaf split" in status["detail"], status
assert records, "missing replan record"
record_text = "\n".join(path.read_text(encoding="utf-8") for path in records)
assert "deterministic_no_eligible_multitarget_split" in record_text, record_text
assert '"record_type": "todo_replan"' in record_text, record_text
assert '"parent_status": "superseded_by_children"' in record_text, record_text
assert claim_archives, "missing completed no-eligible claim archive"
archived_claim = json.loads(claim_archives[-1].read_text(encoding="utf-8"))
selected_first = str(archived_claim["selected_todo"]).splitlines()[0]
task_match = re.match(r"^\s*- \[ \]\s+([^:\s]+)", selected_first)
assert task_match, archived_claim
attempt_id = f"{task_match.group(1)}@{archived_claim['claim_id']}"
ledger_events = []
for line in ledger_path.read_text(encoding="utf-8").splitlines():
    if not line.strip():
        continue
    record = json.loads(line)
    if record.get("kind") == "replan_transaction":
        ledger_events.extend(record.get("events", []))
    else:
        ledger_events.append(record)
terminal_events = [event for event in ledger_events if event.get("task_id") == attempt_id and event.get("to_state") in {"completed", "blocked", "failed", "replanned"}]
assert terminal_events and terminal_events[-1]["to_state"] == "replanned", (attempt_id, ledger_events)
assert not any(event.get("kind") == "unclaimed_trajectory" and event.get("trajectory_type") == "todo.replanned" for event in ledger_events), ledger_events
PY
else
assert_terminal_failure_claim_archived \
  "$no_eligible_split_state/todo-claims" \
  "$no_eligible_split_state/todo-claims/blocked.jsonl" \
  "$no_eligible_split_workspace/.brownie/private/phase-loop/task-ledger.jsonl" \
  'E-20g-final-judgment-sync:' 1
python3 - "$no_eligible_split_state/status.json" "$no_eligible_split_state/progress-state.json" "$no_eligible_split_state/todo-claims/blocked.jsonl" "$no_eligible_split_workspace/.brownie/private/phase-loop/task-ledger.jsonl" <<'PY'
import json
import pathlib
import sys

status = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
progress = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding="utf-8"))
blocked = [json.loads(line) for line in pathlib.Path(sys.argv[3]).read_text(encoding="utf-8").splitlines() if line.strip()]
ledger = pathlib.Path(sys.argv[4]).read_text(encoding="utf-8")
assert status["status"] == "blocked", status
assert status["exit_code"] in {"75", "76"}, status
assert progress["progress_projection"]["cli_status"] == "no_eligible_task", progress
assert progress["progress_projection"]["closure"] == "no_eligible_task", progress
if status["exit_code"] == "75":
    assert "Failed to claim first pending TODO" in status["detail"], status
else:
    assert "terminal_task_failed" in status["detail"], status
    assert progress["classification"] == "terminal_failure", progress
assert blocked and blocked[-1]["terminal_failure"] is True, blocked
assert blocked[-1]["block_reason"] == "terminal_runtime_failure", blocked
assert "terminal_failure_transaction" in ledger, ledger
PY
fi
fi

if claim_smoke_section_enabled feedback; then
repair_feedback_state="$(mktemp -d)"
repair_feedback_prompt="$(mktemp)"
repair_feedback_todo="$(mktemp)"
repair_feedback_workspace="$(mktemp -d)"
repair_feedback_argv="$repair_feedback_state/fake-brownie.argv"
git -C "$repair_feedback_workspace" init -b main >/dev/null
git -C "$repair_feedback_workspace" config user.name Brownie
git -C "$repair_feedback_workspace" config user.email brownie@example.invalid
mkdir -p "$repair_feedback_workspace/scripts"
touch "$repair_feedback_workspace/package.json"
printf 'export const operationalEvidence = {};\n' > "$repair_feedback_workspace/scripts/release-runtime-operational-evidence.mjs"
git -C "$repair_feedback_workspace" add package.json
git -C "$repair_feedback_workspace" add scripts/release-runtime-operational-evidence.mjs
git -C "$repair_feedback_workspace" commit -m init >/dev/null
printf 'base prompt\n' > "$repair_feedback_prompt"
cat > "$repair_feedback_todo" <<'EOF'
- [ ] E-repair: Patch only `scripts/release-runtime-operational-evidence.mjs` to generate satisfied soak evidence.
  Route: implementation.
  Source TODO: E-repair-parent.
  Completion condition: generated satisfied soak evidence has all required stateful steps from a bounded Runtime fixture, not version-only repetition.
  Verification: run `pnpm --workspace-root guard:runtime-operational-evidence:test`.
EOF
mkdir -p "$repair_feedback_state/todo-claims"
cat > "$repair_feedback_state/progress-state.json" <<'EOF'
{
  "schema_version": 1,
  "progress_projection": {
    "route": "{\"command\":\"resume\",\"arguments\":[]}"
  }
}
EOF
cat > "$repair_feedback_state/todo-claims/current.json" <<'EOF'
{
  "claim_id": "todo-g1-repair",
  "queue_fingerprint": "abc",
  "queue_generation": 1,
  "run_stamp": "20260913T000000Z",
  "schema_version": 1,
  "selected_todo": "- [ ] E-repair: Patch only `scripts/release-runtime-operational-evidence.mjs` to generate satisfied soak evidence.\n  Route: implementation.\n  Source TODO: E-repair-parent.\n  Completion condition: generated satisfied soak evidence has all required stateful steps from a bounded Runtime fixture, not version-only repetition.\n  Verification: run `pnpm --workspace-root guard:runtime-operational-evidence:test`.",
  "status": "in_progress"
}
EOF
cat > "$repair_feedback_state/todo-claims/repair-feedback.json" <<'EOF'
{
  "claim_id": "todo-g1-repair",
  "reason": "semantic_completion_not_satisfied",
  "run_stamp": "20260913T000000Z",
  "schema_version": 1,
  "verification": {
    "actual": "not_executed",
    "completed": false,
    "expected": "sections.soak_test.status=satisfied",
    "reason": "semantic_completion_not_satisfied",
    "workspace_read_previews": [
      "workspace.read: completed path=scripts/release-runtime-operational-evidence.mjs preview=export const operationalEvidence = {};"
    ],
    "results": [
      {
        "command": "pnpm --workspace-root guard:runtime-operational-evidence:test",
        "exit_code": 0,
        "stdout_tail": "tests passed but soak_test.status remained not_executed",
        "stderr_tail": ""
      }
    ]
  }
}
EOF

fake_brownie_repair_feedback="$(mktemp)"
cat > "$fake_brownie_repair_feedback" <<'SH'
#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" > "$PHASE_LOOP_TEST_ARGV_FILE"
cat <<'JSON'
{
  "command": "run",
  "ok": true,
  "run": {
    "automation": {
      "schema_version": 1,
      "status": "continuation_required",
      "controller_action": "resume",
      "stop_class": "continuation_required",
      "stop_reason": "bounded_progress",
      "completed": false,
      "blocked": false,
      "retryable": true,
      "terminal_failure": false,
      "task_id": "task-repair",
      "run_id": "run-repair",
      "journey_id": "journey-repair",
      "next_action": "inspect_progress_overview",
      "next_invocation": {"command": "resume", "arguments": []}
    },
    "status": "task_executed",
    "session_id": "session-repair",
    "drive_id": "drive-repair",
    "task_id": "task-repair",
    "run_id": "run-repair",
    "journey_id": "journey-repair",
    "completion_closure_status": "budget_exhausted",
    "next_action": "inspect_progress_overview",
    "completed": false,
    "blocked": false,
    "retryable": true,
    "terminal_failure": false,
    "controller_action": "resume",
    "stop_class": "continuation_required",
    "stop_reason": "bounded_progress",
    "next_invocation": {"command": "resume", "arguments": []}
  }
}
JSON
SH
chmod +x "$fake_brownie_repair_feedback"

PHASE_LOOP_STATE_DIR="$repair_feedback_state" \
PHASE_LOOP_PROMPT="$repair_feedback_prompt" \
PHASE_LOOP_TODO="$repair_feedback_todo" \
PHASE_LOOP_WORKSPACE_ROOT="$repair_feedback_workspace" \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
PHASE_LOOP_TEST_ARGV_FILE="$repair_feedback_argv" \
BROWNIE_BIN="$fake_brownie_repair_feedback" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

repair_feedback_prompt_file="$(find "$repair_feedback_state/runs" -name '*.prompt.md' -print | sort | tail -n 1)"
python3 - "$repair_feedback_argv" "$repair_feedback_prompt_file" <<'PY'
import pathlib
import sys

argv = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
prompt = pathlib.Path(sys.argv[2]).read_text(encoding="utf-8")
assert "--json run --file" in argv, argv
assert "--json resume" not in argv, argv
assert "state: `verify_or_repair`" in prompt, prompt
assert "## Previous Repair Feedback" in prompt, prompt
assert "semantic_completion_not_satisfied" in prompt, prompt
assert "sections.soak_test.status=satisfied" in prompt, prompt
assert "leaf_required_next_tool_policy: the next tool must be `workspace.write` for `scripts/release-runtime-operational-evidence.mjs`" in prompt, prompt
assert "leaf_initial_read_policy" not in prompt, prompt
PY

contract_replan_feedback_state="$(mktemp -d)"
contract_replan_feedback_prompt="$(mktemp)"
contract_replan_feedback_todo="$(mktemp)"
contract_replan_feedback_argv="$contract_replan_feedback_state/fake-brownie.argv"
mkdir -p "$contract_replan_feedback_state/todo-claims"
printf 'base prompt\n' > "$contract_replan_feedback_prompt"
cat > "$contract_replan_feedback_todo" <<'EOF'
- [x] E-source: Patch only `scripts/release-local-artifact.mjs` to repair portable archive packaging.
  Route: implementation.
  Completion condition: source leaf was superseded after repeated failure.
  Verification: run `pnpm --workspace-root release:local-artifact:test`.

- [ ] E-replan: Patch only `scripts/release-runtime-operational-evidence.mjs` to replan the failed archive leaf.
  Route: todo-decomposition.
  Source TODO: E-source.
  Completion condition: replace the failed leaf with implementable children.
  Verification: run `pnpm --workspace-root guard:todo-decomposition`.

- [x] E-completed-after-replan: Completed source must not extend the selected replan block.
  Route: implementation.
  Completion condition: this sentinel is not part of the selected replan TODO.
EOF
cat > "$contract_replan_feedback_state/progress-state.json" <<'EOF'
{"schema_version":1,"progress_projection":{"route":"{\"command\":\"resume\",\"arguments\":[]}"}}
EOF
cat > "$contract_replan_feedback_state/todo-claims/current.json" <<'EOF'
{
  "claim_id": "todo-g2-replan",
  "queue_fingerprint": "def",
  "queue_generation": 2,
  "run_stamp": "20260913T000001Z",
  "schema_version": 1,
  "selected_todo": "- [ ] E-replan: Patch only `scripts/release-runtime-operational-evidence.mjs` to replan the failed archive leaf.\n  Route: todo-decomposition.\n  Source TODO: E-source.\n  Completion condition: replace the failed leaf with implementable children.\n  Verification: run `pnpm --workspace-root guard:todo-decomposition`.",
  "status": "in_progress"
}
EOF
cat > "$contract_replan_feedback_state/todo-claims/repair-feedback.json" <<'EOF'
{
  "claim_id": "todo-g1-source",
  "kind": "phase_loop_todo_contract_replan_feedback",
  "reason": "supervisor_repeated_leaf_failure_requires_todo_contract_replan",
  "selected_todo_first_line": "- [ ] E-source: Patch only `scripts/release-local-artifact.mjs` to repair portable archive packaging.",
  "completed": false,
  "schema_version": 1
}
EOF

PHASE_LOOP_STATE_DIR="$contract_replan_feedback_state" \
PHASE_LOOP_PROMPT="$contract_replan_feedback_prompt" \
PHASE_LOOP_TODO="$contract_replan_feedback_todo" \
PHASE_LOOP_WORKSPACE_ROOT="$repair_feedback_workspace" \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
PHASE_LOOP_TEST_ARGV_FILE="$contract_replan_feedback_argv" \
BROWNIE_BIN="$fake_brownie_repair_feedback" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

contract_replan_feedback_prompt_file="$(find "$contract_replan_feedback_state/runs" -name '*.prompt.md' -print | sort | tail -n 1)"
python3 - "$contract_replan_feedback_state/todo-claims/repair-feedback.json" "$contract_replan_feedback_prompt_file" <<'PY'
import json
import pathlib
import sys

feedback = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
prompt = pathlib.Path(sys.argv[2]).read_text(encoding="utf-8")
assert feedback["completed"] is False, feedback
assert "## Previous Repair Feedback" in prompt, prompt
assert "supervisor_repeated_leaf_failure_requires_todo_contract_replan" in prompt, prompt
assert "E-source" in prompt, prompt
selected = prompt.split("## Selected TODO", 1)[1].split("## TODO Queue Snapshot", 1)[0]
assert "E-completed-after-replan" not in selected, selected
PY

# The feedback was authored for the failed source claim.  Once that claim is
# archived, the controller must select its single matching decomposition TODO
# rather than retrying the earlier implementation leaf at the head of the queue.
rm -f "$contract_replan_feedback_state/todo-claims/current.json"
PHASE_LOOP_STATE_DIR="$contract_replan_feedback_state" \
PHASE_LOOP_PROMPT="$contract_replan_feedback_prompt" \
PHASE_LOOP_TODO="$contract_replan_feedback_todo" \
PHASE_LOOP_WORKSPACE_ROOT="$repair_feedback_workspace" \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
PHASE_LOOP_TEST_ARGV_FILE="$contract_replan_feedback_argv" \
BROWNIE_BIN="$fake_brownie_repair_feedback" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

contract_replan_selection_prompt_file="$(find "$contract_replan_feedback_state/runs" -name '*.prompt.md' -print | sort | tail -n 1)"
python3 - "$contract_replan_selection_prompt_file" <<'PY'
import pathlib
import sys

prompt = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
selected = prompt.split("## Selected TODO", 1)[1].split("## TODO Queue Snapshot", 1)[0]
selected_first_line = next(line for line in selected.splitlines() if line.strip())
assert "E-replan" in selected_first_line, selected
assert "E-source" not in selected_first_line, selected
PY

python3 - "$PHASE_LOOP" <<'PY'
import pathlib
import sys

phase_loop = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
assert "todo_refinement_requires_todo_decomposition_route" in phase_loop, phase_loop
assert "only Route: todo-decomposition may replace a parent TODO with decomposition leaves" in phase_loop, phase_loop
assert "must_not_complete_by_todo_refinement_only" in phase_loop, phase_loop
assert "selected_target_implementation_required" in phase_loop, phase_loop
assert "try_no_eligible_multitarget_leaf_split_fallback" in phase_loop, phase_loop
assert "deterministic_no_eligible_multitarget_split" in phase_loop, phase_loop
assert "no_eligible_multitarget_leaf_split_pre_guard_exit" in phase_loop, phase_loop
# `skip` is the single formatter for structured fallback rejections; assert the
# branch rather than a whitespace-sensitive rendering of its JSON output.
assert 'skip("selected_todo_not_in_queue")' in phase_loop, phase_loop
assert '"reason":"claim_or_progress_state_missing"' in phase_loop, phase_loop
assert 'progress_projection.get("cli_status")' in phase_loop, phase_loop
assert '"non_progress_success"' in phase_loop, phase_loop
assert 'progress_not_terminal_non_progress_without_feedback' in phase_loop, phase_loop
assert 'prior_terminal_no_eligible_stdout' in phase_loop, phase_loop
assert 'evidence_source' in phase_loop, phase_loop
assert 'isolated_external_todo_state' in phase_loop, phase_loop
assert '"rolled_back": True' in phase_loop, phase_loop
assert "split_multitarget_or_force_bounded_workspace_write" in phase_loop, phase_loop
assert "TODO guard failure takes precedence over public-harness actionable-terminal feedback" in phase_loop, phase_loop
assert "harness_actionable_terminal_policy: suppressed because TODO queue repair is active" in phase_loop, phase_loop
assert "Live TODO decomposition guard preflight failed" in phase_loop, phase_loop
assert "stale selected-target repair feedback must not override this" in phase_loop, phase_loop
assert "parent_dependencies = split_dependency_ids(line_value(selected_block, \"Depends on:\"))" in phase_loop, phase_loop
assert "concrete_replacements" not in phase_loop, phase_loop
assert "not selected_decomposition_active" in phase_loop, phase_loop
assert "^\\s*Route:\\s*todo-decomposition\\.?\\s*$" in phase_loop, phase_loop
PY

# A controller-only ledger failure must terminalize the run.  In particular,
# the task-ledger path is made a directory so the first append fails after the
# claim has been created; this exercises the same downstream failure surface
# that previously left status.json at `running`.
ledger_failure_workspace="$(mktemp -d)"
git -C "$ledger_failure_workspace" init -b main >/dev/null
git -C "$ledger_failure_workspace" -c user.name=Brownie -c user.email=brownie@example.invalid commit --allow-empty -m init >/dev/null
mkdir -p "$ledger_failure_workspace/.brownie/private/phase-loop/task-ledger.jsonl"
ledger_failure_state="$(mktemp -d)"
ledger_failure_prompt="$(mktemp)"
ledger_failure_todo="$(mktemp)"
printf 'base prompt\n' > "$ledger_failure_prompt"
printf -- '- [ ] L-01: task-ledger failure terminalization\n' > "$ledger_failure_todo"

if PHASE_LOOP_STATE_DIR="$ledger_failure_state" \
  PHASE_LOOP_PROMPT="$ledger_failure_prompt" \
  PHASE_LOOP_TODO="$ledger_failure_todo" \
  PHASE_LOOP_WORKSPACE_ROOT="$ledger_failure_workspace" \
  BROWNIE_BIN="$fake_brownie_json" \
  run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null 2>/dev/null; then
  echo "expected task-ledger append failure to fail run-once" >&2
  exit 1
fi
python3 - "$ledger_failure_state/status.json" <<'PY'
import json
import sys

status = json.load(open(sys.argv[1], encoding="utf-8"))
assert status["status"] != "running", status
assert status["status"] == "blocked", status
assert status["exit_code"] == "78", status
assert status["consecutive_failures"] >= 1, status
assert "Task ledger failed" in status["detail"], status
assert "stdout=" in status["detail"], status
assert "stderr=" in status["detail"], status
PY

run_status_write_signal_regression() {
  local signal_name="$1"
  local expected_exit_code="$2"
  local signal_state signal_prompt signal_todo signal_marker signal_run_pid signal_exit_code
  signal_state="$(mktemp -d)"
  signal_prompt="$(mktemp)"
  signal_todo="$(mktemp)"
  signal_marker="$signal_state/status-write.started"
  printf 'base prompt\n' > "$signal_prompt"
  printf -- '- [ ] S-01: signal during status write\n' > "$signal_todo"
  PHASE_LOOP_STATE_DIR="$signal_state" \
  PHASE_LOOP_PROMPT="$signal_prompt" \
  PHASE_LOOP_TODO="$signal_todo" \
  PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
  PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
  PHASE_LOOP_TEST_STATUS_WRITE_MARKER="$signal_marker" \
  PHASE_LOOP_TEST_STATUS_WRITE_DELAY_SECONDS=2 \
  BROWNIE_BIN="$fake_brownie_json" \
  python3 -c 'import os,signal,sys; signal.signal(signal.SIGINT, signal.SIG_DFL); signal.signal(signal.SIGTERM, signal.SIG_DFL); os.execv(sys.argv[1], sys.argv[1:])' "$PHASE_LOOP" run-once >/dev/null 2>/dev/null &
  signal_run_pid="$!"
  for _ in $(seq 1 40); do
    if [ -f "$signal_marker" ]; then
      break
    fi
    sleep 0.1
  done
  if [ ! -f "$signal_marker" ]; then
    echo "status write test window was not reached for SIG$signal_name" >&2
    kill -KILL "$signal_run_pid" 2>/dev/null || true
    wait "$signal_run_pid" 2>/dev/null || true
    exit 1
  fi
  kill -"$signal_name" "$signal_run_pid"
  set +e
  wait "$signal_run_pid"
  signal_exit_code="$?"
  set -e
  if kill -0 "$signal_run_pid" 2>/dev/null; then
    echo "physical process remained after deferred SIG$signal_name" >&2
    exit 1
  fi
  if [ "$signal_exit_code" -ne "$expected_exit_code" ]; then
    echo "expected deferred SIG$signal_name to exit $expected_exit_code, got $signal_exit_code" >&2
    exit 1
  fi
  python3 - "$signal_state/status.json" "$expected_exit_code" <<'PY'
import json
import sys

status = json.load(open(sys.argv[1], encoding="utf-8"))
assert status["status"] == "blocked", status
assert status["exit_code"] == sys.argv[2], status
assert status["consecutive_failures"] >= 1, status
assert "terminalized status before process exit" in status["detail"], status
PY
}

# Signals delivered during the atomic status-write window must be deferred
# until the replacement is visible, then terminalize the run instead of
# leaving status.json at `running`.
run_status_write_signal_regression TERM 143
run_status_write_signal_regression INT 130
fi

assert_repository_state_unchanged
echo "phase-loop claim smoke passed"
