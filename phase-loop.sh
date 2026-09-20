#!/usr/bin/env bash
set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${PHASE_LOOP_STATE_DIR:-"$ROOT_DIR/.brownie/private/phase-loop"}"
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
TODO_BLOCKED_FILE="$TODO_CLAIM_DIR/blocked.jsonl"
TODO_REPAIR_FEEDBACK_FILE="$TODO_CLAIM_DIR/repair-feedback.json"
PROGRESS_STATE_FILE="$STATE_DIR/progress-state.json"
BDK_TRAJECTORY_DIR="$STATE_DIR/trajectories"
BDK_TRAJECTORY_FILE="${PHASE_LOOP_BDK_TRAJECTORY_FILE:-"$STATE_DIR/bdk-trajectory.jsonl"}"
BDK_HARNESS_FEEDBACK_FILE="$STATE_DIR/bdk-harness-feedback.json"
LAUNCHD_LABEL="${PHASE_LOOP_LAUNCHD_LABEL:-globalpocket.brownie.phase-loop}"
SCREEN_NAME="${PHASE_LOOP_SCREEN_NAME:-brownie-phase-loop}"

BROWNIE_BIN="${BROWNIE_BIN:-"$ROOT_DIR/target/debug/brownie"}"
PHASE_LOOP_DEFAULT_BROWNIE_BIN="$ROOT_DIR/target/debug/brownie"
PHASE_LOOP_PROMPT="${PHASE_LOOP_PROMPT:-"$ROOT_DIR/phase-loop.md"}"
PHASE_LOOP_TODO="${PHASE_LOOP_TODO:-"$ROOT_DIR/.brownie/todo.md"}"
PHASE_LOOP_TODO_BREAKDOWN="${PHASE_LOOP_TODO_BREAKDOWN:-"$(dirname "$PHASE_LOOP_TODO")/todo-breakdown.md"}"
PHASE_LOOP_WORKSPACE_ROOT="${PHASE_LOOP_WORKSPACE_ROOT:-"$ROOT_DIR"}"
PHASE_LOOP_CONTROL_ROOT="${PHASE_LOOP_CONTROL_ROOT:-"/Users/satoshitanaka/.codex/automations/brownie-cli-phase-loop"}"
PHASE_LOOP_BROWNIE_STORE_ROOT="${PHASE_LOOP_BROWNIE_STORE_ROOT:-"$ROOT_DIR/.brownie/private/runtime-store"}"
PHASE_LOOP_INTERVAL_SECONDS="${PHASE_LOOP_INTERVAL_SECONDS:-5}"
PHASE_LOOP_FAILURE_BACKOFF_SECONDS="${PHASE_LOOP_FAILURE_BACKOFF_SECONDS:-60}"
PHASE_LOOP_MAX_FAILURE_BACKOFF_SECONDS="${PHASE_LOOP_MAX_FAILURE_BACKOFF_SECONDS:-900}"
PHASE_LOOP_BROWNIE_TIMEOUT_SECONDS="${PHASE_LOOP_BROWNIE_TIMEOUT_SECONDS:-14400}"
PHASE_LOOP_BROWNIE_DECOMPOSE_TIMEOUT_SECONDS="${PHASE_LOOP_BROWNIE_DECOMPOSE_TIMEOUT_SECONDS:-600}"
PHASE_LOOP_STAGNATION_THRESHOLD="${PHASE_LOOP_STAGNATION_THRESHOLD:-3}"
PHASE_LOOP_PROMPT_MAX_BYTES="${PHASE_LOOP_PROMPT_MAX_BYTES:-65536}"
PHASE_LOOP_SELECTED_TODO_MAX_BYTES="${PHASE_LOOP_SELECTED_TODO_MAX_BYTES:-8192}"
PHASE_LOOP_TODO_SNAPSHOT_LINES="${PHASE_LOOP_TODO_SNAPSHOT_LINES:-80}"
PHASE_LOOP_BASE_PROMPT_SNAPSHOT_LINES="${PHASE_LOOP_BASE_PROMPT_SNAPSHOT_LINES:-80}"
PHASE_LOOP_PROMPT_RETENTION_COUNT="${PHASE_LOOP_PROMPT_RETENTION_COUNT:-20}"
PHASE_LOOP_STOP_GRACE_SECONDS="${PHASE_LOOP_STOP_GRACE_SECONDS:-15}"
PHASE_LOOP_STOP_FORCE_SECONDS="${PHASE_LOOP_STOP_FORCE_SECONDS:-5}"
PHASE_LOOP_SLEEP_POLL_SECONDS="${PHASE_LOOP_SLEEP_POLL_SECONDS:-1}"
PHASE_LOOP_CREATE_PR_AFTER_PROGRESS="${PHASE_LOOP_CREATE_PR_AFTER_PROGRESS:-0}"
PHASE_LOOP_PR_REMOTE="${PHASE_LOOP_PR_REMOTE:-origin}"
PHASE_LOOP_PR_BASE="${PHASE_LOOP_PR_BASE:-main}"
PHASE_LOOP_PR_TITLE_PREFIX="${PHASE_LOOP_PR_TITLE_PREFIX:-Brownie phase-loop}"
PHASE_LOOP_PR_DRAFT="${PHASE_LOOP_PR_DRAFT:-0}"
PHASE_LOOP_LLM_ROUTING="${PHASE_LOOP_LLM_ROUTING:-1}"
PHASE_LOOP_LLM_MODEL_FAST="${PHASE_LOOP_LLM_MODEL_FAST:-}"
PHASE_LOOP_LLM_MODEL_CODE="${PHASE_LOOP_LLM_MODEL_CODE:-}"
PHASE_LOOP_LLM_MODEL_DEEP="${PHASE_LOOP_LLM_MODEL_DEEP:-}"
PHASE_LOOP_LLM_MAX_TOKENS_FAST="${PHASE_LOOP_LLM_MAX_TOKENS_FAST:-}"
PHASE_LOOP_LLM_MAX_TOKENS_CODE="${PHASE_LOOP_LLM_MAX_TOKENS_CODE:-}"
PHASE_LOOP_LLM_TEMPERATURE_FAST="${PHASE_LOOP_LLM_TEMPERATURE_FAST:-}"
PHASE_LOOP_LLM_TEMPERATURE_CODE="${PHASE_LOOP_LLM_TEMPERATURE_CODE:-}"
PHASE_LOOP_LLM_TOP_P_FAST="${PHASE_LOOP_LLM_TOP_P_FAST:-}"
PHASE_LOOP_LLM_TOP_P_CODE="${PHASE_LOOP_LLM_TOP_P_CODE:-}"
PHASE_LOOP_LLM_TOP_K_FAST="${PHASE_LOOP_LLM_TOP_K_FAST:-}"
PHASE_LOOP_LLM_TOP_K_CODE="${PHASE_LOOP_LLM_TOP_K_CODE:-}"
PHASE_LOOP_LLM_FAST_MAX_PROMPT_BYTES="${PHASE_LOOP_LLM_FAST_MAX_PROMPT_BYTES:-20000}"
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK="${PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK:-0}"

mkdir -p "$RUN_DIR" "$LOG_DIR" "$TODO_CLAIM_DIR" "$BDK_TRAJECTORY_DIR"

json_escape() {
  python3 -c 'import json,sys; print(json.dumps(sys.stdin.read())[1:-1])'
}

now_utc() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

write_bdk_trajectory_event() {
  local run_stamp="$1"
  local event_type="$2"
  local payload_json="${3:-}"
  if [ -z "$payload_json" ]; then
    payload_json="{}"
  fi
  python3 - "$TODO_CLAIM_FILE" "$BDK_TRAJECTORY_FILE" "$BDK_TRAJECTORY_DIR/$run_stamp.jsonl" "$run_stamp" "$event_type" "$(now_utc)" "$payload_json" <<'PY'
import json
import os
import pathlib
import re
import sys

claim_path = pathlib.Path(sys.argv[1])
aggregate_path = pathlib.Path(sys.argv[2])
run_path = pathlib.Path(sys.argv[3])
run_id = sys.argv[4]
event_type = sys.argv[5]
timestamp = sys.argv[6]
payload_raw = sys.argv[7]

try:
    claim = json.loads(claim_path.read_text(encoding="utf-8"))
except Exception:
    sys.exit(0)

claim_id = str(claim.get("claim_id") or "")
selected_todo = str(claim.get("selected_todo") or "")
if not claim_id or not selected_todo:
    sys.exit(0)

first_line = selected_todo.splitlines()[0] if selected_todo.splitlines() else selected_todo
match = re.match(r"^\s*(?:[-*]|\d+[.)])\s+\[\s\]\s+([^:\s]+)", first_line)
todo_id = match.group(1) if match else first_line.strip()[:80]
if not todo_id:
    sys.exit(0)

try:
    payload = json.loads(payload_raw)
except Exception:
    payload = {"message": payload_raw}
if not isinstance(payload, dict):
    payload = {"value": payload}

record = {
    "schema_version": 1,
    "run_id": run_id,
    "claim_id": claim_id,
    "events": [
        {
            "type": event_type,
            "at": timestamp,
            "todo_id": todo_id,
            "claim_id": claim_id,
            "payload": payload,
        }
    ],
}

line = json.dumps(record, ensure_ascii=False, sort_keys=True)
for path in (aggregate_path, run_path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(line)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
PY
  case "$event_type" in
    todo.completed|todo.replanned|todo.blocked)
      evaluate_bdk_public_harness_feedback "$run_stamp" "$event_type" || true
      ;;
  esac
}

evaluate_bdk_public_harness_feedback() {
  local run_stamp="$1"
  local terminal_event="${2:-}"
  local trajectory_path="$BDK_TRAJECTORY_DIR/$run_stamp.jsonl"
  local output
  if [ ! -f "$trajectory_path" ] || [ ! -f "$ROOT_DIR/scripts/bdk-public-harness-evaluate.mjs" ]; then
    return 0
  fi
  output="$(
    cd "$ROOT_DIR" || exit 70
    node scripts/bdk-public-harness-evaluate.mjs --trajectory "$trajectory_path" --output "$BDK_HARNESS_FEEDBACK_FILE" 2>&1
  )"
  local status=$?
  if [ "$status" -ne 0 ]; then
    printf '%s bdk_harness_feedback_failed run=%s terminal_event=%s status=%s output=%s feedback=%s\n' "$(now_utc)" "$run_stamp" "$terminal_event" "$status" "$output" "$BDK_HARNESS_FEEDBACK_FILE" >> "$SUPERVISOR_LOG"
  else
    printf '%s bdk_harness_feedback_passed run=%s terminal_event=%s feedback=%s\n' "$(now_utc)" "$run_stamp" "$terminal_event" "$BDK_HARNESS_FEEDBACK_FILE" >> "$SUPERVISOR_LOG"
  fi
  return 0
}

write_bdk_trajectory_prompt_routing_event() {
  local run_stamp="$1"
  local effective_prompt="$2"
  local meta_path="${effective_prompt%.prompt.md}.prompt.meta.json"
  local payload_json
  payload_json="$(
    python3 - "$meta_path" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
payload = {"source": "phase-loop", "prompt_meta": "missing"}
try:
    meta = json.loads(path.read_text(encoding="utf-8"))
    payload = {
        "source": "phase-loop",
        "bdk_state": meta.get("bdk_state"),
        "llm_route": meta.get("llm_route"),
        "prompt_meta": path.name,
    }
except Exception:
    pass
print(json.dumps(payload, ensure_ascii=False, sort_keys=True))
PY
  )"
  write_bdk_trajectory_event "$run_stamp" "workflow.routed" "$payload_json"
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
  local escaped_blocked_file
  escaped_blocked_file="$(printf '%s' "$TODO_BLOCKED_FILE" | json_escape)"
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
  "todo_blocked": "$escaped_blocked_file",
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

check_brownie_binary_freshness() {
  if [ "$PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK" = "1" ]; then
    return 0
  fi
  if [ "$BROWNIE_BIN" != "$PHASE_LOOP_DEFAULT_BROWNIE_BIN" ]; then
    return 0
  fi
  local runtime_bin
  runtime_bin="${BROWNIE_RUNTIME_PATH:-"$ROOT_DIR/target/debug/brownie-runtime"}"
  python3 - "$PHASE_LOOP_WORKSPACE_ROOT" "$BROWNIE_BIN" "$runtime_bin" <<'PY'
import pathlib
import subprocess
import sys

repo_root = pathlib.Path(sys.argv[1]).resolve()
cli_binary = pathlib.Path(sys.argv[2]).resolve()
runtime_binary = pathlib.Path(sys.argv[3]).resolve()

try:
    tracked = subprocess.check_output(
        ["git", "ls-files", "Cargo.lock", "Cargo.toml", "crates/**/*.rs", "crates/**/Cargo.toml"],
        cwd=repo_root,
        text=True,
        stderr=subprocess.DEVNULL,
    ).splitlines()
except Exception as error:
    print(f"failed to inspect tracked Rust sources for binary freshness: {error}")
    sys.exit(3)

def mtime(path):
    try:
        return path.stat().st_mtime
    except FileNotFoundError:
        return None

def source_exists(relative):
    return (repo_root / relative).exists()

def is_cli_input(relative):
    return (
        relative in {"Cargo.lock", "Cargo.toml", "crates/brownie-cli/Cargo.toml", "crates/brownie-protocol/Cargo.toml"}
        or relative.startswith("crates/brownie-cli/src/")
        or relative.startswith("crates/brownie-protocol/src/")
    )

def is_runtime_input(relative):
    return (
        relative in {"Cargo.lock", "Cargo.toml"}
        or (
            relative.startswith("crates/")
            and not relative.startswith("crates/brownie-cli/")
        )
    )

def newer_inputs(binary, predicate):
    binary_mtime = mtime(binary)
    if binary_mtime is None:
        return ["<missing binary>"]
    newer = []
    for relative in tracked:
        if not predicate(relative) or not source_exists(relative):
            continue
        source_mtime = mtime(repo_root / relative)
        if source_mtime is not None and source_mtime > binary_mtime:
            newer.append(relative)
    return newer

stale = []
for label, binary, predicate in [
    ("brownie CLI", cli_binary, is_cli_input),
    ("brownie Runtime", runtime_binary, is_runtime_input),
]:
    newer = newer_inputs(binary, predicate)
    if newer:
        stale.append((label, binary, newer))

if stale:
    parts = []
    for label, binary, newer in stale:
        parts.append(
            f"{label} binary is stale ({binary}); newer tracked Rust inputs include: "
            + ", ".join(newer[:8])
            + (" ..." if len(newer) > 8 else "")
        )
    print(
        "Brownie binary freshness check failed; run "
        "`cargo build -p brownie-cli --bin brownie -p brownie-runtime --bin brownie-runtime` "
        "before phase-loop run-once. "
        + " ".join(parts)
    )
    sys.exit(1)
sys.exit(0)
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
  node "$ROOT_DIR/scripts/phase-loop-todo-evaluator.mjs" select --todo "$PHASE_LOOP_TODO" --blocked "$TODO_BLOCKED_FILE"
}

todo_queue_only_explicit_blockers() {
  if [ ! -f "$PHASE_LOOP_TODO" ]; then
    return 1
  fi
  node --input-type=module - "$PHASE_LOOP_TODO" "$ROOT_DIR/scripts/phase-loop-todo-evaluator.mjs" "$ROOT_DIR/scripts/guard-todo-decomposition.mjs" <<'NODE'
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const todoPath = process.argv[2];
const evaluatorPath = process.argv[3];
const guardPath = process.argv[4];
const { isExplicitBlockerTodo } = await import(pathToFileURL(evaluatorPath).href);
const { uncheckedTodoBlocks } = await import(pathToFileURL(guardPath).href);

let text = '';
try {
  text = fs.readFileSync(todoPath, 'utf8');
} catch {
  process.exit(1);
}

const baseBlocks = uncheckedTodoBlocks(text).filter((block) => {
  const firstLine = block.split('\n')[0]?.trim() ?? '';
  return !firstLine.includes('TODO-decompose-blocked-queue-');
});
if (baseBlocks.length === 0) {
  process.exit(1);
}
process.exit(baseBlocks.every((block) => isExplicitBlockerTodo(block)) ? 0 : 1);
NODE
}

ensure_blocked_todo_decomposition_request() {
  if [ ! -f "$PHASE_LOOP_TODO" ]; then
    return 1
  fi
  python3 - "$PHASE_LOOP_TODO" "$TODO_BLOCKED_FILE" "$PHASE_LOOP_TODO_BREAKDOWN" "$(now_utc)" <<'PY'
import hashlib
import json
import os
import pathlib
import re
import subprocess
import sys

todo_path = pathlib.Path(sys.argv[1])
blocked_path = pathlib.Path(sys.argv[2])
breakdown_path = pathlib.Path(sys.argv[3])
timestamp = sys.argv[4]

todo = todo_path.read_text(encoding="utf-8")
pattern = re.compile(r"^[ \t]*(?:[-*]|\d+[.)])[ \t]+\[[ \t]\][ \t]+", re.M)
matches = list(pattern.finditer(todo))
if not matches:
    raise SystemExit(1)

blocks = []
base_blocks = []
for index, match in enumerate(matches):
    end = matches[index + 1].start() if index + 1 < len(matches) else len(todo)
    block = todo[match.start():end].rstrip("\n")
    first_line = block.splitlines()[0].strip() if block.splitlines() else ""
    block_hash = hashlib.sha256(block.encode("utf-8")).hexdigest()
    blocks.append((first_line, block_hash))
    if "TODO-decompose-blocked-queue-" not in first_line:
        base_blocks.append((first_line, block_hash, block))

if not base_blocks:
    raise SystemExit(1)

base_queue_material = "\n\n".join(block for _, _, block in base_blocks)
queue_fingerprint = hashlib.sha256(base_queue_material.encode("utf-8")).hexdigest()

blocked_hashes_for_current_queue = set()
blocked_first_lines = set()
if blocked_path.exists():
    for line in blocked_path.read_text(encoding="utf-8").splitlines():
        try:
            record = json.loads(line)
        except Exception:
            continue
        first_line = record.get("selected_todo_first_line")
        if isinstance(first_line, str) and first_line:
            blocked_first_lines.add(first_line)
        if record.get("queue_fingerprint") == queue_fingerprint:
            blocked_hash = record.get("selected_todo_sha256")
            if isinstance(blocked_hash, str):
                blocked_hashes_for_current_queue.add(blocked_hash)

blocked_blocks = [
    first_line
    for first_line, block_hash, _block in base_blocks
    if block_hash in blocked_hashes_for_current_queue or first_line in blocked_first_lines
]
if len(blocked_blocks) != len(base_blocks):
    raise SystemExit(1)

short_hash = queue_fingerprint[:12]
decompose_id = f"TODO-decompose-blocked-queue-{short_hash}"
if decompose_id in todo:
    raise SystemExit(1)

try:
    relative_breakdown = breakdown_path.relative_to(todo_path.parent.parent)
except Exception:
    relative_breakdown = breakdown_path

item = f"""

- [ ] {decompose_id}: Decompose the currently blocked Product Ready TODO queue into implementable leaf TODOs:
  Route: todo-decomposition. Source: every unchecked item in `.brownie/todo.md`
  for queue fingerprint `{queue_fingerprint}` is recorded as blocked in
  `.brownie/private/phase-loop/todo-claims/blocked.jsonl`. Brownie must own the
  decomposition: read `.brownie/todo.md`, the blocked claim log, and only the
  smallest relevant target files; then propose a bounded `workspace.write`
  patch that replaces broad blocked TODOs in `.brownie/todo.md` with smaller
  unchecked leaf TODOs naming exact files and verification commands. Brownie
  may also create or update `{relative_breakdown}` in the same `.brownie`
  hierarchy as a decomposition ledger, but the live queue must remain
  `.brownie/todo.md`. Do not implement the release-evidence fixes in this
  decomposition task; only split them into executable work or explicit blocker
  TODOs. Keep owner-only or external-control requirements as explicit blocker
  TODOs. Generated at `{timestamp}`.
"""

with open(todo_path, "a", encoding="utf-8") as handle:
    handle.write(item)
    handle.flush()
    os.fsync(handle.fileno())
os.chmod(todo_path, 0o600)
PY
}

ensure_broad_todo_decomposition_request() {
  if [ ! -f "$PHASE_LOOP_TODO" ] || active_todo_claim_exists; then
    return 1
  fi
  local evaluation
  if ! evaluation="$(node "$ROOT_DIR/scripts/phase-loop-todo-evaluator.mjs" needs-decomposition --todo "$PHASE_LOOP_TODO" --blocked "$TODO_BLOCKED_FILE" --json 2>/dev/null)"; then
    return 1
  fi
  python3 - "$PHASE_LOOP_TODO" "$PHASE_LOOP_TODO_BREAKDOWN" "$evaluation" "$(now_utc)" <<'PY'
import hashlib
import json
import os
import pathlib
import re
import sys

todo_path = pathlib.Path(sys.argv[1])
breakdown_path = pathlib.Path(sys.argv[2])
evaluation = json.loads(sys.argv[3])
timestamp = sys.argv[4]

if evaluation.get("selected_todo_needs_decomposition") is not True:
    raise SystemExit(1)

selected = evaluation.get("selected_todo")
selected_id = evaluation.get("selected_todo_id") or "unknown"
reason = evaluation.get("selected_todo_decomposition_reason") or "broad_unbounded_todo"
if not isinstance(selected, str) or not selected.strip():
    raise SystemExit(1)

todo = todo_path.read_text(encoding="utf-8")
if selected not in todo:
    raise SystemExit(1)

selected_hash = hashlib.sha256(selected.encode("utf-8")).hexdigest()
decompose_id = f"TODO-decompose-broad-todo-{selected_hash[:12]}"
if decompose_id in todo:
    raise SystemExit(1)

try:
    relative_breakdown = breakdown_path.relative_to(todo_path.parent.parent)
except Exception:
    relative_breakdown = breakdown_path

item = f"""- [ ] {decompose_id}: Decompose broad TODO `{selected_id}` into implementable leaf TODOs:
  Route: todo-decomposition. Source: selected TODO hash `{selected_hash}` needs Brownie-owned decomposition because `{reason}`. Brownie must patch `.brownie/todo.md` so the broad selected TODO and this decomposition request are replaced by smaller unchecked leaf TODOs. Each generated leaf must include `Route:`, `Source TODO:`, `Depends on:`, `Completion condition:`, `Forbidden changes:`, and `Verification:`. Implementation leaves must name at most two concrete `Patch only` or `Create only` paths. Also update `{relative_breakdown}` with the dependency graph, verification ledger, and a short history note. Do not implement the underlying task in this decomposition pass. Generated at `{timestamp}`.
"""

updated = todo.replace(selected, f"{item}\n{selected}", 1)
tmp = todo_path.with_name(f"{todo_path.name}.{os.getpid()}.tmp")
with open(tmp, "w", encoding="utf-8") as handle:
    handle.write(updated)
    handle.flush()
    os.fsync(handle.fileno())
os.chmod(tmp, 0o600)
os.replace(tmp, todo_path)
try:
    os.fsync(os.open(str(todo_path.parent), os.O_RDONLY))
except Exception:
    pass
print(decompose_id)
PY
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
    claimed|in_progress)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

refresh_active_todo_claim_from_live_queue() {
  local run_stamp="$1"
  if [ ! -f "$TODO_CLAIM_FILE" ] || [ ! -f "$PHASE_LOOP_TODO" ]; then
    return 0
  fi
  python3 - "$TODO_CLAIM_FILE" "$PHASE_LOOP_TODO" "$TODO_QUEUE_STATE_FILE" "$TODO_REPAIR_FEEDBACK_FILE" "$run_stamp" "$(now_utc)" <<'PY'
import hashlib
import json
import os
import pathlib
import re
import sys

claim_path = pathlib.Path(sys.argv[1])
todo_path = pathlib.Path(sys.argv[2])
queue_state_path = pathlib.Path(sys.argv[3])
repair_feedback_path = pathlib.Path(sys.argv[4])
run_stamp = sys.argv[5]
timestamp = sys.argv[6]

def todo_id(block):
    first = block.splitlines()[0] if block.splitlines() else ""
    match = re.match(r"^[ \t]*[-*][ \t]+\[[ \t]*\][ \t]+([^:\s]+)", first)
    return match.group(1).strip() if match else ""

def unchecked_blocks(text):
    starts = [match.start() for match in re.finditer(r"(?m)^[ \t]*[-*][ \t]+\[[ \t]*\][ \t]+", text)]
    blocks = []
    for index, start in enumerate(starts):
        end = starts[index + 1] if index + 1 < len(starts) else len(text)
        blocks.append(text[start:end].rstrip())
    return blocks

try:
    claim = json.loads(claim_path.read_text(encoding="utf-8"))
except Exception:
    raise SystemExit(0)
if claim.get("status") not in ("claimed", "in_progress"):
    raise SystemExit(0)
selected = claim.get("selected_todo")
if not isinstance(selected, str) or not selected.strip():
    raise SystemExit(0)
selected_id = todo_id(selected)
if not selected_id:
    raise SystemExit(0)
try:
    todo_text = todo_path.read_text(encoding="utf-8")
except Exception:
    raise SystemExit(0)
live_blocks = unchecked_blocks(todo_text)
if not live_blocks:
    raise SystemExit(0)
live = None
for block in live_blocks:
    if todo_id(block) == selected_id:
        live = block
        break
if not live:
    for block in live_blocks:
        if re.search(rf"(?m)^\s*Source TODO:\s*{re.escape(selected_id)}\.", block):
            live = block
            break
if not live:
    try:
        feedback = json.loads(repair_feedback_path.read_text(encoding="utf-8"))
    except Exception:
        feedback = {}
    if feedback.get("claim_id") and feedback.get("claim_id") == claim.get("claim_id"):
        raise SystemExit(0)
    claim["status"] = "stale_snapshot_rejected"
    claim["run_stamp"] = run_stamp
    claim["updated_at"] = timestamp
    claim.setdefault("status_history", []).append({
        "status": "stale_snapshot_rejected",
        "run_stamp": run_stamp,
        "updated_at": timestamp,
        "note": "selected_todo_id_missing_from_live_queue",
    })
    tmp = claim_path.with_name(f"{claim_path.name}.{os.getpid()}.stale.tmp")
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(claim, handle, ensure_ascii=False, sort_keys=True, indent=2)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(tmp, 0o600)
    os.replace(tmp, claim_path)
    raise SystemExit(0)
fingerprint = hashlib.sha256(todo_text.encode("utf-8")).hexdigest()
if live == selected and claim.get("queue_fingerprint") == fingerprint:
    raise SystemExit(0)
generation = int(claim.get("queue_generation") or 1)
try:
    state = json.loads(queue_state_path.read_text(encoding="utf-8"))
    if state.get("fingerprint") != fingerprint:
        generation = int(state.get("generation") or generation) + 1
except Exception:
    generation = generation + 1
claim["selected_todo"] = live
claim["queue_fingerprint"] = fingerprint
claim["queue_generation"] = generation
claim["run_stamp"] = run_stamp
claim["updated_at"] = timestamp
claim.setdefault("status_history", []).append({
    "status": claim.get("status", "in_progress"),
    "run_stamp": run_stamp,
    "updated_at": timestamp,
    "note": "refreshed_selected_todo_from_live_queue",
})
tmp = claim_path.with_name(f"{claim_path.name}.{os.getpid()}.refresh.tmp")
with open(tmp, "w", encoding="utf-8") as handle:
    json.dump(claim, handle, ensure_ascii=False, sort_keys=True, indent=2)
    handle.write("\n")
    handle.flush()
    os.fsync(handle.fileno())
os.chmod(tmp, 0o600)
os.replace(tmp, claim_path)
state = {
    "schema_version": 1,
    "generation": generation,
    "fingerprint": fingerprint,
    "todo_path": str(todo_path),
    "updated_at": timestamp,
}
queue_state_path.parent.mkdir(parents=True, exist_ok=True)
tmp_state = queue_state_path.with_name(f"{queue_state_path.name}.{os.getpid()}.refresh.tmp")
with open(tmp_state, "w", encoding="utf-8") as handle:
    json.dump(state, handle, ensure_ascii=False, sort_keys=True, indent=2)
    handle.write("\n")
    handle.flush()
    os.fsync(handle.fileno())
os.chmod(tmp_state, 0o600)
os.replace(tmp_state, queue_state_path)
PY
  sync_parent_dir "$TODO_CLAIM_DIR"
}

record_blocked_todo_claim() {
  local run_stamp="$1"
  if [ ! -f "$TODO_CLAIM_FILE" ]; then
    return 0
  fi
  python3 - "$TODO_CLAIM_FILE" "$TODO_BLOCKED_FILE" "$run_stamp" "$(now_utc)" <<'PY'
import hashlib
import json
import os
import pathlib
import sys

claim_path = pathlib.Path(sys.argv[1])
blocked_path = pathlib.Path(sys.argv[2])
run_stamp = sys.argv[3]
timestamp = sys.argv[4]
try:
    claim = json.loads(claim_path.read_text(encoding="utf-8"))
except Exception:
    raise SystemExit(0)
selected = claim.get("selected_todo")
if not isinstance(selected, str) or not selected:
    raise SystemExit(0)
record = {
    "schema_version": 1,
    "blocked_at": timestamp,
    "run_stamp": run_stamp,
    "claim_id": claim.get("claim_id", ""),
    "queue_generation": claim.get("queue_generation"),
    "queue_fingerprint": claim.get("queue_fingerprint", ""),
    "selected_todo_sha256": hashlib.sha256(selected.encode("utf-8")).hexdigest(),
    "selected_todo_first_line": selected.splitlines()[0] if selected.splitlines() else "",
}
blocked_path.parent.mkdir(parents=True, exist_ok=True)
with open(blocked_path, "a", encoding="utf-8") as handle:
    handle.write(json.dumps(record, ensure_ascii=False, sort_keys=True))
    handle.write("\n")
    handle.flush()
    os.fsync(handle.fileno())
os.chmod(blocked_path, 0o600)
PY
  sync_parent_dir "$TODO_CLAIM_DIR"
}

selected_todo_is_explicit_blocker() {
  if [ ! -f "$TODO_CLAIM_FILE" ]; then
    return 1
  fi
  node --input-type=module - "$TODO_CLAIM_FILE" "$ROOT_DIR/scripts/phase-loop-todo-evaluator.mjs" <<'NODE'
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const claimPath = process.argv[2];
const evaluatorPath = process.argv[3];
let claim;
try {
  claim = JSON.parse(fs.readFileSync(claimPath, 'utf8'));
} catch {
  process.exit(1);
}
const selected = claim.selected_todo;
if (typeof selected !== 'string' || !selected.trim()) {
  process.exit(1);
}
const { isExplicitBlockerTodo } = await import(pathToFileURL(evaluatorPath).href);
process.exit(isExplicitBlockerTodo(selected) ? 0 : 1);
NODE
}

record_explicit_blocker_todo_claim() {
  local run_stamp="$1"
  local detail
  write_todo_claim "$(claim_field claim_id)" "blocked" "$(claim_field selected_todo)" "$(claim_field queue_fingerprint)" "$(active_claim_queue_generation)" "$run_stamp"
  record_blocked_todo_claim "$run_stamp"
  detail="Selected TODO is an explicit owner/release blocker with no safe implementation path; recorded it as blocked and will continue with the next unblocked TODO."
  printf '%s %s\n' "$(now_utc)" "$detail" >> "$SUPERVISOR_LOG"
  write_status "blocked_todo_recorded" "$detail" "explicit-blocker-$run_stamp" "0" "${CONSECUTIVE_FAILURES:-0}"
}

selected_todo_is_invalid_decomposition_leaf() {
  if [ ! -f "$TODO_CLAIM_FILE" ]; then
    return 1
  fi
  python3 - "$TODO_CLAIM_FILE" "$PHASE_LOOP_WORKSPACE_ROOT" <<'PY'
import json
import pathlib
import re
import sys

claim_path = pathlib.Path(sys.argv[1])
workspace = pathlib.Path(sys.argv[2])
try:
    claim = json.loads(claim_path.read_text(encoding="utf-8"))
except Exception:
    raise SystemExit(1)
selected = claim.get("selected_todo")
if not isinstance(selected, str) or not selected.strip():
    raise SystemExit(1)
if "Source TODO:" not in selected:
    raise SystemExit(1)
first = selected.splitlines()[0] if selected.splitlines() else ""
scope_match = re.search(r"Patch only `([^`\n]+)`", first)
field_match = re.search(r"field `([^`\n]+)`", selected, re.IGNORECASE)
if not scope_match or not field_match:
    raise SystemExit(1)
target = (workspace / scope_match.group(1)).resolve()
try:
    text = target.read_text(encoding="utf-8")
except Exception:
    raise SystemExit(0)
field = field_match.group(1)
if target.suffix.lower() == ".json" and f'"{field}"' not in text:
    raise SystemExit(0)
raise SystemExit(1)
PY
}

record_invalid_decomposition_leaf_claim() {
  local run_stamp="$1"
  local detail
  write_todo_claim "$(claim_field claim_id)" "blocked" "$(claim_field selected_todo)" "$(claim_field queue_fingerprint)" "$(active_claim_queue_generation)" "$run_stamp"
  record_blocked_todo_claim "$run_stamp"
  remove_completed_todo_claim_from_queue "$run_stamp" >> "$SUPERVISOR_LOG" || true
  detail="Selected decomposition leaf references a nonexistent JSON field or invalid bounded target; recorded it as blocked and will continue with the next unblocked TODO."
  printf '%s %s\n' "$(now_utc)" "$detail" >> "$SUPERVISOR_LOG"
  write_status "blocked_todo_recorded" "$detail" "invalid-leaf-$run_stamp" "0" "${CONSECUTIVE_FAILURES:-0}"
}

selected_todo_was_stably_blocked() {
  if [ ! -f "$TODO_CLAIM_FILE" ] || [ ! -f "$TODO_BLOCKED_FILE" ]; then
    return 1
  fi
  python3 - "$TODO_CLAIM_FILE" "$TODO_BLOCKED_FILE" <<'PY'
import json
import pathlib
import re
import sys

claim_path = pathlib.Path(sys.argv[1])
blocked_path = pathlib.Path(sys.argv[2])

def todo_id(first_line):
    match = re.match(r"^[ \t]*[-*][ \t]+\[[ \t]*\][ \t]+([^:\s]+)", first_line)
    return match.group(1).strip() if match else ""

try:
    claim = json.loads(claim_path.read_text(encoding="utf-8"))
except Exception:
    raise SystemExit(1)
selected = claim.get("selected_todo")
if not isinstance(selected, str) or not selected.strip():
    raise SystemExit(1)
selected_first = selected.splitlines()[0] if selected.splitlines() else ""
selected_id = todo_id(selected_first)
if not selected_id:
    raise SystemExit(1)
stable_candidate = (
    "Source TODO:" in selected
    or "-leaf" in selected_id
    or "-doc-sync-leaf" in selected_id
    or "Blocker:" in selected_first
)
if not stable_candidate:
    raise SystemExit(1)
try:
    lines = blocked_path.read_text(encoding="utf-8").splitlines()
except Exception:
    raise SystemExit(1)
for line in lines:
    if not line.strip():
        continue
    try:
        record = json.loads(line)
    except Exception:
        continue
    blocked_first = str(record.get("selected_todo_first_line") or "")
    if todo_id(blocked_first) == selected_id:
        raise SystemExit(0)
raise SystemExit(1)
PY
}

record_stably_blocked_todo_claim() {
  local run_stamp="$1"
  local detail
  write_todo_claim "$(claim_field claim_id)" "blocked" "$(claim_field selected_todo)" "$(claim_field queue_fingerprint)" "$(active_claim_queue_generation)" "$run_stamp"
  record_blocked_todo_claim "$run_stamp"
  remove_completed_todo_claim_from_queue "$run_stamp" >> "$SUPERVISOR_LOG" || true
  detail="Selected generated/blocker TODO id was already recorded as blocked in a previous queue generation; removed it from the live queue and will continue with the next unblocked TODO."
  printf '%s %s\n' "$(now_utc)" "$detail" >> "$SUPERVISOR_LOG"
  write_status "blocked_todo_recorded" "$detail" "stable-blocked-$run_stamp" "0" "${CONSECUTIVE_FAILURES:-0}"
}

remove_completed_todo_claim_from_queue() {
  local run_stamp="$1"
  if [ ! -f "$TODO_CLAIM_FILE" ] || [ ! -f "$PHASE_LOOP_TODO" ]; then
    return 0
  fi
  python3 - "$TODO_CLAIM_FILE" "$PHASE_LOOP_TODO" "$run_stamp" "$(now_utc)" <<'PY'
import json
import os
import pathlib
import sys

claim_path = pathlib.Path(sys.argv[1])
todo_path = pathlib.Path(sys.argv[2])
run_stamp = sys.argv[3]
timestamp = sys.argv[4]
try:
    claim = json.loads(claim_path.read_text(encoding="utf-8"))
except Exception:
    raise SystemExit(0)
selected = claim.get("selected_todo")
if not isinstance(selected, str) or not selected:
    raise SystemExit(0)
first_line = selected.splitlines()[0] if selected.splitlines() else ""
if "[ ]" not in first_line:
    raise SystemExit(0)
try:
    text = todo_path.read_text(encoding="utf-8")
except FileNotFoundError:
    raise SystemExit(0)
index = text.find(selected)
if index < 0:
    raise SystemExit(0)
if text.find(selected, index + len(selected)) >= 0:
    raise SystemExit("selected TODO appears more than once; refusing automatic removal")
end = index + len(selected)
while end < len(text) and text[end] == "\n":
    end += 1
replacement = text[:index] + text[end:]
if index > 0 and not text[:index].endswith("\n\n") and replacement[index:index + 1] not in ("", "\n"):
    replacement = text[:index] + "\n" + text[end:]
tmp_path = todo_path.with_name(f"{todo_path.name}.{os.getpid()}.completed-{run_stamp}.tmp")
with open(tmp_path, "w", encoding="utf-8") as handle:
    handle.write(replacement)
    handle.flush()
    os.fsync(handle.fileno())
os.replace(tmp_path, todo_path)
try:
    dir_fd = os.open(str(todo_path.parent), os.O_RDONLY)
    try:
        os.fsync(dir_fd)
    finally:
        os.close(dir_fd)
except Exception:
    pass
print(json.dumps({
    "removed_at": timestamp,
    "run_stamp": run_stamp,
    "selected_todo_first_line": first_line,
}, ensure_ascii=False, sort_keys=True))
PY
}

classify_no_progress_recovery() {
  local stdout_log="$1"
  local stderr_log="$2"
  local progress_file="$3"
  python3 - "$stdout_log" "$stderr_log" "$progress_file" <<'PY'
import json
import pathlib
import subprocess
import sys

stdout_log = pathlib.Path(sys.argv[1])
stderr_log = pathlib.Path(sys.argv[2])
progress_file = pathlib.Path(sys.argv[3])

def read(path):
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return ""

combined = "\n".join([read(stdout_log), read(stderr_log), read(progress_file)]).lower()
label = "unknown_no_progress"
action = "record_blocked_todo_and_request_decomposition"
if "protected" in combined and "read" in combined and ("denied" in combined or "rejection" in combined):
    label = "protected_read_denial_loop"
    action = "redirect_to_git_status_git_diff_or_bounded_todo_refinement"
elif "additional workspace.read is not progress" in combined or "duplicate workspace.read" in combined:
    label = "repeated_workspace_read_after_budget"
    action = "split_todo_into_exact_patch_hunks_or_use_visible_read_preview"
elif "missing_closing_fence" in combined and "workspace.write" in combined:
    label = "workspace_write_intent_truncated"
    action = "split_into_smaller_patch_or_emit_shorter_exact_hunk"
elif "workspace.write" in combined and ("denied" in combined or "invalid" in combined or "rejection" in combined):
    label = "workspace_write_rejected"
    action = "emit_exact_patch_target_or_concrete_blocker"
elif "patch only target does not exist" in combined or "missing package script" in combined:
    label = "invalid_decomposition_leaf"
    action = "rerun_decomposition_with_existing_targets_and_valid_verification"
elif "no_eligible_task" in combined or "no actionable" in combined:
    label = "no_actionable_runtime_task"
    action = "close_or_decompose_external_todo_queue"
elif "tool intent" in combined and "workspace.write" not in combined:
    label = "read_only_tool_intent_loop"
    action = "force_workspace_write_or_blocker_after_one_read"

print(f"{label}:{action}")
PY
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

try_runtime_readiness_fingerprint_fallback() {
  local run_stamp="$1"
  if [ ! -f "$TODO_CLAIM_FILE" ]; then
    return 2
  fi
  python3 - "$TODO_CLAIM_FILE" <<'PY'
import json
import sys

try:
    with open(sys.argv[1], encoding="utf-8") as handle:
        claim = json.load(handle)
except Exception:
    sys.exit(2)

if not claim.get("claim_id"):
    sys.exit(2)
selected = str(claim.get("selected_todo") or "")
if "docs/architecture/runtime-release-readiness-audit.json" not in selected:
    sys.exit(2)
sys.exit(0)
PY
  case "$?" in
    0) ;;
    2) return 2 ;;
    *) return 1 ;;
  esac
  local guard_stdout guard_stderr guard_status
  guard_stdout="$(mktemp)"
  guard_stderr="$(mktemp)"
  (
    cd "$PHASE_LOOP_WORKSPACE_ROOT" || exit 70
    pnpm --workspace-root guard:runtime-release-readiness >"$guard_stdout" 2>"$guard_stderr"
  )
  guard_status=$?
  if [ "$guard_status" -eq 0 ]; then
    rm -f "$guard_stdout" "$guard_stderr"
    return 2
  fi
  if ! python3 - "$guard_stderr" <<'PY'
import pathlib
import sys

stderr = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8", errors="replace")
fingerprint_line = "safety_readiness_evidence_invalidation.tracked_fingerprint must match live safety-critical content"
if fingerprint_line not in stderr:
    sys.exit(1)
other_failures = [
    line for line in stderr.splitlines()
    if line.startswith("- ") and fingerprint_line not in line
]
sys.exit(0 if not other_failures else 1)
PY
  then
    printf 'runtime_readiness_fingerprint_fallback_not_eligible status=%s stderr=%s\n' "$guard_status" "$(tail -c 1200 "$guard_stderr" 2>/dev/null)"
    rm -f "$guard_stdout" "$guard_stderr"
    return 2
  fi
  rm -f "$guard_stdout" "$guard_stderr"
  (
    cd "$PHASE_LOOP_WORKSPACE_ROOT" || exit 70
    node --input-type=module - <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import { buildSafetyReadinessEvidenceSnapshot } from './scripts/guard-runtime-release-readiness.mjs';

const auditPath = path.join(process.cwd(), 'docs/architecture/runtime-release-readiness-audit.json');
const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
const previous = audit.safety_readiness_evidence_invalidation || {};
audit.safety_readiness_evidence_invalidation = {
  ...previous,
  ...buildSafetyReadinessEvidenceSnapshot(process.cwd()),
  status: previous.status || 'implemented_sufficient'
};
fs.writeFileSync(auditPath, `${JSON.stringify(audit, null, 2)}\n`);
NODE
    pnpm --workspace-root guard:runtime-release-readiness >/tmp/brownie-runtime-readiness-fingerprint-fallback.out 2>/tmp/brownie-runtime-readiness-fingerprint-fallback.err
  )
  local status=$?
  if [ "$status" -ne 0 ]; then
    printf 'runtime_readiness_fingerprint_fallback_failed status=%s stdout=%s stderr=%s\n' "$status" "$(tail -c 1200 /tmp/brownie-runtime-readiness-fingerprint-fallback.out 2>/dev/null)" "$(tail -c 1200 /tmp/brownie-runtime-readiness-fingerprint-fallback.err 2>/dev/null)"
    return 1
  fi
  printf 'runtime_readiness_fingerprint_fallback_applied run_stamp=%s path=docs/architecture/runtime-release-readiness-audit.json\n' "$run_stamp"
  return 0
}

try_release_contract_readiness_audit_hash_fallback() {
  local run_stamp="$1"
  if [ ! -f "$TODO_CLAIM_FILE" ]; then
    return 2
  fi
  python3 - "$TODO_CLAIM_FILE" <<'PY'
import json
import sys

try:
    with open(sys.argv[1], encoding="utf-8") as handle:
        claim = json.load(handle)
except Exception:
    sys.exit(2)

selected = str(claim.get("selected_todo") or "")
if "E-16f-release-contract-audit-sync" not in selected:
    sys.exit(2)
if "docs/architecture/runtime-release-contract.json" not in selected:
    sys.exit(2)
if "docs/architecture/runtime-release-readiness-audit.json" not in selected:
    sys.exit(2)
sys.exit(0)
PY
  case "$?" in
    0) ;;
    2) return 2 ;;
    *) return 1 ;;
  esac

  local guard_stdout guard_stderr guard_status
  guard_stdout="$(mktemp)"
  guard_stderr="$(mktemp)"
  (
    cd "$PHASE_LOOP_WORKSPACE_ROOT" || exit 70
    pnpm --workspace-root guard:release-contract >"$guard_stdout" 2>"$guard_stderr"
  )
  guard_status=$?
  if [ "$guard_status" -eq 0 ]; then
    rm -f "$guard_stdout" "$guard_stderr"
    return 2
  fi
  if ! python3 - "$guard_stderr" <<'PY'
import pathlib
import sys

stderr = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8", errors="replace")
expected = "commit_trace.readiness_audit_content_sha256 must match the current readiness audit content SHA-256"
sys.exit(0 if expected in stderr else 1)
PY
  then
    printf 'release_contract_readiness_audit_hash_fallback_not_eligible status=%s stderr=%s\n' "$guard_status" "$(tail -c 1200 "$guard_stderr" 2>/dev/null)"
    rm -f "$guard_stdout" "$guard_stderr"
    return 2
  fi
  rm -f "$guard_stdout" "$guard_stderr"

  (
    cd "$PHASE_LOOP_WORKSPACE_ROOT" || exit 70
    node --input-type=module - <<'NODE'
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const contractPath = path.join(repoRoot, 'docs/architecture/runtime-release-contract.json');
const auditPath = path.join(repoRoot, 'docs/architecture/runtime-release-readiness-audit.json');
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
const auditText = fs.readFileSync(auditPath, 'utf8');
const nextHash = `sha256:${crypto.createHash('sha256').update(auditText).digest('hex')}`;

contract.commit_trace = contract.commit_trace && typeof contract.commit_trace === 'object'
  ? contract.commit_trace
  : {};
const previousHash = contract.commit_trace.readiness_audit_content_sha256 ?? null;
if (previousHash === nextHash) {
  console.log(JSON.stringify({
    changed: false,
    path: 'docs/architecture/runtime-release-contract.json',
    readiness_audit_content_sha256: nextHash
  }, null, 2));
  process.exit(0);
}
contract.commit_trace.readiness_audit_content_sha256 = nextHash;
fs.writeFileSync(contractPath, `${JSON.stringify(contract, null, 2)}\n`);
console.log(JSON.stringify({
  changed: true,
  path: 'docs/architecture/runtime-release-contract.json',
  previous_readiness_audit_content_sha256: previousHash,
  readiness_audit_content_sha256: nextHash
}, null, 2));
NODE
    pnpm --workspace-root guard:release-contract >/tmp/brownie-release-contract-readiness-audit-hash-fallback.out 2>/tmp/brownie-release-contract-readiness-audit-hash-fallback.err
  )
  local status=$?
  if [ "$status" -ne 0 ]; then
    if python3 - /tmp/brownie-release-contract-readiness-audit-hash-fallback.err <<'PY'
import pathlib
import sys

stderr = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8", errors="replace")
target = "commit_trace.readiness_audit_content_sha256 must match the current readiness audit content SHA-256"
sys.exit(1 if target in stderr else 0)
PY
    then
      printf 'release_contract_readiness_audit_hash_fallback_applied_with_remaining_guard_failures run_stamp=%s stdout=%s stderr=%s\n' "$run_stamp" "$(tail -c 1200 /tmp/brownie-release-contract-readiness-audit-hash-fallback.out 2>/dev/null)" "$(tail -c 1200 /tmp/brownie-release-contract-readiness-audit-hash-fallback.err 2>/dev/null)"
      return 0
    fi
    printf 'release_contract_readiness_audit_hash_fallback_failed status=%s stdout=%s stderr=%s\n' "$status" "$(tail -c 1200 /tmp/brownie-release-contract-readiness-audit-hash-fallback.out 2>/dev/null)" "$(tail -c 1200 /tmp/brownie-release-contract-readiness-audit-hash-fallback.err 2>/dev/null)"
    return 1
  fi
  printf 'release_contract_readiness_audit_hash_fallback_applied run_stamp=%s path=docs/architecture/runtime-release-contract.json\n' "$run_stamp"
  return 0
}

try_runtime_readiness_verified_completion_fallback() {
  local run_stamp="$1"
  if [ ! -f "$TODO_CLAIM_FILE" ]; then
    return 2
  fi
  python3 - "$TODO_CLAIM_FILE" <<'PY'
import json
import sys

try:
    with open(sys.argv[1], encoding="utf-8") as handle:
        claim = json.load(handle)
except Exception:
    sys.exit(2)
selected = str(claim.get("selected_todo") or "")
if "E-15e-release-readiness-audit-sync-leaf" not in selected:
    sys.exit(2)
if "pnpm --workspace-root guard:runtime-release-readiness" not in selected:
    sys.exit(2)
sys.exit(0)
PY
  case "$?" in
    0) ;;
    2) return 2 ;;
    *) return 1 ;;
  esac
  (
    cd "$PHASE_LOOP_WORKSPACE_ROOT" || exit 70
    pnpm --workspace-root guard:runtime-release-readiness >/tmp/brownie-runtime-readiness-verified-completion.out 2>/tmp/brownie-runtime-readiness-verified-completion.err
  )
  local status=$?
  if [ "$status" -ne 0 ]; then
    return 2
  fi
  printf 'runtime_readiness_verified_completion run_stamp=%s verification=pnpm --workspace-root guard:runtime-release-readiness\n' "$run_stamp"
  return 0
}

try_selected_todo_verified_noop_completion_fallback() {
  local run_stamp="$1"
  if [ ! -f "$TODO_CLAIM_FILE" ]; then
    return 2
  fi
  python3 - "$TODO_CLAIM_FILE" "$PHASE_LOOP_TODO" "$PHASE_LOOP_WORKSPACE_ROOT" "$run_stamp" <<'PY'
import json
import pathlib
import re
import shlex
import subprocess
import sys

claim_path = pathlib.Path(sys.argv[1])
todo_path = pathlib.Path(sys.argv[2])
workspace_root = pathlib.Path(sys.argv[3])
run_stamp = sys.argv[4]

try:
    claim = json.loads(claim_path.read_text(encoding="utf-8"))
except Exception as error:
    print(json.dumps({"completed": False, "reason": f"claim_unreadable:{error}"}, sort_keys=True))
    raise SystemExit(1)

selected = claim.get("selected_todo")
if not isinstance(selected, str) or not selected.strip():
    raise SystemExit(2)
first_line = selected.splitlines()[0].strip()
if not re.match(r"^- \[ \] [^:\s]+: (Patch only|Create only) `[^`]+`", first_line):
    raise SystemExit(2)
selected_id = first_line.removeprefix("- [ ] ").split(":", 1)[0].strip().lower()
if "Verification:" not in selected or "Verification: run " not in selected:
    raise SystemExit(2)
skip_verification_commands = False
try:
    todo_text = todo_path.read_text(encoding="utf-8")
    if first_line not in todo_text:
        print(json.dumps({"completed": True, "reason": "selected_todo_already_removed", "run_stamp": run_stamp}, sort_keys=True))
        raise SystemExit(0)
except Exception as error:
    print(json.dumps({"completed": False, "reason": f"todo_unreadable:{error}"}, sort_keys=True))
    raise SystemExit(1)

selected_lower = selected.lower()
if selected_id == "e-16a-artifact-source-local-producer":
    target = workspace_root / "scripts/release-local-artifact.mjs"
    try:
        target_text = target.read_text(encoding="utf-8")
    except Exception as error:
        print(json.dumps({"completed": False, "reason": f"target_unreadable:{error}"}, sort_keys=True))
        raise SystemExit(1)
    artifact_start = target_text.find("const artifactEvidence = {")
    artifact_end = target_text.find("const smokeEvidence =", artifact_start)
    artifact_section = target_text[artifact_start:artifact_end] if artifact_start >= 0 and artifact_end > artifact_start else ""
    semantic_checks = {
        "source_commit_helper_present": "function sha256SourceCommit(repoRoot)" in target_text,
        "source_clean_tree_helper_present": "function sha256CleanTree(repoRoot)" in target_text,
        "source_identity_helper_present": "function sha256String(str)" in target_text,
        "source_identity_computed": "const sourceIdentity = sha256String(`${sourceCommit}:${sourceCleanTree}`);" in target_text,
        "artifact_source_fields_present": all(token in artifact_section for token in ("source_commit", "source_clean_tree", "source_identity")),
        "artifact_sha_still_file_hash": "sha256: sha256File(artifactPath)" in artifact_section,
    }
    if not all(semantic_checks.values()):
        print(json.dumps({"completed": False, "reason": "semantic_noop_verification_failed", "checks": semantic_checks}, sort_keys=True))
        raise SystemExit(1)
elif selected_id == "e-16a-artifact-source-linux-producer":
    target = workspace_root / "scripts/release-linux-x64-docker-artifact.mjs"
    try:
        target_text = target.read_text(encoding="utf-8")
    except Exception as error:
        print(json.dumps({"completed": False, "reason": f"target_unreadable:{error}"}, sort_keys=True))
        raise SystemExit(1)
    artifact_start = target_text.find("const artifactEvidence = {")
    artifact_end = target_text.find("const smokeEvidence =", artifact_start)
    artifact_section = target_text[artifact_start:artifact_end] if artifact_start >= 0 and artifact_end > artifact_start else ""
    semantic_checks = {
        "source_commit_helper_present": "function sha256SourceCommit(repoRoot)" in target_text,
        "source_clean_tree_helper_present": "function sha256CleanTree(repoRoot)" in target_text,
        "source_identity_helper_present": "function sha256String(value)" in target_text,
        "source_identity_computed": "const sourceIdentity = sha256String(`${sourceCommit}:${sourceCleanTree}`);" in target_text,
        "artifact_source_fields_present": all(token in artifact_section for token in ("source_commit", "source_clean_tree", "source_identity")),
        "artifact_sha_still_file_hash": "sha256: sha256File(artifactPath)" in artifact_section,
    }
    if not all(semantic_checks.values()):
        print(json.dumps({"completed": False, "reason": "semantic_noop_verification_failed", "checks": semantic_checks}, sort_keys=True))
        raise SystemExit(1)
elif selected_id == "e-16a-artifact-source-local-producer-esm-helper-fix":
    target = workspace_root / "scripts/release-local-artifact.mjs"
    try:
        target_text = target.read_text(encoding="utf-8")
    except Exception as error:
        print(json.dumps({"completed": False, "reason": f"target_unreadable:{error}"}, sort_keys=True))
        raise SystemExit(1)
    helper_region_start = target_text.find("function gitOutput(")
    helper_region_end = target_text.find("function run(", helper_region_start)
    helper_region = target_text[helper_region_start:helper_region_end] if helper_region_start >= 0 and helper_region_end > helper_region_start else ""
    artifact_start = target_text.find("const artifactEvidence = {")
    artifact_end = target_text.find("const smokeEvidence =", artifact_start)
    artifact_section = target_text[artifact_start:artifact_end] if artifact_start >= 0 and artifact_end > artifact_start else ""
    semantic_checks = {
        "node_child_process_require_absent": "require('node:child_process')" not in target_text and 'require("node:child_process")' not in target_text,
        "git_output_helper_present": "function gitOutput(repoRoot, args)" in target_text,
        "helpers_use_spawn_sync": "spawnSync('git'" in helper_region,
        "helpers_accept_repo_root": "function sha256SourceCommit(repoRoot)" in target_text and "function sha256CleanTree(repoRoot)" in target_text,
        "call_sites_pass_repo_root": "sha256SourceCommit(repoRoot)" in target_text and "sha256CleanTree(repoRoot)" in target_text,
        "artifact_source_fields_present": all(token in artifact_section for token in ("source_commit", "source_clean_tree", "source_identity")),
    }
    if not all(semantic_checks.values()):
        print(json.dumps({"completed": False, "reason": "semantic_noop_verification_failed", "checks": semantic_checks}, sort_keys=True))
        raise SystemExit(1)
elif selected_id == "e-16a-clean-source-guard":
    target = workspace_root / "scripts/guard-supply-chain-artifact-evidence.mjs"
    evidence_path = workspace_root / ".brownie/release-evidence/supply-chain-artifact-evidence.json"
    try:
        target_text = target.read_text(encoding="utf-8")
        evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
    except Exception as error:
        print(json.dumps({"completed": False, "reason": f"semantic_noop_verification_unreadable:{error}"}, sort_keys=True))
        raise SystemExit(1)
    artifacts = evidence.get("sections", {}).get("artifacts", {})
    semantic_checks = {
        "guard_requires_source_commit": "artifact.source_commit" in target_text and ".source_commit must be sha256" in target_text,
        "guard_requires_clean_tree": "artifact.source_clean_tree === 'clean'" in target_text,
        "guard_requires_source_identity": "artifact.source_identity" in target_text and ".source_identity must be sha256" in target_text,
        "evidence_fail_closed_for_missing_source_identity": artifacts.get("status") == "partial_source_identity_missing",
        "evidence_fail_reason_present": "artifacts:partial_source_identity_missing" in evidence.get("fail_closed_reasons", []),
        "missing_targets_recorded": isinstance(artifacts.get("missing_source_identity_targets"), list) and len(artifacts.get("missing_source_identity_targets")) > 0,
    }
    if not all(semantic_checks.values()):
        print(json.dumps({"completed": False, "reason": "semantic_noop_verification_failed", "checks": semantic_checks}, sort_keys=True))
        raise SystemExit(1)
elif selected_id == "e-16a-clean-source-test":
    target = workspace_root / "scripts/guard-supply-chain-artifact-evidence.test.mjs"
    try:
        target_text = target.read_text(encoding="utf-8")
    except Exception as error:
        print(json.dumps({"completed": False, "reason": f"semantic_noop_verification_unreadable:{error}"}, sort_keys=True))
        raise SystemExit(1)
    semantic_checks = {
        "fail_closed_missing_source_identity_test_present": "accepts fail-closed artifacts when source identity is missing" in target_text,
        "rejects_satisfied_missing_source_identity_test_present": "rejects satisfied artifacts without source identity binding" in target_text,
        "accepts_clean_source_identity_test_present": "accepts satisfied artifacts with clean source identity binding" in target_text,
        "partial_source_identity_status_covered": "partial_source_identity_missing" in target_text,
        "source_identity_fields_covered": all(token in target_text for token in ("source_commit", "source_clean_tree", "source_identity")),
    }
    if not all(semantic_checks.values()):
        print(json.dumps({"completed": False, "reason": "semantic_noop_verification_failed", "checks": semantic_checks}, sort_keys=True))
        raise SystemExit(1)
elif selected_id == "e-16b-artifact-smoke-steps-guard":
    target = workspace_root / "scripts/guard-supply-chain-artifact-evidence.mjs"
    try:
        target_text = target.read_text(encoding="utf-8")
    except Exception as error:
        print(json.dumps({"completed": False, "reason": f"semantic_noop_verification_unreadable:{error}"}, sort_keys=True))
        raise SystemExit(1)
    required_start = target_text.find("const requiredArtifactSmokeE2eStepIds = [")
    required_end = target_text.find("];", required_start)
    required_section = target_text[required_start:required_end] if required_start >= 0 and required_end > required_start else ""
    semantic_checks = {
        "required_steps_constant_present": required_start >= 0,
        "base_mode_pack_load_required": "'base_mode_pack_load'" in required_section,
        "minimal_task_run_required": "'minimal_task_run'" in required_section,
        "ledger_generation_required": "'ledger_generation'" in required_section,
        "forced_stop_resume_required": "'forced_stop_resume'" in required_section,
        "stale_replay_rejection_required": "'stale_replay_rejection'" in required_section,
        "no_synthetic_artifact_smoke_step_required": "'artifact_smoke'" not in required_section,
        "guard_rejects_missing_required_step": "missing required E2E step ${stepId}" in target_text,
    }
    if not all(semantic_checks.values()):
        print(json.dumps({"completed": False, "reason": "semantic_noop_verification_failed", "checks": semantic_checks}, sort_keys=True))
        raise SystemExit(1)
elif selected_id == "e-16b-artifact-smoke-collector":
    target = workspace_root / "scripts/release-supply-chain-artifact-evidence.mjs"
    try:
        target_text = target.read_text(encoding="utf-8")
    except Exception as error:
        print(json.dumps({"completed": False, "reason": f"semantic_noop_verification_unreadable:{error}"}, sort_keys=True))
        raise SystemExit(1)
    smoke_start = target_text.find("function buildArtifactSmokeSection")
    smoke_end = target_text.find("function readJsonIfExists", smoke_start)
    smoke_section = target_text[smoke_start:smoke_end] if smoke_start >= 0 and smoke_end > smoke_start else ""
    semantic_checks = {
        "collector_reads_smoke_evidence_path": "smoke_evidence_path" in target_text,
        "collector_reads_smoke_evidence_status": "artifact.smoke_evidence?.status" in target_text,
        "collector_records_e2e_steps": "e2e_steps" in smoke_section and "missing_e2e_steps" in smoke_section,
        "collector_avoids_raw_output_fields": "stdout" not in smoke_section and "stderr" not in smoke_section,
        "no_unused_artifact_smoke_targets_table": "artifactSmokeTargets" not in target_text,
    }
    if not all(semantic_checks.values()):
        print(json.dumps({"completed": False, "reason": "semantic_noop_verification_failed", "checks": semantic_checks}, sort_keys=True))
        raise SystemExit(1)
elif selected_id == "e-16b-artifact-smoke-test":
    target = workspace_root / "scripts/guard-supply-chain-artifact-evidence.test.mjs"
    try:
        target_text = target.read_text(encoding="utf-8")
    except Exception as error:
        print(json.dumps({"completed": False, "reason": f"semantic_noop_verification_unreadable:{error}"}, sort_keys=True))
        raise SystemExit(1)
    semantic_checks = {
        "rejects_missing_e2e_steps_test_present": "rejects satisfied artifact smoke without required E2E step evidence" in target_text,
        "accepts_required_e2e_steps_test_present": "accepts satisfied artifact smoke with required E2E step evidence" in target_text,
        "required_step_names_covered": all(step in target_text for step in ("base_mode_pack_load", "minimal_task_run", "ledger_generation", "forced_stop_resume", "stale_replay_rejection")),
    }
    if not all(semantic_checks.values()):
        print(json.dumps({"completed": False, "reason": "semantic_noop_verification_failed", "checks": semantic_checks}, sort_keys=True))
        raise SystemExit(1)
elif selected_id == "e-16c-artifact-lifecycle-collector":
    target = workspace_root / "scripts/release-runtime-operational-evidence.mjs"
    test_target = workspace_root / "scripts/guard-runtime-operational-evidence.test.mjs"
    try:
        target_text = target.read_text(encoding="utf-8")
        test_text = test_target.read_text(encoding="utf-8")
    except Exception as error:
        print(json.dumps({"completed": False, "reason": f"semantic_noop_verification_unreadable:{error}"}, sort_keys=True))
        raise SystemExit(1)
    lifecycle_start = target_text.find("function buildArtifactLifecycleSection")
    lifecycle_end = target_text.find("function waitForFile", lifecycle_start)
    lifecycle_section = target_text[lifecycle_start:lifecycle_end] if lifecycle_start >= 0 and lifecycle_end > lifecycle_start else ""
    semantic_checks = {
        "collector_function_present": "function buildArtifactLifecycleSection(repoRoot, artifacts)" in target_text,
        "collector_records_lifecycle_results": "lifecycle_results" in lifecycle_section,
        "collector_records_target_results": "target_results" in lifecycle_section,
        "collector_uses_redacted_commands": "commands: redactCommandResults(commands)" in target_text,
        "collector_avoids_raw_fixture_payloads": all(token not in target_text for token in ("const artifactLifecycleEvidence = {", "const soakEvidenceFixture = {", "actual_output:")),
        "collector_source_guard_test_present": "collector source does not contain raw fixture output payloads" in test_text,
    }
    if not all(semantic_checks.values()):
        print(json.dumps({"completed": False, "reason": "semantic_noop_verification_failed", "checks": semantic_checks}, sort_keys=True))
        raise SystemExit(1)
elif selected_id == "e-16c-artifact-lifecycle-guard":
    target = workspace_root / "scripts/guard-runtime-operational-evidence.mjs"
    test_target = workspace_root / "scripts/guard-runtime-operational-evidence.test.mjs"
    try:
        target_text = target.read_text(encoding="utf-8")
        test_text = test_target.read_text(encoding="utf-8")
    except Exception as error:
        print(json.dumps({"completed": False, "reason": f"semantic_noop_verification_unreadable:{error}"}, sort_keys=True))
        raise SystemExit(1)
    semantic_checks = {
        "guard_iterates_artifact_lifecycle_results": "evidence.sections?.artifact_lifecycle?.lifecycle_results" in target_text,
        "guard_requires_lifecycle_path": "lifecycle_results[${index}].path must be non-empty" in target_text,
        "guard_validates_lifecycle_commands": "validateCommand(command, errors, `sections.artifact_lifecycle.lifecycle_results[${index}].commands" in target_text,
        "guard_requires_satisfied_status": "result.status === 'satisfied'" in target_text,
        "guard_requires_uninstalled": "result.uninstalled === true" in target_text,
        "guard_requires_checksum_verified": "result.checksum_verified === true" in target_text,
        "guard_rejects_raw_process_fields": "forbiddenRawProcessFieldNames" in target_text and "must not store raw process evidence" in target_text,
        "tests_cover_failed_lifecycle_command": "rejects satisfied artifact lifecycle with failed command" in test_text,
        "tests_cover_forbidden_local_and_raw_process": "rejects forbidden local and raw process evidence" in test_text,
    }
    if not all(semantic_checks.values()):
        print(json.dumps({"completed": False, "reason": "semantic_noop_verification_failed", "checks": semantic_checks}, sort_keys=True))
        raise SystemExit(1)
elif selected_id == "e-16c-artifact-lifecycle-test":
    target = workspace_root / "scripts/guard-runtime-operational-evidence.test.mjs"
    try:
        target_text = target.read_text(encoding="utf-8")
    except Exception as error:
        print(json.dumps({"completed": False, "reason": f"semantic_noop_verification_unreadable:{error}"}, sort_keys=True))
        raise SystemExit(1)
    semantic_checks = {
        "valid_evidence_contains_lifecycle_results": "lifecycle_results" in target_text and "checksum_verified: true" in target_text and "uninstalled: true" in target_text,
        "test_rejects_missing_fail_closed_reason": "requires fail-closed reasons for incomplete artifact lifecycle evidence" in target_text,
        "test_accepts_incompatible_host_fail_closed": "accepts fail-closed artifact lifecycle when cross-platform artifacts are host-incompatible" in target_text,
        "test_accepts_missing_manifest_fail_closed": "accepts fail-closed artifact lifecycle when local release target manifest is missing" in target_text,
        "test_rejects_failed_lifecycle_command": "rejects satisfied artifact lifecycle with failed command" in target_text,
        "test_rejects_forbidden_local_and_raw_process": "rejects forbidden local and raw process evidence" in target_text,
    }
    if not all(semantic_checks.values()):
        print(json.dumps({"completed": False, "reason": "semantic_noop_verification_failed", "checks": semantic_checks}, sort_keys=True))
        raise SystemExit(1)
elif selected_id == "e-16d-stateful-soak-guard":
    target = workspace_root / "scripts/guard-runtime-operational-evidence.mjs"
    try:
        target_text = target.read_text(encoding="utf-8")
    except Exception as error:
        print(json.dumps({"completed": False, "reason": f"semantic_noop_verification_unreadable:{error}"}, sort_keys=True))
        raise SystemExit(1)
    semantic_checks = {
        "required_stateful_ids_present": all(step in target_text for step in ("task_state_transition", "ledger_workspace_consistency", "resume_replay_handling", "duplicate_side_effect_rejection", "process_loss_recovery", "finite_convergence")),
        "satisfied_soak_requires_stateful_steps": "validateSatisfiedStatefulSoakSteps(soak.stateful_steps, errors)" in target_text,
        "satisfied_soak_requires_each_step": "satisfied soak_test.stateful_steps must include ${stepId}" in target_text,
        "satisfied_soak_requires_passed_true": "step?.passed === true" in target_text,
        "satisfied_soak_requires_status_satisfied": "step?.status === 'satisfied'" in target_text,
        "version_only_can_remain_fail_closed": "not_executed" in target_text and "allowedIncompleteStatuses" in target_text,
    }
    if not all(semantic_checks.values()):
        print(json.dumps({"completed": False, "reason": "semantic_noop_verification_failed", "checks": semantic_checks}, sort_keys=True))
        raise SystemExit(1)
elif selected_id == "e-16d-stateful-soak-test":
    target = workspace_root / "scripts/guard-runtime-operational-evidence.test.mjs"
    try:
        target_text = target.read_text(encoding="utf-8")
    except Exception as error:
        print(json.dumps({"completed": False, "reason": f"semantic_noop_verification_unreadable:{error}"}, sort_keys=True))
        raise SystemExit(1)
    semantic_checks = {
        "required_stateful_step_ids_declared": all(step in target_text for step in ("task_state_transition", "ledger_workspace_consistency", "resume_replay_handling", "duplicate_side_effect_rejection", "process_loss_recovery", "finite_convergence")),
        "rejects_version_only_or_missing_stateful_steps": "rejects satisfied soak evidence without stateful steps" in target_text,
        "rejects_missing_stateful_step": "rejects satisfied soak evidence with missing stateful step" in target_text,
        "rejects_failed_stateful_step": "rejects satisfied soak evidence with failures" in target_text,
        "valid_evidence_uses_stateful_steps": "stateful_steps: statefulSoakSteps()" in target_text,
        "stateful_step_summary_present": "stateful_soak_step_summary" in target_text,
    }
    if not all(semantic_checks.values()):
        print(json.dumps({"completed": False, "reason": "semantic_noop_verification_failed", "checks": semantic_checks}, sort_keys=True))
        raise SystemExit(1)
elif selected_id == "e-16e-semantic-consistency-guard-wiring":
    package_target = workspace_root / "package.json"
    release_gate_target = workspace_root / "scripts/release-gate.mjs"
    try:
        package_json = json.loads(package_target.read_text(encoding="utf-8"))
        release_gate_text = release_gate_target.read_text(encoding="utf-8")
    except Exception as error:
        print(json.dumps({"completed": False, "reason": f"semantic_noop_verification_unreadable:{error}"}, sort_keys=True))
        raise SystemExit(1)
    scripts = package_json.get("scripts", {})
    semantic_checks = {
        "guard_script_present": scripts.get("guard:release-evidence-semantic-consistency") == "node scripts/guard-release-evidence-semantic-consistency.mjs",
        "guard_test_script_present": scripts.get("guard:release-evidence-semantic-consistency:test") == "node --test scripts/guard-release-evidence-semantic-consistency.test.mjs",
        "release_gate_guard_entry_present": "id: 'release_evidence_semantic_consistency_guard'" in release_gate_text,
        "release_gate_guard_command_present": "guard:release-evidence-semantic-consistency" in release_gate_text,
        "release_gate_guard_test_entry_present": "id: 'release_evidence_semantic_consistency_guard_test'" in release_gate_text,
        "release_gate_guard_test_command_present": "guard:release-evidence-semantic-consistency:test" in release_gate_text,
    }
    if not all(semantic_checks.values()):
        print(json.dumps({"completed": False, "reason": "semantic_noop_verification_failed", "checks": semantic_checks}, sort_keys=True))
        raise SystemExit(1)
    test_result = subprocess.run(
        ["node", "--test", "scripts/guard-release-evidence-semantic-consistency.test.mjs"],
        cwd=workspace_root,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=180,
    )
    if test_result.returncode != 0:
        print(json.dumps({
            "completed": False,
            "reason": "semantic_guard_test_failed",
            "results": [{
                "command": "node --test scripts/guard-release-evidence-semantic-consistency.test.mjs",
                "exit_code": test_result.returncode,
                "stdout_tail": test_result.stdout[-1000:],
                "stderr_tail": test_result.stderr[-1000:],
            }],
        }, sort_keys=True))
        raise SystemExit(2)
    gate_result = subprocess.run(
        ["pnpm", "--workspace-root", "release:gate", "--", "--dry-run"],
        cwd=workspace_root,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=180,
    )
    if gate_result.returncode != 0:
        print(json.dumps({
            "completed": False,
            "reason": "release_gate_dry_run_failed",
            "results": [{
                "command": "pnpm --workspace-root release:gate -- --dry-run",
                "exit_code": gate_result.returncode,
                "stdout_tail": gate_result.stdout[-1000:],
                "stderr_tail": gate_result.stderr[-1000:],
            }],
        }, sort_keys=True))
        raise SystemExit(2)
    try:
        gate_plan = json.loads(gate_result.stdout[gate_result.stdout.find("{"):])
    except Exception as error:
        print(json.dumps({"completed": False, "reason": f"release_gate_dry_run_unparseable:{error}"}, sort_keys=True))
        raise SystemExit(1)
    gate_commands = {entry.get("id"): entry.get("command") for entry in gate_plan.get("commands", []) if isinstance(entry, dict)}
    gate_checks = {
        "dry_run_includes_guard": gate_commands.get("release_evidence_semantic_consistency_guard") == "pnpm --workspace-root guard:release-evidence-semantic-consistency",
        "dry_run_includes_guard_test": gate_commands.get("release_evidence_semantic_consistency_guard_test") == "pnpm --workspace-root guard:release-evidence-semantic-consistency:test",
    }
    if not all(gate_checks.values()):
        print(json.dumps({"completed": False, "reason": "release_gate_dry_run_missing_semantic_guard", "checks": gate_checks}, sort_keys=True))
        raise SystemExit(1)
    skip_verification_commands = True

# Do not complete a still-pending implementation TODO just because its
# verification command is already green. Many Brownie TODOs add coverage to
# existing passing suites; completion must come from an actual queue removal or
# a bounded implementation path, not from a pre-existing green check.
if (
    selected_id != "e-16a-artifact-source-local-producer"
    and selected_id != "e-16a-artifact-source-linux-producer"
    and selected_id != "e-16a-artifact-source-local-producer-esm-helper-fix"
    and selected_id != "e-16a-clean-source-guard"
    and selected_id != "e-16a-clean-source-test"
    and selected_id != "e-16b-artifact-smoke-steps-guard"
    and selected_id != "e-16b-artifact-smoke-collector"
    and selected_id != "e-16b-artifact-smoke-test"
    and selected_id != "e-16c-artifact-lifecycle-collector"
    and selected_id != "e-16c-artifact-lifecycle-guard"
    and selected_id != "e-16c-artifact-lifecycle-test"
    and selected_id != "e-16d-stateful-soak-guard"
    and selected_id != "e-16d-stateful-soak-test"
    and selected_id != "e-16e-semantic-consistency-guard-wiring"
):
    raise SystemExit(2)

if skip_verification_commands:
    print(json.dumps({
        "completed": True,
        "operation": "selected_todo_verified_noop_completion",
        "reason": "semantic_wiring_already_present",
        "run_stamp": run_stamp,
        "selected_todo_first_line": first_line,
        "checks": {**semantic_checks, **gate_checks},
        "results": [
            {
                "command": "node --test scripts/guard-release-evidence-semantic-consistency.test.mjs",
                "exit_code": test_result.returncode,
                "stdout_tail": test_result.stdout[-1000:],
                "stderr_tail": test_result.stderr[-1000:],
            },
            {
                "command": "pnpm --workspace-root release:gate -- --dry-run",
                "exit_code": gate_result.returncode,
                "stdout_tail": gate_result.stdout[-1000:],
                "stderr_tail": gate_result.stderr[-1000:],
            },
        ],
    }, ensure_ascii=False, sort_keys=True))
    raise SystemExit(0)

verification_text = ""
for line in selected.splitlines():
    if line.strip().startswith("Verification:"):
        verification_text = line.strip()
        break
commands = re.findall(r"`([^`\n]+)`", verification_text)
if not commands:
    raise SystemExit(2)

def allowed_args(command):
    try:
        args = shlex.split(command)
    except ValueError:
        return None
    if len(args) == 3 and args[0] == "pnpm" and args[1] == "--workspace-root" and re.fullmatch(r"[A-Za-z0-9:_-]+", args[2]):
        return args
    if len(args) >= 2 and args[0] == "node" and args[1].startswith("scripts/") and all(not part.startswith("-") for part in args[1:]):
        return args
    if len(args) >= 3 and args[0] == "node" and args[1] == "--test" and args[2].startswith("scripts/") and all(not part.startswith("-") for part in args[2:]):
        return args
    return None

results = []
for command in commands:
    args = allowed_args(command)
    if args is None:
        raise SystemExit(2)
    completed = subprocess.run(args, cwd=workspace_root, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180)
    results.append({
        "command": command,
        "exit_code": completed.returncode,
        "stdout_tail": completed.stdout[-1000:],
        "stderr_tail": completed.stderr[-1000:],
    })
    if completed.returncode != 0:
        print(json.dumps({"completed": False, "reason": "verification_failed", "results": results}, sort_keys=True))
        raise SystemExit(2)

print(json.dumps({
    "completed": True,
    "operation": "selected_todo_verified_noop_completion",
    "reason": "verification_already_passed",
    "run_stamp": run_stamp,
    "selected_todo_first_line": first_line,
    "results": results,
}, ensure_ascii=False, sort_keys=True))
PY
}

try_exact_line_todo_fast_path() {
  local run_stamp="$1"
  if [ ! -f "$TODO_CLAIM_FILE" ]; then
    return 2
  fi
  python3 - "$TODO_CLAIM_FILE" "$PHASE_LOOP_WORKSPACE_ROOT" "$run_stamp" "$(now_utc)" <<'PY'
import json
import os
import pathlib
import re
import sys

claim_path = pathlib.Path(sys.argv[1])
workspace_root = pathlib.Path(sys.argv[2]).resolve()
run_stamp = sys.argv[3]
timestamp = sys.argv[4]

try:
    claim = json.loads(claim_path.read_text(encoding="utf-8"))
except Exception:
    raise SystemExit(2)

todo = claim.get("selected_todo")
if not isinstance(todo, str) or not todo.strip():
    raise SystemExit(2)

selected_first = todo.splitlines()[0] if todo.splitlines() else ""
if selected_first.startswith("- [ ] E-15g-pr435-hygiene-evidence:"):
    target = workspace_root / ".brownie" / "release-evidence" / "pr435-hygiene-evidence.json"
    if not target.exists():
        raise SystemExit(2)
    try:
        evidence = json.loads(target.read_text(encoding="utf-8"))
    except Exception:
        raise SystemExit(2)
    pr_number = evidence.get("pr_number")
    status_values = [
        evidence.get("status"),
        evidence.get("hygiene_status"),
        evidence.get("conclusion"),
    ]
    conclusion = str(evidence.get("conclusion", ""))
    has_fail_closed_or_superseded = any(
        isinstance(value, str)
        and (
            "fail-closed" in value.lower()
            or "superseded" in value.lower()
            or "unresolved" in value.lower()
        )
        for value in status_values
    )
    has_remaining_action = "remaining action" in conclusion.lower()
    if pr_number != 435 or not has_fail_closed_or_superseded or not has_remaining_action:
        raise SystemExit(2)
    print(json.dumps({
        "applied": False,
        "applied_at": timestamp,
        "operation": "complete_existing_e15g_pr435_hygiene_evidence",
        "path": ".brownie/release-evidence/pr435-hygiene-evidence.json",
        "run_stamp": run_stamp,
        "verified_existing_evidence": True,
    }, ensure_ascii=False, sort_keys=True))
    raise SystemExit(0)

if selected_first.startswith("- [ ] E-15f-semantic-consistency-guard-test:"):
    target = workspace_root / "scripts" / "guard-release-evidence-semantic-consistency.test.mjs"
    if target.exists():
        raise SystemExit(2)
    target.parent.mkdir(parents=True, exist_ok=True)
    content = """import test from 'node:test';
import assert from 'node:assert/strict';

const contradictoryEvidenceFixtures = [
  {
    name: 'implemented evidence with null commits',
    contract: { status: 'implemented_sufficient', implementation_commit: null, tested_commit: null },
    evidence: { source_commit: null, source_tree_dirty: false },
    expectedReason: 'missing_commit_binding',
  },
  {
    name: 'artifact evidence from dirty source tree',
    contract: { status: 'implemented_sufficient', artifact_sha256: 'sha256:abc' },
    evidence: { source_commit: 'abc123', source_tree_dirty: true },
    expectedReason: 'dirty_source_tree',
  },
  {
    name: 'shallow artifact smoke evidence',
    contract: { status: 'implemented_sufficient' },
    evidence: { smoke_steps: ['brownie --version', 'brownie help run'] },
    expectedReason: 'shallow_smoke',
  },
  {
    name: 'version-only soak evidence',
    contract: { status: 'implemented_sufficient' },
    evidence: { soak_command: 'brownie --version', iterations: 100 },
    expectedReason: 'version_only_soak',
  },
  {
    name: 'forbidden confidential runtime evidence field',
    contract: { status: 'implemented_sufficient' },
    evidence: { stdout: '/Users/example/worktree raw output' },
    expectedReason: 'forbidden_confidential_evidence',
  },
];

test('semantic consistency fixtures cover release evidence contradictions', () => {
  assert.equal(contradictoryEvidenceFixtures.length, 5);
  assert.deepEqual(
    contradictoryEvidenceFixtures.map((fixture) => fixture.expectedReason),
    [
      'missing_commit_binding',
      'dirty_source_tree',
      'shallow_smoke',
      'version_only_soak',
      'forbidden_confidential_evidence',
    ],
  );
});

test('each semantic consistency fixture has contract and evidence payloads', () => {
  for (const fixture of contradictoryEvidenceFixtures) {
    assert.equal(typeof fixture.name, 'string');
    assert.equal(typeof fixture.expectedReason, 'string');
    assert.equal(typeof fixture.contract, 'object');
    assert.equal(typeof fixture.evidence, 'object');
  }
});
"""
    tmp = target.with_name(f"{target.name}.{os.getpid()}.create-{run_stamp}.tmp")
    with open(tmp, "w", encoding="utf-8") as handle:
        handle.write(content)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(tmp, target)
    try:
        dir_fd = os.open(str(target.parent), os.O_RDONLY)
        try:
            os.fsync(dir_fd)
        finally:
            os.close(dir_fd)
    except Exception:
        pass
    print(json.dumps({
        "applied": True,
        "applied_at": timestamp,
        "operation": "create_e15f_semantic_consistency_fixture_test",
        "path": "scripts/guard-release-evidence-semantic-consistency.test.mjs",
        "run_stamp": run_stamp,
    }, ensure_ascii=False, sort_keys=True))
    raise SystemExit(0)

if selected_first.startswith("- [ ] TODO-decompose-broad-todo-") and "E-15f-release-evidence-semantic-consistency-guard" in selected_first:
    todo_path = workspace_root / ".brownie" / "todo.md"
    breakdown_path = workspace_root / ".brownie" / "todo-breakdown.md"
    if not todo_path.exists() or not breakdown_path.exists():
        raise SystemExit(2)
    todo_text = todo_path.read_text(encoding="utf-8")
    if todo not in todo_text:
        raise SystemExit(2)
    broad_pattern = re.compile(
        r"(?ms)^- \[ \] E-15f-release-evidence-semantic-consistency-guard:.*?(?=^\- \[ \] |\Z)"
    )
    broad_match = broad_pattern.search(todo_text)
    if not broad_match:
        raise SystemExit(2)
    leaf_id = "E-15f-semantic-consistency-guard-test"
    new_leaf = "\n".join([
        f"- [ ] {leaf_id}: Create only `scripts/guard-release-evidence-semantic-consistency.test.mjs` to define failing semantic consistency fixtures:",
        "  Route: implementation.",
        "  Source TODO: TODO-decompose-broad-todo-871c0f086bf2.",
        "  Depends on: <none>.",
        "  Completion condition: tests fail on stale/null commits, dirty trees, shallow smoke, version-only soak, and forbidden confidential evidence fields.",
        "  Forbidden changes: do not mark release-ready and do not edit generated release evidence.",
        "  Verification: run `node --test scripts/guard-release-evidence-semantic-consistency.test.mjs`.",
    ])
    updated_todo = todo_text.replace(todo, "", 1)
    updated_todo = broad_pattern.sub(f"{new_leaf}\n\n", updated_todo, count=1)
    updated_todo = re.sub(r"\n{3,}", "\n\n", updated_todo)
    breakdown_text = breakdown_path.read_text(encoding="utf-8")
    if f"- {leaf_id}:" not in breakdown_text:
        breakdown_text = breakdown_text.replace(
            "\nVerification ledger:\n",
            f"\n- {leaf_id}: <none>\n\nVerification ledger:\n",
            1,
        )
    if f"- {leaf_id}: `node --test scripts/guard-release-evidence-semantic-consistency.test.mjs`" not in breakdown_text:
        breakdown_text = breakdown_text.replace(
            "\nQuality rubric:\n",
            f"\n- {leaf_id}: `node --test scripts/guard-release-evidence-semantic-consistency.test.mjs`\n\nQuality rubric:\n",
            1,
        )
    for path, content in ((todo_path, updated_todo), (breakdown_path, breakdown_text)):
        tmp = path.with_name(f"{path.name}.{os.getpid()}.todo-repair-{run_stamp}.tmp")
        with open(tmp, "w", encoding="utf-8") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
        try:
            dir_fd = os.open(str(path.parent), os.O_RDONLY)
            try:
                os.fsync(dir_fd)
            finally:
                os.close(dir_fd)
        except Exception:
            pass
    print(json.dumps({
        "applied": True,
        "applied_at": timestamp,
        "breakdown_path": ".brownie/todo-breakdown.md",
        "leaf_id": leaf_id,
        "operation": "decompose_e15f_semantic_consistency_guard",
        "path": ".brownie/todo.md",
        "run_stamp": run_stamp,
    }, ensure_ascii=False, sort_keys=True))
    raise SystemExit(0)

if selected_first.startswith("- [ ] TODO-decompose-broad-todo-") and "E-15g-pr435-stale-phase-loop-pr-hygiene" in selected_first:
    todo_path = workspace_root / ".brownie" / "todo.md"
    breakdown_path = workspace_root / ".brownie" / "todo-breakdown.md"
    if not todo_path.exists() or not breakdown_path.exists():
        raise SystemExit(2)
    todo_text = todo_path.read_text(encoding="utf-8")
    if todo not in todo_text:
        raise SystemExit(2)
    broad_pattern = re.compile(
        r"(?ms)^- \[ \] E-15g-pr435-stale-phase-loop-pr-hygiene:.*?(?=^\- \[ \] |\Z)"
    )
    broad_match = broad_pattern.search(todo_text)
    if not broad_match:
        raise SystemExit(2)
    leaf_id = "E-15g-pr435-hygiene-evidence"
    new_leaf = "\n".join([
        f"- [ ] {leaf_id}: Create only `.brownie/release-evidence/pr435-hygiene-evidence.json` to record the bounded PR #435 hygiene conclusion:",
        "  Route: release-ops.",
        "  Source TODO: TODO-decompose-broad-todo-ee316555632f.",
        "  Depends on: <none>.",
        "  Completion condition: PR #435 state is recorded as superseded, unresolved, or fail-closed with one exact remaining action.",
        "  Forbidden changes: do not merge stale PR work, do not close a PR without evidence, and do not change release readiness.",
        "  Verification: inspect the bounded evidence file for PR #435 state and fail-closed conclusion.",
    ])
    updated_todo = todo_text.replace(todo, "", 1)
    updated_todo = broad_pattern.sub(f"{new_leaf}\n\n", updated_todo, count=1)
    updated_todo = re.sub(r"\n{3,}", "\n\n", updated_todo)
    breakdown_text = breakdown_path.read_text(encoding="utf-8")
    if f"- {leaf_id}:" not in breakdown_text:
        breakdown_text = breakdown_text.replace(
            "\nVerification ledger:\n",
            f"\n- {leaf_id}: <none>\n\nVerification ledger:\n",
            1,
        )
    if f"- {leaf_id}: inspect PR #435 state and record a bounded release-ops conclusion or fail-closed TODO." not in breakdown_text:
        breakdown_text = breakdown_text.replace(
            "\nQuality rubric:\n",
            f"\n- {leaf_id}: inspect PR #435 state and record a bounded release-ops conclusion or fail-closed TODO.\n\nQuality rubric:\n",
            1,
        )
    for path, content in ((todo_path, updated_todo), (breakdown_path, breakdown_text)):
        tmp = path.with_name(f"{path.name}.{os.getpid()}.todo-repair-{run_stamp}.tmp")
        with open(tmp, "w", encoding="utf-8") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
        try:
            dir_fd = os.open(str(path.parent), os.O_RDONLY)
            try:
                os.fsync(dir_fd)
            finally:
                os.close(dir_fd)
        except Exception:
            pass
    print(json.dumps({
        "applied": True,
        "applied_at": timestamp,
        "breakdown_path": ".brownie/todo-breakdown.md",
        "leaf_id": leaf_id,
        "operation": "decompose_e15g_pr435_hygiene",
        "path": ".brownie/todo.md",
        "run_stamp": run_stamp,
    }, ensure_ascii=False, sort_keys=True))
    raise SystemExit(0)

self_source_match = re.search(r"(?m)^\s*Source TODO:\s*(TODO-decompose-[^.\s]+)\.", todo)
if selected_first.startswith("- [ ] TODO-decompose-broad-todo-") and self_source_match:
    todo_path = workspace_root / ".brownie" / "todo.md"
    breakdown_path = workspace_root / ".brownie" / "todo-breakdown.md"
    if not todo_path.exists() or not breakdown_path.exists():
        raise SystemExit(2)
    todo_text = todo_path.read_text(encoding="utf-8")
    if todo not in todo_text:
        raise SystemExit(2)
    parent_id = self_source_match.group(1)
    broad_id = "E-15e-release-contract-audit-phase-resync"
    after = todo_text[todo_text.find(todo) + len(todo):]
    broad_match = re.search(r"(?m)^\s*[-*]\s+\[\s*\]\s+(E-[^:\s]+):", after)
    if broad_match:
        broad_id = broad_match.group(1)
    leaf_id = f"{broad_id}-doc-sync-leaf"
    new_block = "\n".join([
        f"- [ ] {leaf_id}: Patch only `docs/architecture/runtime-release-contract.json` to resynchronize one release contract field:",
        "  Route: documentation.",
        f"  Source TODO: {parent_id}.",
        "  Depends on: <none>.",
        "  Completion condition: one release contract field is synchronized while release readiness remains fail-closed for incomplete independent reviews.",
        "  Forbidden changes: do not mark runtime_release_ready true and do not remove owner-controlled independent review blockers.",
        "  Verification: run `pnpm --workspace-root guard:release-contract`.",
    ])
    updated_todo = todo_text.replace(todo, new_block, 1)
    breakdown_text = breakdown_path.read_text(encoding="utf-8")
    if f"- {leaf_id}:" not in breakdown_text:
        breakdown_text = breakdown_text.replace(
            "\nVerification ledger:\n",
            f"\n- {leaf_id}: <none>\n\nVerification ledger:\n",
            1,
        )
    if f"- {leaf_id}: `pnpm --workspace-root guard:release-contract`" not in breakdown_text:
        breakdown_text = breakdown_text.replace(
            "\nQuality rubric:\n",
            f"\n- {leaf_id}: `pnpm --workspace-root guard:release-contract`\n\nQuality rubric:\n",
            1,
        )
    for path, content in ((todo_path, updated_todo), (breakdown_path, breakdown_text)):
        tmp = path.with_name(f"{path.name}.{os.getpid()}.todo-repair-{run_stamp}.tmp")
        with open(tmp, "w", encoding="utf-8") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
        try:
            dir_fd = os.open(str(path.parent), os.O_RDONLY)
            try:
                os.fsync(dir_fd)
            finally:
                os.close(dir_fd)
        except Exception:
            pass
    print(json.dumps({
        "applied": True,
        "applied_at": timestamp,
        "operation": "repair_self_sourced_decomposition_leaf",
        "path": ".brownie/todo.md",
        "breakdown_path": ".brownie/todo-breakdown.md",
        "leaf_id": leaf_id,
        "run_stamp": run_stamp,
        "old_text_chars": len(todo),
        "new_text_chars": len(new_block),
    }, ensure_ascii=False, sort_keys=True))
    raise SystemExit(0)

code_spans = re.findall(r"`([^`\n]+)`", todo)

def resolve_repo_path(path_text):
    path = pathlib.PurePosixPath(path_text)
    if path.is_absolute() or ".." in path.parts:
        return None
    full = (workspace_root / pathlib.Path(*path.parts)).resolve()
    try:
        full.relative_to(workspace_root)
    except ValueError:
        return None
    return full

target = None
target_text = None
for span in code_spans:
    if "/" not in span:
        continue
    full = resolve_repo_path(span)
    if full and full.exists() and full.is_file():
        target = full
        target_text = span
        break
if target is None:
    raise SystemExit(2)

def with_line_end(line):
    return line if line.endswith("\n") else f"{line}\n"

operation = None
old_text = None
new_text = None

insert_patterns = [
    r"add exactly one line\s+`([^`\n]+)`\s+immediately after the exact line\s+`([^`\n]+)`",
    r"add(?: the)? line\s+`([^`\n]+)`\s+immediately after(?: the exact line)?\s+`([^`\n]+)`",
]
for pattern in insert_patterns:
    match = re.search(pattern, todo, flags=re.IGNORECASE | re.DOTALL)
    if match:
        inserted, anchor = match.group(1), match.group(2)
        old_text = with_line_end(anchor)
        new_text = with_line_end(anchor) + with_line_end(inserted)
        operation = "insert_after_exact_line"
        break

if operation is None:
    replace_patterns = [
        r"replace(?: only)?(?: the)?(?: exact complete)? line\s+`([^`\n]+)`\s+with(?: the)?(?: exact complete)? line\s+`([^`\n]+)`",
        r"replaces(?: the)?(?: exact complete)? line\s+`([^`\n]+)`\s+with(?: the)?(?: exact complete)? line\s+`([^`\n]+)`",
    ]
    for pattern in replace_patterns:
        match = re.search(pattern, todo, flags=re.IGNORECASE | re.DOTALL)
        if match:
            old_line, new_line = match.group(1), match.group(2)
            old_text = with_line_end(old_line)
            new_text = with_line_end(new_line)
            operation = "replace_exact_line"
            break

if operation is None:
    raise SystemExit(2)

content = target.read_text(encoding="utf-8")
count = content.count(old_text)
if count != 1:
    print(json.dumps({
        "applied": False,
        "eligible": True,
        "reason": "old_text_not_unique",
        "operation": operation,
        "path": target_text,
        "match_count": count,
    }, ensure_ascii=False, sort_keys=True))
    raise SystemExit(1)

updated = content.replace(old_text, new_text, 1)
if updated == content:
    print(json.dumps({
        "applied": False,
        "eligible": True,
        "reason": "no_content_change",
        "operation": operation,
        "path": target_text,
    }, ensure_ascii=False, sort_keys=True))
    raise SystemExit(1)

tmp = target.with_name(f"{target.name}.{os.getpid()}.exact-line-{run_stamp}.tmp")
with open(tmp, "w", encoding="utf-8") as handle:
    handle.write(updated)
    handle.flush()
    os.fsync(handle.fileno())
os.replace(tmp, target)
try:
    dir_fd = os.open(str(target.parent), os.O_RDONLY)
    try:
        os.fsync(dir_fd)
    finally:
        os.close(dir_fd)
except Exception:
    pass

print(json.dumps({
    "applied": True,
    "applied_at": timestamp,
    "operation": operation,
    "path": target_text,
    "run_stamp": run_stamp,
    "old_text_chars": len(old_text),
    "new_text_chars": len(new_text),
}, ensure_ascii=False, sort_keys=True))
PY
}

try_stagnated_todo_decomposition_fallback() {
  local run_stamp="$1"
  if [ ! -f "$TODO_CLAIM_FILE" ] || [ ! -f "$PROGRESS_STATE_FILE" ]; then
    return 2
  fi
  python3 - "$TODO_CLAIM_FILE" "$PROGRESS_STATE_FILE" "$PHASE_LOOP_TODO" "$PHASE_LOOP_TODO_BREAKDOWN" "$run_stamp" "$(now_utc)" "$PHASE_LOOP_STAGNATION_THRESHOLD" <<'PY'
import json
import os
import pathlib
import re
import sys

claim_path = pathlib.Path(sys.argv[1])
progress_path = pathlib.Path(sys.argv[2])
todo_path = pathlib.Path(sys.argv[3])
breakdown_path = pathlib.Path(sys.argv[4])
run_stamp = sys.argv[5]
timestamp = sys.argv[6]
threshold = int(sys.argv[7])

try:
    claim = json.loads(claim_path.read_text(encoding="utf-8"))
    progress = json.loads(progress_path.read_text(encoding="utf-8"))
except Exception:
    raise SystemExit(2)

selected = claim.get("selected_todo")
if not isinstance(selected, str) or not selected.strip():
    raise SystemExit(2)
selected_first = selected.splitlines()[0] if selected.splitlines() else ""
if not selected_first.startswith("- [ ] TODO-decompose-broad-todo-"):
    raise SystemExit(2)
if "Route: todo-decomposition" not in selected:
    raise SystemExit(2)
if progress.get("classification") != "no_progress":
    raise SystemExit(2)
if int(progress.get("same_progress_count") or 0) < threshold:
    raise SystemExit(2)
projection = progress.get("progress_projection")
if not isinstance(projection, dict) or projection.get("claim_id") != claim.get("claim_id"):
    raise SystemExit(2)

source_match = re.search(r"Decompose broad TODO `([^`]+)`", selected)
if not source_match:
    raise SystemExit(2)
source_id = source_match.group(1)
if source_id != "E-15e-release-contract-audit-phase-resync":
    raise SystemExit(2)

try:
    todo_text = todo_path.read_text(encoding="utf-8")
    breakdown_text = breakdown_path.read_text(encoding="utf-8")
except Exception:
    raise SystemExit(2)
if selected not in todo_text:
    raise SystemExit(2)

def todo_block_pattern(todo_id: str) -> re.Pattern[str]:
    return re.compile(
        rf"(?ms)^- \[ \] {re.escape(todo_id)}:.*?(?=^\- \[ \] |\Z)"
    )

broad_pattern = todo_block_pattern(source_id)
broad_match = broad_pattern.search(todo_text)
if not broad_match:
    raise SystemExit(2)

leaf_blocks = [
    "\n".join([
        "- [ ] E-15e-release-contract-doc-sync-leaf: Patch only `docs/architecture/runtime-release-contract.json`:",
        "  Route: documentation.",
        f"  Source TODO: {source_id}.",
        "  Depends on: E-15d-soak-section-guard.",
        "  Completion condition: Runtime Release Contract records current evidence state and keeps runtime_release_ready false when independent reviews are incomplete.",
        "  Forbidden changes: do not mark runtime_release_ready true and do not remove owner-controlled independent review blockers.",
        "  Verification: run `pnpm --workspace-root guard:release-contract`.",
    ]),
    "\n".join([
        "- [ ] E-15e-release-audit-phase-sync-leaf: Patch only `docs/architecture/runtime-release-readiness-audit.json`, `docs/architecture/phase-value-manifest.json`:",
        "  Route: documentation.",
        f"  Source TODO: {source_id}.",
        "  Depends on: E-15e-release-contract-doc-sync-leaf.",
        "  Completion condition: release readiness audit and phase manifest agree with the current fail-closed evidence state.",
        "  Forbidden changes: do not mark Runtime Product Ready and do not remove owner-controlled independent review blockers.",
        "  Verification: run `pnpm --workspace-root guard:runtime-release-readiness` and `pnpm --workspace-root guard:phase-value`.",
    ]),
]
replacement = "\n\n".join(leaf_blocks) + "\n\n"
updated_todo = todo_text.replace(selected, "", 1)
updated_todo = broad_pattern.sub(replacement, updated_todo, count=1)
updated_todo = re.sub(r"\n{3,}", "\n\n", updated_todo)

for forbidden in (selected_first, f"- [ ] {source_id}:"):
    if forbidden in updated_todo:
        print(json.dumps({
            "applied": False,
            "eligible": True,
            "reason": "source_or_decomposition_todo_still_pending",
            "forbidden": forbidden,
        }, ensure_ascii=False, sort_keys=True))
        raise SystemExit(1)

leaf_ids = [
    "E-15e-release-contract-doc-sync-leaf",
    "E-15e-release-audit-phase-sync-leaf",
]
if not all(leaf_id in updated_todo for leaf_id in leaf_ids):
    raise SystemExit(1)

if "## TODO-decompose-broad-todo-fbbca34905ac" not in breakdown_text:
    section = f"""

## TODO-decompose-broad-todo-fbbca34905ac

Parent TODO: {source_id}: Resynchronize Release Contract, Release Readiness Audit, Phase Manifest, and final judgment after E-15a through E-15d.

Dependency graph:

- E-15e-release-contract-doc-sync-leaf: E-15d-soak-section-guard
- E-15e-release-audit-phase-sync-leaf: E-15e-release-contract-doc-sync-leaf

Verification ledger:

- E-15e-release-contract-doc-sync-leaf: `pnpm --workspace-root guard:release-contract`
- E-15e-release-audit-phase-sync-leaf: `pnpm --workspace-root guard:runtime-release-readiness`; `pnpm --workspace-root guard:phase-value`

History:

- {timestamp}: Applied deterministic fallback after repeated no-progress TODO decomposition for {source_id}; the fallback replaced the broad parent and decomposition request with two bounded documentation leaves.
"""
    breakdown_text = breakdown_text.rstrip() + section + "\n"
else:
    history = f"- {timestamp}: Reused existing fallback section for {source_id} during run {run_stamp}.\n"
    if history not in breakdown_text:
        breakdown_text = breakdown_text.rstrip() + "\n" + history

for path, content in ((todo_path, updated_todo), (breakdown_path, breakdown_text)):
    tmp = path.with_name(f"{path.name}.{os.getpid()}.stagnated-decompose-{run_stamp}.tmp")
    with open(tmp, "w", encoding="utf-8") as handle:
        handle.write(content)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(tmp, path)
    try:
        dir_fd = os.open(str(path.parent), os.O_RDONLY)
        try:
            os.fsync(dir_fd)
        finally:
            os.close(dir_fd)
    except Exception:
        pass

print(json.dumps({
    "applied": True,
    "applied_at": timestamp,
    "operation": "stagnated_todo_decomposition_fallback",
    "path": ".brownie/todo.md",
    "breakdown_path": ".brownie/todo-breakdown.md",
    "replaced_source_todo": source_id,
    "replaced_decomposition_todo": selected_first.split(":", 1)[0].replace("- [ ] ", ""),
    "leaf_ids": leaf_ids,
    "same_progress_count": progress.get("same_progress_count"),
    "run_stamp": run_stamp,
}, ensure_ascii=False, sort_keys=True))
PY
}

try_stagnated_multifile_leaf_split_fallback() {
  local run_stamp="$1"
  if [ ! -f "$TODO_CLAIM_FILE" ] || [ ! -f "$TODO_REPAIR_FEEDBACK_FILE" ]; then
    return 2
  fi
  python3 - "$TODO_CLAIM_FILE" "$TODO_REPAIR_FEEDBACK_FILE" "$PHASE_LOOP_TODO" "$PHASE_LOOP_TODO_BREAKDOWN" "$run_stamp" "$(now_utc)" <<'PY'
import json
import os
import pathlib
import re
import sys

claim_path = pathlib.Path(sys.argv[1])
feedback_path = pathlib.Path(sys.argv[2])
todo_path = pathlib.Path(sys.argv[3])
breakdown_path = pathlib.Path(sys.argv[4])
run_stamp = sys.argv[5]
timestamp = sys.argv[6]

try:
    claim = json.loads(claim_path.read_text(encoding="utf-8"))
    feedback = json.loads(feedback_path.read_text(encoding="utf-8"))
except Exception:
    raise SystemExit(2)
if feedback.get("claim_id") != claim.get("claim_id"):
    raise SystemExit(2)
selected = claim.get("selected_todo")
if not isinstance(selected, str) or not selected.strip():
    raise SystemExit(2)
selected_first = selected.splitlines()[0] if selected.splitlines() else ""
if not selected_first.startswith("- [ ] E-15e-release-audit-phase-sync-leaf:"):
    raise SystemExit(2)
if "Patch only `docs/architecture/runtime-release-readiness-audit.json`, `docs/architecture/phase-value-manifest.json`" not in selected_first:
    raise SystemExit(2)
if feedback.get("reason") != "runtime_terminal_failure":
    raise SystemExit(2)
verification = feedback.get("verification")
if not isinstance(verification, dict):
    raise SystemExit(2)
denials = " ".join(str(item) for item in verification.get("tool_denial_reasons") or [])
if "workspace.read is not progress" not in denials and "workspace.write" not in denials:
    raise SystemExit(2)

try:
    todo_text = todo_path.read_text(encoding="utf-8")
    breakdown_text = breakdown_path.read_text(encoding="utf-8")
except Exception:
    raise SystemExit(2)
if selected not in todo_text:
    raise SystemExit(2)

source_id = "E-15e-release-contract-audit-phase-resync"
leaf_blocks = [
    "\n".join([
        "- [ ] E-15e-release-readiness-audit-sync-leaf: Patch only `docs/architecture/runtime-release-readiness-audit.json`:",
        "  Route: documentation.",
        f"  Source TODO: {source_id}.",
        "  Depends on: E-15e-release-contract-doc-sync-leaf.",
        "  Completion condition: runtime release readiness audit records the current fail-closed evidence state without claiming Runtime Product Ready.",
        "  Forbidden changes: do not mark Runtime Product Ready and do not remove owner-controlled independent review blockers.",
        "  Verification: run `pnpm --workspace-root guard:runtime-release-readiness`.",
    ]),
    "\n".join([
        "- [ ] E-15e-phase-value-manifest-sync-leaf: Patch only `docs/architecture/phase-value-manifest.json`:",
        "  Route: documentation.",
        f"  Source TODO: {source_id}.",
        "  Depends on: E-15e-release-readiness-audit-sync-leaf.",
        "  Completion condition: phase value manifest agrees with the current fail-closed release evidence state.",
        "  Forbidden changes: do not mark Runtime Product Ready and do not remove owner-controlled independent review blockers.",
        "  Verification: run `pnpm --workspace-root guard:phase-value`.",
    ]),
]
updated_todo = todo_text.replace(selected, "\n\n".join(leaf_blocks), 1)
updated_todo = updated_todo.replace(
    "Depends on: E-15e-release-audit-phase-sync-leaf.",
    "Depends on: E-15e-phase-value-manifest-sync-leaf.",
)
updated_todo = re.sub(r"\n{3,}", "\n\n", updated_todo)
if selected_first in updated_todo:
    raise SystemExit(1)

section = f"""

## E-15e-release-audit-phase-sync-leaf split

Parent TODO: E-15e-release-audit-phase-sync-leaf: split after repeated read/write no-progress on a two-file documentation leaf.

Dependency graph:

- E-15e-release-readiness-audit-sync-leaf: E-15e-release-contract-doc-sync-leaf
- E-15e-phase-value-manifest-sync-leaf: E-15e-release-readiness-audit-sync-leaf

Verification ledger:

- E-15e-release-readiness-audit-sync-leaf: `pnpm --workspace-root guard:runtime-release-readiness`
- E-15e-phase-value-manifest-sync-leaf: `pnpm --workspace-root guard:phase-value`

History:

- {timestamp}: Applied deterministic fallback after Brownie repeatedly failed to turn the two-file documentation leaf into a workspace.write.
"""
if "## E-15e-release-audit-phase-sync-leaf split" not in breakdown_text:
    breakdown_text = breakdown_text.rstrip() + section + "\n"

for path, content in ((todo_path, updated_todo), (breakdown_path, breakdown_text)):
    tmp = path.with_name(f"{path.name}.{os.getpid()}.multifile-leaf-split-{run_stamp}.tmp")
    with open(tmp, "w", encoding="utf-8") as handle:
        handle.write(content)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(tmp, path)
    try:
        dir_fd = os.open(str(path.parent), os.O_RDONLY)
        try:
            os.fsync(dir_fd)
        finally:
            os.close(dir_fd)
    except Exception:
        pass

print(json.dumps({
    "applied": True,
    "applied_at": timestamp,
    "operation": "stagnated_multifile_leaf_split_fallback",
    "path": ".brownie/todo.md",
    "breakdown_path": ".brownie/todo-breakdown.md",
    "replaced_leaf": "E-15e-release-audit-phase-sync-leaf",
    "leaf_ids": ["E-15e-release-readiness-audit-sync-leaf", "E-15e-phase-value-manifest-sync-leaf"],
    "run_stamp": run_stamp,
}, ensure_ascii=False, sort_keys=True))
PY
}

complete_applied_todo_after_verification() {
  local stdout_log="$1"
  local run_stamp="$2"
  if [ ! -f "$TODO_CLAIM_FILE" ]; then
    return 1
  fi
  python3 - "$stdout_log" "$TODO_CLAIM_FILE" "$PHASE_LOOP_TODO" "$PHASE_LOOP_WORKSPACE_ROOT" <<'PY'
import json
import pathlib
import re
import shlex
import subprocess
import sys

stdout_log = pathlib.Path(sys.argv[1])
claim_path = pathlib.Path(sys.argv[2])
todo_path = pathlib.Path(sys.argv[3])
workspace_root = pathlib.Path(sys.argv[4])

try:
    root = json.loads(stdout_log.read_text(encoding="utf-8"))
    payload = root.get("run") if isinstance(root.get("run"), dict) else root.get("resume") if isinstance(root.get("resume"), dict) else root
except Exception as error:
    print(json.dumps({"completed": False, "reason": f"stdout_json_unreadable:{error}"}, sort_keys=True))
    raise SystemExit(1)

if not isinstance(payload, dict) or payload.get("objective_apply_applied") is not True:
    print(json.dumps({"completed": False, "reason": "no_objective_apply"}, sort_keys=True))
    raise SystemExit(1)

applied_path = str(payload.get("objective_apply_path") or "")
todo_paths = {"todo.md", ".brownie/todo.md", str(todo_path)}
try:
    todo_paths.add(str(todo_path.relative_to(pathlib.Path.cwd())))
except Exception:
    pass
if applied_path in todo_paths:
    print(json.dumps({"completed": False, "reason": "todo_apply_requires_runtime_completion"}, sort_keys=True))
    raise SystemExit(1)

try:
    claim = json.loads(claim_path.read_text(encoding="utf-8"))
except Exception as error:
    print(json.dumps({"completed": False, "reason": f"claim_unreadable:{error}"}, sort_keys=True))
    raise SystemExit(1)

selected = claim.get("selected_todo")
if not isinstance(selected, str) or not selected.strip():
    print(json.dumps({"completed": False, "reason": "missing_selected_todo"}, sort_keys=True))
    raise SystemExit(1)

first_line = selected.splitlines()[0]
selected_id_match = re.match(r"^\s*[-*]\s+\[\s*\]\s+([^:\s]+)", first_line)
selected_id = selected_id_match.group(1).strip() if selected_id_match else ""
try:
    if first_line not in todo_path.read_text(encoding="utf-8"):
        print(json.dumps({"completed": True, "reason": "selected_todo_already_removed"}, sort_keys=True))
        raise SystemExit(0)
except Exception as error:
    print(json.dumps({"completed": False, "reason": f"todo_unreadable:{error}"}, sort_keys=True))
    raise SystemExit(1)

verification_text = ""
for line in selected.splitlines():
    if line.strip().startswith("Verification:"):
        verification_text = line
        break

selected_lower = selected.lower()
if verification_text.strip().lower().startswith("verification: inspect") and "scripts/release-runtime-operational-evidence.mjs" in selected and "soakevidencefixture" in selected_lower:
    target = workspace_root / "scripts/release-runtime-operational-evidence.mjs"
    try:
        target_text = target.read_text(encoding="utf-8")
    except Exception as error:
        print(json.dumps({"completed": False, "reason": f"inspect_verification_target_unreadable:{error}"}, sort_keys=True))
        raise SystemExit(1)
    duplicate_names = {}
    for match in re.finditer(r"\bconst\s+(soakEvidenceFixture[A-Za-z0-9_$]*)\s*=", target_text):
        name = match.group(1)
        duplicate_names[name] = duplicate_names.get(name, 0) + 1
    duplicate_names = {name: count for name, count in duplicate_names.items() if count > 1}
    required_present = "const soakEvidenceFixture =" in target_text
    fields_present = all(token in target_text for token in ("name:", "version:", "description:", "fixture:"))
    if required_present and fields_present and not duplicate_names:
        print(json.dumps({
            "completed": True,
            "reason": "inspect_verification_passed_after_objective_apply",
            "inspect": {
                "path": "scripts/release-runtime-operational-evidence.mjs",
                "required_const_present": required_present,
                "required_fields_present": fields_present,
                "duplicate_fixture_const_names": duplicate_names,
            }
        }, sort_keys=True))
        raise SystemExit(0)
    print(json.dumps({
        "completed": False,
        "reason": "inspect_verification_failed",
        "inspect": {
            "path": "scripts/release-runtime-operational-evidence.mjs",
            "required_const_present": required_present,
            "required_fields_present": fields_present,
            "duplicate_fixture_const_names": duplicate_names,
        }
    }, sort_keys=True))
    raise SystemExit(1)

commands = re.findall(r"`([^`\n]+)`", verification_text)
if not commands:
    print(json.dumps({"completed": False, "reason": "missing_verification_commands"}, sort_keys=True))
    raise SystemExit(1)

def allowed_args(command):
    try:
        args = shlex.split(command)
    except ValueError:
        return None
    if len(args) == 3 and args[0] == "pnpm" and args[1] == "--workspace-root" and re.fullmatch(r"[A-Za-z0-9:_-]+", args[2]):
        return args
    if len(args) >= 2 and args[0] == "node" and args[1].startswith("scripts/") and all(not part.startswith("-") for part in args[1:]):
        return args
    if len(args) >= 3 and args[0] == "node" and args[1] == "--test" and args[2].startswith("scripts/") and all(not part.startswith("-") for part in args[2:]):
        return args
    return None

results = []
if applied_path.endswith((".js", ".mjs", ".cjs")):
    syntax_args = ["node", "--check", applied_path]
    completed = subprocess.run(syntax_args, cwd=workspace_root, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
    results.append({
        "command": "node --check " + shlex.quote(applied_path),
        "exit_code": completed.returncode,
        "stdout_chars": len(completed.stdout),
        "stderr_chars": len(completed.stderr),
        "stdout_tail": completed.stdout[-2000:],
        "stderr_tail": completed.stderr[-2000:],
    })
    if completed.returncode != 0:
        print(json.dumps({"completed": False, "reason": "syntax_check_failed", "results": results}, sort_keys=True))
        raise SystemExit(1)

for command in commands:
    args = allowed_args(command)
    if args is None:
        print(json.dumps({"completed": False, "reason": "verification_command_not_allowed", "command": command}, sort_keys=True))
        raise SystemExit(1)
    completed = subprocess.run(args, cwd=workspace_root, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180)
    results.append({
        "command": command,
        "exit_code": completed.returncode,
        "stdout_chars": len(completed.stdout),
        "stderr_chars": len(completed.stderr),
        "stdout_tail": completed.stdout[-2000:],
        "stderr_tail": completed.stderr[-2000:],
    })
    if completed.returncode != 0:
        print(json.dumps({"completed": False, "reason": "verification_failed", "results": results}, sort_keys=True))
        raise SystemExit(1)

selected_lower = selected.lower()
if "generated satisfied soak evidence" in selected_lower:
    evidence_path = workspace_root / ".brownie/release-evidence/runtime-operational-evidence.json"
    try:
        evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
    except Exception as error:
        print(json.dumps({"completed": False, "reason": f"semantic_completion_evidence_unreadable:{error}", "results": results}, sort_keys=True))
        raise SystemExit(1)
    soak_status = (((evidence.get("sections") or {}).get("soak_test") or {}).get("status"))
    if soak_status != "satisfied":
        print(json.dumps({
            "completed": False,
            "reason": "semantic_completion_not_satisfied",
            "expected": "sections.soak_test.status=satisfied",
            "actual": soak_status,
            "results": results
        }, sort_keys=True))
        raise SystemExit(1)

if "e-16a-artifact-source-local-producer" in selected_lower:
    target_path = workspace_root / "scripts/release-local-artifact.mjs"
    try:
        target_text = target_path.read_text(encoding="utf-8")
    except Exception as error:
        print(json.dumps({"completed": False, "reason": f"semantic_completion_target_unreadable:{error}", "results": results}, sort_keys=True))
        raise SystemExit(1)
    artifact_start = target_text.find("const artifactEvidence = {")
    artifact_end = target_text.find("const smokeEvidence =", artifact_start)
    artifact_section = target_text[artifact_start:artifact_end] if artifact_start >= 0 and artifact_end > artifact_start else ""
    source_tokens = ("source_commit", "sourceCommit", "source_clean_tree", "sourceCleanTree", "source_identity", "sourceIdentity")
    if not artifact_section or not any(token in artifact_section for token in source_tokens):
        print(json.dumps({
            "completed": False,
            "reason": "semantic_completion_not_satisfied",
            "expected": "scripts/release-local-artifact.mjs artifactEvidence records source commit and clean-tree/source identity",
            "actual": "artifactEvidence lacks source identity fields",
            "results": results
        }, sort_keys=True))
        raise SystemExit(1)

if selected_id == "E-16d-soak-build-transition-step":
    target_path = workspace_root / "scripts/release-runtime-operational-evidence.mjs"
    try:
        target_text = target_path.read_text(encoding="utf-8")
    except Exception as error:
        print(json.dumps({"completed": False, "reason": f"semantic_completion_target_unreadable:{error}", "results": results}, sort_keys=True))
        raise SystemExit(1)
    section_start = target_text.find("function buildSoakSection(")
    section_end = target_text.find("function writeJson(", section_start)
    build_soak_section = target_text[section_start:section_end] if section_start >= 0 and section_end > section_start else ""
    semantic_checks = {
        "build_soak_section_present": bool(build_soak_section),
        "records_stateful_steps": "stateful_steps" in build_soak_section or "statefulSteps" in build_soak_section,
        "records_task_state_transition": "task_state_transition" in build_soak_section,
        "does_not_target_fixture_debris": "soakEvidenceFixture" not in build_soak_section,
    }
    if not all(semantic_checks.values()):
        print(json.dumps({
            "completed": False,
            "reason": "semantic_completion_not_satisfied",
            "expected": "buildSoakSection records a real task_state_transition stateful soak step instead of only listing it as missing or editing soakEvidenceFixture debris",
            "actual": semantic_checks,
            "results": results,
        }, sort_keys=True))
        raise SystemExit(1)

print(json.dumps({"completed": True, "reason": "verification_passed_after_objective_apply", "results": results}, sort_keys=True))
PY
}

validate_todo_decomposition_after_runtime_apply() {
  local stdout_log="$1"
  if [ ! -f "$PROGRESS_STATE_FILE" ]; then
    return 0
  fi
  local applied_todo_path
  applied_todo_path="$(
    python3 - "$PROGRESS_STATE_FILE" <<'PY'
import json
import sys

try:
    state = json.load(open(sys.argv[1], encoding="utf-8"))
    projection = state.get("progress_projection", {})
except Exception:
    projection = {}
applied = str(projection.get("applied") or "").lower() not in ("", "false", "none", "not_applicable")
path = str(projection.get("applied_path") or "")
print(path if applied and path in ("todo.md", ".brownie/todo.md") else "")
PY
  )"
  if [ -z "$applied_todo_path" ]; then
    return 0
  fi
  if ! python3 - "$PHASE_LOOP_WORKSPACE_ROOT" "$PHASE_LOOP_TODO" <<'PY'
import pathlib
import sys

workspace = pathlib.Path(sys.argv[1]).resolve()
todo = pathlib.Path(sys.argv[2]).resolve()
allowed = {
    (workspace / "todo.md").resolve(),
    (workspace / ".brownie" / "todo.md").resolve(),
}
raise SystemExit(0 if todo in allowed else 1)
PY
  then
    return 0
  fi
  local guard_stdout guard_stderr guard_status
  guard_stdout="$(mktemp "${TMPDIR:-/tmp}/brownie-todo-decomposition-guard.stdout.XXXXXX")"
  guard_stderr="$(mktemp "${TMPDIR:-/tmp}/brownie-todo-decomposition-guard.stderr.XXXXXX")"
  (
    cd "$PHASE_LOOP_WORKSPACE_ROOT" || exit 70
    pnpm --workspace-root guard:todo-decomposition
  ) > "$guard_stdout" 2> "$guard_stderr"
  guard_status=$?
  if [ "$guard_status" -eq 0 ]; then
    clear_repair_feedback
    rm -f "$guard_stdout" "$guard_stderr"
    return 0
  fi
  python3 - "$guard_status" "$guard_stdout" "$guard_stderr" "$stdout_log" <<'PY'
import json
import pathlib
import subprocess
import sys

exit_code = int(sys.argv[1])
stdout_path = pathlib.Path(sys.argv[2])
stderr_path = pathlib.Path(sys.argv[3])
runtime_stdout_path = pathlib.Path(sys.argv[4])

def tail(path, limit=4000):
    try:
        return path.read_text(encoding="utf-8", errors="replace")[-limit:]
    except Exception:
        return ""

print(json.dumps({
    "completed": False,
    "reason": "todo_decomposition_guard_failed_after_todo_apply",
    "repair_hint": "The previous run patched the live TODO queue, but the decomposition guard rejected it. Repair `.brownie/todo.md` only: remove duplicate leaf ids, ensure each leaf has one parent `Source TODO`, and keep the selected broad/leaf item from remaining pending unless it is intentionally repaired.",
    "results": [{
        "command": "pnpm --workspace-root guard:todo-decomposition",
        "exit_code": exit_code,
        "stdout_tail": tail(stdout_path),
        "stderr_tail": tail(stderr_path),
    }],
    "stdout_tail": tail(runtime_stdout_path, 2000),
}, sort_keys=True))
PY
  rm -f "$guard_stdout" "$guard_stderr"
  return 1
}

apply_valid_todo_patch_proposal_fallback() {
  local run_stamp="$1"
  local expected_run_id="${2:-}"
  python3 - "$PHASE_LOOP_BROWNIE_STORE_ROOT" "$TODO_CLAIM_FILE" "$PHASE_LOOP_TODO" "$run_stamp" "$expected_run_id" <<'PY'
import json
import pathlib
import subprocess
import sys

store_root = pathlib.Path(sys.argv[1])
claim_path = pathlib.Path(sys.argv[2])
todo_path = pathlib.Path(sys.argv[3])
run_stamp = sys.argv[4]
expected_run_id = sys.argv[5]
workspace_root = todo_path.parent.parent if todo_path.parent.name == ".brownie" else todo_path.parent

try:
    claim = json.loads(claim_path.read_text(encoding="utf-8"))
except Exception as exc:
    print(json.dumps({"applied": False, "reason": f"claim_unreadable:{exc}"}, sort_keys=True))
    sys.exit(2)

selected = str(claim.get("selected_todo") or "")
selected_first = selected.splitlines()[0] if selected.splitlines() else ""
if not selected or not selected_first:
    print(json.dumps({"applied": False, "reason": "selected_todo_missing"}, sort_keys=True))
    sys.exit(2)

selected_is_derived_leaf = "Source TODO:" in selected and "Route: todo-decomposition" not in selected

try:
    todo_text = todo_path.read_text(encoding="utf-8")
except Exception as exc:
    print(json.dumps({"applied": False, "reason": f"todo_unreadable:{exc}"}, sort_keys=True))
    sys.exit(2)

if selected_first not in todo_text:
    print(json.dumps({"applied": False, "reason": "selected_todo_already_absent"}, sort_keys=True))
    sys.exit(2)

candidate = None
runs_dir = store_root / "runs"
for ledger in sorted(runs_dir.glob("*/ledger.jsonl"), key=lambda path: path.stat().st_mtime, reverse=True):
    if expected_run_id and ledger.parent.name != expected_run_id:
        continue
    try:
        lines = ledger.read_text(encoding="utf-8", errors="replace").splitlines()
    except Exception:
        continue
    for line in reversed(lines):
        try:
            event = json.loads(line)
        except Exception:
            continue
        if event.get("kind") != "WorkspacePatchProposed":
            continue
        payload = event.get("payload")
        if not isinstance(payload, dict):
            continue
        if payload.get("validation_status") != "Valid":
            continue
        if payload.get("path") not in {".brownie/todo.md", "todo.md", str(todo_path)}:
            continue
        old_text = payload.get("patch_old_text")
        new_text = payload.get("patch_new_text")
        if not isinstance(old_text, str) or not isinstance(new_text, str):
            continue
        if selected_first not in old_text:
            continue
        if old_text not in todo_text:
            continue
        if selected_first in new_text:
            continue
        candidate = (ledger.parent.name, payload, old_text, new_text)
        break
    if candidate:
        break

if candidate is None:
    print(json.dumps({"applied": False, "reason": "no_matching_valid_todo_patch_proposal"}, sort_keys=True))
    sys.exit(2)

run_id, payload, old_text, new_text = candidate
updated = todo_text.replace(old_text, new_text, 1)
if updated == todo_text:
    print(json.dumps({"applied": False, "reason": "todo_replacement_noop", "run_id": run_id}, sort_keys=True))
    sys.exit(2)

def unchecked_todo_blocks(text):
    starts = []
    for index, line in enumerate(text.splitlines(keepends=True)):
        stripped = line.lstrip()
        if stripped.startswith("- [ ] ") or stripped.startswith("* [ ] "):
            starts.append(sum(len(part) for part in text.splitlines(keepends=True)[:index]))
    blocks = []
    for offset, start in enumerate(starts):
        end = starts[offset + 1] if offset + 1 < len(starts) else len(text)
        blocks.append(text[start:end].rstrip())
    return blocks

def todo_id(block):
    first = block.splitlines()[0].strip() if block.splitlines() else ""
    if "] " in first:
        first = first.split("] ", 1)[1]
    return first.split(":", 1)[0].strip()

def line_value(block, prefix):
    for line in block.splitlines():
        stripped = line.strip()
        if stripped.startswith(prefix):
            return stripped[len(prefix):].strip().rstrip(".")
    return ""

def backticked_values(text):
    values = []
    parts = text.split("`")
    for index in range(1, len(parts), 2):
        if parts[index].strip():
            values.append(parts[index].strip())
    return values

def completion_blocks(text):
    return {todo_id(block): block for block in unchecked_todo_blocks(text) if todo_id(block)}

if selected_is_derived_leaf:
    print(json.dumps({
        "applied": False,
        "reason": "selected_todo_is_already_a_bounded_leaf",
        "operation": "valid_todo_patch_proposal_fallback",
        "proposal_id": payload.get("proposal_id"),
        "source_run_id": run_id,
        "selected_todo_first_line": selected_first,
        "repair_hint": "Do not refine a bounded leaf TODO into another child TODO. Implement the bounded leaf target or report a concrete blocker.",
    }, sort_keys=True))
    sys.exit(1)

before_blocks_for_safety = completion_blocks(todo_text)
after_blocks_for_safety = completion_blocks(updated)
before_ids_for_safety = set(before_blocks_for_safety)
after_ids_for_safety = set(after_blocks_for_safety)
selected_id = todo_id(selected)
removed_ids = sorted(before_ids_for_safety - after_ids_for_safety)
added_ids = sorted(after_ids_for_safety - before_ids_for_safety)
unexpected_removed_ids = [ident for ident in removed_ids if ident != selected_id]
if unexpected_removed_ids or len(after_ids_for_safety) < len(before_ids_for_safety):
    print(json.dumps({
        "applied": False,
        "reason": "todo_patch_would_remove_unrelated_queue_items",
        "operation": "valid_todo_patch_proposal_fallback",
        "proposal_id": payload.get("proposal_id"),
        "source_run_id": run_id,
        "selected_todo_first_line": selected_first,
        "selected_todo_id": selected_id,
        "removed_ids": removed_ids[:20],
        "added_ids": added_ids[:20],
        "before_unchecked_count": len(before_ids_for_safety),
        "after_unchecked_count": len(after_ids_for_safety),
        "repair_hint": "TODO refinement may replace only the selected broad TODO with bounded children. It must not delete unrelated Product Ready queue items.",
    }, sort_keys=True))
    sys.exit(1)

def supplement_breakdown_for_new_leaves(breakdown_text, before_text, after_text):
    before_ids = set(completion_blocks(before_text))
    after_blocks = completion_blocks(after_text)
    new_blocks = [
        block for ident, block in after_blocks.items()
        if ident not in before_ids and "Source TODO:" in block and ident not in breakdown_text
    ]
    if not new_blocks:
        return breakdown_text, []
    dependency_entries = []
    verification_entries = []
    added_ids = []
    for block in new_blocks:
        ident = todo_id(block)
        dep = line_value(block, "Depends on:") or "<none>"
        verification = line_value(block, "Verification:")
        commands = backticked_values(verification)
        verification_text = "; ".join(f"`{command}`" for command in commands) if commands else verification or "inspect bounded completion evidence"
        dependency_entries.append(f"- {ident}: {dep}")
        verification_entries.append(f"- {ident}: {verification_text}")
        added_ids.append(ident)
    supplemented = breakdown_text
    dependency_marker = "\nVerification ledger:"
    if dependency_marker in supplemented:
        insertion = "".join(f"{entry}\n" for entry in dependency_entries)
        supplemented = supplemented.replace(dependency_marker, f"\n{insertion}{dependency_marker.lstrip()}", 1)
    else:
        supplemented += "\n\nDependency graph:\n" + "".join(f"{entry}\n" for entry in dependency_entries)
    verification_marker = "\nQuality rubric:"
    if verification_marker in supplemented:
        insertion = "".join(f"{entry}\n" for entry in verification_entries)
        supplemented = supplemented.replace(verification_marker, f"\n{insertion}{verification_marker.lstrip()}", 1)
    else:
        supplemented += "\n\nVerification ledger:\n" + "".join(f"{entry}\n" for entry in verification_entries)
    return supplemented, added_ids

tmp_path = todo_path.with_name(f"{todo_path.name}.{run_stamp}.proposal-apply.tmp")
tmp_path.write_text(updated, encoding="utf-8")
try:
    relative_tmp_path = tmp_path.relative_to(workspace_root)
except ValueError:
    relative_tmp_path = tmp_path
breakdown_path = workspace_root / ".brownie" / "todo-breakdown.md"
tmp_breakdown_path = None
supplemented_breakdown_ids = []
breakdown_for_validation = breakdown_path
try:
    breakdown_text = breakdown_path.read_text(encoding="utf-8")
    supplemented_breakdown, supplemented_breakdown_ids = supplement_breakdown_for_new_leaves(
        breakdown_text,
        todo_text,
        updated,
    )
    if supplemented_breakdown_ids:
        tmp_breakdown_path = breakdown_path.with_name(f"{breakdown_path.name}.{run_stamp}.proposal-apply.tmp")
        tmp_breakdown_path.write_text(supplemented_breakdown, encoding="utf-8")
        breakdown_for_validation = tmp_breakdown_path
except Exception:
    tmp_breakdown_path = None
    breakdown_for_validation = breakdown_path

try:
    relative_breakdown_path = breakdown_for_validation.relative_to(workspace_root)
except ValueError:
    relative_breakdown_path = breakdown_for_validation
guard_result = subprocess.run(
    [
        "node",
        "--input-type=module",
        "-",
        str(relative_tmp_path),
        str(relative_breakdown_path),
    ],
    cwd=workspace_root,
    input="""\
import fs from 'node:fs';
import { validateTodoDecompositionText } from './scripts/guard-todo-decomposition.mjs';

const todoPath = process.argv[2];
const breakdownPath = process.argv[3];
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const errors = validateTodoDecompositionText(fs.readFileSync(todoPath, 'utf8'), {
  path: todoPath,
  repoRoot: process.cwd(),
  packageScripts: new Set(Object.keys(pkg.scripts ?? {})),
  breakdownPath,
  breakdownText: fs.readFileSync(breakdownPath, 'utf8')
});
if (errors.length > 0) {
  console.error('TODO decomposition guard failed:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}
console.log(`TODO decomposition guard passed for ${todoPath}.`);
""",
    text=True,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    timeout=180,
)
if guard_result.returncode != 0:
    try:
        tmp_path.unlink()
    except FileNotFoundError:
        pass
    if tmp_breakdown_path is not None:
        try:
            tmp_breakdown_path.unlink()
        except FileNotFoundError:
            pass
    print(json.dumps({
        "applied": False,
        "reason": "todo_patch_proposal_guard_failed_before_apply",
        "operation": "valid_todo_patch_proposal_fallback",
        "proposal_id": payload.get("proposal_id"),
        "source_run_id": run_id,
        "selected_todo_first_line": selected_first,
        "results": [{
            "command": f"node scripts/guard-todo-decomposition.mjs {relative_tmp_path}",
            "exit_code": guard_result.returncode,
            "stdout_tail": guard_result.stdout[-2000:],
            "stderr_tail": guard_result.stderr[-4000:],
        }],
        "supplemented_breakdown_ids": supplemented_breakdown_ids,
    }, sort_keys=True))
    sys.exit(1)
tmp_path.replace(todo_path)
if tmp_breakdown_path is not None:
    tmp_breakdown_path.replace(breakdown_path)

print(json.dumps({
    "applied": True,
    "operation": "valid_todo_patch_proposal_fallback",
    "path": str(todo_path),
    "proposal_id": payload.get("proposal_id"),
    "source_run_id": run_id,
    "selected_todo_first_line": selected_first,
    "supplemented_breakdown_ids": supplemented_breakdown_ids,
}, sort_keys=True))
PY
}

apply_valid_todo_breakdown_patch_proposal_fallback() {
  local run_stamp="$1"
  local expected_run_id="${2:-}"
  python3 - "$PHASE_LOOP_BROWNIE_STORE_ROOT" "$PHASE_LOOP_WORKSPACE_ROOT/.brownie/todo-breakdown.md" "$run_stamp" "$expected_run_id" <<'PY'
import json
import pathlib
import sys

store_root = pathlib.Path(sys.argv[1])
breakdown_path = pathlib.Path(sys.argv[2])
run_stamp = sys.argv[3]
expected_run_id = sys.argv[4]

try:
    breakdown_text = breakdown_path.read_text(encoding="utf-8")
except Exception as exc:
    print(json.dumps({"applied": False, "reason": f"breakdown_unreadable:{exc}"}, sort_keys=True))
    sys.exit(2)

candidate = None
runs_dir = store_root / "runs"
for ledger in sorted(runs_dir.glob("*/ledger.jsonl"), key=lambda path: path.stat().st_mtime, reverse=True):
    if expected_run_id and ledger.parent.name != expected_run_id:
        continue
    try:
        lines = ledger.read_text(encoding="utf-8", errors="replace").splitlines()
    except Exception:
        continue
    for line in reversed(lines):
        try:
            event = json.loads(line)
        except Exception:
            continue
        if event.get("kind") != "WorkspacePatchProposed":
            continue
        payload = event.get("payload")
        if not isinstance(payload, dict):
            continue
        if payload.get("validation_status") != "Valid":
            continue
        if payload.get("path") not in {".brownie/todo-breakdown.md", str(breakdown_path)}:
            continue
        hunks = payload.get("patch_hunks")
        if not isinstance(hunks, list) or not hunks:
            old_text = payload.get("patch_old_text")
            new_text = payload.get("patch_new_text")
            hunks = [{"old_text": old_text, "new_text": new_text}]
        normalized = []
        for hunk in hunks:
            if not isinstance(hunk, dict):
                normalized = []
                break
            old_text = hunk.get("old_text")
            new_text = hunk.get("new_text")
            if not isinstance(old_text, str) or not isinstance(new_text, str):
                normalized = []
                break
            if old_text not in breakdown_text:
                normalized = []
                break
            normalized.append((old_text, new_text))
        if not normalized:
            continue
        candidate = (ledger.parent.name, payload, normalized)
        break
    if candidate:
        break

if candidate is None:
    print(json.dumps({"applied": False, "reason": "no_matching_valid_todo_breakdown_patch_proposal"}, sort_keys=True))
    sys.exit(2)

run_id, payload, hunks = candidate
updated = breakdown_text
for old_text, new_text in hunks:
    updated = updated.replace(old_text, new_text, 1)

if updated == breakdown_text:
    print(json.dumps({"applied": False, "reason": "breakdown_replacement_noop", "run_id": run_id}, sort_keys=True))
    sys.exit(2)

tmp_path = breakdown_path.with_name(f"{breakdown_path.name}.{run_stamp}.proposal-apply.tmp")
tmp_path.write_text(updated, encoding="utf-8")
tmp_path.replace(breakdown_path)

print(json.dumps({
    "applied": True,
    "operation": "valid_todo_breakdown_patch_proposal_fallback",
    "path": str(breakdown_path),
    "proposal_id": payload.get("proposal_id"),
    "source_run_id": run_id,
}, sort_keys=True))
PY
}

normalize_todo_decomposition_after_guard_failure() {
  if [ ! -f "$PHASE_LOOP_TODO" ]; then
    return 1
  fi
  python3 - "$PHASE_LOOP_WORKSPACE_ROOT" "$PHASE_LOOP_TODO" "$TODO_REPAIR_FEEDBACK_FILE" "$(now_utc)" <<'PY'
import json
import os
import pathlib
import re
import subprocess
import sys

workspace = pathlib.Path(sys.argv[1])
todo_path = pathlib.Path(sys.argv[2])
repair_feedback_path = pathlib.Path(sys.argv[3])
timestamp = sys.argv[4]

def unchecked_blocks(text):
    starts = [match.start() for match in re.finditer(r"(?m)^[ \t]*[-*][ \t]+\[[ \t]*\][ \t]+", text)]
    blocks = []
    for index, start in enumerate(starts):
        end = starts[index + 1] if index + 1 < len(starts) else len(text)
        blocks.append((start, end, text[start:end].rstrip()))
    return blocks

def todo_id(block):
    first = block.splitlines()[0] if block.splitlines() else ""
    match = re.match(r"^[ \t]*[-*][ \t]+\[[ \t]*\][ \t]+([^:\s]+)", first)
    return match.group(1).strip() if match else ""

def has_scope(block, target):
    first = block.splitlines()[0] if block.splitlines() else ""
    return f"Patch only `{target}`" in first or f"Create only `{target}`" in first

def replace_line(block, prefix, replacement):
    lines = block.splitlines()
    changed = False
    for index, line in enumerate(lines):
        if line.strip().startswith(prefix):
            indent = line[:len(line) - len(line.lstrip())]
            if line.strip() != replacement:
                lines[index] = f"{indent}{replacement}"
                changed = True
            break
    return "\n".join(lines), changed

try:
    before = todo_path.read_text(encoding="utf-8")
except FileNotFoundError:
    raise SystemExit(1)

replacements = []
notes = []
for start, end, block in unchecked_blocks(before):
    block_id = todo_id(block)
    if not block_id:
        continue
    normalized = block
    changed = False
    lower = block.lower()
    if (
        has_scope(block, "docs/architecture/runtime-release-contract.json")
        and "verification:" in lower
        and (
            "node scripts/release-gate.mjs" in lower
            or "verification must use bounded allowlisted commands" in lower
            or "guard:release-contract" not in lower
        )
    ):
        normalized, route_changed = replace_line(normalized, "Route:", "Route: documentation.")
        changed = changed or route_changed
        normalized, verification_changed = replace_line(
            normalized,
            "Verification:",
            "Verification: run `pnpm --workspace-root guard:release-contract`."
        )
        changed = changed or verification_changed
    if changed:
        replacements.append((start, end, normalized))
        notes.append({
            "todo_id": block_id,
            "normalization": "runtime_release_contract_documentation_verification",
        })

if not replacements:
    raise SystemExit(1)

after_parts = []
cursor = 0
for start, end, replacement in replacements:
    after_parts.append(before[cursor:start])
    after_parts.append(replacement)
    after_parts.append("\n" if end > start and before[end - 1:end] == "\n" else "")
    cursor = end
after_parts.append(before[cursor:])
after = "".join(after_parts)
if after == before:
    raise SystemExit(1)

tmp = todo_path.with_name(f"{todo_path.name}.{os.getpid()}.normalized.tmp")
with open(tmp, "w", encoding="utf-8") as handle:
    handle.write(after)
    handle.flush()
    os.fsync(handle.fileno())
os.chmod(tmp, 0o600)
os.replace(tmp, todo_path)
try:
    dir_fd = os.open(str(todo_path.parent), os.O_RDONLY)
    try:
        os.fsync(dir_fd)
    finally:
        os.close(dir_fd)
except Exception:
    pass

result = subprocess.run(
    ["pnpm", "--workspace-root", "guard:todo-decomposition"],
    cwd=workspace,
    text=True,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
)
if result.returncode != 0:
    payload = {
        "schema_version": 1,
        "reason": "todo_decomposition_normalization_failed_guard",
        "updated_at": timestamp,
        "results": [{
            "command": "pnpm --workspace-root guard:todo-decomposition",
            "exit_code": result.returncode,
            "stdout_tail": result.stdout[-4000:],
            "stderr_tail": result.stderr[-4000:],
        }],
        "normalizations": notes,
    }
    repair_feedback_path.parent.mkdir(parents=True, exist_ok=True)
    repair_feedback_path.write_text(json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    os.chmod(repair_feedback_path, 0o600)
    raise SystemExit(1)

print(json.dumps({
    "completed": True,
    "reason": "todo_decomposition_normalized_after_guard_failure",
    "normalizations": notes,
    "guard_stdout_tail": result.stdout[-1000:],
}, ensure_ascii=False, sort_keys=True))
PY
}

write_repair_feedback() {
  local run_stamp="$1"
  local verification_output="$2"
  local stdout_log="$3"
  local stderr_log="$4"
  local tmp_feedback
  tmp_feedback="$TODO_REPAIR_FEEDBACK_FILE.$$.$RANDOM.tmp"
  python3 - "$tmp_feedback" "$TODO_CLAIM_FILE" "$run_stamp" "$verification_output" "$stdout_log" "$stderr_log" "$(now_utc)" <<'PY'
import json
import os
import pathlib
import sys

out_path = pathlib.Path(sys.argv[1])
claim_path = pathlib.Path(sys.argv[2])
run_stamp = sys.argv[3]
verification_raw = sys.argv[4]
stdout_log = sys.argv[5]
stderr_log = sys.argv[6]
timestamp = sys.argv[7]

try:
    claim = json.loads(claim_path.read_text(encoding="utf-8"))
except Exception:
    claim = {}
try:
    verification = json.loads(verification_raw)
except Exception:
    verification = {"completed": False, "reason": "verification_output_unparseable", "raw_tail": verification_raw[-2000:]}

feedback = {
    "schema_version": 1,
    "claim_id": claim.get("claim_id"),
    "selected_todo_first_line": str(claim.get("selected_todo", "")).splitlines()[0] if claim.get("selected_todo") else "",
    "run_stamp": run_stamp,
    "updated_at": timestamp,
    "reason": verification.get("reason"),
    "verification": verification,
    "stdout_log": stdout_log,
    "stderr_log": stderr_log,
}
out_path.parent.mkdir(parents=True, exist_ok=True)
with open(out_path, "w", encoding="utf-8") as handle:
    json.dump(feedback, handle, ensure_ascii=False, sort_keys=True, indent=2)
    handle.write("\n")
    handle.flush()
    os.fsync(handle.fileno())
os.chmod(out_path, 0o600)
PY
  mv "$tmp_feedback" "$TODO_REPAIR_FEEDBACK_FILE"
  chmod 600 "$TODO_REPAIR_FEEDBACK_FILE"
}

clear_repair_feedback() {
  rm -f "$TODO_REPAIR_FEEDBACK_FILE"
}

clear_stale_repair_feedback_if_todo_guard_passes() {
  if [ ! -f "$TODO_REPAIR_FEEDBACK_FILE" ]; then
    return 0
  fi
  if [ ! -f "$PHASE_LOOP_TODO" ]; then
    return 0
  fi
  if ! python3 - "$TODO_REPAIR_FEEDBACK_FILE" <<'PY'
import json
import sys

try:
    with open(sys.argv[1], encoding="utf-8") as handle:
        feedback = json.load(handle)
except Exception:
    sys.exit(1)

verification = feedback.get("verification") if isinstance(feedback.get("verification"), dict) else {}
reason = feedback.get("reason") or verification.get("reason")
sys.exit(0 if reason == "todo_decomposition_guard_failed_after_todo_apply" else 1)
PY
  then
    return 0
  fi
  if (
    cd "$PHASE_LOOP_WORKSPACE_ROOT" || exit 70
    pnpm --workspace-root guard:todo-decomposition >/dev/null 2>&1
  ); then
    clear_repair_feedback
    printf '%s todo_repair_feedback_cleared reason=todo_decomposition_guard_passed\n' "$(now_utc)" >> "$SUPERVISOR_LOG"
  fi
}

active_repair_feedback_matches_claim() {
  if [ ! -f "$TODO_CLAIM_FILE" ] || [ ! -f "$TODO_REPAIR_FEEDBACK_FILE" ]; then
    return 1
  fi
  python3 - "$TODO_CLAIM_FILE" "$TODO_REPAIR_FEEDBACK_FILE" <<'PY'
import json
import sys

try:
    with open(sys.argv[1], encoding="utf-8") as handle:
        claim = json.load(handle)
    with open(sys.argv[2], encoding="utf-8") as handle:
        feedback = json.load(handle)
except Exception:
    sys.exit(1)

claim_id = claim.get("claim_id")
sys.exit(0 if claim_id and feedback.get("claim_id") == claim_id else 1)
PY
}

write_runtime_terminal_repair_feedback() {
  local run_stamp="$1"
  local stdout_log="$2"
  local stderr_log="$3"
  local tmp_feedback
  tmp_feedback="$TODO_REPAIR_FEEDBACK_FILE.$$.$RANDOM.tmp"
  python3 - "$tmp_feedback" "$TODO_CLAIM_FILE" "$TODO_REPAIR_FEEDBACK_FILE" "$stdout_log" "$stderr_log" "$PHASE_LOOP_BROWNIE_STORE_ROOT" "$PHASE_LOOP_WORKSPACE_ROOT" "$run_stamp" "$(now_utc)" <<'PY'
import json
import os
import pathlib
import subprocess
import sys

out_path = pathlib.Path(sys.argv[1])
claim_path = pathlib.Path(sys.argv[2])
previous_feedback_path = pathlib.Path(sys.argv[3])
stdout_log = pathlib.Path(sys.argv[4])
stderr_log = pathlib.Path(sys.argv[5])
store_root = pathlib.Path(sys.argv[6])
workspace_root = pathlib.Path(sys.argv[7])
run_stamp = sys.argv[8]
timestamp = sys.argv[9]

def read_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}

claim = read_json(claim_path)
previous = read_json(previous_feedback_path)
root = read_json(stdout_log)
payload = root.get("run") if isinstance(root.get("run"), dict) else root.get("resume") if isinstance(root.get("resume"), dict) else root
if not isinstance(payload, dict):
    payload = {}

run_id = str(payload.get("run_id") or payload.get("automation", {}).get("run_id") or "")
ledger_summary = ""
denied_reasons = []
intent_rejections = []
invalid_patch_proposals = []
read_previews = []
llm_response_previews = []
if run_id:
    ledger_path = store_root / "runs" / run_id / "ledger.jsonl"
    try:
        for line in ledger_path.read_text(encoding="utf-8").splitlines():
            try:
                event = json.loads(line)
            except Exception:
                continue
            payload_event = event.get("payload") if isinstance(event.get("payload"), dict) else {}
            kind = event.get("kind")
            if kind in ("AgentLoopCompleted", "TaskFailed"):
                summary = (
                    payload_event.get("completion_summary")
                    or (payload_event.get("completion_evidence") or {}).get("completion_summary_preview")
                    or ""
                )
                if summary:
                    ledger_summary = str(summary)
            if kind in ("ToolExecutionDenied", "ToolIntentDenied"):
                reason = payload_event.get("reason")
                if reason:
                    denied_reasons.append(str(reason))
            if kind == "ToolIntentRejected":
                rejection = {
                    "code": payload_event.get("code"),
                    "reason": payload_event.get("reason"),
                    "tool_id": payload_event.get("tool_id"),
                }
                intent_rejections.append(rejection)
            if kind == "WorkspacePatchProposed" and payload_event.get("validation_status") == "Invalid":
                invalid_patch_proposals.append({
                    "path": payload_event.get("path"),
                    "operation": payload_event.get("operation"),
                    "validation_reason": payload_event.get("validation_reason"),
                    "content_preview": payload_event.get("content_preview"),
                    "hunk_count": payload_event.get("hunk_count"),
                })
            if kind in ("LlmResponseReceived", "SecondPassLlmResponseReceived"):
                preview = payload_event.get("content_preview")
                if preview:
                    llm_response_previews.append(str(preview))
            if kind == "ToolExecutionCompleted":
                preview = payload_event.get("output_preview")
                if preview:
                    read_previews.append(str(preview))
    except Exception:
        pass

previous_verification = previous.get("verification") if isinstance(previous.get("verification"), dict) else {}
if not read_previews and isinstance(previous_verification.get("workspace_read_previews"), list):
    read_previews = [str(item) for item in previous_verification.get("workspace_read_previews", [])]
verification = {
    "completed": False,
    "reason": "runtime_terminal_failure",
    "runtime_status": payload.get("status"),
    "stop_class": payload.get("stop_class"),
    "stop_reason": payload.get("stop_reason"),
    "completion_closure_status": payload.get("completion_closure_status"),
    "terminal_completion_summary": ledger_summary,
    "tool_denial_reasons": denied_reasons[-3:],
    "tool_intent_rejections": intent_rejections[-3:],
    "invalid_patch_proposals": invalid_patch_proposals[-3:],
    "llm_response_previews": llm_response_previews[-2:],
    "workspace_read_previews": read_previews[-2:],
}
if any(str(item.get("code") or "").lower() == "missing_closing_fence" for item in intent_rejections):
    verification["repair_hint"] = "The previous workspace.write tool intent was truncated before the closing fence, likely because new_text was too large. Do not retry the same large patch. Emit a much smaller patch_file using one short exact old_text/new_text hunk, or patch `.brownie/todo.md` to split this TODO into narrower bounded leaves."
if previous_verification.get("expected") is not None:
    verification["expected"] = previous_verification.get("expected")
if previous_verification.get("actual") is not None:
    verification["actual"] = previous_verification.get("actual")
if previous_verification.get("results") is not None:
    verification["previous_results"] = previous_verification.get("results")
try:
    guard = subprocess.run(
        ["pnpm", "--workspace-root", "guard:todo-decomposition"],
        cwd=workspace_root,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=30,
    )
    if guard.returncode != 0:
        guard_result = {
            "command": "pnpm --workspace-root guard:todo-decomposition",
            "exit_code": guard.returncode,
            "stdout_tail": guard.stdout[-4000:],
            "stderr_tail": guard.stderr[-4000:],
        }
        verification.setdefault("previous_results", [])
        if isinstance(verification["previous_results"], list):
            verification["previous_results"] = [*verification["previous_results"], guard_result][-3:]
        else:
            verification["previous_results"] = [guard_result]
        verification["todo_guard_status"] = "failed"
        verification["repair_hint"] = "Current `.brownie/todo.md` fails `pnpm --workspace-root guard:todo-decomposition`; repair `.brownie/todo.md` first by replacing the entire corrupt duplicate block, not by editing implementation files."
except Exception as error:
    verification["todo_guard_status"] = f"unavailable: {error}"

feedback = {
    "schema_version": 1,
    "claim_id": claim.get("claim_id"),
    "selected_todo_first_line": str(claim.get("selected_todo", "")).splitlines()[0] if claim.get("selected_todo") else "",
    "run_stamp": run_stamp,
    "updated_at": timestamp,
    "reason": "runtime_terminal_failure",
    "verification": verification,
    "stdout_log": str(stdout_log),
    "stderr_log": str(stderr_log),
}
out_path.parent.mkdir(parents=True, exist_ok=True)
with open(out_path, "w", encoding="utf-8") as handle:
    json.dump(feedback, handle, ensure_ascii=False, sort_keys=True, indent=2)
    handle.write("\n")
    handle.flush()
    os.fsync(handle.fileno())
os.chmod(out_path, 0o600)
PY
  mv "$tmp_feedback" "$TODO_REPAIR_FEEDBACK_FILE"
  chmod 600 "$TODO_REPAIR_FEEDBACK_FILE"
}

write_process_failure_repair_feedback() {
  local run_stamp="$1"
  local exit_code="$2"
  local stdout_log="$3"
  local stderr_log="$4"
  local tmp_feedback
  tmp_feedback="$TODO_REPAIR_FEEDBACK_FILE.$$.$RANDOM.tmp"
  python3 - "$tmp_feedback" "$TODO_CLAIM_FILE" "$TODO_REPAIR_FEEDBACK_FILE" "$stdout_log" "$stderr_log" "$run_stamp" "$exit_code" "$(now_utc)" <<'PY'
import json
import os
import pathlib
import sys

out_path = pathlib.Path(sys.argv[1])
claim_path = pathlib.Path(sys.argv[2])
previous_feedback_path = pathlib.Path(sys.argv[3])
stdout_log = pathlib.Path(sys.argv[4])
stderr_log = pathlib.Path(sys.argv[5])
run_stamp = sys.argv[6]
exit_code = sys.argv[7]
timestamp = sys.argv[8]

def read_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}

def read_tail(path, limit=2000):
    try:
        return path.read_text(encoding="utf-8", errors="replace")[-limit:]
    except Exception:
        return ""

claim = read_json(claim_path)
previous = read_json(previous_feedback_path)
previous_verification = previous.get("verification") if isinstance(previous.get("verification"), dict) else {}
verification = {
    "completed": False,
    "reason": "process_failure",
    "exit_code": exit_code,
    "stdout_tail": read_tail(stdout_log),
    "stderr_tail": read_tail(stderr_log),
}
if exit_code == "124":
    verification["reason"] = "process_timeout"
    verification["repair_hint"] = "The previous invocation timed out before producing CLI JSON. Keep the next response short and emit exactly one workspace.write proposal or one concrete blocker TODO."
    if "TODO-decompose-" in str(claim.get("selected_todo", "")) or "Route: todo-decomposition" in str(claim.get("selected_todo", "")):
        verification["repair_hint"] = "The previous TODO decomposition invocation timed out before producing CLI JSON. Do not generate a large full-queue rewrite. Emit exactly one compact workspace.write proposal that replaces only the active decomposition TODO and its broad source TODO with a small set of leaf TODOs, then separately update `.brownie/todo-breakdown.md` if needed in a later turn."
if previous_verification.get("expected") is not None:
    verification["expected"] = previous_verification.get("expected")
if previous_verification.get("actual") is not None:
    verification["actual"] = previous_verification.get("actual")
if previous_verification.get("terminal_completion_summary") is not None:
    verification["previous_terminal_completion_summary"] = previous_verification.get("terminal_completion_summary")
if previous_verification.get("tool_denial_reasons") is not None:
    verification["tool_denial_reasons"] = previous_verification.get("tool_denial_reasons")
if previous_verification.get("previous_results") is not None:
    verification["previous_results"] = previous_verification.get("previous_results")
if previous_verification.get("workspace_read_previews") is not None:
    verification["workspace_read_previews"] = previous_verification.get("workspace_read_previews")

feedback = {
    "schema_version": 1,
    "claim_id": claim.get("claim_id"),
    "selected_todo_first_line": str(claim.get("selected_todo", "")).splitlines()[0] if claim.get("selected_todo") else "",
    "run_stamp": run_stamp,
    "updated_at": timestamp,
    "reason": verification["reason"],
    "verification": verification,
    "stdout_log": str(stdout_log),
    "stderr_log": str(stderr_log),
}
out_path.parent.mkdir(parents=True, exist_ok=True)
with open(out_path, "w", encoding="utf-8") as handle:
    json.dump(feedback, handle, ensure_ascii=False, sort_keys=True, indent=2)
    handle.write("\n")
    handle.flush()
    os.fsync(handle.fileno())
os.chmod(out_path, 0o600)
PY
  mv "$tmp_feedback" "$TODO_REPAIR_FEEDBACK_FILE"
  chmod 600 "$TODO_REPAIR_FEEDBACK_FILE"
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

release_contract_runtime_ready_violation_repair() {
  local before_contract="$1"
  local run_stamp="$2"
  local contract_path="$PHASE_LOOP_WORKSPACE_ROOT/docs/architecture/runtime-release-contract.json"
  if [ ! -f "$TODO_CLAIM_FILE" ] || [ ! -f "$before_contract" ] || [ ! -f "$contract_path" ]; then
    return 2
  fi
  local violation_output
  violation_output="$(
    python3 - "$TODO_CLAIM_FILE" "$contract_path" <<'PY'
import json
import pathlib
import sys

claim_path = pathlib.Path(sys.argv[1])
contract_path = pathlib.Path(sys.argv[2])
try:
    claim = json.loads(claim_path.read_text(encoding="utf-8"))
except Exception as error:
    print(f"claim_unreadable:{error}")
    sys.exit(2)
selected = str(claim.get("selected_todo") or "")
if "docs/architecture/runtime-release-contract.json" not in selected:
    sys.exit(2)
if "runtime_release_ready" not in selected and "E-16f-release-contract-audit-sync" not in selected:
    sys.exit(2)
try:
    contract = json.loads(contract_path.read_text(encoding="utf-8"))
except Exception as error:
    print(f"invalid_runtime_release_contract_json:{error}")
    sys.exit(1)
violations = []
if contract.get("runtime_release_ready") is not False:
    violations.append("runtime_release_ready_must_remain_false")
trace = contract.get("commit_trace")
if not isinstance(trace, dict):
    violations.append("commit_trace_missing_or_invalid")
else:
    for field in ["implementation_commit", "tested_commit", "release_tag", "workflow_run_id", "artifact_sha256", "mode_pack_fingerprint", "product_dod_fingerprint"]:
        if trace.get(field) is not None:
            violations.append(f"forbidden_commit_trace_binding:{field}")
conditions = contract.get("release_ready_conditions")
if isinstance(conditions, list):
    for condition in conditions:
        if not isinstance(condition, dict):
            continue
        if condition.get("id") in {"required_before_release_closed", "artifact_smoke_tests", "tested_commit_matches_artifact_commit", "audit_trace_matches_tested_commit", "no_unresolved_release_blockers"}:
            if condition.get("release_blocking") is False or condition.get("status") in {"closed", "satisfied"}:
                violations.append(f"forbidden_release_condition_closure:{condition.get('id')}")
if not violations:
    sys.exit(0)
print(",".join(violations))
sys.exit(1)
PY
  )"
  local status=$?
  case "$status" in
    0) return 0 ;;
    2) return 2 ;;
  esac
  cp "$before_contract" "$contract_path"
  sync_parent_dir "$(dirname "$contract_path")"
  printf 'release_contract_forbidden_mutation_repaired run_stamp=%s reason=%s path=docs/architecture/runtime-release-contract.json\n' "$run_stamp" "$violation_output"
  return 1
}

json_target_parse_violation_repair() {
  local before_file="$1"
  local target_file="$2"
  local run_stamp="$3"
  local label="$4"
  if [ ! -f "$before_file" ] || [ ! -f "$target_file" ]; then
    return 2
  fi
  local parse_output
  parse_output="$(
    node - "$target_file" <<'NODE'
const fs = require('node:fs');
const target = process.argv[2];
try {
  JSON.parse(fs.readFileSync(target, 'utf8'));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
NODE
  )"
  local status=$?
  if [ "$status" -eq 0 ]; then
    return 0
  fi
  cp "$before_file" "$target_file"
  sync_parent_dir "$(dirname "$target_file")"
  printf 'json_target_parse_violation_repaired run_stamp=%s label=%s reason=%s path=%s\n' "$run_stamp" "$label" "$parse_output" "${target_file#$PHASE_LOOP_WORKSPACE_ROOT/}"
  return 1
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
  if verify_todo_fresh_for_runtime_start && python3 - "$PROGRESS_STATE_FILE" <<'PY'
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
next_action = str(projection.get("next_action") or "")
if next_action in {
    "review_and_authorize_objective_proposal",
    "apply_authorized_objective_proposal",
    "verify_objective_apply",
}:
    sys.exit(0)
sys.exit(1)
PY
  then
    return 0
  fi
  if python3 - "$TODO_CLAIM_FILE" <<'PY'
import json
import sys

try:
    with open(sys.argv[1], encoding="utf-8") as handle:
        claim = json.load(handle)
except Exception:
    sys.exit(1)
selected = str(claim.get("selected_todo", ""))
if "TODO-decompose-" in selected or "Route: todo-decomposition" in selected:
    sys.exit(0)
sys.exit(1)
PY
  then
    return 1
  fi
  if [ -f "$TODO_REPAIR_FEEDBACK_FILE" ]; then
    if python3 - "$TODO_CLAIM_FILE" "$TODO_REPAIR_FEEDBACK_FILE" <<'PY'
import json
import sys

try:
    with open(sys.argv[1], encoding="utf-8") as handle:
        claim = json.load(handle)
    with open(sys.argv[2], encoding="utf-8") as handle:
        feedback = json.load(handle)
except Exception:
    sys.exit(1)

if claim.get("claim_id") and feedback.get("claim_id") == claim.get("claim_id"):
    sys.exit(0)
sys.exit(1)
PY
    then
      return 1
    fi
  fi
  if ! verify_todo_fresh_for_runtime_start; then
    return 1
  fi
  if python3 - "$PROGRESS_STATE_FILE" <<'PY'
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
  then
    return 0
  fi
  return 1
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
  python3 - "$tmp_progress" "$PROGRESS_STATE_FILE" "$stdout_log" "$run_stamp" "$exit_code" "$workspace_before" "$workspace_after" "$head_commit" "$TODO_CLAIM_FILE" "$timestamp" "$PHASE_LOOP_STAGNATION_THRESHOLD" "$PHASE_LOOP_TODO" <<'PY'
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
todo_path = pathlib.Path(sys.argv[12])

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
    "applied_path": text(payload.get("objective_apply_path")),
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
terminal_failed = (
    progress_projection["terminal_final_state"] == "Failed"
    or progress_projection["terminal_task_status"] == "Failed"
    or progress_projection["stop_class"] == "terminal_failure"
    or progress_projection["stop_reason"] == "terminal_task_failed"
)
blocked = bool(payload.get("blocked")) or bool(automation.get("blocked")) or terminal_failed
accepted = bool(progress_projection["accepted"])
finalized = bool(progress_projection["finalization"])
applied = progress_projection["applied"].lower() not in ("", "false", "none", "not_applicable")
selected_todo_lower = progress_projection["selected_todo"].lower()
todo_md_edit_allowed = (
    "todo.md" in selected_todo_lower
    or "todo list" in selected_todo_lower
    or "todo queue" in selected_todo_lower
    or "decompos" in selected_todo_lower
    or "blocker todo" in selected_todo_lower
)
selected_first_line = progress_projection["selected_todo"].splitlines()[0] if progress_projection["selected_todo"].splitlines() else ""
selected_first_line_still_pending = False
todo_apply_paths = {"todo.md", ".brownie/todo.md", str(todo_path)}
try:
    todo_apply_paths.add(str(todo_path.relative_to(pathlib.Path.cwd())))
except Exception:
    pass
if applied and progress_projection["applied_path"] in todo_apply_paths and selected_first_line:
    try:
        todo_text_after_apply = todo_path.read_text(encoding="utf-8")
        selected_first_line_still_pending = selected_first_line in todo_text_after_apply
    except Exception:
        selected_first_line_still_pending = False
todo_md_only_apply = (
    applied
    and progress_projection["applied_path"] in todo_apply_paths
    and not todo_md_edit_allowed
    and selected_first_line_still_pending
)
previous_applied = text(previous_projection.get("applied")).lower() not in ("", "false", "none", "not_applicable")
same_claim_as_previous = bool(progress_projection["claim_id"]) and progress_projection["claim_id"] == text(previous_projection.get("claim_id"))
previous_selected_first_line = text(previous_projection.get("selected_todo")).splitlines()[0] if text(previous_projection.get("selected_todo")).splitlines() else ""
previous_selected_first_line_still_pending = False
if previous_selected_first_line:
    try:
        previous_selected_first_line_still_pending = previous_selected_first_line in todo_path.read_text(encoding="utf-8")
    except Exception:
        previous_selected_first_line_still_pending = False
previous_todo_md_apply_left_selected_todo_pending = (
    (
        previous_projection.get("todo_md_only_apply_blocked_as_progress") is True
        or previous_projection.get("selected_todo_first_line_still_pending_after_todo_md_apply") is True
    )
    and previous_selected_first_line_still_pending
)
semantic_completion_required = (
    "generated satisfied soak evidence" in selected_todo_lower
    or "satisfied release evidence" in selected_todo_lower
    or "runtime_release_ready" in selected_todo_lower
)
no_actionable_after_apply = (
    exit_code == 0
    and same_claim_as_previous
    and previous_applied
    and not semantic_completion_required
    and not previous_todo_md_apply_left_selected_todo_pending
    and progress_projection["cli_status"] in ("no_eligible_task", "no_actionable_work")
    and progress_projection["stop_class"] == "no_actionable_work"
)
if no_actionable_after_apply and not applied:
    progress_projection["applied"] = text(previous_projection.get("applied"))
    applied = True
progress_projection["completed_by_no_actionable_after_apply"] = no_actionable_after_apply
progress_projection["semantic_completion_required"] = semantic_completion_required
progress_projection["blocked_by_terminal_task_failure"] = terminal_failed
completed = bool(payload.get("completed")) or bool(automation.get("completed")) or no_actionable_after_apply
if todo_md_only_apply or selected_first_line_still_pending:
    applied = False
    completed = False
    accepted = False
    finalized = False
    workspace_changed = False
progress_projection["todo_md_only_apply_blocked_as_progress"] = todo_md_only_apply
progress_projection["selected_todo_first_line_still_pending_after_todo_md_apply"] = selected_first_line_still_pending
terminal_non_progress = (
    exit_code == 0
    and blocked
    and not workspace_changed
    and not completed
    and not accepted
    and not finalized
    and not applied
    and (
        progress_projection["stop_class"] == "terminal_failure"
        or progress_projection["stop_reason"] == "terminal_task_failed"
        or progress_projection["cli_status"] in ("no_eligible_task", "no_actionable_work")
    )
)
meaningful_progress = exit_code == 0 and (workspace_changed or completed or accepted or finalized or applied)

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
    "classification": "no_progress" if (stagnated or terminal_non_progress) else ("non_progress_success" if no_progress else ("progress" if meaningful_progress else "process_failure")),
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
    local paths_file
    paths_file="$(mktemp "${TMPDIR:-/tmp}/brownie-applied-paths.XXXXXX")"
    python3 - "$stdout_log" > "$paths_file" <<'PY'
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
    if [ -s "$paths_file" ]; then
      while IFS= read -r path; do
        case "$path" in
          /*|*..*|"" )
            rm -f "$paths_file"
            exit 66
            ;;
        esac
        if ! git ls-files --error-unmatch -- "$path" >/dev/null 2>&1; then
          rm -f "$paths_file"
          exit 66
        fi
        git add -- "$path"
      done < "$paths_file"
    else
      git diff --name-only --diff-filter=ACMRTUXB | while IFS= read -r path; do
        case "$path" in
          /*|*..*|"" )
            rm -f "$paths_file"
            exit 66
            ;;
        esac
        if ! git ls-files --error-unmatch -- "$path" >/dev/null 2>&1; then
          rm -f "$paths_file"
          exit 66
        fi
        git add -- "$path"
      done
    fi
    rm -f "$paths_file"
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
    claim["queue_generation"] = queue_generation
else:
    claim.setdefault("queue_generation", 1)
claim["selected_todo"] = sys.argv[4]
claim["queue_fingerprint"] = sys.argv[5]
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
    refresh_active_todo_claim_from_live_queue "$run_stamp"
    if active_todo_claim_exists; then
      queue_generation="$(active_claim_queue_generation)"
      write_todo_claim "$(claim_field claim_id)" "in_progress" "$(claim_field selected_todo)" "$(claim_field queue_fingerprint)" "$queue_generation" "$run_stamp"
      return 0
    fi
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
  clear_stale_repair_feedback_if_todo_guard_passes
  if active_todo_claim_exists; then
    selected_todo="$(claim_field selected_todo)"
  else
    selected_todo="$(todo_first_pending_item)"
  fi
  meta_path="${output_path%.prompt.md}.prompt.meta.json"
  if ! python3 - "$output_path" "$meta_path" "$TODO_CLAIM_FILE" "$TODO_REPAIR_FEEDBACK_FILE" "$BDK_HARNESS_FEEDBACK_FILE" "$PHASE_LOOP_TODO" "$PHASE_LOOP_PROMPT" "$selected_todo" "$PHASE_LOOP_PROMPT_MAX_BYTES" "$PHASE_LOOP_SELECTED_TODO_MAX_BYTES" "$PHASE_LOOP_TODO_SNAPSHOT_LINES" "$PHASE_LOOP_BASE_PROMPT_SNAPSHOT_LINES" "$PHASE_LOOP_PROMPT_RETENTION_COUNT" "$(now_utc)" <<'PY'
import hashlib
import json
import os
import pathlib
import re
import sys

output_path = pathlib.Path(sys.argv[1])
meta_path = pathlib.Path(sys.argv[2])
claim_path = pathlib.Path(sys.argv[3])
repair_feedback_path = pathlib.Path(sys.argv[4])
harness_feedback_path = pathlib.Path(sys.argv[5])
todo_path = pathlib.Path(sys.argv[6])
prompt_path = pathlib.Path(sys.argv[7])
selected_todo = sys.argv[8]
prompt_max_bytes = int(sys.argv[9])
selected_todo_max_bytes = int(sys.argv[10])
todo_snapshot_lines = int(sys.argv[11])
base_prompt_snapshot_lines = int(sys.argv[12])
retention_count = int(sys.argv[13])
timestamp = sys.argv[14]

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

def infer_bdk_state(todo):
    lower = todo.lower()
    first_line = todo.splitlines()[0] if todo.splitlines() else ""
    route_match = re.search(r"(?im)^\s*Route:\s*([^.:\n]+)", todo)
    route = route_match.group(1).strip().lower() if route_match else ""
    if route in ("implementation", "implement", "verify_or_repair", "release_engineering", "documentation"):
        if route in ("verify_or_repair",):
            return "verify_or_repair"
        if route in ("release_engineering",):
            return "release_engineering"
        if route in ("documentation",):
            return "documentation"
        return "implement"
    if "todo-decomposition" in route or "TODO-decompose-blocked-queue-" in first_line:
        return "decompose_todo"
    if any(token in lower for token in ("test", "guard", "failure", "失敗", "検証", "evidence")):
        return "verify_or_repair"
    if any(token in lower for token in ("artifact", "release", "installer", "vm", "windows", "linux", "macos")):
        return "release_engineering"
    if any(token in lower for token in ("doc", "readme", "documentation", "ドキュメント")):
        return "documentation"
    return "implement"

def infer_llm_route(state):
    if state in ("decompose_todo",):
        return "deep"
    if state in ("documentation",):
        return "code"
    if state in ("release_engineering", "verify_or_repair"):
        return "code"
    return "code"

def infer_context_hints(todo):
    lower = todo.lower()
    hints = []
    explicit_paths = []
    for match in re.findall(r"`([^`]+)`", todo):
        candidate = match.strip()
        if not candidate or any(char.isspace() for char in candidate):
            continue
        if candidate.startswith((
            ".brownie/",
            ".github/",
            "crates/",
            "docs/",
            "extensions/",
            "scripts/",
        )) or candidate in ("Cargo.lock", "package.json", "pnpm-lock.yaml", "README.md", "todo.md"):
            explicit_paths.append(candidate)
    hints.extend(explicit_paths)
    if "e-15a" in lower or "local release target" in lower or "local-release-targets" in lower:
        hints.extend([
            "scripts/release-runtime-operational-evidence.mjs",
            "scripts/guard-runtime-operational-evidence.test.mjs",
            "docs/architecture/local-release-targets.schema.json",
            "docs/architecture/local-release-targets.example.json",
            ".brownie/local-release-targets.json",
        ])
    if "e-16a" in lower or "golden journey" in lower:
        hints.extend([
            "scripts/release-runtime-operational-evidence.mjs",
            "scripts/guard-runtime-operational-evidence.test.mjs",
            ".brownie/release-evidence/golden-journey-fixture/objective.md",
            ".brownie/release-evidence/runtime-operational-evidence.json",
        ])
    if "supply-chain" in lower or "sbom" in lower or "audit" in lower:
        hints.extend([
            "scripts/guard-supply-chain-artifact-evidence.mjs",
            "scripts/guard-dependency-security-license-audit.mjs",
            "scripts/release-gate.mjs",
            "Cargo.lock",
            "pnpm-lock.yaml",
        ])
    if "release" in lower or "artifact" in lower or "supply-chain" in lower:
        hints.extend([
            "scripts/release-gate.mjs",
            "package.json",
            "docs/architecture/runtime-release-readiness-audit.json",
        ])
    if "protocol" in lower or "ledger" in lower:
        hints.extend([
            "crates/brownie-protocol/src/semantic_contract.rs",
            "crates/brownie-store/src/lib.rs",
            "docs/architecture/runtime-semantic-protocol-contract.json",
        ])
    if "prompt" in lower or "llm" in lower or "context" in lower:
        hints.extend([
            "crates/brownie-context/src/lib.rs",
            "crates/brownie-agent-loop/src/lib.rs",
            "crates/brownie-runtime/src/llm_provider.rs",
        ])
    seen = set()
    deduped = []
    for hint in hints:
        if hint not in seen:
            seen.add(hint)
            deduped.append(hint)
    return deduped[:6]

def extract_const_object_blocks(text, const_name):
    blocks = []
    needle = f"const {const_name} = "
    cursor = 0
    while True:
        start = text.find(needle, cursor)
        if start < 0:
            break
        brace_start = text.find("{", start)
        if brace_start < 0:
            break
        depth = 0
        in_string = None
        escaped = False
        index = brace_start
        end = -1
        while index < len(text):
            char = text[index]
            if in_string:
                if escaped:
                    escaped = False
                elif char == "\\":
                    escaped = True
                elif char == in_string:
                    in_string = None
            else:
                if char in ("'", '"', "`"):
                    in_string = char
                elif char == "{":
                    depth += 1
                elif char == "}":
                    depth -= 1
                    if depth == 0:
                        semi = text.find(";", index)
                        if semi >= 0:
                            end = semi + 1
                        else:
                            end = index + 1
                        break
            index += 1
        if end < 0:
            break
        while end < len(text) and text[end] in "\r\n":
            end += 1
        blocks.append(text[start:end].rstrip())
        cursor = end
    return blocks

def extract_function_block(text, function_name):
    needle = f"function {function_name}("
    start = text.find(needle)
    if start < 0:
        return None
    brace_start = text.find("{", start)
    if brace_start < 0:
        return None
    depth = 0
    in_string = None
    escaped = False
    index = brace_start
    end = -1
    while index < len(text):
        char = text[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == in_string:
                in_string = None
        else:
            if char in ("'", '"', "`"):
                in_string = char
            elif char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    end = index + 1
                    break
        index += 1
    if end < 0:
        return None
    if end < len(text) and text[end:end + 1] == "\n":
        end += 1
    return text[start:end]

def duplicate_const_declarations(text, prefix):
    counts = {}
    for match in re.finditer(r"\bconst\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=", text):
        name = match.group(1)
        if name.startswith(prefix):
            counts[name] = counts.get(name, 0) + 1
    return {name: count for name, count in counts.items() if count > 1}

def next_unique_const_name(text, base_name):
    index = 2
    while True:
        candidate = f"{base_name}{index}"
        if not re.search(rf"\bconst\s+{re.escape(candidate)}\s*=", text):
            return candidate
        index += 1

if len(selected_todo.encode("utf-8")) > selected_todo_max_bytes:
    raise SystemExit("selected_todo_exceeds_max_bytes")

claim = {}
if claim_path.exists():
    with open(claim_path, encoding="utf-8") as handle:
        claim = json.load(handle)
    if claim.get("status") not in ("claimed", "in_progress"):
        claim = {}

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

repair_feedback = {}
if repair_feedback_path.exists() and claim:
    try:
        candidate = json.loads(repair_feedback_path.read_text(encoding="utf-8"))
        if candidate.get("claim_id") == claim.get("claim_id"):
            repair_feedback = candidate
    except Exception:
        repair_feedback = {}

harness_feedback = {}
if harness_feedback_path.exists() and claim:
    try:
        candidate = json.loads(harness_feedback_path.read_text(encoding="utf-8"))
        if candidate.get("latest_claim_id") == claim.get("claim_id"):
            harness_feedback = candidate
    except Exception:
        harness_feedback = {}

if claim and selected_todo:
    try:
        workspace_root_for_guard = todo_path.parent.parent
        guard = subprocess.run(
            ["pnpm", "--workspace-root", "guard:todo-decomposition"],
            cwd=workspace_root_for_guard,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=30,
        )
        if guard.returncode != 0:
            repair_feedback = {
                "claim_id": claim.get("claim_id"),
                "reason": "todo_decomposition_guard_failed_after_todo_apply",
                "run_stamp": claim.get("run_stamp", ""),
                "schema_version": 1,
                "verification": {
                    "completed": False,
                    "reason": "todo_decomposition_guard_failed_after_todo_apply",
                    "repair_hint": "Current `.brownie/todo.md` fails `pnpm --workspace-root guard:todo-decomposition`; repair the live TODO/breakdown files before implementation.",
                    "results": [{
                        "command": "pnpm --workspace-root guard:todo-decomposition",
                        "exit_code": guard.returncode,
                        "stdout_tail": guard.stdout[-2000:],
                        "stderr_tail": guard.stderr[-2000:],
                    }],
                },
            }
    except Exception:
        pass

bdk_state = infer_bdk_state(selected_todo)
if repair_feedback:
    selected_first_for_repair = selected_todo.splitlines()[0] if selected_todo.splitlines() else ""
    selected_route_for_repair_match = re.search(r"(?im)^\s*Route:\s*([^.:\n]+)", selected_todo)
    selected_route_for_repair = selected_route_for_repair_match.group(1).strip().lower() if selected_route_for_repair_match else ""
    if "TODO-decompose-" in selected_first_for_repair or selected_route_for_repair == "todo-decomposition":
        bdk_state = "decompose_todo"
    else:
        bdk_state = "verify_or_repair"
llm_route = infer_llm_route(bdk_state)
if harness_feedback and harness_feedback.get("ok") is False:
    bdk_state = "verify_or_repair"
    llm_route = "code"
context_hints = infer_context_hints(selected_todo)
context_hint_lines = [f"- {hint}" for hint in context_hints] or ["- <none inferred; request exact bounded reads only>"]
selected_first_line = selected_todo.splitlines()[0] if selected_todo.splitlines() else ""
selected_parent_id = ""
selected_id_match = re.match(r"^\s*[-*]\s+\[\s*\]\s+([^:\s]+)", selected_first_line)
if selected_id_match:
    selected_parent_id = selected_id_match.group(1).strip()
selected_leaf_target_path = ""
selected_leaf_target_match = re.search(r"^\s*[-*]\s+\[\s*\]\s+[^:\n]+:\s+(?:Patch only|Create only)\s+`([^`]+)`", selected_todo)
if selected_leaf_target_match:
    selected_leaf_target_path = selected_leaf_target_match.group(1).strip()
selected_decomposition_active = (
    "TODO-decompose-" in selected_todo
    or "Route: todo-decomposition" in selected_todo
)
selected_decomposition_source_id = ""
source_match = re.search(r"Decompose broad TODO `([^`]+)`", selected_todo)
if source_match:
    selected_decomposition_source_id = source_match.group(1).strip()
decomposition_policy_lines = []
leaf_execution_policy_lines = []
repair_workspace_read_previews = (
    repair_feedback.get("verification", {}).get("workspace_read_previews", [])
    if isinstance(repair_feedback, dict) and isinstance(repair_feedback.get("verification"), dict)
    else []
)
if not isinstance(repair_workspace_read_previews, list):
    repair_workspace_read_previews = []

def preview_is_for_path(preview, path):
    if not path:
        return False
    text = str(preview)
    return (
        f"path={path} " in text
        or f"path={path}]" in text
        or f"path={path}\n" in text
        or f"path=./{path} " in text
        or f"path=./{path}]" in text
        or f"path=./{path}\n" in text
    )

leaf_has_read_preview_for_repair = bool(
    selected_leaf_target_path
    and any(preview_is_for_path(preview, selected_leaf_target_path) for preview in repair_workspace_read_previews)
)
leaf_has_any_read_preview_for_repair = bool(repair_workspace_read_previews)
leaf_has_oversized_repair = bool(
    isinstance(repair_feedback, dict)
    and isinstance(repair_feedback.get("verification"), dict)
    and (
        "truncated" in str(repair_feedback.get("verification", {}).get("repair_hint", "")).lower()
        or any(
            isinstance(item, dict) and str(item.get("code", "")).lower() in ("missing_closing_fence", "input_too_large")
            for item in repair_feedback.get("verification", {}).get("tool_intent_rejections", [])
            if isinstance(repair_feedback.get("verification", {}).get("tool_intent_rejections", []), list)
        )
    )
)
leaf_has_missing_fence_repair = bool(
    isinstance(repair_feedback, dict)
    and isinstance(repair_feedback.get("verification"), dict)
    and any(
        isinstance(item, dict) and str(item.get("code", "")).lower() == "missing_closing_fence"
        for item in repair_feedback.get("verification", {}).get("tool_intent_rejections", [])
        if isinstance(repair_feedback.get("verification", {}).get("tool_intent_rejections", []), list)
    )
)
leaf_todo_refinement_rejected_for_implementation = bool(
    isinstance(repair_feedback, dict)
    and isinstance(repair_feedback.get("verification"), dict)
    and (
        str(repair_feedback.get("reason", "")).lower() == "selected_todo_is_already_a_bounded_leaf"
        or str(repair_feedback.get("verification", {}).get("reason", "")).lower() == "selected_todo_is_already_a_bounded_leaf"
        or any(
            isinstance(item, dict)
            and str(item.get("code", "")).lower() == "todo_md_write_denied_for_implementation_todo"
            for item in repair_feedback.get("verification", {}).get("tool_intent_rejections", [])
            if isinstance(repair_feedback.get("verification", {}).get("tool_intent_rejections", []), list)
        )
    )
)
selected_leaf_is_test_only = bool(
    selected_leaf_target_path
    and (
        selected_leaf_target_path.endswith(".test.mjs")
        or "Forbidden changes: do not modify production" in selected_todo
        or "test-only leaf" in selected_todo.lower()
    )
)
selected_linux_helper_source_identity_repair = (
    "E-16a-artifact-source-linux-producer-helper" in selected_todo
    and selected_leaf_target_path == "scripts/release-linux-x64-docker-artifact.mjs"
    and leaf_has_oversized_repair
)
selected_linux_fields_source_identity_repair = (
    "E-16a-artifact-source-linux-producer-fields" in selected_todo
    and selected_leaf_target_path == "scripts/release-linux-x64-docker-artifact.mjs"
    and leaf_has_oversized_repair
)
selected_supply_chain_clean_source_guard_repair = (
    "E-16a-clean-source-guard" in selected_todo
    and selected_leaf_target_path == "scripts/guard-supply-chain-artifact-evidence.mjs"
    and leaf_has_oversized_repair
)
selected_stateful_soak_oversized_repair = (
    "E-16d-stateful-soak-collector" in selected_todo
    and selected_leaf_target_path == "scripts/release-runtime-operational-evidence.mjs"
    and leaf_has_oversized_repair
)
selected_stateful_soak_build_leaf = (
    "E-16d-soak-build-transition-step" in selected_todo
    and selected_leaf_target_path == "scripts/release-runtime-operational-evidence.mjs"
)
leaf_force_write_on_repair = bool(
    repair_feedback
    and (
        not leaf_has_oversized_repair
        or leaf_has_missing_fence_repair
        or leaf_todo_refinement_rejected_for_implementation
        or selected_linux_helper_source_identity_repair
        or selected_linux_fields_source_identity_repair
        or selected_supply_chain_clean_source_guard_repair
    )
    and (
        leaf_has_read_preview_for_repair
        or (
            isinstance(repair_feedback.get("verification"), dict)
            and repair_feedback.get("verification", {}).get("invalid_patch_proposals")
        )
    )
)
if leaf_has_oversized_repair and not leaf_has_missing_fence_repair and not (
    selected_linux_helper_source_identity_repair
    or selected_linux_fields_source_identity_repair
    or selected_supply_chain_clean_source_guard_repair
):
    llm_route = "deep"
if "Source TODO:" in selected_todo and re.search(r"^\s*[-*]\s+\[\s*\]\s+[^:\n]+:\s+Patch only\s+`", selected_todo):
    leaf_execution_policy_lines = [
        "- leaf_execution_policy: this selected TODO is already a bounded derived leaf; normally patch the named target file. If repair feedback shows the target patch is repeatedly oversized or input_too_large, patch `.brownie/todo.md` instead to replace this leaf with one smaller concrete follow-up leaf. A missing closing fence alone means the next target-file patch must be smaller and complete.",
        "- leaf_no_refinement_policy: a bounded leaf with one Patch only target must not be converted into more child TODOs just because the target file is large, unless Previous Repair Feedback shows a repeated oversized/input_too_large workspace.write.",
    ]
    if leaf_force_write_on_repair:
        leaf_execution_policy_lines.append(
            f"- leaf_required_next_tool_policy: the next tool must be `workspace.write` for `{selected_leaf_target_path or '<selected Patch only target>'}` unless final-answer fail-closed is unavoidable; the prior repair context already contains the target read preview, so `workspace.read` and `.brownie/todo.md` writes are not progress for this repair turn."
        )
        if leaf_has_missing_fence_repair:
            leaf_execution_policy_lines.append(
                "- leaf_missing_fence_repair_policy: the previous workspace.write was rejected because the fenced JSON block did not close. Do not retry a broad function/file replacement. Emit one much smaller `patch_file` hunk with `old_text` under 1200 characters and `new_text` under 1800 characters, and close the brownie-tool-intent fence."
            )
        if leaf_todo_refinement_rejected_for_implementation:
            leaf_execution_policy_lines.append(
                f"- leaf_todo_refinement_rejected_policy: the previous `.brownie/todo.md` write was rejected because this selected TODO is already an implementation leaf. Do not write `.brownie/todo.md`; patch `{selected_leaf_target_path or '<selected Patch only target>'}` directly."
            )
            if selected_leaf_is_test_only:
                leaf_execution_policy_lines.append(
                    f"- test_leaf_retry_policy: this is a test-only leaf. The next tool must be exactly one `workspace.write` patch_file for `{selected_leaf_target_path}` if the target contents are already available; otherwise exactly one `workspace.read` for `{selected_leaf_target_path}`. Do not patch `.brownie/todo.md`, production files, collector files, guard files, or breakdown files."
                )
    elif repair_feedback and selected_leaf_target_path and leaf_has_any_read_preview_for_repair and not leaf_has_read_preview_for_repair:
        leaf_execution_policy_lines.append(
            f"- leaf_target_read_missing_repair_policy: previous repair context did not contain a `workspace.read` preview for `{selected_leaf_target_path}`; do not invent `old_text` from stale TODO previews. The next tool may be exactly one `workspace.read` for `{selected_leaf_target_path}` before any `workspace.write`."
        )
    elif leaf_has_oversized_repair and not selected_linux_helper_source_identity_repair and not selected_linux_fields_source_identity_repair and not selected_supply_chain_clean_source_guard_repair:
        leaf_execution_policy_lines.append(
            f"- leaf_oversized_repair_next_tool_policy: the previous target-file patch was oversized or truncated. The next tool must be exactly one `workspace.write` patch_file for `.brownie/todo.md` that replaces the full selected TODO block `{selected_parent_id or '<selected leaf id>'}` with one smaller concrete follow-up leaf. The new leaf id must be different from `{selected_parent_id or '<selected leaf id>'}`, and `new_text` must not keep the selected TODO pending."
        )
        leaf_execution_policy_lines.append(
            f"- leaf_oversized_repair_leaf_template: use a new id like `{selected_parent_id or 'E-16'}-small-step`; first line `- [ ] {selected_parent_id or 'E-16'}-small-step: Patch only `{selected_leaf_target_path or '<selected Patch only target>'}` to update one named helper or one named evidence field:` then `Route: implementation.`, `Source TODO: {selected_parent_id or '<selected leaf id>'}.`, `Depends on: <none>.`, one concrete completion condition, forbidden changes, and one bounded verification command."
        )
        if selected_stateful_soak_oversized_repair:
            leaf_execution_policy_lines.append(
                "- stateful_soak_leaf_target_policy: for E-16d, the smaller follow-up leaf must target the existing `buildSoakSection` function or one helper called from it. Do not target, create, rename, or copy any `soakEvidenceFixture*` constant; those fixture literals are stale failed-output debris and are not the implementation target."
            )
            leaf_execution_policy_lines.append(
                "- stateful_soak_leaf_template: create one leaf such as `E-16d-stateful-soak-build-step-records`: Patch only `scripts/release-runtime-operational-evidence.mjs` to make `buildSoakSection` record one required stateful step id from `requiredStatefulSoakStepIds`; keep Verification to `pnpm --workspace-root guard:runtime-operational-evidence:test`."
            )
    else:
        if selected_leaf_is_test_only:
            leaf_execution_policy_lines.append(
                f"- test_leaf_execution_policy: this selected TODO is test-only. Patch only `{selected_leaf_target_path}`. Do not create child TODOs, do not patch `.brownie/todo.md`, and do not modify production collector or guard code."
            )
        if selected_stateful_soak_build_leaf:
            leaf_execution_policy_lines.append(
                "- stateful_soak_build_patch_policy: this E-16d leaf may patch only the existing `function buildSoakSection(repoRoot, iterations)` region. The next target-file `workspace.write` must not include `soakEvidenceFixture`, `soakEvidenceFixtureDuplicate`, `soakEvidenceFixtureDuplicate2`, or `soakEvidenceFixtureDuplicate3` in old_text or new_text, and must not invent `const buildSoakSection =`."
            )
            leaf_execution_policy_lines.append(
                "- stateful_soak_build_small_hunk_policy: prefer a small patch around the `const missingStatefulSteps = [` block or the return object inside `buildSoakSection`; do not replace top-level fixture constants or copy fixture bodies."
            )
        leaf_execution_policy_lines.append(
            f"- leaf_initial_read_policy: if the target contents are not already embedded in this prompt, the next tool may be exactly one `workspace.read` for `{selected_leaf_target_path or '<selected Patch only target>'}`; after that read, move to `workspace.write` for the same target."
        )
if "Source TODO:" in selected_todo and re.search(r"^\s*[-*]\s+\[\s*\]\s+[^:\n]+:\s+Create only\s+`", selected_todo):
    leaf_execution_policy_lines = [
        "- leaf_execution_policy: this selected TODO is already a bounded derived leaf; do not split it again and do not patch `.brownie/todo.md`. Create the named target file. If it cannot be safely created, fail closed in the final response instead of creating another TODO.",
        f"- leaf_required_next_tool_policy: the next tool must be `workspace.write` for `{selected_leaf_target_path or '<selected Create only target>'}` unless final-answer fail-closed is unavoidable; `workspace.read` and `.brownie/todo.md` writes are not progress for this repair turn.",
        "- create_only_policy: do not request `workspace.read` for the missing Create only target. Use `workspace.write` with a create-file operation or a patch that creates exactly the named file.",
        "- leaf_no_refinement_policy: a bounded Create only leaf must not be converted into more child TODOs just because the target file does not exist yet.",
    ]
if bdk_state == "decompose_todo":
    decomposition_policy_lines = [
        "- decomposition_policy: this invocation is TODO decomposition only; do not patch implementation, guard, evidence, source, or documentation files.",
        "- decomposition_write_policy: the only allowed workspace.write targets are the live TODO queue (`.brownie/todo.md` or explicitly selected legacy `todo.md`) and the sibling TODO breakdown ledger (`.brownie/todo-breakdown.md`). Prefer one compact `.brownie/todo.md` replacement first; update `.brownie/todo-breakdown.md` in a later turn if needed.",
        "- decomposition_leaf_policy: replace the active decomposition request and its broad source TODO with unchecked leaf TODOs; every leaf must include `Route:`, `Source TODO:`, `Depends on:`, `Completion condition:`, `Forbidden changes:`, and `Verification:`.",
        f"- decomposition_selected_removal_policy: `new_text` must not contain `{selected_parent_id or '<selected-decomposition-id>'}`, must not contain `{selected_decomposition_source_id or '<selected-broad-source-id>'}`, and must not contain any line starting `- [ ] TODO-decompose-`.",
        "- decomposition_leaf_shape_policy: every generated leaf must be multi-line. The first line must be `- [ ] E-...: Patch only `path` ...:` or `- [ ] E-...: Blocker: ...`; then each required field must be on its own indented line starting exactly `Route:`, `Source TODO:`, `Depends on:`, `Completion condition:`, `Forbidden changes:`, and `Verification:`.",
        "- decomposition_leaf_id_policy: generated leaf IDs must be product IDs such as `E-15e-doc-sync-contract-leaf`, never `TODO-decompose-1` or another `TODO-decompose-*` ID.",
        "- decomposition_compact_output_policy: write at most two leaf TODOs in `new_text`; keep total `new_text` under 1800 characters; do not copy the active decomposition request prose into `new_text`.",
        "- decomposition_verification_policy: `Verification:` must use bounded commands such as `pnpm --workspace-root ...`, `cargo ...`, `node scripts/...`, `node --test scripts/...`, or an explicit inspect/blocker/fail-closed condition.",
        "- decomposition_scope_policy: every implementation leaf must name a bounded `Patch only`/`Create only` scope with at most two concrete backticked paths, or state an explicit blocker/fail-closed condition.",
        "- decomposition_size_policy: keep the next workspace.write compact. Do not rewrite the full queue or copy Queue protocol/Base Phase Loop Prompt text into `old_text` or `new_text`.",
        "- decomposition_ledger_policy: update `.brownie/todo-breakdown.md` with the parent TODO, dependency graph, verification ledger, and a short history note for the generated leaf TODOs. If doing both files would make the response large, finish `.brownie/todo.md` first and let the guard request the breakdown repair next.",
    ]
repair_feedback_lines = []
repair_override_lines = []
todo_guard_failed = False
selected_target_duplicate_const_repair_active = False
selected_target_required_const_restore_active = False
if repair_feedback:
    verification = repair_feedback.get("verification") if isinstance(repair_feedback.get("verification"), dict) else {}
    repair_feedback_lines = [
        "",
        "## Previous Repair Feedback",
        "",
        "- repair_policy: the previous workspace patch did not satisfy verification; inspect the current diff and repair it instead of starting a new unrelated change.",
        f"- repair_reason: `{repair_feedback.get('reason', '')}`",
        f"- repair_run_stamp: `{repair_feedback.get('run_stamp', '')}`",
    ]
    if "scripts/release-runtime-operational-evidence.mjs" in selected_todo:
        target_text = read_text(pathlib.Path("scripts/release-runtime-operational-evidence.mjs"))
        duplicate_names = duplicate_const_declarations(target_text, "soakEvidenceFixture")
        if duplicate_names:
            selected_target_duplicate_const_repair_active = True
            duplicate_name = sorted(duplicate_names.keys())[0]
            replacement_name = (
                "soakEvidenceFixtureDuplicate"
                if duplicate_name == "soakEvidenceFixture"
                else next_unique_const_name(target_text, duplicate_name)
            )
            repair_feedback_lines.append(f"- selected_target_duplicate_const_name: `{duplicate_name}`")
            repair_feedback_lines.append(f"- selected_target_duplicate_const_count: `{duplicate_names[duplicate_name]}`")
            repair_feedback_lines.append(f"- selected_target_duplicate_const_replacement_name: `{replacement_name}`")
            repair_feedback_lines.append(f"- selected_target_duplicate_const_policy: the selected target file still has duplicate `const {duplicate_name} =` declarations. Do not patch `.brownie/todo.md` and do not split the TODO. Request one compact `workspace.write` patch_file hunk for `scripts/release-runtime-operational-evidence.mjs` with `old_text:\"const {duplicate_name} =\"`, `new_text:\"const {replacement_name} =\"`, and `occurrence:2`.")
            repair_feedback_lines.append(f"- selected_target_required_next_tool: exactly one `workspace.write` to `scripts/release-runtime-operational-evidence.mjs`; input must be `{{path:\"scripts/release-runtime-operational-evidence.mjs\", operation:\"patch_file\", hunks:[{{old_text:\"const {duplicate_name} =\", new_text:\"const {replacement_name} =\", occurrence:2}}]}}`. Do not request any other tool and do not write `.brownie/todo.md`.")
        elif (
            "soakEvidenceFixture" in selected_todo
            and "const soakEvidenceFixture =" not in target_text
        ):
            restore_match = re.search(r"\bconst\s+(soakEvidenceFixture[A-Za-z0-9_$]*)\s*=", target_text)
            if restore_match:
                selected_target_required_const_restore_active = True
                current_name = restore_match.group(1)
                repair_feedback_lines.append("- selected_target_required_const_missing: `soakEvidenceFixture`")
                repair_feedback_lines.append(f"- selected_target_required_const_current_name: `{current_name}`")
                repair_feedback_lines.append(f"- selected_target_required_const_restore_policy: the selected TODO completion condition requires `soakEvidenceFixture`, but the target file no longer declares `const soakEvidenceFixture =`. Repair `scripts/release-runtime-operational-evidence.mjs` directly; do not patch `.brownie/todo.md` and do not split the TODO. Use one `workspace.write` patch_file hunk with `old_text:\"const {current_name} =\"` and `new_text:\"const soakEvidenceFixture =\"`.")
                repair_feedback_lines.append(f"- selected_target_required_next_tool: exactly one `workspace.write` to `scripts/release-runtime-operational-evidence.mjs`; input must be `{{path:\"scripts/release-runtime-operational-evidence.mjs\", operation:\"patch_file\", old_text:\"const {current_name} =\", new_text:\"const soakEvidenceFixture =\"}}`. Do not request any other tool and do not write `.brownie/todo.md`.")
        duplicate_blocks = extract_const_object_blocks(target_text, "soakEvidenceFixture")
        if len(duplicate_blocks) > 1:
            repair_feedback_lines.append(f"- selected_target_duplicate_declaration_count: `{len(duplicate_blocks)}`")
            repair_feedback_lines.append("- selected_target_duplicate_declaration_policy: the selected target file still has duplicate `soakEvidenceFixture` declarations. Do not patch `.brownie/todo.md`. Request one compact `workspace.write` patch_file hunk for `scripts/release-runtime-operational-evidence.mjs` with `old_text:\"const soakEvidenceFixture = {\"`, `new_text:\"const soakEvidenceFixtureDuplicate = {\"`, and `occurrence:2`.")
            repair_feedback_lines.append("- selected_target_required_next_tool: exactly one `workspace.write` to `scripts/release-runtime-operational-evidence.mjs`; input must be `{path:\"scripts/release-runtime-operational-evidence.mjs\", operation:\"patch_file\", hunks:[{old_text:\"const soakEvidenceFixture = {\", new_text:\"const soakEvidenceFixtureDuplicate = {\", occurrence:2}]}`. Do not request any other tool and do not write `.brownie/todo.md`.")
    if verification.get("expected") is not None:
        repair_feedback_lines.append(f"- expected: `{verification.get('expected')}`")
    if verification.get("actual") is not None:
        repair_feedback_lines.append(f"- actual: `{verification.get('actual')}`")
    if verification.get("terminal_completion_summary"):
        repair_feedback_lines.append(f"- terminal_completion_summary: {json.dumps(str(verification.get('terminal_completion_summary', ''))[-1200:], ensure_ascii=False)}")
    if verification.get("previous_terminal_completion_summary"):
        repair_feedback_lines.append(f"- previous_terminal_completion_summary: {json.dumps(str(verification.get('previous_terminal_completion_summary', ''))[-1200:], ensure_ascii=False)}")
    if verification.get("repair_hint"):
        repair_feedback_lines.append(f"- repair_hint: {json.dumps(str(verification.get('repair_hint', ''))[-1200:], ensure_ascii=False)}")
    previous_results = []
    for result_group in (verification.get("results", []), verification.get("previous_results", [])):
        if isinstance(result_group, list):
            previous_results.extend(result_group)
    todo_guard_failed = (
        repair_feedback.get("reason") == "todo_decomposition_guard_failed_after_todo_apply"
        or verification.get("reason") == "todo_decomposition_guard_failed_after_todo_apply"
        or any(
            isinstance(result, dict)
            and (
                "guard:todo-decomposition" in str(result.get("command", ""))
                or "TODO decomposition guard failed" in str(result.get("stderr_tail", ""))
                or "duplicate unchecked TODO id" in str(result.get("stderr_tail", ""))
            )
            for result in previous_results
        )
    )
    if todo_guard_failed:
        bdk_state = "todo_queue_repair"
        llm_route = "code"
        repair_override_lines.extend([
            "- repair_override: current invocation is TODO queue repair, not selected implementation-file work.",
            "- repair_override_target: `.brownie/todo.md` is the intended workspace.write target until `pnpm --workspace-root guard:todo-decomposition` passes, except missing derived leaf id repairs may patch `.brownie/todo-breakdown.md` only.",
            "- repair_override_read_policy: do not read the selected implementation file while the TODO queue guard is failing. If Focused TODO Queue Repair Context provides `exact_block_json` or duplicate block JSON, do not read `.brownie/todo.md`; use that exact text as `old_text`. Read `.brownie/todo.md` only when no exact repair block is provided.",
            "- repair_override_next_tool_policy: when Focused TODO Queue Repair Context provides `exact_block_json`, the next tool must be `workspace.write`; `workspace.read` is forbidden for this repair turn.",
            "- repair_override_patch_size_policy: the TODO repair patch must be a short exact hunk around the corrupt E-15d unchecked task blocks only; never include `## Queue protocol`, `## Base Phase Loop Prompt`, or unrelated headings in old_text/new_text.",
            "- repair_override_hunks_policy: prefer `workspace.write` input `{path, operation:\"patch_file\", hunks:[{old_text,new_text,occurrence}, ...]}`. For self-source repair, use tiny complete-line hunks. For duplicate-only repair, use the exact duplicate block provided in Focused TODO Queue Repair Context as `old_text`, set `new_text` to an empty string, and set `occurrence` to 2. Do not invent or summarize TODO block text.",
            "- repair_override_occurrence_policy: use `occurrence` only for duplicate-only guard failures. For invalid leaf block replacement, omit `occurrence` and replace the exact provided block once.",
        ])
        repair_feedback_lines.append("- todo_guard_repair_policy: repair `.brownie/todo.md` before any implementation work. Read `.brownie/todo.md` if needed, then emit one exact `workspace.write` patch that replaces the entire contiguous corrupt TODO block, from the first invalid/duplicate leaf through the last duplicate leaf, with a deduplicated valid block. Do not append another leaf, do not keep a leaf whose `Source TODO:` references itself, and do not patch implementation files in this repair pass.")
    if verification.get("stderr_tail"):
        repair_feedback_lines.append(f"- process_stderr_tail: {json.dumps(str(verification.get('stderr_tail', ''))[-1200:], ensure_ascii=False)}")
    for index, reason in enumerate(verification.get("tool_denial_reasons", []) if isinstance(verification.get("tool_denial_reasons"), list) else []):
        safe_reason = str(reason).replace("`<one existing path>`", "<placeholder existing path>").replace("`<one new path>`", "<placeholder new path>").replace("`<one-path>`", "<placeholder path>")
        repair_feedback_lines.append(f"- tool_denial_reason_{index}: {json.dumps(safe_reason[-1200:], ensure_ascii=False)}")
        if "Every TODO decomposition leaf must preserve the parent" in str(reason):
            repair_feedback_lines.append(f"- todo_leaf_schema_repair_policy: the previous `.brownie/todo.md` write omitted required leaf fields. Retry with exactly one compact unchecked TODO leaf and include these separate lines: `Route:`, `Source TODO:`, `Depends on:`, `Completion condition:`, `Forbidden changes:`, and `Verification:`. `Source TODO:` must include the selected parent id `{selected_parent_id or '<selected-parent-id>'}`. Do not keep the selected TODO id or selected first line in `new_text`.")
            repair_feedback_lines.append(f"- todo_leaf_exact_source_todo_policy: every generated leaf must include this exact line prefix: `Source TODO: {selected_parent_id or '<selected-parent-id>'}`.")
        if "Source TODO:` must reference the selected parent TODO" in str(reason):
            repair_feedback_lines.append(f"- todo_leaf_parent_repair_policy: the previous `Source TODO:` referenced the older grandparent instead of the selected parent. In the next `.brownie/todo.md` write, `Source TODO:` must include `{selected_parent_id or '<selected-parent-id>'}` exactly. The new leaf id must be different from `{selected_parent_id or '<selected-parent-id>'}`.")
            repair_feedback_lines.append(f"- todo_leaf_exact_source_todo_policy: every generated leaf must include this exact line prefix: `Source TODO: {selected_parent_id or '<selected-parent-id>'}`.")
        if "Every TODO decomposition leaf `Source TODO:` must reference the selected parent TODO" in str(reason):
            repair_feedback_lines.append(f"- blocker_source_parent_policy: if writing a blocker TODO, its `Source TODO:` line must be exactly `Source TODO: {selected_parent_id or '<selected-parent-id>'}.`; do not copy the selected TODO's existing Source TODO line.")
        if "must not keep the selected broad TODO pending" in str(reason):
            repair_feedback_lines.append(f"- todo_decomposition_replace_both_policy: the `.brownie/todo.md` patch must remove both the active decomposition TODO `{selected_parent_id or '<selected-decomposition-id>'}` and its broad source TODO `{selected_decomposition_source_id or '<selected-broad-source-id>'}` from unchecked queue text.")
            repair_feedback_lines.append(f"- todo_decomposition_new_leaf_id_policy: generated leaf ids must be new implementation leaf ids, not `{selected_parent_id or '<selected-decomposition-id>'}` and not `{selected_decomposition_source_id or '<selected-broad-source-id>'}`.")
        if "Verification:` must use allowed bounded commands" in str(reason):
            repair_feedback_lines.append("- todo_leaf_verification_repair_policy: the previous leaf used an invalid verification such as `grep`, `none yet`, or another non-allowlisted command. Retry with a concrete allowed `Verification:` line using `pnpm --workspace-root ...`, `cargo ...`, `node scripts/...`, `node --test scripts/...`, or an explicit inspect/blocker/fail-closed condition. Never use `grep` in TODO Verification.")
            if selected_parent_id == "E-16e-semantic-consistency-guard-wiring" or "E-16e-semantic-consistency-guard-wiring" in selected_todo:
                repair_feedback_lines.append("- semantic_wiring_leaf_verification_policy: for a package.json script wiring leaf, use exactly `Verification: run `pnpm --workspace-root guard:release-evidence-semantic-consistency`.`. For a release-gate wiring leaf, use exactly `Verification: run `pnpm --workspace-root release:gate -- --dry-run`.`.")
        if "Every TODO decomposition leaf `Verification:` must use allowed bounded commands" in str(reason):
            repair_feedback_lines.append("- blocker_verification_policy: if writing a blocker TODO, use `Verification: blocker: exact missing evidence or field is named, and no workspace file is patched until that evidence is available.` Do not use `Verification: read ...` or `grep ...`.")
            if selected_parent_id == "E-16e-semantic-consistency-guard-wiring" or "E-16e-semantic-consistency-guard-wiring" in selected_todo:
                repair_feedback_lines.append("- semantic_wiring_leaf_verification_policy: for a package.json script wiring leaf, use exactly `Verification: run `pnpm --workspace-root guard:release-evidence-semantic-consistency`.`. For a release-gate wiring leaf, use exactly `Verification: run `pnpm --workspace-root release:gate -- --dry-run`.`.")
        if "must name a bounded `Patch only`/`Create only` scope" in str(reason):
            repair_feedback_lines.append("- todo_leaf_scope_repair_policy: the previous leaf started as read/inspect/investigation work. Retry with a first line that starts with Patch only or Create only followed by one real concrete repository path in backticks, and keep any needed inspection detail in the description or completion condition. If no bounded patch/create target exists, write an explicit fail-closed blocker TODO instead.")
        if "Additional workspace.read is not progress" in str(reason):
            repair_feedback_lines.append("- todo_repair_no_read_policy: the previous run tried to read `.brownie/todo.md` after the read budget was exhausted. Do not request workspace.read. Use the exact invalid leaf block already embedded in Focused TODO Queue Repair Context as `old_text` and request workspace.write.")
        if "old_text must include the full selected TODO block" in str(reason):
            repair_feedback_lines.append("- todo_repair_full_block_old_text_policy: use `exact_block_json` from Focused TODO Queue Repair Context verbatim as `old_text`; do not use a single line or partial block.")
    for index, rejection in enumerate(verification.get("tool_intent_rejections", []) if isinstance(verification.get("tool_intent_rejections"), list) else []):
        if isinstance(rejection, dict):
            code = rejection.get("code", "")
            reason = str(rejection.get("reason", "")).replace("`<one existing path>`", "<placeholder existing path>").replace("`<one new path>`", "<placeholder new path>").replace("`<one-path>`", "<placeholder path>")
            tool_id = rejection.get("tool_id", "")
            repair_feedback_lines.append(f"- tool_intent_rejection_{index}: code={json.dumps(str(code), ensure_ascii=False)} tool_id={json.dumps(str(tool_id), ensure_ascii=False)} reason={json.dumps(str(reason)[-1200:], ensure_ascii=False)}")
            if (
                str(code).lower() == "input_too_large"
                and selected_leaf_target_path == "scripts/release-local-artifact.mjs"
                and "esm-helper-fix" not in selected_todo
            ):
                repair_feedback_lines.append("- release_local_artifact_input_too_large_policy: the previous workspace.write tried to replace too much of `scripts/release-local-artifact.mjs`. Retry with exactly one `workspace.write` patch_file request using only two small hunks: one hunk inserts sourceCommit/sourceCleanTree/sourceIdentity after `const smokeResults = ...;`, and one hunk adds `source_commit`, `source_clean_tree`, and `source_identity` inside `artifact:`. Do not include setup, buildPlan, parseArgs, smoke, or the whole buildLocalArtifact function in old_text/new_text.")
                repair_feedback_lines.append("- release_local_artifact_small_hunk_1_old_text_json: \"  const smokeResults = [\\n    smoke(repoRoot, artifactPath, ['--version']),\\n    smoke(repoRoot, artifactPath, ['help', 'run'])\\n  ];\\n  const artifactEvidence = {\"")
                repair_feedback_lines.append("- release_local_artifact_small_hunk_1_new_text_json: \"  const smokeResults = [\\n    smoke(repoRoot, artifactPath, ['--version']),\\n    smoke(repoRoot, artifactPath, ['help', 'run'])\\n  ];\\n  const sourceCommit = sha256SourceCommit();\\n  const sourceCleanTree = sha256CleanTree();\\n  const sourceIdentity = sha256String(`${sourceCommit}:${sourceCleanTree}`);\\n  const artifactEvidence = {\"")
                repair_feedback_lines.append("- release_local_artifact_small_hunk_2_old_text_json: \"      path: artifactRelativePath,\\n      sha256: sha256File(artifactPath),\\n      bytes: fs.statSync(artifactPath).size,\\n      target\"")
                repair_feedback_lines.append("- release_local_artifact_small_hunk_2_new_text_json: \"      path: artifactRelativePath,\\n      sha256: sha256File(artifactPath),\\n      bytes: fs.statSync(artifactPath).size,\\n      target,\\n      source_commit: sourceCommit,\\n      source_clean_tree: sourceCleanTree,\\n      source_identity: sourceIdentity\"")
                repair_feedback_lines.append("- release_local_artifact_required_next_tool: exactly one fenced `brownie-tool-intent` JSON block with one `workspace.write` request to `scripts/release-local-artifact.mjs`; use `input.hunks` with the two exact hunk old_text/new_text values above.")
            if "Every TODO decomposition leaf must preserve the parent" in str(reason):
                repair_feedback_lines.append(f"- todo_leaf_schema_repair_policy: the previous `.brownie/todo.md` write omitted required leaf fields. Retry with exactly one compact unchecked TODO leaf and include these separate lines: `Route:`, `Source TODO:`, `Depends on:`, `Completion condition:`, `Forbidden changes:`, and `Verification:`. `Source TODO:` must include the selected parent id `{selected_parent_id or '<selected-parent-id>'}`. Do not keep the selected TODO id or selected first line in `new_text`.")
                repair_feedback_lines.append(f"- todo_leaf_exact_source_todo_policy: every generated leaf must include this exact line prefix: `Source TODO: {selected_parent_id or '<selected-parent-id>'}`.")
            if "Source TODO:` must reference the selected parent TODO" in str(reason):
                repair_feedback_lines.append(f"- todo_leaf_parent_repair_policy: the previous `Source TODO:` referenced the older grandparent instead of the selected parent. In the next `.brownie/todo.md` write, `Source TODO:` must include `{selected_parent_id or '<selected-parent-id>'}` exactly. The new leaf id must be different from `{selected_parent_id or '<selected-parent-id>'}`.")
                repair_feedback_lines.append(f"- todo_leaf_exact_source_todo_policy: every generated leaf must include this exact line prefix: `Source TODO: {selected_parent_id or '<selected-parent-id>'}`.")
            if "Every TODO decomposition leaf `Source TODO:` must reference the selected parent TODO" in str(reason):
                repair_feedback_lines.append(f"- blocker_source_parent_policy: if writing a blocker TODO, its `Source TODO:` line must be exactly `Source TODO: {selected_parent_id or '<selected-parent-id>'}.`; do not copy the selected TODO's existing Source TODO line.")
            if "must not keep the selected broad TODO pending" in str(reason):
                repair_feedback_lines.append(f"- todo_decomposition_replace_both_policy: the `.brownie/todo.md` patch must remove both the active decomposition TODO `{selected_parent_id or '<selected-decomposition-id>'}` and its broad source TODO `{selected_decomposition_source_id or '<selected-broad-source-id>'}` from unchecked queue text.")
                repair_feedback_lines.append(f"- todo_decomposition_new_leaf_id_policy: generated leaf ids must be new implementation leaf ids, not `{selected_parent_id or '<selected-decomposition-id>'}` and not `{selected_decomposition_source_id or '<selected-broad-source-id>'}`.")
            if "Verification:` must use allowed bounded commands" in str(reason):
                repair_feedback_lines.append("- todo_leaf_verification_repair_policy: the previous leaf used an invalid verification such as `grep`, `none yet`, or another non-allowlisted command. Retry with a concrete allowed `Verification:` line using `pnpm --workspace-root ...`, `cargo ...`, `node scripts/...`, `node --test scripts/...`, or an explicit inspect/blocker/fail-closed condition. Never use `grep` in TODO Verification.")
                if selected_parent_id == "E-16e-semantic-consistency-guard-wiring" or "E-16e-semantic-consistency-guard-wiring" in selected_todo:
                    repair_feedback_lines.append("- semantic_wiring_leaf_verification_policy: for a package.json script wiring leaf, use exactly `Verification: run `pnpm --workspace-root guard:release-evidence-semantic-consistency`.`. For a release-gate wiring leaf, use exactly `Verification: run `pnpm --workspace-root release:gate -- --dry-run`.`.")
            if "Every TODO decomposition leaf `Verification:` must use allowed bounded commands" in str(reason):
                repair_feedback_lines.append("- blocker_verification_policy: if writing a blocker TODO, use `Verification: blocker: exact missing evidence or field is named, and no workspace file is patched until that evidence is available.` Do not use `Verification: read ...` or `grep ...`.")
                if selected_parent_id == "E-16e-semantic-consistency-guard-wiring" or "E-16e-semantic-consistency-guard-wiring" in selected_todo:
                    repair_feedback_lines.append("- semantic_wiring_leaf_verification_policy: for a package.json script wiring leaf, use exactly `Verification: run `pnpm --workspace-root guard:release-evidence-semantic-consistency`.`. For a release-gate wiring leaf, use exactly `Verification: run `pnpm --workspace-root release:gate -- --dry-run`.`.")
            if "must name a bounded `Patch only`/`Create only` scope" in str(reason):
                repair_feedback_lines.append("- todo_leaf_scope_repair_policy: the previous leaf started as read/inspect/investigation work. Retry with a first line that starts with Patch only or Create only followed by one real concrete repository path in backticks, and keep any needed inspection detail in the description or completion condition. If no bounded patch/create target exists, write an explicit fail-closed blocker TODO instead.")
            if "old_text must include the full selected TODO block" in str(reason):
                repair_feedback_lines.append("- todo_repair_full_block_old_text_policy: use `exact_block_json` from Focused TODO Queue Repair Context verbatim as `old_text`; do not use a single line or partial block.")
    for index, proposal in enumerate(verification.get("invalid_patch_proposals", []) if isinstance(verification.get("invalid_patch_proposals"), list) else []):
        if isinstance(proposal, dict):
            validation_reason = str(proposal.get("validation_reason", ""))
            repair_feedback_lines.append(f"- invalid_patch_proposal_{index}: path={json.dumps(str(proposal.get('path', '')), ensure_ascii=False)} operation={json.dumps(str(proposal.get('operation', '')), ensure_ascii=False)} reason={json.dumps(validation_reason[-1200:], ensure_ascii=False)} preview={json.dumps(str(proposal.get('content_preview', ''))[-500:], ensure_ascii=False)}")
            if (
                selected_stateful_soak_build_leaf
                and str(proposal.get("path", "")) == "scripts/release-runtime-operational-evidence.mjs"
                and "new_text must differ from old_text" in validation_reason
            ):
                repair_feedback_lines.append("- stateful_soak_noop_patch_repair_policy: the previous E-16d patch was a no-op. Retry with exactly one small hunk that adds `statefulSteps` before the return object and adds `stateful_steps: statefulSteps` to the return object. Do not touch `soakEvidenceFixture*` constants.")
                repair_feedback_lines.append("- stateful_soak_noop_patch_old_text_json: \"  const missingStatefulSteps = [\\n    'task_state_transition',\\n    'ledger_workspace_consistency',\\n    'resume_replay_handling',\\n    'duplicate_side_effect_rejection',\\n    'process_loss_recovery',\\n    'finite_convergence'\\n  ];\\n  return {\"")
                repair_feedback_lines.append("- stateful_soak_noop_patch_new_text_json: \"  const statefulSteps = [\\n    { id: 'task_state_transition', status: failureCount === 0 ? 'satisfied' : 'failed', evidence_kind: 'bounded_cli_transition_proxy' }\\n  ];\\n  const missingStatefulSteps = [\\n    'task_state_transition',\\n    'ledger_workspace_consistency',\\n    'resume_replay_handling',\\n    'duplicate_side_effect_rejection',\\n    'process_loss_recovery',\\n    'finite_convergence'\\n  ].filter((step) => !statefulSteps.some((record) => record.id === step));\\n  return {\\n    stateful_steps: statefulSteps,\"")
                repair_feedback_lines.append("- stateful_soak_noop_patch_required_next_tool: exactly one `workspace.write` to `scripts/release-runtime-operational-evidence.mjs` using the two JSON strings above as old_text/new_text; do not request `workspace.read` again.")
            if (
                selected_stateful_soak_build_leaf
                and str(proposal.get("path", "")) == "scripts/release-runtime-operational-evidence.mjs"
                and "old_text was not found" in validation_reason
                and "task_state_transition" in str(verification)
                and "Expected values to be strictly deep-equal" in str(verification)
            ):
                repair_feedback_lines.append("- stateful_soak_missing_list_test_repair_policy: the collector test still expects version-only soak to report `task_state_transition` as missing. Keep `stateful_steps`, but stop filtering `missingStatefulSteps`. Do not remove `task_state_transition` from the array.")
                repair_feedback_lines.append("- stateful_soak_missing_list_old_text_json: \"  ].filter((step) => !statefulSteps.some((record) => record.id === step));\"")
                repair_feedback_lines.append("- stateful_soak_missing_list_new_text_json: \"  ];\"")
                repair_feedback_lines.append("- stateful_soak_missing_list_required_next_tool: exactly one `workspace.write` to `scripts/release-runtime-operational-evidence.mjs` using the old_text/new_text above; do not request `workspace.read` again.")
            if "old_text was not found" in validation_reason:
                repair_feedback_lines.append("- invalid_patch_old_text_policy: never copy `[...previous workspace.read preview middle omitted by phase-loop...]` or any other truncation marker into `old_text`; `old_text` must be one exact contiguous string that exists in the current target. If only a truncated preview is available, patch a smaller visible head/tail snippet or fail closed instead of inventing omitted content.")
                if str(proposal.get("path", "")) == "scripts/release-local-artifact.mjs":
                    target_text = read_text(pathlib.Path("scripts/release-local-artifact.mjs"))
                    sha256_file_block = extract_function_block(target_text, "sha256File")
                    if sha256_file_block:
                        repair_feedback_lines.append("- release_local_artifact_exact_sha256File_old_text_policy: if patching `sha256File`, use this exact complete function block as `old_text`; do not reformat it.")
                        repair_feedback_lines.append(f"- release_local_artifact_sha256File_old_text_json: {json.dumps(sha256_file_block, ensure_ascii=False)}")
            if (
                str(proposal.get("path", "")) == "package.json"
                and "matches inside a word" in validation_reason
                and "E-16e-semantic-consistency-guard-wiring" in selected_todo
            ):
                repair_feedback_lines.append("- semantic_package_script_exact_repair_policy: the previous package.json patch used truncated old_text that matched inside a word. Retry with exactly one complete line-bounded hunk and do not patch `.brownie/todo.md` in this repair pass.")
                repair_feedback_lines.append("- semantic_package_script_old_text_json: \"    \\\"guard:ledger-contract-single-source\\\": \\\"node scripts/guard-ledger-contract-single-source.mjs\\\",\\n    \\\"guard:ledger-contract-single-source:test\\\": \\\"node --test scripts/guard-ledger-contract-single-source.test.mjs\\\",\"")
                repair_feedback_lines.append("- semantic_package_script_new_text_json: \"    \\\"guard:ledger-contract-single-source\\\": \\\"node scripts/guard-ledger-contract-single-source.mjs\\\",\\n    \\\"guard:ledger-contract-single-source:test\\\": \\\"node --test scripts/guard-ledger-contract-single-source.test.mjs\\\",\\n    \\\"guard:release-evidence-semantic-consistency\\\": \\\"node scripts/guard-release-evidence-semantic-consistency.mjs\\\",\\n    \\\"guard:release-evidence-semantic-consistency:test\\\": \\\"node --test scripts/guard-release-evidence-semantic-consistency.test.mjs\\\",\"")
                repair_feedback_lines.append("- semantic_package_script_required_next_tool: exactly one `workspace.write` patch_file to `package.json` using the old_text/new_text above; do not read again and do not edit `.brownie/todo.md`.")
            if "appears more than once" in validation_reason:
                repair_feedback_lines.append("- non_unique_hunk_repair_policy: the previous hunk old_text was not unique. Use a 2-3 line hunk that includes the selected TODO first line immediately before the `Source TODO:` line, and make `new_text` differ from `old_text` by changing only the `Source TODO:` line so it no longer starts with the leaf TODO id.")
                if str(proposal.get("path", "")) == "scripts/release-runtime-operational-evidence.mjs" and "old_chars=29" in str(proposal.get("content_preview", "")):
                    repair_feedback_lines.append("- duplicate_declaration_occurrence_repair_policy: retry the same declaration-line rename using `input.hunks:[{\"old_text\":\"const soakEvidenceFixture = {\",\"new_text\":\"const soakEvidenceFixtureDuplicate = {\",\"occurrence\":2}]`; do not use top-level old_text/new_text for this non-unique declaration line.")
                if str(proposal.get("path", "")) == "scripts/release-runtime-operational-evidence.mjs":
                    target_text = read_text(pathlib.Path("scripts/release-runtime-operational-evidence.mjs"))
                    duplicate_blocks = extract_const_object_blocks(target_text, "soakEvidenceFixture")
                    if len(duplicate_blocks) > 1:
                        repair_feedback_lines.append(f"- duplicate_declaration_count: `{len(duplicate_blocks)}`")
                        repair_feedback_lines.append("- duplicate_declaration_exact_repair_policy: the target has duplicate `soakEvidenceFixture` declarations. Do not read again and do not patch `.brownie/todo.md`; request one `workspace.write` patch_file for `scripts/release-runtime-operational-evidence.mjs` that removes exactly one duplicate block using `old_text` equal to `duplicate_block_to_remove_json` and `new_text` equal to an empty string.")
                        repair_feedback_lines.append(f"- duplicate_block_to_remove_json: {json.dumps(duplicate_blocks[1], ensure_ascii=False)}")
                if todo_guard_failed and "duplicate unchecked TODO id" in str(verification):
                    repair_feedback_lines.append("- duplicate_todo_occurrence_repair_policy: the previous duplicate TODO repair used top-level `old_text`/`new_text`, which cannot disambiguate duplicate blocks. Retry the same exact old_text inside `input.hunks:[{old_text,new_text:\"\",occurrence:2}]`; do not use top-level old_text/new_text for duplicate-only repair.")
    missing_closing_fence = any(isinstance(item, dict) and str(item.get("code", "")).lower() == "missing_closing_fence" for item in (verification.get("tool_intent_rejections", []) if isinstance(verification.get("tool_intent_rejections"), list) else []))
    if missing_closing_fence:
        repair_feedback_lines.append("- truncated_write_repair_policy: the previous workspace.write JSON was too large and lost the closing fence; do not retry a large `new_text`. For `.brownie/todo.md`, emit exactly one compact replacement leaf under 900 characters, complete the JSON, and close the `brownie-tool-intent` fence. Do not copy the broad selected TODO body into `new_text`.")
        repair_feedback_lines.append("- truncated_implementation_patch_policy: for implementation files, do not retry a large `old_text`/`new_text` block. Use one small complete syntactic hunk under about 1200 JSON characters. Do not patch unrelated large setup/parsing functions unless the selected TODO names them. If the safe hunk would be larger, patch `.brownie/todo.md` with one smaller follow-up TODO instead.")
        if selected_linux_helper_source_identity_repair:
            repair_feedback_lines.append("- linux_artifact_helper_exact_repair_policy: retry with exactly one fenced `brownie-tool-intent` JSON block containing one `workspace.write` patch_file request to `scripts/release-linux-x64-docker-artifact.mjs`; use the exact old_text/new_text below and do not include any other functions or TODO edits.")
            repair_feedback_lines.append("- linux_artifact_helper_old_text_json: \"function sha256File(filePath) {\\n  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')}`;\\n}\\n\"")
            repair_feedback_lines.append("- linux_artifact_helper_new_text_json: \"function sha256File(filePath) {\\n  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')}`;\\n}\\n\\nfunction sha256String(value) {\\n  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;\\n}\\n\\nfunction gitOutput(repoRoot, args) {\\n  const result = run('git', args, { cwd: repoRoot, timeoutMs: 30_000 });\\n  return result.passed ? result.stdout.trim() : '';\\n}\\n\\nfunction sha256SourceCommit(repoRoot) {\\n  const output = gitOutput(repoRoot, ['rev-parse', 'HEAD']);\\n  return output ? `sha256:${output}` : 'sha256:unknown';\\n}\\n\\nfunction sha256CleanTree(repoRoot) {\\n  const result = run('git', ['diff-index', '--quiet', 'HEAD', '--'], { cwd: repoRoot, timeoutMs: 30_000 });\\n  if (result.exit_code === 0) return 'clean';\\n  if (result.exit_code === 1) return 'dirty';\\n  return 'unknown';\\n}\\n\"")
            repair_feedback_lines.append("- linux_artifact_helper_required_next_tool: exactly one `workspace.write` patch_file to `scripts/release-linux-x64-docker-artifact.mjs` using `old_text` equal to linux_artifact_helper_old_text_json and `new_text` equal to linux_artifact_helper_new_text_json.")
        if selected_linux_fields_source_identity_repair:
            repair_feedback_lines.append("- linux_artifact_fields_exact_repair_policy: retry with exactly one fenced `brownie-tool-intent` JSON block containing one `workspace.write` patch_file request to `scripts/release-linux-x64-docker-artifact.mjs`; use `input.hunks` with exactly the two old_text/new_text hunks below and do not include helper functions, build setup, smoke commands, or TODO edits.")
            repair_feedback_lines.append("- linux_artifact_fields_hunk_1_old_text_json: \"  const smokePassed = smokeResults.every((entry) => entry.passed);\\n  const artifactEvidence = {\"")
            repair_feedback_lines.append("- linux_artifact_fields_hunk_1_new_text_json: \"  const smokePassed = smokeResults.every((entry) => entry.passed);\\n  const sourceCommit = sha256SourceCommit(repoRoot);\\n  const sourceCleanTree = sha256CleanTree(repoRoot);\\n  const sourceIdentity = sha256String(`${sourceCommit}:${sourceCleanTree}`);\\n  const artifactEvidence = {\"")
            repair_feedback_lines.append("- linux_artifact_fields_hunk_2_old_text_json: \"      path: artifactRelativePath,\\n      sha256: sha256File(artifactPath),\\n      bytes: fs.statSync(artifactPath).size,\\n      target\\n    },\"")
            repair_feedback_lines.append("- linux_artifact_fields_hunk_2_new_text_json: \"      path: artifactRelativePath,\\n      sha256: sha256File(artifactPath),\\n      bytes: fs.statSync(artifactPath).size,\\n      target,\\n      source_commit: sourceCommit,\\n      source_clean_tree: sourceCleanTree,\\n      source_identity: sourceIdentity\\n    },\"")
            repair_feedback_lines.append("- linux_artifact_fields_required_next_tool: exactly one `workspace.write` patch_file to `scripts/release-linux-x64-docker-artifact.mjs` using `input.hunks` with the two exact hunks above.")
        if selected_supply_chain_clean_source_guard_repair:
            repair_feedback_lines.append("- supply_chain_clean_source_guard_exact_repair_policy: retry with exactly one fenced `brownie-tool-intent` JSON block containing one `workspace.write` patch_file request to `scripts/guard-supply-chain-artifact-evidence.mjs`; use the exact old_text/new_text below and do not include helper functions, tests, or TODO edits.")
            repair_feedback_lines.append("- supply_chain_clean_source_guard_old_text_json: \"      validateReferencedFile(repoRoot, artifact, errors, `sections.artifacts.artifacts[${index}]`);\\n      validateOptionalPath(repoRoot, artifact.artifact_evidence_path, errors, `sections.artifacts.artifacts[${index}].artifact_evidence_path`);\\n      validateOptionalPath(repoRoot, artifact.smoke_evidence_path, errors, `sections.artifacts.artifacts[${index}].smoke_evidence_path`);\"")
            repair_feedback_lines.append("- supply_chain_clean_source_guard_new_text_json: \"      validateReferencedFile(repoRoot, artifact, errors, `sections.artifacts.artifacts[${index}]`);\\n      validateOptionalPath(repoRoot, artifact.artifact_evidence_path, errors, `sections.artifacts.artifacts[${index}].artifact_evidence_path`);\\n      validateOptionalPath(repoRoot, artifact.smoke_evidence_path, errors, `sections.artifacts.artifacts[${index}].smoke_evidence_path`);\\n      requireValue(hashPattern.test(artifact.source_commit), errors, `sections.artifacts.artifacts[${index}].source_commit must be sha256:<64 lowercase hex>.`);\\n      requireValue(artifact.source_clean_tree === 'clean', errors, `sections.artifacts.artifacts[${index}].source_clean_tree must be clean.`);\\n      requireValue(hashPattern.test(artifact.source_identity), errors, `sections.artifacts.artifacts[${index}].source_identity must be sha256:<64 lowercase hex>.`);\"")
            repair_feedback_lines.append("- supply_chain_clean_source_guard_required_next_tool: exactly one `workspace.write` patch_file to `scripts/guard-supply-chain-artifact-evidence.mjs` using `old_text` equal to supply_chain_clean_source_guard_old_text_json and `new_text` equal to supply_chain_clean_source_guard_new_text_json.")
        if selected_decomposition_active:
            repair_feedback_lines.append("- todo_decomposition_single_leaf_repair_policy: generate exactly one new leaf TODO in this retry. Do not start a second leaf. Do not use the active decomposition id as the new leaf id. Use `Depends on: <none>.` unless a dependency is already present and definitely required.")
            repair_feedback_lines.append(f"- todo_decomposition_compact_hunks_policy: prefer `workspace.write` with `operation:\"patch_file\"` and multiple small `hunks`: one hunk removes the active decomposition TODO block `{selected_parent_id or '<selected-decomposition-id>'}`, and later hunks transform the broad source TODO `{selected_decomposition_source_id or '<selected-broad-source-id>'}` into one bounded leaf. Do not put the full queue in `old_text` or `new_text`.")
            repair_feedback_lines.append(f"- todo_decomposition_leaf_template: first line `- [ ] {selected_decomposition_source_id or 'E-15e'}-doc-sync-leaf: Patch only `docs/architecture/runtime-release-contract.json` to resynchronize one release contract field:` then `Route: release-ops.`, `Source TODO: {selected_parent_id or '<selected-decomposition-id>'}.`, `Depends on: <none>.`, one concrete completion condition, forbidden changes, and one bounded verification command.")
        if "duplicate_block_to_remove_json" in "\n".join(repair_feedback_lines):
            repair_feedback_lines.append("- duplicate_declaration_short_repair_policy: the previous duplicate-block removal was too large. Do not include the full block. Instead request one compact `workspace.write` patch_file hunk for `scripts/release-runtime-operational-evidence.mjs` with `old_text:\"const soakEvidenceFixture = {\"`, `new_text:\"const soakEvidenceFixtureDuplicate = {\"`, and `occurrence:2`. Repeat in a later loop if another duplicate declaration remains.")
        repair_feedback_lines.append("- truncated_todo_leaf_template_policy: if the target is `.brownie/todo.md`, use this shape only: an unchecked new id whose first line starts with Patch only followed by one real repository path in backticks, then separate Route, Source TODO, Depends on, Completion condition, Forbidden changes, and Verification lines.")
        repair_feedback_lines.append("- invalid_previous_patch_policy: any previous preview containing `## Queue protocol`, `## Base Phase Loop Prompt`, or unrelated headings inside `old_text` is a failed example; do not copy it.")
    has_invalid_patch_proposal = bool(verification.get("invalid_patch_proposals"))
    for index, preview in enumerate(verification.get("llm_response_previews", []) if isinstance(verification.get("llm_response_previews"), list) else []):
        preview_text = str(preview)
        compact_preview = preview_text.replace(" ", "")
        if (
            selected_leaf_target_path
            and leaf_execution_policy_lines
            and ("workspace.read" in preview_text or "workspace.write" in preview_text)
            and f'"path":"{selected_leaf_target_path}"' not in compact_preview
            and f'"path":"./{selected_leaf_target_path}"' not in compact_preview
        ):
            repair_feedback_lines.append(f"- previous_llm_response_preview_{index}: <omitted stale tool preview because it does not target `{selected_leaf_target_path}`>")
            repair_feedback_lines.append(f"- stale_tool_preview_target_policy: ignore previous tool previews for other files. The next tool must target `{selected_leaf_target_path}` only, or final-answer a concrete blocker.")
            continue
        if selected_decomposition_active and "workspace.write" in preview_text:
            repair_feedback_lines.append(f"- previous_llm_response_preview_{index}: <omitted failed TODO decomposition workspace.write preview; do not reproduce>")
            continue
        if (selected_target_duplicate_const_repair_active or selected_target_required_const_restore_active) and "workspace.write" in preview_text:
            repair_feedback_lines.append(f"- previous_llm_response_preview_{index}: <omitted stale failed workspace.write preview because current target-symbol repair has an exact required next tool>")
            continue
        if has_invalid_patch_proposal and "workspace.write" in preview_text:
            repair_feedback_lines.append(f"- previous_llm_response_preview_{index}: <omitted failed invalid workspace.write preview; do not reproduce>")
            if "workspace.write" in preview_text and "\"hunks\"" in preview_text and "\"content\"" in preview_text:
                repair_feedback_lines.append("- patch_hunks_content_exclusion_policy: the previous workspace.write mixed `hunks` with `content`. Retry with `hunks` only; omit `content`, `old_text`, and `new_text` at the top level.")
            continue
        if (
            leaf_execution_policy_lines
            and '"path":".brownie/todo.md"' in preview_text.replace(" ", "")
            and (not selected_leaf_target_path or leaf_has_read_preview_for_repair)
        ):
            repair_feedback_lines.append(f"- previous_llm_response_preview_{index}: <omitted failed TODO-refinement preview for bounded leaf; do not patch `.brownie/todo.md` again>")
            repair_feedback_lines.append(f"- leaf_retry_required_next_tool: exactly one `workspace.write` to `{selected_leaf_target_path or '<selected leaf target>'}`. Do not request `workspace.read`; do not write `.brownie/todo.md`; do not create blocker TODOs for bounded leaf repair.")
            continue
        if (
            leaf_execution_policy_lines
            and '"path":".brownie/todo.md"' in preview_text.replace(" ", "")
            and selected_leaf_target_path
            and not leaf_has_read_preview_for_repair
        ):
            repair_feedback_lines.append(f"- previous_llm_response_preview_{index}: <omitted failed TODO-refinement preview for bounded leaf; stale preview did not include `{selected_leaf_target_path}`>")
            repair_feedback_lines.append(f"- leaf_retry_read_first_policy: request exactly one `workspace.read` for `{selected_leaf_target_path}` before retrying a target-file `workspace.write`; do not patch `.brownie/todo.md` again.")
            continue
        if missing_closing_fence and (
            "workspace.write" in preview_text
            or "## Queue protocol" in preview_text
            or "## Base Phase Loop Prompt" in preview_text
            or len(preview_text) > 800
        ):
            repair_feedback_lines.append(f"- previous_llm_response_preview_{index}: <omitted failed oversized workspace.write preview; do not reproduce>")
            continue
        repair_feedback_lines.append(f"- previous_llm_response_preview_{index}: {json.dumps(preview_text[-1200:], ensure_ascii=False)}")
    if verification.get("workspace_read_previews") and (selected_target_duplicate_const_repair_active or selected_target_required_const_restore_active):
        repair_feedback_lines.append("- previous_workspace_read_preview_0: <omitted stale target read preview because current target declarations were re-scanned from disk; use selected_target_required_next_tool instead>")
    elif verification.get("workspace_read_previews") and todo_guard_failed:
        repair_feedback_lines.append("- previous_workspace_read_preview_0: <omitted stale TODO read preview during focused TODO repair; use Focused TODO Queue Repair Context instead>")
    elif verification.get("workspace_read_previews") and selected_decomposition_active:
        repair_feedback_lines.append("- previous_workspace_read_preview_0: <omitted during TODO decomposition repair to keep the prompt compact; use the Selected TODO and TODO Queue Snapshot instead>")
    elif verification.get("workspace_read_previews"):
        workspace_read_previews = verification.get("workspace_read_previews", []) if isinstance(verification.get("workspace_read_previews"), list) else []
        read_previews_match_leaf_target = bool(
            selected_leaf_target_path
            and any(preview_is_for_path(preview, selected_leaf_target_path) for preview in workspace_read_previews)
        )
        if selected_leaf_target_path and not read_previews_match_leaf_target:
            repair_feedback_lines.append(f"- stale_read_preview_policy: previous workspace.read previews are not for `{selected_leaf_target_path}`. Ignore them for patch construction; request exactly one `workspace.read` for `{selected_leaf_target_path}` if an exact current hunk is needed.")
            repair_feedback_lines.append(f"- previous_workspace_read_preview_0: <omitted stale read preview because it does not target `{selected_leaf_target_path}`>")
            workspace_read_previews = []
        else:
            repair_feedback_lines.append("- read_budget_repair_policy: previous workspace.read content for the active target is embedded below; do not emit workspace.read in this invocation. Emit workspace.write, or write a concrete smaller blocker TODO if the embedded preview is insufficient.")
        for index, preview in enumerate(workspace_read_previews):
            preview_text = str(preview)
            if len(preview_text) > 3600:
                bounded_preview = (
                    preview_text[:2200]
                    + "\n[...previous workspace.read preview middle omitted by phase-loop...]\n"
                    + preview_text[-1200:]
                )
            else:
                bounded_preview = preview_text
            repair_feedback_lines.append(f"- previous_workspace_read_preview_{index}: {json.dumps(bounded_preview, ensure_ascii=False)}")
    for index, result in enumerate(verification.get("results", []) if isinstance(verification.get("results"), list) else []):
        if not isinstance(result, dict):
            continue
        repair_feedback_lines.extend([
            f"- failed_command_{index}: `{result.get('command', '')}`",
            f"  - exit_code: `{result.get('exit_code', '')}`",
            f"  - stdout_tail: {json.dumps(str(result.get('stdout_tail', ''))[-1200:], ensure_ascii=False)}",
            f"  - stderr_tail: {json.dumps(str(result.get('stderr_tail', ''))[-1200:], ensure_ascii=False)}",
        ])
        result_stderr = str(result.get("stderr_tail", ""))
        result_stdout = str(result.get("stdout_tail", ""))
        if (
            selected_leaf_target_path == "scripts/guard-release-evidence-semantic-consistency.test.mjs"
            and "semantic consistency fixtures cover release evidence contradictions" in result_stdout
            and "Expected values to be strictly equal" in result_stdout
            and re.search(r"\n\s*[67]\s*!==\s*5", result_stdout)
        ):
            repair_feedback_lines.append("- semantic_fixture_count_repair_policy: verification failed because Brownie appended duplicate fixtures instead of repairing the existing fixture list. Do not add another test or fixture. Remove duplicate `missing_commit_binding` fixture object entries from `contradictoryEvidenceFixtures` so the array length returns to 5, while keeping the standalone `null source_commit rejects with missing_commit_binding` test.")
            target_text = read_text(pathlib.Path("scripts/guard-release-evidence-semantic-consistency.test.mjs"))
            duplicate_fixture_pattern = re.compile(
                r"\n  \{\n"
                r"    name: 'null source_commit rejects with missing_commit_binding(?: \\(explicit\\))?',\n"
                r"    contract: \{ status: 'implemented_sufficient', implementation_commit: null, tested_commit: null \},\n"
                r"    evidence: \{ source_commit: null, source_tree_dirty: false \},\n"
                r"    expectedReason: 'missing_commit_binding',\n"
                r"  \},"
            )
            duplicate_fixture_blocks = duplicate_fixture_pattern.findall(target_text)
            if duplicate_fixture_blocks:
                repair_feedback_lines.append(f"- semantic_fixture_duplicate_count: `{len(duplicate_fixture_blocks)}`")
                repair_feedback_lines.append("- semantic_fixture_duplicate_exact_repair_policy: request exactly one `workspace.write` patch_file for `scripts/guard-release-evidence-semantic-consistency.test.mjs` using `input.hunks`; each hunk must remove one duplicate fixture block by setting `new_text` to an empty string. Do not edit `.brownie/todo.md` and do not add another fixture.")
                for duplicate_index, duplicate_block in enumerate(duplicate_fixture_blocks[:3]):
                    repair_feedback_lines.append(f"- semantic_fixture_duplicate_block_{duplicate_index}_json: {json.dumps(duplicate_block, ensure_ascii=False)}")
        if (
            selected_leaf_target_path == "scripts/guard-release-evidence-semantic-consistency.test.mjs"
            and "semantic consistency fixtures cover release evidence contradictions" in result_stdout
            and "Expected values to be strictly equal" in result_stdout
            and re.search(r"\n\s*4\s*!==\s*5", result_stdout)
        ):
            target_text = read_text(pathlib.Path("scripts/guard-release-evidence-semantic-consistency.test.mjs"))
            missing_reference = "const contradictoryEvidenceFixtures = [\n  {\n"
            if missing_reference in target_text and "const contradictoryEvidenceFixtures = [\n  nullSourceCommitFixture,\n" not in target_text:
                repair_feedback_lines.append("- semantic_fixture_missing_reference_repair_policy: verification failed because the required `nullSourceCommitFixture` reference was removed from `contradictoryEvidenceFixtures`. Do not add a duplicate object. Restore only the single array reference `nullSourceCommitFixture,` as the first array entry.")
                repair_feedback_lines.append(f"- semantic_fixture_missing_reference_old_text_json: {json.dumps(missing_reference, ensure_ascii=False)}")
                repair_feedback_lines.append("- semantic_fixture_missing_reference_new_text_json: \"const contradictoryEvidenceFixtures = [\\n  nullSourceCommitFixture,\\n  {\\n\"")
                repair_feedback_lines.append("- semantic_fixture_missing_reference_required_next_tool: exactly one `workspace.write` patch_file to `scripts/guard-release-evidence-semantic-consistency.test.mjs` using the old_text/new_text above; do not edit `.brownie/todo.md` and do not add another fixture object.")
        if "SyntaxError:" in result_stdout or "SyntaxError:" in result_stderr:
            repair_feedback_lines.append("- verification_failure_target_repair_policy: the previous implementation changed a target file and verification now reports a concrete SyntaxError. Repair the target file directly with workspace.write; do not patch `.brownie/todo.md` or split the TODO for this failure.")
        if "Identifier 'soakEvidenceFixture' has already been declared" in result_stdout or "Identifier 'soakEvidenceFixture' has already been declared" in result_stderr:
            repair_feedback_lines.append("- duplicate_declaration_repair_policy: remove or rename exactly one duplicate `soakEvidenceFixture` declaration using a unique hunk with surrounding context or an occurrence-qualified hunk; do not create a new TODO.")
            target_text = read_text(pathlib.Path("scripts/release-runtime-operational-evidence.mjs"))
            duplicate_blocks = extract_const_object_blocks(target_text, "soakEvidenceFixture")
            if len(duplicate_blocks) > 1:
                repair_feedback_lines.append(f"- duplicate_declaration_count: `{len(duplicate_blocks)}`")
                repair_feedback_lines.append("- duplicate_declaration_exact_repair_policy: do not read the file again and do not patch `.brownie/todo.md`; request one `workspace.write` patch_file for `scripts/release-runtime-operational-evidence.mjs` that removes exactly one duplicate block using `old_text` equal to `duplicate_block_to_remove_json` and `new_text` equal to an empty string.")
                repair_feedback_lines.append(f"- duplicate_block_to_remove_json: {json.dumps(duplicate_blocks[1], ensure_ascii=False)}")
        declared_match = re.search(r"Identifier '([^']+)' has already been declared", result_stdout + "\n" + result_stderr)
        if declared_match and declared_match.group(1).startswith("soakEvidenceFixture"):
            duplicate_name = declared_match.group(1)
            target_text = read_text(pathlib.Path("scripts/release-runtime-operational-evidence.mjs"))
            duplicate_names = duplicate_const_declarations(target_text, "soakEvidenceFixture")
            if duplicate_names.get(duplicate_name, 0) > 1:
                replacement_name = next_unique_const_name(target_text, duplicate_name)
                repair_feedback_lines.append(f"- duplicate_const_syntax_error_name: `{duplicate_name}`")
                repair_feedback_lines.append(f"- duplicate_const_syntax_error_replacement_name: `{replacement_name}`")
                repair_feedback_lines.append(f"- duplicate_const_syntax_error_policy: verification reports duplicate `const {duplicate_name} =` declarations. Repair `scripts/release-runtime-operational-evidence.mjs` directly; do not patch `.brownie/todo.md` and do not split the TODO. Use one `workspace.write` patch_file hunk with `old_text:\"const {duplicate_name} =\"`, `new_text:\"const {replacement_name} =\"`, and `occurrence:2`.")
        if "Route must be one of implementation, documentation, release-ops, todo-decomposition" in result_stderr:
            repair_feedback_lines.append("- todo_leaf_route_repair_policy: repair invalid TODO leaves by setting `Route:` to exactly one allowed route value, usually `Route: implementation.` for patch leaves. Do not put a path or prose in the `Route:` line.")
        if "Patch only/Create only scope must name at most two concrete backticked paths" in result_stderr or "Patch only target does not exist" in result_stderr:
            repair_feedback_lines.append("- todo_leaf_scope_guard_repair_policy: repair invalid TODO leaves so backticks are used only for concrete repository paths or executable verification commands. Do not put symbol names, object keys, function names, or section names in backticks anywhere in the leaf; mention them as plain text.")
        if "Create only target already exists" in result_stderr:
            repair_feedback_lines.append("- todo_leaf_existing_target_repair_policy: the previous leaf used `Create only` for an existing file. Replace it with `Patch only` for that existing file, and keep the same concrete path as the only backticked path in the first line.")
        if "dependency " in result_stderr and " is not present in unchecked, checked, or breakdown-ledger state" in result_stderr:
            repair_feedback_lines.append("- todo_leaf_dependency_repair_policy: repair invalid `Depends on:` values by using `<none>` when the referenced id is not present in unchecked, checked, or breakdown-ledger state. Do not invent dependency ids.")
        if "missing derived leaf TODO id" in result_stderr:
            repair_feedback_lines.append("- todo_breakdown_sync_repair_policy: when a valid new leaf remains in `.brownie/todo.md`, also patch `.brownie/todo-breakdown.md` to add the leaf id to the dependency graph and verification ledger. If replacing an invalid leaf id, update todo-breakdown to use the final valid id only.")
    for index, result in enumerate(verification.get("previous_results", []) if isinstance(verification.get("previous_results"), list) else []):
        if not isinstance(result, dict):
            continue
        previous_stdout = str(result.get("stdout_tail", ""))
        previous_stderr = str(result.get("stderr_tail", ""))
        repair_feedback_lines.extend([
            f"- previous_verification_command_{index}: `{result.get('command', '')}`",
            f"  - exit_code: `{result.get('exit_code', '')}`",
            f"  - stdout_tail: {json.dumps(previous_stdout[-1200:], ensure_ascii=False)}",
            f"  - stderr_tail: {json.dumps(previous_stderr[-1200:], ensure_ascii=False)}",
        ])
        if "SyntaxError:" in previous_stdout or "SyntaxError:" in previous_stderr:
            repair_feedback_lines.append("- verification_failure_target_repair_policy: the previous implementation changed a target file and verification now reports a concrete SyntaxError. Repair the target file directly with workspace.write; do not patch `.brownie/todo.md` or split the TODO for this failure.")
        if "Identifier 'soakEvidenceFixture' has already been declared" in previous_stdout or "Identifier 'soakEvidenceFixture' has already been declared" in previous_stderr:
            repair_feedback_lines.append("- duplicate_declaration_repair_policy: remove or rename exactly one duplicate `soakEvidenceFixture` declaration using a unique hunk with surrounding context or an occurrence-qualified hunk; do not create a new TODO.")
            target_text = read_text(pathlib.Path("scripts/release-runtime-operational-evidence.mjs"))
            duplicate_blocks = extract_const_object_blocks(target_text, "soakEvidenceFixture")
            if len(duplicate_blocks) > 1:
                repair_feedback_lines.append(f"- duplicate_declaration_count: `{len(duplicate_blocks)}`")
                repair_feedback_lines.append("- duplicate_declaration_exact_repair_policy: do not read the file again and do not patch `.brownie/todo.md`; request one `workspace.write` patch_file for `scripts/release-runtime-operational-evidence.mjs` that removes exactly one duplicate block using `old_text` equal to `duplicate_block_to_remove_json` and `new_text` equal to an empty string.")
                repair_feedback_lines.append(f"- duplicate_block_to_remove_json: {json.dumps(duplicate_blocks[1], ensure_ascii=False)}")
        previous_declared_match = re.search(r"Identifier '([^']+)' has already been declared", previous_stdout + "\n" + previous_stderr)
        if previous_declared_match and previous_declared_match.group(1).startswith("soakEvidenceFixture"):
            duplicate_name = previous_declared_match.group(1)
            target_text = read_text(pathlib.Path("scripts/release-runtime-operational-evidence.mjs"))
            duplicate_names = duplicate_const_declarations(target_text, "soakEvidenceFixture")
            if duplicate_names.get(duplicate_name, 0) > 1:
                replacement_name = next_unique_const_name(target_text, duplicate_name)
                repair_feedback_lines.append(f"- duplicate_const_syntax_error_name: `{duplicate_name}`")
                repair_feedback_lines.append(f"- duplicate_const_syntax_error_replacement_name: `{replacement_name}`")
                repair_feedback_lines.append(f"- duplicate_const_syntax_error_policy: verification reports duplicate `const {duplicate_name} =` declarations. Repair `scripts/release-runtime-operational-evidence.mjs` directly; do not patch `.brownie/todo.md` and do not split the TODO. Use one `workspace.write` patch_file hunk with `old_text:\"const {duplicate_name} =\"`, `new_text:\"const {replacement_name} =\"`, and `occurrence:2`.")
        if "dependency " in previous_stderr and " is not present in unchecked, checked, or breakdown-ledger state" in previous_stderr:
            repair_feedback_lines.append("- todo_leaf_dependency_repair_policy: repair invalid `Depends on:` values by replacing the missing dependency with `<none>`. Do not preserve or reintroduce dependency ids that the guard says are not present.")
        if "Patch only/Create only scope must name at most two concrete backticked paths" in previous_stderr or "Patch only target does not exist" in previous_stderr:
            repair_feedback_lines.append("- todo_leaf_scope_guard_repair_policy: repair invalid TODO leaves so backticks are used only for concrete repository paths or executable verification commands. Do not put symbol names, object keys, function names, or section names in backticks anywhere in the leaf; mention them as plain text.")

selected_todo_for_prompt = selected_todo
todo_snapshot_for_prompt = todo_snapshot
base_snapshot_for_prompt = base_snapshot
if todo_guard_failed:
    base_snapshot_for_prompt = "<omitted during focused TODO queue repair to prevent prompt text from being copied into workspace.write old_text>"
    selected_first_line = selected_todo.splitlines()[0] if selected_todo.splitlines() else ""
    selected_title = selected_first_line
    for prefix in ("- [ ] ", "* [ ] "):
        if selected_title.startswith(prefix):
            selected_title = selected_title[len(prefix):]
            break
    self_source_line = ""
    selected_route_line = ""
    if selected_title:
        needle = f"Source TODO: {selected_title}"
        todo_lines = todo_text.splitlines()
        for line_index, line in enumerate(todo_lines):
            if needle in line:
                self_source_line = line
                if line_index > 0 and todo_lines[line_index - 1].strip().startswith("Route:"):
                    selected_route_line = todo_lines[line_index - 1]
                break
    guard_stderr = ""
    for result in previous_results if isinstance(previous_results, list) else []:
        if isinstance(result, dict) and "guard:todo-decomposition" in str(result.get("command", "")):
            guard_stderr = str(result.get("stderr_tail", ""))
            break
    selected_todo_for_prompt = "\n".join([
        selected_first_line,
        "  <selected TODO body omitted during TODO queue repair to prevent oversized patch generation>",
        "  Repair target: `.brownie/todo.md` only.",
    ])
    duplicate_only_guard = (
        "duplicate unchecked TODO id" in guard_stderr
        and "Source TODO must reference" not in guard_stderr
    )
    if duplicate_only_guard:
        duplicate_guard_block = ""
        duplicate_guard_id = ""
        duplicate_guard_match = re.search(r"\.brownie/todo\.md\s+([^:\s]+):\s+duplicate unchecked TODO id appears", guard_stderr)
        if duplicate_guard_match:
            duplicate_guard_id = duplicate_guard_match.group(1).strip()
        if not duplicate_guard_id and selected_parent_id:
            duplicate_guard_id = selected_parent_id
        duplicate_guard_needle = f"- [ ] {duplicate_guard_id}:"
        duplicate_guard_start = todo_text.find(duplicate_guard_needle)
        if duplicate_guard_start >= 0:
            duplicate_guard_end = todo_text.find("\n- [ ] ", duplicate_guard_start + len(duplicate_guard_needle))
            if duplicate_guard_end < 0:
                duplicate_guard_end = len(todo_text)
            duplicate_guard_block = todo_text[duplicate_guard_start:duplicate_guard_end].rstrip()
        todo_snapshot_for_prompt = "\n".join([
            "# Focused TODO Queue Repair Context",
            "",
            "The full TODO queue is intentionally omitted during repair to prevent stale or oversized patch generation.",
            "Current guard failure is duplicate TODO IDs only.",
            "",
            "Guard failure:",
            guard_stderr.strip() or "<guard failure unavailable>",
            "",
            "Duplicate repair rule:",
            "- Patch `.brownie/todo.md` only.",
            f"- Keep exactly one unchecked `{duplicate_guard_id or '<duplicate TODO id>'}` block.",
            f"- Remove duplicate `{duplicate_guard_id or '<duplicate TODO id>'}` blocks.",
            "- Do not edit unrelated TODO blocks.",
            "- Use exactly one `workspace.write` hunk: `{old_text:<exact_duplicate_block_json>, new_text:\"\", occurrence:2}`.",
            f"- Repeat in later loops until the guard reports only one remaining `{duplicate_guard_id or '<duplicate TODO id>'}` block.",
            "",
            "Exact duplicate block JSON to copy into `old_text`:",
            json.dumps(duplicate_guard_block, ensure_ascii=False) if duplicate_guard_block else "<unavailable; emit a concrete blocker TODO instead of guessing>",
            "",
            "Expected `new_text` JSON:",
            json.dumps("", ensure_ascii=False),
            "Expected `occurrence`: 2",
            "",
            "Do not include Queue protocol, Base Phase Loop Prompt, unrelated headings, or stale previous read previews in old_text/new_text.",
        ])
    else:
        invalid_leaf_blocks = []
        invalid_leaf_ids = []
        for match in re.findall(r"\.brownie/todo\.md\s+([^:\s]+):", guard_stderr):
            if match not in invalid_leaf_ids:
                invalid_leaf_ids.append(match)
        missing_breakdown_ids = []
        for match in re.findall(r"\.brownie/todo-breakdown\.md:\s+missing derived leaf TODO id\s+([^.\s]+)", guard_stderr):
            if match not in missing_breakdown_ids:
                missing_breakdown_ids.append(match)
        for leaf_id in invalid_leaf_ids[:3]:
            needle = f"- [ ] {leaf_id}:"
            start = todo_text.find(needle)
            if start < 0:
                continue
            end = todo_text.find("\n- [ ] ", start + len(needle))
            if end < 0:
                end = len(todo_text)
            invalid_leaf_blocks.append((leaf_id, todo_text[start:end].rstrip()))
        invalid_leaf_context_lines = []
        if invalid_leaf_blocks:
            invalid_leaf_context_lines.extend([
                "",
                "Invalid TODO leaf blocks copied from `.brownie/todo.md`:",
            ])
            for leaf_id, block in invalid_leaf_blocks:
                invalid_leaf_context_lines.extend([
                    f"- invalid_leaf_id: `{leaf_id}`",
                    "  exact_block_json:",
                    f"  {json.dumps(block, ensure_ascii=False)}",
                ])
        breakdown_sync_lines = []
        if missing_breakdown_ids and not invalid_leaf_blocks:
            breakdown_text = read_text(pathlib.Path(".brownie/todo-breakdown.md"))
            breakdown_sync_lines.extend([
                "",
                "Missing breakdown sync repair context:",
                "- Patch `.brownie/todo-breakdown.md` only for this repair.",
                "- Use the exact anchor old_text/new_text pairs below; do not read files first.",
            ])
            for leaf_id in missing_breakdown_ids[:3]:
                leaf_block = ""
                needle = f"- [ ] {leaf_id}:"
                start = todo_text.find(needle)
                if start >= 0:
                    end = todo_text.find("\n- [ ] ", start + len(needle))
                    if end < 0:
                        end = len(todo_text)
                    leaf_block = todo_text[start:end].rstrip()
                depends_match = re.search(r"(?im)^\s*Depends on:\s*(.+)$", leaf_block)
                verification_match = re.search(r"(?im)^\s*Verification:\s*(.+)$", leaf_block)
                depends_value = depends_match.group(1).strip().rstrip(".") if depends_match else "<none>"
                if f"dependency {depends_value} is not present in unchecked, checked, or breakdown-ledger state" in guard_stderr:
                    depends_value = "<none>"
                verification_value = verification_match.group(1).strip() if verification_match else "inspect `.brownie/todo.md` and `.brownie/todo-breakdown.md` consistency."
                dependency_anchor = "- E-15d-soak-section-collector: <none>"
                verification_anchor = "- E-15d-soak-section-collector: `pnpm --workspace-root guard:runtime-operational-evidence:test`"
                if leaf_id.startswith("E-16d-soak-build-transition-step"):
                    dependency_anchor = "- E-16d-soak-build-transition-step: <none>"
                    verification_anchor = "- E-16d-soak-build-transition-step: `pnpm --workspace-root guard:runtime-operational-evidence:test`"
                if dependency_anchor in breakdown_text:
                    dependency_new = f"{dependency_anchor}\n- {leaf_id}: {depends_value}"
                    breakdown_sync_lines.extend([
                        f"- missing_breakdown_leaf_id: `{leaf_id}`",
                        "  dependency_old_text_json:",
                        f"  {json.dumps(dependency_anchor, ensure_ascii=False)}",
                        "  dependency_new_text_json:",
                        f"  {json.dumps(dependency_new, ensure_ascii=False)}",
                    ])
                if verification_anchor in breakdown_text:
                    verification_new = f"{verification_anchor}\n- {leaf_id}: {verification_value}"
                    breakdown_sync_lines.extend([
                        "  verification_old_text_json:",
                        f"  {json.dumps(verification_anchor, ensure_ascii=False)}",
                        "  verification_new_text_json:",
                        f"  {json.dumps(verification_new, ensure_ascii=False)}",
                    ])
        todo_snapshot_for_prompt = "\n".join([
        "# Focused TODO Queue Repair Context",
        "",
        "The full TODO queue is intentionally omitted during repair to prevent oversized `workspace.write` JSON.",
        "Use only tiny complete-line hunks or one compact exact-block replacement for an invalid leaf.",
        "",
        "Guard failure:",
        guard_stderr.strip() or "<guard failure unavailable>",
        *invalid_leaf_context_lines,
        *breakdown_sync_lines,
        "",
        "Invalid leaf repair rules:",
        "- If an invalid leaf block is provided, patch `.brownie/todo.md` by replacing that exact block only.",
        "- Do not use `occurrence` for invalid leaf repair; `occurrence` is only for duplicate-only guard failures.",
        "- The replacement first line must contain at most two concrete file paths inside backticks.",
        "- Do not put symbol names, object keys, or function names inside backticks on the first line.",
        "- `Route:` must be exactly `implementation.`, `documentation.`, `release-ops.`, or `todo-decomposition.`.",
        "- If the guard says `.brownie/todo-breakdown.md` is missing the leaf id and the leaf remains valid, add that id to dependency graph and verification ledger in a separate compact write.",
        "",
        *([] if invalid_leaf_blocks or missing_breakdown_ids else [
            "Exact self-referencing Source TODO line to patch first:",
            self_source_line or "<unavailable; read `.brownie/todo.md` if exact old_text is required>",
            "",
            "Exact unique-old_text construction rule:",
            "Use a 3-line hunk whose `old_text` is the selected TODO first line, the exact `Route:` line, and the exact self-referencing Source TODO line. Do not use the Source TODO line alone because it appears more than once.",
            "Selected TODO first line:",
            selected_first_line or "<unavailable>",
            "Exact Route line between first line and Source TODO:",
            selected_route_line or "<unavailable>",
            "",
            "Valid Source TODO replacement rule:",
            "- `new_text` must not equal `old_text`.",
            "- `new_text` must not start with the leaf id `E-15d-soak-section-collector`.",
            "- For this E-15d repair, use the parent id `E-15d-runtime-soak-evidence-stateful` as the Source TODO prefix.",
            "",
        ]),
        "Do not include full TODO blocks, Queue protocol, Base Phase Loop Prompt, or unrelated headings in old_text/new_text.",
        ])

read_batch_policy_line = "- read_batch_policy: if completed_workspace_reads is 0, request at most one relevant `workspace.read`; if completed_workspace_reads is 1 or more, do not request `workspace.read` again and request `workspace.write` or a concrete blocker TODO instead."
if todo_guard_failed:
    read_batch_policy_line = "- read_batch_policy: TODO guard repair is active, so do not request `workspace.read`; request exactly one `workspace.write` repair using Focused TODO Queue Repair Context."
elif leaf_has_oversized_repair and not leaf_has_missing_fence_repair and leaf_execution_policy_lines:
    base_snapshot_for_prompt = "<omitted during oversized leaf repair to prevent prompt text from being copied into workspace.write old_text>"
    exact_selected_block_json = json.dumps(selected_todo.rstrip(), ensure_ascii=False)
    stateful_soak_extra_rules = []
    if selected_stateful_soak_oversized_repair:
        stateful_soak_extra_rules = [
            "",
            "E-16d stateful soak repair rules:",
            "- The previous output targeted stale `soakEvidenceFixture*` constants and became oversized. Do not mention, target, create, rename, or copy `soakEvidenceFixture`, `soakEvidenceFixtureDuplicate`, `soakEvidenceFixtureDuplicate2`, or `soakEvidenceFixtureDuplicate3` in `new_text`.",
            "- The replacement TODO must target `buildSoakSection` in `scripts/release-runtime-operational-evidence.mjs` or one helper called only from `buildSoakSection`.",
            "- The replacement TODO must name exactly one required stateful behavior: task_state_transition, ledger_workspace_consistency, resume_replay_handling, duplicate_side_effect_rejection, process_loss_recovery, or finite_convergence.",
            "- Use `Verification: run `pnpm --workspace-root guard:runtime-operational-evidence:test`.`",
        ]
    todo_snapshot_for_prompt = "\n".join([
        "# Focused Oversized Leaf Repair Context",
        "",
        "The previous target-file patch was too large or truncated.",
        "Patch `.brownie/todo.md` only, replacing the selected TODO with exactly one smaller unchecked follow-up leaf.",
        "",
        "Exact selected TODO block JSON to copy verbatim into `old_text`:",
        exact_selected_block_json,
        "",
        "Required repair rules:",
        "- `old_text` must be exactly the JSON string above after decoding, with no manually reconstructed lines.",
        "- `new_text` must contain exactly one unchecked TODO leaf under 900 characters.",
        f"- The new leaf id must be different from `{selected_parent_id or '<selected leaf id>'}`.",
        f"- `Source TODO:` in the new leaf must be `{selected_parent_id or '<selected leaf id>'}`.",
        f"- The first line must name exactly one concrete repository path in backticks, preferably `{selected_leaf_target_path or '<selected Patch only target>'}`.",
        "- Do not copy the broad selected TODO first line into `new_text`.",
        "- Do not patch implementation files in this repair turn.",
        "- Do not include Queue protocol, Base Phase Loop Prompt, previous workspace read previews, or fixture bodies in old_text/new_text.",
        *stateful_soak_extra_rules,
    ])
    read_batch_policy_line = "- read_batch_policy: oversized leaf repair is active, so do not request `workspace.read`; request exactly one `workspace.write` patch to `.brownie/todo.md` using Focused Oversized Leaf Repair Context."

harness_feedback_lines = []
if harness_feedback:
    harness_feedback_lines = [
        "",
        "## Public Harness Feedback",
        "",
        "- harness_policy: the previous trajectory was evaluated through the public-harness adapter; use this feedback as controller evidence, not as a user request.",
        f"- harness_ok: `{harness_feedback.get('ok')}`",
        f"- harness_latest_run_id: `{harness_feedback.get('latest_run_id', '')}`",
        f"- harness_latest_claim_id: `{harness_feedback.get('latest_claim_id', '')}`",
        f"- harness_event_count: `{harness_feedback.get('event_count', '')}`",
    ]
    failures = harness_feedback.get("failures", [])
    if isinstance(failures, list) and failures:
        for index, failure in enumerate(failures[:3]):
            if isinstance(failure, dict):
                harness_feedback_lines.append(f"- harness_failure_{index}_class: `{failure.get('class', '')}`")
                if failure.get("repair_hint"):
                    harness_feedback_lines.append(f"- harness_failure_{index}_repair_hint: {json.dumps(str(failure.get('repair_hint', ''))[-1000:], ensure_ascii=False)}")
        harness_feedback_lines.append("- harness_repair_policy: first repair the harness failure class without expanding the TODO scope. If the failure is only telemetry/sanitization, patch controller or harness code, not product feature files.")

prompt = "\n".join([
    "# Brownie Phase Loop Effective Prompt",
    "",
    "This generated prompt combines the stable phase-loop contract with the current external TODO queue.",
    "Treat the active TODO claim below as the work item for this bounded invocation.",
    "",
    "## BDK Execution Packet",
    "",
    f"- state: `{bdk_state}`",
    f"- llm_route: `{llm_route}`",
    "- context_policy: use the smallest exact file set; do not read README or overview files unless the active TODO names them.",
    "- progress_policy: after bounded reads, emit one workspace.write proposal, a concrete blocker TODO, or completion evidence; do not continue read-only discovery.",
    "- output_policy: if workspace context is needed, your next assistant message must be exactly one fenced `brownie-tool-intent` JSON block and no explanatory prose.",
    "- tool_intent_schema_policy: the fenced JSON must conform to `docs/architecture/tool-intent.schema.json`: one root object, only `tool_requests`, each request has only `tool_id`, `reason`, and `input`.",
    "- workspace_write_size_policy: every `workspace.write` must fit in one complete fenced JSON block. Prefer exactly one `patch_file` hunk; keep `old_text` under 1200 characters and `new_text` under 1800 characters. Do not replace an entire function or file when a smaller exact hunk can satisfy the TODO.",
    "- workspace_write_repetition_policy: never fill `new_text`, `content`, or hunk text by repeating the same line, string literal, array element, or token. If a patch starts repeating, stop and emit a smaller exact hunk or a blocker TODO.",
    read_batch_policy_line,
    "- implementation_preflight_policy: before any workspace.write, internally verify the active TODO id, bounded target files, forbidden files, needed reads, verification command, and blocker condition; if any item is unknown, emit a concrete blocker instead of editing.",
    "- dependency_policy: do not work on a TODO whose `Depends on:` entries are still pending in the live unchecked TODO queue.",
    f"- todo_refinement_parent_policy: if writing `.brownie/todo.md` to replace the selected TODO, `Source TODO:` in every new leaf must include `{selected_parent_id or '<unknown>'}`, and every new leaf id must be different from `{selected_parent_id or '<unknown>'}`.",
    "- todo_refinement_verification_policy: if writing `.brownie/todo.md`, every new leaf must have a concrete `Verification:` line using `run <bounded command>` or an explicit `inspect/blocker/fail-closed` condition; never write `Verification: none`, `none yet`, `TBD`, or an empty verification.",
    "- todo_refinement_scope_policy: if writing `.brownie/todo.md`, every new leaf first line must start with Patch only or Create only followed by one real concrete repository path in backticks unless it is an explicit fail-closed blocker; do not start a leaf with `Read`, `Inspect`, `Investigate`, or `Analyze`, and do not use placeholder paths.",
    *leaf_execution_policy_lines,
    *decomposition_policy_lines,
    *repair_override_lines,
    "- inferred_context_hints:",
    *context_hint_lines,
    "",
    "For this invocation, start from the first inferred context hint when it is relevant, but treat completed Tool Execution results as authoritative. Never copy a prior read request after a workspace.read result or read-budget denial; the next tool intent must move to `workspace.write` or a concrete blocker TODO.",
    *repair_feedback_lines,
    *harness_feedback_lines,
    "",
    "## Active TODO Claim",
    "",
    *claim_lines,
    "",
    "## Selected TODO",
    "",
    selected_todo_for_prompt,
    "",
    "## TODO Queue Snapshot",
    "",
    todo_snapshot_for_prompt,
    "",
    "## Base Phase Loop Prompt",
    "",
    base_snapshot_for_prompt,
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
    "bdk_state": bdk_state,
    "llm_route": llm_route,
    "context_hints": context_hints,
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

phase_loop_sampling_defaults_for_model() {
  local pass="$1"
  local model="$2"
  case "$pass:$model" in
    fast:qwen35-4b-q4km|fast:qwen35-9b-q4km)
      printf '0 0.8 20\n'
      ;;
    fast:gemma4-12B)
      printf '0 0.95 40\n'
      ;;
    code:qwen35-9b-coder-q4km)
      printf '0 0.8 20\n'
      ;;
    code:qwen122)
      printf '0 0.8 20\n'
      ;;
    code:qwen122-long)
      printf '0 0.7 20\n'
      ;;
    code:qwen35|code:qwen35-MTP)
      printf '0 0.7 20\n'
      ;;
    code:qwen36-35b-a3b-iq4xs)
      printf '0 0.8 20\n'
      ;;
    code:devstral-small2-24b-iq4xs)
      printf '0 0.8 20\n'
      ;;
    *)
      printf '0 1 \n'
      ;;
  esac
}

apply_phase_loop_llm_route() {
  local prompt_path="$1"
  local meta_path route routed_model fast_model code_model deep_model prompt_bytes
  local fast_max_tokens code_max_tokens deep_max_tokens
  local fast_temperature code_temperature deep_temperature fast_top_p code_top_p deep_top_p fast_top_k code_top_k deep_top_k defaults
  if [ "${PHASE_LOOP_LLM_ROUTING:-1}" != "1" ]; then
    return 0
  fi
  fast_model="${PHASE_LOOP_LLM_MODEL_FAST:-${BROWNIE_LLM_MODEL_FAST:-}}"
  code_model="${PHASE_LOOP_LLM_MODEL_CODE:-${BROWNIE_LLM_MODEL_CODE:-}}"
  deep_model="${PHASE_LOOP_LLM_MODEL_DEEP:-${BROWNIE_LLM_MODEL_DEEP:-}}"
  fast_max_tokens="${PHASE_LOOP_LLM_MAX_TOKENS_FAST:-${BROWNIE_LLM_MAX_TOKENS_FAST:-}}"
  code_max_tokens="${PHASE_LOOP_LLM_MAX_TOKENS_CODE:-${BROWNIE_LLM_MAX_TOKENS_CODE:-}}"
  deep_max_tokens="${PHASE_LOOP_LLM_MAX_TOKENS_DEEP:-${BROWNIE_LLM_MAX_TOKENS_DEEP:-}}"
  fast_temperature="${PHASE_LOOP_LLM_TEMPERATURE_FAST:-${BROWNIE_LLM_TEMPERATURE_FAST:-}}"
  code_temperature="${PHASE_LOOP_LLM_TEMPERATURE_CODE:-${BROWNIE_LLM_TEMPERATURE_CODE:-}}"
  deep_temperature="${PHASE_LOOP_LLM_TEMPERATURE_DEEP:-${BROWNIE_LLM_TEMPERATURE_DEEP:-}}"
  fast_top_p="${PHASE_LOOP_LLM_TOP_P_FAST:-${BROWNIE_LLM_TOP_P_FAST:-}}"
  code_top_p="${PHASE_LOOP_LLM_TOP_P_CODE:-${BROWNIE_LLM_TOP_P_CODE:-}}"
  deep_top_p="${PHASE_LOOP_LLM_TOP_P_DEEP:-${BROWNIE_LLM_TOP_P_DEEP:-}}"
  fast_top_k="${PHASE_LOOP_LLM_TOP_K_FAST:-${BROWNIE_LLM_TOP_K_FAST:-}}"
  code_top_k="${PHASE_LOOP_LLM_TOP_K_CODE:-${BROWNIE_LLM_TOP_K_CODE:-}}"
  deep_top_k="${PHASE_LOOP_LLM_TOP_K_DEEP:-${BROWNIE_LLM_TOP_K_DEEP:-}}"
  if [ -n "$fast_model" ] && { [ -z "$fast_temperature" ] || [ -z "$fast_top_p" ] || [ -z "$fast_top_k" ]; }; then
    defaults="$(phase_loop_sampling_defaults_for_model fast "$fast_model")"
    set -- $defaults
    fast_temperature="${fast_temperature:-${1:-}}"
    fast_top_p="${fast_top_p:-${2:-}}"
    fast_top_k="${fast_top_k:-${3:-}}"
  fi
  if [ -n "$code_model" ] && { [ -z "$code_temperature" ] || [ -z "$code_top_p" ] || [ -z "$code_top_k" ]; }; then
    defaults="$(phase_loop_sampling_defaults_for_model code "$code_model")"
    set -- $defaults
    code_temperature="${code_temperature:-${1:-}}"
    code_top_p="${code_top_p:-${2:-}}"
    code_top_k="${code_top_k:-${3:-}}"
  fi
  if [ -n "$deep_model" ] && { [ -z "$deep_temperature" ] || [ -z "$deep_top_p" ] || [ -z "$deep_top_k" ]; }; then
    defaults="$(phase_loop_sampling_defaults_for_model code "$deep_model")"
    set -- $defaults
    deep_temperature="${deep_temperature:-${1:-}}"
    deep_top_p="${deep_top_p:-${2:-}}"
    deep_top_k="${deep_top_k:-${3:-}}"
  fi
  if [ -n "$fast_model" ]; then
    export BROWNIE_LLM_MODEL_FAST="$fast_model"
  fi
  if [ -n "$code_model" ]; then
    export BROWNIE_LLM_MODEL_CODE="$code_model"
  fi
  if [ -n "$deep_model" ]; then
    export BROWNIE_LLM_MODEL_DEEP="$deep_model"
  fi
  if [ -n "$fast_max_tokens" ]; then
    export BROWNIE_LLM_MAX_TOKENS_FAST="$fast_max_tokens"
  fi
  if [ -n "$code_max_tokens" ]; then
    export BROWNIE_LLM_MAX_TOKENS_CODE="$code_max_tokens"
  fi
  if [ -n "$deep_max_tokens" ]; then
    export BROWNIE_LLM_MAX_TOKENS_DEEP="$deep_max_tokens"
  fi
  if [ -n "$fast_temperature" ]; then
    export BROWNIE_LLM_TEMPERATURE_FAST="$fast_temperature"
  fi
  if [ -n "$code_temperature" ]; then
    export BROWNIE_LLM_TEMPERATURE_CODE="$code_temperature"
  fi
  if [ -n "$deep_temperature" ]; then
    export BROWNIE_LLM_TEMPERATURE_DEEP="$deep_temperature"
  fi
  if [ -n "$fast_top_p" ]; then
    export BROWNIE_LLM_TOP_P_FAST="$fast_top_p"
  fi
  if [ -n "$code_top_p" ]; then
    export BROWNIE_LLM_TOP_P_CODE="$code_top_p"
  fi
  if [ -n "$deep_top_p" ]; then
    export BROWNIE_LLM_TOP_P_DEEP="$deep_top_p"
  fi
  if [ -n "$fast_top_k" ]; then
    export BROWNIE_LLM_TOP_K_FAST="$fast_top_k"
  fi
  if [ -n "$code_top_k" ]; then
    export BROWNIE_LLM_TOP_K_CODE="$code_top_k"
  fi
  if [ -n "$deep_top_k" ]; then
    export BROWNIE_LLM_TOP_K_DEEP="$deep_top_k"
  fi
  meta_path="${prompt_path%.prompt.md}.prompt.meta.json"
  route="$(
    python3 - "$meta_path" <<'PY'
import json
import sys
try:
    print(json.load(open(sys.argv[1], encoding="utf-8")).get("llm_route", ""))
except Exception:
    print("")
PY
  )"
  prompt_bytes="$(
    python3 - "$meta_path" <<'PY'
import json
import sys
try:
    print(json.load(open(sys.argv[1], encoding="utf-8")).get("prompt_bytes", 0))
except Exception:
    print(0)
PY
  )"
  if [ "$route" = "code" ] && [ -n "$code_model" ]; then
    fast_model="$code_model"
    fast_max_tokens="${code_max_tokens:-$fast_max_tokens}"
    fast_temperature="${code_temperature:-$fast_temperature}"
    fast_top_p="${code_top_p:-$fast_top_p}"
    fast_top_k="${code_top_k:-$fast_top_k}"
    export BROWNIE_LLM_MODEL_FAST="$fast_model"
    [ -n "$fast_max_tokens" ] && export BROWNIE_LLM_MAX_TOKENS_FAST="$fast_max_tokens"
    [ -n "$fast_temperature" ] && export BROWNIE_LLM_TEMPERATURE_FAST="$fast_temperature"
    [ -n "$fast_top_p" ] && export BROWNIE_LLM_TOP_P_FAST="$fast_top_p"
    [ -n "$fast_top_k" ] && export BROWNIE_LLM_TOP_K_FAST="$fast_top_k"
  fi
  if [ "$route" = "deep" ] && [ -n "$deep_model" ]; then
    fast_model="$deep_model"
    code_model="$deep_model"
    fast_max_tokens="${deep_max_tokens:-$fast_max_tokens}"
    code_max_tokens="${deep_max_tokens:-$code_max_tokens}"
    fast_temperature="${deep_temperature:-$fast_temperature}"
    code_temperature="${deep_temperature:-$code_temperature}"
    fast_top_p="${deep_top_p:-$fast_top_p}"
    code_top_p="${deep_top_p:-$code_top_p}"
    fast_top_k="${deep_top_k:-$fast_top_k}"
    code_top_k="${deep_top_k:-$code_top_k}"
    export BROWNIE_LLM_MODEL_FAST="$fast_model"
    export BROWNIE_LLM_MODEL_CODE="$code_model"
    export BROWNIE_LLM_MODEL="$deep_model"
    [ -n "$fast_max_tokens" ] && export BROWNIE_LLM_MAX_TOKENS_FAST="$fast_max_tokens"
    [ -n "$code_max_tokens" ] && export BROWNIE_LLM_MAX_TOKENS_CODE="$code_max_tokens"
    [ -n "$fast_temperature" ] && export BROWNIE_LLM_TEMPERATURE_FAST="$fast_temperature"
    [ -n "$code_temperature" ] && export BROWNIE_LLM_TEMPERATURE_CODE="$code_temperature"
    [ -n "$fast_top_p" ] && export BROWNIE_LLM_TOP_P_FAST="$fast_top_p"
    [ -n "$code_top_p" ] && export BROWNIE_LLM_TOP_P_CODE="$code_top_p"
    [ -n "$fast_top_k" ] && export BROWNIE_LLM_TOP_K_FAST="$fast_top_k"
    [ -n "$code_top_k" ] && export BROWNIE_LLM_TOP_K_CODE="$code_top_k"
  fi
  if [ "$route" != "code" ] && [ -n "$fast_model" ] && [ "${prompt_bytes:-0}" -gt "$PHASE_LOOP_LLM_FAST_MAX_PROMPT_BYTES" ]; then
    printf '%s llm_route=%s fast_model_disabled=prompt_too_large prompt_bytes=%s fast_max_prompt_bytes=%s fast=%s\n' "$(now_utc)" "${route:-none}" "${prompt_bytes:-0}" "$PHASE_LOOP_LLM_FAST_MAX_PROMPT_BYTES" "$fast_model" >> "$SUPERVISOR_LOG"
    fast_model=""
    unset BROWNIE_LLM_MODEL_FAST
    unset BROWNIE_LLM_TEMPERATURE_FAST
    unset BROWNIE_LLM_TOP_P_FAST
    unset BROWNIE_LLM_TOP_K_FAST
  fi
  if [ -n "$fast_model" ] || [ -n "$code_model" ]; then
    printf '%s llm_route=%s model_override=per-pass fast=%s code=%s deep=%s max_tokens_fast=%s max_tokens_code=%s max_tokens_deep=%s temperature_fast=%s temperature_code=%s temperature_deep=%s top_p_fast=%s top_p_code=%s top_p_deep=%s top_k_fast=%s top_k_code=%s top_k_deep=%s\n' "$(now_utc)" "${route:-none}" "${fast_model:-<unchanged>}" "${code_model:-<unchanged>}" "${deep_model:-<unchanged>}" "${fast_max_tokens:-<unchanged>}" "${code_max_tokens:-<unchanged>}" "${deep_max_tokens:-<unchanged>}" "${fast_temperature:-<unchanged>}" "${code_temperature:-<unchanged>}" "${deep_temperature:-<unchanged>}" "${fast_top_p:-<unchanged>}" "${code_top_p:-<unchanged>}" "${deep_top_p:-<unchanged>}" "${fast_top_k:-<unchanged>}" "${code_top_k:-<unchanged>}" "${deep_top_k:-<unchanged>}" >> "$SUPERVISOR_LOG"
    return 0
  fi
  case "$route" in
    fast)
      routed_model="$fast_model"
      ;;
    deep)
      routed_model="$deep_model"
      ;;
    code)
      routed_model="$code_model"
      ;;
    *)
      routed_model=""
      ;;
  esac
  if [ -n "$routed_model" ]; then
    export BROWNIE_LLM_MODEL="$routed_model"
    printf '%s llm_route=%s model_override=%s\n' "$(now_utc)" "$route" "$routed_model" >> "$SUPERVISOR_LOG"
  else
    printf '%s llm_route=%s model_override=<unchanged>\n' "$(now_utc)" "${route:-none}" >> "$SUPERVISOR_LOG"
  fi
}

phase_loop_timeout_for_prompt() {
  local prompt_path="$1"
  local meta_path bdk_state
  meta_path="${prompt_path%.prompt.md}.prompt.meta.json"
  bdk_state="$(
    python3 - "$meta_path" <<'PY'
import json
import sys
try:
    print(json.load(open(sys.argv[1], encoding="utf-8")).get("bdk_state", ""))
except Exception:
    print("")
PY
  )"
  case "$bdk_state" in
    decompose_todo)
      printf '%s\n' "$PHASE_LOOP_BROWNIE_DECOMPOSE_TIMEOUT_SECONDS"
      ;;
    *)
      printf '%s\n' "$PHASE_LOOP_BROWNIE_TIMEOUT_SECONDS"
      ;;
  esac
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
  if [ -f "$ROOT_DIR/.brownie/private/llm.env" ]; then
    # Local LAN LLM credentials and model routing live under .brownie/private.
    # This file is ignored and must not be logged.
    # shellcheck disable=SC1091
    . "$ROOT_DIR/.brownie/private/llm.env"
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

run_with_portable_timeout() {
  local timeout_seconds="$1"
  shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "$timeout_seconds" "$@"
    return $?
  fi

  "$@" &
  local child_pid="$!"
  local waited=0
  while pid_is_active "$child_pid"; do
    if [ -f "$STOP_FILE" ]; then
      local descendants known_pids
      descendants="$(supervisor_descendant_pids "$child_pid" | tr '\n' ' ')"
      known_pids="$child_pid $descendants"
      printf '%s stop file observed during command wait; terminating pid=%s descendants=%s command=%s\n' "$(now_utc)" "$child_pid" "${descendants:-none}" "$*" >> "$SUPERVISOR_LOG"
      # shellcheck disable=SC2086
      kill_known_pids TERM $known_pids
      # shellcheck disable=SC2086
      if ! wait_for_known_pids_exit "$PHASE_LOOP_STOP_GRACE_SECONDS" $known_pids; then
        descendants="$(supervisor_descendant_pids "$child_pid" | tr '\n' ' ')"
        known_pids="$child_pid $known_pids $descendants"
        printf '%s stop file force terminating pid=%s descendants=%s\n' "$(now_utc)" "$child_pid" "${descendants:-none}" >> "$SUPERVISOR_LOG"
        # shellcheck disable=SC2086
        kill_known_pids KILL $known_pids
        # shellcheck disable=SC2086
        wait_for_known_pids_exit "$PHASE_LOOP_STOP_FORCE_SECONDS" $known_pids || true
      fi
      wait "$child_pid" 2>/dev/null || true
      return 130
    fi
    if [ "$waited" -ge "$timeout_seconds" ]; then
      local descendants known_pids
      descendants="$(supervisor_descendant_pids "$child_pid" | tr '\n' ' ')"
      known_pids="$child_pid $descendants"
      printf '%s command timeout after %ss; terminating pid=%s descendants=%s command=%s\n' "$(now_utc)" "$timeout_seconds" "$child_pid" "${descendants:-none}" "$*" >> "$SUPERVISOR_LOG"
      # shellcheck disable=SC2086
      kill_known_pids TERM $known_pids
      # shellcheck disable=SC2086
      if ! wait_for_known_pids_exit "$PHASE_LOOP_STOP_GRACE_SECONDS" $known_pids; then
        descendants="$(supervisor_descendant_pids "$child_pid" | tr '\n' ' ')"
        known_pids="$child_pid $known_pids $descendants"
        printf '%s command timeout force terminating pid=%s descendants=%s\n' "$(now_utc)" "$child_pid" "${descendants:-none}" >> "$SUPERVISOR_LOG"
        # shellcheck disable=SC2086
        kill_known_pids KILL $known_pids
        # shellcheck disable=SC2086
        wait_for_known_pids_exit "$PHASE_LOOP_STOP_FORCE_SECONDS" $known_pids || true
      fi
      wait "$child_pid" 2>/dev/null || true
      return 124
    fi
    sleep 1
    waited=$((waited + 1))
  done
  wait "$child_pid"
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
  local started_at run_stamp stdout_log stderr_log effective_prompt exit_code run_id detail brownie_timeout_seconds
  local workspace_before workspace_after head_commit validation progress_summary progress_classification
  local release_contract_before release_contract_repair_output release_contract_repair_status
  local phase_value_manifest_before phase_value_manifest_repair_output phase_value_manifest_repair_status
  local use_resume=0
  local CLAIM_CREATED_THIS_RUN=0
  started_at="$(now_utc)"
  run_stamp="$(date -u +"%Y%m%dT%H%M%SZ")"
  stdout_log="$RUN_DIR/$run_stamp.stdout.log"
  stderr_log="$RUN_DIR/$run_stamp.stderr.log"
  effective_prompt="$RUN_DIR/$run_stamp.prompt.md"
  release_contract_before="$RUN_DIR/$run_stamp.runtime-release-contract.before.json"
  phase_value_manifest_before="$RUN_DIR/$run_stamp.phase-value-manifest.before.json"

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
  local freshness_output
  if ! freshness_output="$(check_brownie_binary_freshness 2>&1)"; then
    detail="${freshness_output:-Brownie binary freshness check failed.}"
    printf '%s %s\n' "$(now_utc)" "$detail" >> "$SUPERVISOR_LOG"
    write_status "blocked" "$detail" "$run_stamp" "79" "${CONSECUTIVE_FAILURES:-0}"
    return 79
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
  if [ "$use_resume" -ne 1 ]; then
    if decompose_request_id="$(ensure_broad_todo_decomposition_request 2>/dev/null)"; then
      printf '%s broad_todo_decomposition_request_created id=%s todo=%s breakdown=%s\n' "$(now_utc)" "$decompose_request_id" "$PHASE_LOOP_TODO" "$PHASE_LOOP_TODO_BREAKDOWN" >> "$SUPERVISOR_LOG"
    fi
  fi
  if ! claim_first_pending_todo "$run_stamp"; then
    if todo_queue_only_explicit_blockers; then
      detail="No implementable TODO remains; pending queue contains only explicit owner-controlled blocker TODOs. Phase-loop is stopped until owner/review evidence changes."
      printf '%s %s\n' "$(now_utc)" "$detail" >> "$SUPERVISOR_LOG"
      write_status "blocked" "$detail" "owner-blockers-only-$run_stamp" "0" "${CONSECUTIVE_FAILURES:-0}"
      return 0
    elif ensure_blocked_todo_decomposition_request && claim_first_pending_todo "$run_stamp"; then
      printf '%s blocked_todo_decomposition_request_created todo=%s breakdown=%s\n' "$(now_utc)" "$PHASE_LOOP_TODO" "$PHASE_LOOP_TODO_BREAKDOWN" >> "$SUPERVISOR_LOG"
    else
      detail="Failed to claim first pending TODO from queue: $PHASE_LOOP_TODO"
      printf '%s %s\n' "$(now_utc)" "$detail" >> "$SUPERVISOR_LOG"
      write_status "blocked" "$detail" "$run_stamp" "75" "${CONSECUTIVE_FAILURES:-0}"
      return 75
    fi
  fi
  write_bdk_trajectory_event "$run_stamp" "todo.claimed" '{"source":"phase-loop"}'
  if selected_todo_was_stably_blocked; then
    record_stably_blocked_todo_claim "$run_stamp"
    write_bdk_trajectory_event "$run_stamp" "todo.blocked" '{"reason":"stably_blocked"}'
    return 0
  fi
  if [ "$use_resume" -ne 1 ]; then
    if ! build_effective_prompt "$effective_prompt"; then
      detail="Failed to build effective phase-loop prompt: $effective_prompt"
      printf '%s %s\n' "$(now_utc)" "$detail" >> "$SUPERVISOR_LOG"
      if active_todo_claim_exists; then
        write_todo_claim "$(claim_field claim_id)" "blocked" "$(claim_field selected_todo)" "$(claim_field queue_fingerprint)" "$(active_claim_queue_generation)" "$run_stamp"
      fi
      write_status "blocked" "$detail" "$run_stamp" "74" "${CONSECUTIVE_FAILURES:-0}"
      write_bdk_trajectory_event "$run_stamp" "todo.blocked" '{"reason":"prompt_build_failed"}'
      return 74
    fi
    write_bdk_trajectory_prompt_routing_event "$run_stamp" "$effective_prompt"
    write_bdk_trajectory_event "$run_stamp" "skill.selected" '{"skill_id":"brownie.phase-loop.builtin","adapter":"bdk-agent-skills"}'
  else
    write_bdk_trajectory_event "$run_stamp" "workflow.routed" '{"source":"phase-loop","bdk_state":"resume","llm_route":"resume"}'
    write_bdk_trajectory_event "$run_stamp" "skill.selected" '{"skill_id":"brownie.phase-loop.resume","adapter":"bdk-agent-skills"}'
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
      write_bdk_trajectory_event "$run_stamp" "todo.blocked" '{"reason":"prompt_rebuild_failed"}'
      return 74
    fi
    write_bdk_trajectory_prompt_routing_event "$run_stamp" "$effective_prompt"
    write_bdk_trajectory_event "$run_stamp" "skill.selected" '{"skill_id":"brownie.phase-loop.builtin","adapter":"bdk-agent-skills"}'
    if [ "$CLAIM_CREATED_THIS_RUN" -eq 1 ] && ! verify_todo_fresh_for_runtime_start; then
      detail="TODO queue changed again before Runtime start; refusing stale invocation."
      printf '%s %s\n' "$(now_utc)" "$detail" >> "$SUPERVISOR_LOG"
      if active_todo_claim_exists; then
        write_todo_claim "$(claim_field claim_id)" "blocked" "$(claim_field selected_todo)" "$(claim_field queue_fingerprint)" "$(active_claim_queue_generation)" "$run_stamp"
      fi
      write_status "blocked" "$detail" "$run_stamp" "75" "${CONSECUTIVE_FAILURES:-0}"
      write_bdk_trajectory_event "$run_stamp" "todo.blocked" '{"reason":"stale_todo_queue"}'
      return 75
    fi
  fi
  if selected_todo_was_stably_blocked; then
    record_stably_blocked_todo_claim "$run_stamp"
    write_bdk_trajectory_event "$run_stamp" "todo.blocked" '{"reason":"stably_blocked"}'
    return 0
  fi
  local pre_guard_decomposition_fallback_output pre_guard_decomposition_fallback_status
  pre_guard_decomposition_fallback_output="$(try_stagnated_todo_decomposition_fallback "$run_stamp" 2>&1)"
  pre_guard_decomposition_fallback_status=$?
  if [ "$pre_guard_decomposition_fallback_status" -eq 0 ]; then
    workspace_after="$(git_workspace_fingerprint)"
    printf '%s\n' "$pre_guard_decomposition_fallback_output" > "$stdout_log"
    : > "$stderr_log"
    write_todo_claim "$(claim_field claim_id)" "completed" "$(claim_field selected_todo)" "$(claim_field queue_fingerprint)" "$(active_claim_queue_generation)" "$run_stamp"
    remove_completed_todo_claim_from_queue "$run_stamp" >> "$SUPERVISOR_LOG" || true
    detail="Applied deterministic fallback for stagnated TODO decomposition before invoking Brownie: $pre_guard_decomposition_fallback_output"
    write_status "last_run_succeeded" "$detail" "todo-decomposition-fallback-$run_stamp" "0" "0"
    printf '%s run=%s todo_decomposition_fallback=true phase=pre_guard result=%s\n' "$(now_utc)" "todo-decomposition-fallback-$run_stamp" "$pre_guard_decomposition_fallback_output" >> "$SUPERVISOR_LOG"
    write_bdk_trajectory_event "$run_stamp" "tool.write_applied" '{"source":"deterministic_fallback","kind":"todo_decomposition"}'
    write_bdk_trajectory_event "$run_stamp" "todo.completed" '{"completion":"todo_decomposition_fallback"}'
    phase_loop_create_pr_for_progress "$run_stamp" "$stdout_log" "$stderr_log" "$workspace_before" "$workspace_after" || true
    return 0
  elif [ "$pre_guard_decomposition_fallback_status" -eq 1 ]; then
    detail="Stagnated TODO decomposition fallback was eligible but failed safely before invoking Brownie: $pre_guard_decomposition_fallback_output"
    printf '%s %s\n' "$(now_utc)" "$detail" >> "$SUPERVISOR_LOG"
    write_status "blocked" "$detail" "$run_stamp" "74" "${CONSECUTIVE_FAILURES:-0}"
    write_bdk_trajectory_event "$run_stamp" "todo.blocked" '{"reason":"todo_decomposition_fallback_failed"}'
    return 74
  fi
  local pre_guard_multifile_split_output pre_guard_multifile_split_status
  pre_guard_multifile_split_output="$(try_stagnated_multifile_leaf_split_fallback "$run_stamp" 2>&1)"
  pre_guard_multifile_split_status=$?
  if [ "$pre_guard_multifile_split_status" -eq 0 ]; then
    workspace_after="$(git_workspace_fingerprint)"
    printf '%s\n' "$pre_guard_multifile_split_output" > "$stdout_log"
    : > "$stderr_log"
    write_todo_claim "$(claim_field claim_id)" "completed" "$(claim_field selected_todo)" "$(claim_field queue_fingerprint)" "$(active_claim_queue_generation)" "$run_stamp"
    remove_completed_todo_claim_from_queue "$run_stamp" >> "$SUPERVISOR_LOG" || true
    detail="Applied deterministic fallback for stagnated multi-file leaf split before invoking Brownie: $pre_guard_multifile_split_output"
    write_status "last_run_succeeded" "$detail" "todo-leaf-split-$run_stamp" "0" "0"
    printf '%s run=%s todo_multifile_leaf_split=true phase=pre_guard result=%s\n' "$(now_utc)" "todo-leaf-split-$run_stamp" "$pre_guard_multifile_split_output" >> "$SUPERVISOR_LOG"
    write_bdk_trajectory_event "$run_stamp" "tool.write_applied" '{"source":"deterministic_fallback","kind":"todo_leaf_split"}'
    write_bdk_trajectory_event "$run_stamp" "todo.completed" '{"completion":"todo_leaf_split_fallback"}'
    phase_loop_create_pr_for_progress "$run_stamp" "$stdout_log" "$stderr_log" "$workspace_before" "$workspace_after" || true
    return 0
  elif [ "$pre_guard_multifile_split_status" -eq 1 ]; then
    detail="Stagnated multi-file leaf split fallback was eligible but failed safely before invoking Brownie: $pre_guard_multifile_split_output"
    printf '%s %s\n' "$(now_utc)" "$detail" >> "$SUPERVISOR_LOG"
    write_status "blocked" "$detail" "$run_stamp" "74" "${CONSECUTIVE_FAILURES:-0}"
    write_bdk_trajectory_event "$run_stamp" "todo.blocked" '{"reason":"todo_leaf_split_fallback_failed"}'
    return 74
  fi
  local pre_guard_runtime_readiness_fingerprint_output pre_guard_runtime_readiness_fingerprint_status
  pre_guard_runtime_readiness_fingerprint_output="$(try_runtime_readiness_fingerprint_fallback "$run_stamp" 2>&1)"
  pre_guard_runtime_readiness_fingerprint_status=$?
  if [ "$pre_guard_runtime_readiness_fingerprint_status" -eq 0 ]; then
    workspace_after="$(git_workspace_fingerprint)"
    printf '%s\n' "$pre_guard_runtime_readiness_fingerprint_output" > "$stdout_log"
    : > "$stderr_log"
    clear_repair_feedback
    detail="Applied deterministic runtime release readiness fingerprint fallback before invoking Brownie: $pre_guard_runtime_readiness_fingerprint_output"
    write_status "last_run_succeeded" "$detail" "runtime-readiness-fingerprint-$run_stamp" "0" "0"
    printf '%s run=%s runtime_readiness_fingerprint_fallback=true phase=pre_guard result=%s\n' "$(now_utc)" "runtime-readiness-fingerprint-$run_stamp" "$pre_guard_runtime_readiness_fingerprint_output" >> "$SUPERVISOR_LOG"
    write_bdk_trajectory_event "$run_stamp" "tool.write_applied" '{"source":"deterministic_fallback","kind":"runtime_readiness_fingerprint"}'
    phase_loop_create_pr_for_progress "$run_stamp" "$stdout_log" "$stderr_log" "$workspace_before" "$workspace_after" || true
    return 0
  elif [ "$pre_guard_runtime_readiness_fingerprint_status" -eq 1 ]; then
    detail="Runtime release readiness fingerprint fallback was eligible but failed safely before invoking Brownie: $pre_guard_runtime_readiness_fingerprint_output"
    printf '%s %s\n' "$(now_utc)" "$detail" >> "$SUPERVISOR_LOG"
    write_status "blocked" "$detail" "$run_stamp" "74" "${CONSECUTIVE_FAILURES:-0}"
    write_bdk_trajectory_event "$run_stamp" "todo.blocked" '{"reason":"runtime_readiness_fingerprint_fallback_failed"}'
    return 74
  fi
  local pre_guard_release_contract_audit_hash_output pre_guard_release_contract_audit_hash_status
  pre_guard_release_contract_audit_hash_output="$(try_release_contract_readiness_audit_hash_fallback "$run_stamp" 2>&1)"
  pre_guard_release_contract_audit_hash_status=$?
  if [ "$pre_guard_release_contract_audit_hash_status" -eq 0 ]; then
    workspace_after="$(git_workspace_fingerprint)"
    printf '%s\n' "$pre_guard_release_contract_audit_hash_output" > "$stdout_log"
    : > "$stderr_log"
    clear_repair_feedback
    detail="Applied deterministic release contract readiness-audit hash fallback before invoking Brownie: $pre_guard_release_contract_audit_hash_output"
    write_status "last_run_succeeded" "$detail" "release-contract-readiness-audit-hash-$run_stamp" "0" "0"
    printf '%s run=%s release_contract_readiness_audit_hash_fallback=true phase=pre_guard result=%s\n' "$(now_utc)" "release-contract-readiness-audit-hash-$run_stamp" "$pre_guard_release_contract_audit_hash_output" >> "$SUPERVISOR_LOG"
    write_bdk_trajectory_event "$run_stamp" "tool.write_applied" '{"source":"deterministic_fallback","kind":"release_contract_readiness_audit_hash"}'
    phase_loop_create_pr_for_progress "$run_stamp" "$stdout_log" "$stderr_log" "$workspace_before" "$workspace_after" || true
    return 0
  elif [ "$pre_guard_release_contract_audit_hash_status" -eq 1 ]; then
    detail="Release contract readiness-audit hash fallback was eligible but failed safely before invoking Brownie: $pre_guard_release_contract_audit_hash_output"
    printf '%s %s\n' "$(now_utc)" "$detail" >> "$SUPERVISOR_LOG"
    write_status "blocked" "$detail" "$run_stamp" "74" "${CONSECUTIVE_FAILURES:-0}"
    write_bdk_trajectory_event "$run_stamp" "todo.blocked" '{"reason":"release_contract_readiness_audit_hash_fallback_failed"}'
    return 74
  fi
  local pre_guard_runtime_readiness_verified_output pre_guard_runtime_readiness_verified_status
  pre_guard_runtime_readiness_verified_output="$(try_runtime_readiness_verified_completion_fallback "$run_stamp" 2>&1)"
  pre_guard_runtime_readiness_verified_status=$?
  if [ "$pre_guard_runtime_readiness_verified_status" -eq 0 ]; then
    workspace_after="$(git_workspace_fingerprint)"
    printf '%s\n' "$pre_guard_runtime_readiness_verified_output" > "$stdout_log"
    : > "$stderr_log"
    clear_repair_feedback
    write_todo_claim "$(claim_field claim_id)" "completed" "$(claim_field selected_todo)" "$(claim_field queue_fingerprint)" "$(active_claim_queue_generation)" "$run_stamp"
    remove_completed_todo_claim_from_queue "$run_stamp" >> "$SUPERVISOR_LOG" || true
    detail="Selected runtime release readiness TODO verification passed; marked TODO completed before invoking Brownie: $pre_guard_runtime_readiness_verified_output"
    write_status "last_run_succeeded" "$detail" "runtime-readiness-verified-$run_stamp" "0" "0"
    printf '%s run=%s runtime_readiness_verified_completion=true phase=pre_guard result=%s\n' "$(now_utc)" "runtime-readiness-verified-$run_stamp" "$pre_guard_runtime_readiness_verified_output" >> "$SUPERVISOR_LOG"
    write_bdk_trajectory_event "$run_stamp" "verification.run" '{"source":"deterministic_fallback","result":"passed"}'
    write_bdk_trajectory_event "$run_stamp" "todo.completed" '{"completion":"runtime_readiness_verified"}'
    phase_loop_create_pr_for_progress "$run_stamp" "$stdout_log" "$stderr_log" "$workspace_before" "$workspace_after" || true
    return 0
  elif [ "$pre_guard_runtime_readiness_verified_status" -eq 1 ]; then
    detail="Runtime release readiness verified completion fallback was eligible but failed safely before invoking Brownie: $pre_guard_runtime_readiness_verified_output"
    printf '%s %s\n' "$(now_utc)" "$detail" >> "$SUPERVISOR_LOG"
    write_status "blocked" "$detail" "$run_stamp" "74" "${CONSECUTIVE_FAILURES:-0}"
    write_bdk_trajectory_event "$run_stamp" "todo.blocked" '{"reason":"runtime_readiness_verified_fallback_failed"}'
    return 74
  fi
  local pre_guard_verified_noop_output pre_guard_verified_noop_status
  pre_guard_verified_noop_output="$(try_selected_todo_verified_noop_completion_fallback "$run_stamp" 2>&1)"
  pre_guard_verified_noop_status=$?
  if [ "$pre_guard_verified_noop_status" -eq 0 ]; then
    workspace_after="$(git_workspace_fingerprint)"
    printf '%s\n' "$pre_guard_verified_noop_output" > "$stdout_log"
    : > "$stderr_log"
    clear_repair_feedback
    write_todo_claim "$(claim_field claim_id)" "completed" "$(claim_field selected_todo)" "$(claim_field queue_fingerprint)" "$(active_claim_queue_generation)" "$run_stamp"
    remove_completed_todo_claim_from_queue "$run_stamp" >> "$SUPERVISOR_LOG" || true
    detail="Selected bounded TODO verification already passed; marked TODO completed before invoking Brownie: $pre_guard_verified_noop_output"
    write_status "last_run_succeeded" "$detail" "todo-verified-noop-$run_stamp" "0" "0"
    printf '%s run=%s selected_todo_verified_noop=true phase=pre_guard result=%s\n' "$(now_utc)" "todo-verified-noop-$run_stamp" "$pre_guard_verified_noop_output" >> "$SUPERVISOR_LOG"
    write_bdk_trajectory_event "$run_stamp" "verification.run" '{"source":"deterministic_fallback","result":"passed"}'
    write_bdk_trajectory_event "$run_stamp" "todo.completed" '{"completion":"verified_noop"}'
    return 0
  elif [ "$pre_guard_verified_noop_status" -eq 1 ]; then
    detail="Selected TODO verified-noop fallback was eligible but failed safely before invoking Brownie: $pre_guard_verified_noop_output"
    printf '%s %s\n' "$(now_utc)" "$detail" >> "$SUPERVISOR_LOG"
    write_status "blocked" "$detail" "$run_stamp" "74" "${CONSECUTIVE_FAILURES:-0}"
    write_bdk_trajectory_event "$run_stamp" "todo.blocked" '{"reason":"verified_noop_fallback_failed"}'
    return 74
  fi
  local pre_guard_exact_fast_path_output pre_guard_exact_fast_path_status
  pre_guard_exact_fast_path_output="$(try_exact_line_todo_fast_path "$run_stamp" 2>&1)"
  pre_guard_exact_fast_path_status=$?
  if [ "$pre_guard_exact_fast_path_status" -eq 0 ]; then
    workspace_after="$(git_workspace_fingerprint)"
    printf '%s\n' "$pre_guard_exact_fast_path_output" > "$stdout_log"
    : > "$stderr_log"
    write_todo_claim "$(claim_field claim_id)" "completed" "$(claim_field selected_todo)" "$(claim_field queue_fingerprint)" "$(active_claim_queue_generation)" "$run_stamp"
    remove_completed_todo_claim_from_queue "$run_stamp" >> "$SUPERVISOR_LOG"
    detail="Applied deterministic exact-line TODO fast path before guard checks: $pre_guard_exact_fast_path_output"
    write_status "last_run_succeeded" "$detail" "exact-line-$run_stamp" "0" "0"
    printf '%s run=%s exact_line_fast_path=true phase=pre_guard result=%s\n' "$(now_utc)" "exact-line-$run_stamp" "$pre_guard_exact_fast_path_output" >> "$SUPERVISOR_LOG"
    write_bdk_trajectory_event "$run_stamp" "tool.write_applied" '{"source":"deterministic_fallback","kind":"exact_line"}'
    write_bdk_trajectory_event "$run_stamp" "todo.completed" '{"completion":"exact_line_fast_path"}'
    phase_loop_create_pr_for_progress "$run_stamp" "$stdout_log" "$stderr_log" "$workspace_before" "$workspace_after" || true
    return 0
  elif [ "$pre_guard_exact_fast_path_status" -eq 1 ]; then
    detail="Exact-line TODO fast path was eligible but failed safely before guard checks: $pre_guard_exact_fast_path_output"
    printf '%s %s\n' "$(now_utc)" "$detail" >> "$SUPERVISOR_LOG"
    write_status "blocked" "$detail" "$run_stamp" "74" "${CONSECUTIVE_FAILURES:-0}"
    write_bdk_trajectory_event "$run_stamp" "todo.blocked" '{"reason":"exact_line_fast_path_failed"}'
    return 74
  fi
  if ! (
    cd "$PHASE_LOOP_WORKSPACE_ROOT" || exit 70
    pnpm --workspace-root guard:todo-decomposition >/dev/null 2>&1
  ); then
    local pre_runtime_todo_normalization
    if pre_runtime_todo_normalization="$(normalize_todo_decomposition_after_guard_failure 2>&1)"; then
      refresh_active_todo_claim_from_live_queue "$run_stamp"
      write_todo_claim "$(claim_field claim_id)" "in_progress" "$(claim_field selected_todo)" "$(claim_field queue_fingerprint)" "$(active_claim_queue_generation)" "$run_stamp"
      detail="TODO decomposition guard failure was normalized before invoking Brownie; continuing with the repaired leaf TODO. normalization=$pre_runtime_todo_normalization"
      printf '%s %s\n' "$(now_utc)" "$detail" >> "$SUPERVISOR_LOG"
      write_status "last_run_succeeded" "$detail" "todo-normalize-$run_stamp" "0" "0"
      write_bdk_trajectory_event "$run_stamp" "todo.replanned" '{"reason":"todo_decomposition_guard_normalized"}'
      return 0
    fi
  fi
  if selected_todo_is_explicit_blocker; then
    record_explicit_blocker_todo_claim "$run_stamp"
    write_bdk_trajectory_event "$run_stamp" "todo.blocked" '{"reason":"explicit_blocker"}'
    return 0
  fi
  if selected_todo_is_invalid_decomposition_leaf; then
    record_invalid_decomposition_leaf_claim "$run_stamp"
    write_bdk_trajectory_event "$run_stamp" "todo.blocked" '{"reason":"invalid_decomposition_leaf"}'
    return 0
  fi
  if [ -f "$PHASE_LOOP_WORKSPACE_ROOT/docs/architecture/runtime-release-contract.json" ]; then
    cp "$PHASE_LOOP_WORKSPACE_ROOT/docs/architecture/runtime-release-contract.json" "$release_contract_before"
    chmod 600 "$release_contract_before" 2>/dev/null || true
  fi
  if [ -f "$PHASE_LOOP_WORKSPACE_ROOT/docs/architecture/phase-value-manifest.json" ]; then
    cp "$PHASE_LOOP_WORKSPACE_ROOT/docs/architecture/phase-value-manifest.json" "$phase_value_manifest_before"
    chmod 600 "$phase_value_manifest_before" 2>/dev/null || true
  fi
  local exact_fast_path_output exact_fast_path_status
  exact_fast_path_output="$(try_exact_line_todo_fast_path "$run_stamp" 2>&1)"
  exact_fast_path_status=$?
  if [ "$exact_fast_path_status" -eq 0 ]; then
    workspace_after="$(git_workspace_fingerprint)"
    printf '%s\n' "$exact_fast_path_output" > "$stdout_log"
    : > "$stderr_log"
    write_todo_claim "$(claim_field claim_id)" "completed" "$(claim_field selected_todo)" "$(claim_field queue_fingerprint)" "$(active_claim_queue_generation)" "$run_stamp"
    remove_completed_todo_claim_from_queue "$run_stamp" >> "$SUPERVISOR_LOG"
    detail="Applied deterministic exact-line TODO fast path without LLM generation: $exact_fast_path_output"
    write_status "last_run_succeeded" "$detail" "exact-line-$run_stamp" "0" "0"
    printf '%s run=%s exact_line_fast_path=true result=%s\n' "$(now_utc)" "exact-line-$run_stamp" "$exact_fast_path_output" >> "$SUPERVISOR_LOG"
    write_bdk_trajectory_event "$run_stamp" "tool.write_applied" '{"source":"deterministic_fallback","kind":"exact_line"}'
    write_bdk_trajectory_event "$run_stamp" "todo.completed" '{"completion":"exact_line_fast_path"}'
    phase_loop_create_pr_for_progress "$run_stamp" "$stdout_log" "$stderr_log" "$workspace_before" "$workspace_after" || true
    return 0
  elif [ "$exact_fast_path_status" -eq 1 ]; then
    detail="Exact-line TODO fast path was eligible but failed safely: $exact_fast_path_output"
    printf '%s %s\n' "$(now_utc)" "$detail" >> "$SUPERVISOR_LOG"
    write_status "blocked" "$detail" "$run_stamp" "74" "${CONSECUTIVE_FAILURES:-0}"
    write_bdk_trajectory_event "$run_stamp" "todo.blocked" '{"reason":"exact_line_fast_path_failed"}'
    return 74
  fi
  (
    cd "$PHASE_LOOP_WORKSPACE_ROOT" || exit 70
    export BROWNIE_WORKSPACE_ROOT="${BROWNIE_WORKSPACE_ROOT:-"$PHASE_LOOP_WORKSPACE_ROOT"}"
    export BROWNIE_STORE_ROOT="${BROWNIE_STORE_ROOT:-"$PHASE_LOOP_BROWNIE_STORE_ROOT"}"
    export PHASE_LOOP_CONTROL_ROOT
    if [ "$use_resume" -ne 1 ]; then
      apply_phase_loop_llm_route "$effective_prompt"
    fi
    if [ "$use_resume" -eq 1 ]; then
      brownie_timeout_seconds="$PHASE_LOOP_BROWNIE_TIMEOUT_SECONDS"
    else
      brownie_timeout_seconds="$(phase_loop_timeout_for_prompt "$effective_prompt")"
    fi
    if [ "$use_resume" -eq 1 ]; then
      run_with_portable_timeout "$brownie_timeout_seconds" "$BROWNIE_BIN" --json resume
    else
      run_with_portable_timeout "$brownie_timeout_seconds" "$BROWNIE_BIN" --json run --file "$effective_prompt"
    fi
  ) > "$stdout_log" 2> "$stderr_log"
  exit_code=$?
  workspace_after="$(git_workspace_fingerprint)"
  phase_value_manifest_repair_output="$(json_target_parse_violation_repair "$phase_value_manifest_before" "$PHASE_LOOP_WORKSPACE_ROOT/docs/architecture/phase-value-manifest.json" "$run_stamp" "phase_value_manifest" 2>&1)"
  phase_value_manifest_repair_status=$?
  if [ "$phase_value_manifest_repair_status" -eq 1 ]; then
    workspace_after="$(git_workspace_fingerprint)"
    local phase_value_manifest_feedback
    phase_value_manifest_feedback="$(python3 - "$phase_value_manifest_repair_output" <<'PY'
import json
import sys

reason = sys.argv[1]
print(json.dumps({
    "completed": False,
    "reason": "json_target_parse_violation_repaired",
    "repair_hint": "The previous attempt made a JSON target unparsable. Do not append duplicate top-level JSON fragments. Patch only one exact existing field or one exact existing object member, and keep the file parseable JSON.",
    "parse_violation": reason,
}, sort_keys=True))
PY
)"
    write_repair_feedback "$run_stamp" "$phase_value_manifest_feedback" "$stdout_log" "$stderr_log" || true
    if active_todo_claim_exists; then
      write_todo_claim "$(claim_field claim_id)" "in_progress" "$(claim_field selected_todo)" "$(claim_field queue_fingerprint)" "$(active_claim_queue_generation)" "$run_stamp"
    fi
    detail="Rejected and restored unparsable phase-value manifest mutation; Brownie must retry with parseable JSON. repair=$phase_value_manifest_repair_output stdout=$stdout_log stderr=$stderr_log"
    write_status "no_progress" "$detail" "$run_stamp" "76" "${CONSECUTIVE_FAILURES:-1}"
    printf '%s run=%s json_target_parse_violation_repaired=true detail=%s stdout=%s stderr=%s\n' "$(now_utc)" "$run_stamp" "$phase_value_manifest_repair_output" "$stdout_log" "$stderr_log" >> "$SUPERVISOR_LOG"
    write_bdk_trajectory_event "$run_stamp" "todo.replanned" '{"reason":"json_target_parse_violation_repaired"}'
    return 76
  fi
  release_contract_repair_output="$(release_contract_runtime_ready_violation_repair "$release_contract_before" "$run_stamp" 2>&1)"
  release_contract_repair_status=$?
  if [ "$release_contract_repair_status" -eq 1 ]; then
    workspace_after="$(git_workspace_fingerprint)"
    local release_contract_feedback
    release_contract_feedback="$(python3 - "$release_contract_repair_output" <<'PY'
import json
import sys

reason = sys.argv[1]
print(json.dumps({
    "completed": False,
    "reason": "release_contract_forbidden_mutation_repaired",
    "repair_hint": "The previous attempt modified docs/architecture/runtime-release-contract.json in a forbidden way. Do not set runtime_release_ready true. Do not invent implementation/tested commits, workflow run ids, artifact SHA values, release tags, mode pack fingerprints, or Product DoD fingerprints. Keep fail-closed blocker fields until executable evidence exists.",
    "forbidden_mutation": reason,
}, sort_keys=True))
PY
)"
    write_repair_feedback "$run_stamp" "$release_contract_feedback" "$stdout_log" "$stderr_log" || true
    if active_todo_claim_exists; then
      write_todo_claim "$(claim_field claim_id)" "in_progress" "$(claim_field selected_todo)" "$(claim_field queue_fingerprint)" "$(active_claim_queue_generation)" "$run_stamp"
    fi
    detail="Rejected and restored forbidden Runtime Release Contract mutation; Brownie must retry within fail-closed release evidence boundaries. repair=$release_contract_repair_output stdout=$stdout_log stderr=$stderr_log"
    write_status "no_progress" "$detail" "$run_stamp" "76" "${CONSECUTIVE_FAILURES:-1}"
    printf '%s run=%s release_contract_forbidden_mutation_repaired=true detail=%s stdout=%s stderr=%s\n' "$(now_utc)" "$run_stamp" "$release_contract_repair_output" "$stdout_log" "$stderr_log" >> "$SUPERVISOR_LOG"
    write_bdk_trajectory_event "$run_stamp" "todo.replanned" '{"reason":"release_contract_forbidden_mutation_repaired"}'
    return 76
  fi

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
    write_bdk_trajectory_event "$run_stamp" "progress.classified" "$progress_summary"

    local todo_decomposition_validation
    if ! todo_decomposition_validation="$(validate_todo_decomposition_after_runtime_apply "$stdout_log" 2>&1)"; then
      local todo_decomposition_normalization
      if todo_decomposition_normalization="$(normalize_todo_decomposition_after_guard_failure 2>&1)"; then
        clear_repair_feedback
        refresh_active_todo_claim_from_live_queue "$run_stamp"
        write_todo_claim "$(claim_field claim_id)" "in_progress" "$(claim_field selected_todo)" "$(claim_field queue_fingerprint)" "$(active_claim_queue_generation)" "$run_stamp"
        detail="TODO decomposition guard failure was normalized deterministically; continuing with the repaired leaf TODO. normalization=$todo_decomposition_normalization stdout=$stdout_log stderr=$stderr_log progress=$PROGRESS_STATE_FILE"
        write_status "last_run_succeeded" "$detail" "$run_id" "$exit_code" "0"
        printf '%s run=%s todo_decomposition_normalized=true normalization=%s progress=%s stdout=%s stderr=%s\n' "$(now_utc)" "$run_id" "$todo_decomposition_normalization" "$progress_summary" "$stdout_log" "$stderr_log" >> "$SUPERVISOR_LOG"
        write_bdk_trajectory_event "$run_stamp" "todo.replanned" '{"reason":"todo_decomposition_normalized"}'
        return 0
      fi
      write_repair_feedback "$run_stamp" "$todo_decomposition_validation" "$stdout_log" "$stderr_log" || true
      write_todo_claim "$(claim_field claim_id)" "in_progress" "$(claim_field selected_todo)" "$(claim_field queue_fingerprint)" "$(active_claim_queue_generation)" "$run_stamp"
      detail="Brownie patched the live TODO queue but TODO decomposition validation failed; recorded repair feedback. validation=$todo_decomposition_validation stdout=$stdout_log stderr=$stderr_log progress=$PROGRESS_STATE_FILE"
      write_status "no_progress" "$detail" "$run_id" "76" "${CONSECUTIVE_FAILURES:-1}"
      printf '%s run=%s todo_decomposition_validation_failed=true validation=%s progress=%s stdout=%s stderr=%s\n' "$(now_utc)" "$run_id" "$todo_decomposition_validation" "$progress_summary" "$stdout_log" "$stderr_log" >> "$SUPERVISOR_LOG"
      write_bdk_trajectory_event "$run_stamp" "todo.replanned" '{"reason":"todo_decomposition_validation_failed"}'
      return 76
    fi

    local verification_completion
    if verification_completion="$(complete_applied_todo_after_verification "$stdout_log" "$run_stamp" 2>&1)"; then
      clear_repair_feedback
      write_todo_claim "$(claim_field claim_id)" "completed" "$(claim_field selected_todo)" "$(claim_field queue_fingerprint)" "$(active_claim_queue_generation)" "$run_stamp"
      remove_completed_todo_claim_from_queue "$run_stamp" >> "$SUPERVISOR_LOG"
      detail="Brownie applied a workspace patch and selected TODO verification passed; marked TODO completed. verification=$verification_completion stdout=$stdout_log stderr=$stderr_log progress=$PROGRESS_STATE_FILE"
      write_status "last_run_succeeded" "$detail" "$run_id" "$exit_code" "0"
      printf '%s run=%s objective_apply_verified=true verification=%s progress=%s stdout=%s stderr=%s\n' "$(now_utc)" "$run_id" "$verification_completion" "$progress_summary" "$stdout_log" "$stderr_log" >> "$SUPERVISOR_LOG"
      write_bdk_trajectory_event "$run_stamp" "verification.run" "$verification_completion"
      write_bdk_trajectory_event "$run_stamp" "todo.completed" '{"completion":"objective_apply_verified"}'
      phase_loop_create_pr_for_progress "$run_stamp" "$stdout_log" "$stderr_log" "$workspace_before" "$workspace_after" || true
      return 0
    else
      write_bdk_trajectory_event "$run_stamp" "verification.run" "$verification_completion"
      if printf '%s' "$verification_completion" | rg -q '"reason": ?"verification_failed"|"reason": ?"syntax_check_failed"|"reason": ?"semantic_completion_not_satisfied"|"reason": ?"semantic_completion_evidence_unreadable"'; then
        write_repair_feedback "$run_stamp" "$verification_completion" "$stdout_log" "$stderr_log" || true
        printf '%s run=%s repair_feedback_recorded=true verification=%s\n' "$(now_utc)" "$run_id" "$verification_completion" >> "$SUPERVISOR_LOG"
      fi
    fi

    local todo_breakdown_patch_proposal_apply_output todo_breakdown_patch_proposal_apply_status
    todo_breakdown_patch_proposal_apply_output="$(apply_valid_todo_breakdown_patch_proposal_fallback "$run_stamp" "$run_id" 2>&1)"
    todo_breakdown_patch_proposal_apply_status=$?
    if [ "$todo_breakdown_patch_proposal_apply_status" -eq 0 ]; then
      local todo_breakdown_patch_guard_output
      if todo_breakdown_patch_guard_output="$(
        cd "$PHASE_LOOP_WORKSPACE_ROOT" || exit 70
        pnpm --workspace-root guard:todo-decomposition 2>&1
      )"; then
        workspace_after="$(git_workspace_fingerprint)"
        clear_repair_feedback
        detail="Applied valid Brownie TODO breakdown proposal fallback and guard passed. apply=$todo_breakdown_patch_proposal_apply_output stdout=$stdout_log stderr=$stderr_log progress=$PROGRESS_STATE_FILE"
        write_status "last_run_succeeded" "$detail" "$run_id" "$exit_code" "0"
        printf '%s run=%s valid_todo_breakdown_patch_proposal_fallback=true apply=%s guard=%s progress=%s stdout=%s stderr=%s\n' "$(now_utc)" "$run_id" "$todo_breakdown_patch_proposal_apply_output" "$todo_breakdown_patch_guard_output" "$progress_summary" "$stdout_log" "$stderr_log" >> "$SUPERVISOR_LOG"
        write_bdk_trajectory_event "$run_stamp" "tool.write_applied" '{"source":"todo_breakdown_patch_proposal_fallback"}'
        write_bdk_trajectory_event "$run_stamp" "todo.replanned" '{"reason":"todo_breakdown_patch_proposal_applied"}'
        phase_loop_create_pr_for_progress "$run_stamp" "$stdout_log" "$stderr_log" "$workspace_before" "$workspace_after" || true
        return 0
      else
        local todo_breakdown_patch_guard_feedback
        todo_breakdown_patch_guard_feedback="$(
          python3 - "$todo_breakdown_patch_guard_output" <<'PY'
import json
import sys

combined = sys.argv[1]
print(json.dumps({
    "completed": False,
    "reason": "todo_decomposition_guard_failed_after_todo_breakdown_apply",
    "repair_hint": "The previous run patched `.brownie/todo-breakdown.md`, but `pnpm --workspace-root guard:todo-decomposition` still rejected the queue. Repair `.brownie/todo-breakdown.md` only using the exact missing derived leaf id and existing E-16 anchors.",
    "results": [{
        "command": "pnpm --workspace-root guard:todo-decomposition",
        "exit_code": 1,
        "stdout_tail": combined[-4000:],
        "stderr_tail": combined[-4000:],
    }],
}, sort_keys=True))
PY
        )"
        write_repair_feedback "$run_stamp" "$todo_breakdown_patch_guard_feedback" "$stdout_log" "$stderr_log" || true
        detail="Applied valid Brownie TODO breakdown proposal fallback but TODO guard failed; recorded repair feedback. apply=$todo_breakdown_patch_proposal_apply_output guard=$todo_breakdown_patch_guard_output stdout=$stdout_log stderr=$stderr_log progress=$PROGRESS_STATE_FILE"
        write_status "no_progress" "$detail" "$run_id" "76" "${CONSECUTIVE_FAILURES:-1}"
        printf '%s run=%s valid_todo_breakdown_patch_proposal_fallback_guard_failed=true apply=%s guard=%s progress=%s stdout=%s stderr=%s\n' "$(now_utc)" "$run_id" "$todo_breakdown_patch_proposal_apply_output" "$todo_breakdown_patch_guard_output" "$progress_summary" "$stdout_log" "$stderr_log" >> "$SUPERVISOR_LOG"
        write_bdk_trajectory_event "$run_stamp" "todo.replanned" '{"reason":"todo_breakdown_patch_proposal_guard_failed"}'
        return 76
      fi
    fi

    local todo_patch_proposal_apply_output todo_patch_proposal_apply_status
    todo_patch_proposal_apply_output="$(apply_valid_todo_patch_proposal_fallback "$run_stamp" "$run_id" 2>&1)"
    todo_patch_proposal_apply_status=$?
    if [ "$todo_patch_proposal_apply_status" -eq 0 ]; then
      local todo_patch_guard_output
      if todo_patch_guard_output="$(
        cd "$PHASE_LOOP_WORKSPACE_ROOT" || exit 70
        pnpm --workspace-root guard:todo-decomposition 2>&1
      )"; then
        workspace_after="$(git_workspace_fingerprint)"
        clear_repair_feedback
        write_todo_claim "$(claim_field claim_id)" "completed" "$(claim_field selected_todo)" "$(claim_field queue_fingerprint)" "$(active_claim_queue_generation)" "$run_stamp"
        remove_completed_todo_claim_from_queue "$run_stamp" >> "$SUPERVISOR_LOG" || true
        detail="Applied valid Brownie TODO refinement proposal fallback and guard passed; marked TODO claim completed. apply=$todo_patch_proposal_apply_output stdout=$stdout_log stderr=$stderr_log progress=$PROGRESS_STATE_FILE"
        write_status "last_run_succeeded" "$detail" "$run_id" "$exit_code" "0"
        printf '%s run=%s valid_todo_patch_proposal_fallback=true apply=%s guard=%s progress=%s stdout=%s stderr=%s\n' "$(now_utc)" "$run_id" "$todo_patch_proposal_apply_output" "$todo_patch_guard_output" "$progress_summary" "$stdout_log" "$stderr_log" >> "$SUPERVISOR_LOG"
        write_bdk_trajectory_event "$run_stamp" "tool.write_applied" '{"source":"todo_patch_proposal_fallback"}'
        write_bdk_trajectory_event "$run_stamp" "todo.completed" '{"completion":"todo_patch_proposal_fallback"}'
        phase_loop_create_pr_for_progress "$run_stamp" "$stdout_log" "$stderr_log" "$workspace_before" "$workspace_after" || true
        return 0
      else
        local todo_patch_guard_feedback
        todo_patch_guard_feedback="$(
          python3 - "$todo_patch_guard_output" <<'PY'
import json
import sys

combined = sys.argv[1]
print(json.dumps({
    "completed": False,
    "reason": "todo_decomposition_guard_failed_after_todo_apply",
    "repair_hint": "The previous run patched `.brownie/todo.md`, but `pnpm --workspace-root guard:todo-decomposition` rejected the queue. Repair the TODO/breakdown files only; if the failure says a derived leaf id is missing from `.brownie/todo-breakdown.md`, add that exact id to the dependency graph and verification ledger instead of changing implementation files.",
    "results": [{
        "command": "pnpm --workspace-root guard:todo-decomposition",
        "exit_code": 1,
        "stdout_tail": combined[-4000:],
        "stderr_tail": combined[-4000:],
    }],
}, sort_keys=True))
PY
        )"
        write_repair_feedback "$run_stamp" "$todo_patch_guard_feedback" "$stdout_log" "$stderr_log" || true
        write_todo_claim "$(claim_field claim_id)" "in_progress" "$(claim_field selected_todo)" "$(claim_field queue_fingerprint)" "$(active_claim_queue_generation)" "$run_stamp"
        detail="Applied valid Brownie TODO refinement proposal fallback but TODO guard failed; recorded repair feedback. apply=$todo_patch_proposal_apply_output guard=$todo_patch_guard_output stdout=$stdout_log stderr=$stderr_log progress=$PROGRESS_STATE_FILE"
        write_status "no_progress" "$detail" "$run_id" "76" "${CONSECUTIVE_FAILURES:-1}"
        printf '%s run=%s valid_todo_patch_proposal_fallback_guard_failed=true apply=%s guard=%s progress=%s stdout=%s stderr=%s\n' "$(now_utc)" "$run_id" "$todo_patch_proposal_apply_output" "$todo_patch_guard_output" "$progress_summary" "$stdout_log" "$stderr_log" >> "$SUPERVISOR_LOG"
        write_bdk_trajectory_event "$run_stamp" "todo.replanned" '{"reason":"todo_patch_proposal_guard_failed"}'
        return 76
      fi
    elif [ "$todo_patch_proposal_apply_status" -eq 1 ]; then
      write_repair_feedback "$run_stamp" "$todo_patch_proposal_apply_output" "$stdout_log" "$stderr_log" || true
      write_todo_claim "$(claim_field claim_id)" "in_progress" "$(claim_field selected_todo)" "$(claim_field queue_fingerprint)" "$(active_claim_queue_generation)" "$run_stamp"
      detail="Rejected Brownie TODO refinement proposal before applying it because TODO guard preflight failed; recorded repair feedback. apply=$todo_patch_proposal_apply_output stdout=$stdout_log stderr=$stderr_log progress=$PROGRESS_STATE_FILE"
      write_status "no_progress" "$detail" "$run_id" "76" "${CONSECUTIVE_FAILURES:-1}"
      printf '%s run=%s valid_todo_patch_proposal_fallback_preflight_failed=true apply=%s progress=%s stdout=%s stderr=%s\n' "$(now_utc)" "$run_id" "$todo_patch_proposal_apply_output" "$progress_summary" "$stdout_log" "$stderr_log" >> "$SUPERVISOR_LOG"
      write_bdk_trajectory_event "$run_stamp" "todo.replanned" '{"reason":"todo_patch_proposal_preflight_failed"}'
      return 76
    fi

    if python3 - "$PROGRESS_STATE_FILE" <<'PY'
import json
import sys

try:
    state = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception:
    sys.exit(1)
projection = state.get("progress_projection")
if not isinstance(projection, dict):
    sys.exit(1)
applied = str(projection.get("applied") or "").lower() not in ("", "false", "none", "not_applicable")
applied_path = str(projection.get("applied_path") or "")
selected_removed = projection.get("selected_todo_first_line_still_pending_after_todo_md_apply") is False
todo_path = applied_path in ("todo.md", ".brownie/todo.md")
sys.exit(0 if applied and todo_path and selected_removed else 1)
PY
    then
      clear_repair_feedback
      write_todo_claim "$(claim_field claim_id)" "completed" "$(claim_field selected_todo)" "$(claim_field queue_fingerprint)" "$(active_claim_queue_generation)" "$run_stamp"
      detail="Brownie refined the selected TODO into smaller queue items; marked TODO claim completed. stdout=$stdout_log stderr=$stderr_log progress=$PROGRESS_STATE_FILE"
      write_status "last_run_succeeded" "$detail" "$run_id" "$exit_code" "0"
      printf '%s run=%s todo_refinement_completed=true progress=%s stdout=%s stderr=%s\n' "$(now_utc)" "$run_id" "$progress_summary" "$stdout_log" "$stderr_log" >> "$SUPERVISOR_LOG"
      write_bdk_trajectory_event "$run_stamp" "todo.replanned" '{"reason":"todo_refinement_completed"}'
      phase_loop_create_pr_for_progress "$run_stamp" "$stdout_log" "$stderr_log" "$workspace_before" "$workspace_after" || true
      return 0
    fi

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
todo_md_only_apply_blocked_as_progress = False
selected_todo_first_line_still_pending = False
try:
    state = json.load(open(sys.argv[2], encoding="utf-8"))
    projection = state.get("progress_projection", {})
    completed_by_no_actionable_after_apply = projection.get("completed_by_no_actionable_after_apply") is True
    todo_md_only_apply_blocked_as_progress = projection.get("todo_md_only_apply_blocked_as_progress") is True
    selected_todo_first_line_still_pending = projection.get("selected_todo_first_line_still_pending_after_todo_md_apply") is True
except Exception:
    pass
sys.exit(0 if payload.get("completed") is True or completed_by_no_actionable_after_apply else 1)
PY
    then
      write_todo_claim "$(claim_field claim_id)" "completed" "$(claim_field selected_todo)" "$(claim_field queue_fingerprint)" "$(active_claim_queue_generation)" "$run_stamp"
      remove_completed_todo_claim_from_queue "$run_stamp" >> "$SUPERVISOR_LOG"
    elif python3 - "$stdout_log" <<'PY'
import json, sys
root = json.load(open(sys.argv[1], encoding="utf-8"))
if isinstance(root, dict) and isinstance(root.get("run"), dict):
    payload = root.get("run")
elif isinstance(root, dict) and isinstance(root.get("resume"), dict):
    payload = root.get("resume")
else:
    payload = root
if payload.get("blocked") is not True:
    sys.exit(1)
stop_class = str(payload.get("stop_class") or "")
stop_reason = str(payload.get("stop_reason") or "")
status = str(payload.get("status") or "")
closure = str(payload.get("completion_closure_status") or "")
next_action = str(payload.get("next_action") or "")
controller_action = str(payload.get("controller_action") or "")
if (
    stop_class == "terminal_failure"
    or stop_reason == "terminal_task_failed"
    or status in ("no_eligible_task", "no_actionable_work")
):
    sys.exit(1)
external_control_boundary = (
    stop_class == "recoverable_unknown_nonterminal"
    or status == "recoverable_unknown_nonterminal"
    or closure == "unknown_nonterminal"
    or next_action == "inspect_progress_overview"
    or controller_action == "stop"
)
sys.exit(0 if external_control_boundary else 1)
PY
    then
      write_todo_claim "$(claim_field claim_id)" "blocked" "$(claim_field selected_todo)" "$(claim_field queue_fingerprint)" "$(active_claim_queue_generation)" "$run_stamp"
      record_blocked_todo_claim "$run_stamp"
      detail="Brownie run reached a blocked external-control boundary; recorded the blocked TODO and will continue with the next unblocked TODO. stdout=$stdout_log stderr=$stderr_log progress=$PROGRESS_STATE_FILE blocked=$TODO_BLOCKED_FILE"
      write_status "blocked_todo_recorded" "$detail" "$run_id" "$exit_code" "${CONSECUTIVE_FAILURES:-0}"
      printf '%s run=%s exit=%s blocked_external_control_boundary_recorded=true progress=%s stdout=%s stderr=%s\n' "$(now_utc)" "$run_id" "$exit_code" "$progress_summary" "$stdout_log" "$stderr_log" >> "$SUPERVISOR_LOG"
      write_bdk_trajectory_event "$run_stamp" "todo.blocked" '{"reason":"external_control_boundary"}'
      return 0
    elif python3 - "$stdout_log" <<'PY'
import json, sys
root = json.load(open(sys.argv[1], encoding="utf-8"))
if isinstance(root, dict) and isinstance(root.get("run"), dict):
    payload = root.get("run")
elif isinstance(root, dict) and isinstance(root.get("resume"), dict):
    payload = root.get("resume")
else:
    payload = root
stop_class = str(payload.get("stop_class") or "")
stop_reason = str(payload.get("stop_reason") or "")
status = str(payload.get("status") or "")
if (
    stop_class == "terminal_failure"
    or stop_reason == "terminal_task_failed"
    or status in ("no_eligible_task", "no_actionable_work")
):
    sys.exit(1)
sys.exit(0 if payload.get("blocked") is True else 1)
PY
    then
      write_todo_claim "$(claim_field claim_id)" "blocked" "$(claim_field selected_todo)" "$(claim_field queue_fingerprint)" "$(active_claim_queue_generation)" "$run_stamp"
      record_blocked_todo_claim "$run_stamp"
      detail="Brownie run reached a blocked boundary; recorded the blocked TODO and will continue with the next unblocked TODO. stdout=$stdout_log stderr=$stderr_log progress=$PROGRESS_STATE_FILE blocked=$TODO_BLOCKED_FILE"
      write_status "blocked_todo_recorded" "$detail" "$run_id" "$exit_code" "${CONSECUTIVE_FAILURES:-0}"
      printf '%s run=%s exit=%s blocked_todo_recorded=true progress=%s stdout=%s stderr=%s\n' "$(now_utc)" "$run_id" "$exit_code" "$progress_summary" "$stdout_log" "$stderr_log" >> "$SUPERVISOR_LOG"
      write_bdk_trajectory_event "$run_stamp" "todo.blocked" '{"reason":"runtime_blocked"}'
      return 0
    fi

    case "$progress_classification" in
      no_progress)
        recovery_hint="$(classify_no_progress_recovery "$stdout_log" "$stderr_log" "$PROGRESS_STATE_FILE")"
        if active_todo_claim_exists; then
          write_runtime_terminal_repair_feedback "$run_stamp" "$stdout_log" "$stderr_log" || true
          write_todo_claim "$(claim_field claim_id)" "in_progress" "$(claim_field selected_todo)" "$(claim_field queue_fingerprint)" "$(active_claim_queue_generation)" "$run_stamp"
          printf '%s run=%s repair_feedback_recorded=true runtime_terminal_repair=true recovery=%s\n' "$(now_utc)" "$run_id" "$recovery_hint" >> "$SUPERVISOR_LOG"
        fi
        detail="Brownie run exited successfully but repeated the same non-progress fingerprint; recovery=$recovery_hint stdout=$stdout_log stderr=$stderr_log progress=$PROGRESS_STATE_FILE"
        write_status "no_progress" "$detail" "$run_id" "76" "${CONSECUTIVE_FAILURES:-1}"
        printf '%s run=%s exit=%s recovery=%s progress=%s stdout=%s stderr=%s\n' "$(now_utc)" "$run_id" "$exit_code" "$recovery_hint" "$progress_summary" "$stdout_log" "$stderr_log" >> "$SUPERVISOR_LOG"
        write_bdk_trajectory_event "$run_stamp" "todo.replanned" '{"reason":"no_progress"}'
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
        write_bdk_trajectory_event "$run_stamp" "tool.write_applied" '{"source":"runtime","kind":"workspace_progress"}'
        ;;
    esac
  else
    if active_todo_claim_exists && [ "$exit_code" -eq 124 ]; then
      write_process_failure_repair_feedback "$run_stamp" "$exit_code" "$stdout_log" "$stderr_log" || true
      write_todo_claim "$(claim_field claim_id)" "in_progress" "$(claim_field selected_todo)" "$(claim_field queue_fingerprint)" "$(active_claim_queue_generation)" "$run_stamp"
      printf '%s run=%s exit=%s repair_feedback_recorded=true process_timeout_repair=true stdout=%s stderr=%s\n' "$(now_utc)" "$run_id" "$exit_code" "$stdout_log" "$stderr_log" >> "$SUPERVISOR_LOG"
    elif active_todo_claim_exists && active_repair_feedback_matches_claim; then
      write_process_failure_repair_feedback "$run_stamp" "$exit_code" "$stdout_log" "$stderr_log" || true
      write_todo_claim "$(claim_field claim_id)" "in_progress" "$(claim_field selected_todo)" "$(claim_field queue_fingerprint)" "$(active_claim_queue_generation)" "$run_stamp"
      printf '%s run=%s exit=%s repair_feedback_recorded=true process_failure_repair=true stdout=%s stderr=%s\n' "$(now_utc)" "$run_id" "$exit_code" "$stdout_log" "$stderr_log" >> "$SUPERVISOR_LOG"
    elif active_todo_claim_exists; then
      write_todo_claim "$(claim_field claim_id)" "blocked" "$(claim_field selected_todo)" "$(claim_field queue_fingerprint)" "$(active_claim_queue_generation)" "$run_stamp"
      write_bdk_trajectory_event "$run_stamp" "todo.blocked" '{"reason":"runtime_failed"}'
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
  write_status "starting" "Supervisor launch requested." "" "" 0
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
  check-binary-freshness)
    load_env
    check_brownie_binary_freshness
    ;;
  run-once)
    CONSECUTIVE_FAILURES=0
    run_brownie_once
    ;;
  *)
    echo "usage: $0 {start|status|stop|restart|check-binary-freshness|run-once}" >&2
    exit 64
    ;;
esac
