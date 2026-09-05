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

BROWNIE_BIN="${BROWNIE_BIN:-"$ROOT_DIR/target/debug/brownie"}"
PHASE_LOOP_PROMPT="${PHASE_LOOP_PROMPT:-"$ROOT_DIR/phase-loop.md"}"
PHASE_LOOP_WORKSPACE_ROOT="${PHASE_LOOP_WORKSPACE_ROOT:-"$ROOT_DIR"}"
PHASE_LOOP_INTERVAL_SECONDS="${PHASE_LOOP_INTERVAL_SECONDS:-5}"
PHASE_LOOP_FAILURE_BACKOFF_SECONDS="${PHASE_LOOP_FAILURE_BACKOFF_SECONDS:-60}"
PHASE_LOOP_MAX_FAILURE_BACKOFF_SECONDS="${PHASE_LOOP_MAX_FAILURE_BACKOFF_SECONDS:-900}"
PHASE_LOOP_BROWNIE_TIMEOUT_SECONDS="${PHASE_LOOP_BROWNIE_TIMEOUT_SECONDS:-14400}"

mkdir -p "$RUN_DIR" "$LOG_DIR"

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
  "workspace_root": "$escaped_workspace"
}
EOF
  mv "$tmp_status" "$STATUS_FILE"
}

load_env() {
  set -a
  if [ -f "$ROOT_DIR/phase-loop.env" ]; then
    # shellcheck disable=SC1091
    . "$ROOT_DIR/phase-loop.env"
  fi
  if [ -f "$STATE_DIR/phase-loop.env" ]; then
    # shellcheck disable=SC1091
    . "$STATE_DIR/phase-loop.env"
  fi
  if [ -f "$ROOT_DIR/.test/brownie-loop.env" ]; then
    # Backward-compatible local development fallback. This file is ignored.
    # shellcheck disable=SC1091
    . "$ROOT_DIR/.test/brownie-loop.env"
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
  return 1
}

run_brownie_once() {
  load_env
  local started_at run_stamp stdout_log stderr_log exit_code run_id detail
  started_at="$(now_utc)"
  run_stamp="$(date -u +"%Y%m%dT%H%M%SZ")"
  stdout_log="$RUN_DIR/$run_stamp.stdout.log"
  stderr_log="$RUN_DIR/$run_stamp.stderr.log"

  write_status "running" "Brownie run started at $started_at" "$run_stamp" "" "${CONSECUTIVE_FAILURES:-0}"

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

  (
    cd "$PHASE_LOOP_WORKSPACE_ROOT" || exit 70
    export BROWNIE_WORKSPACE_ROOT="${BROWNIE_WORKSPACE_ROOT:-"$PHASE_LOOP_WORKSPACE_ROOT"}"
    if command -v timeout >/dev/null 2>&1; then
      timeout "$PHASE_LOOP_BROWNIE_TIMEOUT_SECONDS" "$BROWNIE_BIN" run --file "$PHASE_LOOP_PROMPT"
    else
      "$BROWNIE_BIN" run --file "$PHASE_LOOP_PROMPT"
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
  local backoff
  while true; do
    if [ -f "$STOP_FILE" ]; then
      write_status "stopped" "Stop file present." "" "" "$CONSECUTIVE_FAILURES"
      printf '%s stop file observed; exiting\n' "$(now_utc)" >> "$SUPERVISOR_LOG"
      exit 0
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
  nohup "$0" supervise >> "$LOG_DIR/launcher.out" 2>> "$LOG_DIR/launcher.err" &
  echo $! > "$PID_FILE"
  write_status "starting" "Supervisor launch requested." "" "" 0
  echo "phase-loop start requested: pid $!"
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
