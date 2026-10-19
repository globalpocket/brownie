#!/usr/bin/env bash
set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

run_case() {
  local mode="$1"
  local state_dir
  state_dir="$(mktemp -d "${TMPDIR:-/tmp}/brownie-watchdog-errexit.XXXXXX")"
  mkdir -p "$state_dir/logs" "$state_dir/todo-claims" "$state_dir/runs" "$state_dir/trajectories" "$state_dir/known-good-targets"
  trap 'rm -rf "$state_dir"' RETURN
  PHASE_LOOP_STATE_DIR="$state_dir" STATE_DIR="$state_dir" ROOT_DIR="$ROOT_DIR" MODE="$mode" bash -c '
    set -u
    printf "%s\n" "$$" > "$STATE_DIR/phase-loop.pid"
    printf "%s\n" "{\"schema_version\":1,\"pid\":$$,\"generation\":\"generation-1\",\"root_dir\":\"$ROOT_DIR\"}" > "$STATE_DIR/phase-loop-owner.json"
    printf "%s\n" "{\"status\":\"running\",\"run_id\":\"continuation-run\",\"updated_at\":\"2026-10-18T01:00:00.000Z\",\"continuation_required\":true,\"controller_action\":\"resume\",\"supervisor_pid\":$$,\"supervisor_generation\":\"generation-1\"}" > "$STATE_DIR/status.json"
    if [ "$MODE" = "on" ]; then
      set -e
    else
      set +e
    fi
    source "$ROOT_DIR/phase-loop.sh" status >/dev/null 2>&1
    if [ "$MODE" = "on" ]; then
      if phase_loop_watch_continuation_liveness "errexit-$MODE"; then
        result=0
      else
        result=$?
      fi
      case "$-" in *e*) ;; *) exit 11 ;; esac
    else
      phase_loop_watch_continuation_liveness "errexit-$MODE"
      result=$?
      case "$-" in *e*) exit 12 ;; esac
    fi
    [ "$result" -eq 75 ]
  ' bash
}

run_case off
run_case on

supervise_case_dir="$(mktemp -d "${TMPDIR:-/tmp}/brownie-watchdog-supervise.XXXXXX")"
trap 'rm -rf "$supervise_case_dir"' EXIT
mkdir -p "$supervise_case_dir/logs"
set +e
PHASE_LOOP_STATE_DIR="$supervise_case_dir" STATE_DIR="$supervise_case_dir" ROOT_DIR="$ROOT_DIR" bash -c '
  set -e
  source "$ROOT_DIR/phase-loop.sh" status >/dev/null 2>&1
  acquire_lock() { return 0; }
  write_supervisor_owner() { :; }
  write_status() {
    printf "%s|%s|%s|%s\n" "$1" "$2" "$3" "$4" > "$STATE_DIR/supervisor-status.txt"
  }
  phase_loop_watch_continuation_liveness() { return 75; }
  stop_if_todo_empty() { touch "$STATE_DIR/stop-if-todo-empty-called"; return 0; }
  run_brownie_once() { touch "$STATE_DIR/run-brownie-once-called"; return 0; }
  supervise
' bash
supervise_status=$?
set -e
[ "$supervise_status" -eq 78 ]
[ "$(cut -d "|" -f 1 "$supervise_case_dir/supervisor-status.txt")" = "blocked" ]
[ ! -e "$supervise_case_dir/stop-if-todo-empty-called" ]
[ ! -e "$supervise_case_dir/run-brownie-once-called" ]

supervise_error_case_dir="$(mktemp -d "${TMPDIR:-/tmp}/brownie-watchdog-supervise-error.XXXXXX")"
trap 'rm -rf "$supervise_error_case_dir"' EXIT
mkdir -p "$supervise_error_case_dir/logs"
set +e
PHASE_LOOP_STATE_DIR="$supervise_error_case_dir" STATE_DIR="$supervise_error_case_dir" ROOT_DIR="$ROOT_DIR" bash -c '
  set -e
  source "$ROOT_DIR/phase-loop.sh" status >/dev/null 2>&1
  acquire_lock() { return 0; }
  write_supervisor_owner() { :; }
  write_status() {
    printf "%s|%s|%s|%s\n" "$1" "$2" "$3" "$4" > "$STATE_DIR/supervisor-status.txt"
  }
  phase_loop_watch_continuation_liveness() { return 78; }
  stop_if_todo_empty() { touch "$STATE_DIR/stop-if-todo-empty-called"; return 0; }
  run_brownie_once() { touch "$STATE_DIR/run-brownie-once-called"; return 0; }
  supervise
' bash
supervise_error_status=$?
set -e
[ "$supervise_error_status" -eq 78 ]
[ "$(cut -d "|" -f 1 "$supervise_error_case_dir/supervisor-status.txt")" = "blocked" ]
[ ! -e "$supervise_error_case_dir/stop-if-todo-empty-called" ]
[ ! -e "$supervise_error_case_dir/run-brownie-once-called" ]

start_case_dir="$(mktemp -d "${TMPDIR:-/tmp}/brownie-watchdog-start.XXXXXX")"
trap 'rm -rf "$start_case_dir"' EXIT
mkdir -p "$start_case_dir/logs"
set +e
PHASE_LOOP_STATE_DIR="$start_case_dir" STATE_DIR="$start_case_dir" ROOT_DIR="$ROOT_DIR" bash -c '
  set -e
  source "$ROOT_DIR/phase-loop.sh" status >/dev/null 2>&1
  phase_loop_watch_continuation_liveness() { return 75; }
  is_running() { touch "$STATE_DIR/is-running-called"; return 0; }
  start
' bash
start_status=$?
set -e
[ "$start_status" -eq 75 ]
[ ! -e "$start_case_dir/is-running-called" ]

migration_start_case_dir="$(mktemp -d "${TMPDIR:-/tmp}/brownie-watchdog-migration-start.XXXXXX")"
trap 'rm -rf "$migration_start_case_dir"' EXIT
mkdir -p "$migration_start_case_dir/logs"
set +e
PHASE_LOOP_STATE_DIR="$migration_start_case_dir" STATE_DIR="$migration_start_case_dir" ROOT_DIR="$ROOT_DIR" bash -c '
  set -e
  source "$ROOT_DIR/phase-loop.sh" status >/dev/null 2>&1
  phase_loop_migrate_legacy_state() { return 75; }
  phase_loop_watch_continuation_liveness() { touch "$STATE_DIR/watchdog-called"; return 0; }
  start
' bash
migration_start_status=$?
set -e
[ "$migration_start_status" -eq 75 ]
[ ! -e "$migration_start_case_dir/watchdog-called" ]

ownership_case_dir="$(mktemp -d "${TMPDIR:-/tmp}/brownie-watchdog-owner.XXXXXX")"
trap 'rm -rf "$ownership_case_dir"' EXIT
mkdir -p "$ownership_case_dir/logs"
PHASE_LOOP_STATE_DIR="$ownership_case_dir" STATE_DIR="$ownership_case_dir" ROOT_DIR="$ROOT_DIR" bash -c '
  set -u
  source "$ROOT_DIR/phase-loop.sh" status >/dev/null 2>&1
  PID_FILE="$STATE_DIR/phase-loop.pid"
  SUPERVISOR_OWNER_FILE="$STATE_DIR/phase-loop-owner.json"
  STATUS_FILE="$STATE_DIR/status.json"
  printf "%s\n" "$$" > "$PID_FILE"
  printf "%s\n" "bash $ROOT_DIR/phase-loop.sh supervise" > "$STATE_DIR/process-command.txt"
  process_command() { cat "$STATE_DIR/process-command.txt"; }
  printf "%s\n" "{\"schema_version\":1,\"pid\":$$,\"generation\":\"foreign-generation\",\"root_dir\":\"/foreign-checkout\"}" > "$SUPERVISOR_OWNER_FILE"
  printf "%s\n" "{\"status\":\"supervising\",\"supervisor_pid\":$$,\"supervisor_generation\":\"foreign-generation\"}" > "$STATUS_FILE"
  if is_running; then
    exit 1
  fi
' bash
printf '%s\n' 'phase-loop watchdog preserves caller errexit state (off/on)'
printf '%s\n' 'phase-loop supervisor terminalizes watchdog ownership failure (75 -> blocked/78)'
printf '%s\n' 'phase-loop supervisor terminalizes generic watchdog failure (78 -> blocked/78)'
printf '%s\n' 'phase-loop startup checks continuation watchdog before live-owner return'
printf '%s\n' 'phase-loop startup fails closed before watchdog when legacy migration is blocked'
printf '%s\n' 'phase-loop is_running fails closed on foreign owner metadata'

migration_lock_case_dir="$(mktemp -d "${TMPDIR:-/tmp}/brownie-watchdog-migration-lock.XXXXXX")"
trap 'rm -rf "$migration_lock_case_dir"' EXIT
mkdir -p "$migration_lock_case_dir/logs" "$migration_lock_case_dir/phase-loop-legacy-migration.lock"
printf '%s\n' "$$" > "$migration_lock_case_dir/phase-loop-legacy-migration.lock/pid"
PHASE_LOOP_STATE_DIR="$migration_lock_case_dir" STATE_DIR="$migration_lock_case_dir" ROOT_DIR="$ROOT_DIR" bash -c '
  set -u
  source "$ROOT_DIR/phase-loop.sh" status >/dev/null 2>&1
  if acquire_lock; then
    exit 1
  fi
  [ ! -d "$STATE_DIR/phase-loop.lock" ]
' bash
printf '%s\n' 'phase-loop supervisor lock acquisition is serialized against legacy migration cleanup'

restart_case_dir="$(mktemp -d "${TMPDIR:-/tmp}/brownie-watchdog-restart.XXXXXX")"
trap 'rm -rf "$restart_case_dir"' EXIT
mkdir -p "$restart_case_dir/logs" "$restart_case_dir/phase-loop.lock"
set +e
PHASE_LOOP_STATE_DIR="$restart_case_dir" STATE_DIR="$restart_case_dir" ROOT_DIR="$ROOT_DIR" bash -c '
  set -u
  printf "%s\n" "$$" > "$STATE_DIR/phase-loop.pid"
  bash "$ROOT_DIR/phase-loop.sh" restart
' bash
restart_status=$?
set -e
[ "$restart_status" -eq 75 ]
[ -f "$restart_case_dir/phase-loop.pid" ]
[ -d "$restart_case_dir/phase-loop.lock" ]
printf '%s\n' 'phase-loop restart refuses to delete a live unowned supervisor'
