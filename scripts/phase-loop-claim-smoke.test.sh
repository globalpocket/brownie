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
prompt_file="$(find "$state_with_claim/runs" -name '*.prompt.md' -print | sort | tail -n 1)"

python3 - "$claim_file" <<'PY'
import json
import os
import stat
import sys

path = sys.argv[1]
claim = json.load(open(path, encoding="utf-8"))
mode = stat.S_IMODE(os.stat(path).st_mode)
history = [entry["status"] for entry in claim["status_history"]]
assert claim["status"] == "in_progress", claim
assert history[:2] == ["claimed", "in_progress"], claim
assert claim["selected_todo"].startswith("- [ ] B-01: durable claim task"), claim
assert mode == 0o600, oct(mode)
PY

assert_contains "$prompt_file" '## Active TODO Claim'
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
echo "phase-loop claim smoke passed"
