#!/usr/bin/env bash

# Process lifecycle and audit helpers for phase-loop claim-smoke fixtures.
# This file is sourced by the smoke suite and by its isolated scheduler tests.

phase_loop_claim_smoke_now_utc() {
  date -u '+%Y-%m-%dT%H:%M:%SZ'
}

phase_loop_claim_smoke_monotonic_ns() {
  if command -v perl >/dev/null 2>&1; then
    perl -MTime::HiRes=clock_gettime,CLOCK_MONOTONIC -e 'print int(clock_gettime(CLOCK_MONOTONIC) * 1000000000), qq(\n)'
  else
    python3 -c 'import time; print(time.monotonic_ns())'
  fi
}

phase_loop_claim_smoke_process_group() {
  local pid="$1"
  ps -o pgid= -p "$pid" 2>/dev/null | tr -d '[:space:]' || true
}

phase_loop_claim_smoke_process_is_live() {
  local pid="$1"
  local state
  state="$(ps -o stat= -p "$pid" 2>/dev/null | tr -d '[:space:]' || true)"
  [ -n "$state" ] && [[ "$state" != Z* ]]
}

phase_loop_claim_smoke_group_has_live_members() {
  local pgid="$1"
  case "$pgid" in
    ''|*[!0-9]*) return 1 ;;
  esac
  ps -eo pgid=,stat= 2>/dev/null | awk -v target="$pgid" '$1 == target && $2 !~ /^Z/ { found = 1 } END { exit(found ? 0 : 1) }'
}

phase_loop_claim_smoke_process_group_members() {
  local pgid="$1"
  case "$pgid" in
    ''|*[!0-9]*) return 0 ;;
  esac
  ps -eo pid=,ppid=,pgid=,stat=,command= 2>/dev/null |
    awk -v target="$pgid" '$3 == target && $4 !~ /^Z/ { print }'
}

phase_loop_claim_smoke_start_process_group() {
  if command -v setsid >/dev/null 2>&1; then
    setsid "$@" &
    PHASE_LOOP_CLAIM_SMOKE_LAST_ISOLATED=1
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c 'import os, sys; os.setsid(); os.execvp(sys.argv[1], sys.argv[1:])' "$@" &
    PHASE_LOOP_CLAIM_SMOKE_LAST_ISOLATED=1
  else
    "$@" &
    PHASE_LOOP_CLAIM_SMOKE_LAST_ISOLATED=0
  fi
  PHASE_LOOP_CLAIM_SMOKE_LAST_PID="$!"
  if [ "$PHASE_LOOP_CLAIM_SMOKE_LAST_ISOLATED" -eq 1 ]; then
    PHASE_LOOP_CLAIM_SMOKE_LAST_PGID="$PHASE_LOOP_CLAIM_SMOKE_LAST_PID"
  else
    PHASE_LOOP_CLAIM_SMOKE_LAST_PGID="$(phase_loop_claim_smoke_process_group "$PHASE_LOOP_CLAIM_SMOKE_LAST_PID")"
  fi
}

phase_loop_claim_smoke_terminate_process_group() {
  local pid="$1"
  local grace_seconds="${2:-3}"
  local requested_pgid="${3:-}"
  local pgid
  local current_pgid
  local elapsed=0
  pgid="${requested_pgid:-$(phase_loop_claim_smoke_process_group "$pid")}" 
  current_pgid="$(phase_loop_claim_smoke_process_group "$$")"

  if [ -n "$pgid" ] && [ "$pgid" != "$current_pgid" ]; then
    kill -TERM -"$pgid" 2>/dev/null || true
  fi
  kill -TERM "$pid" 2>/dev/null || true

  while [ "$elapsed" -lt "$grace_seconds" ] && {
    phase_loop_claim_smoke_process_is_live "$pid" || {
      [ -n "$pgid" ] && phase_loop_claim_smoke_group_has_live_members "$pgid"
    }
  }; do
    sleep 1
    elapsed=$((elapsed + 1))
  done

  if [ -n "$pgid" ] && [ "$pgid" != "$current_pgid" ] && phase_loop_claim_smoke_group_has_live_members "$pgid"; then
    kill -KILL -"$pgid" 2>/dev/null || true
  fi
  kill -KILL "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  if [ -n "$pgid" ] && phase_loop_claim_smoke_group_has_live_members "$pgid"; then
    echo "phase-loop claim smoke process-group cleanup failed: pid=${pid} pgid=${pgid} members=$(phase_loop_claim_smoke_process_group_members "$pgid" | tr '\n' ';')" >&2
    return 1
  fi
  return 0
}

phase_loop_claim_smoke_append_audit_event() {
  local audit_file="$1"
  local event="$2"
  local shard="$3"
  local pid="$4"
  local pgid="$5"
  local status="$6"
  local exit_code="$7"
  local stdout_path="$8"
  local stderr_path="$9"
  local control_root="${10}"
  local state_root="${11}"
  local workspace_root="${12}"
  local detail="${13}"
  local expected_exit_codes="${14:-0}"
  local accepted="${15:-}"
  local started_monotonic_ns="${16:-}"
  local deadline_monotonic_ns="${17:-}"
  mkdir -p "$(dirname "$audit_file")"
  python3 - "$audit_file" "$event" "$shard" "$pid" "$pgid" "$status" "$exit_code" "$stdout_path" "$stderr_path" "$control_root" "$state_root" "$workspace_root" "$detail" "$expected_exit_codes" "$accepted" "$started_monotonic_ns" "$deadline_monotonic_ns" <<'PY'
import json
import pathlib
import sys
from datetime import datetime, timezone

(
    audit_file,
    event,
    shard,
    pid,
    pgid,
    status,
    exit_code,
    stdout_path,
    stderr_path,
    control_root,
    state_root,
    workspace_root,
    detail,
    expected_exit_codes,
    accepted,
    started_monotonic_ns,
    deadline_monotonic_ns,
) = sys.argv[1:]

def optional(value):
    return value if value else None

record = {
    "event": event,
    "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "shard": optional(shard),
    "pid": int(pid) if pid.isdigit() else None,
    "pgid": int(pgid) if pgid.isdigit() else None,
    "status": optional(status),
    "exit_code": int(exit_code) if exit_code.lstrip("-").isdigit() else None,
    "stdout_path": optional(stdout_path),
    "stderr_path": optional(stderr_path),
    "temp_root": str(pathlib.Path(audit_file).parent),
    "control_root": optional(control_root),
    "state_root": optional(state_root),
    "workspace_root": optional(workspace_root),
    "detail": optional(detail),
    "expected_exit_codes": [int(code) for code in expected_exit_codes.split(",") if code.strip().lstrip("-").isdigit()],
    "accepted": True if accepted == "true" else False if accepted == "false" else None,
    "started_monotonic_ns": int(started_monotonic_ns) if started_monotonic_ns.isdigit() else None,
    "deadline_monotonic_ns": int(deadline_monotonic_ns) if deadline_monotonic_ns.isdigit() else None,
}
with pathlib.Path(audit_file).open("a", encoding="utf-8") as handle:
    handle.write(json.dumps(record, sort_keys=True) + "\n")
PY
}

phase_loop_claim_smoke_emit_audit_event() {
  local audit_file="$1"
  shift
  phase_loop_claim_smoke_append_audit_event "$audit_file" "$@"
  tail -n 1 "$audit_file" >&2 || true
}

phase_loop_claim_smoke_expected_exit_codes() {
  local shard="$1"
  local contract="${2:-}"
  local entry
  local name
  local codes
  local -a entries=()
  if [ -n "$contract" ]; then
    IFS=';' read -r -a entries <<< "$contract"
  fi
  if [ -n "$contract" ]; then
    for entry in "${entries[@]}"; do
      name="${entry%%=*}"
      codes="${entry#*=}"
      if [ "$name" = "$shard" ] && [ "$entry" != "$name" ]; then
        printf '%s\n' "$codes"
        return 0
      fi
    done
  fi
  printf '%s\n' 0
}

phase_loop_claim_smoke_exit_allowed() {
  local actual="$1"
  local expected="$2"
  local code
  local -a expected_codes=()
  if [ -n "$expected" ]; then
    IFS=',' read -r -a expected_codes <<< "$expected"
  fi
  if [ -n "$expected" ]; then
    for code in "${expected_codes[@]}"; do
      if [ "$actual" = "$code" ]; then
        return 0
      fi
    done
  fi
  return 1
}

phase_loop_claim_smoke_effective_batch_size() {
  local shard="$1"
  local requested_batch_size="$2"
  local command_timeout_seconds="$3"
  local cpu_count="${4:-0}"
  # The terminal recovery shard is the expensive liveness proof for merged
  # delivery.  It can approach its bounded deadline by itself, so never let
  # unrelated fixture work consume that same deadline.
  if [ "$shard" = "terminal" ]; then
    printf '1\n'
    return 0
  fi
  case "$cpu_count" in
    ''|*[!0-9]*) cpu_count=0 ;;
  esac
  if [ "$cpu_count" -le 4 ] && [ "$command_timeout_seconds" -le 90 ] && [ "$requested_batch_size" -gt 1 ]; then
    case "$shard" in
      queue|queue-claim|queue-recovery|queue-integrity)
        printf '1\n'
        return 0
        ;;
    esac
  fi
  printf '%s\n' "$requested_batch_size"
}

phase_loop_claim_smoke_write_audit_manifest() {
  local shard_dir="$1"
  local output_file="$2"
  local scheduler_timed_out="$3"
  python3 - "$shard_dir" "$output_file" "$scheduler_timed_out" <<'PY'
import json
import pathlib
import sys

shard_dir = pathlib.Path(sys.argv[1])
output_file = pathlib.Path(sys.argv[2])
scheduler_timed_out = sys.argv[3] == "1"

def tail(path):
    if not path:
        return []
    candidate = pathlib.Path(path)
    if not candidate.is_file():
        return []
    lines = candidate.read_text(encoding="utf-8", errors="replace").splitlines()[-80:]
    return [line if len(line) <= 2000 else line[-2000:] for line in lines]

records = []
for audit_file in sorted(shard_dir.glob("*.audit.jsonl")):
    for line in audit_file.read_text(encoding="utf-8", errors="replace").splitlines():
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            records.append({"event": "invalid_audit_record", "audit_file": str(audit_file), "raw": line})
            continue
        record["stdout_tail"] = tail(record.get("stdout_path"))
        record["stderr_tail"] = tail(record.get("stderr_path"))
        records.append(record)

manifest = {
    "schema_version": 1,
    "scheduler_timed_out": scheduler_timed_out,
    "shard_dir": str(shard_dir),
    "records": records,
}
output_file.parent.mkdir(parents=True, exist_ok=True)
output_file.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
}

phase_loop_claim_smoke_run_with_timeout() {
  local seconds="$1"
  shift
  local expected_exit_codes=0
  if [ "${1:-}" = "--expected-exit" ]; then
    expected_exit_codes="$2"
    shift 2
  fi
  local audit_file="${PHASE_LOOP_CLAIM_SMOKE_AUDIT_FILE:-}"
  local shard_name="${PHASE_LOOP_CLAIM_SMOKE_SHARD_NAME:-command}"
  local command_description="$*"
  local child_pid
  local child_pgid
  local elapsed=0
  local timed_out=0
  local child_status=0

  phase_loop_claim_smoke_start_process_group "$@"
  child_pid="$PHASE_LOOP_CLAIM_SMOKE_LAST_PID"
  child_pgid="$PHASE_LOOP_CLAIM_SMOKE_LAST_PGID"
  while phase_loop_claim_smoke_process_is_live "$child_pid"; do
    if [ "$elapsed" -ge "$seconds" ]; then
      echo "command timed out after ${seconds}s: ${command_description} pid=${child_pid} pgid=${child_pgid}" >&2
      phase_loop_claim_smoke_terminate_process_group "$child_pid"
      timed_out=1
      break
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  if [ "$timed_out" -eq 1 ]; then
    child_status=124
    if [ -n "$audit_file" ]; then
      phase_loop_claim_smoke_append_audit_event \
        "$audit_file" command_timeout "$shard_name" "$child_pid" "$child_pgid" \
        timed_out 124 "" "" "${PHASE_LOOP_CONTROL_ROOT:-}" \
        "${PHASE_LOOP_STATE_DIR:-}" "${PHASE_LOOP_WORKSPACE_ROOT:-$PWD}" "$command_description"
    fi
  elif wait "$child_pid"; then
    child_status=0
  else
    child_status="$?"
  fi
  if [ -n "$child_pgid" ] && phase_loop_claim_smoke_group_has_live_members "$child_pgid"; then
    phase_loop_claim_smoke_terminate_process_group "$child_pid" 3 "$child_pgid"
  fi
  if [ "$child_status" -ne 0 ]; then
    case ",${expected_exit_codes}," in
      *,"$child_status",*) ;;
      *)
        echo "phase-loop claim smoke command failed exit=${child_status}: ${command_description}" >&2
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

phase_loop_claim_smoke_wait_for_pid_exit() {
  local pid="$1"
  local seconds="$2"
  local elapsed=0
  while phase_loop_claim_smoke_process_is_live "$pid"; do
    if [ "$elapsed" -ge "$seconds" ]; then
      echo "expected pid=$pid to exit within ${seconds}s" >&2
      phase_loop_claim_smoke_terminate_process_group "$pid"
      return 1
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  wait "$pid" 2>/dev/null || true
}

phase_loop_claim_smoke_run_scheduler() {
  local shard_dir="$1"
  local script_path="$2"
  local batch_size="$3"
  local watchdog_seconds="$4"
  local command_timeout_seconds="$5"
  local expected_exit_contract="$6"
  shift 6
  local -a shards=("$@")
  local audit_file="$shard_dir/scheduler.audit.jsonl"
  local manifest_file="${PHASE_LOOP_CLAIM_SMOKE_AUDIT_OUTPUT:-$shard_dir/claim-smoke-audit.json}"
  local watchdog_pid=""
  local watchdog_pgid=""
  local scheduler_parent_pid="$$"
  local scheduler_timed_out=0
  local cleanup_running=0
  local claim_smoke_failed=0
  local batch_start=0
  local claim_smoke_batch_end
  local shard
  local control_root
  local stdout_log
  local stderr_log
  local pid
  local pgid
  local status
  local expected_exit_codes
  local accepted
  local started_monotonic_ns
  local deadline_monotonic_ns
  local now_monotonic_ns
  local command_timeout_detail
  local active_done_count
  local effective_batch_size
  local batch_rationale
  local shard_cpu_count
  local configured_watchdog_seconds="$watchdog_seconds"
  local effective_watchdog_seconds
  local required_watchdog_seconds
  local planned_batches=0
  local planned_shards="${#shards[@]}"
  local planned_max_batch_size=0
  local cleanup_margin_seconds
  local plan_overhead_seconds
  local plan_batch_sizes=""
  local plan_index
  local remaining_shards
  local index
  local i
  local -a active_pids=()
  local -a active_pgids=()
  local -a active_shards=()
  local -a active_started_ns=()
  local -a active_deadline_ns=()
  local -a active_done=()

  mkdir -p "$shard_dir"

  shard_cpu_count="${PHASE_LOOP_CLAIM_SMOKE_CPU_COUNT:-unknown}"
  plan_index=0
  while [ "$plan_index" -lt "${#shards[@]}" ]; do
    shard="${shards[$plan_index]}"
    effective_batch_size="$(phase_loop_claim_smoke_effective_batch_size "$shard" "$batch_size" "$command_timeout_seconds" "${PHASE_LOOP_CLAIM_SMOKE_CPU_COUNT:-0}")"
    remaining_shards=$((${#shards[@]} - plan_index))
    if [ "$effective_batch_size" -gt "$remaining_shards" ]; then
      effective_batch_size="$remaining_shards"
    fi
    planned_batches=$((planned_batches + 1))
    if [ "$effective_batch_size" -gt "$planned_max_batch_size" ]; then
      planned_max_batch_size="$effective_batch_size"
    fi
    if [ -z "$plan_batch_sizes" ]; then
      plan_batch_sizes="$effective_batch_size"
    else
      plan_batch_sizes="$plan_batch_sizes,$effective_batch_size"
    fi
    plan_index=$((plan_index + effective_batch_size))
  done
  cleanup_margin_seconds=$((3 * planned_max_batch_size + 5))
  plan_overhead_seconds="$planned_batches"
  required_watchdog_seconds=$((planned_batches * command_timeout_seconds + cleanup_margin_seconds + plan_overhead_seconds))
  effective_watchdog_seconds="$configured_watchdog_seconds"
  if [ "$effective_watchdog_seconds" -lt "$required_watchdog_seconds" ]; then
    effective_watchdog_seconds="$required_watchdog_seconds"
    echo "phase-loop claim smoke scheduler: configured watchdog=${configured_watchdog_seconds}s below computed minimum=${required_watchdog_seconds}s; using effective watchdog=${effective_watchdog_seconds}s" >&2
  fi
  phase_loop_claim_smoke_emit_audit_event "$audit_file" scheduler_plan "" "" "" planned "" "" "" "" "" "$PWD" "configured_watchdog_seconds=$configured_watchdog_seconds effective_watchdog_seconds=$effective_watchdog_seconds required_watchdog_seconds=$required_watchdog_seconds planned_shards=$planned_shards planned_batches=$planned_batches requested_batch_size=$batch_size effective_batch_sizes=$plan_batch_sizes command_timeout_seconds=$command_timeout_seconds cleanup_margin_seconds=$cleanup_margin_seconds plan_overhead_seconds=$plan_overhead_seconds cpu_count=$shard_cpu_count" none ""

  phase_loop_claim_smoke_cleanup() {
    local cleanup_status="$?"
    if [ "$cleanup_running" -eq 1 ]; then
      return
    fi
    cleanup_running=1
    if [ -n "$watchdog_pid" ]; then
      if phase_loop_claim_smoke_process_is_live "$watchdog_pid" || phase_loop_claim_smoke_group_has_live_members "$watchdog_pgid"; then
        if ! phase_loop_claim_smoke_terminate_process_group "$watchdog_pid" 1 "$watchdog_pgid"; then
          claim_smoke_failed=1
          phase_loop_claim_smoke_emit_audit_event "$audit_file" watchdog_cleanup_failed "" "$watchdog_pid" "$watchdog_pgid" failed 124 "" "" "" "" "$PWD" "watchdog process group remained live after TERM/KILL; inspect stderr for members" none false || true
        else
          phase_loop_claim_smoke_emit_audit_event "$audit_file" watchdog_stopped "" "$watchdog_pid" "$watchdog_pgid" stopped "" "" "" "" "" "$PWD" "watchdog process group terminated" none true || true
        fi
      else
        wait "$watchdog_pid" 2>/dev/null || true
        phase_loop_claim_smoke_emit_audit_event "$audit_file" watchdog_stopped "" "$watchdog_pid" "$watchdog_pgid" stopped "" "" "" "" "" "$PWD" "watchdog already exited" none true || true
      fi
    fi
    for i in "${!active_pids[@]}"; do
      pid="${active_pids[$i]}"
      pgid="${active_pgids[$i]}"
      if phase_loop_claim_smoke_process_is_live "$pid" || phase_loop_claim_smoke_group_has_live_members "$pgid"; then
        phase_loop_claim_smoke_terminate_process_group "$pid" 3 "$pgid" || true
        shard="${active_shards[$i]}"
        control_root="$shard_dir/$shard-control-root"
        stdout_log="$shard_dir/$shard.stdout.log"
        stderr_log="$shard_dir/$shard.stderr.log"
        phase_loop_claim_smoke_append_audit_event "$audit_file" shard_timeout "$shard" "$pid" "$pgid" timed_out 124 "$stdout_log" "$stderr_log" "$control_root" "$control_root" "$PWD" "scheduler watchdog expired" || true
      fi
    done
    phase_loop_claim_smoke_write_audit_manifest "$shard_dir" "$manifest_file" "$scheduler_timed_out" || true
    if [ "$cleanup_status" -ne 0 ] || [ "$scheduler_timed_out" -eq 1 ] || [ "$claim_smoke_failed" -ne 0 ]; then
      echo "phase-loop claim smoke audit: $manifest_file" >&2
      cat "$manifest_file" >&2 || true
    fi
    if [ "$manifest_file" != "$shard_dir/claim-smoke-audit.json" ]; then
      :
    fi
    rm -rf -- "$shard_dir" || true
  }

  phase_loop_claim_smoke_scheduler_signal() {
    scheduler_timed_out=1
    phase_loop_claim_smoke_emit_audit_event "$audit_file" scheduler_timeout "" "$watchdog_pid" "$watchdog_pgid" timed_out 124 "" "" "" "" "$PWD" "watchdog expired after effective=${effective_watchdog_seconds}s configured=${configured_watchdog_seconds}s required=${required_watchdog_seconds}s; command=sleep ${effective_watchdog_seconds}; parent_pid=${scheduler_parent_pid}" none false || true
    exit 143
  }

  trap phase_loop_claim_smoke_cleanup EXIT
  trap phase_loop_claim_smoke_scheduler_signal TERM INT
  # The watchdog has its own process group.  Killing only the parent shell of
  # a background `( sleep … )` leaves its sleep child orphaned on Linux, which
  # makes GitHub Actions hang during orphan-process cleanup after VSIX check.
  # Keep the deadline bounded and make cleanup fail closed if the group cannot
  # be reaped.
  phase_loop_claim_smoke_start_process_group "$BASH" -c '
    sleep "$1"
    kill -TERM "$2" 2>/dev/null || exit 0
  ' phase-loop-claim-smoke-watchdog "$effective_watchdog_seconds" "$scheduler_parent_pid"
  watchdog_pid="$PHASE_LOOP_CLAIM_SMOKE_LAST_PID"
  watchdog_pgid="$PHASE_LOOP_CLAIM_SMOKE_LAST_PGID"
  phase_loop_claim_smoke_emit_audit_event "$audit_file" watchdog_started "" "$watchdog_pid" "$watchdog_pgid" running "" "" "" "" "" "$PWD" "command=sleep ${effective_watchdog_seconds}; parent_pid=${scheduler_parent_pid}" none ""

  while [ "$batch_start" -lt "${#shards[@]}" ]; do
    active_pids=()
    active_pgids=()
    active_shards=()
    active_started_ns=()
    active_deadline_ns=()
    active_done=()
    effective_batch_size="$batch_size"
    batch_rationale="configured_batch_size"
    shard_cpu_count="${PHASE_LOOP_CLAIM_SMOKE_CPU_COUNT:-unknown}"
    effective_batch_size="$(phase_loop_claim_smoke_effective_batch_size "${shards[$batch_start]:-}" "$batch_size" "$command_timeout_seconds" "${PHASE_LOOP_CLAIM_SMOKE_CPU_COUNT:-0}")"
    if [ "$effective_batch_size" -lt "$batch_size" ]; then
      if [ "${shards[$batch_start]:-}" = "terminal" ]; then
        batch_rationale="terminal_isolated_for_deadline"
      else
        batch_rationale="queue_serialized_for_low_cpu_90s_deadline"
      fi
    fi
    claim_smoke_batch_end=$((batch_start + effective_batch_size))
    if [ "$claim_smoke_batch_end" -gt "${#shards[@]}" ]; then
      claim_smoke_batch_end="${#shards[@]}"
    fi
    effective_batch_size=$((claim_smoke_batch_end - batch_start))
    index="$batch_start"
    while [ "$index" -lt "$claim_smoke_batch_end" ]; do
      shard="${shards[$index]}"
      control_root="$shard_dir/$shard-control-root"
      stdout_log="$shard_dir/$shard.stdout.log"
      stderr_log="$shard_dir/$shard.stderr.log"
      mkdir -p "$control_root"
      PHASE_LOOP_CLAIM_SMOKE_SECTION="$shard" \
      PHASE_LOOP_CONTROL_ROOT="$control_root" \
      PHASE_LOOP_CLAIM_SMOKE_AUDIT_FILE="$shard_dir/$shard.audit.jsonl" \
      PHASE_LOOP_CLAIM_SMOKE_SHARD_NAME="$shard" \
      phase_loop_claim_smoke_start_process_group "$BASH" "$script_path" >"$stdout_log" 2>"$stderr_log"
      pid="$PHASE_LOOP_CLAIM_SMOKE_LAST_PID"
      pgid="$PHASE_LOOP_CLAIM_SMOKE_LAST_PGID"
      expected_exit_codes="$(phase_loop_claim_smoke_expected_exit_codes "$shard" "$expected_exit_contract")"
      started_monotonic_ns="$(phase_loop_claim_smoke_monotonic_ns)"
      deadline_monotonic_ns=$((started_monotonic_ns + command_timeout_seconds * 1000000000))
      active_pids+=("$pid")
      active_pgids+=("$pgid")
      active_shards+=("$shard")
      active_started_ns+=("$started_monotonic_ns")
      active_deadline_ns+=("$deadline_monotonic_ns")
      active_done+=(0)
      phase_loop_claim_smoke_emit_audit_event "$audit_file" shard_started "$shard" "$pid" "$pgid" running "" "$stdout_log" "$stderr_log" "$control_root" "$control_root" "$PWD" "batch_start=$batch_start batch_size=$effective_batch_size batch_rationale=$batch_rationale command_timeout_seconds=$command_timeout_seconds cpu_count=$shard_cpu_count expected_exit_codes=$expected_exit_codes" "$expected_exit_codes" "" "$started_monotonic_ns" "$deadline_monotonic_ns"
      index=$((index + 1))
    done
    active_done_count=0
    while [ "$active_done_count" -lt "${#active_pids[@]}" ]; do
      now_monotonic_ns="$(phase_loop_claim_smoke_monotonic_ns)"
      for ((i = 0; i < ${#active_pids[@]}; i += 1)); do
        if [ "${active_done[$i]:-0}" -eq 1 ]; then
          continue
        fi
        pid="${active_pids[$i]}"
        pgid="${active_pgids[$i]}"
        shard="${active_shards[$i]}"
        started_monotonic_ns="${active_started_ns[$i]}"
        deadline_monotonic_ns="${active_deadline_ns[$i]}"
        expected_exit_codes="$(phase_loop_claim_smoke_expected_exit_codes "$shard" "$expected_exit_contract")"

        if ! phase_loop_claim_smoke_process_is_live "$pid"; then
          if wait "$pid"; then
            status=0
          else
            status="$?"
          fi
          if phase_loop_claim_smoke_exit_allowed "$status" "$expected_exit_codes"; then
            accepted=true
          else
            accepted=false
          fi
          if phase_loop_claim_smoke_group_has_live_members "$pgid"; then
            phase_loop_claim_smoke_terminate_process_group "$pid" 3 "$pgid"
          fi
          phase_loop_claim_smoke_emit_audit_event "$audit_file" shard_finished "$shard" "$pid" "$pgid" "$([ "$accepted" = true ] && echo passed || echo failed)" "$status" "$shard_dir/$shard.stdout.log" "$shard_dir/$shard.stderr.log" "$shard_dir/$shard-control-root" "$shard_dir/$shard-control-root" "$PWD" "expected_exit_codes=$expected_exit_codes" "$expected_exit_codes" "$accepted" "$started_monotonic_ns" "$deadline_monotonic_ns"
          if [ "$accepted" != true ]; then
            claim_smoke_failed=1
            echo "phase-loop claim smoke shard failed: $shard actual_exit=$status expected_exit_codes=$expected_exit_codes" >&2
            cat "$shard_dir/$shard.stdout.log" >&2 || true
            cat "$shard_dir/$shard.stderr.log" >&2 || true
          fi
          active_done[$i]=1
          active_done_count=$((active_done_count + 1))
        elif [ "$now_monotonic_ns" -ge "$deadline_monotonic_ns" ]; then
          command_timeout_detail="parent shard deadline expired after ${command_timeout_seconds}s"
          echo "phase-loop claim smoke shard timed out after ${command_timeout_seconds}s: shard=${shard} pid=${pid} pgid=${pgid}" >&2
          phase_loop_claim_smoke_emit_audit_event "$audit_file" command_timeout "$shard" "$pid" "$pgid" timed_out 124 "$shard_dir/$shard.stdout.log" "$shard_dir/$shard.stderr.log" "$shard_dir/$shard-control-root" "$shard_dir/$shard-control-root" "$PWD" "$command_timeout_detail" "$expected_exit_codes" false "$started_monotonic_ns" "$deadline_monotonic_ns"
          phase_loop_claim_smoke_terminate_process_group "$pid" 1 "$pgid" || true
          wait "$pid" 2>/dev/null || true
          phase_loop_claim_smoke_emit_audit_event "$audit_file" shard_finished "$shard" "$pid" "$pgid" failed 124 "$shard_dir/$shard.stdout.log" "$shard_dir/$shard.stderr.log" "$shard_dir/$shard-control-root" "$shard_dir/$shard-control-root" "$PWD" "$command_timeout_detail expected_exit_codes=$expected_exit_codes" "$expected_exit_codes" false "$started_monotonic_ns" "$deadline_monotonic_ns"
          claim_smoke_failed=1
          cat "$shard_dir/$shard.stdout.log" >&2 || true
          cat "$shard_dir/$shard.stderr.log" >&2 || true
          active_done[$i]=1
          active_done_count=$((active_done_count + 1))
        fi
      done
      if [ "$active_done_count" -lt "${#active_pids[@]}" ]; then
        # Keep the scheduler deadline authoritative even when a shard exits
        # during the polling interval; one-second polling can consume the
        # watchdog's cleanup margin on contended CI workers.
        sleep 0.1
      fi
    done
    if [ "$claim_smoke_failed" -ne 0 ]; then
      phase_loop_claim_smoke_cleanup
      trap - EXIT TERM INT
      return 1
    fi
    batch_start="$claim_smoke_batch_end"
  done
  phase_loop_claim_smoke_cleanup
  trap - EXIT TERM INT
  if [ "$claim_smoke_failed" -ne 0 ]; then
    return 1
  fi
  return 0
}
