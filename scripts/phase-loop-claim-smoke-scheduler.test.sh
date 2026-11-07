#!/usr/bin/env bash
set -eu

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$REPO_ROOT/scripts/phase-loop-claim-smoke-scheduler.sh"

fixture_root="$(mktemp -d "${TMPDIR:-/tmp}/brownie-claim-smoke-scheduler.XXXXXX")"
cleanup() {
  rm -rf -- "$fixture_root"
}
trap cleanup EXIT

fixture_script="$fixture_root/shard-fixture.sh"
cat > "$fixture_script" <<'SH'
#!/usr/bin/env bash
set -eu

case "${PHASE_LOOP_CLAIM_SMOKE_SECTION:-}" in
  fast)
    printf 'fast shard completed\n'
    ;;
  terminal)
    printf 'terminal shard completed\n'
    ;;
  queue|queue-claim|queue-recovery|queue-integrity)
    printf 'queue shard completed\n'
    ;;
  expected|unexpected)
    exit 76
    ;;
  slow)
    sleep 30 &
    child_pid="$!"
    printf '%s\n' "$child_pid" > "${PHASE_LOOP_CLAIM_SMOKE_CHILD_PID_FILE:?}"
    wait "$child_pid"
    ;;
  stall)
    sleep 30
    ;;
  *)
    printf 'unexpected shard: %s\n' "${PHASE_LOOP_CLAIM_SMOKE_SECTION:-}" >&2
    exit 2
    ;;
esac
SH
chmod +x "$fixture_script"

scheduler_driver="$fixture_root/scheduler-driver.sh"
cat > "$scheduler_driver" <<SH
#!/usr/bin/env bash
set -u
source "$REPO_ROOT/scripts/phase-loop-claim-smoke-scheduler.sh"
PHASE_LOOP_CLAIM_SMOKE_AUDIT_OUTPUT="\$1"
export PHASE_LOOP_CLAIM_SMOKE_AUDIT_OUTPUT
shift
phase_loop_claim_smoke_run_scheduler "\$@"
SH
chmod +x "$scheduler_driver"

assert_json() {
  local manifest="$1"
  local expression="$2"
  python3 - "$manifest" "$expression" <<'PY'
import json
import sys

manifest = json.loads(open(sys.argv[1], encoding="utf-8").read())
safe_globals = {"__builtins__": {}, "manifest": manifest, "len": len, "all": all, "any": any}
safe_locals = {"manifest": manifest, "len": len, "all": all, "any": any}
expression = sys.argv[2]
if not eval(expression, safe_globals, safe_locals):
    raise AssertionError((expression, manifest))
PY
}

normal_output="$fixture_root/normal-audit.json"
PHASE_LOOP_CLAIM_SMOKE_AUDIT_OUTPUT="$normal_output" \
  bash "$scheduler_driver" "$normal_output" \
  "$fixture_root/normal-shards" "$fixture_script" 2 10 10 "" fast fast fast fast fast fast fast fast \
  2>"$fixture_root/normal-driver.stderr" || {
    cat "$fixture_root/normal-driver.stderr" >&2 || true
    exit 1
  }
assert_json "$normal_output" 'manifest["scheduler_timed_out"] is False'
assert_json "$normal_output" 'len([r for r in manifest["records"] if r.get("event") == "shard_finished" and r.get("status") == "passed"]) == 8'
assert_json "$normal_output" 'all(r.get("pid") and r.get("pgid") and r.get("stdout_path") and r.get("stderr_path") and r.get("temp_root") and r.get("state_root") and r.get("workspace_root") for r in manifest["records"] if r.get("event") == "shard_started")'
assert_json "$normal_output" 'all(r.get("started_monotonic_ns") and r.get("deadline_monotonic_ns") and r["deadline_monotonic_ns"] > r["started_monotonic_ns"] for r in manifest["records"] if r.get("event") == "shard_started")'
grep -Fq '"event": "shard_started"' "$fixture_root/normal-driver.stderr"
grep -Fq '"event": "shard_finished"' "$fixture_root/normal-driver.stderr"
assert_json "$normal_output" 'any(r.get("event") == "watchdog_started" and r.get("pid") and r.get("pgid") and "command=sleep" in r.get("detail", "") for r in manifest["records"])'
assert_json "$normal_output" 'any(r.get("event") == "watchdog_stopped" and r.get("accepted") is True for r in manifest["records"])'

# A completed scheduler must reap the watchdog's entire isolated process
# group, including its `sleep` child.  This is the Linux/GitHub Actions
# regression: a dead watchdog shell with a live sleep child otherwise leaves
# VSIX check stuck in Actions' orphan-process cleanup.
read -r normal_watchdog_pid normal_watchdog_pgid <<EOF
$(python3 - "$normal_output" <<'PY'
import json
import sys

records = json.load(open(sys.argv[1], encoding="utf-8"))["records"]
watchdog = next(record for record in records if record.get("event") == "watchdog_started")
print(watchdog["pid"], watchdog["pgid"])
PY
)
EOF
if phase_loop_claim_smoke_process_is_live "$normal_watchdog_pid" || phase_loop_claim_smoke_group_has_live_members "$normal_watchdog_pgid"; then
  echo "scheduler left watchdog process group live: pid=$normal_watchdog_pid pgid=$normal_watchdog_pgid members=$(phase_loop_claim_smoke_process_group_members "$normal_watchdog_pgid" | tr '\n' ';')" >&2
  exit 1
fi

capacity_output="$fixture_root/capacity-audit.json"
PHASE_LOOP_CLAIM_SMOKE_CPU_COUNT=4 \
  PHASE_LOOP_CLAIM_SMOKE_AUDIT_OUTPUT="$capacity_output" \
  bash "$scheduler_driver" "$capacity_output" \
  "$fixture_root/capacity-shards" "$fixture_script" 2 10 90 "" fast fast queue-claim queue-recovery queue-integrity fast \
  2>"$fixture_root/capacity-driver.stderr"
assert_json "$capacity_output" 'all(any(r.get("event") == "shard_started" and r.get("shard") == shard and "batch_size=1" in r.get("detail", "") and "batch_rationale=queue_serialized_for_low_cpu_90s_deadline" in r.get("detail", "") and "cpu_count=4" in r.get("detail", "") for r in manifest["records"]) for shard in ["queue-claim", "queue-recovery", "queue-integrity"])'
assert_json "$capacity_output" 'any(r.get("event") == "shard_started" and r.get("shard") == "fast" and "batch_start=5" in r.get("detail", "") for r in manifest["records"])'
assert_json "$capacity_output" 'any(r.get("event") == "scheduler_plan" and "configured_watchdog_seconds=10" in r.get("detail", "") and "effective_watchdog_seconds=466" in r.get("detail", "") and "required_watchdog_seconds=466" in r.get("detail", "") and "planned_batches=5" in r.get("detail", "") and "effective_batch_sizes=2,1,1,1,1" in r.get("detail", "") and "cleanup_margin_seconds=11" in r.get("detail", "") and "plan_overhead_seconds=5" in r.get("detail", "") and r.get("workspace_root") for r in manifest["records"])'

terminal_output="$fixture_root/terminal-audit.json"
PHASE_LOOP_CLAIM_SMOKE_AUDIT_OUTPUT="$terminal_output" \
  bash "$scheduler_driver" "$terminal_output" \
  "$fixture_root/terminal-shards" "$fixture_script" 2 10 10 "" terminal fast fast \
  2>"$fixture_root/terminal-driver.stderr"
assert_json "$terminal_output" 'any(r.get("event") == "shard_started" and r.get("shard") == "terminal" and "batch_start=0" in r.get("detail", "") and "batch_size=1" in r.get("detail", "") and "batch_rationale=terminal_isolated_for_deadline" in r.get("detail", "") for r in manifest["records"])'
assert_json "$terminal_output" 'any(r.get("event") == "scheduler_plan" and "planned_batches=2" in r.get("detail", "") and "effective_batch_sizes=1,2" in r.get("detail", "") for r in manifest["records"])'

expected_output="$fixture_root/expected-audit.json"
PHASE_LOOP_CLAIM_SMOKE_AUDIT_OUTPUT="$expected_output" \
  bash "$scheduler_driver" "$expected_output" \
  "$fixture_root/expected-shards" "$fixture_script" 2 10 10 "expected=76" expected \
  2>"$fixture_root/expected-driver.stderr"
assert_json "$expected_output" 'any(r.get("event") == "shard_finished" and r.get("shard") == "expected" and r.get("exit_code") == 76 and r.get("expected_exit_codes") == [76] and r.get("accepted") is True and r.get("status") == "passed" for r in manifest["records"])'

unexpected_output="$fixture_root/unexpected-audit.json"
set +e
PHASE_LOOP_CLAIM_SMOKE_AUDIT_OUTPUT="$unexpected_output" \
  bash "$scheduler_driver" "$unexpected_output" \
  "$fixture_root/unexpected-shards" "$fixture_script" 2 10 10 "" unexpected \
  2>"$fixture_root/unexpected-driver.stderr"
unexpected_status="$?"
set -e
[ "$unexpected_status" -ne 0 ]
assert_json "$unexpected_output" 'any(r.get("event") == "shard_finished" and r.get("shard") == "unexpected" and r.get("exit_code") == 76 and r.get("expected_exit_codes") == [0] and r.get("accepted") is False and r.get("status") == "failed" for r in manifest["records"])'

child_pid_file="$fixture_root/slow-child.pid"
timeout_output="$fixture_root/timeout-audit.json"
set +e
PHASE_LOOP_CLAIM_SMOKE_CHILD_PID_FILE="$child_pid_file" \
PHASE_LOOP_CLAIM_SMOKE_AUDIT_OUTPUT="$timeout_output" \
  bash "$scheduler_driver" "$timeout_output" \
  "$fixture_root/timeout-shards" "$fixture_script" 2 2 10 "" slow fast \
  2>"$fixture_root/timeout-driver.stderr"
timeout_status="$?"
set -e
[ "$timeout_status" -ne 0 ]
assert_json "$timeout_output" 'manifest["scheduler_timed_out"] is False'
assert_json "$timeout_output" 'any(r.get("event") == "scheduler_plan" and "configured_watchdog_seconds=2" in r.get("detail", "") and "effective_watchdog_seconds=22" in r.get("detail", "") and "required_watchdog_seconds=22" in r.get("detail", "") and "planned_batches=1" in r.get("detail", "") for r in manifest["records"])'
assert_json "$timeout_output" 'any(r.get("event") == "command_timeout" and r.get("shard") == "slow" and r.get("exit_code") == 124 for r in manifest["records"])'
assert_json "$timeout_output" 'any(r.get("event") == "shard_finished" and r.get("shard") == "slow" and r.get("exit_code") == 124 and r.get("status") == "failed" for r in manifest["records"])'
assert_json "$timeout_output" 'any(r.get("event") == "shard_started" and r.get("shard") == "fast" for r in manifest["records"])'

slow_child_pid="$(cat "$child_pid_file")"
if phase_loop_claim_smoke_process_is_live "$slow_child_pid"; then
  echo "scheduler left fixture descendant alive: pid=$slow_child_pid" >&2
  exit 1
fi

stall_output="$fixture_root/stall-audit.json"
set +e
PHASE_LOOP_CLAIM_SMOKE_AUDIT_OUTPUT="$stall_output" \
  bash "$scheduler_driver" "$stall_output" \
  "$fixture_root/stall-shards" "$fixture_script" 1 10 1 "" stall \
  2>"$fixture_root/stall-driver.stderr"
stall_status="$?"
set -e
[ "$stall_status" -ne 0 ]
if grep -Fq 'scheduler_timeout' "$fixture_root/stall-driver.stderr"; then
  echo 'per-shard deadline regression unexpectedly reached the scheduler watchdog' >&2
  cat "$fixture_root/stall-driver.stderr" >&2
  exit 1
fi
assert_json "$stall_output" 'manifest["scheduler_timed_out"] is False'
assert_json "$stall_output" 'any(r.get("event") == "command_timeout" and r.get("shard") == "stall" and r.get("exit_code") == 124 and r.get("accepted") is False for r in manifest["records"])'
assert_json "$stall_output" 'any(r.get("event") == "shard_finished" and r.get("shard") == "stall" and r.get("exit_code") == 124 and r.get("status") == "failed" and r.get("accepted") is False for r in manifest["records"])'

command_audit="$fixture_root/command-audit.jsonl"
set +e
PHASE_LOOP_CLAIM_SMOKE_AUDIT_FILE="$command_audit" \
  phase_loop_claim_smoke_run_with_timeout 1 sleep 30 \
  2>"$fixture_root/command-timeout.stderr"
command_status="$?"
set -e
[ "$command_status" -eq 124 ]
python3 - "$command_audit" <<'PY'
import json
import sys

records = [json.loads(line) for line in open(sys.argv[1], encoding="utf-8") if line.strip()]
timeout = next(record for record in records if record.get("event") == "command_timeout")
assert timeout["pid"] and timeout["pgid"]
PY

echo 'phase-loop claim-smoke scheduler tests passed'
