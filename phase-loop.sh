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
PROGRESS_STATE_FILE="$STATE_DIR/progress-state.json"
LAUNCHD_LABEL="${PHASE_LOOP_LAUNCHD_LABEL:-globalpocket.brownie.phase-loop}"
SCREEN_NAME="${PHASE_LOOP_SCREEN_NAME:-brownie-phase-loop}"

BROWNIE_BIN="${BROWNIE_BIN:-"$ROOT_DIR/target/debug/brownie"}"
PHASE_LOOP_PROMPT="${PHASE_LOOP_PROMPT:-"$ROOT_DIR/phase-loop.md"}"
PHASE_LOOP_TODO="${PHASE_LOOP_TODO:-"$ROOT_DIR/todo.md"}"
PHASE_LOOP_WORKSPACE_ROOT="${PHASE_LOOP_WORKSPACE_ROOT:-"$ROOT_DIR"}"
PHASE_LOOP_CONTROL_ROOT="${PHASE_LOOP_CONTROL_ROOT:-"/Users/satoshitanaka/.codex/automations/brownie-cli-phase-loop"}"
PHASE_LOOP_BROWNIE_STORE_ROOT="${PHASE_LOOP_BROWNIE_STORE_ROOT:-"$ROOT_DIR/.brownie/private/runtime-store"}"
PHASE_LOOP_INTERVAL_SECONDS="${PHASE_LOOP_INTERVAL_SECONDS:-5}"
PHASE_LOOP_FAILURE_BACKOFF_SECONDS="${PHASE_LOOP_FAILURE_BACKOFF_SECONDS:-60}"
PHASE_LOOP_MAX_FAILURE_BACKOFF_SECONDS="${PHASE_LOOP_MAX_FAILURE_BACKOFF_SECONDS:-900}"
PHASE_LOOP_BROWNIE_TIMEOUT_SECONDS="${PHASE_LOOP_BROWNIE_TIMEOUT_SECONDS:-14400}"
PHASE_LOOP_STAGNATION_THRESHOLD="${PHASE_LOOP_STAGNATION_THRESHOLD:-3}"
PHASE_LOOP_PROMPT_MAX_BYTES="${PHASE_LOOP_PROMPT_MAX_BYTES:-65536}"
PHASE_LOOP_SELECTED_TODO_MAX_BYTES="${PHASE_LOOP_SELECTED_TODO_MAX_BYTES:-8192}"
PHASE_LOOP_TODO_SNAPSHOT_LINES="${PHASE_LOOP_TODO_SNAPSHOT_LINES:-240}"
PHASE_LOOP_BASE_PROMPT_SNAPSHOT_LINES="${PHASE_LOOP_BASE_PROMPT_SNAPSHOT_LINES:-400}"
PHASE_LOOP_PROMPT_RETENTION_COUNT="${PHASE_LOOP_PROMPT_RETENTION_COUNT:-20}"
PHASE_LOOP_STOP_GRACE_SECONDS="${PHASE_LOOP_STOP_GRACE_SECONDS:-15}"
PHASE_LOOP_STOP_FORCE_SECONDS="${PHASE_LOOP_STOP_FORCE_SECONDS:-5}"
PHASE_LOOP_SLEEP_POLL_SECONDS="${PHASE_LOOP_SLEEP_POLL_SECONDS:-1}"
PHASE_LOOP_CREATE_PR_AFTER_PROGRESS="${PHASE_LOOP_CREATE_PR_AFTER_PROGRESS:-0}"
PHASE_LOOP_PR_REMOTE="${PHASE_LOOP_PR_REMOTE:-origin}"
PHASE_LOOP_PR_BASE="${PHASE_LOOP_PR_BASE:-main}"
PHASE_LOOP_PR_TITLE_PREFIX="${PHASE_LOOP_PR_TITLE_PREFIX:-Brownie phase-loop}"
PHASE_LOOP_PR_DRAFT="${PHASE_LOOP_PR_DRAFT:-0}"

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
  local escaped_progress_state_file
  escaped_progress_state_file="$(printf '%s' "$PROGRESS_STATE_FILE" | json_escape)"
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
  "progress_state": "$escaped_progress_state_file",
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

status_field() {
  local field="$1"
  if [ ! -f "$STATUS_FILE" ]; then
    return 1
  fi
  python3 - "$STATUS_FILE" "$field" <<'PY'
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

active_claim_queue_fingerprint() {
  claim_field queue_fingerprint 2>/dev/null || true
}

retire_old_prompt_artifacts() {
  local keep_count="$PHASE_LOOP_PROMPT_RETENTION_COUNT"
  python3 - "$RUN_DIR" "$keep_count" <<'PY'
import pathlib
import sys

run_dir = pathlib.Path(sys.argv[1])
keep_count = int(sys.argv[2])
if keep_count < 1:
    keep_count = 1
groups = {}
for path in run_dir.glob("*.prompt.md"):
    stem = path.name[:-len(".prompt.md")]
    groups[stem] = path.stat().st_mtime
old = sorted(groups.items(), key=lambda item: item[1], reverse=True)[keep_count:]
for stem, _ in old:
    for suffix in (".prompt.md", ".prompt.meta.json"):
        target = run_dir / f"{stem}{suffix}"
        try:
            target.unlink()
        except FileNotFoundError:
            pass
PY
}

verify_todo_fresh_for_runtime_start() {
  local expected current
  expected="$(active_claim_queue_fingerprint)"
  current="$(todo_queue_fingerprint)"
  if [ -z "$expected" ] || [ "$expected" != "$current" ]; then
    printf '%s runtime_start_stale_todo_rejected expected=%s actual=%s\n' "$(now_utc)" "$expected" "$current" >> "$SUPERVISOR_LOG"
    return 1
  fi
  return 0
}

archive_stale_todo_claim() {
  local run_stamp="$1"
  local archive_path="$TODO_CLAIM_DIR/stale-$run_stamp.json"
  if [ ! -f "$TODO_CLAIM_FILE" ]; then
    return 0
  fi
  python3 - "$TODO_CLAIM_FILE" "$archive_path" "$run_stamp" "$(now_utc)" <<'PY'
import json
import os
import pathlib
import sys

current_path = pathlib.Path(sys.argv[1])
archive_path = pathlib.Path(sys.argv[2])
run_stamp = sys.argv[3]
timestamp = sys.argv[4]
with open(current_path, encoding="utf-8") as handle:
    claim = json.load(handle)
claim["status"] = "stale_snapshot_rejected"
claim["updated_at"] = timestamp
claim.setdefault("status_history", []).append({
    "status": "stale_snapshot_rejected",
    "run_stamp": run_stamp,
    "updated_at": timestamp,
})
tmp = archive_path.with_suffix(".tmp")
with open(tmp, "w", encoding="utf-8") as handle:
    json.dump(claim, handle, ensure_ascii=False, sort_keys=True, indent=2)
    handle.write("\n")
    handle.flush()
    os.fsync(handle.fileno())
os.chmod(tmp, 0o600)
os.replace(tmp, archive_path)
os.chmod(archive_path, 0o600)
current_path.unlink()
PY
  sync_parent_dir "$TODO_CLAIM_DIR"
}

git_workspace_fingerprint() {
  (
    cd "$PHASE_LOOP_WORKSPACE_ROOT" || exit 1
    {
      git rev-parse HEAD 2>/dev/null || true
      git status --porcelain=v1 2>/dev/null || true
    } | shasum -a 256 | awk '{ print $1 }'
  )
}

validate_cli_json_output() {
  local stdout_log="$1"
  python3 - "$stdout_log" <<'PY'
import json
import sys

path = sys.argv[1]
try:
    with open(path, encoding="utf-8") as handle:
        root = json.load(handle)
except Exception as exc:
    print(f"invalid_json:{exc}")
    sys.exit(1)

payload = root
if isinstance(root, dict):
    if isinstance(root.get("run"), dict):
        payload = root.get("run")
    elif isinstance(root.get("resume"), dict):
        payload = root.get("resume")
if not isinstance(payload, dict):
    print("invalid_schema:root_not_object")
    sys.exit(1)
automation = payload.get("automation")
if not isinstance(automation, dict):
    print("invalid_schema:missing_automation")
    sys.exit(1)
required_strings = ["status", "controller_action", "stop_class", "stop_reason"]
required_bools = ["completed", "blocked", "retryable", "terminal_failure"]
for key in required_strings:
    if not isinstance(payload.get(key), str):
        print(f"invalid_schema:payload.{key}")
        sys.exit(1)
for key in required_bools:
    if not isinstance(payload.get(key), bool):
        print(f"invalid_schema:payload.{key}")
        sys.exit(1)
for key in ["schema_version", "status", "controller_action", "stop_class", "stop_reason"]:
    if key == "schema_version":
        if not isinstance(automation.get(key), int):
            print(f"invalid_schema:automation.{key}")
            sys.exit(1)
    elif not isinstance(automation.get(key), str):
        print(f"invalid_schema:automation.{key}")
        sys.exit(1)
for key in required_bools:
    if not isinstance(automation.get(key), bool):
        print(f"invalid_schema:automation.{key}")
        sys.exit(1)
print("ok")
PY
}

phase_loop_should_resume_active_claim() {
  if [ ! -f "$PROGRESS_STATE_FILE" ]; then
    return 1
  fi
  if ! active_todo_claim_exists; then
    return 1
  fi
  python3 - "$PROGRESS_STATE_FILE" <<'PY'
import json
import sys

try:
    with open(sys.argv[1], encoding="utf-8") as handle:
        state = json.load(handle)
except Exception:
    sys.exit(1)

projection = state.get("progress_projection")
if not isinstance(projection, dict):
    sys.exit(1)
route = projection.get("route")
if not isinstance(route, str) or not route.strip():
    sys.exit(1)
try:
    invocation = json.loads(route)
except Exception:
    sys.exit(1)
if isinstance(invocation, dict) and invocation.get("command") == "resume":
    sys.exit(0)
sys.exit(1)
PY
}

write_progress_state() {
  local stdout_log="$1"
  local run_stamp="$2"
  local exit_code="$3"
  local workspace_before="$4"
  local workspace_after="$5"
  local head_commit="$6"
  local timestamp tmp_progress
  timestamp="$(now_utc)"
  tmp_progress="$PROGRESS_STATE_FILE.$$.$RANDOM.tmp"
  python3 - "$tmp_progress" "$PROGRESS_STATE_FILE" "$stdout_log" "$run_stamp" "$exit_code" "$workspace_before" "$workspace_after" "$head_commit" "$TODO_CLAIM_FILE" "$timestamp" "$PHASE_LOOP_STAGNATION_THRESHOLD" <<'PY'
import hashlib
import json
import os
import pathlib
import sys

out_path = pathlib.Path(sys.argv[1])
state_path = pathlib.Path(sys.argv[2])
stdout_log = pathlib.Path(sys.argv[3])
run_stamp = sys.argv[4]
exit_code = int(sys.argv[5])
workspace_before = sys.argv[6]
workspace_after = sys.argv[7]
head_commit = sys.argv[8]
claim_path = pathlib.Path(sys.argv[9])
timestamp = sys.argv[10]
threshold = int(sys.argv[11])

payload = None
if stdout_log.exists() and stdout_log.stat().st_size > 0:
    with open(stdout_log, encoding="utf-8") as handle:
        root = json.load(handle)
        if isinstance(root, dict) and isinstance(root.get("run"), dict):
            payload = root.get("run")
        elif isinstance(root, dict) and isinstance(root.get("resume"), dict):
            payload = root.get("resume")
        else:
            payload = root
if not isinstance(payload, dict):
    payload = {}

automation = payload.get("automation") if isinstance(payload.get("automation"), dict) else {}
claim = {}
if claim_path.exists():
    try:
        with open(claim_path, encoding="utf-8") as handle:
            claim = json.load(handle)
    except Exception:
        claim = {}

def text(value):
    if value is None:
        return ""
    if isinstance(value, (str, int, float, bool)):
        return str(value)
    return json.dumps(value, sort_keys=True, ensure_ascii=False)

progress_projection = {
    "schema_version": 1,
    "commit": head_commit,
    "claim_id": text(claim.get("claim_id")),
    "selected_todo": text(claim.get("selected_todo")),
    "queue_generation": text(claim.get("queue_generation")),
    "queue_fingerprint": text(claim.get("queue_fingerprint")),
    "cli_status": text(payload.get("status")),
    "controller_action": text(payload.get("controller_action")),
    "stop_class": text(payload.get("stop_class")),
    "stop_reason": text(payload.get("stop_reason")),
    "route": text(payload.get("next_invocation")) or text(automation.get("next_invocation")),
    "closure": text(payload.get("completion_closure_status")),
    "applied": text(payload.get("objective_apply_applied")) or text(payload.get("objective_apply_apply_status")),
    "accepted": text(payload.get("accepted_completion_status")) or text(payload.get("objective_completion_acceptance_acceptance_status")),
    "finalization": text(payload.get("completion_finalization_status")) or text(payload.get("completion_finalization_finalization_fingerprint")),
    "terminal_final_state": text(payload.get("terminal_completion_final_state")),
    "terminal_task_status": text(payload.get("terminal_completion_task_status")),
    "next_action": text(payload.get("next_action")),
}

previous = {}
if state_path.exists():
    try:
        with open(state_path, encoding="utf-8") as handle:
            previous = json.load(handle)
    except Exception:
        previous = {}
previous_projection = previous.get("progress_projection")
if not isinstance(previous_projection, dict):
    previous_projection = {}

workspace_changed = workspace_before != workspace_after
terminal_failed = progress_projection["terminal_final_state"] == "Failed" or progress_projection["terminal_task_status"] == "Failed"
blocked = bool(payload.get("blocked")) or bool(automation.get("blocked")) or terminal_failed
accepted = bool(progress_projection["accepted"])
finalized = bool(progress_projection["finalization"])
applied = progress_projection["applied"].lower() not in ("", "false", "none", "not_applicable")
previous_applied = text(previous_projection.get("applied")).lower() not in ("", "false", "none", "not_applicable")
same_claim_as_previous = bool(progress_projection["claim_id"]) and progress_projection["claim_id"] == text(previous_projection.get("claim_id"))
no_actionable_after_apply = (
    exit_code == 0
    and same_claim_as_previous
    and previous_applied
    and progress_projection["cli_status"] in ("no_eligible_task", "no_actionable_work")
    and progress_projection["stop_class"] == "no_actionable_work"
)
if no_actionable_after_apply and not applied:
    progress_projection["applied"] = text(previous_projection.get("applied"))
    applied = True
progress_projection["completed_by_no_actionable_after_apply"] = no_actionable_after_apply
progress_projection["blocked_by_terminal_task_failure"] = terminal_failed
completed = bool(payload.get("completed")) or bool(automation.get("completed")) or no_actionable_after_apply
meaningful_progress = exit_code == 0 and (workspace_changed or completed or blocked or accepted or finalized or applied)

encoded = json.dumps(progress_projection, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
fingerprint = "sha256:" + hashlib.sha256(encoded.encode("utf-8")).hexdigest()

previous_fingerprint = previous.get("last_progress_fingerprint")
previous_count = int(previous.get("same_progress_count", 0) or 0)
same_count = previous_count + 1 if previous_fingerprint == fingerprint else 1
no_progress = exit_code == 0 and not meaningful_progress
stagnated = no_progress and same_count >= threshold

state = {
    "schema_version": 1,
    "updated_at": timestamp,
    "run_stamp": run_stamp,
    "last_progress_fingerprint": fingerprint,
    "same_progress_count": same_count,
    "stagnation_threshold": threshold,
    "classification": "no_progress" if stagnated else ("non_progress_success" if no_progress else ("progress" if meaningful_progress else "process_failure")),
    "meaningful_progress": meaningful_progress,
    "workspace_changed": workspace_changed,
    "exit_code": exit_code,
    "progress_projection": progress_projection,
    "stdout_log": str(stdout_log),
}
with open(out_path, "w", encoding="utf-8") as handle:
    json.dump(state, handle, ensure_ascii=False, sort_keys=True, indent=2)
    handle.write("\n")
    handle.flush()
    os.fsync(handle.fileno())
os.chmod(out_path, 0o600)
print(json.dumps({
    "fingerprint": fingerprint,
    "same_progress_count": same_count,
    "classification": state["classification"],
    "meaningful_progress": meaningful_progress,
    "stagnated": stagnated,
}, sort_keys=True))
PY
  mv "$tmp_progress" "$PROGRESS_STATE_FILE"
  chmod 600 "$PROGRESS_STATE_FILE"
  sync_parent_dir "$STATE_DIR"
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

tracked_workspace_diff_exists() {
  (
    cd "$PHASE_LOOP_WORKSPACE_ROOT" || exit 1
    ! git diff --quiet --exit-code
  )
}

stage_runtime_applied_paths() {
  local stdout_log="$1"
  (
    cd "$PHASE_LOOP_WORKSPACE_ROOT" || exit 70
    python3 - "$stdout_log" <<'PY' | while IFS= read -r path; do
import json
import sys

root = json.load(open(sys.argv[1], encoding="utf-8"))
if isinstance(root, dict) and isinstance(root.get("run"), dict):
    payload = root.get("run")
elif isinstance(root, dict) and isinstance(root.get("resume"), dict):
    payload = root.get("resume")
else:
    payload = root
path = payload.get("objective_apply_path") if isinstance(payload, dict) else None
if isinstance(path, str) and path.strip():
    print(path)
PY
      case "$path" in
        /*|*..*|"" )
          exit 66
          ;;
      esac
      if ! git ls-files --error-unmatch -- "$path" >/dev/null 2>&1; then
        exit 66
      fi
      git add -- "$path"
    done
  )
}

phase_loop_safe_pr_title() {
  python3 - "$PHASE_LOOP_PR_TITLE_PREFIX" "$(claim_field selected_todo 2>/dev/null || true)" <<'PY'
import re
import sys

prefix = sys.argv[1].strip() or "Brownie phase-loop"
todo = sys.argv[2].strip()
todo = re.sub(r"^\s*[-*]\s+\[\s*\]\s*", "", todo)
todo = re.sub(r"\s+", " ", todo).strip()
title = f"{prefix}: {todo}" if todo else prefix
print(title[:180])
PY
}

phase_loop_create_pr_for_progress() {
  local run_stamp="$1"
  local stdout_log="$2"
  local stderr_log="$3"
  local workspace_before="$4"
  local workspace_after="$5"
  local title body pr_url branch push_rc
  if [ "$PHASE_LOOP_CREATE_PR_AFTER_PROGRESS" != "1" ]; then
    return 0
  fi
  if [ "$workspace_before" = "$workspace_after" ]; then
    printf '%s pr_create_skipped reason=no_runtime_workspace_change\n' "$(now_utc)" >> "$SUPERVISOR_LOG"
    return 0
  fi
  if ! tracked_workspace_diff_exists; then
    return 0
  fi
  (
    cd "$PHASE_LOOP_WORKSPACE_ROOT" || exit 70
    pnpm --workspace-root phase-loop:implementation-preflight >/dev/null
  ) || {
    printf '%s pr_create_skipped reason=implementation_preflight_failed\n' "$(now_utc)" >> "$SUPERVISOR_LOG"
    return 1
  }

  title="$(phase_loop_safe_pr_title)"
  body="Automated Brownie phase-loop output for active TODO claim.

- Claim: $(claim_field claim_id 2>/dev/null || true)
- Run: $run_stamp
- Brownie stdout: $stdout_log
- Brownie stderr: $stderr_log

This PR was created by the external phase-loop controller after Brownie produced tracked workspace changes."

  (
    cd "$PHASE_LOOP_WORKSPACE_ROOT" || exit 70
    stage_runtime_applied_paths "$stdout_log"
    if git diff --cached --quiet --exit-code; then
      exit 1
    fi
    GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME:-Brownie}" \
      GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-brownie-agent@users.noreply.github.com}" \
      GIT_COMMITTER_NAME="${GIT_COMMITTER_NAME:-Brownie}" \
      GIT_COMMITTER_EMAIL="${GIT_COMMITTER_EMAIL:-brownie-agent@users.noreply.github.com}" \
      git commit -m "$title" >/dev/null
  ) || {
    printf '%s pr_create_skipped reason=commit_failed\n' "$(now_utc)" >> "$SUPERVISOR_LOG"
    return 1
  }

  branch="$(
    cd "$PHASE_LOOP_WORKSPACE_ROOT" || exit 70
    git branch --show-current
  )"
  (
    cd "$PHASE_LOOP_WORKSPACE_ROOT" || exit 70
    set +x
    if command -v gh >/dev/null 2>&1; then
      BROWNIE_AGENT_TOKEN="$(gh auth token)"
      BROWNIE_AGENT_AUTH="$(printf 'x-access-token:%s' "$BROWNIE_AGENT_TOKEN" | base64 | tr -d '\n')"
      git -c credential.helper= -c "http.https://github.com/.extraheader=AUTHORIZATION: basic $BROWNIE_AGENT_AUTH" push -u "$PHASE_LOOP_PR_REMOTE" "$branch"
      push_rc=$?
      unset BROWNIE_AGENT_TOKEN BROWNIE_AGENT_AUTH
      exit "$push_rc"
    fi
    git push -u "$PHASE_LOOP_PR_REMOTE" "$branch"
  ) || {
    printf '%s pr_create_skipped reason=push_failed branch=%s\n' "$(now_utc)" "$branch" >> "$SUPERVISOR_LOG"
    return 1
  }

  if (
    cd "$PHASE_LOOP_WORKSPACE_ROOT" || exit 70
    gh pr view "$branch" --json url --jq .url >/dev/null 2>&1
  ); then
    pr_url="$(
      cd "$PHASE_LOOP_WORKSPACE_ROOT" || exit 70
      gh pr view "$branch" --json url --jq .url
    )"
  else
    if [ "$PHASE_LOOP_PR_DRAFT" = "1" ]; then
      pr_url="$(
        cd "$PHASE_LOOP_WORKSPACE_ROOT" || exit 70
        gh pr create --base "$PHASE_LOOP_PR_BASE" --head "$branch" --title "$title" --body "$body" --draft
      )"
    else
      pr_url="$(
        cd "$PHASE_LOOP_WORKSPACE_ROOT" || exit 70
        gh pr create --base "$PHASE_LOOP_PR_BASE" --head "$branch" --title "$title" --body "$body"
      )"
    fi
  fi
  printf '%s pr_created branch=%s url=%s\n' "$(now_utc)" "$branch" "$pr_url" >> "$SUPERVISOR_LOG"
  write_status "pr_created" "Brownie changes were committed, pushed, and opened as PR: $pr_url" "$run_stamp" "0" 0
  return 0
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
    CLAIM_CREATED_THIS_RUN=0
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
    CLAIM_CREATED_THIS_RUN=1
    printf '%s todo_claim=%s generation=%s status=in_progress\n' "$(now_utc)" "$claim_id" "$queue_generation" >> "$SUPERVISOR_LOG"
    return 0
  done
  return 1
}

build_effective_prompt() {
  local output_path="$1"
  local selected_todo meta_path
  if active_todo_claim_exists; then
    selected_todo="$(claim_field selected_todo)"
  else
    selected_todo="$(todo_first_pending_item)"
  fi
  meta_path="${output_path%.prompt.md}.prompt.meta.json"
  if ! python3 - "$output_path" "$meta_path" "$TODO_CLAIM_FILE" "$PHASE_LOOP_TODO" "$PHASE_LOOP_PROMPT" "$selected_todo" "$PHASE_LOOP_PROMPT_MAX_BYTES" "$PHASE_LOOP_SELECTED_TODO_MAX_BYTES" "$PHASE_LOOP_TODO_SNAPSHOT_LINES" "$PHASE_LOOP_BASE_PROMPT_SNAPSHOT_LINES" "$PHASE_LOOP_PROMPT_RETENTION_COUNT" "$(now_utc)" <<'PY'
import hashlib
import json
import os
import pathlib
import re
import sys

output_path = pathlib.Path(sys.argv[1])
meta_path = pathlib.Path(sys.argv[2])
claim_path = pathlib.Path(sys.argv[3])
todo_path = pathlib.Path(sys.argv[4])
prompt_path = pathlib.Path(sys.argv[5])
selected_todo = sys.argv[6]
prompt_max_bytes = int(sys.argv[7])
selected_todo_max_bytes = int(sys.argv[8])
todo_snapshot_lines = int(sys.argv[9])
base_prompt_snapshot_lines = int(sys.argv[10])
retention_count = int(sys.argv[11])
timestamp = sys.argv[12]

def read_text(path):
    with open(path, encoding="utf-8") as handle:
        return handle.read()

def sha256_text(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()

def snapshot(text, max_lines):
    lines = text.splitlines()
    truncated = len(lines) > max_lines
    return "\n".join(lines[:max_lines]), truncated, len(lines)

def count_sensitive(text):
    patterns = [
        r"(?i)api[_-]?key\\s*[:=]",
        r"(?i)secret\\s*[:=]",
        r"(?i)token\\s*[:=]",
        r"sk-[A-Za-z0-9_-]{16,}",
        r"-----BEGIN [A-Z ]*PRIVATE KEY-----",
    ]
    return sum(len(re.findall(pattern, text)) for pattern in patterns)

if len(selected_todo.encode("utf-8")) > selected_todo_max_bytes:
    raise SystemExit("selected_todo_exceeds_max_bytes")

claim = {}
if claim_path.exists():
    with open(claim_path, encoding="utf-8") as handle:
        claim = json.load(handle)

todo_text = read_text(todo_path)
base_prompt_text = read_text(prompt_path)
todo_snapshot, todo_truncated, todo_line_count = snapshot(todo_text, todo_snapshot_lines)
base_snapshot, base_truncated, base_line_count = snapshot(base_prompt_text, base_prompt_snapshot_lines)

if selected_todo and selected_todo not in todo_text and claim.get("status") not in ("in_progress", "blocked"):
    raise SystemExit("selected_todo_missing_from_queue_without_active_claim")

claim_lines = []
if claim:
    for key in ("claim_id", "status", "queue_generation", "queue_fingerprint", "run_stamp", "updated_at"):
        claim_lines.append(f"- {key}: `{claim.get(key, '')}`")
else:
    claim_lines.append("- none")

prompt = "\n".join([
    "# Brownie Phase Loop Effective Prompt",
    "",
    "This generated prompt combines the stable phase-loop contract with the current external TODO queue.",
    "Treat the active TODO claim below as the work item for this bounded invocation.",
    "",
    "## Active TODO Claim",
    "",
    *claim_lines,
    "",
    "## Selected TODO",
    "",
    selected_todo,
    "",
    "## TODO Queue Snapshot",
    "",
    todo_snapshot,
    "",
    "## Base Phase Loop Prompt",
    "",
    base_snapshot,
    "",
])
prompt_bytes = len(prompt.encode("utf-8"))
if prompt_bytes > prompt_max_bytes:
    raise SystemExit(f"effective_prompt_exceeds_max_bytes:{prompt_bytes}>{prompt_max_bytes}")

with open(output_path, "w", encoding="utf-8") as handle:
    handle.write(prompt)
    handle.flush()
    os.fsync(handle.fileno())
os.chmod(output_path, 0o600)

metadata = {
    "schema_version": 1,
    "created_at": timestamp,
    "prompt_path": str(output_path),
    "prompt_bytes": prompt_bytes,
    "prompt_sha256": sha256_text(prompt),
    "prompt_max_bytes": prompt_max_bytes,
    "selected_todo_bytes": len(selected_todo.encode("utf-8")),
    "selected_todo_sha256": sha256_text(selected_todo),
    "selected_todo_complete": True,
    "todo_path": str(todo_path),
    "todo_sha256": sha256_text(todo_text),
    "todo_line_count": todo_line_count,
    "todo_snapshot_lines": min(todo_line_count, todo_snapshot_lines),
    "todo_snapshot_truncated": todo_truncated,
    "base_prompt_path": str(prompt_path),
    "base_prompt_sha256": sha256_text(base_prompt_text),
    "base_prompt_line_count": base_line_count,
    "base_prompt_snapshot_lines": min(base_line_count, base_prompt_snapshot_lines),
    "base_prompt_snapshot_truncated": base_truncated,
    "sensitive_pattern_count": count_sensitive(prompt),
    "retention_count": retention_count,
}
with open(meta_path, "w", encoding="utf-8") as handle:
    json.dump(metadata, handle, ensure_ascii=False, sort_keys=True, indent=2)
    handle.write("\n")
    handle.flush()
    os.fsync(handle.fileno())
os.chmod(meta_path, 0o600)
PY
  then
    return 1
  fi
  chmod 600 "$output_path" "$meta_path"
  sync_parent_dir "$RUN_DIR"
  retire_old_prompt_artifacts
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

process_command() {
  local pid="$1"
  ps -p "$pid" -o command= 2>/dev/null || true
}

process_pgid() {
  local pid="$1"
  ps -p "$pid" -o pgid= 2>/dev/null | awk '{ print $1 }'
}

process_stat() {
  local pid="$1"
  ps -p "$pid" -o stat= 2>/dev/null | awk '{ print $1 }'
}

current_pgid() {
  ps -p "$$" -o pgid= 2>/dev/null | awk '{ print $1 }'
}

is_supervisor_pid() {
  local pid="$1" command
  command="$(process_command "$pid")"
  case "$command" in
    *phase-loop.sh*supervise*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

supervisor_descendant_pids() {
  local root_pid="$1"
  python3 - "$root_pid" <<'PY'
import subprocess
import sys

root = sys.argv[1]
try:
    output = subprocess.check_output(
        ["ps", "-axo", "pid=", "-o", "ppid="],
        text=True,
        stderr=subprocess.DEVNULL,
    )
except Exception:
    sys.exit(0)

children = {}
for line in output.splitlines():
    parts = line.split()
    if len(parts) != 2:
        continue
    pid, ppid = parts
    children.setdefault(ppid, []).append(pid)

stack = list(children.get(root, []))
seen = []
while stack:
    pid = stack.pop()
    if pid in seen:
        continue
    seen.append(pid)
    stack.extend(children.get(pid, []))

for pid in seen:
    print(pid)
PY
}

wait_for_pid_exit() {
  local pid="$1"
  local timeout_seconds="$2"
  local waited=0
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$waited" -ge "$timeout_seconds" ]; then
      return 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
  return 0
}

pid_is_active() {
  local pid="$1" stat
  if ! kill -0 "$pid" 2>/dev/null; then
    return 1
  fi
  stat="$(process_stat "$pid")"
  case "$stat" in
    Z*)
      return 1
      ;;
  esac
  return 0
}

active_known_pids() {
  local pid
  for pid in "$@"; do
    case "$pid" in
      ''|*[!0-9]*)
        continue
        ;;
    esac
    if [ "$pid" -gt 1 ] && pid_is_active "$pid"; then
      printf '%s\n' "$pid"
    fi
  done
}

wait_for_known_pids_exit() {
  local timeout_seconds="$1"
  shift
  local waited=0
  while [ -n "$(active_known_pids "$@" | tr '\n' ' ')" ]; do
    if [ "$waited" -ge "$timeout_seconds" ]; then
      return 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
  return 0
}

kill_known_pids() {
  local signal="$1"
  shift
  local pid
  for pid in "$@"; do
    case "$pid" in
      ''|*[!0-9]*)
        continue
        ;;
    esac
    if [ "$pid" -gt 1 ]; then
      kill "-$signal" "$pid" 2>/dev/null || true
    fi
  done
}

terminate_supervisor_tree() {
  local pid="$1"
  local pgid own_pgid descendants known_pids
  if ! kill -0 "$pid" 2>/dev/null; then
    return 0
  fi
  if ! is_supervisor_pid "$pid"; then
    printf '%s refusing to terminate non-supervisor pid=%s command=%s\n' "$(now_utc)" "$pid" "$(process_command "$pid")" >> "$SUPERVISOR_LOG"
    return 1
  fi

  pgid="$(process_pgid "$pid")"
  own_pgid="$(current_pgid)"
  descendants="$(supervisor_descendant_pids "$pid" | tr '\n' ' ')"
  known_pids="$pid $descendants"
  printf '%s stop terminating supervisor pid=%s pgid=%s descendants=%s\n' "$(now_utc)" "$pid" "${pgid:-unknown}" "${descendants:-none}" >> "$SUPERVISOR_LOG"

  if [ -n "${pgid:-}" ] && [ "$pgid" -gt 1 ] && [ "${pgid:-}" != "${own_pgid:-}" ]; then
    kill -TERM -- "-$pgid" 2>/dev/null || true
  else
    # When tests or a direct shell launch share the caller's process group, a
    # negative-PGID signal would hit the caller too. Fall back to the bounded
    # supervisor descendant set captured before termination.
    # shellcheck disable=SC2086
    kill_known_pids TERM $known_pids
  fi

  # Wait for the whole known managed set, not only the supervisor. A Runtime
  # child can outlive its parent briefly after TERM; treating supervisor exit
  # alone as success would leave orphan work behind.
  # shellcheck disable=SC2086
  if wait_for_known_pids_exit "$PHASE_LOOP_STOP_GRACE_SECONDS" $known_pids; then
    rm -f "$PID_FILE"
    return 0
  fi

  descendants="$(supervisor_descendant_pids "$pid" | tr '\n' ' ')"
  known_pids="$pid $known_pids $descendants"
  printf '%s stop force terminating supervisor pid=%s pgid=%s descendants=%s\n' "$(now_utc)" "$pid" "${pgid:-unknown}" "${descendants:-none}" >> "$SUPERVISOR_LOG"
  if [ -n "${pgid:-}" ] && [ "$pgid" -gt 1 ] && [ "${pgid:-}" != "${own_pgid:-}" ]; then
    kill -KILL -- "-$pgid" 2>/dev/null || true
  fi
  # shellcheck disable=SC2086
  kill_known_pids KILL $known_pids
  # shellcheck disable=SC2086
  wait_for_known_pids_exit "$PHASE_LOOP_STOP_FORCE_SECONDS" $known_pids || true
  if ! pid_is_active "$pid"; then
    rm -f "$PID_FILE"
  fi
}

interruptible_sleep() {
  local total_seconds="$1"
  local slept=0
  local poll="$PHASE_LOOP_SLEEP_POLL_SECONDS"
  case "$poll" in
    ''|*[!0-9]*)
      poll=1
      ;;
  esac
  if [ "$poll" -lt 1 ]; then
    poll=1
  fi
  while [ "$slept" -lt "$total_seconds" ]; do
    if [ -f "$STOP_FILE" ]; then
      return 1
    fi
    local remaining chunk
    remaining=$((total_seconds - slept))
    chunk="$poll"
    if [ "$chunk" -gt "$remaining" ]; then
      chunk="$remaining"
    fi
    sleep "$chunk"
    slept=$((slept + chunk))
  done
  if [ -f "$STOP_FILE" ]; then
    return 1
  fi
  return 0
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
  local workspace_before workspace_after head_commit validation progress_summary progress_classification
  local use_resume=0
  local CLAIM_CREATED_THIS_RUN=0
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
  workspace_before="$(git_workspace_fingerprint)"
  head_commit="$(
    cd "$PHASE_LOOP_WORKSPACE_ROOT" && git rev-parse HEAD 2>/dev/null || true
  )"
  if phase_loop_should_resume_active_claim; then
    use_resume=1
  fi
  if ! claim_first_pending_todo "$run_stamp"; then
    detail="Failed to claim first pending TODO from queue: $PHASE_LOOP_TODO"
    printf '%s %s\n' "$(now_utc)" "$detail" >> "$SUPERVISOR_LOG"
    write_status "blocked" "$detail" "$run_stamp" "75" "${CONSECUTIVE_FAILURES:-0}"
    return 75
  fi
  if [ "$use_resume" -ne 1 ]; then
    if ! build_effective_prompt "$effective_prompt"; then
      detail="Failed to build effective phase-loop prompt: $effective_prompt"
      printf '%s %s\n' "$(now_utc)" "$detail" >> "$SUPERVISOR_LOG"
      if active_todo_claim_exists; then
        write_todo_claim "$(claim_field claim_id)" "blocked" "$(claim_field selected_todo)" "$(claim_field queue_fingerprint)" "$(active_claim_queue_generation)" "$run_stamp"
      fi
      write_status "blocked" "$detail" "$run_stamp" "74" "${CONSECUTIVE_FAILURES:-0}"
      return 74
    fi
  fi
  if [ "$CLAIM_CREATED_THIS_RUN" -eq 1 ] && [ "${PHASE_LOOP_TEST_MUTATE_TODO_AFTER_PROMPT:-}" = "1" ]; then
    printf '\n- [ ] PHASE_LOOP_TEST_MUTATED_TODO_AFTER_PROMPT\n' >> "$PHASE_LOOP_TODO"
  fi
  if [ "$CLAIM_CREATED_THIS_RUN" -eq 1 ] && ! verify_todo_fresh_for_runtime_start; then
    archive_stale_todo_claim "$run_stamp"
    if ! claim_first_pending_todo "$run_stamp"; then
      detail="Failed to refresh stale TODO claim before Runtime start: $PHASE_LOOP_TODO"
      printf '%s %s\n' "$(now_utc)" "$detail" >> "$SUPERVISOR_LOG"
      write_status "blocked" "$detail" "$run_stamp" "75" "${CONSECUTIVE_FAILURES:-0}"
      return 75
    fi
    if ! build_effective_prompt "$effective_prompt"; then
      detail="Failed to rebuild effective prompt after stale TODO claim refresh: $effective_prompt"
      printf '%s %s\n' "$(now_utc)" "$detail" >> "$SUPERVISOR_LOG"
      if active_todo_claim_exists; then
        write_todo_claim "$(claim_field claim_id)" "blocked" "$(claim_field selected_todo)" "$(claim_field queue_fingerprint)" "$(active_claim_queue_generation)" "$run_stamp"
      fi
      write_status "blocked" "$detail" "$run_stamp" "74" "${CONSECUTIVE_FAILURES:-0}"
      return 74
    fi
    if [ "$CLAIM_CREATED_THIS_RUN" -eq 1 ] && ! verify_todo_fresh_for_runtime_start; then
      detail="TODO queue changed again before Runtime start; refusing stale invocation."
      printf '%s %s\n' "$(now_utc)" "$detail" >> "$SUPERVISOR_LOG"
      if active_todo_claim_exists; then
        write_todo_claim "$(claim_field claim_id)" "blocked" "$(claim_field selected_todo)" "$(claim_field queue_fingerprint)" "$(active_claim_queue_generation)" "$run_stamp"
      fi
      write_status "blocked" "$detail" "$run_stamp" "75" "${CONSECUTIVE_FAILURES:-0}"
      return 75
    fi
  fi
  (
    cd "$PHASE_LOOP_WORKSPACE_ROOT" || exit 70
    export BROWNIE_WORKSPACE_ROOT="${BROWNIE_WORKSPACE_ROOT:-"$PHASE_LOOP_WORKSPACE_ROOT"}"
    export BROWNIE_STORE_ROOT="${BROWNIE_STORE_ROOT:-"$PHASE_LOOP_BROWNIE_STORE_ROOT"}"
    export PHASE_LOOP_CONTROL_ROOT
    if command -v timeout >/dev/null 2>&1; then
      if [ "$use_resume" -eq 1 ]; then
        timeout "$PHASE_LOOP_BROWNIE_TIMEOUT_SECONDS" "$BROWNIE_BIN" --json resume
      else
        timeout "$PHASE_LOOP_BROWNIE_TIMEOUT_SECONDS" "$BROWNIE_BIN" --json run --file "$effective_prompt"
      fi
    else
      if [ "$use_resume" -eq 1 ]; then
        "$BROWNIE_BIN" --json resume
      else
        "$BROWNIE_BIN" --json run --file "$effective_prompt"
      fi
    fi
  ) > "$stdout_log" 2> "$stderr_log"
  exit_code=$?
  workspace_after="$(git_workspace_fingerprint)"

  run_id="$(
    python3 - "$stdout_log" <<'PY'
import json
import sys
try:
    root = json.load(open(sys.argv[1], encoding="utf-8"))
    if isinstance(root, dict) and isinstance(root.get("run"), dict):
        payload = root.get("run")
    elif isinstance(root, dict) and isinstance(root.get("resume"), dict):
        payload = root.get("resume")
    else:
        payload = root
    print(payload.get("run_id") or payload.get("automation", {}).get("run_id") or "")
except Exception:
    print("")
PY
  )"
  if [ -z "$run_id" ]; then
    run_id="$run_stamp"
  fi

  if [ "$exit_code" -eq 0 ]; then
    validation="$(validate_cli_json_output "$stdout_log" || true)"
    if [ "$validation" != "ok" ]; then
      if active_todo_claim_exists; then
        write_todo_claim "$(claim_field claim_id)" "blocked" "$(claim_field selected_todo)" "$(claim_field queue_fingerprint)" "$(active_claim_queue_generation)" "$run_stamp"
      fi
      detail="Brownie JSON output failed schema validation ($validation); stdout=$stdout_log stderr=$stderr_log"
      write_status "blocked" "$detail" "$run_id" "74" "${CONSECUTIVE_FAILURES:-1}"
      printf '%s run=%s exit=%s invalid_json=%s stdout=%s stderr=%s\n' "$(now_utc)" "$run_id" "$exit_code" "$validation" "$stdout_log" "$stderr_log" >> "$SUPERVISOR_LOG"
      return 74
    fi

    progress_summary="$(write_progress_state "$stdout_log" "$run_stamp" "$exit_code" "$workspace_before" "$workspace_after" "$head_commit")"
    progress_classification="$(
      printf '%s' "$progress_summary" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("classification", ""))'
    )"

    if python3 - "$stdout_log" "$PROGRESS_STATE_FILE" <<'PY'
import json, sys
root = json.load(open(sys.argv[1], encoding="utf-8"))
if isinstance(root, dict) and isinstance(root.get("run"), dict):
    payload = root.get("run")
elif isinstance(root, dict) and isinstance(root.get("resume"), dict):
    payload = root.get("resume")
else:
    payload = root
completed_by_no_actionable_after_apply = False
try:
    state = json.load(open(sys.argv[2], encoding="utf-8"))
    projection = state.get("progress_projection", {})
    completed_by_no_actionable_after_apply = projection.get("completed_by_no_actionable_after_apply") is True
except Exception:
    pass
sys.exit(0 if payload.get("completed") is True or completed_by_no_actionable_after_apply else 1)
PY
    then
      write_todo_claim "$(claim_field claim_id)" "completed" "$(claim_field selected_todo)" "$(claim_field queue_fingerprint)" "$(active_claim_queue_generation)" "$run_stamp"
    elif python3 - "$stdout_log" <<'PY'
import json, sys
root = json.load(open(sys.argv[1], encoding="utf-8"))
if isinstance(root, dict) and isinstance(root.get("run"), dict):
    payload = root.get("run")
elif isinstance(root, dict) and isinstance(root.get("resume"), dict):
    payload = root.get("resume")
else:
    payload = root
sys.exit(0 if payload.get("blocked") is True else 1)
PY
    then
      write_todo_claim "$(claim_field claim_id)" "blocked" "$(claim_field selected_todo)" "$(claim_field queue_fingerprint)" "$(active_claim_queue_generation)" "$run_stamp"
      : > "$STOP_FILE"
      chmod 600 "$STOP_FILE"
      sync_parent_dir "$STATE_DIR"
      detail="Brownie run reached a blocked external-control boundary; stopping phase-loop to avoid repeating the same invocation. stdout=$stdout_log stderr=$stderr_log progress=$PROGRESS_STATE_FILE"
      write_status "blocked" "$detail" "$run_id" "77" "${CONSECUTIVE_FAILURES:-0}"
      printf '%s run=%s exit=%s blocked_boundary=true progress=%s stdout=%s stderr=%s\n' "$(now_utc)" "$run_id" "$exit_code" "$progress_summary" "$stdout_log" "$stderr_log" >> "$SUPERVISOR_LOG"
      return 77
    fi

    case "$progress_classification" in
      no_progress)
        detail="Brownie run exited successfully but repeated the same non-progress fingerprint; stdout=$stdout_log stderr=$stderr_log progress=$PROGRESS_STATE_FILE"
        write_status "no_progress" "$detail" "$run_id" "76" "${CONSECUTIVE_FAILURES:-1}"
        printf '%s run=%s exit=%s progress=%s stdout=%s stderr=%s\n' "$(now_utc)" "$run_id" "$exit_code" "$progress_summary" "$stdout_log" "$stderr_log" >> "$SUPERVISOR_LOG"
        return 76
        ;;
      non_progress_success)
        detail="Brownie run exited successfully without workspace change, accepted completion, finalization, or blocker classification; stdout=$stdout_log stderr=$stderr_log progress=$PROGRESS_STATE_FILE"
        write_status "non_progress_success" "$detail" "$run_id" "$exit_code" "${CONSECUTIVE_FAILURES:-0}"
        ;;
      *)
        if phase_loop_create_pr_for_progress "$run_stamp" "$stdout_log" "$stderr_log" "$workspace_before" "$workspace_after"; then
          :
        else
          detail="Brownie run made progress but PR creation failed; stdout=$stdout_log stderr=$stderr_log progress=$PROGRESS_STATE_FILE"
          write_status "blocked" "$detail" "$run_id" "78" "${CONSECUTIVE_FAILURES:-1}"
          return 78
        fi
        detail="Brownie run made progress; stdout=$stdout_log stderr=$stderr_log progress=$PROGRESS_STATE_FILE"
        if [ "$(status_field status 2>/dev/null || true)" != "pr_created" ]; then
          write_status "last_run_succeeded" "$detail" "$run_id" "$exit_code" 0
        fi
        ;;
    esac
  else
    if active_todo_claim_exists; then
      write_todo_claim "$(claim_field claim_id)" "blocked" "$(claim_field selected_todo)" "$(claim_field queue_fingerprint)" "$(active_claim_queue_generation)" "$run_stamp"
    fi
    write_progress_state "$stdout_log" "$run_stamp" "$exit_code" "$workspace_before" "$workspace_after" "$head_commit" >/dev/null || true
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
      interruptible_sleep "$PHASE_LOOP_INTERVAL_SECONDS" || true
    else
      CONSECUTIVE_FAILURES=$((CONSECUTIVE_FAILURES + 1))
      backoff=$((PHASE_LOOP_FAILURE_BACKOFF_SECONDS * CONSECUTIVE_FAILURES))
      if [ "$backoff" -gt "$PHASE_LOOP_MAX_FAILURE_BACKOFF_SECONDS" ]; then
        backoff="$PHASE_LOOP_MAX_FAILURE_BACKOFF_SECONDS"
      fi
      printf '%s failure_count=%s backoff=%s\n' "$(now_utc)" "$CONSECUTIVE_FAILURES" "$backoff" >> "$SUPERVISOR_LOG"
      interruptible_sleep "$backoff" || true
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
    local pid
    pid="$(cat "$PID_FILE")"
    terminate_supervisor_tree "$pid" || true
    if kill -0 "$pid" 2>/dev/null; then
      echo "phase-loop stop requested: pid $pid still running"
    else
      write_status "stopped" "Stop requested; supervisor and managed children terminated." "" "" 0
      echo "phase-loop stopped: pid $pid"
    fi
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
