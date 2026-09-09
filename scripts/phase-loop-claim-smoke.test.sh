#!/usr/bin/env bash
set -eu

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PHASE_LOOP="$REPO_ROOT/phase-loop.sh"

assert_contains() {
  local file="$1"
  local pattern="$2"
  if ! rg -q "$pattern" "$file"; then
    echo "expected $file to contain pattern: $pattern" >&2
    exit 1
  fi
}

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

state_with_claim="$(mktemp -d)"
prompt_with_claim="$(mktemp)"
todo_with_claim="$(mktemp)"
printf 'base prompt\n' > "$prompt_with_claim"
printf -- '- [ ] B-01: durable claim task\n  with detail\n- [ ] B-02: next task\n' > "$todo_with_claim"

PHASE_LOOP_STATE_DIR="$state_with_claim" \
PHASE_LOOP_PROMPT="$prompt_with_claim" \
PHASE_LOOP_TODO="$todo_with_claim" \
BROWNIE_BIN="$fake_brownie_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
"$PHASE_LOOP" run-once >/dev/null

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
assert progress_state["progress_projection"]["closure"] == "budget_exhausted", progress_state
assert progress_state["progress_projection"]["next_action"] == "inspect_progress_overview", progress_state
assert prompt_meta["selected_todo_complete"] is True, prompt_meta
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

set +e
PHASE_LOOP_STATE_DIR="$state_with_blocked" \
PHASE_LOOP_PROMPT="$prompt_with_blocked" \
PHASE_LOOP_TODO="$todo_with_blocked" \
BROWNIE_BIN="$fake_brownie_blocked_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
"$PHASE_LOOP" run-once >/dev/null
blocked_exit=$?
set -e
if [ "$blocked_exit" -ne 77 ]; then
  echo "expected blocked run-once exit 77, got $blocked_exit" >&2
  exit 1
fi
test -f "$state_with_blocked/stop"
python3 - "$state_with_blocked/status.json" "$state_with_blocked/todo-claims/current.json" <<'PY'
import json
import sys

status = json.load(open(sys.argv[1], encoding="utf-8"))
claim = json.load(open(sys.argv[2], encoding="utf-8"))
assert status["status"] == "blocked", status
assert status["exit_code"] == "77", status
assert "blocked external-control boundary" in status["detail"], status
assert claim["status"] == "blocked", claim
PY

assert_contains "$prompt_file" '## Active TODO Claim'
assert_contains "$prompt_file" 'queue_generation'
assert_contains "$prompt_file" 'B-01: durable claim task'

printf '' > "$todo_with_claim"

PHASE_LOOP_STATE_DIR="$state_with_claim" \
PHASE_LOOP_PROMPT="$prompt_with_claim" \
PHASE_LOOP_TODO="$todo_with_claim" \
BROWNIE_BIN="$fake_brownie_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
"$PHASE_LOOP" run-once >/dev/null

python3 - "$claim_file" <<'PY'
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
"$PHASE_LOOP" run-once >/dev/null

PHASE_LOOP_STATE_DIR="$state_stagnation" \
PHASE_LOOP_PROMPT="$prompt_stagnation" \
PHASE_LOOP_TODO="$todo_stagnation" \
BROWNIE_BIN="$fake_brownie_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
"$PHASE_LOOP" run-once >/dev/null

if PHASE_LOOP_STATE_DIR="$state_stagnation" \
  PHASE_LOOP_PROMPT="$prompt_stagnation" \
  PHASE_LOOP_TODO="$todo_stagnation" \
  BROWNIE_BIN="$fake_brownie_json" \
  PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
  "$PHASE_LOOP" run-once >/dev/null; then
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
"$PHASE_LOOP" run-once >/dev/null

python3 - "$state_workspace_progress/progress-state.json" <<'PY'
import json
import sys

progress = json.load(open(sys.argv[1], encoding="utf-8"))
assert progress["classification"] == "progress", progress
assert progress["meaningful_progress"] is True, progress
assert progress["workspace_changed"] is True, progress
PY

state_pr_progress="$(mktemp -d)"
prompt_pr_progress="$(mktemp)"
todo_pr_progress="$(mktemp)"
workspace_pr_progress="$(mktemp -d)"
remote_pr_progress="$(mktemp -d)"
fake_bin_dir="$(mktemp -d)"
git -C "$workspace_pr_progress" init -b main >/dev/null
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
"$PHASE_LOOP" run-once >/dev/null

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
"$PHASE_LOOP" run-once >/dev/null

truncated_prompt="$(find "$state_truncated/runs" -name '*.prompt.md' -print | sort | tail -n 1)"
python3 - "${truncated_prompt%.prompt.md}.prompt.meta.json" <<'PY'
import json
import sys

meta = json.load(open(sys.argv[1], encoding="utf-8"))
assert meta["todo_snapshot_truncated"] is True, meta
assert meta["base_prompt_snapshot_truncated"] is True, meta
assert meta["selected_todo_complete"] is True, meta
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
"$PHASE_LOOP" run-once >/dev/null

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
  "$PHASE_LOOP" run-once >/dev/null 2>/dev/null; then
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
"$PHASE_LOOP" run-once >/dev/null

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
"$PHASE_LOOP" run-once >/dev/null

rm "$state_generation/todo-claims/current.json"
printf -- '- [ ] B-00: externally inserted higher priority\n- [ ] B-01: first generation\n' > "$todo_generation"

PHASE_LOOP_STATE_DIR="$state_generation" \
PHASE_LOOP_PROMPT="$prompt_generation" \
PHASE_LOOP_TODO="$todo_generation" \
BROWNIE_BIN="$fake_brownie_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
"$PHASE_LOOP" run-once >/dev/null

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
"$PHASE_LOOP" run-once >/dev/null

python3 - "$state_legacy/todo-claims/current.json" <<'PY'
import json
import sys

claim = json.load(open(sys.argv[1], encoding="utf-8"))
assert claim["claim_id"] == "todo-legacy-claim", claim
assert claim["queue_generation"] == 1, claim
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
  "$PHASE_LOOP" run-once >/dev/null; then
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
  "$PHASE_LOOP" run-once >/dev/null; then
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
  "$PHASE_LOOP" run-once >/dev/null; then
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
"$PHASE_LOOP" supervise >/dev/null 2>/dev/null &
interruptible_pid="$!"

for _ in 1 2 3 4 5; do
  if [ -f "$state_interruptible/status.json" ] && rg -q '"status": "blocked"' "$state_interruptible/status.json"; then
    break
  fi
  sleep 1
done

start_epoch="$(date +%s)"
PHASE_LOOP_STATE_DIR="$state_interruptible" "$PHASE_LOOP" stop >/dev/null
wait "$interruptible_pid" 2>/dev/null || true
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
"$PHASE_LOOP" supervise >/dev/null 2>/dev/null &
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
wait "$child_supervisor_pid" 2>/dev/null || true
sleep 1
if kill -0 "$child_pid" 2>/dev/null; then
  echo "expected stop to terminate supervisor-managed child pid=$child_pid" >&2
  kill -KILL "$child_pid" 2>/dev/null || true
  exit 1
fi

echo "phase-loop claim smoke passed"
