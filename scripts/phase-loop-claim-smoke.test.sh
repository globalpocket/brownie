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

state_with_claim="$(mktemp -d)"
prompt_with_claim="$(mktemp)"
todo_with_claim="$(mktemp)"
printf 'base prompt\n' > "$prompt_with_claim"
printf -- '- [ ] B-01: durable claim task\n  with detail\n- [ ] B-02: next task\n' > "$todo_with_claim"

PHASE_LOOP_STATE_DIR="$state_with_claim" \
PHASE_LOOP_PROMPT="$prompt_with_claim" \
PHASE_LOOP_TODO="$todo_with_claim" \
BROWNIE_BIN=/usr/bin/true \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
"$PHASE_LOOP" run-once >/dev/null

claim_file="$state_with_claim/todo-claims/current.json"
queue_state_file="$state_with_claim/todo-claims/todo-queue-state.json"
prompt_file="$(find "$state_with_claim/runs" -name '*.prompt.md' -print | sort | tail -n 1)"

python3 - "$claim_file" "$queue_state_file" <<'PY'
import json
import os
import stat
import sys

path = sys.argv[1]
claim = json.load(open(path, encoding="utf-8"))
queue_state = json.load(open(sys.argv[2], encoding="utf-8"))
mode = stat.S_IMODE(os.stat(path).st_mode)
queue_mode = stat.S_IMODE(os.stat(sys.argv[2]).st_mode)
history = [entry["status"] for entry in claim["status_history"]]
assert claim["status"] == "in_progress", claim
assert history[:2] == ["claimed", "in_progress"], claim
assert claim["selected_todo"].startswith("- [ ] B-01: durable claim task"), claim
assert claim["queue_generation"] == 1, claim
assert claim["queue_fingerprint"] == queue_state["fingerprint"], (claim, queue_state)
assert queue_state["generation"] == 1, queue_state
assert mode == 0o600, oct(mode)
assert queue_mode == 0o600, oct(queue_mode)
PY

assert_contains "$prompt_file" '## Active TODO Claim'
assert_contains "$prompt_file" 'queue_generation'
assert_contains "$prompt_file" 'B-01: durable claim task'

printf '' > "$todo_with_claim"

PHASE_LOOP_STATE_DIR="$state_with_claim" \
PHASE_LOOP_PROMPT="$prompt_with_claim" \
PHASE_LOOP_TODO="$todo_with_claim" \
BROWNIE_BIN=/usr/bin/true \
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

state_generation="$(mktemp -d)"
prompt_generation="$(mktemp)"
todo_generation="$(mktemp)"
printf 'base prompt\n' > "$prompt_generation"
printf -- '- [ ] B-01: first generation\n' > "$todo_generation"

PHASE_LOOP_STATE_DIR="$state_generation" \
PHASE_LOOP_PROMPT="$prompt_generation" \
PHASE_LOOP_TODO="$todo_generation" \
BROWNIE_BIN=/usr/bin/true \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
"$PHASE_LOOP" run-once >/dev/null

rm "$state_generation/todo-claims/current.json"
printf -- '- [ ] B-00: externally inserted higher priority\n- [ ] B-01: first generation\n' > "$todo_generation"

PHASE_LOOP_STATE_DIR="$state_generation" \
PHASE_LOOP_PROMPT="$prompt_generation" \
PHASE_LOOP_TODO="$todo_generation" \
BROWNIE_BIN=/usr/bin/true \
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
BROWNIE_BIN=/usr/bin/true \
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
  BROWNIE_BIN=/usr/bin/true \
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
  BROWNIE_BIN=/usr/bin/true \
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

echo "phase-loop claim smoke passed"
