#!/usr/bin/env bash
set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${PHASE_LOOP_STATE_DIR:-"$ROOT_DIR/.brownie-phase-loop"}"
RUN_DIR="$STATE_DIR/runs"
LOG_DIR="$STATE_DIR/logs"
PID_FILE="$STATE_DIR/phase-loop.pid"
LOCK_DIR="$STATE_DIR/phase-loop.lock"
STOP_FILE="$STATE_DIR/stop"
STATUS_FILE="$STATE_DIR/status.json"
SUPERVISOR_LOG="$LOG_DIR/supervisor.log"
TODO_CLAIM_DIR="$STATE_DIR/todo-claims"
TODO_CLAIM_FILE="$TODO_CLAIM_DIR/current.json"
TODO_QUEUE_STATE_FILE="$TODO_CLAIM_DIR/todo-queue-state.json"
LAUNCHD_LABEL="${PHASE_LOOP_LAUNCHD_LABEL:-globalpocket.brownie.phase-loop}"
SCREEN_NAME="${PHASE_LOOP_SCREEN_NAME:-brownie-phase-loop}"

BROWNIE_BIN="${BROWNIE_BIN:-"$ROOT_DIR/target/debug/brownie"}"
PHASE_LOOP_PROMPT="${PHASE_LOOP_PROMPT:-"$ROOT_DIR/phase-loop.md"}"
PHASE_LOOP_TODO="${PHASE_LOOP_TODO:-"$ROOT_DIR/todo.md"}"
PHASE_LOOP_WORKSPACE_ROOT="${PHASE_LOOP_WORKSPACE_ROOT:-"$ROOT_DIR"}"
PHASE_LOOP_CONTROL_ROOT="${PHASE_LOOP_CONTROL_ROOT:-"/Users/satoshitanaka/.codex/automations/brownie-cli-phase-loop"}"
PHASE_LOOP_INTERVAL_SECONDS="${PHASE_LOOP_INTERVAL_SECONDS:-5}"
PHASE_LOOP_FAILURE_BACKOFF_SECONDS="${PHASE_LOOP_FAILURE_BACKOFF_SECONDS:-60}"
PHASE_LOOP_MAX_FAILURE_BACKOFF_SECONDS="${PHASE_LOOP_MAX_FAILURE_BACKOFF_SECONDS:-900}"
PHASE_LOOP_BROWNIE_TIMEOUT_SECONDS="${PHASE_LOOP_BROWNIE_TIMEOUT_SECONDS:-14400}"

mkdir -p "$RUN_DIR" "$LOG_DIR" "$TODO_CLAIM_DIR"

json_escape() {
  python3 -c 'import json,sys; print(json.dumps(sys.stdin.read())[1:-1])'
}

now_utc() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

write_status() {
  local status="$1"
  local detail="${2:-}"
  local run_id="${3:-}"
  local exit_code="${4:-}"
  local consecutive_failures="${5:-0}"
  local timestamp
  timestamp="$(now_utc)"
  local escaped_detail escaped_run escaped_prompt tmp_status
  escaped_detail="$(printf '%s' "$detail" | json_escape)"
  escaped_run="$(printf '%s' "$run_id" | json_escape)"
  escaped_prompt="$(printf '%s' "$PHASE_LOOP_PROMPT" | json_escape)"
  local escaped_workspace
  escaped_workspace="$(printf '%s' "$PHASE_LOOP_WORKSPACE_ROOT" | json_escape)"
  local escaped_control_root
  escaped_control_root="$(printf '%s' "$PHASE_LOOP_CONTROL_ROOT" | json_escape)"
  local escaped_todo
  escaped_todo="$(printf '%s' "$PHASE_LOOP_TODO" | json_escape)"
  local escaped_claim_file
  escaped_claim_file="$(printf '%s' "$TODO_CLAIM_FILE" | json_escape)"
  local escaped_queue_state_file
  escaped_queue_state_file="$(printf '%s' "$TODO_QUEUE_STATE_FILE" | json_escape)"
  tmp_status="$STATUS_FILE.$$.$RANDOM.tmp"
  cat > "$tmp_status" <<EOF
{
  "status": "$status",
  "detail": "$escaped_detail",
  "run_id": "$escaped_run",
  "exit_code": "$exit_code",
  "consecutive_failures": $consecutive_failures,
  "updated_at": "$timestamp",
  "pid_file": "$PID_FILE",
  "stop_file": "$STOP_FILE",
  "prompt": "$escaped_prompt",
  "todo": "$escaped_todo",
  "todo_claim": "$escaped_claim_file",
  "todo_queue_state": "$escaped_queue_state_file",
  "workspace_root": "$escaped_workspace",
  "control_root": "$escaped_control_root"
}
EOF
  mv "$tmp_status" "$STATUS_FILE"
}

sync_parent_dir() {
  local target_path="$1"
  python3 - "$target_path" <<'PY'
import os
import pathlib
import sys

target = pathlib.Path(sys.argv[1])
directory = target if target.is_dir() else target.parent
fd = os.open(directory, os.O_RDONLY)
try:
    os.fsync(fd)
finally:
    os.close(fd)
PY
}

todo_pending_count() {
  if [ ! -f "$PHASE_LOOP_TODO" ]; then
    echo 0
    return 0
  fi
  awk '
    /^[[:space:]]*([-*]|[0-9]+[.)])[[:space:]]+\[[[:space:]]\][[:space:]]+/ { count++ }
    END { print count + 0 }
  ' "$PHASE_LOOP_TODO"
}

todo_first_pending_item() {
  if [ ! -f "$PHASE_LOOP_TODO" ]; then
    return 0
  fi
  awk '
    /^[[:space:]]*([-*]|[0-9]+[.)])[[:space:]]+\[[[:space:]]\][[:space:]]+/ {
      if (found) {
        exit
      }
      found = 1
      print
      next
    }
    found && /^[[:space:]]+/ {
      print
      next
    }
    found {
      exit
    }
  ' "$PHASE_LOOP_TODO"
}

todo_queue_fingerprint() {
  if [ ! -f "$PHASE_LOOP_TODO" ]; then
    return 1
  fi
  shasum -a 256 "$PHASE_LOOP_TODO" | awk '{ print $1 }'
}

write_todo_queue_state() {
  local generation="$1"
  local fingerprint="$2"
  local timestamp tmp_state
  timestamp="$(now_utc)"
  tmp_state="$TODO_QUEUE_STATE_FILE.$$.$RANDOM.tmp"
  python3 - "$tmp_state" "$generation" "$fingerprint" "$PHASE_LOOP_TODO" "$timestamp" <<'PY'
import json
import os
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
state = {
    "schema_version": 1,
    "generation": int(sys.argv[2]),
    "fingerprint": sys.argv[3],
    "todo_path": sys.argv[4],
    "updated_at": sys.argv[5],
}
with open(path, "w", encoding="utf-8") as handle:
    json.dump(state, handle, ensure_ascii=False, sort_keys=True, indent=2)
    handle.write("\n")
    handle.flush()
    os.fsync(handle.fileno())
os.chmod(path, 0o600)
PY
  mv "$tmp_state" "$TODO_QUEUE_STATE_FILE"
  chmod 600 "$TODO_QUEUE_STATE_FILE"
  sync_parent_dir "$TODO_CLAIM_DIR"
}

refresh_todo_queue_state() {
  local fingerprint generation
  fingerprint="$(todo_queue_fingerprint)"
  generation="$(
    python3 - "$TODO_QUEUE_STATE_FILE" "$fingerprint" <<'PY'
import json
import sys

path = sys.argv[1]
fingerprint = sys.argv[2]
generation = 0
try:
    with open(path, encoding="utf-8") as handle:
        state = json.load(handle)
    if state.get("fingerprint") == fingerprint:
        generation = int(state.get("generation", 0))
    else:
        generation = int(state.get("generation", 0)) + 1
except Exception:
    generation = 1
if generation < 1:
    generation = 1
print(generation)
PY
  )"
  write_todo_queue_state "$generation" "$fingerprint"
  printf '%s %s\n' "$generation" "$fingerprint"
}

claim_status() {
  if [ ! -f "$TODO_CLAIM_FILE" ]; then
    return 1
  fi
  python3 - "$TODO_CLAIM_FILE" <<'PY'
import json
import sys

try:
    with open(sys.argv[1], encoding="utf-8") as handle:
        print(json.load(handle).get("status", ""))
except Exception:
    sys.exit(1)
PY
}

active_todo_claim_exists() {
  local status
  status="$(claim_status 2>/dev/null || true)"
  case "$status" in
    claimed|in_progress|blocked)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

active_claim_queue_generation() {
  local queue_generation queue_state
  queue_generation="$(claim_field queue_generation 2>/dev/null || true)"
  if [ -n "$queue_generation" ]; then
    printf '%s\n' "$queue_generation"
    return 0
  fi
  queue_state="$(refresh_todo_queue_state)"
  printf '%s\n' "$queue_state" | awk '{ print $1 }'
}

claim_field() {
  local field="$1"
  if [ ! -f "$TODO_CLAIM_FILE" ]; then
    return 1
  fi
  python3 - "$TODO_CLAIM_FILE" "$field" <<'PY'
import json
import sys

try:
    with open(sys.argv[1], encoding="utf-8") as handle:
        value = json.load(handle).get(sys.argv[2], "")
except Exception:
    sys.exit(1)
if isinstance(value, str):
    print(value)
else:
    print(json.dumps(value, ensure_ascii=False, sort_keys=True))
PY
}

write_todo_claim() {
  local claim_id="$1"
  local status="$2"
  local selected_todo="$3"
  local queue_fingerprint="$4"
  local queue_generation="$5"
  local run_stamp="${6:-}"
  local timestamp tmp_claim
  timestamp="$(now_utc)"
  tmp_claim="$TODO_CLAIM_FILE.$$.$RANDOM.tmp"
  python3 - "$tmp_claim" "$claim_id" "$status" "$selected_todo" "$queue_fingerprint" "$queue_generation" "$PHASE_LOOP_TODO" "$run_stamp" "$timestamp" <<'PY'
import json
import os
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
claim_id = sys.argv[2]
status = sys.argv[3]
timestamp = sys.argv[9]
current_path = path.with_name("current.json")
claim = {}
queue_generation = None
try:
    queue_generation = int(sys.argv[6])
except Exception:
    queue_generation = None
if current_path.exists():
    try:
        with open(current_path, encoding="utf-8") as handle:
            current = json.load(handle)
        if current.get("claim_id") == claim_id:
            claim = current
    except Exception:
        claim = {}
if not claim:
    claim = {
        "schema_version": 1,
        "claim_id": claim_id,
        "selected_todo": sys.argv[4],
        "queue_fingerprint": sys.argv[5],
        "queue_generation": queue_generation or 1,
        "todo_path": sys.argv[7],
        "created_at": timestamp,
        "status_history": [],
    }
if queue_generation is not None:
    claim.setdefault("queue_generation", queue_generation)
else:
    claim.setdefault("queue_generation", 1)
claim["status"] = status
claim["run_stamp"] = sys.argv[8]
claim["updated_at"] = timestamp
claim.setdefault("status_history", []).append(
    {"status": status, "run_stamp": sys.argv[8], "updated_at": timestamp}
)
with open(path, "w", encoding="utf-8") as handle:
    json.dump(claim, handle, ensure_ascii=False, sort_keys=True, indent=2)
    handle.write("\n")
    handle.flush()
    os.fsync(handle.fileno())
os.chmod(path, 0o600)
PY
  mv "$tmp_claim" "$TODO_CLAIM_FILE"
  chmod 600 "$TODO_CLAIM_FILE"
  sync_parent_dir "$TODO_CLAIM_DIR"
}

claim_first_pending_todo() {
  local run_stamp="$1"
  local selected_todo queue_fingerprint queue_generation queue_state selected_hash claim_id reread_fingerprint attempt
  if active_todo_claim_exists; then
    queue_generation="$(active_claim_queue_generation)"
    write_todo_claim "$(claim_field claim_id)" "in_progress" "$(claim_field selected_todo)" "$(claim_field queue_fingerprint)" "$queue_generation" "$run_stamp"
    return 0
  fi

  for attempt in 1 2 3; do
    queue_state="$(refresh_todo_queue_state)"
    queue_generation="$(printf '%s' "$queue_state" | awk '{ print $1 }')"
    queue_fingerprint="$(printf '%s' "$queue_state" | awk '{ print $2 }')"
    selected_todo="$(todo_first_pending_item)"
    if [ -z "$selected_todo" ]; then
      return 1
    fi
    reread_fingerprint="$(todo_queue_fingerprint)"
    if [ "$queue_fingerprint" != "$reread_fingerprint" ]; then
      printf '%s todo_claim_stale_snapshot_rejected attempt=%s expected=%s actual=%s\n' "$(now_utc)" "$attempt" "$queue_fingerprint" "$reread_fingerprint" >> "$SUPERVISOR_LOG"
      continue
    fi
    selected_hash="$(printf '%s' "$selected_todo" | shasum -a 256 | awk '{ print substr($1, 1, 12) }')"
    claim_id="todo-g${queue_generation}-${selected_hash}"
    write_todo_claim "$claim_id" "claimed" "$selected_todo" "$queue_fingerprint" "$queue_generation" "$run_stamp"
    write_todo_claim "$claim_id" "in_progress" "$selected_todo" "$queue_fingerprint" "$queue_generation" "$run_stamp"
    printf '%s todo_claim=%s generation=%s status=in_progress\n' "$(now_utc)" "$claim_id" "$queue_generation" >> "$SUPERVISOR_LOG"
    return 0
  done
  return 1
}

build_effective_prompt() {
  local output_path="$1"
  local selected_todo
  if active_todo_claim_exists; then
    selected_todo="$(claim_field selected_todo)"
  else
    selected_todo="$(todo_first_pending_item)"
  fi
  {
    printf '# Brownie Phase Loop Effective Prompt\n\n'
    printf 'This generated prompt combines the stable phase-loop contract with the current external TODO queue.\n'
    printf 'Treat the active TODO claim below as the work item for this bounded invocation.\n\n'
    printf '## Active TODO Claim\n\n'
    if active_todo_claim_exists; then
      python3 - "$TODO_CLAIM_FILE" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    claim = json.load(handle)
for key in ("claim_id", "status", "queue_generation", "queue_fingerprint", "run_stamp", "updated_at"):
    print(f"- {key}: `{claim.get(key, '')}`")
PY
    else
      printf '%s\n' '- none'
    fi
    printf '\n'
    printf '## Selected TODO\n\n'
    printf '%s\n' "$selected_todo"
    printf '\n## TODO Queue Snapshot\n\n'
    sed -n '1,240p' "$PHASE_LOOP_TODO"
    printf '\n## Base Phase Loop Prompt\n\n'
    sed -n '1,400p' "$PHASE_LOOP_PROMPT"
  } > "$output_path"
}

stop_if_todo_empty() {
  local consecutive_failures="${1:-0}"
  local detail pending_count
  if [ ! -f "$PHASE_LOOP_TODO" ]; then
    detail="Phase loop TODO queue is missing: $PHASE_LOOP_TODO"
    printf '%s %s\n' "$(now_utc)" "$detail" >> "$SUPERVISOR_LOG"
    write_status "blocked" "$detail" "" "66" "$consecutive_failures"
    return 66
  fi

  pending_count="$(todo_pending_count)"
  if [ "$pending_count" -eq 0 ]; then
    if active_todo_claim_exists; then
      return 0
    fi
    detail="Phase loop TODO queue is empty; no pending or durable in-progress claim remains."
    touch "$STOP_FILE"
    printf '%s %s\n' "$(now_utc)" "$detail" >> "$SUPERVISOR_LOG"
    write_status "stopped" "$detail" "" "" "$consecutive_failures"
    return 75
  fi

  return 0
}

load_env() {
  set -a
  if [ -f "$ROOT_DIR/.test/brownie-loop.env" ]; then
    # Match the local LAN LLM environment used by .test/sample.md smoke runs.
    # This file is ignored and may contain local credentials.
    # shellcheck disable=SC1091
    . "$ROOT_DIR/.test/brownie-loop.env"
  fi
  if [ -f "$ROOT_DIR/phase-loop.env" ]; then
    # shellcheck disable=SC1091
    . "$ROOT_DIR/phase-loop.env"
  fi
  if [ -f "$STATE_DIR/phase-loop.env" ]; then
    # shellcheck disable=SC1091
    . "$STATE_DIR/phase-loop.env"
  fi
  set +a
}

is_running() {
  if [ ! -f "$PID_FILE" ]; then
    return 1
  fi
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -z "$pid" ]; then
    return 1
  fi
  kill -0 "$pid" 2>/dev/null
}

acquire_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "$$" > "$LOCK_DIR/pid"
    trap 'rm -rf "$LOCK_DIR"' EXIT INT TERM
    return 0
  fi
  local lock_pid
  lock_pid="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
  if [ -n "$lock_pid" ] && ! kill -0 "$lock_pid" 2>/dev/null; then
    rm -rf "$LOCK_DIR"
    if mkdir "$LOCK_DIR" 2>/dev/null; then
      echo "$$" > "$LOCK_DIR/pid"
      trap 'rm -rf "$LOCK_DIR"' EXIT INT TERM
      printf '%s reclaimed stale phase-loop lock from pid=%s\n' "$(now_utc)" "$lock_pid" >> "$SUPERVISOR_LOG"
      return 0
    fi
  fi
  return 1
}

run_brownie_once() {
  load_env
  local started_at run_stamp stdout_log stderr_log effective_prompt exit_code run_id detail
  started_at="$(now_utc)"
  run_stamp="$(date -u +"%Y%m%dT%H%M%SZ")"
  stdout_log="$RUN_DIR/$run_stamp.stdout.log"
  stderr_log="$RUN_DIR/$run_stamp.stderr.log"
  effective_prompt="$RUN_DIR/$run_stamp.prompt.md"

  write_status "running" "Brownie run started at $started_at" "$run_stamp" "" "${CONSECUTIVE_FAILURES:-0}"

  local todo_status
  stop_if_todo_empty "${CONSECUTIVE_FAILURES:-0}"
  todo_status=$?
  if [ "$todo_status" -ne 0 ]; then
    return "$todo_status"
  fi
  if [ ! -x "$BROWNIE_BIN" ]; then
    detail="Brownie binary is not executable: $BROWNIE_BIN"
    printf '%s %s\n' "$(now_utc)" "$detail" >> "$SUPERVISOR_LOG"
    write_status "blocked" "$detail" "$run_stamp" "127" "${CONSECUTIVE_FAILURES:-0}"
    return 127
  fi
  if [ ! -f "$PHASE_LOOP_PROMPT" ]; then
    detail="Phase loop prompt is missing: $PHASE_LOOP_PROMPT"
    printf '%s %s\n' "$(now_utc)" "$detail" >> "$SUPERVISOR_LOG"
    write_status "blocked" "$detail" "$run_stamp" "66" "${CONSECUTIVE_FAILURES:-0}"
    return 66
  fi
  if [ ! -d "$PHASE_LOOP_WORKSPACE_ROOT" ]; then
    detail="Phase loop workspace root is missing: $PHASE_LOOP_WORKSPACE_ROOT"
    printf '%s %s\n' "$(now_utc)" "$detail" >> "$SUPERVISOR_LOG"
    write_status "blocked" "$detail" "$run_stamp" "66" "${CONSECUTIVE_FAILURES:-0}"
    return 66
  fi
  if ! claim_first_pending_todo "$run_stamp"; then
    detail="Failed to claim first pending TODO from queue: $PHASE_LOOP_TODO"
    printf '%s %s\n' "$(now_utc)" "$detail" >> "$SUPERVISOR_LOG"
    write_status "blocked" "$detail" "$run_stamp" "75" "${CONSECUTIVE_FAILURES:-0}"
    return 75
  fi
  if ! build_effective_prompt "$effective_prompt"; then
    detail="Failed to build effective phase-loop prompt: $effective_prompt"
    printf '%s %s\n' "$(now_utc)" "$detail" >> "$SUPERVISOR_LOG"
    write_status "blocked" "$detail" "$run_stamp" "74" "${CONSECUTIVE_FAILURES:-0}"
    return 74
  fi
  (
    cd "$PHASE_LOOP_WORKSPACE_ROOT" || exit 70
    export BROWNIE_WORKSPACE_ROOT="${BROWNIE_WORKSPACE_ROOT:-"$PHASE_LOOP_WORKSPACE_ROOT"}"
    export PHASE_LOOP_CONTROL_ROOT
    if command -v timeout >/dev/null 2>&1; then
      timeout "$PHASE_LOOP_BROWNIE_TIMEOUT_SECONDS" "$BROWNIE_BIN" run --file "$effective_prompt"
    else
      "$BROWNIE_BIN" run --file "$effective_prompt"
    fi
  ) > "$stdout_log" 2> "$stderr_log"
  exit_code=$?

  run_id="$(sed -n 's/^run //p' "$stdout_log" | tail -1)"
  if [ -z "$run_id" ]; then
    run_id="$run_stamp"
  fi

  if [ "$exit_code" -eq 0 ]; then
    detail="Brownie run exited successfully; stdout=$stdout_log stderr=$stderr_log"
    write_status "last_run_succeeded" "$detail" "$run_id" "$exit_code" 0
  else
    if active_todo_claim_exists; then
      write_todo_claim "$(claim_field claim_id)" "blocked" "$(claim_field selected_todo)" "$(claim_field queue_fingerprint)" "$(active_claim_queue_generation)" "$run_stamp"
    fi
    detail="Brownie run failed; stdout=$stdout_log stderr=$stderr_log"
    write_status "last_run_failed" "$detail" "$run_id" "$exit_code" "${CONSECUTIVE_FAILURES:-1}"
  fi
  printf '%s run=%s exit=%s stdout=%s stderr=%s\n' "$(now_utc)" "$run_id" "$exit_code" "$stdout_log" "$stderr_log" >> "$SUPERVISOR_LOG"
  return "$exit_code"
}

supervise() {
  if ! acquire_lock; then
    write_status "already_running" "Another phase-loop.sh instance holds the lock." "" "" 0
    exit 0
  fi

  echo "$$" > "$PID_FILE"
  write_status "supervising" "Supervisor started." "" "" 0
  printf '%s supervisor pid=%s started\n' "$(now_utc)" "$$" >> "$SUPERVISOR_LOG"

  local CONSECUTIVE_FAILURES=0
  local backoff todo_status
  while true; do
    if [ -f "$STOP_FILE" ]; then
      write_status "stopped" "Stop file present." "" "" "$CONSECUTIVE_FAILURES"
      printf '%s stop file observed; exiting\n' "$(now_utc)" >> "$SUPERVISOR_LOG"
      exit 0
    fi

    stop_if_todo_empty "$CONSECUTIVE_FAILURES"
    todo_status=$?
    if [ "$todo_status" -ne 0 ]; then
      if [ "$todo_status" -eq 75 ]; then
        exit 0
      fi
      exit "$todo_status"
    fi

    if run_brownie_once; then
      CONSECUTIVE_FAILURES=0
      sleep "$PHASE_LOOP_INTERVAL_SECONDS"
    else
      CONSECUTIVE_FAILURES=$((CONSECUTIVE_FAILURES + 1))
      backoff=$((PHASE_LOOP_FAILURE_BACKOFF_SECONDS * CONSECUTIVE_FAILURES))
      if [ "$backoff" -gt "$PHASE_LOOP_MAX_FAILURE_BACKOFF_SECONDS" ]; then
        backoff="$PHASE_LOOP_MAX_FAILURE_BACKOFF_SECONDS"
      fi
      printf '%s failure_count=%s backoff=%s\n' "$(now_utc)" "$CONSECUTIVE_FAILURES" "$backoff" >> "$SUPERVISOR_LOG"
      sleep "$backoff"
    fi
  done
}

start() {
  if is_running; then
    echo "phase-loop already running: pid $(cat "$PID_FILE")"
    exit 0
  fi
  rm -f "$STOP_FILE"
  if command -v screen >/dev/null 2>&1; then
    screen -S "$SCREEN_NAME" -X quit >/dev/null 2>&1 || true
    screen -dmS "$SCREEN_NAME" /bin/bash "$ROOT_DIR/phase-loop.sh" supervise
    sleep 1
  elif [ "$(uname -s 2>/dev/null)" = "Darwin" ] && command -v launchctl >/dev/null 2>&1; then
    launchctl remove "$LAUNCHD_LABEL" >/dev/null 2>&1 || true
    launchctl submit \
      -l "$LAUNCHD_LABEL" \
      -o "$LOG_DIR/launcher.out" \
      -e "$LOG_DIR/launcher.err" \
      -- /bin/bash "$ROOT_DIR/phase-loop.sh" supervise
    sleep 1
  else
    nohup "$0" supervise >> "$LOG_DIR/launcher.out" 2>> "$LOG_DIR/launcher.err" &
    echo $! > "$PID_FILE"
  fi
  write_status "starting" "Supervisor launch requested." "" "" 0
  if is_running; then
    echo "phase-loop start requested: pid $(cat "$PID_FILE")"
  else
    echo "phase-loop start requested"
  fi
}

stop_loop() {
  touch "$STOP_FILE"
  if is_running; then
    echo "phase-loop stop requested: pid $(cat "$PID_FILE")"
  else
    echo "phase-loop stop requested; no live pid found"
  fi
}

status() {
  if is_running; then
    echo "phase-loop running: pid $(cat "$PID_FILE")"
  else
    echo "phase-loop not running"
  fi
  if [ -f "$STATUS_FILE" ]; then
    cat "$STATUS_FILE"
  else
    echo "no status file: $STATUS_FILE"
  fi
}

case "${1:-status}" in
  start)
    start
    ;;
  supervise)
    supervise
    ;;
  stop)
    stop_loop
    ;;
  restart)
    stop_loop
    sleep 2
    if is_running; then
      old_pid="$(cat "$PID_FILE")"
      kill "$old_pid" 2>/dev/null || true
      sleep 1
    fi
    rm -f "$PID_FILE" "$STOP_FILE"
    rm -rf "$LOCK_DIR"
    start
    ;;
  status)
    status
    ;;
  run-once)
    CONSECUTIVE_FAILURES=0
    run_brownie_once
    ;;
  *)
    echo "usage: $0 {start|status|stop|restart|run-once}" >&2
    exit 64
    ;;
esac
