#!/usr/bin/env bash
set -eu

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PHASE_LOOP="$REPO_ROOT/phase-loop.sh"
CLAIM_SMOKE_SCHEDULER="$REPO_ROOT/scripts/phase-loop-claim-smoke-scheduler.sh"
source "$CLAIM_SMOKE_SCHEDULER"
# Claim smoke runs against temporary worker workspaces while the controller
# source remains this checkout.  Pin the fixture baseline to the checked-out
# controller so the smoke suite exercises controller behavior without
# pretending that a PR branch already matches origin/main.
export PHASE_LOOP_APPROVED_CONTROLLER_BASELINE="HEAD"
# The claim-smoke suite intentionally uses minimal temporary worker repos.
# This explicit test-only profile lets preflight use the trusted controller
# policy/evidence while keeping TODO and git queue state workspace-scoped.
export PHASE_LOOP_PREFLIGHT_PROFILE="claim-smoke-fixture"
export PHASE_LOOP_CLAIM_SMOKE_TEST_ONLY="1"
export PHASE_LOOP_PR_REMOTE="fixture-origin"
# A fixture must inject the same role-to-credential mapping that production
# receives from its deployment control plane.  Never borrow a developer's
# private profile or rely on a particular GitHub account being available in
# CI.  The controller receives this root explicitly; the temporary worker
# checkout remains credential-free.
PHASE_LOOP_TEST_CONTROL_ROOT="$(mktemp -d)"
mkdir -p "$PHASE_LOOP_TEST_CONTROL_ROOT/.brownie/private/profiles/implementation"
cat > "$PHASE_LOOP_TEST_CONTROL_ROOT/actor-deployment.json" <<'JSON'
{
  "schema_version": 1,
  "repository": "fixture-owner/fixture-repository",
  "roles": {
    "implementation": {"github_login": "fixture-implementation", "branch_prefixes": ["fixture/"]},
    "review": {"github_login": "fixture-review"},
    "merge": {"github_login": "fixture-merge"}
  },
  "constraints": {"require_independent_review": true}
}
JSON
cat > "$PHASE_LOOP_TEST_CONTROL_ROOT/.brownie/private/phase-loop-actor-credentials.json" <<'JSON'
{
  "schema_version": 1,
  "roles": {
    "implementation": {
      "kind": "repository-private",
      "github_config_dir": "profiles/implementation"
    },
    "review": { "kind": "host-default" },
    "merge": { "kind": "host-default" }
  }
}
JSON
cleanup_phase_loop_test_control_root() {
  rm -rf "$PHASE_LOOP_TEST_CONTROL_ROOT" "${PHASE_LOOP_TEST_RUNTIME:-}"
}
trap cleanup_phase_loop_test_control_root EXIT
export PHASE_LOOP_CONTROL_ROOT="$PHASE_LOOP_TEST_CONTROL_ROOT"
export PHASE_LOOP_ACTOR_DEPLOYMENT="$PHASE_LOOP_TEST_CONTROL_ROOT/actor-deployment.json"
export PHASE_LOOP_ACTOR_CREDENTIALS="$PHASE_LOOP_TEST_CONTROL_ROOT/.brownie/private/phase-loop-actor-credentials.json"
export PHASE_LOOP_SCREEN_NAME='fixture-phase-loop-screen'
export PHASE_LOOP_LAUNCHD_LABEL='fixture.phase-loop'
PHASE_LOOP_TEST_REPOSITORY="$(node "$REPO_ROOT/scripts/phase-loop-actor-deployment.mjs" --repo-root "$REPO_ROOT" --deployment "$PHASE_LOOP_ACTOR_DEPLOYMENT" --role implementation --field repository)"
PHASE_LOOP_TEST_IMPLEMENTATION_ACTOR="$(node "$REPO_ROOT/scripts/phase-loop-actor-deployment.mjs" --repo-root "$REPO_ROOT" --deployment "$PHASE_LOOP_ACTOR_DEPLOYMENT" --role implementation --field github-login)"
PHASE_LOOP_TEST_IMPLEMENTATION_BRANCH_PREFIX="$(node "$REPO_ROOT/scripts/phase-loop-actor-deployment.mjs" --repo-root "$REPO_ROOT" --deployment "$PHASE_LOOP_ACTOR_DEPLOYMENT" --role implementation --field branch-prefix)"
PHASE_LOOP_TEST_REVIEW_ACTOR="$(node "$REPO_ROOT/scripts/phase-loop-actor-deployment.mjs" --repo-root "$REPO_ROOT" --deployment "$PHASE_LOOP_ACTOR_DEPLOYMENT" --role review --field github-login)"
export PHASE_LOOP_TEST_REPOSITORY PHASE_LOOP_TEST_IMPLEMENTATION_ACTOR PHASE_LOOP_TEST_IMPLEMENTATION_BRANCH_PREFIX PHASE_LOOP_TEST_REVIEW_ACTOR
# Inject every operational value used by a run. The test suite must not rely
# on a repository-local deployment file or inherited developer configuration.
PHASE_LOOP_TEST_RUNTIME="$(mktemp)"
printf '%s\n' '#!/usr/bin/env bash' 'exit 0' > "$PHASE_LOOP_TEST_RUNTIME"
chmod +x "$PHASE_LOOP_TEST_RUNTIME"
export BROWNIE_RUNTIME_PATH="$PHASE_LOOP_TEST_RUNTIME"
export PHASE_LOOP_INTERVAL_SECONDS=1
export PHASE_LOOP_FAILURE_BACKOFF_SECONDS=1
export PHASE_LOOP_MAX_FAILURE_BACKOFF_SECONDS=1
export PHASE_LOOP_BROWNIE_TIMEOUT_SECONDS=30
export PHASE_LOOP_BROWNIE_DECOMPOSE_TIMEOUT_SECONDS=30
export PHASE_LOOP_STAGNATION_THRESHOLD=3
export PHASE_LOOP_PROMPT_MAX_BYTES=65536
export PHASE_LOOP_SELECTED_TODO_MAX_BYTES=8192
export PHASE_LOOP_TODO_SNAPSHOT_LINES=80
export PHASE_LOOP_BASE_PROMPT_SNAPSHOT_LINES=80
export PHASE_LOOP_PROMPT_RETENTION_COUNT=20
export PHASE_LOOP_STOP_GRACE_SECONDS=1
export PHASE_LOOP_STOP_FORCE_SECONDS=1
export PHASE_LOOP_SUPERVISOR_OWNER_GRACE_SECONDS=1
export PHASE_LOOP_LEGACY_MIGRATION_OWNERLESS_GRACE_SECONDS=1
export PHASE_LOOP_SLEEP_POLL_SECONDS=1
export PHASE_LOOP_CONTINUATION_WATCHDOG_SECONDS=60
export PHASE_LOOP_PRECLAIM_RECOVERY_MAX_RETRIES=3
export PHASE_LOOP_TERMINAL_FAILURE_RETRY_CAP=0
export PHASE_LOOP_RUNTIME_AUTHORIZATION_REBASELINE_CAP=1
export PHASE_LOOP_CREATE_PR_AFTER_PROGRESS=0
export PHASE_LOOP_PR_BASE=main
export PHASE_LOOP_PR_TITLE_PREFIX='fixture phase loop'
export PHASE_LOOP_PR_DRAFT=0
export PHASE_LOOP_LLM_ROUTING=1
export PHASE_LOOP_LLM_FAST_MAX_PROMPT_BYTES=20000
export PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1
PHASE_LOOP_CLAIM_SMOKE_TIMEOUT_SECONDS="${PHASE_LOOP_CLAIM_SMOKE_TIMEOUT_SECONDS:-360}"
PHASE_LOOP_CLAIM_SMOKE_SECTION="${PHASE_LOOP_CLAIM_SMOKE_SECTION:-all}"

run_pre_runtime_target_snapshot_regression() {
  local fixture helper workspace claim snapshot
  fixture="$(mktemp -d)"
  helper="$fixture/target-snapshots.sh"
  workspace="$fixture/workspace"
  claim="$fixture/claim.json"
  snapshot="$fixture/targets.before"
  mkdir -p "$workspace/scripts"
  sed -n '/^capture_pre_runtime_active_target_snapshots() {/,/^}/p' "$PHASE_LOOP" > "$helper"
  sed -n '/^restore_pre_runtime_active_target_snapshots() {/,/^}/p' "$PHASE_LOOP" >> "$helper"
  if [ ! -s "$helper" ]; then
    echo "unable to extract pre-runtime target snapshot helpers" >&2
    rm -rf "$fixture"
    exit 1
  fi

  # Every declared target is part of the dispatch boundary.  Both Create-only
  # files must be removed on recovery, even when Runtime wrote only the later
  # target, while an existing Patch-only target gets its exact bytes back.
  printf '%s\n' '{"selected_todo":"- [ ] fixture: Create only `scripts/first.mjs` and `scripts/second.mjs`, then Patch only `scripts/existing.mjs`."}' > "$claim"
  printf '%s\n' '// before runtime' > "$workspace/scripts/existing.mjs"
  chmod 755 "$workspace/scripts/existing.mjs"
  PHASE_LOOP_WORKSPACE_ROOT="$workspace" TODO_CLAIM_FILE="$claim" bash -c '
    source "$1"
    capture_pre_runtime_active_target_snapshots "$2"
  ' _ "$helper" "$snapshot"
  printf '%s\n' '// first created during failed runtime invocation' > "$workspace/scripts/first.mjs"
  printf '%s\n' '// second created during failed runtime invocation' > "$workspace/scripts/second.mjs"
  printf '%s\n' '// after runtime' > "$workspace/scripts/existing.mjs"
  PHASE_LOOP_WORKSPACE_ROOT="$workspace" bash -c '
    source "$1"
    restore_pre_runtime_active_target_snapshots "$2"
    test ! -e "$PHASE_LOOP_WORKSPACE_ROOT/scripts/first.mjs"
    test ! -e "$PHASE_LOOP_WORKSPACE_ROOT/scripts/second.mjs"
    test "$(cat "$PHASE_LOOP_WORKSPACE_ROOT/scripts/existing.mjs")" = "// before runtime"
    test -f "$2/manifest.json"
    test -f "$2/restore-audit.json"
    test -f "$2/discarded-post-dispatch/1.after"
  ' _ "$helper" "$snapshot"
  python3 - "$workspace/scripts/existing.mjs" <<'PY'
import os
import stat
import sys

assert stat.S_IMODE(os.stat(sys.argv[1]).st_mode) == 0o755
PY
  rm -rf "$fixture"
}

run_pre_runtime_target_snapshot_regression

run_changed_file_quality_gate_regression() {
  local fixture helper workspace baseline fake_bin pnpm_cwd quality_output
  fixture="$(mktemp -d)"
  helper="$fixture/quality-gate.sh"
  workspace="$fixture/workspace"
  baseline="$fixture/workspace-status.before"
  fake_bin="$fixture/bin"
  pnpm_cwd="$fixture/pnpm.cwd"
  mkdir -p "$workspace/.brownie/headless" "$workspace/extensions/brownie-vsix/node_modules" "$workspace/scripts" "$workspace/docs/architecture" "$fake_bin"
  git -C "$workspace" init -b main >/dev/null
  git -C "$workspace" config user.name Brownie
  git -C "$workspace" config user.email brownie@example.invalid
  printf '%s\n' '{"name":"quality-gate-fixture","private":true,"version":"0.1.0","scripts":{"check":"true"}}' > "$workspace/package.json"
  printf '%s\n' '{"name":"brownie-vsix-fixture","private":true,"version":"0.1.0"}' > "$workspace/extensions/brownie-vsix/package.json"
  printf '%s\n' 'package-local dependency sentinel' > "$workspace/extensions/brownie-vsix/node_modules/.brownie-quality-gate-sentinel"
  cp "$REPO_ROOT/scripts/guard-js-added-function-reachability.mjs" "$workspace/scripts/guard-js-added-function-reachability.mjs"
  cp "$REPO_ROOT/scripts/guard-phase-value.mjs" "$workspace/scripts/guard-phase-value.mjs"
  cp "$REPO_ROOT/docs/architecture/phase-value-manifest.json" "$workspace/docs/architecture/phase-value-manifest.json"
  cat > "$workspace/scripts/runtime-change.mjs" <<'JS'
export function existingFunction() {}
existingFunction()
JS
  printf '%s\n' 'tracked baseline' > "$workspace/tracked.txt"
  git -C "$workspace" add package.json extensions/brownie-vsix/package.json scripts docs/architecture/phase-value-manifest.json tracked.txt
  git -C "$workspace" commit -m init >/dev/null

  # The controller must not reinterpret baseline-untracked leaves as new
  # merely because a later porcelain query collapses them to a directory.
  printf '%s\n' '{ intentionally malformed baseline fixture' > "$workspace/.brownie/headless/preexisting.json"
  printf '%s\n' 'pre-existing dirty tracked file' >> "$workspace/tracked.txt"
  git -C "$workspace" status --porcelain=v1 --untracked-files=all > "$baseline"
  printf '%s\n' '{"name":"quality-gate-fixture","private":true,"version":"0.2.0","scripts":{"check":"true"}}' > "$workspace/package.json"
  cat > "$workspace/scripts/runtime-change.mjs" <<'JS'
export function existingFunction() {}
existingFunction()
export function addedReachableFunction() {}
addedReachableFunction()
JS

  python3 - "$PHASE_LOOP" "$helper" <<'PY'
import pathlib
import sys

source = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
start = source.index("run_changed_file_quality_gates() {")
end = source.index("\n}\n\ntry_deterministic_todo_decomposition_repair", start) + 3
pathlib.Path(sys.argv[2]).write_text(source[start:end], encoding="utf-8")
PY
  cat > "$fake_bin/pnpm" <<'SH'
#!/usr/bin/env bash
set -eu
test "$PWD" != "${PHASE_LOOP_WORKSPACE_ROOT:?}"
test -L extensions/brownie-vsix/node_modules
test -f extensions/brownie-vsix/node_modules/.brownie-quality-gate-sentinel
git rev-parse --verify "${BROWNIE_JS_REACHABILITY_BASE:?}" >/dev/null
test "$(git diff --name-only "$BROWNIE_JS_REACHABILITY_BASE" -- package.json scripts/runtime-change.mjs)" = $'package.json\nscripts/runtime-change.mjs'
node - <<'NODE'
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
if (pkg.version !== '0.2.0') process.exit(42);
const changed = JSON.parse(process.env.BROWNIE_PHASE_VALUE_CHANGED_FILES || 'null');
if (JSON.stringify(changed) !== JSON.stringify(['package.json', 'scripts/runtime-change.mjs'])) process.exit(43);
NODE
node scripts/guard-js-added-function-reachability.mjs
node scripts/guard-phase-value.mjs
printf '%s\n' "$PWD" > "${PHASE_LOOP_TEST_PNPM_CWD_FILE:?}"
SH
  chmod +x "$fake_bin/pnpm"

  # Exercise the GitHub PR environment explicitly. The isolated snapshot
  # must use its own synthetic baseline rather than inheriting the outer
  # checkout's PR identity.
  quality_output="$(
    GITHUB_BASE_REF=main \
    GITHUB_EVENT_NAME=pull_request \
    GITHUB_ACTIONS=true \
    PHASE_LOOP_WORKSPACE_ROOT="$workspace" \
    PHASE_LOOP_TEST_PNPM_CWD_FILE="$pnpm_cwd" \
    PATH="$fake_bin:$PATH" \
    bash -c 'source "$1"; run_changed_file_quality_gates "$2"' _ "$helper" "$baseline"
  )"

  python3 - "$quality_output" "$workspace" "$pnpm_cwd" "$PHASE_LOOP" <<'PY'
import json
import pathlib
import sys

payload = json.loads(sys.argv[1])
workspace = pathlib.Path(sys.argv[2]).resolve()
pnpm_cwd = pathlib.Path(sys.argv[3])
source = pathlib.Path(sys.argv[4]).read_text(encoding="utf-8")
assert payload["completed"] is True, payload
assert payload["changed_files"] == ["package.json", "scripts/runtime-change.mjs"], payload
assert payload["validation_context"]["workspace"] == "isolated_git_archive_with_run_delta", payload
assert payload["validation_context"]["git_context"] == "synthetic_baseline_with_run_delta", payload
validated_root = pathlib.Path(pnpm_cwd.read_text(encoding="utf-8").strip()).resolve()
assert validated_root != workspace, (validated_root, workspace)
assert not validated_root.exists(), validated_root
failure_start = source.index('if ! changed_file_quality_gate="$(run_changed_file_quality_gates')
failure_end = source.index('write_repair_feedback "$run_stamp"', failure_start)
failure_recovery = source[failure_start:failure_end]
assert 'restore_pre_runtime_active_target_snapshots "$active_target_snapshots"' in failure_recovery, failure_recovery
PY
  rm -rf "$fixture"
}

phase_loop_smoke_cpu_count() {
  local detected=""
  if command -v getconf >/dev/null 2>&1; then
    detected="$(getconf _NPROCESSORS_ONLN 2>/dev/null || true)"
  fi
  case "$detected" in
    ''|*[!0-9]*) detected="" ;;
  esac
  if [ -z "$detected" ] && command -v sysctl >/dev/null 2>&1; then
    detected="$(sysctl -n hw.ncpu 2>/dev/null || true)"
  fi
  case "$detected" in
    ''|*[!0-9]*) detected=2 ;;
  esac
  if [ "$detected" -lt 1 ]; then
    detected=2
  fi
  printf '%s\n' "$detected"
}

# The sections are CPU-heavy.  Default to online CPUs minus four, with a floor
# of two and a cap of six, so an 8-shard run keeps two CPU slots of headroom on
# a normal worker while a 2-core worker never launches all eight at once.  The
# batch size remains configurable for CI hosts with known capacity.
if [ -n "${PHASE_LOOP_CLAIM_SMOKE_BATCH_SIZE:-}" ]; then
  case "$PHASE_LOOP_CLAIM_SMOKE_BATCH_SIZE" in
    ''|*[!0-9]*) echo "PHASE_LOOP_CLAIM_SMOKE_BATCH_SIZE must be a positive integer" >&2; exit 2 ;;
  esac
  if [ "$PHASE_LOOP_CLAIM_SMOKE_BATCH_SIZE" -lt 1 ]; then
    echo "PHASE_LOOP_CLAIM_SMOKE_BATCH_SIZE must be a positive integer" >&2
    exit 2
  fi
else
  phase_loop_smoke_cpu_count_value="$(phase_loop_smoke_cpu_count)"
  PHASE_LOOP_CLAIM_SMOKE_BATCH_SIZE=$((phase_loop_smoke_cpu_count_value - 4))
  if [ "$phase_loop_smoke_cpu_count_value" -eq 1 ]; then
    PHASE_LOOP_CLAIM_SMOKE_BATCH_SIZE=1
  elif [ "$PHASE_LOOP_CLAIM_SMOKE_BATCH_SIZE" -lt 2 ]; then
    PHASE_LOOP_CLAIM_SMOKE_BATCH_SIZE=2
  elif [ "$PHASE_LOOP_CLAIM_SMOKE_BATCH_SIZE" -gt 6 ]; then
    PHASE_LOOP_CLAIM_SMOKE_BATCH_SIZE=6
  fi
fi

# Preserve the historical 45-second bound when the suite is intentionally
# configured for the old eight-way fan-out.  Otherwise give each child a
# bounded amount of headroom proportional to the reduced parallelism; this
# avoids false timeout failures caused by CPU contention rather than a hung
# controller.  The low-parallelism bound is deliberately generous because
# the terminal fixtures are CPU-heavy when all shards share one host.
if [ -z "${PHASE_LOOP_COMMAND_TIMEOUT_SECONDS:-}" ]; then
  case "$PHASE_LOOP_CLAIM_SMOKE_BATCH_SIZE" in
    1) PHASE_LOOP_COMMAND_TIMEOUT_SECONDS=180 ;;
    2) PHASE_LOOP_COMMAND_TIMEOUT_SECONDS=180 ;;
    3|4|5|6) PHASE_LOOP_COMMAND_TIMEOUT_SECONDS=180 ;;
    *) PHASE_LOOP_COMMAND_TIMEOUT_SECONDS=45 ;;
  esac
else
  PHASE_LOOP_COMMAND_TIMEOUT_SECONDS="$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS"
fi
if [ -z "${PHASE_LOOP_CLAIM_SMOKE_CPU_COUNT:-}" ]; then
  phase_loop_smoke_cpu_count_value="${phase_loop_smoke_cpu_count_value:-$(phase_loop_smoke_cpu_count)}"
  PHASE_LOOP_CLAIM_SMOKE_CPU_COUNT="$phase_loop_smoke_cpu_count_value"
fi
export PHASE_LOOP_CLAIM_SMOKE_BATCH_SIZE PHASE_LOOP_COMMAND_TIMEOUT_SECONDS PHASE_LOOP_CLAIM_SMOKE_CPU_COUNT
if [ "$PHASE_LOOP_CLAIM_SMOKE_SECTION" = "all" ]; then
  printf 'phase-loop claim smoke scheduler: cpus=%s batch_size=%s command_timeout=%ss watchdog=%ss\n' \
    "$(phase_loop_smoke_cpu_count)" "$PHASE_LOOP_CLAIM_SMOKE_BATCH_SIZE" \
    "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP_CLAIM_SMOKE_TIMEOUT_SECONDS" >&2
fi

claim_smoke_section_enabled() {
  [ "$PHASE_LOOP_CLAIM_SMOKE_SECTION" = "all" ] || [ "$PHASE_LOOP_CLAIM_SMOKE_SECTION" = "$1" ]
}

# PR fixtures use a local bare repository for push assertions, while the
# production actor preflight intentionally requires origin to identify the
# real GitHub repository. Keep those concerns separate: origin carries the
# canonical repository identity and fixture-origin carries the local test
# transport selected through PHASE_LOOP_PR_REMOTE.
phase_loop_prepare_pr_fixture_workspace() {
  local workspace="$1"
  local remote="$2"
  mkdir -p "$workspace/docs/architecture"
  cp "$REPO_ROOT/docs/architecture/phase-loop-actor-separation-policy.json" \
    "$workspace/docs/architecture/phase-loop-actor-separation-policy.json"
  git -C "$workspace" remote set-url origin "https://github.com/${PHASE_LOOP_TEST_REPOSITORY}.git"
  git -C "$workspace" remote add fixture-origin "$remote"
  git -C "$workspace" add \
    docs/architecture/phase-loop-actor-separation-policy.json \
    scripts/phase-loop-pr-actor-guard.mjs
  git -C "$workspace" -c user.name=Brownie -c user.email=brownie@example.invalid \
    commit -m 'fixture actor policy baseline' >/dev/null
}

case "$PHASE_LOOP_CLAIM_SMOKE_SECTION" in
  all|core|terminal|completion|terminal-absent|queue-claim|queue-recovery|queue-integrity|pr|lifecycle|guards|feedback) ;;
  *)
    echo "unknown phase-loop claim smoke section: $PHASE_LOOP_CLAIM_SMOKE_SECTION" >&2
    exit 2
    ;;
esac

# The suite contains independent temporary-workspace fixtures. Run those
# sections in parallel so adding another bounded fixture does not turn the
# single serial smoke process into a CI watchdog timeout. Each child gets its
# own controller store and suite watchdog; a failed child still fails the
# aggregate command with its diagnostics.
if [ "$PHASE_LOOP_CLAIM_SMOKE_SECTION" = "all" ]; then
  claim_smoke_shard_dir="$(mktemp -d)"
  claim_smoke_shards=(core terminal completion terminal-absent queue-claim queue-recovery queue-integrity pr guards feedback lifecycle)
  # A guards shard must pass end-to-end. Treating its historical static-check
  # failure as success would mask the very controller regressions this suite
  # exists to catch.
  claim_smoke_expected_exit_contract="guards=0"
  phase_loop_claim_smoke_run_scheduler \
    "$claim_smoke_shard_dir" "$0" "$PHASE_LOOP_CLAIM_SMOKE_BATCH_SIZE" \
    "$PHASE_LOOP_CLAIM_SMOKE_TIMEOUT_SECONDS" "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" \
    "$claim_smoke_expected_exit_contract" \
    "${claim_smoke_shards[@]}"
  exit "$?"
fi

if ! command -v rg >/dev/null 2>&1; then
  fallback_bin_dir="$(mktemp -d)"
  cat > "$fallback_bin_dir/rg" <<'SH'
#!/usr/bin/env bash
set -eu
quiet=0
if [ "${1:-}" = "-q" ]; then
  quiet=1
  shift
fi
if [ "${1:-}" = "--" ]; then
  shift
fi
pattern="${1:?missing pattern}"
shift
if [ "$quiet" = "1" ]; then
  grep -E -q -- "$pattern" "$@"
else
  grep -E -- "$pattern" "$@"
fi
SH
  chmod +x "$fallback_bin_dir/rg"
  PATH="$fallback_bin_dir:$PATH"
  export PATH
fi

assert_contains() {
  local file="$1"
  local pattern="$2"
  if ! rg -q -- "$pattern" "$file"; then
    echo "expected $file to contain pattern: $pattern" >&2
    exit 1
  fi
}

assert_not_contains() {
  local file="$1"
  local pattern="$2"
  if rg -q -- "$pattern" "$file"; then
    echo "expected $file not to contain pattern: $pattern" >&2
    exit 1
  fi
}

assert_terminal_failure_claim_archived() {
  local claim_dir="$1"
  local blocked_path="$2"
  local ledger_path="$3"
  local selected_prefix="$4"
  local expected_archive_count="$5"
  local allow_unrelated_current="${6:-0}"
  python3 - "$claim_dir" "$blocked_path" "$ledger_path" "$selected_prefix" "$expected_archive_count" "$allow_unrelated_current" <<'PY'
import json
import pathlib
import sys

claim_dir = pathlib.Path(sys.argv[1])
blocked_path = pathlib.Path(sys.argv[2])
ledger_path = pathlib.Path(sys.argv[3])
selected_prefix = sys.argv[4]
expected_archive_count = int(sys.argv[5])
allow_unrelated_current = sys.argv[6] == "1"
current_path = claim_dir / "current.json"
if current_path.exists():
    current = json.loads(current_path.read_text(encoding="utf-8"))
    assert allow_unrelated_current, current
    assert selected_prefix not in str(current.get("selected_todo", "")), current
archives = sorted(claim_dir.glob("stale-*.json"))
assert len(archives) == expected_archive_count, archives
archived = [json.loads(path.read_text(encoding="utf-8")) for path in archives]
matching = [claim for claim in archived if selected_prefix in str(claim.get("selected_todo", ""))]
assert len(matching) == expected_archive_count, matching
assert all(claim.get("status") == "failed" for claim in matching), matching
assert all(claim.get("archive_reason") == "terminal_failure_retry" for claim in matching), matching
claim_ids = {str(claim.get("claim_id") or "") for claim in matching}
assert all(claim_ids), matching
blocked = [
    json.loads(line)
    for line in blocked_path.read_text(encoding="utf-8").splitlines()
    if line.strip()
]
assert any(
    record.get("terminal_failure") is True
    and record.get("claim_id") in claim_ids
    and selected_prefix in str(record.get("selected_todo", ""))
    for record in blocked
), blocked
ledger_records = [
    json.loads(line)
    for line in ledger_path.read_text(encoding="utf-8").splitlines()
    if line.strip()
]
terminal_events = []
for record in ledger_records:
    if record.get("kind") == "terminal_failure_transaction":
        terminal_events.extend(record.get("events", []))
assert all(
    any(
        event.get("claim_id") == claim_id
        and selected_prefix in str(event.get("selected_todo", ""))
        and "@" in str(event.get("task_id", ""))
        for event in terminal_events
    )
    for claim_id in claim_ids
), (claim_ids, terminal_events)
PY
}

run_with_timeout() {
  local original_brownie="${BROWNIE_BIN:-}"
  local attested_brownie=""
  local node_bin="$(command -v node)"
  if [ -n "$original_brownie" ] && [ -x "$original_brownie" ] &&
    [ -z "${PHASE_LOOP_TEST_CHILD_PID_FILE:-}" ] &&
    printf '%s\n' "$*" | grep -Fq "$PHASE_LOOP"; then
    attested_brownie="$(mktemp)"
    cat > "$attested_brownie" <<SH
#!/usr/bin/env bash
set +e
output_file=\$(mktemp)
child_pid=""
terminate_child_tree() {
  local pid="\$1"
  local child
  for child in \$(pgrep -P "\$pid" 2>/dev/null || true); do
    terminate_child_tree "\$child"
  done
  kill -TERM "\$pid" 2>/dev/null || true
}
cleanup_child() {
  if [ -n "\$child_pid" ] && kill -0 "\$child_pid" 2>/dev/null; then
    terminate_child_tree "\$child_pid"
    sleep 1
    terminate_child_tree "\$child_pid"
  fi
}
trap cleanup_child TERM INT
"$original_brownie" "\$@" >"\$output_file" &
child_pid=\$!
wait "\$child_pid"
original_status=\$?
child_pid=""
trap - TERM INT
set -e
admission_file="\${BROWNIE_PHASE_LOOP_ADMISSION_FILE:-}"
if [ -z "\$admission_file" ] && [ -n "\${PHASE_LOOP_STATE_DIR:-}" ] && [ -d "\$PHASE_LOOP_STATE_DIR/runs" ]; then
  admission_file="\$(find "\$PHASE_LOOP_STATE_DIR/runs" -type f -name '*.runtime-admission.json' -print 2>/dev/null | LC_ALL=C sort | tail -n 1)"
fi
"$node_bin" - "\$output_file" "\${BROWNIE_PHASE_LOOP_CLAIM_ID:-}" "\$admission_file" <<'NODE'
const fs = require('node:fs');
const [outputFile, claimId, admissionFile] = process.argv.slice(2);
const text = fs.readFileSync(outputFile, 'utf8');
try {
  const root = JSON.parse(text);
  const payload = root?.run && typeof root.run === 'object'
    ? root.run
    : root?.resume && typeof root.resume === 'object'
      ? root.resume
      : root;
  if (claimId && payload && typeof payload === 'object') {
    payload.phase_loop_claim_id = claimId;
    if (admissionFile) {
      const admission = JSON.parse(fs.readFileSync(admissionFile, 'utf8'));
      payload.phase_loop_selected_todo_id = admission.selected_todo_id;
      payload.phase_loop_selected_todo_sha256 = admission.selected_todo_sha256;
      payload.phase_loop_queue_generation = admission.queue_generation;
      payload.phase_loop_queue_fingerprint = admission.queue_fingerprint;
    }
  }
  process.stdout.write(JSON.stringify(root) + '\\n');
} catch {
  process.stdout.write(text);
}
NODE
node_status=\$?
rm -f "\$output_file"
if [ "\$original_status" -ne 0 ]; then exit "\$original_status"; fi
exit "\$node_status"
SH
    chmod +x "$attested_brownie"
    BROWNIE_BIN="$attested_brownie" phase_loop_claim_smoke_run_with_timeout "$@"
    local result=$?
    rm -f "$attested_brownie"
    return "$result"
  fi
  phase_loop_claim_smoke_run_with_timeout "$@"
}

wait_for_pid_exit() {
  phase_loop_claim_smoke_wait_for_pid_exit "$@"
}

assert_contains "$PHASE_LOOP" "phase-loop-todo-queue-integrity\\.mjs"
assert_contains "$PHASE_LOOP" 'local guard_script="\$ROOT_DIR/scripts/phase-loop-source-baseline-guard\.mjs"'
assert_contains "$PHASE_LOOP" 'node "\$guard_script" --repo "\$ROOT_DIR" --baseline-ref "\$PHASE_LOOP_APPROVED_CONTROLLER_BASELINE"'
assert_contains "$PHASE_LOOP" 'phase-loop-task-ledger\.mjs" record-trajectory --repo "\$PHASE_LOOP_WORKSPACE_ROOT"'
assert_contains "$PHASE_LOOP" "phase-loop-run-state\.mjs"
assert_contains "$PHASE_LOOP" "\.brownie/headless-\*"
assert_contains "$PHASE_LOOP" 'controller-fingerprint "\$controller_fingerprint"'
assert_contains "$PHASE_LOOP" "Zero means the first terminal failure is stable/blocked"
assert_contains "$PHASE_LOOP" "refusing to leave status running"
assert_not_contains "$PHASE_LOOP" 'phase-loop-task-ledger\.mjs" record-trajectory --repo "\$ROOT_DIR"'
assert_not_contains "$PHASE_LOOP" 'phase-loop-task-ledger\.mjs" record-trajectory --repo "\$PHASE_LOOP_STATE_DIR"'
assert_not_contains "$PHASE_LOOP" 'phase-loop-task-ledger\.mjs" record-trajectory --repo "\$STATE_DIR"'
assert_contains "$PHASE_LOOP" 'path == ".brownie/private" or path.startswith\(".brownie/private/"\)'
assert_contains "$PHASE_LOOP" 'and path not in controller_private_paths'
assert_contains "$PHASE_LOOP" "todo_queue_integrity_failed_before_claim"
assert_contains "$PHASE_LOOP" "PHASE_LOOP_TODO_QUEUE_INTEGRITY_FAILED"
assert_contains "$PHASE_LOOP" "baseline_diff_files"
assert_contains "$PHASE_LOOP" "baseline_todo_text"
assert_contains "$PHASE_LOOP" 'claim\["baseline_todo_text"\] = todo_text'
assert_contains "$PHASE_LOOP" 'claim\["baseline_diff_files"\] = baseline_diff_files'
assert_contains "$PHASE_LOOP" "baseline_diff_matches_live_workspace"
assert_contains "$PHASE_LOOP" 'immutable_selected_todo_changed_in_live_queue'
assert_contains "$PHASE_LOOP" 'refreshed_claim_context_without_mutating_selected_todo'
assert_contains "$PHASE_LOOP" "objective_apply_stalled"
assert_contains "$PHASE_LOOP" "TODO queue repair is a mutually-exclusive controller state"
assert_contains "$PHASE_LOOP" "leaf_execution_policy_lines = \\[\\]"
assert_contains "$PHASE_LOOP" "todo_contract_repair_before_bounded_leaf"
assert_contains "$PHASE_LOOP" "must_preserve_todo_guard_priority"
assert_contains "$PHASE_LOOP" "selected_todo_dirty_baseline_verified_completion"
assert_contains "$PHASE_LOOP" "selected_targets_already_dirty_and_verification_passed"
assert_contains "$PHASE_LOOP" "pruned_completed_dependency_lines"
assert_not_contains "$PHASE_LOOP" "breakdown_only_dependency_pruned"
assert_contains "$PHASE_LOOP" "phase_loop_claim_id"
assert_contains "$PHASE_LOOP" "phase_loop_selected_todo_first_line"
assert_contains "$PHASE_LOOP" "feedback_identity_missing"
assert_contains "$PHASE_LOOP" "progress_projection_claim_id_mismatch"
assert_contains "$CLAIM_SMOKE_SCHEDULER" "timed_out=1"
assert_contains "$CLAIM_SMOKE_SCHEDULER" "setsid"
assert_contains "$CLAIM_SMOKE_SCHEDULER" "shard_timeout"
assert_contains "$CLAIM_SMOKE_SCHEDULER" "claim-smoke-audit.json"
assert_contains "$PHASE_LOOP" "Every generated leaf ID must be unique within new_text"
assert_contains "$PHASE_LOOP" "A leaf must never depend on itself"
assert_contains "$PHASE_LOOP" "distinct prerequisite TODO ID already present in the live queue"
assert_contains "$PHASE_LOOP" 'never generate a read-only `Read`, `Inspect`, or `Extract` leaf'
assert_contains "$PHASE_LOOP" "phase-loop-pr-actor-guard.mjs"
assert_contains "${BASH_SOURCE[0]}" "phase_loop_smoke_cpu_count"
assert_contains "${BASH_SOURCE[0]}" "PHASE_LOOP_CLAIM_SMOKE_BATCH_SIZE"
assert_contains "$CLAIM_SMOKE_SCHEDULER" 'local batch_size="\$3"'

claim_smoke_live_private_state_sha256() {
  local state_root="$REPO_ROOT/.brownie/private/phase-loop"
  if [ ! -d "$state_root" ]; then
    printf '%s\n' absent
    return 0
  fi
  # Historical run archives can be large and are deliberately not live control
  # state. Hash only the bounded files that a fixture could accidentally use as
  # its active controller store. Isolation is enforced by explicit state-root
  # injection below, so recursively hashing all retained evidence would turn a
  # non-mutating smoke test into an unbounded operation.
  local relative_path
  local -a live_paths=(
    'current.json'
    'progress-state.json'
    'run-state.json'
    'status.json'
    'worker-launch-receipt.json'
    'todo-claims/current.json'
    'todo-claims/repair-feedback.json'
    'todo-claims/failure-ledger.jsonl'
  )
  {
    for relative_path in "${live_paths[@]}"; do
      if [ -f "$state_root/$relative_path" ]; then
        shasum "$state_root/$relative_path" | sed "s#  $state_root/#  #"
      fi
    done
  } | LC_ALL=C sort | shasum | awk '{print $1}'
}

# Every scenario below must confine queue mutations to its own TODO/breakdown
# paths.  A smoke fixture must never mutate the repository queue that CI later
# validates, even when the scenario exits through a replan or repair path.
CLAIM_SMOKE_REPO_TODO_SHA256="$(shasum "$REPO_ROOT/.brownie/todo.md" | awk '{print $1}')"
CLAIM_SMOKE_REPO_BREAKDOWN_SHA256="$(shasum "$REPO_ROOT/.brownie/todo-breakdown.md" | awk '{print $1}')"
CLAIM_SMOKE_REPO_PRIVATE_STATE_SHA256="$(claim_smoke_live_private_state_sha256)"
# Test invocations always use temporary queue/state paths; their durable
# controller store must be isolated as well.  Otherwise phase-loop's default
# store rooted at this repository can leave replan records that alter later
# repository guards despite an unchanged fixture TODO.
CLAIM_SMOKE_BROWNIE_STORE_ROOT="$(mktemp -d)"
export PHASE_LOOP_BROWNIE_STORE_ROOT="$CLAIM_SMOKE_BROWNIE_STORE_ROOT"

assert_repository_state_unchanged() {
  local current_todo_sha256
  local current_breakdown_sha256
  current_todo_sha256="$(shasum "$REPO_ROOT/.brownie/todo.md" | awk '{print $1}')"
  current_breakdown_sha256="$(shasum "$REPO_ROOT/.brownie/todo-breakdown.md" | awk '{print $1}')"
  local current_private_state_sha256
  current_private_state_sha256="$(claim_smoke_live_private_state_sha256)"
  if [ "$current_todo_sha256" != "$CLAIM_SMOKE_REPO_TODO_SHA256" ] || [ "$current_breakdown_sha256" != "$CLAIM_SMOKE_REPO_BREAKDOWN_SHA256" ] || [ "$current_private_state_sha256" != "$CLAIM_SMOKE_REPO_PRIVATE_STATE_SHA256" ]; then
    echo "phase-loop claim smoke leaked temporary controller state into the repository: todo=${PHASE_LOOP_TODO:-<default>} breakdown=${PHASE_LOOP_TODO_BREAKDOWN:-<default>} workspace=${PHASE_LOOP_WORKSPACE_ROOT:-<default>} state=${PHASE_LOOP_STATE_DIR:-<default>}" >&2
    return 97
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
    "status": "no_eligible_task",
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
fake_brownie_todo_md_only_apply="$(mktemp)"
cat > "$fake_brownie_todo_md_only_apply" <<'SH'
#!/usr/bin/env bash
set -eu
cat <<JSON
{
  "automation": {
    "schema_version": 1,
    "status": "continuation_required",
    "controller_action": "resume",
    "stop_class": "continuation_required",
    "stop_reason": "objective_proposal_candidate_ready",
    "completed": false,
    "blocked": false,
    "retryable": true,
    "terminal_failure": false,
    "task_id": "task-todo-md-only",
    "run_id": "run-todo-md-only",
    "journey_id": "journey-todo-md-only",
    "next_action": "inspect_progress_overview",
    "next_invocation": {"command": "resume", "arguments": []}
  },
  "status": "objective_proposal_applied",
  "task_id": "task-todo-md-only",
  "run_id": "run-todo-md-only",
  "journey_id": "journey-todo-md-only",
  "completion_closure_status": "routed_explicit_action",
  "next_action": "inspect_progress_overview",
  "completed": false,
  "blocked": false,
  "retryable": true,
  "terminal_failure": false,
  "controller_action": "resume",
  "stop_class": "continuation_required",
  "stop_reason": "objective_proposal_candidate_ready",
  "objective_apply_applied": true,
  "objective_apply_apply_status": "Applied",
  "objective_apply_path": "${PHASE_LOOP_TEST_OBJECTIVE_APPLY_PATH:-todo.md}",
  "next_invocation": {"command": "resume", "arguments": []}
}
JSON
SH
chmod +x "$fake_brownie_todo_md_only_apply"
fake_brownie_no_actionable="$(mktemp)"
cat > "$fake_brownie_no_actionable" <<'SH'
#!/usr/bin/env bash
set -eu
cat <<'JSON'
{
  "automation": {
    "schema_version": 1,
    "status": "no_actionable_work",
    "controller_action": "stop",
    "stop_class": "no_actionable_work",
    "stop_reason": "no_actionable_work",
    "completed": false,
    "blocked": false,
    "retryable": false,
    "terminal_failure": false,
    "task_id": null,
    "run_id": null,
    "journey_id": null,
    "next_action": "inspect_progress_overview",
    "next_invocation": null
  },
  "status": "no_eligible_task",
  "completed": false,
  "blocked": false,
  "retryable": false,
  "terminal_failure": false,
  "controller_action": "stop",
  "stop_class": "no_actionable_work",
  "stop_reason": "no_actionable_work",
  "next_action": "inspect_progress_overview"
}
JSON
SH
chmod +x "$fake_brownie_no_actionable"
fake_brownie_terminal_no_eligible="$(mktemp)"
cat > "$fake_brownie_terminal_no_eligible" <<'SH'
#!/usr/bin/env bash
set -eu
if [ "${PHASE_LOOP_TEST_HEADLESS_ONLY:-0}" = "1" ]; then
  mkdir -p "$PHASE_LOOP_WORKSPACE_ROOT/.brownie/headless-continuations"
  printf '%s\n' '{"headless":"controller-output-only"}' > "$PHASE_LOOP_WORKSPACE_ROOT/.brownie/headless-continuations/fresh-run.json"
fi
if [ "${PHASE_LOOP_TEST_REMOVE_CLAIM:-0}" = "1" ]; then
  rm -f "$PHASE_LOOP_STATE_DIR/todo-claims/current.json"
fi
cat <<'JSON'
{
  "command": "run",
  "ok": true,
  "run": {
    "automation": {
      "schema_version": 1,
      "status": "terminal_failure",
      "controller_action": "stop",
      "stop_class": "terminal_failure",
      "stop_reason": "terminal_task_failed",
      "completed": false,
      "blocked": true,
      "retryable": false,
      "terminal_failure": true,
      "task_id": "task-terminal",
      "run_id": "run-terminal",
      "journey_id": "journey-terminal",
      "next_action": "inspect_progress_overview",
      "next_invocation": null,
      "llm_provider_failure": {
        "failure_fingerprint": "sha256:provider-terminal-no-content",
        "failure_class": "missing_provider_content",
        "retryable": true
      }
    },
    "status": "no_eligible_task",
    "session_id": "session-terminal",
    "drive_id": "drive-terminal",
    "task_id": "task-terminal",
    "run_id": "run-terminal",
    "journey_id": "journey-terminal",
    "terminal_completion_final_state": "Failed",
    "terminal_completion_task_status": "Failed",
    "completion_closure_terminal_task_count": 1,
    "executed_count": 1,
    "task_execution": {
      "started": true,
      "target_files": ["scripts/provider-target.mjs"],
      "verification_commands": ["node --check scripts/provider-target.mjs"]
    },
    "completion_closure_status": "no_eligible_task",
    "next_action": "inspect_progress_overview",
    "completed": false,
    "blocked": true,
    "retryable": false,
    "terminal_failure": true,
    "controller_action": "stop",
    "stop_class": "terminal_failure",
    "stop_reason": "terminal_task_failed",
    "next_invocation": null,
    "llm_provider_failure": {
      "failure_fingerprint": "sha256:provider-terminal-no-content",
      "failure_class": "missing_provider_content",
      "retryable": true
    }
  }
}
JSON
SH
chmod +x "$fake_brownie_terminal_no_eligible"
fake_brownie_terminal_task_executed="$(mktemp)"
sed 's/"status": "no_eligible_task"/"status": "task_executed"/' "$fake_brownie_terminal_no_eligible" > "$fake_brownie_terminal_task_executed"
chmod +x "$fake_brownie_terminal_task_executed"
fake_brownie_terminal_unproposed_workspace_write="$(mktemp)"
cat > "$fake_brownie_terminal_unproposed_workspace_write" <<'SH'
#!/usr/bin/env bash
set -eu
run_id="run-terminal-unproposed-workspace-write"
mkdir -p "$BROWNIE_STORE_ROOT/runs/$run_id"
if [ "${PHASE_LOOP_TEST_TERMINAL_UNPROPOSED_MODE:-matching}" = "matching" ]; then
  cat > "$BROWNIE_STORE_ROOT/runs/$run_id/ledger.jsonl" <<'JSON'
{"kind":"AgentLoopCompleted","payload":{"completion_summary":"LLM tool intent did not produce a valid workspace.write proposal for a workspace edit task","final_state":"Failed"}}
{"kind":"TaskFailed","payload":{"completion_evidence":{"completion_summary_preview":"LLM tool intent did not produce a valid workspace.write proposal for a workspace edit task","final_state":"Failed","task_status":"Failed","final_response_present":false}}}
JSON
else
  cat > "$BROWNIE_STORE_ROOT/runs/$run_id/ledger.jsonl" <<'JSON'
{"kind":"AgentLoopCompleted","payload":{"completion_summary":"verification command failed before a workspace edit","final_state":"Failed"}}
{"kind":"TaskFailed","payload":{"completion_evidence":{"completion_summary_preview":"verification command failed before a workspace edit","final_state":"Failed","task_status":"Failed","final_response_present":false}}}
JSON
fi
cat <<JSON
{
  "command": "run",
  "ok": true,
  "run": {
    "automation": {
      "schema_version": 1,
      "status": "continuation_required",
      "controller_action": "resume",
      "stop_class": "continuation_required",
      "stop_reason": "terminal_completion_evidence_missing",
      "completed": false,
      "blocked": true,
      "retryable": false,
      "terminal_failure": false,
      "task_id": "task-terminal-unproposed",
      "run_id": "$run_id",
      "next_action": "inspect_progress_overview",
      "next_invocation": {"command": "resume", "arguments": []}
    },
    "status": "task_executed",
    "task_id": "task-terminal-unproposed",
    "run_id": "$run_id",
    "completion_closure_status": "unknown_nonterminal",
    "task_execution_confirmed": true,
    "completed": false,
    "blocked": true,
    "retryable": false,
    "terminal_failure": false,
    "controller_action": "resume",
    "stop_class": "continuation_required",
    "stop_reason": "terminal_completion_evidence_missing",
    "next_action": "inspect_progress_overview",
    "next_invocation": {"command": "resume", "arguments": []}
  }
}
JSON
SH
chmod +x "$fake_brownie_terminal_unproposed_workspace_write"
fake_brownie_runtime_authorization_expired="$(mktemp)"
cat > "$fake_brownie_runtime_authorization_expired" <<'SH'
#!/usr/bin/env bash
set -eu
claim_id="${BROWNIE_PHASE_LOOP_CLAIM_ID:?missing admitted claim id}"
claim_digest="$(python3 - "$claim_id" <<'PY'
import hashlib
import sys
print(hashlib.sha256(sys.argv[1].encode('utf-8')).hexdigest())
PY
)"
session_store="$PHASE_LOOP_BROWNIE_STORE_ROOT/phase-loop-claims/$claim_digest"
mkdir -p "$session_store"
printf '%s\n' '{"session":"approval-expired"}' > "$session_store/ledger.json"
cat <<'JSON'
{
  "status": "runtime_proposal_apply_approval_expired",
  "stop_class": "terminal_failure",
  "terminal_failure": true,
  "controller_action": "return_to_supervisor",
  "error": {
    "code": "runtime_proposal_apply_approval_expired",
    "message": "controlled proposal authorization expired before apply"
  }
}
JSON
exit 70
SH
chmod +x "$fake_brownie_runtime_authorization_expired"
fake_brownie_terminal_no_eligible_counted="$(mktemp)"
cat > "$fake_brownie_terminal_no_eligible_counted" <<SH
#!/usr/bin/env bash
set -eu
count_file="\$PHASE_LOOP_STATE_DIR/terminal-no-eligible-count"
count="\$(cat "\$count_file" 2>/dev/null || printf '0')"
printf '%s\n' "\$((count + 1))" > "\$count_file"
exec "$fake_brownie_terminal_no_eligible" "\$@"
SH
chmod +x "$fake_brownie_terminal_no_eligible_counted"
fake_brownie_terminal_retry_then_success="$(mktemp)"
cat > "$fake_brownie_terminal_retry_then_success" <<SH
#!/usr/bin/env bash
set -eu
attempt_file="\$PHASE_LOOP_STATE_DIR/terminal-retry-then-success.attempt"
attempt="\$(python3 - "\$attempt_file" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
attempt = int(path.read_text(encoding='utf-8')) if path.exists() else 0
attempt += 1
path.write_text(str(attempt), encoding='utf-8')
print(attempt)
PY
)"
if [ "\$attempt" -eq 1 ] && [ "\${PHASE_LOOP_TEST_REMOVE_CLAIM:-0}" = "1" ]; then
  rm -f "\$PHASE_LOOP_STATE_DIR/todo-claims/current.json"
fi
if [ "\$attempt" -ge 2 ]; then
  target_path="\$(python3 - "\$PHASE_LOOP_TODO" <<'PY'
import pathlib
import re
import sys

text = pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')
backtick = chr(96)
marker = 'Patch only ' + backtick
match = re.search(re.escape(marker) + r'([^' + backtick + r']+)' + backtick, text)
assert match, text
print(match.group(1))
PY
)"
  test -n "\$target_path"
  printf '\nexport const phaseLoopRetryFixtureCompleted = true;\n' >> "\$PHASE_LOOP_WORKSPACE_ROOT/\$target_path"
  task_execution_json="\$(python3 - "\$target_path" <<'PY'
import json
import sys

target = sys.argv[1]
print(json.dumps({
    'started': True,
    'target_files': [target],
    'verification_commands': [f'node --check {target}'],
}))
PY
)"
  cat <<JSON
{
  "command": "run",
  "ok": true,
  "run": {
    "automation": {
      "schema_version": 1,
      "status": "completed",
      "controller_action": "stop",
      "stop_class": "completed",
      "stop_reason": "task_completed",
      "completed": true,
      "blocked": false,
      "retryable": false,
      "terminal_failure": false
    },
    "status": "completed",
    "completion_closure_status": "completed",
    "completed": true,
    "blocked": false,
    "retryable": false,
    "terminal_failure": false,
    "controller_action": "stop",
    "stop_class": "completed",
    "stop_reason": "task_completed",
    "next_action": "inspect_progress_overview",
    "task_execution": \$task_execution_json
  }
}
JSON
else
  exec "$fake_brownie_terminal_no_eligible" "\$@"
fi
SH
chmod +x "$fake_brownie_terminal_retry_then_success"
fake_brownie_completed="$(mktemp)"
cat > "$fake_brownie_completed" <<'SH'
#!/usr/bin/env bash
set -eu
if [ "${PHASE_LOOP_TEST_MUTATE_TARGET:-0}" = "1" ]; then
  target_path="$(sed -n 's/.*Patch only `\([^`]*\)`.*/\1/p' "$PHASE_LOOP_TODO" | head -n 1)"
  test -n "$target_path"
  mkdir -p "$(dirname "$PHASE_LOOP_WORKSPACE_ROOT/$target_path")"
  printf '\nexport const phaseLoopCompletionFixtureCompleted = true;\n' >> "$PHASE_LOOP_WORKSPACE_ROOT/$target_path"
fi
cat <<'JSON'
{
  "command": "run",
  "ok": true,
  "run": {
    "automation": {
      "schema_version": 1,
      "status": "completed",
      "controller_action": "stop",
      "stop_class": "completed",
      "stop_reason": "task_completed",
      "completed": true,
      "blocked": false,
      "retryable": false,
      "terminal_failure": false
    },
    "status": "completed",
    "completion_closure_status": "completed",
    "completed": true,
    "blocked": false,
    "retryable": false,
    "terminal_failure": false,
    "controller_action": "stop",
    "stop_class": "completed",
    "stop_reason": "task_completed",
    "next_action": "inspect_progress_overview"
  }
}
JSON
SH
chmod +x "$fake_brownie_completed"
fake_brownie_completed_tracked_workspace_change="$(mktemp)"
cat > "$fake_brownie_completed_tracked_workspace_change" <<'SH'
#!/usr/bin/env bash
set -eu
if [ "${2:-}" = "run" ]; then
  printf 'completed workspace change from Brownie phase-loop\n' > README.md
fi
cat <<'JSON'
{
  "command": "run",
  "ok": true,
  "run": {
    "automation": {
      "schema_version": 1,
      "status": "completed",
      "controller_action": "stop",
      "stop_class": "completed",
      "stop_reason": "task_completed",
      "completed": true,
      "blocked": false,
      "retryable": false,
      "terminal_failure": false
    },
    "status": "completed",
    "completion_closure_status": "completed",
    "completed": true,
    "blocked": false,
    "retryable": false,
    "terminal_failure": false,
    "controller_action": "stop",
    "stop_class": "completed",
    "stop_reason": "task_completed",
    "next_action": "inspect_progress_overview"
  }
}
JSON
SH
chmod +x "$fake_brownie_completed_tracked_workspace_change"
fake_brownie_objective_apply_pending="$(mktemp)"
cat > "$fake_brownie_objective_apply_pending" <<'SH'
#!/usr/bin/env bash
set -eu
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
      "stop_reason": "objective_proposal_candidate_ready",
      "completed": false,
      "blocked": false,
      "retryable": true,
      "terminal_failure": false,
      "task_id": "task-objective-apply",
      "run_id": "run-objective-apply",
      "journey_id": "journey-objective-apply",
      "next_action": "apply_authorized_objective_proposal",
      "next_invocation": {"command": "resume", "arguments": []}
    },
    "status": "no_eligible_task",
    "session_id": "session-objective-apply",
    "drive_id": "drive-objective-apply",
    "task_id": "task-objective-apply",
    "run_id": "run-objective-apply",
    "journey_id": "journey-objective-apply",
    "completion_closure_status": "routed_explicit_action",
    "next_action": "apply_authorized_objective_proposal",
    "completed": false,
    "blocked": false,
    "retryable": true,
    "terminal_failure": false,
    "controller_action": "resume",
    "stop_class": "continuation_required",
    "stop_reason": "objective_proposal_candidate_ready",
    "objective_proposal_preflight_status": "authorized_preflight_ready",
    "objective_proposal_preflight_operation": "patch_file",
    "objective_proposal_preflight_next_action": "apply_authorized_objective_proposal",
    "next_invocation": {"command": "resume", "arguments": []}
  }
}
JSON
SH
chmod +x "$fake_brownie_objective_apply_pending"
fake_brownie_objective_apply_legacy_resume="$(mktemp)"
cat > "$fake_brownie_objective_apply_legacy_resume" <<'SH'
#!/usr/bin/env bash
set -eu
cat <<'JSON'
{
  "command": "resume",
  "ok": true,
  "resume": {
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
      "next_action": "apply_authorized_objective_proposal",
      "next_invocation": {"command": "resume", "arguments": []},
      "outcome_source": "legacy_cli_projection"
    },
    "status": "task_executed",
    "candidate_count": 1,
    "continuation_id": "continuation-objective-apply",
    "next_action": "apply_authorized_objective_proposal",
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
chmod +x "$fake_brownie_objective_apply_legacy_resume"
fake_brownie_tracked_workspace_change="$(mktemp)"
cat > "$fake_brownie_tracked_workspace_change" <<'SH'
#!/usr/bin/env bash
set -eu
if [ "${2:-}" = "run" ]; then
  printf 'changed by brownie phase-loop\n' > README.md
fi
cat <<JSON
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
  "phase_loop_claim_id": "${BROWNIE_PHASE_LOOP_CLAIM_ID:-}",
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
fake_brownie_must_not_run="$(mktemp)"
cat > "$fake_brownie_must_not_run" <<'SH'
#!/usr/bin/env bash
echo "Brownie should not run for explicit blocker TODO claims" >&2
exit 99
SH
chmod +x "$fake_brownie_must_not_run"

if claim_smoke_section_enabled core; then
state_with_claim="$(mktemp -d)"
prompt_with_claim="$(mktemp)"
todo_with_claim="$(mktemp)"
printf 'base prompt\n' > "$prompt_with_claim"
printf -- '- [ ] B-01: durable claim task\n  with detail\n  Files: `scripts/release-runtime-operational-evidence.mjs`, `docs/architecture/local-release-targets.example.json`.\n- [ ] B-02: next task\n' > "$todo_with_claim"

PHASE_LOOP_STATE_DIR="$state_with_claim" \
PHASE_LOOP_PROMPT="$prompt_with_claim" \
PHASE_LOOP_TODO="$todo_with_claim" \
BROWNIE_BIN="$fake_brownie_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

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
prompt_text = open(sys.argv[4], encoding="utf-8").read()
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
assert progress_state["continuation_required"] is False, progress_state
assert progress_state["workspace_changed"] is False, progress_state
assert progress_state["progress_projection"]["closure"] == "budget_exhausted", progress_state
assert progress_state["progress_projection"]["stop_class"] == "continuation_required", progress_state
assert progress_state["progress_projection"]["controller_action"] == "resume", progress_state
assert prompt_meta["selected_todo_complete"] is False, prompt_meta
assert prompt_meta["selected_todo_completion_reason"] == "selected_todo_still_unchecked", prompt_meta
assert prompt_meta["context_hints"][:2] == [
    "scripts/release-runtime-operational-evidence.mjs",
    "docs/architecture/local-release-targets.example.json",
], prompt_meta
assert "A valid first response shape is" not in prompt_text, prompt_text
assert "Never copy a prior read request" in prompt_text, prompt_text
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

PHASE_LOOP_STATE_DIR="$state_with_blocked" \
PHASE_LOOP_PROMPT="$prompt_with_blocked" \
PHASE_LOOP_TODO="$todo_with_blocked" \
BROWNIE_BIN="$fake_brownie_blocked_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null
test ! -f "$state_with_blocked/stop"
python3 - "$state_with_blocked/status.json" "$state_with_blocked/todo-claims/current.json" <<'PY'
import json
import sys

status = json.load(open(sys.argv[1], encoding="utf-8"))
claim = json.load(open(sys.argv[2], encoding="utf-8"))
assert status["status"] == "blocked_todo_recorded", status
assert status["exit_code"] == "0", status
assert "blocked external-control boundary" in status["detail"], status
assert "will continue with the next unblocked TODO" in status["detail"], status
assert claim["status"] == "blocked", claim
PY
fi

if claim_smoke_section_enabled terminal; then
state_terminal_no_eligible="$(mktemp -d)"
prompt_terminal_no_eligible="$(mktemp)"
todo_terminal_no_eligible="$(mktemp)"
todo_breakdown_terminal_no_eligible="$(mktemp)"
root_breakdown_before="$(shasum "$REPO_ROOT/.brownie/todo-breakdown.md" | awk '{print $1}')"
printf 'base prompt\n' > "$prompt_terminal_no_eligible"
printf -- '- [ ] E-15a-redaction-guard: implement concrete guard task\n' > "$todo_terminal_no_eligible"

set +e
PHASE_LOOP_STATE_DIR="$state_terminal_no_eligible" \
PHASE_LOOP_PROMPT="$prompt_terminal_no_eligible" \
PHASE_LOOP_TODO="$todo_terminal_no_eligible" \
PHASE_LOOP_TODO_BREAKDOWN="$todo_breakdown_terminal_no_eligible" \
BROWNIE_BIN="$fake_brownie_terminal_no_eligible" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
PHASE_LOOP_TERMINAL_FAILURE_RETRY_CAP=0 \
PHASE_LOOP_TEST_HEADLESS_ONLY=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 76 "$PHASE_LOOP" run-once >/dev/null
terminal_no_eligible_exit="$?"
set -e
test "$terminal_no_eligible_exit" = "76"
test "$(shasum "$REPO_ROOT/.brownie/todo-breakdown.md" | awk '{print $1}')" = "$root_breakdown_before"
python3 - "$state_terminal_no_eligible/status.json" "$state_terminal_no_eligible/progress-state.json" "$state_terminal_no_eligible/todo-claims/current.json" "$state_terminal_no_eligible/todo-claims/repair-feedback.json" "$state_terminal_no_eligible/todo-claims/blocked.jsonl" "$test_workspace/.brownie/private/phase-loop/task-ledger.jsonl" <<'PY'
import json
import pathlib
import sys

status = json.load(open(sys.argv[1], encoding="utf-8"))
progress = json.load(open(sys.argv[2], encoding="utf-8"))
claim = json.load(open(sys.argv[3], encoding="utf-8"))
feedback = json.load(open(sys.argv[4], encoding="utf-8"))
blocked_path = pathlib.Path(sys.argv[5])
blocked = [json.loads(line) for line in blocked_path.read_text(encoding="utf-8").splitlines() if line.strip()] if blocked_path.exists() else []
ledger_path = pathlib.Path(sys.argv[6])
ledger = ledger_path.read_text(encoding="utf-8") if ledger_path.exists() else ""
assert status["status"] == "blocked", status
assert "retry_cap=0" in status["detail"], status
assert progress["classification"] == "terminal_failure", progress
assert progress["meaningful_progress"] is False, progress
assert progress["progress_projection"]["blocked_by_terminal_task_failure"] is True, progress
assert progress["progress_projection"]["provider_failure_fingerprint"] == "sha256:provider-terminal-no-content", progress
assert progress["workspace_changed"] is False, progress
assert claim["status"] == "in_progress", claim
assert claim["status_history"][-1]["status"] == "in_progress", claim
assert feedback.get("kind") == "phase_loop_terminal_failure_redelegation_required", feedback
assert feedback["claim_id"] == claim["claim_id"], feedback
assert feedback["recovery_state"] == "redelegatable", feedback
assert feedback["terminal_failure_cause"] == "terminal_task_failed_without_completion_detail", feedback
assert not blocked, blocked
assert "terminal_failure_transaction" not in ledger, ledger
PY

# Proposal approval expiry is a Runtime session recovery, not an admission
# failure.  The controller must recognise the exact CLI-shaped error before
# admission validation, restore its pre-dispatch authority, archive only the
# claim-local store, and require a fresh run without leaving status running.
state_authorization_expired="$(mktemp -d)"
prompt_authorization_expired="$(mktemp)"
todo_authorization_expired="$(mktemp)"
todo_breakdown_authorization_expired="$(mktemp)"
authorization_expired_workspace="$(mktemp -d)"
git -C "$authorization_expired_workspace" init -b main >/dev/null
git -C "$authorization_expired_workspace" config user.name Brownie
git -C "$authorization_expired_workspace" config user.email brownie@example.invalid
mkdir -p "$authorization_expired_workspace/scripts"
printf 'export const approvalExpiryFixture = true;\n' > "$authorization_expired_workspace/scripts/approval-expiry.mjs"
git -C "$authorization_expired_workspace" add .
git -C "$authorization_expired_workspace" commit -m init >/dev/null
printf 'base prompt\n' > "$prompt_authorization_expired"
printf -- '- [ ] E-authorization-expired: Patch only `scripts/approval-expiry.mjs`:\n  Route: implementation.\n  Verification: run `node --check scripts/approval-expiry.mjs`.\n' > "$todo_authorization_expired"
printf '# Breakdown\n' > "$todo_breakdown_authorization_expired"
PHASE_LOOP_STATE_DIR="$state_authorization_expired" \
PHASE_LOOP_PROMPT="$prompt_authorization_expired" \
PHASE_LOOP_TODO="$todo_authorization_expired" \
PHASE_LOOP_TODO_BREAKDOWN="$todo_breakdown_authorization_expired" \
BROWNIE_BIN="$fake_brownie_runtime_authorization_expired" \
PHASE_LOOP_WORKSPACE_ROOT="$authorization_expired_workspace" \
PHASE_LOOP_RUNTIME_AUTHORIZATION_REBASELINE_CAP=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null
authorization_expired_exit="$?"
test "$authorization_expired_exit" = "0"
python3 - "$state_authorization_expired" "$PHASE_LOOP_BROWNIE_STORE_ROOT" <<'PY'
import hashlib
import json
import pathlib
import sys

state = pathlib.Path(sys.argv[1])
store_root = pathlib.Path(sys.argv[2])
status = json.loads((state / 'status.json').read_text(encoding='utf-8'))
claim = json.loads((state / 'todo-claims/current.json').read_text(encoding='utf-8'))
assert status['status'] == 'continuation_required', status
assert status['exit_code'] == '0', status
assert 'Runtime proposal authorization expired before apply' in status['detail'], status
assert claim['runtime_authorization_rebaseline_count'] == 1, claim
assert claim['runtime_authorization_rebaseline_pending'] is True, claim
claim_digest = hashlib.sha256(claim['claim_id'].encode('utf-8')).hexdigest()
active = store_root / 'phase-loop-claims' / claim_digest
archives = sorted((store_root / 'phase-loop-claim-archives' / claim_digest).glob('*-authorization-expired'))
assert not active.exists(), active
assert len(archives) == 1, archives
assert (archives[0] / 'ledger.json').exists(), archives
audits = sorted((state / 'recovery-audits').glob('*-runtime-authorization-rebaseline.json'))
assert len(audits) == 1, audits
audit = json.loads(audits[0].read_text(encoding='utf-8'))
assert audit['claim_id'] == claim['claim_id'], audit
assert audit['cause'] == 'runtime_proposal_apply_approval_expired', audit
PY

# A stale terminal-looking claim must be isolated before a retry-cap-zero run.
# The fresh claim is allowed to execute once, but the old claim identity and
# terminal projection may not be inherited or re-recorded as a terminal block.
state_stale_r3="$(mktemp -d)"
prompt_stale_r3="$(mktemp)"
todo_stale_r3="$(mktemp)"
stale_r3_workspace="$(mktemp -d)"
git -C "$stale_r3_workspace" init -b main >/dev/null
mkdir -p "$stale_r3_workspace/.brownie/headless-continuations"
printf '%s\n' '{"headless":"controller-output-only"}' > "$stale_r3_workspace/.brownie/headless-continuations/fresh-run.json"
git -C "$stale_r3_workspace" add .brownie/headless-continuations/fresh-run.json
git -C "$stale_r3_workspace" -c user.name=Brownie -c user.email=brownie@example.invalid commit -m init >/dev/null
printf 'base prompt\n' > "$prompt_stale_r3"
printf -- '- [ ] E-stale-r3: Patch only `scripts/stale-r3.mjs`:\n  Route: implementation.\n  Verification: run `node --check scripts/stale-r3.mjs`.\n' > "$todo_stale_r3"
mkdir -p "$state_stale_r3/todo-claims" "$state_stale_r3/runs"
python3 - "$state_stale_r3" "$todo_stale_r3" <<'PY'
import json
import pathlib
import sys

state = pathlib.Path(sys.argv[1])
selected = pathlib.Path(sys.argv[2]).read_text(encoding="utf-8").rstrip("\n")
def write(path, value):
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
write(state / "todo-claims/current.json", {
    "schema_version": 1,
    "claim_id": "todo-g541-stale-r3",
    "status": "in_progress",
    "selected_todo": selected,
    "queue_generation": 541,
    "queue_fingerprint": "old-queue",
    "run_stamp": "20261019T071825Z",
    "retry_cap": 0,
})
write(state / "status.json", {"status": "no_progress", "run_id": "old-run", "supervisor_pid": 86793})
write(state / "progress-state.json", {
    "classification": "terminal_failure",
    "run_stamp": "20261019T071825Z",
    "progress_projection": {
        "claim_id": "todo-g541-stale-r3",
        "selected_todo": selected,
        "stop_class": "terminal_failure",
        "stop_reason": "terminal_task_failed",
        "cli_status": "no_eligible_task",
    },
})
write(state / "todo-claims/todo-queue-state.json", {"generation": 541, "fingerprint": "new-queue"})
PY
set +e
PHASE_LOOP_STATE_DIR="$state_stale_r3" \
PHASE_LOOP_PROMPT="$prompt_stale_r3" \
PHASE_LOOP_TODO="$todo_stale_r3" \
BROWNIE_BIN="$fake_brownie_terminal_no_eligible" \
PHASE_LOOP_WORKSPACE_ROOT="$stale_r3_workspace" \
PHASE_LOOP_TERMINAL_FAILURE_RETRY_CAP=0 \
PHASE_LOOP_TEST_HEADLESS_ONLY=1 \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 76 "$PHASE_LOOP" run-once >/dev/null
stale_r3_exit="$?"
set -e
test "$stale_r3_exit" = "76"
python3 - "$state_stale_r3" <<'PY'
import json
import pathlib
import sys

state = pathlib.Path(sys.argv[1])
claim_dir = state / "todo-claims"
claim = json.loads((claim_dir / "current.json").read_text(encoding="utf-8"))
archives = sorted(claim_dir.glob("stale-rebaseline-*.json"))
assert len(archives) == 1, archives
archived = json.loads(archives[0].read_text(encoding="utf-8"))
assert archived["claim_id"] == "todo-g541-stale-r3", archived
assert archived["retry_eligible"] is True, archived
assert archived["recovery_state"] == "redelegatable", archived
assert claim["claim_id"] != "todo-g541-stale-r3", claim
assert claim["status"] == "in_progress", claim
# The fresh claim must not inherit the stale attempt's retry policy.  The
# controller-level cap is intentionally not copied into the claim record.
assert claim.get("retry_cap") != 0, claim
feedback = json.loads((claim_dir / "repair-feedback.json").read_text(encoding="utf-8"))
assert feedback.get("kind") == "phase_loop_terminal_failure_redelegation_required", feedback
assert feedback["recovery_state"] == "redelegatable", feedback
PY

# A positive terminal-failure retry cap permits the configured number of
# additional executions, then suppresses the same TODO on the next claim.
state_terminal_retry_cap="$(mktemp -d)"
prompt_terminal_retry_cap="$(mktemp)"
todo_terminal_retry_cap="$(mktemp)"
terminal_retry_cap_workspace="$(mktemp -d)"
git -C "$terminal_retry_cap_workspace" init -b main >/dev/null
mkdir -p "$terminal_retry_cap_workspace/.brownie/headless-continuations"
printf '%s\n' '{"headless":"controller-output-only"}' > "$terminal_retry_cap_workspace/.brownie/headless-continuations/fresh-run.json"
git -C "$terminal_retry_cap_workspace" add .brownie/headless-continuations/fresh-run.json
git -C "$terminal_retry_cap_workspace" -c user.name=Brownie -c user.email=brownie@example.invalid commit -m init >/dev/null
printf 'base prompt\n' > "$prompt_terminal_retry_cap"
printf -- '- [ ] E-retry-cap: Patch only `scripts/retry-cap.mjs`:\n  Route: implementation.\n  Verification: run `node --check scripts/retry-cap.mjs`.\n' > "$todo_terminal_retry_cap"
for retry_run in 1 2; do
  set +e
  PHASE_LOOP_STATE_DIR="$state_terminal_retry_cap" \
  PHASE_LOOP_PROMPT="$prompt_terminal_retry_cap" \
  PHASE_LOOP_TODO="$todo_terminal_retry_cap" \
  BROWNIE_BIN="$fake_brownie_terminal_task_executed" \
  PHASE_LOOP_WORKSPACE_ROOT="$terminal_retry_cap_workspace" \
  PHASE_LOOP_TEST_HEADLESS_ONLY=1 \
  PHASE_LOOP_TERMINAL_FAILURE_RETRY_CAP=1 \
  run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 76 "$PHASE_LOOP" run-once >/dev/null
  retry_exit="$?"
  set -e
  test "$retry_exit" = "76"
done
python3 - "$terminal_retry_cap_workspace/.brownie/private/phase-loop/task-ledger.jsonl" <<'PY'
import json
import pathlib
import sys

transactions = []
for line in pathlib.Path(sys.argv[1]).read_text(encoding='utf-8').splitlines():
    if not line.strip():
        continue
    record = json.loads(line)
    if record.get('kind') == 'terminal_failure_transaction':
        transactions.append(record)
same_todo = [
    record for record in transactions
    if any('E-retry-cap:' in str(event.get('selected_todo', '')) for event in record.get('events', []))
]
assert len(same_todo) == 2, same_todo
assert all(event.get('retry_cap') == 1 for record in same_todo for event in record.get('events', [])), same_todo
claim_ids = [
    next(event['claim_id'] for event in record.get('events', []) if 'E-retry-cap:' in str(event.get('selected_todo', '')))
    for record in same_todo
]
assert len(set(claim_ids)) == 2, claim_ids
assert claim_ids[0] != claim_ids[1], claim_ids
PY
set +e
PHASE_LOOP_STATE_DIR="$state_terminal_retry_cap" \
PHASE_LOOP_PROMPT="$prompt_terminal_retry_cap" \
PHASE_LOOP_TODO="$todo_terminal_retry_cap" \
BROWNIE_BIN="$fake_brownie_terminal_task_executed" \
PHASE_LOOP_WORKSPACE_ROOT="$terminal_retry_cap_workspace" \
PHASE_LOOP_TEST_HEADLESS_ONLY=1 \
PHASE_LOOP_TERMINAL_FAILURE_RETRY_CAP=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 65,75,76 "$PHASE_LOOP" run-once >/dev/null
retry_cap_exhausted_exit="$?"
set -e
case "$retry_cap_exhausted_exit" in
  65|75|76) ;;
  *) echo "unexpected retry-cap exhaustion exit=$retry_cap_exhausted_exit" >&2; exit 1 ;;
esac
assert_terminal_failure_claim_archived \
  "$state_terminal_retry_cap/todo-claims" \
  "$state_terminal_retry_cap/todo-claims/blocked.jsonl" \
  "$terminal_retry_cap_workspace/.brownie/private/phase-loop/task-ledger.jsonl" \
  'E-retry-cap:' 2 1
python3 - "$terminal_retry_cap_workspace/.brownie/private/phase-loop/task-ledger.jsonl" "$state_terminal_retry_cap/status.json" "$state_terminal_retry_cap/progress-state.json" <<'PY'
import json
import pathlib
import sys

transactions = [
    json.loads(line) for line in pathlib.Path(sys.argv[1]).read_text(encoding='utf-8').splitlines()
    if line.strip() and json.loads(line).get('kind') == 'terminal_failure_transaction'
]
same_todo = [
    record for record in transactions
    if any('E-retry-cap:' in str(event.get('selected_todo', '')) for event in record.get('events', []))
]
assert len(same_todo) == 2, same_todo
status = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding='utf-8'))
progress = json.loads(pathlib.Path(sys.argv[3]).read_text(encoding='utf-8'))
assert status['status'] == 'blocked', status
assert progress['progress_projection']['cli_status'] == 'task_executed', progress
assert progress['progress_projection']['closure'] == 'no_eligible_task', progress
if status['exit_code'] == '0':
    # Once the retry cap is exhausted, queue suppression may project the
    # already-archived TODO as an empty eligible queue. The assertion above
    # still proves the two terminal attempts were durable and bounded.
    pass
elif status['exit_code'] == '75':
    assert 'Failed to claim first pending TODO' in status['detail'], status
elif status['exit_code'] == '65':
    assert 'explicit owner-controlled blocker TODO' in status['detail'], status
else:
    assert status['exit_code'] == '76', status
    assert 'terminal_task_failed' in status['detail'], status
    assert progress['classification'] == 'terminal_failure', progress
PY

# A retry-cap allowance must permit the next execution to complete with a
# fresh claim/attempt rather than colliding with the failed terminal attempt.
state_terminal_retry_success="$(mktemp -d)"
prompt_terminal_retry_success="$(mktemp)"
todo_terminal_retry_success="$(mktemp)"
todo_breakdown_terminal_retry_success="$(mktemp)"
terminal_retry_success_workspace="$(mktemp -d)"
git -C "$terminal_retry_success_workspace" init -b main >/dev/null
git -C "$terminal_retry_success_workspace" config user.name Brownie
git -C "$terminal_retry_success_workspace" config user.email brownie@example.invalid
mkdir -p "$terminal_retry_success_workspace/scripts"
printf 'export const retrySuccess = true;\n' > "$terminal_retry_success_workspace/scripts/retry-success.mjs"
git -C "$terminal_retry_success_workspace" add .
git -C "$terminal_retry_success_workspace" commit -m init >/dev/null
printf 'base prompt\n' > "$prompt_terminal_retry_success"
printf -- '- [ ] E-retry-success: Patch only `scripts/retry-success.mjs`:\n  Route: implementation.\n  Verification: run `node --check scripts/retry-success.mjs`.\n' > "$todo_terminal_retry_success"
printf '# Breakdown\n' > "$todo_breakdown_terminal_retry_success"
set +e
PHASE_LOOP_STATE_DIR="$state_terminal_retry_success" \
PHASE_LOOP_PROMPT="$prompt_terminal_retry_success" \
PHASE_LOOP_TODO="$todo_terminal_retry_success" \
PHASE_LOOP_TODO_BREAKDOWN="$todo_breakdown_terminal_retry_success" \
BROWNIE_BIN="$fake_brownie_terminal_retry_then_success" \
PHASE_LOOP_WORKSPACE_ROOT="$terminal_retry_success_workspace" \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
PHASE_LOOP_TEST_REMOVE_CLAIM=1 \
PHASE_LOOP_TERMINAL_FAILURE_RETRY_CAP=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 76 "$PHASE_LOOP" run-once >/dev/null
retry_success_first_exit="$?"
set -e
test "$retry_success_first_exit" = "76"
test ! -f "$state_terminal_retry_success/todo-claims/current.json"
if [ ! -f "$state_terminal_retry_success/terminal-retry-then-success.attempt" ]; then
  echo "retry-success fixture did not reach its first Runtime invocation" >&2
  if [ -f "$state_terminal_retry_success/status.json" ]; then
    cat "$state_terminal_retry_success/status.json" >&2
  fi
  if [ -f "$state_terminal_retry_success/logs/supervisor.log" ]; then
    tail -n 120 "$state_terminal_retry_success/logs/supervisor.log" >&2
  fi
  latest_retry_success_stdout="$(find "$state_terminal_retry_success/runs" -name '*.stdout.log' -type f -print 2>/dev/null | LC_ALL=C sort | tail -n 1)"
  latest_retry_success_stderr="$(find "$state_terminal_retry_success/runs" -name '*.stderr.log' -type f -print 2>/dev/null | LC_ALL=C sort | tail -n 1)"
  for retry_success_diagnostic in "$latest_retry_success_stdout" "$latest_retry_success_stderr"; do
    if [ -n "$retry_success_diagnostic" ] && [ -f "$retry_success_diagnostic" ]; then
      echo "--- $retry_success_diagnostic ---" >&2
      tail -n 80 "$retry_success_diagnostic" >&2
    fi
  done
  exit 1
fi
test "$(cat "$state_terminal_retry_success/terminal-retry-then-success.attempt")" = "1"
set +e
PHASE_LOOP_STATE_DIR="$state_terminal_retry_success" \
PHASE_LOOP_PROMPT="$prompt_terminal_retry_success" \
PHASE_LOOP_TODO="$todo_terminal_retry_success" \
PHASE_LOOP_TODO_BREAKDOWN="$todo_breakdown_terminal_retry_success" \
BROWNIE_BIN="$fake_brownie_terminal_retry_then_success" \
PHASE_LOOP_WORKSPACE_ROOT="$terminal_retry_success_workspace" \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
PHASE_LOOP_TEST_REMOVE_CLAIM=1 \
PHASE_LOOP_TERMINAL_FAILURE_RETRY_CAP=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null
retry_success_second_exit="$?"
set -e
test "$retry_success_second_exit" = "0"
python3 - "$terminal_retry_success_workspace/.brownie/private/phase-loop/task-ledger.jsonl" "$state_terminal_retry_success/todo-claims" "$todo_terminal_retry_success" <<'PY'
import json
import pathlib
import sys

ledger = []
terminal_failure_events = []
for line in pathlib.Path(sys.argv[1]).read_text(encoding='utf-8').splitlines():
    if not line.strip():
        continue
    record = json.loads(line)
    if record.get('kind') == 'terminal_failure_transaction':
        terminal_failure_events.extend(record.get('events', []))
    else:
        ledger.append(record)
claim_dir = pathlib.Path(sys.argv[2])
archives = sorted(claim_dir.glob('stale-*.json'))
assert len(archives) == 1, archives
archived_claim = json.loads(archives[0].read_text(encoding='utf-8'))
assert archived_claim['status'] == 'failed', archived_claim
assert archived_claim['archive_reason'] == 'terminal_failure_retry', archived_claim
assert archived_claim['retry_eligible'] is True, archived_claim
assert archived_claim['terminal_recovery_id'], archived_claim
assert archived_claim['selected_todo'].startswith('- [ ] E-retry-success:'), archived_claim
attempts = [event for event in ledger if str(event.get('task_id', '')).startswith('E-retry-success@')]
completed = [event for event in attempts if event.get('to_state') == 'completed']
failed_claim_ids = {event.get('claim_id') for event in terminal_failure_events}
assert terminal_failure_events, terminal_failure_events
assert completed, attempts
assert completed[-1]['claim_id'] not in failed_claim_ids, (completed, terminal_failure_events)
assert len({event.get('claim_id') for event in attempts if event.get('claim_id')}) >= 2, attempts
assert '- [ ] E-retry-success:' not in pathlib.Path(sys.argv[3]).read_text(encoding='utf-8'), pathlib.Path(sys.argv[3]).read_text(encoding='utf-8')
PY

# A retryable terminal failure for a generated leaf must bypass the legacy
# stable-ID/controller short circuit and invoke Runtime while cap remains.
state_terminal_retry_leaf="$(mktemp -d)"
prompt_terminal_retry_leaf="$(mktemp)"
todo_terminal_retry_leaf="$(mktemp)"
terminal_retry_leaf_workspace="$(mktemp -d)"
git -C "$terminal_retry_leaf_workspace" init -b main >/dev/null
git -C "$terminal_retry_leaf_workspace" config user.name Brownie
git -C "$terminal_retry_leaf_workspace" config user.email brownie@example.invalid
mkdir -p "$terminal_retry_leaf_workspace/scripts"
printf 'export const retryLeaf = true;\n' > "$terminal_retry_leaf_workspace/scripts/retry-leaf.mjs"
git -C "$terminal_retry_leaf_workspace" add .
git -C "$terminal_retry_leaf_workspace" commit -m init >/dev/null
printf 'base prompt\n' > "$prompt_terminal_retry_leaf"
printf -- '- [ ] E-retry-leaf: Patch only `scripts/retry-leaf.mjs`:\n  Route: implementation.\n  Source TODO: E-source-parent.\n  Depends on: <none>.\n  Verification: run `node --check scripts/retry-leaf.mjs`.\n' > "$todo_terminal_retry_leaf"
set +e
PHASE_LOOP_STATE_DIR="$state_terminal_retry_leaf" \
PHASE_LOOP_PROMPT="$prompt_terminal_retry_leaf" \
PHASE_LOOP_TODO="$todo_terminal_retry_leaf" \
BROWNIE_BIN="$fake_brownie_terminal_retry_then_success" \
PHASE_LOOP_WORKSPACE_ROOT="$terminal_retry_leaf_workspace" \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
PHASE_LOOP_TERMINAL_FAILURE_RETRY_CAP=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 76 "$PHASE_LOOP" run-once >/dev/null
retry_leaf_first_exit="$?"
set -e
test "$retry_leaf_first_exit" = "76"
set +e
PHASE_LOOP_STATE_DIR="$state_terminal_retry_leaf" \
PHASE_LOOP_PROMPT="$prompt_terminal_retry_leaf" \
PHASE_LOOP_TODO="$todo_terminal_retry_leaf" \
BROWNIE_BIN="$fake_brownie_terminal_retry_then_success" \
PHASE_LOOP_WORKSPACE_ROOT="$terminal_retry_leaf_workspace" \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
PHASE_LOOP_TERMINAL_FAILURE_RETRY_CAP=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null
retry_leaf_second_exit="$?"
set -e
test "$retry_leaf_second_exit" = "0"
test "$(cat "$state_terminal_retry_leaf/terminal-retry-then-success.attempt")" = "2"
assert_not_contains "$todo_terminal_retry_leaf" '- \[ \] E-retry-leaf:'

# Invalid retry caps must fail before claim, ledger, archive, or blocked-state
# writes, and must never invoke the runtime.
invalid_cap_state="$(mktemp -d)"
invalid_cap_workspace="$(mktemp -d)"
invalid_cap_prompt="$(mktemp)"
invalid_cap_todo="$(mktemp)"
git -C "$invalid_cap_workspace" init -b main >/dev/null
git -C "$invalid_cap_workspace" -c user.name=Brownie -c user.email=brownie@example.invalid commit --allow-empty -m init >/dev/null
printf 'base prompt\n' > "$invalid_cap_prompt"
printf -- '- [ ] E-invalid-cap: Patch only `scripts/invalid-cap.mjs`:\n  Route: implementation.\n  Verification: run `node --check scripts/invalid-cap.mjs`.\n' > "$invalid_cap_todo"
invalid_cap_diagnostic="$invalid_cap_state/invalid-cap.stderr"
set +e
PHASE_LOOP_STATE_DIR="$invalid_cap_state" \
PHASE_LOOP_PROMPT="$invalid_cap_prompt" \
PHASE_LOOP_TODO="$invalid_cap_todo" \
BROWNIE_BIN="$fake_brownie_must_not_run" \
PHASE_LOOP_WORKSPACE_ROOT="$invalid_cap_workspace" \
PHASE_LOOP_TERMINAL_FAILURE_RETRY_CAP='not-an-integer' \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 78 "$PHASE_LOOP" run-once >/dev/null 2>"$invalid_cap_diagnostic"
invalid_cap_exit="$?"
set -e
test "$invalid_cap_exit" = "78"
assert_contains "$invalid_cap_diagnostic" 'Invalid PHASE_LOOP_TERMINAL_FAILURE_RETRY_CAP=not-an-integer'
test ! -f "$invalid_cap_state/status.json"
test ! -f "$invalid_cap_state/todo-claims/current.json"
test ! -e "$invalid_cap_state/todo-claims/blocked.jsonl"
test ! -e "$invalid_cap_workspace/.brownie/private/phase-loop/task-ledger.jsonl"

# A terminal recovery ledger write failure must not append blocked evidence or
# leave a retry-eligible claim behind.
ledger_terminal_failure_state="$(mktemp -d)"
ledger_terminal_failure_workspace="$(mktemp -d)"
ledger_terminal_failure_prompt="$(mktemp)"
ledger_terminal_failure_todo="$(mktemp)"
git -C "$ledger_terminal_failure_workspace" init -b main >/dev/null
git -C "$ledger_terminal_failure_workspace" -c user.name=Brownie -c user.email=brownie@example.invalid commit --allow-empty -m init >/dev/null
printf 'base prompt\n' > "$ledger_terminal_failure_prompt"
printf -- '- [ ] E-ledger-terminal-failure: Patch only `scripts/ledger-terminal-failure.mjs`:\n  Route: implementation.\n  Verification: run `node --check scripts/ledger-terminal-failure.mjs`.\n\n- [ ] E-ledger-terminal-blocker: Blocker: external recovery evidence is unavailable.\n  Route: documentation.\n  Completion condition: the owner supplies the recovery evidence.\n  Verification: blocker: exact missing evidence is named before any workspace patch.\n' > "$ledger_terminal_failure_todo"
set +e
PHASE_LOOP_STATE_DIR="$ledger_terminal_failure_state" \
PHASE_LOOP_PROMPT="$ledger_terminal_failure_prompt" \
PHASE_LOOP_TODO="$ledger_terminal_failure_todo" \
BROWNIE_BIN="$fake_brownie_terminal_no_eligible" \
PHASE_LOOP_WORKSPACE_ROOT="$ledger_terminal_failure_workspace" \
PHASE_LOOP_TERMINAL_FAILURE_RETRY_CAP=1 \
PHASE_LOOP_TEST_FAIL_TERMINAL_LEDGER=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 78 "$PHASE_LOOP" run-once >/dev/null
ledger_terminal_failure_exit="$?"
set -e
test "$ledger_terminal_failure_exit" = "78"
python3 - "$ledger_terminal_failure_state/status.json" "$ledger_terminal_failure_state/todo-claims" "$ledger_terminal_failure_workspace/.brownie/private/phase-loop/task-ledger.jsonl" <<'PY'
import json
import pathlib
import sys

status = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
claim_dir = pathlib.Path(sys.argv[2])
ledger_path = pathlib.Path(sys.argv[3])
archives = sorted(claim_dir.glob('stale-*.json'))
assert not archives, archives
claim = json.loads((claim_dir / 'current.json').read_text(encoding='utf-8'))
assert claim['status'] == 'in_progress', claim
assert claim['terminal_failure_recovery_pending'] is True, claim
blocked_path = claim_dir / 'blocked.jsonl'
assert not blocked_path.exists() or (blocked_path.is_file() and not blocked_path.read_text(encoding='utf-8').strip()), blocked_path
ledger = ledger_path.read_text(encoding='utf-8')
assert 'terminal_failure_transaction' not in ledger, ledger
ledger_records = [json.loads(line) for line in ledger.splitlines() if line.strip()]
claim_id = claim['claim_id']
source_task = 'E-ledger-terminal-failure@' + claim_id
assert not any(event.get('task_id') == source_task and event.get('to_state') == 'failed' for event in ledger_records), ledger_records
assert status['status'] == 'blocked', status
assert status['exit_code'] == '78', status
assert 'could not be fully recorded' in status['detail'], status
assert 'refusing to retry' in status['detail'], status
PY
set +e
PHASE_LOOP_STATE_DIR="$ledger_terminal_failure_state" \
PHASE_LOOP_PROMPT="$ledger_terminal_failure_prompt" \
PHASE_LOOP_TODO="$ledger_terminal_failure_todo" \
BROWNIE_BIN="$fake_brownie_terminal_no_eligible_counted" \
PHASE_LOOP_WORKSPACE_ROOT="$ledger_terminal_failure_workspace" \
PHASE_LOOP_TERMINAL_FAILURE_RETRY_CAP=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 76 "$PHASE_LOOP" run-once >/dev/null
ledger_terminal_failure_retry_exit="$?"
set -e
test "$ledger_terminal_failure_retry_exit" = "76"
test "$(cat "$ledger_terminal_failure_state/terminal-no-eligible-count" 2>/dev/null || printf '0')" = "0"
python3 - "$ledger_terminal_failure_state/status.json" "$ledger_terminal_failure_state/todo-claims/current.json" "$ledger_terminal_failure_state/todo-claims/blocked.jsonl" "$ledger_terminal_failure_workspace/.brownie/private/phase-loop/task-ledger.jsonl" <<'PY'
import json
import pathlib
import sys

status = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
claim = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding='utf-8'))
blocked = [json.loads(line) for line in pathlib.Path(sys.argv[3]).read_text(encoding='utf-8').splitlines() if line.strip()]
ledger = [json.loads(line) for line in pathlib.Path(sys.argv[4]).read_text(encoding='utf-8').splitlines() if line.strip()]
assert status['exit_code'] == '76', status
assert claim['status'] == 'failed', claim
assert claim['terminal_failure_recovery_pending'] is False, claim
assert blocked and blocked[-1]['terminal_failure'] is True, blocked
source_task = 'E-ledger-terminal-failure@' + claim['claim_id']
assert any(event.get('task_id') == source_task and event.get('to_state') == 'failed' and event.get('from_state') in ('claimed', 'running') for event in ledger), ledger
PY

# A successful terminal ledger transaction is not complete until blocked.jsonl
# also accepts the evidence. A directory at that path must fail closed and
# retire the claim as non-retryable.
blocked_append_failure_state="$(mktemp -d)"
blocked_append_failure_workspace="$(mktemp -d)"
blocked_append_failure_prompt="$(mktemp)"
blocked_append_failure_todo="$(mktemp)"
git -C "$blocked_append_failure_workspace" init -b main >/dev/null
git -C "$blocked_append_failure_workspace" -c user.name=Brownie -c user.email=brownie@example.invalid commit --allow-empty -m init >/dev/null
mkdir -p "$blocked_append_failure_state/todo-claims/blocked.jsonl"
printf 'base prompt\n' > "$blocked_append_failure_prompt"
printf -- '- [ ] E-blocked-append-failure: Patch only `scripts/blocked-append-failure.mjs`:\n  Route: implementation.\n  Verification: run `node --check scripts/blocked-append-failure.mjs`.\n\n- [ ] E-blocked-append-blocker: Blocker: external recovery evidence is unavailable.\n  Route: documentation.\n  Completion condition: the owner supplies the recovery evidence.\n  Verification: blocker: exact missing evidence is named before any workspace patch.\n' > "$blocked_append_failure_todo"
set +e
PHASE_LOOP_STATE_DIR="$blocked_append_failure_state" \
PHASE_LOOP_PROMPT="$blocked_append_failure_prompt" \
PHASE_LOOP_TODO="$blocked_append_failure_todo" \
BROWNIE_BIN="$fake_brownie_terminal_no_eligible" \
PHASE_LOOP_WORKSPACE_ROOT="$blocked_append_failure_workspace" \
PHASE_LOOP_TERMINAL_FAILURE_RETRY_CAP=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 78 "$PHASE_LOOP" run-once >/dev/null
blocked_append_failure_exit="$?"
set -e
test "$blocked_append_failure_exit" = "78"
python3 - "$blocked_append_failure_state/status.json" "$blocked_append_failure_state/todo-claims" "$blocked_append_failure_workspace/.brownie/private/phase-loop/task-ledger.jsonl" <<'PY'
import json
import pathlib
import sys

status = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
claim_dir = pathlib.Path(sys.argv[2])
ledger = pathlib.Path(sys.argv[3]).read_text(encoding='utf-8')
archives = sorted(claim_dir.glob('stale-*.json'))
assert len(archives) == 1, archives
archive = json.loads(archives[0].read_text(encoding='utf-8'))
assert archive['archive_reason'] == 'terminal_failure_blocked_evidence_failed', archive
assert archive['retry_eligible'] is False, archive
assert not (claim_dir / 'current.json').exists()
assert (claim_dir / 'blocked.jsonl').is_dir()
assert 'terminal_failure_transaction' in ledger, ledger
claim_id = archive['claim_id']
ledger_records = [
    json.loads(line)
    for line in ledger.splitlines()
    if line.strip()
]
assert any(
    event.get('claim_id') == claim_id
    and event.get('to_state') == 'failed'
    and event.get('from_state') in ('claimed', 'running')
    and str(event.get('task_id', '')).endswith('@' + claim_id)
    for record in ledger_records
    for event in (record.get('events', []) if record.get('kind') == 'terminal_failure_transaction' else [record])
), ledger_records
assert status['status'] == 'blocked', status
assert status['exit_code'] == '78', status
assert 'blocked evidence append failed' in status['detail'], status
assert 'refusing to retry' in status['detail'], status
PY
set +e
PHASE_LOOP_STATE_DIR="$blocked_append_failure_state" \
PHASE_LOOP_PROMPT="$blocked_append_failure_prompt" \
PHASE_LOOP_TODO="$blocked_append_failure_todo" \
BROWNIE_BIN="$fake_brownie_terminal_no_eligible_counted" \
PHASE_LOOP_WORKSPACE_ROOT="$blocked_append_failure_workspace" \
PHASE_LOOP_TERMINAL_FAILURE_RETRY_CAP=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 65,75 "$PHASE_LOOP" run-once >/dev/null
blocked_append_failure_retry_exit="$?"
set -e
case "$blocked_append_failure_retry_exit" in
  65|75) ;;
  *) echo "unexpected blocked-append retry exit=$blocked_append_failure_retry_exit" >&2; exit 1 ;;
esac
test "$(cat "$blocked_append_failure_state/terminal-no-eligible-count" 2>/dev/null || printf '0')" = "0"
fi

if claim_smoke_section_enabled completion; then
# Completion must record the terminal ledger transition before mutating the
# live TODO queue. An unwritable ledger keeps both queue and claim retryable.
completion_ledger_failure_state="$(mktemp -d)"
completion_ledger_failure_workspace="$(mktemp -d)"
completion_ledger_failure_prompt="$(mktemp)"
completion_ledger_failure_todo="$(mktemp)"
git -C "$completion_ledger_failure_workspace" init -b main >/dev/null
git -C "$completion_ledger_failure_workspace" -c user.name=Brownie -c user.email=brownie@example.invalid commit --allow-empty -m init >/dev/null
mkdir -p "$completion_ledger_failure_workspace/.brownie/private/phase-loop/task-ledger.jsonl"
printf 'base prompt\n' > "$completion_ledger_failure_prompt"
printf -- '- [ ] E-completion-ledger-failure: Patch only `scripts/completion-ledger-failure.mjs`:\n  Route: implementation.\n  Verification: run `node --check scripts/completion-ledger-failure.mjs`.\n' > "$completion_ledger_failure_todo"
set +e
PHASE_LOOP_STATE_DIR="$completion_ledger_failure_state" \
PHASE_LOOP_PROMPT="$completion_ledger_failure_prompt" \
PHASE_LOOP_TODO="$completion_ledger_failure_todo" \
BROWNIE_BIN="$fake_brownie_completed" \
PHASE_LOOP_WORKSPACE_ROOT="$completion_ledger_failure_workspace" \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 78 "$PHASE_LOOP" run-once >/dev/null
completion_ledger_failure_exit="$?"
set -e
test "$completion_ledger_failure_exit" = "78"
python3 - "$completion_ledger_failure_state/status.json" "$completion_ledger_failure_state/todo-claims/current.json" "$completion_ledger_failure_todo" "$completion_ledger_failure_workspace/.brownie/private/phase-loop/task-ledger.jsonl" <<'PY'
import json
import pathlib
import sys

status = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
claim = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding='utf-8'))
todo = pathlib.Path(sys.argv[3]).read_text(encoding='utf-8')
ledger_path = pathlib.Path(sys.argv[4])
assert status['status'] == 'blocked', status
assert status['exit_code'] == '78', status
assert 'terminal ledger transition failed' in status['detail'], status
assert claim['status'] == 'in_progress', claim
assert '- [ ] E-completion-ledger-failure:' in todo, todo
assert ledger_path.is_dir(), ledger_path
PY

# A completion ledger record does not authorize reverting the claim to
# in_progress when queue cleanup fails. Preserve the completed claim and make
# cleanup the only retryable operation on the next controller invocation.
completion_removal_failure_state="$(mktemp -d)"
completion_removal_failure_workspace="$(mktemp -d)"
completion_removal_failure_prompt="$(mktemp)"
completion_removal_failure_todo="$(mktemp)"
git -C "$completion_removal_failure_workspace" init -b main >/dev/null
git -C "$completion_removal_failure_workspace" -c user.name=Brownie -c user.email=brownie@example.invalid commit --allow-empty -m init >/dev/null
printf 'base prompt\n' > "$completion_removal_failure_prompt"
printf -- '- [ ] E-completion-removal-failure: Patch only `scripts/completion-removal-failure.mjs`:\n  Route: implementation.\n  Verification: run `node --check scripts/completion-removal-failure.mjs`.\n' > "$completion_removal_failure_todo"
completion_removal_failure_runtime_count="$completion_removal_failure_state/runtime-count"
completion_removal_failure_brownie="$(mktemp)"
cat > "$completion_removal_failure_brownie" <<SH
#!/usr/bin/env bash
set -eu
printf 'runtime-invoked\n' >> "$completion_removal_failure_runtime_count"
exit 99
SH
chmod +x "$completion_removal_failure_brownie"
set +e
PHASE_LOOP_STATE_DIR="$completion_removal_failure_state" \
PHASE_LOOP_PROMPT="$completion_removal_failure_prompt" \
PHASE_LOOP_TODO="$completion_removal_failure_todo" \
BROWNIE_BIN="$fake_brownie_completed" \
PHASE_LOOP_WORKSPACE_ROOT="$completion_removal_failure_workspace" \
PHASE_LOOP_TEST_MUTATE_TARGET=1 \
PHASE_LOOP_TEST_FAIL_COMPLETED_TODO_REMOVAL=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 78 "$PHASE_LOOP" run-once >/dev/null
completion_removal_failure_exit="$?"
set -e
test "$completion_removal_failure_exit" = "78"
python3 - "$completion_removal_failure_state/status.json" "$completion_removal_failure_state/todo-claims/current.json" "$completion_removal_failure_todo" <<'PY'
import json
import pathlib
import sys

status = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
claim = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding='utf-8'))
todo = pathlib.Path(sys.argv[3]).read_text(encoding='utf-8')
assert status['status'] == 'blocked', status
assert status['exit_code'] == '78', status
assert claim['status'] == 'completed', claim
assert claim['completion_cleanup_pending'] is True, claim
assert '- [ ] E-completion-removal-failure:' in todo, todo
PY

set +e
PHASE_LOOP_STATE_DIR="$completion_removal_failure_state" \
PHASE_LOOP_PROMPT="$completion_removal_failure_prompt" \
PHASE_LOOP_TODO="$completion_removal_failure_todo" \
BROWNIE_BIN="$completion_removal_failure_brownie" \
PHASE_LOOP_WORKSPACE_ROOT="$completion_removal_failure_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 75 "$PHASE_LOOP" run-once >/dev/null
completion_removal_cleanup_exit="$?"
set -e
test "$completion_removal_cleanup_exit" = "75"
python3 - "$completion_removal_failure_state/status.json" "$completion_removal_failure_state/todo-claims/current.json" "$completion_removal_failure_todo" <<'PY'
import json
import pathlib
import sys

status = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
claim = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding='utf-8'))
todo = pathlib.Path(sys.argv[3]).read_text(encoding='utf-8')
assert status['status'] == 'stopped', status
assert claim['status'] == 'completed', claim
assert claim['completion_cleanup_pending'] is False, claim
assert '- [ ] E-completion-removal-failure:' not in todo, todo
PY

# If completion cleanup is deferred after Runtime changed tracked workspace
# files, retain a durable PR-publication obligation. A cleanup-only retry must
# publish that already-created completion exactly once and must not invoke
# Runtime again.
completion_pr_cleanup_retry_state="$(mktemp -d)"
completion_pr_cleanup_retry_prompt="$(mktemp)"
completion_pr_cleanup_retry_todo="$(mktemp)"
completion_pr_cleanup_retry_workspace="$(mktemp -d)"
completion_pr_cleanup_retry_remote="$(mktemp -d)"
completion_pr_cleanup_retry_bin="$(mktemp -d)"
completion_pr_cleanup_retry_count="$completion_pr_cleanup_retry_state/pr-create-count"
completion_pr_cleanup_retry_runtime_count="$completion_pr_cleanup_retry_state/runtime-count"
git -C "$completion_pr_cleanup_retry_workspace" init -b main >/dev/null
mkdir -p "$completion_pr_cleanup_retry_workspace/scripts"
cp "$REPO_ROOT/scripts/phase-loop-pr-actor-guard.mjs" "$completion_pr_cleanup_retry_workspace/scripts/phase-loop-pr-actor-guard.mjs"
printf 'base\n' > "$completion_pr_cleanup_retry_workspace/README.md"
git -C "$completion_pr_cleanup_retry_workspace" add .
git -C "$completion_pr_cleanup_retry_workspace" -c user.name=Brownie -c user.email=brownie@example.invalid commit -m init >/dev/null
git -C "$completion_pr_cleanup_retry_remote" init --bare >/dev/null
git -C "$completion_pr_cleanup_retry_workspace" remote add origin "$completion_pr_cleanup_retry_remote"
git -C "$completion_pr_cleanup_retry_workspace" push -u origin main >/dev/null
git -C "$completion_pr_cleanup_retry_workspace" switch -c "${PHASE_LOOP_TEST_IMPLEMENTATION_BRANCH_PREFIX}smoke-completion-cleanup-pr" >/dev/null
phase_loop_prepare_pr_fixture_workspace "$completion_pr_cleanup_retry_workspace" "$completion_pr_cleanup_retry_remote"
printf 'base prompt\n' > "$completion_pr_cleanup_retry_prompt"
printf -- '- [ ] E-completion-cleanup-pr: Patch only `README.md`:\n  Route: implementation.\n  Verification: run `node --check scripts/phase-loop-pr-actor-guard.mjs`.\n' > "$completion_pr_cleanup_retry_todo"
cat > "$completion_pr_cleanup_retry_bin/pnpm" <<'SH'
#!/usr/bin/env bash
exit 0
SH
chmod +x "$completion_pr_cleanup_retry_bin/pnpm"
cat > "$completion_pr_cleanup_retry_bin/gh" <<'SH'
#!/usr/bin/env bash
set -eu
case "${1:-} ${2:-}" in
  "api user")
    printf '%s\n' "${PHASE_LOOP_TEST_IMPLEMENTATION_ACTOR:?}"
    ;;
  "auth token")
    printf 'fake-token\n'
    ;;
  "pr view")
    exit 1
    ;;
  "pr create")
    printf '1\n' >> "${FAKE_GH_PR_CREATE_COUNT:?}"
    printf 'https://github.com/%s/pull/10001\n' "${PHASE_LOOP_TEST_REPOSITORY:?}"
    ;;
  *)
    exit 0
    ;;
esac
SH
chmod +x "$completion_pr_cleanup_retry_bin/gh"
completion_pr_cleanup_retry_brownie="$(mktemp)"
cat > "$completion_pr_cleanup_retry_brownie" <<SH
#!/usr/bin/env bash
set -eu
printf 'runtime-invoked\n' >> "$completion_pr_cleanup_retry_runtime_count"
exit 99
SH
chmod +x "$completion_pr_cleanup_retry_brownie"
set +e
PATH="$completion_pr_cleanup_retry_bin:$PATH" \
FAKE_GH_PR_CREATE_COUNT="$completion_pr_cleanup_retry_count" \
PHASE_LOOP_STATE_DIR="$completion_pr_cleanup_retry_state" \
PHASE_LOOP_PROMPT="$completion_pr_cleanup_retry_prompt" \
PHASE_LOOP_TODO="$completion_pr_cleanup_retry_todo" \
BROWNIE_BIN="$fake_brownie_completed_tracked_workspace_change" \
PHASE_LOOP_WORKSPACE_ROOT="$completion_pr_cleanup_retry_workspace" \
PHASE_LOOP_CREATE_PR_AFTER_PROGRESS=1 \
PHASE_LOOP_TEST_FAIL_COMPLETED_TODO_REMOVAL=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 78 "$PHASE_LOOP" run-once >/dev/null
completion_pr_cleanup_retry_first_exit="$?"
set -e
test "$completion_pr_cleanup_retry_first_exit" = "78"
python3 - "$completion_pr_cleanup_retry_state/todo-claims/current.json" "$completion_pr_cleanup_retry_todo" <<'PY'
import json
import os
import pathlib
import sys

claim = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
todo = pathlib.Path(sys.argv[2]).read_text(encoding='utf-8')
assert claim['status'] == 'completed', claim
assert claim['completion_cleanup_pending'] is True, claim
assert claim['completion_pr_pending'] is True, claim
assert claim['completion_pr_workspace_before'] != claim['completion_pr_workspace_after'], claim
assert '- [ ] E-completion-cleanup-pr:' in todo, todo
PY
test ! -e "$completion_pr_cleanup_retry_count"
set +e
PATH="$completion_pr_cleanup_retry_bin:$PATH" \
FAKE_GH_PR_CREATE_COUNT="$completion_pr_cleanup_retry_count" \
PHASE_LOOP_STATE_DIR="$completion_pr_cleanup_retry_state" \
PHASE_LOOP_PROMPT="$completion_pr_cleanup_retry_prompt" \
PHASE_LOOP_TODO="$completion_pr_cleanup_retry_todo" \
BROWNIE_BIN="$completion_pr_cleanup_retry_brownie" \
PHASE_LOOP_WORKSPACE_ROOT="$completion_pr_cleanup_retry_workspace" \
PHASE_LOOP_CREATE_PR_AFTER_PROGRESS=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null
completion_pr_cleanup_retry_second_exit="$?"
set -e
test "$completion_pr_cleanup_retry_second_exit" = "0"
python3 - "$completion_pr_cleanup_retry_state/status.json" "$completion_pr_cleanup_retry_state/todo-claims/current.json" "$completion_pr_cleanup_retry_todo" "$completion_pr_cleanup_retry_workspace" "$completion_pr_cleanup_retry_count" "$completion_pr_cleanup_retry_runtime_count" <<'PY'
import json
import os
import pathlib
import subprocess
import sys

status = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
claim = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding='utf-8'))
todo = pathlib.Path(sys.argv[3]).read_text(encoding='utf-8')
workspace = sys.argv[4]
pr_count = pathlib.Path(sys.argv[5])
runtime_count = pathlib.Path(sys.argv[6])
assert status['status'] == 'pr_created', status
assert 'pull/10001' in status['detail'], status
assert claim['status'] == 'completed', claim
assert claim['completion_cleanup_pending'] is False, claim
assert claim['completion_pr_pending'] is False, claim
assert any(item.get('note') == 'completion_pr_published' for item in claim['status_history']), claim
assert '- [ ] E-completion-cleanup-pr:' not in todo, todo
assert pr_count.read_text(encoding='utf-8').splitlines() == ['1'], pr_count
assert not runtime_count.exists(), runtime_count
head = subprocess.check_output(['git', '-C', workspace, 'rev-parse', 'HEAD'], text=True).strip()
remote = subprocess.check_output(['git', '-C', workspace, 'rev-parse', f"fixture-origin/{os.environ['PHASE_LOOP_TEST_IMPLEMENTATION_BRANCH_PREFIX']}smoke-completion-cleanup-pr"], text=True).strip()
assert head == remote, (head, remote)
supervisor = pathlib.Path(pathlib.Path(sys.argv[1]).parent / 'logs' / 'supervisor.log').read_text(encoding='utf-8')
assert 'completed_todo_pr_publish_retry_succeeded=true' in supervisor, supervisor
PY

# A normal completion whose PR publication fails after queue completion must
# retain a durable pending-publish marker. The next invocation publishes the
# same completion without invoking Runtime or selecting another TODO.
completion_pr_publish_failure_state="$(mktemp -d)"
completion_pr_publish_failure_prompt="$(mktemp)"
completion_pr_publish_failure_todo="$(mktemp)"
completion_pr_publish_failure_workspace="$(mktemp -d)"
completion_pr_publish_failure_remote="$(mktemp -d)"
completion_pr_publish_failure_bin="$(mktemp -d)"
completion_pr_publish_failure_count="$completion_pr_publish_failure_state/pr-create-attempts"
completion_pr_publish_failure_runtime_count="$completion_pr_publish_failure_state/runtime-count"
git -C "$completion_pr_publish_failure_workspace" init -b main >/dev/null
mkdir -p "$completion_pr_publish_failure_workspace/scripts"
cp "$REPO_ROOT/scripts/phase-loop-pr-actor-guard.mjs" "$completion_pr_publish_failure_workspace/scripts/phase-loop-pr-actor-guard.mjs"
printf 'base\n' > "$completion_pr_publish_failure_workspace/README.md"
git -C "$completion_pr_publish_failure_workspace" add .
git -C "$completion_pr_publish_failure_workspace" -c user.name=Brownie -c user.email=brownie@example.invalid commit -m init >/dev/null
git -C "$completion_pr_publish_failure_remote" init --bare >/dev/null
git -C "$completion_pr_publish_failure_workspace" remote add origin "$completion_pr_publish_failure_remote"
git -C "$completion_pr_publish_failure_workspace" push -u origin main >/dev/null
git -C "$completion_pr_publish_failure_workspace" switch -c "${PHASE_LOOP_TEST_IMPLEMENTATION_BRANCH_PREFIX}smoke-completion-pr-retry" >/dev/null
phase_loop_prepare_pr_fixture_workspace "$completion_pr_publish_failure_workspace" "$completion_pr_publish_failure_remote"
printf 'base prompt\n' > "$completion_pr_publish_failure_prompt"
printf -- '- [ ] E-completion-pr-retry: Patch only `README.md`:\n  Route: implementation.\n  Verification: run `node --check scripts/phase-loop-pr-actor-guard.mjs`.\n' > "$completion_pr_publish_failure_todo"
cat > "$completion_pr_publish_failure_bin/pnpm" <<'SH'
#!/usr/bin/env bash
exit 0
SH
chmod +x "$completion_pr_publish_failure_bin/pnpm"
cat > "$completion_pr_publish_failure_bin/gh" <<'SH'
#!/usr/bin/env bash
set -eu
case "${1:-} ${2:-}" in
  "api user")
    printf '%s\n' "${PHASE_LOOP_TEST_IMPLEMENTATION_ACTOR:?}"
    ;;
  "auth token")
    printf 'fake-token\n'
    ;;
  "pr view")
    exit 1
    ;;
  "pr create")
    attempts=0
    if [ -f "${FAKE_GH_PR_CREATE_ATTEMPTS:?}" ]; then
      attempts="$(wc -l < "${FAKE_GH_PR_CREATE_ATTEMPTS}")"
    fi
    printf 'attempt\n' >> "${FAKE_GH_PR_CREATE_ATTEMPTS}"
    if [ "$attempts" -eq 0 ]; then
      exit 1
    fi
    printf 'https://github.com/%s/pull/10002\n' "${PHASE_LOOP_TEST_REPOSITORY:?}"
    ;;
  *)
    exit 0
    ;;
esac
SH
chmod +x "$completion_pr_publish_failure_bin/gh"
completion_pr_publish_failure_brownie="$(mktemp)"
cat > "$completion_pr_publish_failure_brownie" <<SH
#!/usr/bin/env bash
set -eu
printf 'runtime-invoked\n' >> "$completion_pr_publish_failure_runtime_count"
exit 99
SH
chmod +x "$completion_pr_publish_failure_brownie"
set +e
PATH="$completion_pr_publish_failure_bin:$PATH" \
FAKE_GH_PR_CREATE_ATTEMPTS="$completion_pr_publish_failure_count" \
PHASE_LOOP_STATE_DIR="$completion_pr_publish_failure_state" \
PHASE_LOOP_PROMPT="$completion_pr_publish_failure_prompt" \
PHASE_LOOP_TODO="$completion_pr_publish_failure_todo" \
BROWNIE_BIN="$fake_brownie_completed_tracked_workspace_change" \
PHASE_LOOP_WORKSPACE_ROOT="$completion_pr_publish_failure_workspace" \
PHASE_LOOP_CREATE_PR_AFTER_PROGRESS=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null
completion_pr_publish_failure_first_exit="$?"
set -e
test "$completion_pr_publish_failure_first_exit" = "78"
python3 - "$completion_pr_publish_failure_state/status.json" "$completion_pr_publish_failure_state/todo-claims/current.json" "$completion_pr_publish_failure_todo" "$completion_pr_publish_failure_count" "$completion_pr_publish_failure_runtime_count" <<'PY'
import json
import os
import pathlib
import sys

status = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
claim = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding='utf-8'))
todo = pathlib.Path(sys.argv[3]).read_text(encoding='utf-8')
attempts = pathlib.Path(sys.argv[4])
runtime_count = pathlib.Path(sys.argv[5])
assert status['status'] == 'blocked', status
assert status['exit_code'] == '78', status
assert claim['status'] == 'completed', claim
assert claim['completion_pr_pending'] is True, claim
assert any(item.get('note') == 'completion_pr_publish_pending' for item in claim['status_history']), claim
assert '- [ ] E-completion-pr-retry:' not in todo, todo
assert attempts.read_text(encoding='utf-8').splitlines() == ['attempt'], attempts
assert not runtime_count.exists(), runtime_count
PY
set +e
PATH="$completion_pr_publish_failure_bin:$PATH" \
FAKE_GH_PR_CREATE_ATTEMPTS="$completion_pr_publish_failure_count" \
PHASE_LOOP_STATE_DIR="$completion_pr_publish_failure_state" \
PHASE_LOOP_PROMPT="$completion_pr_publish_failure_prompt" \
PHASE_LOOP_TODO="$completion_pr_publish_failure_todo" \
BROWNIE_BIN="$completion_pr_publish_failure_brownie" \
PHASE_LOOP_WORKSPACE_ROOT="$completion_pr_publish_failure_workspace" \
PHASE_LOOP_CREATE_PR_AFTER_PROGRESS=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null
completion_pr_publish_failure_second_exit="$?"
set -e
test "$completion_pr_publish_failure_second_exit" = "0"
python3 - "$completion_pr_publish_failure_state/status.json" "$completion_pr_publish_failure_state/todo-claims/current.json" "$completion_pr_publish_failure_count" "$completion_pr_publish_failure_runtime_count" "$completion_pr_publish_failure_workspace" <<'PY'
import json
import os
import pathlib
import subprocess
import sys

status = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
claim = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding='utf-8'))
attempts = pathlib.Path(sys.argv[3])
runtime_count = pathlib.Path(sys.argv[4])
workspace = sys.argv[5]
assert status['status'] == 'pr_created', status
assert 'pull/10002' in status['detail'], status
assert claim['status'] == 'completed', claim
assert claim['completion_pr_pending'] is False, claim
assert attempts.read_text(encoding='utf-8').splitlines() == ['attempt', 'attempt'], attempts
assert not runtime_count.exists(), runtime_count
head = subprocess.check_output(['git', '-C', workspace, 'rev-parse', 'HEAD'], text=True).strip()
remote = subprocess.check_output(['git', '-C', workspace, 'rev-parse', f"fixture-origin/{os.environ['PHASE_LOOP_TEST_IMPLEMENTATION_BRANCH_PREFIX']}smoke-completion-pr-retry"], text=True).strip()
assert head == remote, (head, remote)
PY

# Repeated cleanup failure must reassert cleanup_pending without clearing an
# already durable completion_pr_pending marker or any of its workspace/log
# metadata. The third run must complete cleanup and publish that same PR.
completion_pr_marker_preservation_state="$(mktemp -d)"
completion_pr_marker_preservation_prompt="$(mktemp)"
completion_pr_marker_preservation_todo="$(mktemp)"
completion_pr_marker_preservation_workspace="$(mktemp -d)"
completion_pr_marker_preservation_remote="$(mktemp -d)"
completion_pr_marker_preservation_bin="$(mktemp -d)"
completion_pr_marker_preservation_count="$completion_pr_marker_preservation_state/pr-create-count"
completion_pr_marker_preservation_runtime_count="$completion_pr_marker_preservation_state/runtime-count"
git -C "$completion_pr_marker_preservation_workspace" init -b main >/dev/null
mkdir -p "$completion_pr_marker_preservation_workspace/scripts"
cp "$REPO_ROOT/scripts/phase-loop-pr-actor-guard.mjs" "$completion_pr_marker_preservation_workspace/scripts/phase-loop-pr-actor-guard.mjs"
printf 'base\n' > "$completion_pr_marker_preservation_workspace/README.md"
git -C "$completion_pr_marker_preservation_workspace" add .
git -C "$completion_pr_marker_preservation_workspace" -c user.name=Brownie -c user.email=brownie@example.invalid commit -m init >/dev/null
git -C "$completion_pr_marker_preservation_remote" init --bare >/dev/null
git -C "$completion_pr_marker_preservation_workspace" remote add origin "$completion_pr_marker_preservation_remote"
git -C "$completion_pr_marker_preservation_workspace" push -u origin main >/dev/null
git -C "$completion_pr_marker_preservation_workspace" switch -c "${PHASE_LOOP_TEST_IMPLEMENTATION_BRANCH_PREFIX}smoke-completion-pr-marker-preservation" >/dev/null
phase_loop_prepare_pr_fixture_workspace "$completion_pr_marker_preservation_workspace" "$completion_pr_marker_preservation_remote"
printf 'base prompt\n' > "$completion_pr_marker_preservation_prompt"
printf -- '- [ ] E-completion-pr-marker-preservation: Patch only `README.md`:\n  Route: implementation.\n  Verification: run `node --check scripts/phase-loop-pr-actor-guard.mjs`.\n' > "$completion_pr_marker_preservation_todo"
cat > "$completion_pr_marker_preservation_bin/pnpm" <<'SH'
#!/usr/bin/env bash
exit 0
SH
chmod +x "$completion_pr_marker_preservation_bin/pnpm"
cat > "$completion_pr_marker_preservation_bin/gh" <<'SH'
#!/usr/bin/env bash
set -eu
case "${1:-} ${2:-}" in
  "api user") printf '%s\n' "${PHASE_LOOP_TEST_IMPLEMENTATION_ACTOR:?}" ;;
  "auth token") printf 'fake-token\n' ;;
  "pr view") exit 1 ;;
  "pr create")
    printf '1\n' >> "${FAKE_GH_PR_CREATE_COUNT:?}"
    printf 'https://github.com/%s/pull/10003\n' "${PHASE_LOOP_TEST_REPOSITORY:?}"
    ;;
  *) exit 0 ;;
esac
SH
chmod +x "$completion_pr_marker_preservation_bin/gh"
completion_pr_marker_preservation_brownie="$(mktemp)"
cat > "$completion_pr_marker_preservation_brownie" <<SH
#!/usr/bin/env bash
set -eu
printf 'runtime-invoked\n' >> "$completion_pr_marker_preservation_runtime_count"
exec "$fake_brownie_completed_tracked_workspace_change" "\$@"
SH
chmod +x "$completion_pr_marker_preservation_brownie"
set +e
PATH="$completion_pr_marker_preservation_bin:$PATH" \
FAKE_GH_PR_CREATE_COUNT="$completion_pr_marker_preservation_count" \
PHASE_LOOP_STATE_DIR="$completion_pr_marker_preservation_state" \
PHASE_LOOP_PROMPT="$completion_pr_marker_preservation_prompt" \
PHASE_LOOP_TODO="$completion_pr_marker_preservation_todo" \
BROWNIE_BIN="$completion_pr_marker_preservation_brownie" \
PHASE_LOOP_WORKSPACE_ROOT="$completion_pr_marker_preservation_workspace" \
PHASE_LOOP_CREATE_PR_AFTER_PROGRESS=1 \
PHASE_LOOP_TEST_FAIL_COMPLETED_TODO_REMOVAL=1 \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 78 "$PHASE_LOOP" run-once >/dev/null
completion_pr_marker_preservation_first_exit="$?"
set -e
test "$completion_pr_marker_preservation_first_exit" = "78"
python3 - "$completion_pr_marker_preservation_state/todo-claims/current.json" <<'PY'
import json
import pathlib
import sys
claim = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
assert claim['completion_cleanup_pending'] is True, claim
assert claim['completion_pr_pending'] is True, claim
assert claim['completion_pr_workspace_before'], claim
assert claim['completion_pr_workspace_after'], claim
assert claim['completion_pr_stdout_log'], claim
assert claim['completion_pr_stderr_log'], claim
PY
set +e
PATH="$completion_pr_marker_preservation_bin:$PATH" \
FAKE_GH_PR_CREATE_COUNT="$completion_pr_marker_preservation_count" \
PHASE_LOOP_STATE_DIR="$completion_pr_marker_preservation_state" \
PHASE_LOOP_PROMPT="$completion_pr_marker_preservation_prompt" \
PHASE_LOOP_TODO="$completion_pr_marker_preservation_todo" \
BROWNIE_BIN="$completion_pr_marker_preservation_brownie" \
PHASE_LOOP_WORKSPACE_ROOT="$completion_pr_marker_preservation_workspace" \
PHASE_LOOP_CREATE_PR_AFTER_PROGRESS=1 \
PHASE_LOOP_TEST_FAIL_COMPLETED_TODO_REMOVAL=1 \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 78 "$PHASE_LOOP" run-once >/dev/null
completion_pr_marker_preservation_second_exit="$?"
set -e
test "$completion_pr_marker_preservation_second_exit" = "78"
python3 - "$completion_pr_marker_preservation_state/todo-claims/current.json" "$completion_pr_marker_preservation_state/status.json" "$completion_pr_marker_preservation_runtime_count" "$completion_pr_marker_preservation_count" <<'PY'
import json
import pathlib
import sys
claim = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
status = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding='utf-8'))
runtime_count = pathlib.Path(sys.argv[3])
pr_count = pathlib.Path(sys.argv[4])
assert status['status'] == 'blocked', status
assert claim['completion_cleanup_pending'] is True, claim
assert claim['completion_pr_pending'] is True, claim
assert claim['completion_pr_workspace_before'], claim
assert claim['completion_pr_workspace_after'], claim
assert claim['completion_pr_stdout_log'], claim
assert claim['completion_pr_stderr_log'], claim
assert runtime_count.read_text(encoding='utf-8').splitlines() == ['runtime-invoked'], runtime_count
assert not pr_count.exists(), pr_count
PY
test ! -e "$completion_pr_marker_preservation_state/stop"
set +e
PATH="$completion_pr_marker_preservation_bin:$PATH" \
FAKE_GH_PR_CREATE_COUNT="$completion_pr_marker_preservation_count" \
PHASE_LOOP_STATE_DIR="$completion_pr_marker_preservation_state" \
PHASE_LOOP_PROMPT="$completion_pr_marker_preservation_prompt" \
PHASE_LOOP_TODO="$completion_pr_marker_preservation_todo" \
BROWNIE_BIN="$completion_pr_marker_preservation_brownie" \
PHASE_LOOP_WORKSPACE_ROOT="$completion_pr_marker_preservation_workspace" \
PHASE_LOOP_CREATE_PR_AFTER_PROGRESS=1 \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null
completion_pr_marker_preservation_third_exit="$?"
set -e
test "$completion_pr_marker_preservation_third_exit" = "0"
python3 - "$completion_pr_marker_preservation_state/status.json" "$completion_pr_marker_preservation_state/todo-claims/current.json" "$completion_pr_marker_preservation_todo" "$completion_pr_marker_preservation_count" "$completion_pr_marker_preservation_runtime_count" <<'PY'
import json
import pathlib
import sys
status = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
claim = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding='utf-8'))
todo = pathlib.Path(sys.argv[3]).read_text(encoding='utf-8')
assert status['status'] == 'pr_created', status
assert claim['completion_cleanup_pending'] is False, claim
assert claim['completion_pr_pending'] is False, claim
assert '- [ ] E-completion-pr-marker-preservation:' not in todo, todo
assert pathlib.Path(sys.argv[4]).read_text(encoding='utf-8').splitlines() == ['1'], pathlib.Path(sys.argv[4]).read_text()
assert pathlib.Path(sys.argv[5]).read_text(encoding='utf-8').splitlines() == ['runtime-invoked'], pathlib.Path(sys.argv[5]).read_text()
PY
test ! -e "$completion_pr_marker_preservation_state/stop"

# If cleanup removes the final TODO and the process is interrupted before
# clearing cleanup_pending, the next run must recover the marker before the
# empty-queue stop gate and publish without Runtime or a stop file.
completion_cleanup_interrupt_state="$(mktemp -d)"
completion_cleanup_interrupt_prompt="$(mktemp)"
completion_cleanup_interrupt_todo="$(mktemp)"
completion_cleanup_interrupt_workspace="$(mktemp -d)"
completion_cleanup_interrupt_remote="$(mktemp -d)"
completion_cleanup_interrupt_bin="$(mktemp -d)"
completion_cleanup_interrupt_count="$completion_cleanup_interrupt_state/pr-create-count"
completion_cleanup_interrupt_runtime_count="$completion_cleanup_interrupt_state/runtime-count"
git -C "$completion_cleanup_interrupt_workspace" init -b main >/dev/null
mkdir -p "$completion_cleanup_interrupt_workspace/scripts"
cp "$REPO_ROOT/scripts/phase-loop-pr-actor-guard.mjs" "$completion_cleanup_interrupt_workspace/scripts/phase-loop-pr-actor-guard.mjs"
printf 'base\n' > "$completion_cleanup_interrupt_workspace/README.md"
git -C "$completion_cleanup_interrupt_workspace" add .
git -C "$completion_cleanup_interrupt_workspace" -c user.name=Brownie -c user.email=brownie@example.invalid commit -m init >/dev/null
git -C "$completion_cleanup_interrupt_remote" init --bare >/dev/null
git -C "$completion_cleanup_interrupt_workspace" remote add origin "$completion_cleanup_interrupt_remote"
git -C "$completion_cleanup_interrupt_workspace" push -u origin main >/dev/null
git -C "$completion_cleanup_interrupt_workspace" switch -c "${PHASE_LOOP_TEST_IMPLEMENTATION_BRANCH_PREFIX}smoke-completion-cleanup-interrupt" >/dev/null
phase_loop_prepare_pr_fixture_workspace "$completion_cleanup_interrupt_workspace" "$completion_cleanup_interrupt_remote"
printf 'base prompt\n' > "$completion_cleanup_interrupt_prompt"
printf -- '- [ ] E-completion-cleanup-interrupt: Patch only `README.md`:\n  Route: implementation.\n  Verification: run `node --check scripts/phase-loop-pr-actor-guard.mjs`.\n' > "$completion_cleanup_interrupt_todo"
cat > "$completion_cleanup_interrupt_bin/pnpm" <<'SH'
#!/usr/bin/env bash
exit 0
SH
chmod +x "$completion_cleanup_interrupt_bin/pnpm"
cat > "$completion_cleanup_interrupt_bin/gh" <<'SH'
#!/usr/bin/env bash
set -eu
case "${1:-} ${2:-}" in
  "api user") printf '%s\n' "${PHASE_LOOP_TEST_IMPLEMENTATION_ACTOR:?}" ;;
  "auth token") printf 'fake-token\n' ;;
  "pr view") exit 1 ;;
  "pr create")
    printf '1\n' >> "${FAKE_GH_PR_CREATE_COUNT:?}"
    printf 'https://github.com/%s/pull/10004\n' "${PHASE_LOOP_TEST_REPOSITORY:?}"
    ;;
  *) exit 0 ;;
esac
SH
chmod +x "$completion_cleanup_interrupt_bin/gh"
completion_cleanup_interrupt_brownie="$(mktemp)"
cat > "$completion_cleanup_interrupt_brownie" <<SH
#!/usr/bin/env bash
set -eu
printf 'runtime-invoked\n' >> "$completion_cleanup_interrupt_runtime_count"
exec "$fake_brownie_completed_tracked_workspace_change" "\$@"
SH
chmod +x "$completion_cleanup_interrupt_brownie"
set +e
PATH="$completion_cleanup_interrupt_bin:$PATH" \
FAKE_GH_PR_CREATE_COUNT="$completion_cleanup_interrupt_count" \
PHASE_LOOP_STATE_DIR="$completion_cleanup_interrupt_state" \
PHASE_LOOP_PROMPT="$completion_cleanup_interrupt_prompt" \
PHASE_LOOP_TODO="$completion_cleanup_interrupt_todo" \
BROWNIE_BIN="$completion_cleanup_interrupt_brownie" \
PHASE_LOOP_WORKSPACE_ROOT="$completion_cleanup_interrupt_workspace" \
PHASE_LOOP_CREATE_PR_AFTER_PROGRESS=1 \
PHASE_LOOP_TEST_FAIL_COMPLETED_TODO_REMOVAL=1 \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 78 "$PHASE_LOOP" run-once >/dev/null
completion_cleanup_interrupt_first_exit="$?"
set -e
test "$completion_cleanup_interrupt_first_exit" = "78"
set +e
PATH="$completion_cleanup_interrupt_bin:$PATH" \
FAKE_GH_PR_CREATE_COUNT="$completion_cleanup_interrupt_count" \
PHASE_LOOP_STATE_DIR="$completion_cleanup_interrupt_state" \
PHASE_LOOP_PROMPT="$completion_cleanup_interrupt_prompt" \
PHASE_LOOP_TODO="$completion_cleanup_interrupt_todo" \
BROWNIE_BIN="$completion_cleanup_interrupt_brownie" \
PHASE_LOOP_WORKSPACE_ROOT="$completion_cleanup_interrupt_workspace" \
PHASE_LOOP_CREATE_PR_AFTER_PROGRESS=1 \
PHASE_LOOP_TEST_INTERRUPT_AFTER_COMPLETED_TODO_REMOVAL=1 \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 78 "$PHASE_LOOP" run-once >/dev/null
completion_cleanup_interrupt_second_exit="$?"
set -e
test "$completion_cleanup_interrupt_second_exit" = "78"
python3 - "$completion_cleanup_interrupt_state/todo-claims/current.json" "$completion_cleanup_interrupt_todo" "$completion_cleanup_interrupt_runtime_count" "$completion_cleanup_interrupt_count" <<'PY'
import json
import pathlib
import sys
claim = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
todo = pathlib.Path(sys.argv[2]).read_text(encoding='utf-8')
assert claim['completion_cleanup_pending'] is True, claim
assert claim['completion_pr_pending'] is True, claim
assert '- [ ] E-completion-cleanup-interrupt:' not in todo, todo
assert pathlib.Path(sys.argv[3]).read_text(encoding='utf-8').splitlines() == ['runtime-invoked'], pathlib.Path(sys.argv[3]).read_text()
assert not pathlib.Path(sys.argv[4]).exists(), pathlib.Path(sys.argv[4])
PY
test ! -e "$completion_cleanup_interrupt_state/stop"
set +e
PATH="$completion_cleanup_interrupt_bin:$PATH" \
FAKE_GH_PR_CREATE_COUNT="$completion_cleanup_interrupt_count" \
PHASE_LOOP_STATE_DIR="$completion_cleanup_interrupt_state" \
PHASE_LOOP_PROMPT="$completion_cleanup_interrupt_prompt" \
PHASE_LOOP_TODO="$completion_cleanup_interrupt_todo" \
BROWNIE_BIN="$completion_cleanup_interrupt_brownie" \
PHASE_LOOP_WORKSPACE_ROOT="$completion_cleanup_interrupt_workspace" \
PHASE_LOOP_CREATE_PR_AFTER_PROGRESS=1 \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null
completion_cleanup_interrupt_third_exit="$?"
set -e
test "$completion_cleanup_interrupt_third_exit" = "0"
python3 - "$completion_cleanup_interrupt_state/status.json" "$completion_cleanup_interrupt_state/todo-claims/current.json" "$completion_cleanup_interrupt_todo" "$completion_cleanup_interrupt_count" "$completion_cleanup_interrupt_runtime_count" <<'PY'
import json
import pathlib
import sys
status = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
claim = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding='utf-8'))
todo = pathlib.Path(sys.argv[3]).read_text(encoding='utf-8')
assert status['status'] == 'pr_created', status
assert claim['completion_cleanup_pending'] is False, claim
assert claim['completion_pr_pending'] is False, claim
assert '- [ ] E-completion-cleanup-interrupt:' not in todo, todo
assert pathlib.Path(sys.argv[4]).read_text(encoding='utf-8').splitlines() == ['1'], pathlib.Path(sys.argv[4]).read_text()
assert pathlib.Path(sys.argv[5]).read_text(encoding='utf-8').splitlines() == ['runtime-invoked'], pathlib.Path(sys.argv[5]).read_text()
PY
test ! -e "$completion_cleanup_interrupt_state/stop"

# If recovery and blocked evidence are durable but the final source todo.failed
# transition fails, retain the source claim and close that transition on the
# next run without invoking Runtime a second time.
terminal_source_transition_pending_state="$(mktemp -d)"
terminal_source_transition_pending_prompt="$(mktemp)"
terminal_source_transition_pending_todo="$(mktemp)"
terminal_source_transition_pending_workspace="$(mktemp -d)"
terminal_source_transition_pending_runtime_count="$terminal_source_transition_pending_state/runtime-count"
git -C "$terminal_source_transition_pending_workspace" init -b main >/dev/null
git -C "$terminal_source_transition_pending_workspace" -c user.name=Brownie -c user.email=brownie@example.invalid commit --allow-empty -m init >/dev/null
printf 'base prompt\n' > "$terminal_source_transition_pending_prompt"
printf -- '- [ ] E-final-source-transition-pending: Patch only `scripts/provider-target.mjs`:\n  Route: implementation.\n  Completion condition: provider terminal failure is durably blocked.\n  Verification: run `node --check scripts/provider-target.mjs`.\n' > "$terminal_source_transition_pending_todo"
terminal_source_transition_pending_brownie="$(mktemp)"
cat > "$terminal_source_transition_pending_brownie" <<SH
#!/usr/bin/env bash
set -eu
printf 'runtime-invoked\n' >> "$terminal_source_transition_pending_runtime_count"
exec "$fake_brownie_terminal_no_eligible" "\$@"
SH
chmod +x "$terminal_source_transition_pending_brownie"
set +e
PHASE_LOOP_STATE_DIR="$terminal_source_transition_pending_state" \
PHASE_LOOP_PROMPT="$terminal_source_transition_pending_prompt" \
PHASE_LOOP_TODO="$terminal_source_transition_pending_todo" \
BROWNIE_BIN="$terminal_source_transition_pending_brownie" \
PHASE_LOOP_WORKSPACE_ROOT="$terminal_source_transition_pending_workspace" \
PHASE_LOOP_TERMINAL_FAILURE_RETRY_CAP=1 \
PHASE_LOOP_TEST_FAIL_FINAL_SOURCE_TODO_FAILED_LEDGER=1 \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 78 "$PHASE_LOOP" run-once >/dev/null
terminal_source_transition_pending_first_exit="$?"
set -e
test "$terminal_source_transition_pending_first_exit" = "78"
python3 - "$terminal_source_transition_pending_state/todo-claims/current.json" "$terminal_source_transition_pending_state/todo-claims/blocked.jsonl" "$terminal_source_transition_pending_workspace/.brownie/private/phase-loop/task-ledger.jsonl" "$terminal_source_transition_pending_runtime_count" <<'PY'
import json
import pathlib
import sys
claim = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
blocked = [json.loads(line) for line in pathlib.Path(sys.argv[2]).read_text(encoding='utf-8').splitlines() if line.strip()]
ledger = [json.loads(line) for line in pathlib.Path(sys.argv[3]).read_text(encoding='utf-8').splitlines() if line.strip()]
assert claim['status'] == 'in_progress', claim
assert claim['terminal_failure_source_transition_pending'] is True, claim
assert claim['terminal_failure_source_transition_recovery_id'], claim
assert blocked and blocked[-1]['terminal_failure'] is True, blocked
assert any(record.get('kind') == 'terminal_failure_transaction' for record in ledger), ledger
source_task = 'E-final-source-transition-pending@' + claim['claim_id']
assert not any(event.get('task_id') == source_task and event.get('to_state') == 'failed' for record in ledger for event in (record.get('events', []) if record.get('kind') == 'terminal_failure_transaction' else [record])), ledger
assert pathlib.Path(sys.argv[4]).read_text(encoding='utf-8').splitlines() == ['runtime-invoked'], pathlib.Path(sys.argv[4]).read_text()
PY
test ! -e "$terminal_source_transition_pending_state/stop"
set +e
PHASE_LOOP_STATE_DIR="$terminal_source_transition_pending_state" \
PHASE_LOOP_PROMPT="$terminal_source_transition_pending_prompt" \
PHASE_LOOP_TODO="$terminal_source_transition_pending_todo" \
BROWNIE_BIN="$terminal_source_transition_pending_brownie" \
PHASE_LOOP_WORKSPACE_ROOT="$terminal_source_transition_pending_workspace" \
PHASE_LOOP_TERMINAL_FAILURE_RETRY_CAP=1 \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 76 "$PHASE_LOOP" run-once >/dev/null
terminal_source_transition_pending_second_exit="$?"
set -e
test "$terminal_source_transition_pending_second_exit" = "76"
python3 - "$terminal_source_transition_pending_state/status.json" "$terminal_source_transition_pending_state/todo-claims/current.json" "$terminal_source_transition_pending_workspace/.brownie/private/phase-loop/task-ledger.jsonl" "$terminal_source_transition_pending_runtime_count" <<'PY'
import json
import pathlib
import sys
status = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
claim = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding='utf-8'))
ledger = [json.loads(line) for line in pathlib.Path(sys.argv[3]).read_text(encoding='utf-8').splitlines() if line.strip()]
assert status['status'] == 'blocked', status
assert status['exit_code'] == '76', status
assert claim['status'] == 'failed', claim
assert claim['terminal_failure_source_transition_pending'] is False, claim
assert any(item.get('note') == 'terminal_failure_source_transition_completed' for item in claim['status_history']), claim
source_task = 'E-final-source-transition-pending@' + claim['claim_id']
assert any(event.get('task_id') == source_task and event.get('to_state') == 'failed' and event.get('from_state') in ('claimed', 'running') for record in ledger for event in (record.get('events', []) if record.get('kind') == 'terminal_failure_transaction' else [record])), ledger
assert pathlib.Path(sys.argv[4]).read_text(encoding='utf-8').splitlines() == ['runtime-invoked'], pathlib.Path(sys.argv[4]).read_text()
PY
test ! -e "$terminal_source_transition_pending_state/stop"

# If the supervisor is killed after terminal recovery and blocked evidence are
# durable but before the main loop writes todo.failed, the restart-visible
# source-transition obligation must prevent a second Runtime invocation.
terminal_source_kill_window_state="$(mktemp -d)"
terminal_source_kill_window_prompt="$(mktemp)"
terminal_source_kill_window_todo="$(mktemp)"
terminal_source_kill_window_workspace="$(mktemp -d)"
terminal_source_kill_window_runtime_count="$terminal_source_kill_window_state/runtime-count"
git -C "$terminal_source_kill_window_workspace" init -b main >/dev/null
git -C "$terminal_source_kill_window_workspace" -c user.name=Brownie -c user.email=brownie@example.invalid commit --allow-empty -m init >/dev/null
printf 'base prompt\n' > "$terminal_source_kill_window_prompt"
printf -- '- [ ] E-terminal-source-kill-window: Patch only `scripts/provider-target.mjs`:\n  Route: implementation.\n  Completion condition: source transition remains durable across supervisor interruption.\n  Verification: run `node --check scripts/provider-target.mjs`.\n' > "$terminal_source_kill_window_todo"
terminal_source_kill_window_brownie="$(mktemp)"
cat > "$terminal_source_kill_window_brownie" <<SH
#!/usr/bin/env bash
set -eu
printf 'runtime-invoked\n' >> "$terminal_source_kill_window_runtime_count"
exec "$fake_brownie_terminal_no_eligible" "\$@"
SH
chmod +x "$terminal_source_kill_window_brownie"
set +e
PHASE_LOOP_STATE_DIR="$terminal_source_kill_window_state" \
PHASE_LOOP_PROMPT="$terminal_source_kill_window_prompt" \
PHASE_LOOP_TODO="$terminal_source_kill_window_todo" \
BROWNIE_BIN="$terminal_source_kill_window_brownie" \
PHASE_LOOP_WORKSPACE_ROOT="$terminal_source_kill_window_workspace" \
PHASE_LOOP_TERMINAL_FAILURE_RETRY_CAP=1 \
PHASE_LOOP_TEST_KILL_AFTER_TERMINAL_RECOVERY=1 \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 143 "$PHASE_LOOP" run-once >/dev/null
terminal_source_kill_window_first_exit="$?"
set -e
test "$terminal_source_kill_window_first_exit" = "143"
python3 - "$terminal_source_kill_window_state/todo-claims/terminal-failure-source-transition.pending.json" "$terminal_source_kill_window_state/todo-claims/blocked.jsonl" "$terminal_source_kill_window_runtime_count" <<'PY'
import json
import pathlib
import sys
marker = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
blocked = [json.loads(line) for line in pathlib.Path(sys.argv[2]).read_text(encoding='utf-8').splitlines() if line.strip()]
assert marker['claim']['terminal_failure_source_transition_pending'] is True, marker
assert marker['recovery_id'], marker
assert blocked and blocked[-1]['terminal_failure'] is True, blocked
assert pathlib.Path(sys.argv[3]).read_text(encoding='utf-8').splitlines() == ['runtime-invoked'], pathlib.Path(sys.argv[3]).read_text()
PY
set +e
PHASE_LOOP_STATE_DIR="$terminal_source_kill_window_state" \
PHASE_LOOP_PROMPT="$terminal_source_kill_window_prompt" \
PHASE_LOOP_TODO="$terminal_source_kill_window_todo" \
BROWNIE_BIN="$terminal_source_kill_window_brownie" \
PHASE_LOOP_WORKSPACE_ROOT="$terminal_source_kill_window_workspace" \
PHASE_LOOP_TERMINAL_FAILURE_RETRY_CAP=1 \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 76 "$PHASE_LOOP" run-once >/dev/null
terminal_source_kill_window_second_exit="$?"
set -e
test "$terminal_source_kill_window_second_exit" = "76"
python3 - "$terminal_source_kill_window_state/status.json" "$terminal_source_kill_window_state/todo-claims/current.json" "$terminal_source_kill_window_state/todo-claims/blocked.jsonl" "$terminal_source_kill_window_runtime_count" <<'PY'
import json
import pathlib
import sys
status = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
claim = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding='utf-8'))
blocked = [json.loads(line) for line in pathlib.Path(sys.argv[3]).read_text(encoding='utf-8').splitlines() if line.strip()]
assert status['exit_code'] == '76', status
assert claim['status'] == 'failed', claim
assert claim['terminal_failure_source_transition_pending'] is False, claim
assert any(item.get('note') == 'terminal_failure_source_transition_completed' for item in claim['status_history']), claim
assert len(blocked) == 1, blocked
assert pathlib.Path(sys.argv[4]).read_text(encoding='utf-8').splitlines() == ['runtime-invoked'], pathlib.Path(sys.argv[4]).read_text()
assert not pathlib.Path(sys.argv[2]).parent.joinpath('terminal-failure-source-transition.pending.json').exists()
PY
fi

if claim_smoke_section_enabled terminal-absent; then
# Terminal recovery remains durable when the runtime removes the active claim
# before the controller emits its final trajectory. The next run must not
# recreate the same queue-generation/target attempt.
state_terminal_claim_absent="$(mktemp -d)"
prompt_terminal_claim_absent="$(mktemp)"
todo_terminal_claim_absent="$(mktemp)"
terminal_claim_absent_workspace="$(mktemp -d)"
git -C "$terminal_claim_absent_workspace" init -b main >/dev/null
git -C "$terminal_claim_absent_workspace" -c user.name=Brownie -c user.email=brownie@example.invalid commit --allow-empty -m init >/dev/null
printf 'base prompt\n' > "$prompt_terminal_claim_absent"
printf -- '- [ ] E-15b-provider-terminal: Patch only `scripts/provider-target.mjs`:\n  Route: implementation.\n  Completion condition: provider terminal failure is durably blocked.\n  Verification: run `node --check scripts/provider-target.mjs`.\n' > "$todo_terminal_claim_absent"
set +e
PHASE_LOOP_STATE_DIR="$state_terminal_claim_absent" \
PHASE_LOOP_PROMPT="$prompt_terminal_claim_absent" \
PHASE_LOOP_TODO="$todo_terminal_claim_absent" \
BROWNIE_BIN="$fake_brownie_terminal_no_eligible" \
PHASE_LOOP_WORKSPACE_ROOT="$terminal_claim_absent_workspace" \
PHASE_LOOP_TERMINAL_FAILURE_RETRY_CAP=1 \
PHASE_LOOP_TEST_REMOVE_CLAIM=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null
terminal_claim_absent_exit="$?"
set -e
test "$terminal_claim_absent_exit" = "76"
test ! -f "$state_terminal_claim_absent/todo-claims/current.json"
test ! -e "$state_terminal_claim_absent/todo-claims/terminal-failure-source-transition.pending.json"
python3 - "$state_terminal_claim_absent/status.json" "$state_terminal_claim_absent/todo-claims/blocked.jsonl" "$terminal_claim_absent_workspace/.brownie/private/phase-loop/task-ledger.jsonl" "$state_terminal_claim_absent/bdk-trajectory.jsonl" <<'PY'
import json
import pathlib
import sys

status = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
blocked = [json.loads(line) for line in pathlib.Path(sys.argv[2]).read_text(encoding='utf-8').splitlines() if line.strip()]
ledger = pathlib.Path(sys.argv[3]).read_text(encoding='utf-8')
ledger_records = [
    json.loads(line)
    for line in pathlib.Path(sys.argv[3]).read_text(encoding='utf-8').splitlines()
    if line.strip()
]
bdk_records = [
    json.loads(line)
    for line in pathlib.Path(sys.argv[4]).read_text(encoding='utf-8').splitlines()
    if line.strip()
]
assert status['status'] == 'blocked', status
assert blocked and blocked[-1]['block_reason'] == 'terminal_runtime_failure', blocked
assert blocked[-1]['terminal_failure'] is True, blocked
assert blocked[-1]['provider_failure_fingerprint'] == 'sha256:provider-terminal-no-content', blocked
assert len(blocked[-1]['controller_fingerprint']) == 64, blocked
assert 'terminal_failure_transaction' in ledger, ledger
assert 'E-15b-provider-terminal' in ledger, ledger
assert 'provider-terminal-no-content' in ledger, ledger
assert 'controller_fingerprint' in ledger, ledger
assert '"claim_absent":true' in ledger, ledger
assert 'scripts/provider-target.mjs' in ledger, ledger
assert 'node --check scripts/provider-target.mjs' in ledger, ledger
claim_id = blocked[-1]['claim_id']
assert any(
    event.get('claim_id') == claim_id
    and event.get('to_state') == 'failed'
    and event.get('from_state') in ('claimed', 'running')
    and str(event.get('task_id', '')).endswith('@' + claim_id)
    for record in ledger_records
    for event in (record.get('events', []) if record.get('kind') == 'terminal_failure_transaction' else [record])
), ledger_records
assert any(
    record.get('claim_id') == claim_id
    and any(event.get('type') == 'todo.blocked' for event in record.get('events', []))
    for record in bdk_records
), bdk_records
PY
PHASE_LOOP_STATE_DIR="$state_terminal_claim_absent" \
PHASE_LOOP_PROMPT="$prompt_terminal_claim_absent" \
PHASE_LOOP_TODO="$todo_terminal_claim_absent" \
BROWNIE_BIN="$fake_brownie_terminal_no_eligible" \
PHASE_LOOP_WORKSPACE_ROOT="$terminal_claim_absent_workspace" \
PHASE_LOOP_TERMINAL_FAILURE_RETRY_CAP=1 \
PHASE_LOOP_TEST_REMOVE_CLAIM=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null || true
python3 - "$terminal_claim_absent_workspace/.brownie/private/phase-loop/task-ledger.jsonl" <<'PY'
import json
import pathlib
import sys

transactions = []
for line in pathlib.Path(sys.argv[1]).read_text(encoding='utf-8').splitlines():
    if not line.strip():
        continue
    record = json.loads(line)
    if record.get('kind') == 'terminal_failure_transaction':
        transactions.append(record)
same_todo = [
    record for record in transactions
    if any('E-15b-provider-terminal:' in str(event.get('selected_todo', '')) for event in record.get('events', []))
]
assert len(same_todo) == 2, same_todo
PY

# The configured retry cap permits exactly one fresh attempt, but durable
# terminal evidence must still stop the controller from reexecuting forever.
set +e
PHASE_LOOP_STATE_DIR="$state_terminal_claim_absent" \
PHASE_LOOP_PROMPT="$prompt_terminal_claim_absent" \
PHASE_LOOP_TODO="$todo_terminal_claim_absent" \
BROWNIE_BIN="$fake_brownie_terminal_no_eligible" \
PHASE_LOOP_WORKSPACE_ROOT="$terminal_claim_absent_workspace" \
PHASE_LOOP_TERMINAL_FAILURE_RETRY_CAP=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null
terminal_claim_absent_third_exit="$?"
set -e
case "$terminal_claim_absent_third_exit" in
  0|76) ;;
  *) exit 1 ;;
esac
python3 - "$terminal_claim_absent_workspace/.brownie/private/phase-loop/task-ledger.jsonl" <<'PY'
import json
import pathlib
import sys

transactions = []
for line in pathlib.Path(sys.argv[1]).read_text(encoding='utf-8').splitlines():
    if not line.strip():
        continue
    record = json.loads(line)
    if record.get('kind') == 'terminal_failure_transaction':
        transactions.append(record)
same_todo = [
    record for record in transactions
    if any('E-15b-provider-terminal:' in str(event.get('selected_todo', '')) for event in record.get('events', []))
]
assert len(same_todo) == 2, same_todo
PY

# A stale active claim can be replaced before Runtime starts. If Runtime then
# removes current.json, terminal recovery must use the replacement claim
# snapshot rather than the displaced claim's target/identity.
state_stale_replacement_claim_absent="$(mktemp -d)"
prompt_stale_replacement_claim_absent="$(mktemp)"
todo_stale_replacement_claim_absent="$(mktemp)"
todo_breakdown_stale_replacement_claim_absent="$(mktemp)"
stale_replacement_workspace="$(mktemp -d)"
git -C "$stale_replacement_workspace" init -b main >/dev/null
git -C "$stale_replacement_workspace" config user.name Brownie
git -C "$stale_replacement_workspace" config user.email brownie@example.invalid
mkdir -p "$stale_replacement_workspace/.brownie" "$stale_replacement_workspace/scripts"
printf 'old target\n' > "$stale_replacement_workspace/scripts/old.mjs"
printf 'new target\n' > "$stale_replacement_workspace/scripts/new.mjs"
git -C "$stale_replacement_workspace" add .
git -C "$stale_replacement_workspace" commit -m init >/dev/null
printf 'base prompt\n' > "$prompt_stale_replacement_claim_absent"
printf -- '- [ ] E-stale-replacement-new: Patch only `scripts/new.mjs`:\n  Route: implementation.\n  Verification: run `node --check scripts/new.mjs`.\n' > "$todo_stale_replacement_claim_absent"
printf '# Breakdown\n' > "$todo_breakdown_stale_replacement_claim_absent"
mkdir -p "$state_stale_replacement_claim_absent/todo-claims"
cat > "$state_stale_replacement_claim_absent/todo-claims/current.json" <<'JSON'
{
  "schema_version": 1,
  "claim_id": "todo-g1-old-stale-replacement",
  "selected_todo": "- [ ] E-stale-replacement-old: Patch only `scripts/old.mjs`:\n  Route: implementation.\n  Verification: run `node --check scripts/old.mjs`.\n",
  "status": "in_progress",
  "queue_generation": 1,
  "queue_fingerprint": "old-queue-fingerprint"
}
JSON
set +e
PHASE_LOOP_STATE_DIR="$state_stale_replacement_claim_absent" \
PHASE_LOOP_PROMPT="$prompt_stale_replacement_claim_absent" \
PHASE_LOOP_TODO="$todo_stale_replacement_claim_absent" \
PHASE_LOOP_TODO_BREAKDOWN="$todo_breakdown_stale_replacement_claim_absent" \
BROWNIE_BIN="$fake_brownie_terminal_no_eligible" \
PHASE_LOOP_WORKSPACE_ROOT="$stale_replacement_workspace" \
PHASE_LOOP_TERMINAL_FAILURE_RETRY_CAP=1 \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
PHASE_LOOP_TEST_REMOVE_CLAIM=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 76 "$PHASE_LOOP" run-once >/dev/null
stale_replacement_exit="$?"
set -e
test "$stale_replacement_exit" = "76"
python3 - "$state_stale_replacement_claim_absent/todo-claims" "$stale_replacement_workspace/.brownie/private/phase-loop/task-ledger.jsonl" <<'PY'
import json
import pathlib
import sys

claim_dir = pathlib.Path(sys.argv[1])
ledger_path = pathlib.Path(sys.argv[2])
records = []
for line in ledger_path.read_text(encoding='utf-8').splitlines():
    if line.strip():
        record = json.loads(line)
        if record.get('kind') == 'terminal_failure_transaction':
            records.append(record)
assert len(records) == 1, records
events = records[0]['events']
failed = events[-1]
assert 'E-stale-replacement-new:' in failed['selected_todo'], failed
assert failed['claim_id'] != 'todo-g1-old-stale-replacement', failed
assert failed['claim_id'].startswith('todo-g'), failed
PY
fi

if claim_smoke_section_enabled queue-claim; then
# Queue fixtures are intentionally self-contained.  In particular, this
# section must also run when selected directly by CI, without relying on the
# core shard having initialized any of its variables or workspace files.
queue_workspace="$(mktemp -d)"
git -C "$queue_workspace" init -b main >/dev/null
# The trusted TODO guard evaluates package-script metadata from the workspace
# even though its guard implementation is loaded from the control root.
mkdir -p "$queue_workspace/.brownie"
mkdir -p "$queue_workspace/scripts"
printf '%s\n' '{"name":"brownie-claim-smoke-queue-fixture","private":true,"scripts":{"guard:todo-decomposition":"node scripts/guard-todo-decomposition.mjs","phase-loop:todo-queue-integrity":"node scripts/phase-loop-todo-queue-integrity.mjs"}}' > "$queue_workspace/package.json"
printf '%s\n' '- [ ] E-99-objective-apply: Patch only `README.md` to exercise objective apply stall recovery.' > "$queue_workspace/.brownie/todo.md"
printf '# queue fixture breakdown\n' > "$queue_workspace/.brownie/todo-breakdown.md"
printf 'export const evidence = {};\n' > "$queue_workspace/scripts/release-supply-chain-artifact-evidence.mjs"
git -C "$queue_workspace" add package.json .brownie/todo.md .brownie/todo-breakdown.md scripts/release-supply-chain-artifact-evidence.mjs
git -C "$queue_workspace" -c user.name=Brownie -c user.email=brownie@example.invalid commit -m init >/dev/null
queue_original_workspace="$test_workspace"
test_workspace="$queue_workspace"

queue_state_with_claim="$(mktemp -d)"
queue_prompt_with_claim="$(mktemp)"
queue_todo_with_claim="$(mktemp)"
printf 'base prompt\n' > "$queue_prompt_with_claim"
printf -- '- [ ] B-01: durable claim task\n  with detail\n  Files: \`scripts/release-runtime-operational-evidence.mjs\`, \`docs/architecture/local-release-targets.example.json\`.\n- [ ] B-02: next task\n' > "$queue_todo_with_claim"

PHASE_LOOP_STATE_DIR="$queue_state_with_claim" \
PHASE_LOOP_PROMPT="$queue_prompt_with_claim" \
PHASE_LOOP_TODO="$queue_todo_with_claim" \
BROWNIE_BIN="$fake_brownie_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

queue_claim_file="$queue_state_with_claim/todo-claims/current.json"
queue_prompt_file="$(find "$queue_state_with_claim/runs" -name '*.prompt.md' -print | sort | tail -n 1)"

queue_state_with_blocked="$(mktemp -d)"
queue_prompt_with_blocked="$(mktemp)"
queue_todo_with_blocked="$(mktemp)"
printf 'base prompt\n' > "$queue_prompt_with_blocked"
printf -- '- [ ] R-09: blocked boundary task\n' > "$queue_todo_with_blocked"

PHASE_LOOP_STATE_DIR="$queue_state_with_blocked" \
PHASE_LOOP_PROMPT="$queue_prompt_with_blocked" \
PHASE_LOOP_TODO="$queue_todo_with_blocked" \
BROWNIE_BIN="$fake_brownie_blocked_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

state_objective_apply_stalled="$(mktemp -d)"
prompt_objective_apply_stalled="$(mktemp)"
queue_objective_workspace="$(mktemp -d)"
git -C "$queue_objective_workspace" init -b main >/dev/null
mkdir -p "$queue_objective_workspace/.brownie"
printf '%s\n' '{"name":"brownie-claim-smoke-objective-fixture","private":true,"scripts":{"guard:todo-decomposition":"node scripts/guard-todo-decomposition.mjs","phase-loop:todo-queue-integrity":"node scripts/phase-loop-todo-queue-integrity.mjs"}}' > "$queue_objective_workspace/package.json"
printf '%s\n' '- [ ] E-99-objective-apply: Patch only `README.md` to exercise objective apply stall recovery.' > "$queue_objective_workspace/.brownie/todo.md"
printf '# queue fixture breakdown\n' > "$queue_objective_workspace/.brownie/todo-breakdown.md"
git -C "$queue_objective_workspace" add package.json .brownie/todo.md .brownie/todo-breakdown.md
git -C "$queue_objective_workspace" -c user.name=Brownie -c user.email=brownie@example.invalid commit -m init >/dev/null
todo_objective_apply_stalled="$queue_objective_workspace/.brownie/todo.md"
todo_breakdown_objective_apply_stalled="$queue_objective_workspace/.brownie/todo-breakdown.md"
printf 'base prompt\n' > "$prompt_objective_apply_stalled"
printf -- '- [ ] E-99-objective-apply: Patch only `README.md` to exercise objective apply stall recovery.\n' > "$todo_objective_apply_stalled"
test_workspace="$queue_objective_workspace"

PHASE_LOOP_STATE_DIR="$state_objective_apply_stalled" \
PHASE_LOOP_PROMPT="$prompt_objective_apply_stalled" \
PHASE_LOOP_TODO="$todo_objective_apply_stalled" \
PHASE_LOOP_TODO_BREAKDOWN="$todo_breakdown_objective_apply_stalled" \
BROWNIE_BIN="$fake_brownie_objective_apply_pending" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

PHASE_LOOP_STATE_DIR="$state_objective_apply_stalled" \
PHASE_LOOP_PROMPT="$prompt_objective_apply_stalled" \
PHASE_LOOP_TODO="$todo_objective_apply_stalled" \
PHASE_LOOP_TODO_BREAKDOWN="$todo_breakdown_objective_apply_stalled" \
BROWNIE_BIN="$fake_brownie_objective_apply_legacy_resume" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

PHASE_LOOP_STATE_DIR="$state_objective_apply_stalled" \
PHASE_LOOP_PROMPT="$prompt_objective_apply_stalled" \
PHASE_LOOP_TODO="$todo_objective_apply_stalled" \
PHASE_LOOP_TODO_BREAKDOWN="$todo_breakdown_objective_apply_stalled" \
BROWNIE_BIN="$fake_brownie_objective_apply_legacy_resume" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

set +e
PHASE_LOOP_STATE_DIR="$state_objective_apply_stalled" \
PHASE_LOOP_PROMPT="$prompt_objective_apply_stalled" \
PHASE_LOOP_TODO="$todo_objective_apply_stalled" \
PHASE_LOOP_TODO_BREAKDOWN="$todo_breakdown_objective_apply_stalled" \
BROWNIE_BIN="$fake_brownie_objective_apply_legacy_resume" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null
objective_apply_stalled_exit="$?"
set -e
test "$objective_apply_stalled_exit" = "76"
python3 - "$state_objective_apply_stalled/status.json" "$state_objective_apply_stalled/progress-state.json" "$state_objective_apply_stalled/todo-claims" "$state_objective_apply_stalled/todo-claims/repair-feedback.json" "$todo_objective_apply_stalled" "$todo_breakdown_objective_apply_stalled" <<'PY'
import json
import pathlib
import re
import sys

status = json.load(open(sys.argv[1], encoding="utf-8"))
progress = json.load(open(sys.argv[2], encoding="utf-8"))
claim_dir = pathlib.Path(sys.argv[3])
feedback = json.load(open(sys.argv[4], encoding="utf-8"))
todo = open(sys.argv[5], encoding="utf-8").read()
breakdown = open(sys.argv[6], encoding="utf-8").read()
archives = sorted(claim_dir.glob("stale-current-*.json"))
assert len(archives) == 1, archives
claim = json.load(open(archives[0], encoding="utf-8"))
projection = progress["progress_projection"]
assert status["status"] == "blocked", status
assert "objective_apply_stalled" in status["detail"], status
assert progress["classification"] == "terminal_failure", progress
assert progress["same_progress_count"] == 3, progress
assert projection["objective_apply_pending"] is True, projection
assert projection["objective_apply_stalled"] is True, projection
assert projection["objective_apply_terminal_failure"] is True, projection
assert projection["objective_apply_authorized"] is True, projection
assert projection["objective_apply_authorization_lost"] is False, projection
assert projection["objective_apply_continuation_id"] == "continuation-objective-apply", projection
assert claim["status"] == "in_progress", claim
assert feedback["claim_id"] == claim["claim_id"], feedback
assert re.fullmatch(r"[a-f0-9]{64}", claim["claim_snapshot_sha256"]), claim
assert claim["evaluator_selected_todo_id"].startswith("E-99-replan-stalled-leaf-"), claim
assert feedback["kind"] == "phase_loop_todo_contract_replan_feedback", feedback
assert feedback["reason"] == "supervisor_repeated_leaf_failure_requires_todo_contract_replan", feedback
assert feedback["completed"] is False, feedback
assert feedback["selected_todo_first_line"].startswith("- [ ] E-99-objective-apply:"), feedback
assert todo.startswith("- [ ] E-99-objective-apply:"), todo
assert breakdown.startswith("# queue fixture breakdown\n"), breakdown
assert "E-99-replan-stalled-leaf-" in breakdown, breakdown
PY
git -C "$queue_objective_workspace" restore --worktree -- .brownie
test_workspace="$queue_workspace"
fi

if claim_smoke_section_enabled queue-recovery; then
# The recovery half is a separate shard so the explicit 90-second CI deadline
# applies to a bounded group of queue/replan transitions.  Keep this fixture
# self-contained when selected directly.
queue_workspace="$(mktemp -d)"
git -C "$queue_workspace" init -b main >/dev/null
mkdir -p "$queue_workspace/.brownie" "$queue_workspace/scripts"
printf '%s\n' '{"name":"brownie-claim-smoke-queue-recovery-fixture","private":true,"scripts":{"guard:todo-decomposition":"node scripts/guard-todo-decomposition.mjs","phase-loop:todo-queue-integrity":"node scripts/phase-loop-todo-queue-integrity.mjs"}}' > "$queue_workspace/package.json"
printf '%s\n' '- [ ] E-99-objective-apply: Patch only `README.md` to exercise objective apply stall recovery.' > "$queue_workspace/.brownie/todo.md"
printf '# queue fixture breakdown\n' > "$queue_workspace/.brownie/todo-breakdown.md"
printf 'export const evidence = {};\n' > "$queue_workspace/scripts/release-supply-chain-artifact-evidence.mjs"
git -C "$queue_workspace" add package.json .brownie/todo.md .brownie/todo-breakdown.md scripts/release-supply-chain-artifact-evidence.mjs
git -C "$queue_workspace" -c user.name=Brownie -c user.email=brownie@example.invalid commit -m init >/dev/null
queue_original_workspace="$test_workspace"
test_workspace="$queue_workspace"

queue_prompt_with_blocked="$(mktemp)"
queue_todo_with_blocked="$(mktemp)"
printf 'base prompt\n' > "$queue_prompt_with_blocked"
printf -- '- [ ] R-09: blocked boundary task\n' > "$queue_todo_with_blocked"
queue_state_with_blocked="$(mktemp -d)"

state_all_blocked="$(mktemp -d)"
prompt_all_blocked="$(mktemp)"
todo_all_blocked="$(mktemp)"
todo_breakdown_all_blocked="$(mktemp)"
printf 'base prompt\n' > "$prompt_all_blocked"
printf -- '- [ ] E-22b-generated-leaf: Patch only `scripts/release-supply-chain-artifact-evidence.mjs` to bind one artifact evidence field:\n  Route: implementation.\n  Source TODO: E-22b.\n  Depends on: <none>.\n  Completion condition: the bounded generated leaf either updates its scoped evidence field or is redecomposed after blocking.\n  Forbidden changes: do not edit unrelated files.\n  Verification: run `pnpm --workspace-root guard:supply-chain-artifact-evidence:test`.\n' > "$todo_all_blocked"

PHASE_LOOP_STATE_DIR="$state_all_blocked" \
PHASE_LOOP_PROMPT="$prompt_all_blocked" \
PHASE_LOOP_TODO="$todo_all_blocked" \
PHASE_LOOP_TODO_BREAKDOWN="$todo_breakdown_all_blocked" \
BROWNIE_BIN="$fake_brownie_blocked_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

PHASE_LOOP_STATE_DIR="$state_all_blocked" \
PHASE_LOOP_PROMPT="$prompt_all_blocked" \
PHASE_LOOP_TODO="$todo_all_blocked" \
PHASE_LOOP_TODO_BREAKDOWN="$todo_breakdown_all_blocked" \
BROWNIE_BIN="$fake_brownie_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

python3 - "$state_all_blocked/todo-claims/current.json" "$todo_all_blocked" <<'PY'
import json
import sys

claim = json.load(open(sys.argv[1], encoding="utf-8"))
todo = open(sys.argv[2], encoding="utf-8").read()
assert claim["status"] == "in_progress", claim
assert "TODO-decompose-blocked-queue-" in claim["selected_todo"], claim
assert "Brownie must own the" in claim["selected_todo"], claim
assert "TODO-decompose-blocked-queue-" in todo, todo
assert "decomposition ledger" in todo, todo
PY

decomposition_prompt_file="$(find "$state_all_blocked/runs" -name '*.prompt.md' -print | sort | tail -n 1)"
assert_contains "$decomposition_prompt_file" 'state: `decompose_todo`'
assert_contains "$decomposition_prompt_file" 'decomposition_policy: this invocation is TODO decomposition only'
assert_contains "$decomposition_prompt_file" 'decomposition_write_policy: the only allowed workspace.write targets are the live TODO queue'
assert_contains "$decomposition_prompt_file" 'Prefer one compact `.brownie/todo.md` replacement first'
assert_contains "$decomposition_prompt_file" 'decomposition_leaf_policy: replace the active decomposition request and its broad source TODO with unchecked leaf TODOs'
assert_contains "$decomposition_prompt_file" 'decomposition_verification_policy: `Verification:` must use bounded commands'
assert_contains "$decomposition_prompt_file" 'decomposition_scope_policy: every implementation leaf must name a bounded `Patch only`/`Create only` scope'
assert_contains "$decomposition_prompt_file" 'decomposition_size_policy: keep the next workspace.write compact'
assert_contains "$decomposition_prompt_file" 'decomposition_ledger_policy: update `.brownie/todo-breakdown.md`'
assert_contains "$decomposition_prompt_file" 'let the guard request the breakdown repair next'

state_decomposition_leaf="$(mktemp -d)"
prompt_decomposition_leaf="$(mktemp)"
todo_decomposition_leaf="$(mktemp)"
mkdir -p "$test_workspace/scripts"
printf 'export const evidence = {};\n' > "$test_workspace/scripts/release-supply-chain-artifact-evidence.mjs"
printf 'base prompt\n' > "$prompt_decomposition_leaf"
printf -- '- [ ] E-15b-provenance-collector-a: Patch only `scripts/release-supply-chain-artifact-evidence.mjs` to record one clean current source commit:\n  Route: implementation.\n  Source TODO: TODO-decompose-blocked-queue-71820ffb9fb9: Decompose the currently blocked Product Ready TODO queue into implementable leaf TODOs:\n  Depends on: <none>.\n  Completion condition: the bounded collector path records source commit evidence.\n  Forbidden changes: do not edit unrelated files.\n  Verification: run `pnpm --workspace-root guard:supply-chain-artifact-evidence:test`.\n' > "$todo_decomposition_leaf"

PHASE_LOOP_STATE_DIR="$state_decomposition_leaf" \
PHASE_LOOP_PROMPT="$prompt_decomposition_leaf" \
PHASE_LOOP_TODO="$todo_decomposition_leaf" \
BROWNIE_BIN="$fake_brownie_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

decomposition_leaf_prompt_file="$(find "$state_decomposition_leaf/runs" -name '*.prompt.md' -print | sort | tail -n 1)"
assert_contains "$decomposition_leaf_prompt_file" 'state: `implement`'
assert_not_contains "$decomposition_leaf_prompt_file" 'state: `decompose_todo`'
assert_not_contains "$decomposition_leaf_prompt_file" 'decomposition_policy: this invocation is TODO decomposition only'

state_blocked_decomposition="$(mktemp -d)"
prompt_blocked_decomposition="$(mktemp)"
todo_blocked_decomposition="$(mktemp)"
todo_breakdown_blocked_decomposition="$(mktemp)"
printf 'base prompt\n' > "$prompt_blocked_decomposition"
printf -- '- [ ] E-22b-generated-leaf: Patch only `scripts/release-supply-chain-artifact-evidence.mjs` to bind one artifact evidence field:\n  Route: implementation.\n  Source TODO: E-22b.\n  Depends on: <none>.\n  Completion condition: the bounded generated leaf either updates its scoped evidence field or is redecomposed after blocking.\n  Forbidden changes: do not edit unrelated files.\n  Verification: run `pnpm --workspace-root guard:supply-chain-artifact-evidence:test`.\n' > "$todo_blocked_decomposition"

PHASE_LOOP_STATE_DIR="$state_blocked_decomposition" \
PHASE_LOOP_PROMPT="$prompt_blocked_decomposition" \
PHASE_LOOP_TODO="$todo_blocked_decomposition" \
PHASE_LOOP_TODO_BREAKDOWN="$todo_breakdown_blocked_decomposition" \
BROWNIE_BIN="$fake_brownie_blocked_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

PHASE_LOOP_STATE_DIR="$state_blocked_decomposition" \
PHASE_LOOP_PROMPT="$prompt_blocked_decomposition" \
PHASE_LOOP_TODO="$todo_blocked_decomposition" \
PHASE_LOOP_TODO_BREAKDOWN="$todo_breakdown_blocked_decomposition" \
BROWNIE_BIN="$fake_brownie_blocked_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

set +e
PHASE_LOOP_STATE_DIR="$state_blocked_decomposition" \
PHASE_LOOP_PROMPT="$prompt_blocked_decomposition" \
PHASE_LOOP_TODO="$todo_blocked_decomposition" \
PHASE_LOOP_TODO_BREAKDOWN="$todo_breakdown_blocked_decomposition" \
BROWNIE_BIN="$fake_brownie_blocked_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null
blocked_decomposition_exit="$?"
set -e
test "$blocked_decomposition_exit" = "75"

python3 - "$todo_blocked_decomposition" "$state_blocked_decomposition/status.json" <<'PY'
import json
import re
import sys

todo = open(sys.argv[1], encoding="utf-8").read()
status = json.load(open(sys.argv[2], encoding="utf-8"))
decomposition_items = re.findall(r"TODO-decompose-blocked-queue-", todo)
assert len(decomposition_items) == 1, todo
assert status["status"] == "blocked", status
assert "Failed to claim first pending TODO" in status["detail"], status
PY

# A stale child may retain the generated recovery id in its Source TODO
# provenance after the request itself was removed.  That text must not make
# the controller believe the request is still queued.
state_orphaned_request="$(mktemp -d)"
prompt_orphaned_request="$(mktemp)"
todo_orphaned_request="$(mktemp)"
todo_breakdown_orphaned_request="$(mktemp)"
printf 'base prompt\n' > "$prompt_orphaned_request"
# Keep the stalled source block byte-for-byte stable.  A separate descendant
# carries the historical recovery id in provenance, which is the real
# interrupted-decomposition shape this regression protects.
historical_id="TODO-decompose-blocked-queue-stalled-deadbeefcafe"
printf -- '- [ ] E-22b-generated-leaf: Patch only `scripts/release-supply-chain-artifact-evidence.mjs` to bind one artifact evidence field:\n  Route: implementation.\n  Depends on: <none>.\n  Completion condition: the bounded generated leaf is recovered through a fresh decomposition request.\n  Forbidden changes: do not edit unrelated files.\n  Verification: run `pnpm --workspace-root guard:supply-chain-artifact-evidence:test`.\n\n- [ ] E-22b-generated-child: Keep provenance for the interrupted decomposition:\n  Route: implementation.\n  Source TODO: '"$historical_id"'.\n  Depends on: E-22b-generated-leaf.\n  Completion condition: provenance remains historical only.\n  Forbidden changes: do not edit unrelated files.\n  Verification: run `pnpm --workspace-root guard:supply-chain-artifact-evidence:test`.\n' > "$todo_orphaned_request"
orphan_id="$(python3 - "$todo_orphaned_request" <<'PY'
import hashlib
import pathlib
import sys

todo = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
print("TODO-decompose-blocked-queue-stalled-" + hashlib.sha256(todo.split("\n\n", 1)[0].encode("utf-8")).hexdigest()[:12])
PY
)"
mkdir -p "$state_orphaned_request/todo-claims"
python3 - "$todo_orphaned_request" "$state_orphaned_request/todo-claims/blocked.jsonl" <<'PY'
import hashlib
import json
import pathlib
import sys

todo = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
first_line = todo.splitlines()[0]
pathlib.Path(sys.argv[2]).write_text(json.dumps({
    "block_reason": "stalled_leaf_contract_replan",
    "selected_todo_first_line": first_line,
    "selected_todo_sha256": hashlib.sha256(todo.strip().encode("utf-8")).hexdigest(),
    "todo_id": "E-22b-generated-leaf",
}) + "\n", encoding="utf-8")
PY

PHASE_LOOP_STATE_DIR="$state_orphaned_request" \
PHASE_LOOP_PROMPT="$prompt_orphaned_request" \
PHASE_LOOP_TODO="$todo_orphaned_request" \
PHASE_LOOP_TODO_BREAKDOWN="$todo_breakdown_orphaned_request" \
BROWNIE_BIN="$fake_brownie_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

python3 - "$state_orphaned_request/todo-claims/current.json" "$todo_orphaned_request" "$orphan_id" "$historical_id" <<'PY'
import json
import re
import sys

claim = json.load(open(sys.argv[1], encoding="utf-8"))
todo = open(sys.argv[2], encoding="utf-8").read()
orphan_id = sys.argv[3]
historical_id = sys.argv[4]
assert claim["status"] == "in_progress", claim
selected = claim["selected_todo"]
match = re.match(r"- \[ \] (TODO-decompose-blocked-queue(?:-stalled)?-[0-9a-f]{12}):", selected)
assert match, claim
# The stale Source TODO id remains provenance only.  Recovery must enqueue and
# claim the id derived from the unchanged stalled source block instead.
assert match.group(1) == orphan_id, claim
assert match.group(1) != historical_id, claim
assert selected in todo, todo
assert f"Source TODO: {historical_id}." in todo, todo
PY

printf -- '- [ ] R-09: blocked boundary task\n  Extra context that changes the queue fingerprint.\n- [ ] R-10: next unblocked task\n' > "$queue_todo_with_blocked"

PHASE_LOOP_STATE_DIR="$queue_state_with_blocked" \
PHASE_LOOP_PROMPT="$queue_prompt_with_blocked" \
PHASE_LOOP_TODO="$queue_todo_with_blocked" \
BROWNIE_BIN="$fake_brownie_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

python3 - "$queue_state_with_blocked/todo-claims/current.json" <<'PY'
import json
import sys

claim = json.load(open(sys.argv[1], encoding="utf-8"))
assert claim["status"] == "in_progress", claim
assert claim["selected_todo"].startswith("- [ ] R-09: blocked boundary task"), claim
PY
fi

if claim_smoke_section_enabled queue-integrity; then
# Keep the dependency, blocker, durable-claim, and stagnation checks in their
# own low-CPU shard so each explicit 90-second deadline covers bounded work.
queue_workspace="$(mktemp -d)"
git -C "$queue_workspace" init -b main >/dev/null
mkdir -p "$queue_workspace/.brownie" "$queue_workspace/scripts"
printf '%s\n' '{"name":"brownie-claim-smoke-queue-integrity-fixture","private":true,"scripts":{"guard:todo-decomposition":"node scripts/guard-todo-decomposition.mjs","phase-loop:todo-queue-integrity":"node scripts/phase-loop-todo-queue-integrity.mjs"}}' > "$queue_workspace/package.json"
printf '%s\n' '- [ ] E-99-objective-apply: Patch only `README.md` to exercise objective apply stall recovery.' > "$queue_workspace/.brownie/todo.md"
printf '# queue fixture breakdown\n' > "$queue_workspace/.brownie/todo-breakdown.md"
printf 'export const evidence = {};\n' > "$queue_workspace/scripts/release-supply-chain-artifact-evidence.mjs"
git -C "$queue_workspace" add package.json .brownie/todo.md .brownie/todo-breakdown.md scripts/release-supply-chain-artifact-evidence.mjs
git -C "$queue_workspace" -c user.name=Brownie -c user.email=brownie@example.invalid commit -m init >/dev/null
queue_original_workspace="$test_workspace"
test_workspace="$queue_workspace"

state_dependency="$(mktemp -d)"
prompt_dependency="$(mktemp)"
todo_dependency="$(mktemp)"
printf 'base prompt\n' > "$prompt_dependency"
printf -- '- [ ] E-15-child: Patch only `scripts/child.mjs`:\n  Route: implementation.\n  Source TODO: E-15.\n  Depends on: E-15-parent.\n  Completion condition: the child change is implemented after the parent is done.\n  Forbidden changes: do not edit unrelated files.\n  Verification: run `pnpm --workspace-root check`.\n- [ ] E-15-parent: Patch only `scripts/parent.mjs`:\n  Route: implementation.\n  Source TODO: E-15.\n  Depends on: <none>.\n  Completion condition: the parent change is implemented before child work starts.\n  Forbidden changes: do not edit unrelated files.\n  Verification: run `pnpm --workspace-root check`.\n' > "$todo_dependency"

PHASE_LOOP_STATE_DIR="$state_dependency" \
PHASE_LOOP_PROMPT="$prompt_dependency" \
PHASE_LOOP_TODO="$todo_dependency" \
BROWNIE_BIN="$fake_brownie_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

dependency_prompt_file="$(find "$state_dependency/runs" -name '*.prompt.md' -print | sort | tail -n 1)"
assert_contains "$dependency_prompt_file" 'dependency_policy: do not work on a TODO whose `Depends on:` entries are still pending'
assert_contains "$dependency_prompt_file" 'implementation_preflight_policy: before any workspace.write'

python3 - "$state_dependency/todo-claims/current.json" <<'PY'
import json
import sys

claim = json.load(open(sys.argv[1], encoding="utf-8"))
assert claim["status"] == "in_progress", claim
assert claim["selected_todo"].startswith("- [ ] E-15-parent:"), claim
PY

state_explicit_blocker="$(mktemp -d)"
prompt_explicit_blocker="$(mktemp)"
todo_explicit_blocker="$(mktemp)"
printf 'base prompt\n' > "$prompt_explicit_blocker"
cat > "$todo_explicit_blocker" <<'EOF'
- [ ] E-15e-doc-sync-blocker: Blocker: missing owner-controlled independent review evidence for Release workflow, permission model, Ledger Contract, Mode Pack trust boundary, signing/provenance, and Release Ready判定ロジック.
  Route: documentation.
  Depends on: E-15e-release-contract-audit-phase-resync-doc-sync-leaf.
  Completion condition: all six independent human reviews are completed and recorded.
  Forbidden changes: do not patch runtime-release-contract.json until all reviews are complete.
  Verification: blocker: exact missing evidence or field is named, and no workspace file is patched until that evidence is available.

- [ ] E-15f-next: Patch only `scripts/guard-release-contract.mjs`:
  Route: implementation.
  Source TODO: E-15f.
  Depends on: <none>.
  Completion condition: the next TODO remains schedulable after the blocker is recorded.
  Forbidden changes: do not edit unrelated files.
  Verification: run `pnpm --workspace-root guard:release-contract:test`.
EOF

PHASE_LOOP_STATE_DIR="$state_explicit_blocker" \
PHASE_LOOP_PROMPT="$prompt_explicit_blocker" \
PHASE_LOOP_TODO="$todo_explicit_blocker" \
BROWNIE_BIN="$fake_brownie_must_not_run" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

python3 - "$state_explicit_blocker/status.json" "$state_explicit_blocker/todo-claims/current.json" "$state_explicit_blocker/todo-claims/blocked.jsonl" "$state_explicit_blocker/bdk-harness-feedback.json" "$state_explicit_blocker/trajectories" <<'PY'
import json
import pathlib
import sys

status = json.load(open(sys.argv[1], encoding="utf-8"))
claim = json.load(open(sys.argv[2], encoding="utf-8"))
blocked = pathlib.Path(sys.argv[3]).read_text(encoding="utf-8")
feedback = json.load(open(sys.argv[4], encoding="utf-8"))
trajectory_dir = pathlib.Path(sys.argv[5])
events = []
for trajectory_path in trajectory_dir.glob("*.jsonl"):
    for line in trajectory_path.read_text(encoding="utf-8").splitlines():
        record = json.loads(line)
        if record.get("claim_id") == claim["claim_id"]:
            events.extend(record.get("events", []))
types = [event["type"] for event in events]
assert status["status"] == "blocked_todo_recorded", status
assert status["exit_code"] == "0", status
assert "explicit owner/release blocker" in status["detail"], status
assert claim["status"] == "blocked", claim
assert claim["selected_todo"].startswith("- [ ] E-15e-doc-sync-blocker:"), claim
assert "E-15e-doc-sync-blocker" in blocked, blocked
assert feedback["ok"] is True, feedback
assert feedback["terminal_event_count"] == 1, feedback
assert types == ["todo.claimed", "workflow.routed", "skill.selected", "todo.blocked"], types
assert events[-1]["payload"]["owner_blocked"] is True, events[-1]
PY

PHASE_LOOP_STATE_DIR="$state_explicit_blocker" \
PHASE_LOOP_PROMPT="$prompt_explicit_blocker" \
PHASE_LOOP_TODO="$todo_explicit_blocker" \
BROWNIE_BIN="$fake_brownie_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

python3 - "$state_explicit_blocker/todo-claims/current.json" <<'PY'
import json
import sys

claim = json.load(open(sys.argv[1], encoding="utf-8"))
assert claim["status"] == "in_progress", claim
assert claim["selected_todo"].startswith("- [ ] E-15f-next:"), claim
PY

# Keep the live queue contract stable while exercising durable claim reuse;
# removing the selected TODO without a completion record must remain fail-closed.

queue_state_with_claim="$(mktemp -d)"
queue_prompt_with_claim="$(mktemp)"
queue_todo_with_claim="$(mktemp)"
printf 'base prompt\n' > "$queue_prompt_with_claim"
printf -- '- [ ] B-01: durable claim task\n  with detail\n  Files: \`scripts/release-runtime-operational-evidence.mjs\`, \`docs/architecture/local-release-targets.example.json\`.\n- [ ] B-02: next task\n' > "$queue_todo_with_claim"

PHASE_LOOP_STATE_DIR="$queue_state_with_claim" \
PHASE_LOOP_PROMPT="$queue_prompt_with_claim" \
PHASE_LOOP_TODO="$queue_todo_with_claim" \
BROWNIE_BIN="$fake_brownie_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

queue_claim_file="$queue_state_with_claim/todo-claims/current.json"
queue_prompt_file="$(find "$queue_state_with_claim/runs" -name '*.prompt.md' -print | sort | tail -n 1)"
python3 - "$queue_claim_file" <<'PY'
import json
import sys

claim = json.load(open(sys.argv[1], encoding="utf-8"))
assert claim["status"] == "in_progress", claim
assert claim["selected_todo"].startswith("- [ ] B-01: durable claim task"), claim
assert len(claim["status_history"]) >= 2, claim
PY
assert_contains "$queue_prompt_file" '## Active TODO Claim'
assert_contains "$queue_prompt_file" 'queue_generation'
assert_contains "$queue_prompt_file" 'B-01: durable claim task'

state_stagnation="$(mktemp -d)"
prompt_stagnation="$(mktemp)"
queue_stagnation_workspace="$(mktemp -d)"
git -C "$queue_stagnation_workspace" init -b main >/dev/null
mkdir -p "$queue_stagnation_workspace/.brownie"
printf '%s\n' '{"name":"brownie-claim-smoke-stagnation-fixture","private":true,"scripts":{"guard:todo-decomposition":"node scripts/guard-todo-decomposition.mjs","phase-loop:todo-queue-integrity":"node scripts/phase-loop-todo-queue-integrity.mjs"}}' > "$queue_stagnation_workspace/package.json"
printf '%s\n' '- [ ] B-01: stagnant task' > "$queue_stagnation_workspace/.brownie/todo.md"
printf '# queue fixture breakdown\n' > "$queue_stagnation_workspace/.brownie/todo-breakdown.md"
git -C "$queue_stagnation_workspace" add package.json .brownie/todo.md .brownie/todo-breakdown.md
git -C "$queue_stagnation_workspace" -c user.name=Brownie -c user.email=brownie@example.invalid commit -m init >/dev/null
todo_stagnation="$queue_stagnation_workspace/.brownie/todo.md"
todo_breakdown_stagnation="$queue_stagnation_workspace/.brownie/todo-breakdown.md"
printf 'base prompt\n' > "$prompt_stagnation"
printf -- '- [ ] B-01: stagnant task\n' > "$todo_stagnation"
test_workspace="$queue_stagnation_workspace"

PHASE_LOOP_STATE_DIR="$state_stagnation" \
PHASE_LOOP_PROMPT="$prompt_stagnation" \
PHASE_LOOP_TODO="$todo_stagnation" \
PHASE_LOOP_TODO_BREAKDOWN="$todo_breakdown_stagnation" \
BROWNIE_BIN="$fake_brownie_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

PHASE_LOOP_STATE_DIR="$state_stagnation" \
PHASE_LOOP_PROMPT="$prompt_stagnation" \
PHASE_LOOP_TODO="$todo_stagnation" \
PHASE_LOOP_TODO_BREAKDOWN="$todo_breakdown_stagnation" \
BROWNIE_BIN="$fake_brownie_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

if PHASE_LOOP_STATE_DIR="$state_stagnation" \
  PHASE_LOOP_PROMPT="$prompt_stagnation" \
  PHASE_LOOP_TODO="$todo_stagnation" \
  PHASE_LOOP_TODO_BREAKDOWN="$todo_breakdown_stagnation" \
  BROWNIE_BIN="$fake_brownie_json" \
  PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
  run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null; then
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
python3 - "$state_stagnation/bdk-harness-feedback.json" "$state_stagnation/trajectories" <<'PY'
import json
import pathlib
import sys

feedback = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
trajectory_dir = pathlib.Path(sys.argv[2])
latest = sorted(trajectory_dir.glob("*.jsonl"))[-1]
records = [json.loads(line) for line in latest.read_text(encoding="utf-8").splitlines() if line.strip()]
events = [event for record in records for event in record.get("events", [])]
assert feedback["ok"] is True, feedback
assert feedback["terminal_event_count"] == 1, feedback
assert any(event.get("type") == "todo.replanned" for event in events), events
assert all(".brownie/private/" not in json.dumps(event.get("payload", {})) for event in events), events
PY
git -C "$queue_stagnation_workspace" restore --worktree -- .brownie
test_workspace="$queue_workspace"

state_todo_md_only="$(mktemp -d)"
prompt_todo_md_only="$(mktemp)"
todo_todo_md_only="$(mktemp)"
workspace_todo_md_only="$(mktemp -d)"
git -C "$workspace_todo_md_only" init -b main >/dev/null
mkdir -p "$workspace_todo_md_only/.brownie"
# The second invocation deliberately exercises terminal recovery.  Keep this
# fixture small, but give the recovery path the same package-script contract
# it uses in a real workspace; otherwise an ENOENT from pnpm masks the
# terminal classification being tested.
printf '%s\n' '{"name":"brownie-claim-smoke-todo-md-only-fixture","private":true,"scripts":{"guard:todo-decomposition":"true","phase-loop:todo-queue-integrity":"true"}}' > "$workspace_todo_md_only/package.json"
printf '# queue fixture breakdown\n' > "$workspace_todo_md_only/.brownie/todo-breakdown.md"
git -C "$workspace_todo_md_only" add package.json .brownie/todo-breakdown.md
git -C "$workspace_todo_md_only" -c user.name=Brownie -c user.email=brownie@example.invalid commit -m init >/dev/null
printf 'base prompt\n' > "$prompt_todo_md_only"
printf -- '- [ ] E-08b-next: Finish E-08b after read-budget exhaustion:\n  Source TODO: E-08b: Fail closed on supply-chain scan and network failures.\n' > "$todo_todo_md_only"

PHASE_LOOP_STATE_DIR="$state_todo_md_only" \
PHASE_LOOP_PROMPT="$prompt_todo_md_only" \
PHASE_LOOP_TODO="$todo_todo_md_only" \
BROWNIE_BIN="$fake_brownie_todo_md_only_apply" \
PHASE_LOOP_WORKSPACE_ROOT="$workspace_todo_md_only" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

python3 - "$state_todo_md_only/status.json" "$state_todo_md_only/progress-state.json" "$state_todo_md_only/todo-claims/current.json" "$todo_todo_md_only" <<'PY'
import json
import sys

status = json.load(open(sys.argv[1], encoding="utf-8"))
progress = json.load(open(sys.argv[2], encoding="utf-8"))
claim = json.load(open(sys.argv[3], encoding="utf-8"))
todo = open(sys.argv[4], encoding="utf-8").read()
projection = progress["progress_projection"]
assert status["status"] == "non_progress_success", status
assert progress["classification"] == "non_progress_success", progress
assert progress["meaningful_progress"] is False, progress
assert projection["todo_md_only_apply_blocked_as_progress"] is True, projection
assert projection["selected_todo_first_line_still_pending_after_todo_md_apply"] is True, projection
assert claim["status"] == "in_progress", claim
assert "E-08b-next" in todo, todo
PY

set +e
PHASE_LOOP_STATE_DIR="$state_todo_md_only" \
PHASE_LOOP_PROMPT="$prompt_todo_md_only" \
PHASE_LOOP_TODO="$todo_todo_md_only" \
BROWNIE_BIN="$fake_brownie_no_actionable" \
PHASE_LOOP_WORKSPACE_ROOT="$workspace_todo_md_only" \
PHASE_LOOP_TERMINAL_FAILURE_RETRY_CAP=0 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 76 "$PHASE_LOOP" run-once >/dev/null
todo_md_only_terminal_exit="$?"
set -e
test "$todo_md_only_terminal_exit" = "76"

python3 - "$state_todo_md_only/status.json" "$state_todo_md_only/progress-state.json" "$state_todo_md_only/todo-claims/current.json" "$todo_todo_md_only" <<'PY'
import json
import sys

status = json.load(open(sys.argv[1], encoding="utf-8"))
progress = json.load(open(sys.argv[2], encoding="utf-8"))
claim = json.load(open(sys.argv[3], encoding="utf-8"))
todo = open(sys.argv[4], encoding="utf-8").read()
projection = progress["progress_projection"]
assert status["status"] == "blocked", status
assert status["exit_code"] == "76", status
assert "without current-run task execution evidence" in status["detail"], status
assert progress["classification"] == "terminal_failure", progress
assert progress["meaningful_progress"] is False, progress
assert projection["completed_by_no_actionable_after_apply"] is False, projection
assert claim["status"] == "in_progress", claim
assert "E-08b-next" in todo, todo
PY

# A proposal applied to a product target does not make the selected queue item
# complete. If the next resume reports zero candidates, the controller must
# retain the TODO and route the no-execution result through terminal recovery
# instead of inheriting the previous apply as a completion signal.
state_non_todo_no_eligible="$(mktemp -d)"
prompt_non_todo_no_eligible="$(mktemp)"
todo_non_todo_no_eligible="$(mktemp)"
workspace_non_todo_no_eligible="$(mktemp -d)"
git -C "$workspace_non_todo_no_eligible" init -b main >/dev/null
mkdir -p "$workspace_non_todo_no_eligible/.brownie"
printf '%s\n' '{"name":"brownie-claim-smoke-non-todo-no-eligible-fixture","private":true,"scripts":{"guard:todo-decomposition":"true","phase-loop:todo-queue-integrity":"true"}}' > "$workspace_non_todo_no_eligible/package.json"
printf '# queue fixture breakdown\n' > "$workspace_non_todo_no_eligible/.brownie/todo-breakdown.md"
: > "$workspace_non_todo_no_eligible/phase-loop-smoke-non-todo.txt"
git -C "$workspace_non_todo_no_eligible" add package.json .brownie/todo-breakdown.md phase-loop-smoke-non-todo.txt
git -C "$workspace_non_todo_no_eligible" -c user.name=Brownie -c user.email=brownie@example.invalid commit -m init >/dev/null
printf 'base prompt\n' > "$prompt_non_todo_no_eligible"
printf -- '- [ ] E-08c-next: Preserve this implementation TODO until Runtime proves completion:\n  Route: implementation.\n  Completion condition: a current Runtime task execution proves the selected work complete.\n  Forbidden changes: do not infer completion from a prior objective proposal.\n  Verification: inspect terminal recovery evidence.\n' > "$todo_non_todo_no_eligible"

PHASE_LOOP_STATE_DIR="$state_non_todo_no_eligible" \
PHASE_LOOP_PROMPT="$prompt_non_todo_no_eligible" \
PHASE_LOOP_TODO="$todo_non_todo_no_eligible" \
BROWNIE_BIN="$fake_brownie_todo_md_only_apply" \
PHASE_LOOP_TEST_OBJECTIVE_APPLY_PATH="phase-loop-smoke-non-todo.txt" \
PHASE_LOOP_WORKSPACE_ROOT="$workspace_non_todo_no_eligible" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

PHASE_LOOP_STATE_DIR="$state_non_todo_no_eligible" \
PHASE_LOOP_PROMPT="$prompt_non_todo_no_eligible" \
PHASE_LOOP_TODO="$todo_non_todo_no_eligible" \
BROWNIE_BIN="$fake_brownie_no_actionable" \
PHASE_LOOP_WORKSPACE_ROOT="$workspace_non_todo_no_eligible" \
PHASE_LOOP_TERMINAL_FAILURE_RETRY_CAP=0 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

python3 - "$state_non_todo_no_eligible/status.json" "$state_non_todo_no_eligible/todo-claims/current.json" "$state_non_todo_no_eligible/todo-claims/blocked.jsonl" "$todo_non_todo_no_eligible" "$state_non_todo_no_eligible/bdk-harness-feedback.json" "$state_non_todo_no_eligible/trajectories" <<'PY'
import json
import pathlib
import sys

status = json.load(open(sys.argv[1], encoding="utf-8"))
claim = json.load(open(sys.argv[2], encoding="utf-8"))
blocked = pathlib.Path(sys.argv[3]).read_text(encoding="utf-8")
todo = open(sys.argv[4], encoding="utf-8").read()
feedback = json.load(open(sys.argv[5], encoding="utf-8"))
events = []
for trajectory_path in pathlib.Path(sys.argv[6]).glob("*.jsonl"):
    for line in trajectory_path.read_text(encoding="utf-8").splitlines():
        record = json.loads(line)
        if record.get("claim_id") == claim["claim_id"]:
            events.extend(record.get("events", []))
types = [event["type"] for event in events]
assert status["status"] == "blocked_todo_recorded", status
assert status["exit_code"] == "0", status
assert claim["status"] == "blocked", claim
assert claim["selected_todo"].startswith("- [ ] E-08c-next-blocker:"), claim
assert "E-08c-next-blocker" in blocked, blocked
assert "- [ ] E-08c-next-blocker:" in todo, todo
assert "Source TODO: E-08c-next." in todo, todo
assert "- [ ] E-08c-next:" not in todo, todo
assert feedback["ok"] is True, feedback
assert feedback["terminal_event_count"] == 1, feedback
assert types == ["todo.claimed", "workflow.routed", "skill.selected", "todo.blocked"], types
assert events[-1]["payload"]["owner_blocked"] is True, events[-1]
assert "todo.completed" not in types, types
PY

state_workspace_progress="$(mktemp -d)"
prompt_workspace_progress="$(mktemp)"
todo_workspace_progress="$(mktemp)"
workspace_progress="$(mktemp -d)"
git -C "$workspace_progress" init -b main >/dev/null
mkdir -p "$workspace_progress/.brownie" "$workspace_progress/scripts"
printf '%s\n' '{"name":"brownie-claim-smoke-workspace-progress-fixture","private":true,"scripts":{"guard:todo-decomposition":"node scripts/guard-todo-decomposition.mjs","phase-loop:todo-queue-integrity":"node scripts/phase-loop-todo-queue-integrity.mjs"}}' > "$workspace_progress/package.json"
: > "$workspace_progress/phase-loop-smoke-progress.txt"
printf '# queue fixture breakdown\n' > "$workspace_progress/.brownie/todo-breakdown.md"
printf 'export const evidence = {};\n' > "$workspace_progress/scripts/release-supply-chain-artifact-evidence.mjs"
git -C "$workspace_progress" add package.json phase-loop-smoke-progress.txt .brownie/todo-breakdown.md scripts/release-supply-chain-artifact-evidence.mjs
git -C "$workspace_progress" -c user.name=Brownie -c user.email=brownie@example.invalid commit -m init >/dev/null
printf 'base prompt\n' > "$prompt_workspace_progress"
printf -- '- [ ] B-01: Patch only `phase-loop-smoke-progress.txt` to exercise workspace progress detection.\n  Route: implementation.\n  Completion condition: the fixture writes the expected workspace progress marker.\n  Forbidden changes: do not weaken actor or delivery guards.\n  Verification: inspect/blocker/fail-closed.\n' > "$todo_workspace_progress"

PHASE_LOOP_STATE_DIR="$state_workspace_progress" \
PHASE_LOOP_PROMPT="$prompt_workspace_progress" \
PHASE_LOOP_TODO="$todo_workspace_progress" \
BROWNIE_BIN="$fake_brownie_workspace_change" \
PHASE_LOOP_WORKSPACE_ROOT="$workspace_progress" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

python3 - "$state_workspace_progress/progress-state.json" <<'PY'
import json
import sys

progress = json.load(open(sys.argv[1], encoding="utf-8"))
assert progress["classification"] == "progress", progress
assert progress["meaningful_progress"] is True, progress
assert progress["workspace_changed"] is True, progress
PY
test_workspace="$queue_original_workspace"
fi

if claim_smoke_section_enabled pr; then
# Keep the pre-claim delivery boundary independently covered: a separated
# controller-root fixture with only dirty scripts and no implementable TODO
# must be rejected, while the same fixture becomes admissible once an
# implementation TODO is present. This exercises the boundary directly
# without weakening production dirty-delivery policy.
preclaim_delivery_workspace="$(mktemp -d)"
preclaim_delivery_todo="$(mktemp)"
preclaim_delivery_breakdown="$(mktemp)"
git -C "$preclaim_delivery_workspace" init -b main >/dev/null
mkdir -p "$preclaim_delivery_workspace/scripts"
cp "$REPO_ROOT/scripts/phase-loop-pr-actor-guard.mjs" "$preclaim_delivery_workspace/scripts/phase-loop-pr-actor-guard.mjs"
printf 'base\n' > "$preclaim_delivery_workspace/README.md"
git -C "$preclaim_delivery_workspace" add .
git -C "$preclaim_delivery_workspace" -c user.name=Brownie -c user.email=brownie@example.invalid commit -m init >/dev/null
printf '# breakdown\n' > "$preclaim_delivery_breakdown"
printf -- '- [ ] B-ops: Blocker: owner delivery evidence is required before release completion.\n  Route: release-ops.\n  Completion condition: the owner supplies the delivery evidence.\n  Verification: inspect/blocker/fail-closed.\n' > "$preclaim_delivery_todo"
printf 'fixture-only dirty script\n' >> "$preclaim_delivery_workspace/scripts/phase-loop-pr-actor-guard.mjs"
set +e
preclaim_dirty_output="$(PHASE_LOOP_CLAIM_SMOKE_TEST_ONLY=1 node "$REPO_ROOT/scripts/phase-loop-preflight.mjs" \
  --repo "$preclaim_delivery_workspace" \
  --todo "$preclaim_delivery_todo" \
  --breakdown "$preclaim_delivery_breakdown" \
  --control-plane-root "$REPO_ROOT" \
  --expected-actor "$PHASE_LOOP_TEST_IMPLEMENTATION_ACTOR" \
  --profile claim-smoke-fixture \
  --stage pre-claim-boundary 2>&1)"
preclaim_dirty_status="$?"
set -e
test "$preclaim_dirty_status" -ne 0
python3 - "$preclaim_dirty_output" <<'PY'
import json
import sys

result = json.loads(sys.argv[1])
assert result["valid"] is False, result
errors = result["errors"]
assert any(error["code"] == "dirty_delivery_required" for error in errors), result
assert any("scripts/" in file for error in errors for file in error.get("dirty_files", [])), result
PY

printf -- '- [ ] B-impl: Patch only `README.md` to prove the separated control-root pre-claim path.\n  Route: implementation.\n  Completion condition: the README change is delivered through the trusted controller path.\n  Forbidden changes: do not weaken actor or delivery guards.\n  Verification: run `node --check scripts/phase-loop-pr-actor-guard.mjs`.\n' > "$preclaim_delivery_todo"
PHASE_LOOP_CLAIM_SMOKE_TEST_ONLY=1 node "$REPO_ROOT/scripts/phase-loop-preflight.mjs" \
  --repo "$preclaim_delivery_workspace" \
  --todo "$preclaim_delivery_todo" \
  --breakdown "$preclaim_delivery_breakdown" \
  --control-plane-root "$REPO_ROOT" \
  --expected-actor "$PHASE_LOOP_TEST_IMPLEMENTATION_ACTOR" \
  --profile claim-smoke-fixture \
  --stage pre-claim-boundary >/dev/null

state_pr_progress="$(mktemp -d)"
prompt_pr_progress="$(mktemp)"
todo_pr_progress="$(mktemp)"
workspace_pr_progress="$(mktemp -d)"
remote_pr_progress="$(mktemp -d)"
fake_bin_dir="$(mktemp -d)"
git -C "$workspace_pr_progress" init -b main >/dev/null
mkdir -p "$workspace_pr_progress/scripts"
cp "$REPO_ROOT/scripts/phase-loop-pr-actor-guard.mjs" "$workspace_pr_progress/scripts/phase-loop-pr-actor-guard.mjs"
printf 'base\n' > "$workspace_pr_progress/README.md"
git -C "$workspace_pr_progress" add README.md
git -C "$workspace_pr_progress" -c user.name=Brownie -c user.email=brownie@example.invalid commit -m init >/dev/null
git -C "$remote_pr_progress" init --bare >/dev/null
git -C "$workspace_pr_progress" remote add origin "$remote_pr_progress"
git -C "$workspace_pr_progress" push -u origin main >/dev/null
git -C "$workspace_pr_progress" switch -c "${PHASE_LOOP_TEST_IMPLEMENTATION_BRANCH_PREFIX}smoke-pr" >/dev/null
phase_loop_prepare_pr_fixture_workspace "$workspace_pr_progress" "$remote_pr_progress"
test -z "$(git -C "$workspace_pr_progress" status --porcelain)"
printf 'base prompt\n' > "$prompt_pr_progress"
printf -- '- [ ] B-01: Patch only `README.md` to create a PR from tracked Brownie progress.\n  Route: implementation.\n  Completion condition: the tracked README change is committed and published through the fixture PR path.\n  Forbidden changes: do not weaken actor or delivery guards.\n  Verification: run `node --check scripts/phase-loop-pr-actor-guard.mjs`.\n' > "$todo_pr_progress"
cat > "$fake_bin_dir/pnpm" <<'SH'
#!/usr/bin/env bash
exit 0
SH
chmod +x "$fake_bin_dir/pnpm"
cat > "$fake_bin_dir/gh" <<'SH'
#!/usr/bin/env bash
set -eu
case "${1:-} ${2:-}" in
  "api user")
    printf '%s\n' "${PHASE_LOOP_TEST_IMPLEMENTATION_ACTOR:?}"
    ;;
  "auth token")
    printf 'fake-token\n'
    ;;
  "pr view")
    exit 1
    ;;
  "pr create")
    printf 'https://github.com/%s/pull/9999\n' "${PHASE_LOOP_TEST_REPOSITORY:?}"
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
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

python3 - "$state_pr_progress/status.json" "$workspace_pr_progress" "$todo_pr_progress" <<'PY'
import json
import os
import subprocess
import sys

status = json.load(open(sys.argv[1], encoding="utf-8"))
workspace = sys.argv[2]
todo = open(sys.argv[3], encoding="utf-8").read()
assert status["status"] == "pr_created", status
assert "pull/9999" in status["detail"], status
head = subprocess.check_output(["git", "-C", workspace, "rev-parse", "HEAD"], text=True).strip()
remote = subprocess.check_output(["git", "-C", workspace, "rev-parse", f"fixture-origin/{os.environ['PHASE_LOOP_TEST_IMPLEMENTATION_BRANCH_PREFIX']}smoke-pr"], text=True).strip()
assert head == remote, (head, remote)
message = subprocess.check_output(["git", "-C", workspace, "log", "-1", "--format=%s"], text=True).strip()
assert message.startswith(f"{os.environ['PHASE_LOOP_PR_TITLE_PREFIX']}:"), message
assert "B-01:" in message, message
assert "README.md" in message, message
assert "B-01:" in todo, todo
assert "README.md" in todo, todo
assert "Route: implementation." in todo, todo
assert "Completion condition:" in todo, todo
assert "Verification: run" in todo, todo
assert "phase-loop-pr-actor-guard.mjs" in todo, todo
PY

# A normal Runtime completion must publish tracked workspace progress before
# returning success when PR creation is enabled; completion is not an early
# return that bypasses the commit/push/PR path.
state_pr_completed_progress="$(mktemp -d)"
prompt_pr_completed_progress="$(mktemp)"
todo_pr_completed_progress="$(mktemp)"
todo_pr_completed_progress_contract="$(mktemp)"
workspace_pr_completed_progress="$(mktemp -d)"
remote_pr_completed_progress="$(mktemp -d)"
git -C "$workspace_pr_completed_progress" init -b main >/dev/null
mkdir -p "$workspace_pr_completed_progress/scripts"
cp "$REPO_ROOT/scripts/phase-loop-pr-actor-guard.mjs" "$workspace_pr_completed_progress/scripts/phase-loop-pr-actor-guard.mjs"
printf 'base\n' > "$workspace_pr_completed_progress/README.md"
git -C "$workspace_pr_completed_progress" add README.md
git -C "$workspace_pr_completed_progress" -c user.name=Brownie -c user.email=brownie@example.invalid commit -m init >/dev/null
git -C "$remote_pr_completed_progress" init --bare >/dev/null
git -C "$workspace_pr_completed_progress" remote add origin "$remote_pr_completed_progress"
git -C "$workspace_pr_completed_progress" push -u origin main >/dev/null
git -C "$workspace_pr_completed_progress" switch -c "${PHASE_LOOP_TEST_IMPLEMENTATION_BRANCH_PREFIX}smoke-pr-completed" >/dev/null
phase_loop_prepare_pr_fixture_workspace "$workspace_pr_completed_progress" "$remote_pr_completed_progress"
test -z "$(git -C "$workspace_pr_completed_progress" status --porcelain)"
printf 'base prompt\n' > "$prompt_pr_completed_progress"
printf -- '- [ ] B-01: Patch only `README.md` to create a PR from completed tracked Brownie progress.\n  Route: implementation.\n  Completion condition: the completed tracked README change is committed and published through the fixture PR path.\n  Forbidden changes: do not weaken actor or delivery guards.\n  Verification: run `node --check scripts/phase-loop-pr-actor-guard.mjs`.\n' > "$todo_pr_completed_progress"
cp "$todo_pr_completed_progress" "$todo_pr_completed_progress_contract"

PATH="$fake_bin_dir:$PATH" \
PHASE_LOOP_STATE_DIR="$state_pr_completed_progress" \
PHASE_LOOP_PROMPT="$prompt_pr_completed_progress" \
PHASE_LOOP_TODO="$todo_pr_completed_progress" \
BROWNIE_BIN="$fake_brownie_completed_tracked_workspace_change" \
PHASE_LOOP_WORKSPACE_ROOT="$workspace_pr_completed_progress" \
PHASE_LOOP_CREATE_PR_AFTER_PROGRESS=1 \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

python3 - "$state_pr_completed_progress/status.json" "$workspace_pr_completed_progress" "$todo_pr_completed_progress_contract" <<'PY'
import json
import os
import subprocess
import sys

status = json.load(open(sys.argv[1], encoding="utf-8"))
workspace = sys.argv[2]
todo = open(sys.argv[3], encoding="utf-8").read()
assert status["status"] == "pr_created", status
assert "pull/9999" in status["detail"], status
head = subprocess.check_output(["git", "-C", workspace, "rev-parse", "HEAD"], text=True).strip()
remote = subprocess.check_output(["git", "-C", workspace, "rev-parse", f"fixture-origin/{os.environ['PHASE_LOOP_TEST_IMPLEMENTATION_BRANCH_PREFIX']}smoke-pr-completed"], text=True).strip()
assert head == remote, (head, remote)
message = subprocess.check_output(["git", "-C", workspace, "log", "-1", "--format=%s"], text=True).strip()
assert message.startswith(f"{os.environ['PHASE_LOOP_PR_TITLE_PREFIX']}:"), message
assert "B-01:" in message, message
assert "README.md" in message, message
assert "B-01:" in todo, todo
assert "README.md" in todo, todo
assert "Route: implementation." in todo, todo
assert "Completion condition:" in todo, todo
assert "Verification: run" in todo, todo
assert "phase-loop-pr-actor-guard.mjs" in todo, todo
PY

state_pr_supervise="$(mktemp -d)"
prompt_pr_supervise="$(mktemp)"
todo_pr_supervise="$(mktemp)"
workspace_pr_supervise="$(mktemp -d)"
remote_pr_supervise="$(mktemp -d)"
fake_supervise_bin_dir="$(mktemp -d)"
git -C "$workspace_pr_supervise" init -b main >/dev/null
mkdir -p "$workspace_pr_supervise/scripts"
cp "$REPO_ROOT/scripts/phase-loop-pr-actor-guard.mjs" "$workspace_pr_supervise/scripts/phase-loop-pr-actor-guard.mjs"
printf 'base\n' > "$workspace_pr_supervise/README.md"
git -C "$workspace_pr_supervise" add README.md
git -C "$workspace_pr_supervise" -c user.name=Brownie -c user.email=brownie@example.invalid commit -m init >/dev/null
git -C "$remote_pr_supervise" init --bare >/dev/null
git -C "$workspace_pr_supervise" remote add origin "$remote_pr_supervise"
git -C "$workspace_pr_supervise" push -u origin main >/dev/null
git -C "$workspace_pr_supervise" switch -c "${PHASE_LOOP_TEST_IMPLEMENTATION_BRANCH_PREFIX}smoke-pr-supervise" >/dev/null
phase_loop_prepare_pr_fixture_workspace "$workspace_pr_supervise" "$remote_pr_supervise"
test -z "$(git -C "$workspace_pr_supervise" status --porcelain)"
printf 'base prompt\n' > "$prompt_pr_supervise"
printf -- '- [ ] B-01: Patch only `README.md` to create a PR and stop the supervisor for review.\n  Route: implementation.\n  Completion condition: the tracked README change is committed, published, and the supervisor stops for review.\n  Forbidden changes: do not weaken actor or delivery guards.\n  Verification: run `node --check scripts/phase-loop-pr-actor-guard.mjs`.\n' > "$todo_pr_supervise"
cat > "$fake_supervise_bin_dir/pnpm" <<'SH'
#!/usr/bin/env bash
exit 0
SH
chmod +x "$fake_supervise_bin_dir/pnpm"
cat > "$fake_supervise_bin_dir/gh" <<'SH'
#!/usr/bin/env bash
set -eu
case "${1:-} ${2:-}" in
  "api user")
    printf '%s\n' "${PHASE_LOOP_TEST_IMPLEMENTATION_ACTOR:?}"
    ;;
  "auth token")
    printf 'fake-token\n'
    ;;
  "pr view")
    exit 1
    ;;
  "pr create")
    printf 'https://github.com/%s/pull/9998\n' "${PHASE_LOOP_TEST_REPOSITORY:?}"
    ;;
  *)
    exit 0
    ;;
esac
SH
chmod +x "$fake_supervise_bin_dir/gh"

PATH="$fake_supervise_bin_dir:$PATH" \
PHASE_LOOP_STATE_DIR="$state_pr_supervise" \
PHASE_LOOP_PROMPT="$prompt_pr_supervise" \
PHASE_LOOP_TODO="$todo_pr_supervise" \
BROWNIE_BIN="$fake_brownie_tracked_workspace_change" \
PHASE_LOOP_WORKSPACE_ROOT="$workspace_pr_supervise" \
PHASE_LOOP_CREATE_PR_AFTER_PROGRESS=1 \
PHASE_LOOP_INTERVAL_SECONDS=30 \
run_with_timeout 20 env \
  "PATH=$fake_supervise_bin_dir:$PATH" \
  "PHASE_LOOP_STATE_DIR=$state_pr_supervise" \
  "PHASE_LOOP_PROMPT=$prompt_pr_supervise" \
  "PHASE_LOOP_TODO=$todo_pr_supervise" \
  "BROWNIE_BIN=$fake_brownie_tracked_workspace_change" \
  "PHASE_LOOP_WORKSPACE_ROOT=$workspace_pr_supervise" \
  "PHASE_LOOP_CREATE_PR_AFTER_PROGRESS=1" \
  "PHASE_LOOP_INTERVAL_SECONDS=30" \
  "$PHASE_LOOP" supervise >/dev/null 2>/dev/null

python3 - "$state_pr_supervise/status.json" "$state_pr_supervise/logs/supervisor.log" "$workspace_pr_supervise" <<'PY'
import json
import os
import subprocess
import sys

status = json.load(open(sys.argv[1], encoding="utf-8"))
supervisor_log = open(sys.argv[2], encoding="utf-8").read()
workspace = sys.argv[3]
assert status["status"] == "pr_created", status
assert "pull/9998" in status["detail"], status
assert "pr_created observed; stopping supervisor for review" in supervisor_log, supervisor_log
head = subprocess.check_output(["git", "-C", workspace, "rev-parse", "HEAD"], text=True).strip()
remote = subprocess.check_output(["git", "-C", workspace, "rev-parse", f"fixture-origin/{os.environ['PHASE_LOOP_TEST_IMPLEMENTATION_BRANCH_PREFIX']}smoke-pr-supervise"], text=True).strip()
assert head == remote, (head, remote)
PY

actor_guard_missing_workspace="$(mktemp -d)"
actor_guard_missing_state="$(mktemp -d)"
actor_guard_missing_control_root="$(mktemp -d)"
mkdir -p "$actor_guard_missing_workspace/scripts"
cp "$PHASE_LOOP" "$actor_guard_missing_control_root/phase-loop.sh"
set +e
PATH="$fake_bin_dir:$PATH" \
PHASE_LOOP_STATE_DIR="$actor_guard_missing_state" \
PHASE_LOOP_WORKSPACE_ROOT="$actor_guard_missing_workspace" \
bash -c 'script=$1; set --; source "$script" >/dev/null; phase_loop_require_implementation_pr_actor' _ "$actor_guard_missing_control_root/phase-loop.sh"
actor_guard_missing_exit="$?"
set -e
test "$actor_guard_missing_exit" = "1"

actor_guard_invalid_workspace="$(mktemp -d)"
actor_guard_invalid_state="$(mktemp -d)"
actor_guard_invalid_bin_dir="$(mktemp -d)"
mkdir -p "$actor_guard_invalid_workspace/scripts"
cp "$REPO_ROOT/scripts/phase-loop-pr-actor-guard.mjs" "$actor_guard_invalid_workspace/scripts/phase-loop-pr-actor-guard.mjs"
cat > "$actor_guard_invalid_bin_dir/gh" <<'SH'
#!/usr/bin/env bash
set -eu
if [ "${1:-} ${2:-}" = "api user" ]; then
  printf '%s\n' "${PHASE_LOOP_TEST_REVIEW_ACTOR:?}"
  exit 0
fi
exit 1
SH
chmod +x "$actor_guard_invalid_bin_dir/gh"
set +e
PATH="$actor_guard_invalid_bin_dir:$PATH" \
PHASE_LOOP_STATE_DIR="$actor_guard_invalid_state" \
PHASE_LOOP_WORKSPACE_ROOT="$actor_guard_invalid_workspace" \
bash -c 'script=$1; set --; source "$script" >/dev/null; phase_loop_require_implementation_pr_actor' _ "$PHASE_LOOP"
actor_guard_invalid_exit="$?"
set -e
test "$actor_guard_invalid_exit" = "1"
fi

if claim_smoke_section_enabled lifecycle; then
# The lifecycle shard is selected independently by CI.  It therefore cannot
# borrow the bare workspace created for the core shard: phase-loop preflight
# reads the workspace package-script contract even for stop/recovery paths.
# Keep this deployment-neutral fixture complete and restore the shared
# variable afterwards so other selected shards cannot inherit it.
lifecycle_original_workspace="$test_workspace"
lifecycle_workspace="$(mktemp -d)"
git -C "$lifecycle_workspace" init -b main >/dev/null
mkdir -p "$lifecycle_workspace/.brownie" "$lifecycle_workspace/scripts"
printf '%s\n' '{"name":"brownie-claim-smoke-lifecycle-fixture","private":true,"scripts":{"guard:todo-decomposition":"node scripts/guard-todo-decomposition.mjs","phase-loop:todo-queue-integrity":"node scripts/phase-loop-todo-queue-integrity.mjs"}}' > "$lifecycle_workspace/package.json"
printf '# lifecycle fixture breakdown\n' > "$lifecycle_workspace/.brownie/todo-breakdown.md"
printf 'export const evidence = {};\n' > "$lifecycle_workspace/scripts/release-supply-chain-artifact-evidence.mjs"
git -C "$lifecycle_workspace" add package.json .brownie/todo-breakdown.md scripts/release-supply-chain-artifact-evidence.mjs
git -C "$lifecycle_workspace" -c user.name=Brownie -c user.email=brownie@example.invalid commit -m init >/dev/null
test_workspace="$lifecycle_workspace"

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
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

truncated_prompt="$(find "$state_truncated/runs" -name '*.prompt.md' -print | sort | tail -n 1)"
python3 - "${truncated_prompt%.prompt.md}.prompt.meta.json" <<'PY'
import json
import sys

meta = json.load(open(sys.argv[1], encoding="utf-8"))
assert meta["todo_snapshot_truncated"] is True, meta
assert meta["base_prompt_snapshot_truncated"] is True, meta
assert meta["selected_todo_complete"] is False, meta
assert meta["selected_todo_completion_reason"] == "selected_todo_still_unchecked", meta
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
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

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
  run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null 2>/dev/null; then
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
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

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
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

rm "$state_generation/todo-claims/current.json"
printf -- '- [ ] B-00: externally inserted higher priority\n- [ ] B-01: first generation\n' > "$todo_generation"

PHASE_LOOP_STATE_DIR="$state_generation" \
PHASE_LOOP_PROMPT="$prompt_generation" \
PHASE_LOOP_TODO="$todo_generation" \
BROWNIE_BIN="$fake_brownie_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

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

state_same_head_queue_growth="$(mktemp -d)"
prompt_same_head_queue_growth="$(mktemp)"
todo_same_head_queue_growth="$(mktemp)"
printf 'base prompt\n' > "$prompt_same_head_queue_growth"
printf -- '- [ ] B-01: stable first task\n' > "$todo_same_head_queue_growth"

PHASE_LOOP_STATE_DIR="$state_same_head_queue_growth" \
PHASE_LOOP_PROMPT="$prompt_same_head_queue_growth" \
PHASE_LOOP_TODO="$todo_same_head_queue_growth" \
BROWNIE_BIN="$fake_brownie_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

printf -- '- [ ] B-01: stable first task\n- [ ] B-02: appended follow-up task\n' > "$todo_same_head_queue_growth"

PHASE_LOOP_STATE_DIR="$state_same_head_queue_growth" \
PHASE_LOOP_PROMPT="$prompt_same_head_queue_growth" \
PHASE_LOOP_TODO="$todo_same_head_queue_growth" \
BROWNIE_BIN="$fake_brownie_json" \
PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

python3 - "$state_same_head_queue_growth/todo-claims/current.json" "$state_same_head_queue_growth/todo-claims/todo-queue-state.json" "$todo_same_head_queue_growth" <<'PY'
import hashlib
import json
import pathlib
import sys

claim = json.load(open(sys.argv[1], encoding="utf-8"))
queue_state = json.load(open(sys.argv[2], encoding="utf-8"))
todo_text = pathlib.Path(sys.argv[3]).read_text(encoding="utf-8")
fingerprint = hashlib.sha256(todo_text.encode("utf-8")).hexdigest()
assert claim["selected_todo"].startswith("- [ ] B-01: stable first task"), claim
assert claim["queue_fingerprint"] == fingerprint, claim
assert queue_state["fingerprint"] == fingerprint, queue_state
assert claim["queue_generation"] == queue_state["generation"], (claim, queue_state)
assert claim["queue_generation"] == 2, claim
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
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

python3 - "$state_legacy/todo-claims/current.json" "$todo_legacy" <<'PY'
import json
import pathlib
import sys

claim = json.load(open(sys.argv[1], encoding="utf-8"))
todo_text = pathlib.Path(sys.argv[2]).read_text(encoding="utf-8")
assert claim["claim_id"] == "todo-legacy-claim", claim
assert claim["queue_generation"] == 2, claim
assert claim["baseline_todo_text"] == todo_text, claim
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
  run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null; then
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
  run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null; then
  echo "expected empty queue with dirty/non-main workspace to fail closed before Runtime start" >&2
  exit 1
fi

python3 - "$state_empty_dirty/status.json" <<'PY'
import json
import sys

status = json.load(open(sys.argv[1], encoding="utf-8"))
assert status["status"] == "blocked", status
assert status["exit_code"] == "78", status
assert "preflight failed before continuing" in status["detail"], status
PY
rm -f "$test_workspace/unrelated.txt"
git -C "$test_workspace" checkout main >/dev/null

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
  run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null; then
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
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" supervise >/dev/null 2>/dev/null &
interruptible_pid="$!"

for _ in 1 2 3 4 5; do
  if [ -f "$state_interruptible/status.json" ] && rg -q '"status": "blocked"' "$state_interruptible/status.json"; then
    break
  fi
  sleep 1
done

start_epoch="$(date +%s)"
PHASE_LOOP_STATE_DIR="$state_interruptible" "$PHASE_LOOP" stop >/dev/null
wait_for_pid_exit "$interruptible_pid" 8
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
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" supervise >/dev/null 2>/dev/null &
child_supervisor_pid="$!"

child_start_deadline=$((SECONDS + PHASE_LOOP_COMMAND_TIMEOUT_SECONDS))
while [ ! -s "$child_pid_file" ] && [ "$SECONDS" -lt "$child_start_deadline" ]; do
  if ! kill -0 "$child_supervisor_pid" 2>/dev/null; then
    break
  fi
  sleep "$PHASE_LOOP_SLEEP_POLL_SECONDS"
done
if [ ! -s "$child_pid_file" ]; then
  echo "expected fake Brownie child pid file before configured command timeout" >&2
  kill "$child_supervisor_pid" 2>/dev/null || true
  exit 1
fi
child_pid="$(cat "$child_pid_file")"

PHASE_LOOP_STATE_DIR="$state_child_stop" \
PHASE_LOOP_STOP_GRACE_SECONDS=1 \
PHASE_LOOP_STOP_FORCE_SECONDS=3 \
"$PHASE_LOOP" stop >/dev/null
wait_for_pid_exit "$child_supervisor_pid" 8
sleep 1
if kill -0 "$child_pid" 2>/dev/null && ! ps -o stat= -p "$child_pid" 2>/dev/null | grep -Eq '^[[:space:]]*Z'; then
  echo "expected stop to terminate supervisor-managed child pid=$child_pid" >&2
  kill -KILL "$child_pid" 2>/dev/null || true
  exit 1
fi
test_workspace="$lifecycle_original_workspace"
fi

if claim_smoke_section_enabled guards; then
run_changed_file_quality_gate_regression

exact_workspace="$(mktemp -d)"
git -C "$exact_workspace" init -b main >/dev/null
git -C "$exact_workspace" config user.name Brownie
git -C "$exact_workspace" config user.email brownie@example.invalid
mkdir -p "$exact_workspace/docs/architecture"
# This is the success-path completion fixture. It deliberately has no release
# readiness manifest or release-blocker evidence, so an empty queue is valid
# without making a Product Ready claim.
printf '{"scripts":{}}\n' > "$exact_workspace/package.json"
cat > "$exact_workspace/docs/golden.js" <<'EOF'
export const evidence = {
  status: 'failed',
  release_blocking: true,
  fixture_path: fixtureRoot,
  commands,
};
EOF
git -C "$exact_workspace" add docs
git -C "$exact_workspace" commit -m init >/dev/null

fake_brownie_should_not_run="$(mktemp)"
cat > "$fake_brownie_should_not_run" <<'SH'
#!/usr/bin/env bash
echo "Brownie should not run for deterministic exact-line TODO fast path" >&2
exit 99
SH
chmod +x "$fake_brownie_should_not_run"

state_exact_fast_path="$(mktemp -d)"
prompt_exact_fast_path="$(mktemp)"
todo_exact_fast_path="$(mktemp)"
printf 'base prompt\n' > "$prompt_exact_fast_path"
cat > "$todo_exact_fast_path" <<'EOF'
- [ ] E-exact: Patch only `docs/golden.js`.
  In the return object, add exactly one line
  `  lifecycle_evidence: lifecycleEvidence,`
  immediately after the exact line `  fixture_path: fixtureRoot,`. Do not edit
  any other line.
EOF

PHASE_LOOP_STATE_DIR="$state_exact_fast_path" \
PHASE_LOOP_PROMPT="$prompt_exact_fast_path" \
PHASE_LOOP_TODO="$todo_exact_fast_path" \
BROWNIE_BIN="$fake_brownie_should_not_run" \
PHASE_LOOP_WORKSPACE_ROOT="$exact_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

python3 - "$state_exact_fast_path/status.json" "$state_exact_fast_path/todo-claims/current.json" "$todo_exact_fast_path" "$exact_workspace/docs/golden.js" <<'PY'
import json
import pathlib
import sys

status = json.load(open(sys.argv[1], encoding="utf-8"))
claim = json.load(open(sys.argv[2], encoding="utf-8"))
todo = pathlib.Path(sys.argv[3]).read_text(encoding="utf-8")
target = pathlib.Path(sys.argv[4]).read_text(encoding="utf-8")
assert status["status"] == "last_run_succeeded", status
assert "deterministic exact-line TODO fast path" in status["detail"], status
assert claim["status"] == "completed", claim
assert "E-exact" not in todo, todo
assert "  fixture_path: fixtureRoot,\n  lifecycle_evidence: lifecycleEvidence,\n  commands," in target, target
PY

# A GitHub squash merge deliberately creates different commit identities for
# the reviewed baseline and the implementation branch while preserving their
# full tracked trees.  The controller must audit that exact equivalence,
# preserve the branch and dirty state, and still deliver the selected TODO.
tree_equivalent_liveness_root="$(mktemp -d)"
tree_equivalent_liveness_workspace="$tree_equivalent_liveness_root/workspace"
tree_equivalent_liveness_remote="$tree_equivalent_liveness_root/origin.git"
tree_equivalent_liveness_state="$(mktemp -d)"
tree_equivalent_liveness_prompt="$(mktemp)"
tree_equivalent_liveness_todo="$(mktemp)"
git init --bare "$tree_equivalent_liveness_remote" >/dev/null
git init -b main "$tree_equivalent_liveness_workspace" >/dev/null
git -C "$tree_equivalent_liveness_workspace" config user.name Brownie
git -C "$tree_equivalent_liveness_workspace" config user.email brownie@example.invalid
mkdir -p "$tree_equivalent_liveness_workspace/docs" "$tree_equivalent_liveness_workspace/scripts"
printf '{"scripts":{}}\n' > "$tree_equivalent_liveness_workspace/package.json"
printf '%s\n' '#!/usr/bin/env bash' 'exit 0' > "$tree_equivalent_liveness_workspace/phase-loop.sh"
cat > "$tree_equivalent_liveness_workspace/scripts/phase-loop-controller-source-manifest.json" <<'EOF'
{
  "schema_version": 1,
  "controller_source_paths": ["phase-loop.sh"]
}
EOF
cat > "$tree_equivalent_liveness_workspace/docs/golden.js" <<'EOF'
export const evidence = {
  status: 'failed',
  release_blocking: true,
  fixture_path: fixtureRoot,
  commands,
};
EOF
git -C "$tree_equivalent_liveness_workspace" add .
git -C "$tree_equivalent_liveness_workspace" commit -m fixture-baseline >/dev/null
git -C "$tree_equivalent_liveness_workspace" remote add origin "$tree_equivalent_liveness_remote"
git -C "$tree_equivalent_liveness_workspace" push -u origin main >/dev/null
git -C "$tree_equivalent_liveness_workspace" checkout -qb squash-equivalent-worker
printf 'equivalent controller lineage\n' > "$tree_equivalent_liveness_workspace/lineage.txt"
git -C "$tree_equivalent_liveness_workspace" add lineage.txt
git -C "$tree_equivalent_liveness_workspace" commit -m implementation-branch-lineage >/dev/null
git -C "$tree_equivalent_liveness_workspace" checkout -q main
printf 'equivalent controller lineage\n' > "$tree_equivalent_liveness_workspace/lineage.txt"
git -C "$tree_equivalent_liveness_workspace" add lineage.txt
git -C "$tree_equivalent_liveness_workspace" commit -m reviewed-squash-equivalent-lineage >/dev/null
git -C "$tree_equivalent_liveness_workspace" push origin main >/dev/null
git -C "$tree_equivalent_liveness_workspace" checkout -q squash-equivalent-worker
if git -C "$tree_equivalent_liveness_workspace" merge-base --is-ancestor origin/main HEAD; then
  echo "tree-equivalent fixture must not have an ancestry relationship" >&2
  exit 1
fi
test "$(git -C "$tree_equivalent_liveness_workspace" rev-parse 'HEAD^{tree}')" = "$(git -C "$tree_equivalent_liveness_workspace" rev-parse 'origin/main^{tree}')"

printf 'base prompt\n' > "$tree_equivalent_liveness_prompt"
cat > "$tree_equivalent_liveness_todo" <<'EOF'
- [ ] E-tree-equivalent-liveness: Patch only `docs/golden.js`.
  In the return object, add exactly one line
  `  lifecycle_evidence: lifecycleEvidence,`
  immediately after the exact line `  fixture_path: fixtureRoot,`. Do not edit
  any other line.
EOF

(
  export PHASE_LOOP_APPROVED_CONTROLLER_BASELINE=origin/main
  export PHASE_LOOP_STATE_DIR="$tree_equivalent_liveness_state"
  export PHASE_LOOP_PROMPT="$tree_equivalent_liveness_prompt"
  export PHASE_LOOP_TODO="$tree_equivalent_liveness_todo"
  export BROWNIE_BIN="$fake_brownie_should_not_run"
  export PHASE_LOOP_WORKSPACE_ROOT="$tree_equivalent_liveness_workspace"
  run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null
)

if git -C "$tree_equivalent_liveness_workspace" diff --quiet -- docs/golden.js; then
  echo "tree-equivalent rebaseline liveness did not produce the selected TODO diff" >&2
  exit 1
fi
python3 - "$tree_equivalent_liveness_state/status.json" "$tree_equivalent_liveness_state/todo-claims/current.json" "$tree_equivalent_liveness_state/workspace-baseline-rebaseline" "$tree_equivalent_liveness_todo" "$tree_equivalent_liveness_workspace/docs/golden.js" <<'PY'
import json
import pathlib
import sys

status = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
claim = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding="utf-8"))
audits = sorted(pathlib.Path(sys.argv[3]).glob("*.json"))
todo = pathlib.Path(sys.argv[4]).read_text(encoding="utf-8")
target = pathlib.Path(sys.argv[5]).read_text(encoding="utf-8")
assert status["status"] == "last_run_succeeded", status
assert claim["status"] == "completed", claim
assert "E-tree-equivalent-liveness" not in todo, todo
assert "  fixture_path: fixtureRoot,\n  lifecycle_evidence: lifecycleEvidence,\n  commands," in target, target
assert len(audits) == 1, audits
audit = json.loads(audits[0].read_text(encoding="utf-8"))
assert audit["status"] == "applied_tree_equivalence", audit
assert audit["reconciliation_mode"] == "tree_equivalent_history", audit
assert audit["workspace_tree"] == audit["baseline_tree"], audit
assert audit["workspace_head_before"] != audit["baseline_commit"], audit
assert audit["workspace_head_after"] == audit["workspace_head_before"], audit
assert audit["dirty_status_fingerprint_before"] == audit["dirty_status_fingerprint_after"], audit
PY

empty_queue_guard_workspace="$(mktemp -d)"
git -C "$empty_queue_guard_workspace" init -b main >/dev/null
git -C "$empty_queue_guard_workspace" config user.name Brownie
git -C "$empty_queue_guard_workspace" config user.email brownie@example.invalid
mkdir -p "$empty_queue_guard_workspace/.brownie" "$empty_queue_guard_workspace/docs/architecture" "$empty_queue_guard_workspace/scripts" "$empty_queue_guard_workspace/docs"
cp "$REPO_ROOT/scripts/guard-todo-decomposition.mjs" "$empty_queue_guard_workspace/scripts/guard-todo-decomposition.mjs"
cp "$REPO_ROOT/scripts/phase-loop-todo-state.mjs" "$empty_queue_guard_workspace/scripts/phase-loop-todo-state.mjs"
printf '{"scripts":{}}\n' > "$empty_queue_guard_workspace/package.json"
printf '{"product_ready":false}\n' > "$empty_queue_guard_workspace/docs/architecture/phase-value-manifest.json"
cat > "$empty_queue_guard_workspace/docs/golden.js" <<'EOF'
export const evidence = {
  status: 'failed',
  release_blocking: true,
  fixture_path: fixtureRoot,
  commands,
};
EOF
git -C "$empty_queue_guard_workspace" add .
git -C "$empty_queue_guard_workspace" commit -m init >/dev/null

state_empty_queue_guard="$(mktemp -d)"
prompt_empty_queue_guard="$(mktemp)"
todo_empty_queue_guard="$empty_queue_guard_workspace/.brownie/todo.md"
printf 'base prompt\n' > "$prompt_empty_queue_guard"
cat > "$todo_empty_queue_guard" <<'EOF'
- [ ] E-empty-queue-exact: Patch only `docs/golden.js`.
  In the return object, add exactly one line
  `  lifecycle_evidence: lifecycleEvidence,`
  immediately after the exact line `  fixture_path: fixtureRoot,`. Do not edit
  any other line.
EOF

empty_queue_guard_ledger="$empty_queue_guard_workspace/.brownie/private/phase-loop/task-ledger.jsonl"
empty_queue_guard_runtime_marker="$state_empty_queue_guard/runtime-invoked"
fake_brownie_empty_queue_cleanup_must_not_run="$(mktemp)"
cat > "$fake_brownie_empty_queue_cleanup_must_not_run" <<SH
#!/usr/bin/env bash
set -eu
printf 'runtime-invoked\n' >> "$empty_queue_guard_runtime_marker"
echo "Brownie must not run during completed TODO cleanup-only retry" >&2
exit 99
SH
chmod +x "$fake_brownie_empty_queue_cleanup_must_not_run"

set +e
PHASE_LOOP_STATE_DIR="$state_empty_queue_guard" \
PHASE_LOOP_PROMPT="$prompt_empty_queue_guard" \
PHASE_LOOP_TODO="$todo_empty_queue_guard" \
BROWNIE_BIN="$fake_brownie_should_not_run" \
PHASE_LOOP_WORKSPACE_ROOT="$empty_queue_guard_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null
empty_queue_guard_exit="$?"
set -e
test "$empty_queue_guard_exit" = "76"

python3 - "$state_empty_queue_guard/todo-claims/current.json" "$todo_empty_queue_guard" "$state_empty_queue_guard/logs/supervisor.log" "$empty_queue_guard_workspace/docs/golden.js" <<'PY'
import json
import pathlib
import sys

claim = json.load(open(sys.argv[1], encoding="utf-8"))
todo = pathlib.Path(sys.argv[2]).read_text(encoding="utf-8")
supervisor_log = pathlib.Path(sys.argv[3]).read_text(encoding="utf-8")
target = pathlib.Path(sys.argv[4]).read_text(encoding="utf-8")
assert claim["status"] == "completed", claim
assert claim["completion_cleanup_pending"] is True, claim
assert "E-empty-queue-exact" in todo, todo
assert "completed_todo_removal_reverted=true" in supervisor_log, supervisor_log
assert "Empty or non-executable TODO queue" in supervisor_log, supervisor_log
assert "  fixture_path: fixtureRoot,\n  lifecycle_evidence: lifecycleEvidence,\n  commands," in target, target
PY

python3 - "$empty_queue_guard_ledger" "$state_empty_queue_guard/todo-claims/current.json" <<'PY'
import json
import pathlib
import sys

ledger = pathlib.Path(sys.argv[1])
claim = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding="utf-8"))
claim_id = claim["claim_id"]
records = [json.loads(line) for line in ledger.read_text(encoding="utf-8").splitlines() if line.strip()]
events = [
    event
    for record in records
    for event in (record.get("events", []) if record.get("kind") in ("replan_transaction", "terminal_failure_transaction", "terminal_replan_transaction") else [record])
]
source_attempt = [event for event in events if event.get("task_id") == f"E-empty-queue-exact@{claim_id}"]
assert source_attempt, events
assert source_attempt[-1]["to_state"] == "completed", source_attempt
assert all(event["to_state"] in ("queued", "claimed", "running", "completed") for event in source_attempt), source_attempt
PY

# Once the decomposition guard condition is repaired, the next invocation must
# retry only queue cleanup. It must not restart Runtime for the completed
# source claim, and it must clear the cleanup marker after successful removal.
printf '{"product_ready":true}\n' > "$empty_queue_guard_workspace/docs/architecture/phase-value-manifest.json"
set +e
PHASE_LOOP_STATE_DIR="$state_empty_queue_guard" \
PHASE_LOOP_PROMPT="$prompt_empty_queue_guard" \
PHASE_LOOP_TODO="$todo_empty_queue_guard" \
BROWNIE_BIN="$fake_brownie_empty_queue_cleanup_must_not_run" \
PHASE_LOOP_WORKSPACE_ROOT="$empty_queue_guard_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 75 "$PHASE_LOOP" run-once >/dev/null
empty_queue_guard_cleanup_exit="$?"
set -e
test "$empty_queue_guard_cleanup_exit" = "75"
test ! -e "$empty_queue_guard_runtime_marker"

python3 - "$state_empty_queue_guard/todo-claims/current.json" "$todo_empty_queue_guard" "$state_empty_queue_guard/logs/supervisor.log" <<'PY'
import json
import pathlib
import sys

claim = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
todo = pathlib.Path(sys.argv[2]).read_text(encoding="utf-8")
supervisor_log = pathlib.Path(sys.argv[3]).read_text(encoding="utf-8")
assert claim["status"] == "completed", claim
assert claim["completion_cleanup_pending"] is False, claim
assert "E-empty-queue-exact" not in todo, todo
assert "completed_todo_cleanup_retry_succeeded=true" in supervisor_log, supervisor_log
PY

verified_noop_e19_workspace="$(mktemp -d)"
git -C "$verified_noop_e19_workspace" init -b main >/dev/null
git -C "$verified_noop_e19_workspace" config user.name Brownie
git -C "$verified_noop_e19_workspace" config user.email brownie@example.invalid
mkdir -p "$verified_noop_e19_workspace/.brownie" "$verified_noop_e19_workspace/docs/architecture" "$verified_noop_e19_workspace/scripts" "$verified_noop_e19_workspace/extensions/brownie-vsix"
cp "$REPO_ROOT/phase-loop.sh" "$verified_noop_e19_workspace/phase-loop.sh"
cp "$REPO_ROOT/package.json" "$verified_noop_e19_workspace/package.json"
cp "$REPO_ROOT/extensions/brownie-vsix/package.json" "$verified_noop_e19_workspace/extensions/brownie-vsix/package.json"
cp "$REPO_ROOT/scripts/phase-loop-claim-smoke.test.sh" "$verified_noop_e19_workspace/scripts/phase-loop-claim-smoke.test.sh"
cp "$REPO_ROOT/scripts/guard-todo-decomposition.mjs" "$verified_noop_e19_workspace/scripts/guard-todo-decomposition.mjs"
cp "$REPO_ROOT/scripts/phase-loop-todo-state.mjs" "$verified_noop_e19_workspace/scripts/phase-loop-todo-state.mjs"
printf '{"product_ready":false}\n' > "$verified_noop_e19_workspace/docs/architecture/phase-value-manifest.json"
cat > "$verified_noop_e19_workspace/.brownie/todo.md" <<'EOF'
- [ ] E-19a-prevent-empty-queue-completion: Patch only `phase-loop.sh` so completed TODO removal is reverted when the resulting `.brownie/todo.md` fails the decomposition guard:
  Route: blocker.
  Source TODO: empty-queue-regression-follow-up-2026-09-22.
  Depends on: <none>.
  Completion condition: release blocker queues cannot become empty while Product Ready is false; attempted completion removal is reverted while the durable claim remains completed with cleanup pending when the guard rejects the resulting queue.
  Forbidden changes: do not weaken `scripts/guard-todo-decomposition.mjs`, do not declare Runtime Product Ready or Runtime Release Ready, and do not remove remaining release blocker TODOs.
  Verification: run `pnpm --workspace-root phase-loop:claim-smoke`, `pnpm --workspace-root guard:todo-decomposition:test`, and `pnpm --workspace-root guard:todo-decomposition`.

- [ ] E-19b-refresh-owner-governance-evidence-after-stable-ci: Blocker: release blocker evidence remains fail-closed until owner governance evidence reflects completed latest-main CI instead of pending checks.
  Verification: inspect latest main CI completion and fail-closed owner governance evidence, then keep the blocker if GitHub checks are still pending or unavailable.

- [ ] E-19c-queue-cleanup-follow-up: Patch only `scripts/phase-loop-todo-state.mjs` to preserve queue cleanup invariants after the completed-item removal path:
  Route: implementation.
  Depends on: <none>.
  Completion condition: queue state remains executable while release blockers are unresolved.
  Forbidden changes: do not weaken TODO decomposition or Product Ready guards.
  Verification: run `node --check scripts/phase-loop-todo-state.mjs`.
EOF
git -C "$verified_noop_e19_workspace" add .
git -C "$verified_noop_e19_workspace" commit -m init >/dev/null

state_verified_noop_e19="$(mktemp -d)"
prompt_verified_noop_e19="$(mktemp)"
fake_verified_noop_bin_dir="$(mktemp -d)"
printf 'base prompt\n' > "$prompt_verified_noop_e19"
cat > "$fake_verified_noop_bin_dir/pnpm" <<'SH'
#!/usr/bin/env bash
printf 'E-19 verified-noop must not invoke pnpm verification commands\n' >&2
exit 91
SH
chmod +x "$fake_verified_noop_bin_dir/pnpm"

PATH="$fake_verified_noop_bin_dir:$PATH" \
PHASE_LOOP_STATE_DIR="$state_verified_noop_e19" \
PHASE_LOOP_PROMPT="$prompt_verified_noop_e19" \
PHASE_LOOP_TODO="$verified_noop_e19_workspace/.brownie/todo.md" \
BROWNIE_BIN="$fake_brownie_should_not_run" \
PHASE_LOOP_WORKSPACE_ROOT="$verified_noop_e19_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

python3 - "$state_verified_noop_e19/status.json" "$state_verified_noop_e19/todo-claims/current.json" "$verified_noop_e19_workspace/.brownie/todo.md" <<'PY'
import json
import pathlib
import sys

status = json.load(open(sys.argv[1], encoding="utf-8"))
claim = json.load(open(sys.argv[2], encoding="utf-8"))
todo = pathlib.Path(sys.argv[3]).read_text(encoding="utf-8")
assert status["status"] == "last_run_succeeded", status
assert "Selected bounded TODO verification already passed" in status["detail"], status
assert "semantic_wiring_already_present_without_verification_commands" in status["detail"], status
assert claim["status"] == "completed", claim
assert "E-19a-prevent-empty-queue-completion" not in todo, todo
assert "E-19b-refresh-owner-governance-evidence-after-stable-ci" in todo, todo
assert "E-19c-queue-cleanup-follow-up" in todo, todo
PY

python3 - "$PHASE_LOOP" <<'PY'
import pathlib
import sys

phase_loop = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
start = phase_loop.index("try_selected_todo_verified_noop_completion_fallback()")
end = phase_loop.index("try_exact_line_todo_fast_path()", start)
verified_noop_source = phase_loop[start:end]
assert "verification_already_passed" not in verified_noop_source, verified_noop_source
assert "selected_todo_dirty_baseline_verified_completion" in verified_noop_source, verified_noop_source
assert "selected_scopes_dirty_at_baseline" in verified_noop_source, verified_noop_source
assert "dirty_baseline_verification_command_not_allowed" in verified_noop_source, verified_noop_source
assert "selected_todo_dirty_baseline_requires_semantic_repair" in verified_noop_source, verified_noop_source
assert "raise SystemExit(1)" in verified_noop_source, verified_noop_source
assert "semantic_wiring_already_present_without_verification_commands" in verified_noop_source, verified_noop_source
PY

release_ops_workspace="$(mktemp -d)"
mkdir -p "$release_ops_workspace/.brownie/release-evidence" "$release_ops_workspace/docs/architecture" "$release_ops_workspace/scripts"
cp "$REPO_ROOT/phase-loop.sh" "$release_ops_workspace/phase-loop.sh"
cp "$REPO_ROOT/scripts/guard-todo-decomposition.mjs" "$release_ops_workspace/scripts/guard-todo-decomposition.mjs"
cp "$REPO_ROOT/scripts/phase-loop-todo-state.mjs" "$release_ops_workspace/scripts/phase-loop-todo-state.mjs"
cp "$REPO_ROOT/scripts/phase-loop-todo-evaluator.mjs" "$release_ops_workspace/scripts/phase-loop-todo-evaluator.mjs"
cp "$REPO_ROOT/scripts/phase-loop-release-ops-blocker.mjs" "$release_ops_workspace/scripts/phase-loop-release-ops-blocker.mjs"
printf '{"scripts":{}}\n' > "$release_ops_workspace/package.json"
printf '{"product_ready":false}\n' > "$release_ops_workspace/docs/architecture/phase-value-manifest.json"
git -C "$release_ops_workspace" init -b main >/dev/null
git -C "$release_ops_workspace" config user.name Brownie
git -C "$release_ops_workspace" config user.email brownie@example.invalid
cat > "$release_ops_workspace/.brownie/release-evidence/owner-governance-evidence.json" <<'EOF'
{
  "schema_version": 1,
  "evidence_id": "brownie-owner-governance-evidence-v1",
  "release_ready": false,
  "runtime_release_ready": false,
  "source_commit": "old",
  "sections": {
    "remote_ci_workflow_provenance": {
      "workflow_head_sha": "old",
      "workflow_conclusion": "success",
      "missing_or_failed_required_check_names": []
    }
  }
}
EOF
git -C "$release_ops_workspace" add .
git -C "$release_ops_workspace" commit -m init >/dev/null
release_ops_head="$(git -C "$release_ops_workspace" rev-parse HEAD)"
python3 - "$release_ops_workspace/.brownie/release-evidence/owner-governance-evidence.json" "$release_ops_head" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
head = sys.argv[2]
data = json.loads(path.read_text(encoding="utf-8"))
data["source_commit"] = head
data["sections"]["remote_ci_workflow_provenance"]["workflow_head_sha"] = head
data["sections"]["remote_ci_workflow_provenance"]["last_verified_at"] = "2026-09-22T00:00:00Z"
path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
PY

release_ops_state="$(mktemp -d)"
release_ops_prompt="$(mktemp)"
printf 'base prompt\n' > "$release_ops_prompt"
cat > "$release_ops_workspace/.brownie/todo.md" <<'EOF'
- [ ] E-release-ops-refresh: Patch only `.brownie/release-evidence/owner-governance-evidence.json` after latest main CI is complete and stable:
  Route: release-ops.
  Source TODO: release-ops-smoke.
  Depends on: <none>.
  Completion condition: owner governance evidence reflects the completed current HEAD CI while release readiness remains fail-closed.
  Forbidden changes: do not declare Runtime Product Ready, Runtime Release Ready, public Release Ready, or alter unrelated release evidence files.
  Verification: inspect latest main CI completion and fail-closed owner governance evidence, then keep the blocker if release readiness remains unavailable.
EOF

PATH="$fake_verified_noop_bin_dir:$PATH" \
PHASE_LOOP_STATE_DIR="$release_ops_state" \
PHASE_LOOP_PROMPT="$release_ops_prompt" \
PHASE_LOOP_TODO="$release_ops_workspace/.brownie/todo.md" \
BROWNIE_BIN="$fake_brownie_should_not_run" \
PHASE_LOOP_WORKSPACE_ROOT="$release_ops_workspace" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

python3 - "$release_ops_state/status.json" "$release_ops_state/todo-claims/current.json" "$release_ops_workspace/.brownie/todo.md" <<'PY'
import json
import pathlib
import sys

status = json.load(open(sys.argv[1], encoding="utf-8"))
claim = json.load(open(sys.argv[2], encoding="utf-8"))
todo = pathlib.Path(sys.argv[3]).read_text(encoding="utf-8")
assert status["status"] == "last_run_succeeded", status
assert "release-ops evidence refresh" in status["detail"], status
assert claim["status"] == "completed", claim
assert "E-release-ops-refresh-remaining-blocker" in todo, todo
assert "Patch only `.brownie/release-evidence/owner-governance-evidence.json`" not in todo, todo
assert "Verification: blocker:" in todo, todo
PY

broad_decomposition_state="$(mktemp -d)"
broad_decomposition_prompt="$(mktemp)"
broad_decomposition_todo="$(mktemp)"
broad_decomposition_breakdown="$(mktemp)"
broad_decomposition_workspace="$(mktemp -d)"
git -C "$broad_decomposition_workspace" init -b main >/dev/null
git -C "$broad_decomposition_workspace" config user.name Brownie
git -C "$broad_decomposition_workspace" config user.email brownie@example.invalid
printf '{"scripts":{"guard:todo-decomposition":"node scripts/guard-todo-decomposition.mjs"}}\n' > "$broad_decomposition_workspace/package.json"
git -C "$broad_decomposition_workspace" add package.json
git -C "$broad_decomposition_workspace" commit -m init >/dev/null
printf 'base prompt\n' > "$broad_decomposition_prompt"
cat > "$broad_decomposition_todo" <<'EOF'
- [ ] E-99-runtime-release-evidence: Replace broad release evidence with complete Product Ready evidence:
  Route: implementation.
  Source concern: this broad task spans multiple independent implementation surfaces.
  Update collectors, guards, evidence files, release documents, and operational tests.
  Ensure provenance, smoke, soak, release contract, and semantic consistency are all fixed.
  Verification: run `pnpm --workspace-root check`.
EOF

fake_brownie_broad_decomposition="$(mktemp)"
cat > "$fake_brownie_broad_decomposition" <<'SH'
#!/usr/bin/env bash
if [ "$1" = "--json" ] && [ "$2" = "run" ]; then
  printf '%s\n' '{"ok":true,"command":"run","exit_code":0,"run":{"status":"no_eligible_task","completed":false,"blocked":true,"retryable":false,"terminal_failure":true,"controller_action":"stop","stop_class":"terminal_failure","stop_reason":"terminal_task_failed","automation":{"schema_version":1,"status":"terminal_failure","blocked":true,"completed":false,"retryable":false,"terminal_failure":true,"controller_action":"stop","stop_class":"terminal_failure","stop_reason":"terminal_task_failed"}}}'
  exit 0
fi
printf '%s\n' '{"ok":true}'
SH
chmod +x "$fake_brownie_broad_decomposition"

PHASE_LOOP_STATE_DIR="$broad_decomposition_state" \
PHASE_LOOP_PROMPT="$broad_decomposition_prompt" \
PHASE_LOOP_TODO="$broad_decomposition_todo" \
PHASE_LOOP_TODO_BREAKDOWN="$broad_decomposition_breakdown" \
PHASE_LOOP_WORKSPACE_ROOT="$broad_decomposition_workspace" \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
BROWNIE_BIN="$fake_brownie_broad_decomposition" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null || true

python3 - "$broad_decomposition_state/status.json" "$broad_decomposition_todo" "$broad_decomposition_breakdown" "$broad_decomposition_workspace/.brownie/private/phase-loop/task-ledger.jsonl" <<'PY'
import json
import pathlib
import sys

status = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
todo = pathlib.Path(sys.argv[2]).read_text(encoding="utf-8")
breakdown = pathlib.Path(sys.argv[3]).read_text(encoding="utf-8")
ledger = pathlib.Path(sys.argv[4]).read_text(encoding="utf-8")
assert status["status"] == "last_run_succeeded", status
assert "Applied deterministic TODO decomposition repair" in status["detail"], status
assert "E-99-runtime-release-evidence-blocker" in todo, todo
assert "E-99-runtime-release-evidence" in todo, todo
assert "## TODO-decompose-broad-todo-" in breakdown, breakdown
assert "E-99-runtime-release-evidence" in breakdown, breakdown
assert "TODO-decompose-broad-todo-" in ledger, ledger
assert '"to_state":"completed"' in ledger or '"to_state": "completed"' in ledger, ledger
PY

no_eligible_split_state="$(mktemp -d)"
no_eligible_split_prompt="$(mktemp)"
no_eligible_split_workspace="$(mktemp -d)"
git -C "$no_eligible_split_workspace" init -b main >/dev/null
git -C "$no_eligible_split_workspace" config user.name Brownie
git -C "$no_eligible_split_workspace" config user.email brownie@example.invalid
mkdir -p "$no_eligible_split_workspace/.brownie" "$no_eligible_split_workspace/docs" "$no_eligible_split_workspace/scripts"
printf '{"scripts":{"check":"node --check scripts/b.mjs"}}\n' > "$no_eligible_split_workspace/package.json"
printf 'status: pending\n' > "$no_eligible_split_workspace/docs/a.md"
printf 'export const ok = true;\n' > "$no_eligible_split_workspace/scripts/b.mjs"
# The fallback must validate the projected replan with the same canonical
# TODO-state resolver used after a real write.  Copy its small dependency
# closure into this clean fixture instead of accepting a text-only split.
cp "$REPO_ROOT/scripts/guard-todo-decomposition.mjs" "$no_eligible_split_workspace/scripts/guard-todo-decomposition.mjs"
cp "$REPO_ROOT/scripts/phase-loop-todo-state.mjs" "$no_eligible_split_workspace/scripts/phase-loop-todo-state.mjs"
cp "$REPO_ROOT/scripts/phase-loop-bounded-scope.mjs" "$no_eligible_split_workspace/scripts/phase-loop-bounded-scope.mjs"
cp "$REPO_ROOT/scripts/phase-loop-todo-queue-integrity.mjs" "$no_eligible_split_workspace/scripts/phase-loop-todo-queue-integrity.mjs"
cp "$REPO_ROOT/scripts/phase-loop-todo-contract-rebaseline.mjs" "$no_eligible_split_workspace/scripts/phase-loop-todo-contract-rebaseline.mjs"
printf 'base prompt\n' > "$no_eligible_split_prompt"
cat > "$no_eligible_split_workspace/.brownie/todo.md" <<'EOF'
- [ ] E-20g-final-judgment-sync: Patch only `docs/a.md`, `scripts/b.mjs` to synchronize final judgment and guard coverage:
  Route: implementation.
  Source TODO: E-20.
  Depends on: <none>.
  Completion condition: final judgment and guard coverage are synchronized without claiming Product Ready prematurely.
  Forbidden changes: do not edit unrelated files.
  Verification: run `pnpm --workspace-root check`.

- [ ] E-20h-next: Patch only `docs/a.md`:
  Route: documentation.
  Source TODO: E-20h: fixture downstream dependency.
  Depends on: E-20g-final-judgment-sync.
  Completion condition: the next step runs only after the final-judgment synchronization anchor is closed.
  Forbidden changes: do not edit unrelated files.
  Verification: run `pnpm --workspace-root check`.
EOF
cat > "$no_eligible_split_workspace/.brownie/todo-breakdown.md" <<'EOF'
# Breakdown

Parent TODO: E-20h: fixture downstream dependency.

Dependency graph:

- E-20h-next: E-20g-final-judgment-sync

Verification ledger:

- E-20h-next: `pnpm --workspace-root check`

Quality rubric:

- E-20h-next: downstream leaf remains schedulable only after the selected parent or its terminal replacement completes.
EOF
git -C "$no_eligible_split_workspace" add .
git -C "$no_eligible_split_workspace" commit -m init >/dev/null

# Preserve a clean copy of the same queue for the real regression: Runtime
# reports a resumable outer envelope, but its claim-scoped ledger records the
# exact terminal "no valid workspace.write" invariant.
terminal_write_split_state="$(mktemp -d)"
terminal_write_split_prompt="$(mktemp)"
terminal_write_split_workspace="$(mktemp -d)"
cp -R "$no_eligible_split_workspace/." "$terminal_write_split_workspace/"
printf 'base prompt\n' > "$terminal_write_split_prompt"

# A different terminal Runtime failure must never authorize a queue rewrite.
terminal_write_unrelated_state="$(mktemp -d)"
terminal_write_unrelated_prompt="$(mktemp)"
terminal_write_unrelated_workspace="$(mktemp -d)"
cp -R "$no_eligible_split_workspace/." "$terminal_write_unrelated_workspace/"
printf 'base prompt\n' > "$terminal_write_unrelated_prompt"

set +e
PHASE_LOOP_STATE_DIR="$no_eligible_split_state" \
PHASE_LOOP_PROMPT="$no_eligible_split_prompt" \
PHASE_LOOP_TODO="$no_eligible_split_workspace/.brownie/todo.md" \
PHASE_LOOP_TODO_BREAKDOWN="$no_eligible_split_workspace/.brownie/todo-breakdown.md" \
PHASE_LOOP_WORKSPACE_ROOT="$no_eligible_split_workspace" \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
PHASE_LOOP_TERMINAL_FAILURE_RETRY_CAP=1 \
BROWNIE_BIN="$fake_brownie_terminal_no_eligible" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null || true

PHASE_LOOP_STATE_DIR="$no_eligible_split_state" \
PHASE_LOOP_PROMPT="$no_eligible_split_prompt" \
PHASE_LOOP_TODO="$no_eligible_split_workspace/.brownie/todo.md" \
PHASE_LOOP_TODO_BREAKDOWN="$no_eligible_split_workspace/.brownie/todo-breakdown.md" \
PHASE_LOOP_WORKSPACE_ROOT="$no_eligible_split_workspace" \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
PHASE_LOOP_TERMINAL_FAILURE_RETRY_CAP=1 \
BROWNIE_BIN="$fake_brownie_terminal_no_eligible" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 0 "$PHASE_LOOP" run-once >/dev/null
no_eligible_split_exit="$?"
set -e
test "$no_eligible_split_exit" = "0"

if [ "$no_eligible_split_exit" = "0" ]; then
python3 - "$no_eligible_split_workspace/.brownie/todo.md" "$no_eligible_split_workspace/.brownie/todo-breakdown.md" "$no_eligible_split_state/status.json" "$no_eligible_split_workspace/.brownie/private/phase-loop/todo-replans" "$no_eligible_split_workspace/.brownie/private/phase-loop/task-ledger.jsonl" <<'PY'
import json
import pathlib
import re
import subprocess
import sys

todo = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
breakdown = pathlib.Path(sys.argv[2]).read_text(encoding="utf-8")
status = json.loads(pathlib.Path(sys.argv[3]).read_text(encoding="utf-8"))
replan_dir = pathlib.Path(sys.argv[4])
ledger_path = pathlib.Path(sys.argv[5])
records = list(replan_dir.glob("*.json"))
claim_archives = list(pathlib.Path(sys.argv[3]).parent.glob("todo-claims/replanned-terminal-multitarget-split-*.json"))
assert "- [x] E-20g-final-judgment-sync:" in todo, todo
assert "- [ ] E-20g-final-judgment-sync-target-01: Patch only `docs/a.md`" in todo, todo
assert "- [ ] E-20g-final-judgment-sync-target-02: Patch only `scripts/b.mjs`" in todo, todo
assert "Source TODO: E-20g-final-judgment-sync." in todo, todo
assert "Depends on: E-20g-final-judgment-sync-target-01." in todo, todo
assert re.search(
    r"E-20h-next:.*?Depends on: E-20g-final-judgment-sync-target-02\.",
    todo,
    re.S,
), todo
assert "Depends on: E-20g-final-judgment-sync." not in todo, todo
assert "E-20g-final-judgment-sync no-eligible multi-target split" in breakdown, breakdown
assert "- E-20h-next: E-20g-final-judgment-sync-target-02." in breakdown, breakdown
guard = subprocess.run(
    ["node", "scripts/guard-todo-decomposition.mjs", ".brownie/todo.md"],
    cwd=pathlib.Path(sys.argv[1]).parent.parent,
    text=True,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
)
assert guard.returncode == 0, (guard.stdout, guard.stderr)
queue_integrity = subprocess.run(
    [
        "node", "scripts/phase-loop-todo-queue-integrity.mjs",
        "--repo", ".", "--todo", ".brownie/todo.md", "--breakdown", ".brownie/todo-breakdown.md",
    ],
    cwd=pathlib.Path(sys.argv[1]).parent.parent,
    text=True,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
)
assert queue_integrity.returncode == 0, (queue_integrity.stdout, queue_integrity.stderr)
assert status["status"] == "last_run_succeeded", status
assert "terminal multi-target leaf split" in status["detail"], status
assert records, "missing replan record"
record_text = "\n".join(path.read_text(encoding="utf-8") for path in records)
assert "deterministic_no_eligible_multitarget_split" in record_text, record_text
assert '"record_type": "todo_replan"' in record_text, record_text
assert '"parent_status": "superseded_by_children"' in record_text, record_text
contract_rebaselines = list((pathlib.Path(sys.argv[1]).parent / "private/phase-loop/todo-claims/contract-rebaselines").glob("*.json"))
assert contract_rebaselines, "missing downstream dependency contract-rebaseline receipt"
contract_receipt_text = "\n".join(path.read_text(encoding="utf-8") for path in contract_rebaselines)
assert '"todo_id": "E-20h-next"' in contract_receipt_text, contract_receipt_text
assert '"changed_fields": [' in contract_receipt_text and '"depends_on"' in contract_receipt_text, contract_receipt_text
assert claim_archives, "missing completed no-eligible claim archive"
archived_claim = json.loads(claim_archives[-1].read_text(encoding="utf-8"))
assert archived_claim["status"] == "replanned", archived_claim
selected_first = str(archived_claim["selected_todo"]).splitlines()[0]
task_match = re.match(r"^\s*- \[ \]\s+([^:\s]+)", selected_first)
assert task_match, archived_claim
attempt_id = f"{task_match.group(1)}@{archived_claim['claim_id']}"
ledger_events = []
terminal_replan_transactions = []
for line in ledger_path.read_text(encoding="utf-8").splitlines():
    if not line.strip():
        continue
    record = json.loads(line)
    if record.get("kind") == "terminal_replan_transaction":
        terminal_replan_transactions.append(record)
    if record.get("kind") in {"replan_transaction", "terminal_replan_transaction"}:
        ledger_events.extend(record.get("events", []))
    else:
        ledger_events.append(record)
source_terminal_events = [event for event in ledger_events if event.get("task_id") == attempt_id and event.get("to_state") in {"completed", "blocked", "failed", "replanned"}]
assert source_terminal_events and source_terminal_events[-1]["to_state"] == "failed", (attempt_id, ledger_events)
matching_transactions = [
    record for record in terminal_replan_transactions
    if record.get("source_task_id") == attempt_id
    and record.get("claim_id") == archived_claim["claim_id"]
    and record.get("reason") == "terminal_multitarget_leaf_split"
]
assert len(matching_transactions) == 1, matching_transactions
derived_id = matching_transactions[0].get("replan_task_id")
derived_events = [event for event in ledger_events if event.get("task_id") == derived_id]
assert [event.get("to_state") for event in derived_events] == ["queued", "claimed", "running", "replanned"], derived_events
assert all(event.get("terminal_source_task_id") == attempt_id for event in derived_events), derived_events
assert not any(event.get("kind") == "unclaimed_trajectory" and event.get("trajectory_type") == "todo.replanned" for event in ledger_events), ledger_events
PY

# Liveness regression: after the replan, the next claim must reach a bounded
# child target and leave a real workspace diff.  A successful split alone is
# not delivery evidence.
PHASE_LOOP_STATE_DIR="$no_eligible_split_state" \
PHASE_LOOP_PROMPT="$no_eligible_split_prompt" \
PHASE_LOOP_TODO="$no_eligible_split_workspace/.brownie/todo.md" \
PHASE_LOOP_TODO_BREAKDOWN="$no_eligible_split_workspace/.brownie/todo-breakdown.md" \
PHASE_LOOP_WORKSPACE_ROOT="$no_eligible_split_workspace" \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
PHASE_LOOP_TEST_MUTATE_TARGET=1 \
BROWNIE_BIN="$fake_brownie_completed" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

python3 - "$no_eligible_split_state/status.json" "$no_eligible_split_workspace/.brownie/todo.md" "$no_eligible_split_workspace/docs/a.md" "$no_eligible_split_workspace/.brownie/private/phase-loop/task-ledger.jsonl" <<'PY'
import json
import pathlib
import re
import sys

status = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
todo = pathlib.Path(sys.argv[2]).read_text(encoding="utf-8")
target = pathlib.Path(sys.argv[3]).read_text(encoding="utf-8")
ledger = pathlib.Path(sys.argv[4]).read_text(encoding="utf-8")
assert status["status"] in {"last_run_succeeded", "pr_created"}, status
assert "phaseLoopCompletionFixtureCompleted" in target, target
assert not re.search(r"^- \[ \] E-20g-final-judgment-sync-target-01:", todo, re.M), todo
assert '"to_state":"completed"' in ledger or '"to_state": "completed"' in ledger, ledger
PY
else
assert_terminal_failure_claim_archived \
  "$no_eligible_split_state/todo-claims" \
  "$no_eligible_split_state/todo-claims/blocked.jsonl" \
  "$no_eligible_split_workspace/.brownie/private/phase-loop/task-ledger.jsonl" \
  'E-20g-final-judgment-sync:' 1
python3 - "$no_eligible_split_state/status.json" "$no_eligible_split_state/progress-state.json" "$no_eligible_split_state/todo-claims/blocked.jsonl" "$no_eligible_split_workspace/.brownie/private/phase-loop/task-ledger.jsonl" <<'PY'
import json
import pathlib
import sys

status = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
progress = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding="utf-8"))
blocked = [json.loads(line) for line in pathlib.Path(sys.argv[3]).read_text(encoding="utf-8").splitlines() if line.strip()]
ledger = pathlib.Path(sys.argv[4]).read_text(encoding="utf-8")
assert status["status"] == "blocked", status
assert status["exit_code"] in {"75", "76"}, status
assert progress["progress_projection"]["cli_status"] == "no_eligible_task", progress
assert progress["progress_projection"]["closure"] == "no_eligible_task", progress
if status["exit_code"] == "75":
    assert "Failed to claim first pending TODO" in status["detail"], status
else:
    assert "terminal_task_failed" in status["detail"], status
    assert progress["classification"] == "terminal_failure", progress
assert blocked and blocked[-1]["terminal_failure"] is True, blocked
assert blocked[-1]["block_reason"] == "terminal_runtime_failure", blocked
assert "terminal_failure_transaction" in ledger, ledger
PY
fi

# Regression for the production failure class: the headless response says
# `task_executed`/`resume`, while the claim-isolated Runtime ledger proves the
# selected multi-target task ended without any valid workspace.write proposal.
# The next controller run must perform exactly one audited replan, then the
# first child must be capable of producing a real target diff.
PHASE_LOOP_STATE_DIR="$terminal_write_split_state" \
PHASE_LOOP_PROMPT="$terminal_write_split_prompt" \
PHASE_LOOP_TODO="$terminal_write_split_workspace/.brownie/todo.md" \
PHASE_LOOP_TODO_BREAKDOWN="$terminal_write_split_workspace/.brownie/todo-breakdown.md" \
PHASE_LOOP_WORKSPACE_ROOT="$terminal_write_split_workspace" \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
BROWNIE_BIN="$fake_brownie_terminal_unproposed_workspace_write" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 76 "$PHASE_LOOP" run-once >/dev/null || true

python3 - "$terminal_write_split_state/status.json" "$terminal_write_split_state/progress-state.json" "$terminal_write_split_workspace/.brownie/todo.md" "$terminal_write_split_state/todo-claims/current.json" "$terminal_write_split_workspace/.brownie/private/phase-loop/task-ledger.jsonl" <<'PY'
import json
import pathlib
import re
import sys

status = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
progress = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding="utf-8"))
todo = pathlib.Path(sys.argv[3]).read_text(encoding="utf-8")
claim = json.loads(pathlib.Path(sys.argv[4]).read_text(encoding="utf-8"))
ledger = [json.loads(line) for line in pathlib.Path(sys.argv[5]).read_text(encoding="utf-8").splitlines() if line.strip()]
# A task-executed Runtime result with a terminal-evidence gap is a causeful
# controller failure, not an external-control boundary.  Keep the selected
# TODO/claim available for the bounded recovery path rather than hiding it in
# blocked.jsonl and skipping to unrelated work.
assert status["status"] == "blocked", status
assert status["exit_code"] == "76", status
assert "redelegatable recovery" in status["detail"], status
assert progress["classification"] == "terminal_failure", progress
assert progress["progress_projection"]["terminal_completion_evidence_missing_without_objective_apply"] is True, progress
assert progress["workspace_changed"] is False, progress
assert "- [ ] E-20g-final-judgment-sync:" in todo, todo
assert "E-20g-final-judgment-sync-target-01" not in todo, todo
# Retry cap zero must not erase the source task's causal terminal state or
# mint an unrelated retry claim.  The follow-up split needs this exact source
# attempt to be durably failed before it can replace the parent TODO.
assert claim["status"] == "failed", claim
assert progress["progress_projection"]["claim_id"] == claim["claim_id"], progress
assert not list(pathlib.Path(sys.argv[1]).parent.glob("todo-claims/stale-rebaseline-*.json"))
todo_id = re.match(r"^\s*- \[ \]\s+([^:\s]+)", claim["selected_todo"].splitlines()[0]).group(1)
source_task = f"{todo_id}@{claim['claim_id']}"
assert any(record.get("task_id") == source_task and record.get("to_state") == "failed" for record in ledger), ledger
PY

# Compatibility/liveness gate: records produced before the stdout snapshot
# hash was added must still recover only when the immutable claim-before-
# runtime snapshot proves an exact selected TODO match. This simulates the
# production incident's rebaselined claim without weakening the lineage gate.
python3 - "$terminal_write_split_state" <<'PY'
import json
import os
import pathlib
import tempfile
import sys

state_dir = pathlib.Path(sys.argv[1])
logs = sorted((state_dir / "runs").glob("*.stdout.log"))
assert len(logs) == 1, logs
path = logs[0]
payload = json.loads(path.read_text(encoding="utf-8"))
run = payload.get("run")
assert isinstance(run, dict), payload
assert run.pop("phase_loop_selected_todo_sha256", None), run
with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
    json.dump(payload, handle, ensure_ascii=False, sort_keys=True)
    handle.write("\n")
    handle.flush()
    os.fsync(handle.fileno())
    temporary = pathlib.Path(handle.name)
os.replace(temporary, path)
PY

PHASE_LOOP_STATE_DIR="$terminal_write_split_state" \
PHASE_LOOP_PROMPT="$terminal_write_split_prompt" \
PHASE_LOOP_TODO="$terminal_write_split_workspace/.brownie/todo.md" \
PHASE_LOOP_TODO_BREAKDOWN="$terminal_write_split_workspace/.brownie/todo-breakdown.md" \
PHASE_LOOP_WORKSPACE_ROOT="$terminal_write_split_workspace" \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
BROWNIE_BIN="$fake_brownie_terminal_unproposed_workspace_write" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 0 "$PHASE_LOOP" run-once >/dev/null

python3 - "$terminal_write_split_state/status.json" "$terminal_write_split_workspace/.brownie/todo.md" "$terminal_write_split_workspace/.brownie/todo-breakdown.md" "$terminal_write_split_workspace/.brownie/private/phase-loop/todo-replans" "$terminal_write_split_workspace/.brownie/private/phase-loop/task-ledger.jsonl" <<'PY'
import json
import pathlib
import re
import sys

status = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
todo = pathlib.Path(sys.argv[2]).read_text(encoding="utf-8")
breakdown = pathlib.Path(sys.argv[3]).read_text(encoding="utf-8")
records = list(pathlib.Path(sys.argv[4]).glob("*.json"))
ledger_path = pathlib.Path(sys.argv[5])
archives = list(pathlib.Path(sys.argv[1]).parent.glob("todo-claims/replanned-terminal-multitarget-split-*.json"))
assert status["status"] == "last_run_succeeded", status
assert "replanned, not completed" in status["detail"], status
assert "- [x] E-20g-final-judgment-sync:" in todo, todo
assert "- [ ] E-20g-final-judgment-sync-target-01: Patch only `docs/a.md`" in todo, todo
assert "- [ ] E-20g-final-judgment-sync-target-02: Patch only `scripts/b.mjs`" in todo, todo
assert re.search(r"E-20h-next:.*?Depends on: E-20g-final-judgment-sync-target-02\.", todo, re.S), todo
assert "terminal-unproposed-workspace-write multi-target split" in breakdown, breakdown
assert records, "missing terminal-write replan record"
record_text = "\n".join(path.read_text(encoding="utf-8") for path in records)
assert "terminal_unproposed_workspace_write_multitarget_split" in record_text, record_text
assert "prior_terminal_unproposed_workspace_write_ledger" in record_text, record_text
assert '"claim_snapshot_path"' in record_text, record_text
assert archives, "missing replanned terminal-write claim archive"
archived_claim = json.loads(archives[-1].read_text(encoding="utf-8"))
assert archived_claim["status"] == "replanned"
todo_id = re.match(r"^\s*- \[ \]\s+([^:\s]+)", str(archived_claim["selected_todo"]).splitlines()[0]).group(1)
source_attempt = f"{todo_id}@{archived_claim['claim_id']}"
ledger_records = [json.loads(line) for line in ledger_path.read_text(encoding="utf-8").splitlines() if line.strip()]
terminal_replans = [
    record for record in ledger_records
    if record.get("kind") == "terminal_replan_transaction"
    and record.get("source_task_id") == source_attempt
    and record.get("evidence_source") == "prior_terminal_unproposed_workspace_write_ledger"
]
assert len(terminal_replans) == 1, terminal_replans
events = terminal_replans[0].get("events", [])
derived_id = terminal_replans[0].get("replan_task_id")
derived_events = [event for event in events if event.get("task_id") == derived_id]
assert [event.get("to_state") for event in derived_events] == ["queued", "claimed", "running", "replanned"], derived_events
assert all(event.get("terminal_source_task_id") == source_attempt for event in derived_events), derived_events
PY

PHASE_LOOP_STATE_DIR="$terminal_write_split_state" \
PHASE_LOOP_PROMPT="$terminal_write_split_prompt" \
PHASE_LOOP_TODO="$terminal_write_split_workspace/.brownie/todo.md" \
PHASE_LOOP_TODO_BREAKDOWN="$terminal_write_split_workspace/.brownie/todo-breakdown.md" \
PHASE_LOOP_WORKSPACE_ROOT="$terminal_write_split_workspace" \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
PHASE_LOOP_TEST_MUTATE_TARGET=1 \
BROWNIE_BIN="$fake_brownie_completed" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

python3 - "$terminal_write_split_workspace/.brownie/todo.md" "$terminal_write_split_workspace/docs/a.md" <<'PY'
import pathlib
import re
import sys

todo = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
target = pathlib.Path(sys.argv[2]).read_text(encoding="utf-8")
assert "phaseLoopCompletionFixtureCompleted" in target, target
assert not re.search(r"^- \[ \] E-20g-final-judgment-sync-target-01:", todo, re.M), todo
PY

# Negative regression: a differently worded terminal Runtime failure is not
# sufficient evidence to rewrite even a multi-target TODO.
PHASE_LOOP_STATE_DIR="$terminal_write_unrelated_state" \
PHASE_LOOP_PROMPT="$terminal_write_unrelated_prompt" \
PHASE_LOOP_TODO="$terminal_write_unrelated_workspace/.brownie/todo.md" \
PHASE_LOOP_TODO_BREAKDOWN="$terminal_write_unrelated_workspace/.brownie/todo-breakdown.md" \
PHASE_LOOP_WORKSPACE_ROOT="$terminal_write_unrelated_workspace" \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
PHASE_LOOP_TEST_TERMINAL_UNPROPOSED_MODE=unrelated \
BROWNIE_BIN="$fake_brownie_terminal_unproposed_workspace_write" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 76 "$PHASE_LOOP" run-once >/dev/null || true

PHASE_LOOP_STATE_DIR="$terminal_write_unrelated_state" \
PHASE_LOOP_PROMPT="$terminal_write_unrelated_prompt" \
PHASE_LOOP_TODO="$terminal_write_unrelated_workspace/.brownie/todo.md" \
PHASE_LOOP_TODO_BREAKDOWN="$terminal_write_unrelated_workspace/.brownie/todo-breakdown.md" \
PHASE_LOOP_WORKSPACE_ROOT="$terminal_write_unrelated_workspace" \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
PHASE_LOOP_TEST_TERMINAL_UNPROPOSED_MODE=unrelated \
BROWNIE_BIN="$fake_brownie_terminal_unproposed_workspace_write" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" --expected-exit 76 "$PHASE_LOOP" run-once >/dev/null || true

python3 - "$terminal_write_unrelated_state/status.json" "$terminal_write_unrelated_workspace/.brownie/todo.md" "$terminal_write_unrelated_workspace/.brownie/private/phase-loop/todo-replans" <<'PY'
import json
import pathlib
import sys

status = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
todo = pathlib.Path(sys.argv[2]).read_text(encoding="utf-8")
replan_dir = pathlib.Path(sys.argv[3])
assert status["status"] == "blocked", status
assert status["exit_code"] in {"75", "76"}, status
assert "- [ ] E-20g-final-judgment-sync:" in todo, todo
assert "E-20g-final-judgment-sync-target-01" not in todo, todo
if replan_dir.exists():
    assert not list(replan_dir.glob("*.json")), list(replan_dir.glob("*.json"))
PY
fi

if claim_smoke_section_enabled feedback; then
repair_feedback_state="$(mktemp -d)"
repair_feedback_prompt="$(mktemp)"
repair_feedback_todo="$(mktemp)"
repair_feedback_workspace="$(mktemp -d)"
repair_feedback_argv="$repair_feedback_state/fake-brownie.argv"
git -C "$repair_feedback_workspace" init -b main >/dev/null
git -C "$repair_feedback_workspace" config user.name Brownie
git -C "$repair_feedback_workspace" config user.email brownie@example.invalid
mkdir -p "$repair_feedback_workspace/scripts"
printf '{"scripts":{"guard:todo-decomposition":"node scripts/guard-todo-decomposition.mjs"}}\n' > "$repair_feedback_workspace/package.json"
printf 'export const operationalEvidence = {};\n' > "$repair_feedback_workspace/scripts/release-runtime-operational-evidence.mjs"
git -C "$repair_feedback_workspace" add package.json
git -C "$repair_feedback_workspace" add scripts/release-runtime-operational-evidence.mjs
git -C "$repair_feedback_workspace" commit -m init >/dev/null
printf 'base prompt\n' > "$repair_feedback_prompt"
cat > "$repair_feedback_todo" <<'EOF'
- [ ] E-repair: Patch only `scripts/release-runtime-operational-evidence.mjs` to generate satisfied soak evidence.
  Route: implementation.
  Source TODO: E-repair-parent.
  Completion condition: generated satisfied soak evidence has all required stateful steps from a bounded Runtime fixture, not version-only repetition.
  Verification: run `pnpm --workspace-root guard:runtime-operational-evidence:test`.
EOF
mkdir -p "$repair_feedback_state/todo-claims"
cat > "$repair_feedback_state/progress-state.json" <<'EOF'
{
  "schema_version": 1,
  "progress_projection": {
    "route": "{\"command\":\"resume\",\"arguments\":[]}"
  }
}
EOF
cat > "$repair_feedback_state/todo-claims/current.json" <<'EOF'
{
  "claim_id": "todo-g1-repair",
  "queue_fingerprint": "abc",
  "queue_generation": 1,
  "run_stamp": "20260913T000000Z",
  "schema_version": 1,
  "selected_todo": "- [ ] E-repair: Patch only `scripts/release-runtime-operational-evidence.mjs` to generate satisfied soak evidence.\n  Route: implementation.\n  Source TODO: E-repair-parent.\n  Completion condition: generated satisfied soak evidence has all required stateful steps from a bounded Runtime fixture, not version-only repetition.\n  Verification: run `pnpm --workspace-root guard:runtime-operational-evidence:test`.",
  "status": "in_progress"
}
EOF
cat > "$repair_feedback_state/todo-claims/repair-feedback.json" <<'EOF'
{
  "claim_id": "todo-g1-repair",
  "reason": "semantic_completion_not_satisfied",
  "run_stamp": "20260913T000000Z",
  "schema_version": 1,
  "verification": {
    "actual": "not_executed",
    "completed": false,
    "expected": "sections.soak_test.status=satisfied",
    "reason": "semantic_completion_not_satisfied",
    "workspace_read_previews": [
      "workspace.read: completed path=scripts/release-runtime-operational-evidence.mjs preview=export const operationalEvidence = {};"
    ],
    "results": [
      {
        "command": "pnpm --workspace-root guard:runtime-operational-evidence:test",
        "exit_code": 0,
        "stdout_tail": "tests passed but soak_test.status remained not_executed",
        "stderr_tail": ""
      }
    ]
  }
}
EOF

fake_brownie_repair_feedback="$(mktemp)"
cat > "$fake_brownie_repair_feedback" <<'SH'
#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" > "$PHASE_LOOP_TEST_ARGV_FILE"
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
      "task_id": "task-repair",
      "run_id": "run-repair",
      "journey_id": "journey-repair",
      "next_action": "inspect_progress_overview",
      "next_invocation": {"command": "resume", "arguments": []}
    },
    "status": "task_executed",
    "session_id": "session-repair",
    "drive_id": "drive-repair",
    "task_id": "task-repair",
    "run_id": "run-repair",
    "journey_id": "journey-repair",
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
chmod +x "$fake_brownie_repair_feedback"

PHASE_LOOP_STATE_DIR="$repair_feedback_state" \
PHASE_LOOP_PROMPT="$repair_feedback_prompt" \
PHASE_LOOP_TODO="$repair_feedback_todo" \
PHASE_LOOP_WORKSPACE_ROOT="$repair_feedback_workspace" \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
PHASE_LOOP_TEST_ARGV_FILE="$repair_feedback_argv" \
BROWNIE_BIN="$fake_brownie_repair_feedback" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

repair_feedback_prompt_file="$(find "$repair_feedback_state/runs" -name '*.prompt.md' -print | sort | tail -n 1)"
python3 - "$repair_feedback_argv" "$repair_feedback_prompt_file" <<'PY'
import pathlib
import sys

argv = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
prompt = pathlib.Path(sys.argv[2]).read_text(encoding="utf-8")
assert "--json run --file" in argv, argv
assert "--json resume" not in argv, argv
assert "state: `verify_or_repair`" in prompt, prompt
assert "## Previous Repair Feedback" in prompt, prompt
assert "semantic_completion_not_satisfied" in prompt, prompt
assert "sections.soak_test.status=satisfied" in prompt, prompt
assert "leaf_required_next_tool_policy: the next tool must be `workspace.write` for `scripts/release-runtime-operational-evidence.mjs`" in prompt, prompt
assert "leaf_initial_read_policy" not in prompt, prompt
PY

# A failed or incomplete repair must retain its live feedback.  This is the
# negative half of the feedback state transition; a missing file is not a
# successful repair receipt.
python3 - "$repair_feedback_state/todo-claims/repair-feedback.json" <<'PY'
import json
import pathlib
import sys

feedback_path = pathlib.Path(sys.argv[1])
assert feedback_path.is_file(), feedback_path
feedback = json.loads(feedback_path.read_text(encoding="utf-8"))
assert feedback["claim_id"] == "todo-g1-repair", feedback
assert feedback.get("completed") is not True, feedback
assert feedback["reason"] == "semantic_completion_not_satisfied", feedback
PY

# A multi-target parent can begin with a test file while an exact Runtime
# rejection names a later structured target.  The generated prompt must retain
# every allowed target, select the rejected target for repair, and must not
# falsely constrain the invocation to the first test file.
multitarget_repair_state="$(mktemp -d)"
multitarget_repair_prompt="$(mktemp)"
multitarget_repair_todo="$(mktemp)"
multitarget_repair_workspace="$(mktemp -d)"
multitarget_repair_argv="$multitarget_repair_state/fake-brownie.argv"
git -C "$multitarget_repair_workspace" init -b main >/dev/null
git -C "$multitarget_repair_workspace" config user.name Brownie
git -C "$multitarget_repair_workspace" config user.email brownie@example.invalid
mkdir -p "$multitarget_repair_workspace/scripts" "$multitarget_repair_workspace/.github/workflows"
cat > "$multitarget_repair_workspace/package.json" <<'EOF'
{"scripts":{"guard:todo-decomposition":"node scripts/guard-todo-decomposition.mjs"}}
EOF
printf 'export const runtimeJourney = true;\n' > "$multitarget_repair_workspace/scripts/release-artifact-runtime-journey.mjs"
printf 'export const runtimeJourneyTest = true;\n' > "$multitarget_repair_workspace/scripts/release-artifact-runtime-journey.test.mjs"
printf 'name: release\n' > "$multitarget_repair_workspace/.github/workflows/release.yml"
git -C "$multitarget_repair_workspace" add .
git -C "$multitarget_repair_workspace" commit -m init >/dev/null
printf 'base prompt\n' > "$multitarget_repair_prompt"
cat > "$multitarget_repair_todo" <<'EOF'
- [ ] E-multitarget: Patch only `scripts/release-artifact-runtime-journey.test.mjs`, `scripts/release-artifact-runtime-journey.mjs`, and `package.json`, then patch only `.github/workflows/release.yml` to invoke them:
  Route: implementation.
  Source TODO: E-multitarget-parent.
  Depends on: <none>.
  Completion condition: the extracted package runs a bounded runtime journey.
  Forbidden changes: do not access production credentials.
  Verification: run `node --test scripts/release-artifact-runtime-journey.test.mjs`.
EOF
mkdir -p "$multitarget_repair_state/todo-claims"
cat > "$multitarget_repair_state/progress-state.json" <<'EOF'
{"schema_version":1,"progress_projection":{"route":"{\"command\":\"resume\",\"arguments\":[]}"}}
EOF
cat > "$multitarget_repair_state/todo-claims/current.json" <<'EOF'
{
  "claim_id": "todo-g1-multitarget",
  "queue_fingerprint": "multi",
  "queue_generation": 1,
  "run_stamp": "20260913T000002Z",
  "schema_version": 1,
  "selected_todo": "- [ ] E-multitarget: Patch only `scripts/release-artifact-runtime-journey.test.mjs`, `scripts/release-artifact-runtime-journey.mjs`, and `package.json`, then patch only `.github/workflows/release.yml` to invoke them:\n  Route: implementation.\n  Source TODO: E-multitarget-parent.\n  Depends on: <none>.\n  Completion condition: the extracted package runs a bounded runtime journey.\n  Forbidden changes: do not access production credentials.\n  Verification: run `node --test scripts/release-artifact-runtime-journey.test.mjs`.",
  "status": "in_progress"
}
EOF
cat > "$multitarget_repair_state/todo-claims/repair-feedback.json" <<'EOF'
{
  "claim_id": "todo-g1-multitarget",
  "kind": "phase_loop_objective_apply_rejected",
  "reason": "objective_apply_rejected_before_write",
  "repair_mode": "structured_candidate_repair",
  "run_stamp": "20260913T000002Z",
  "selected_target_path": "package.json",
  "objective_apply": {
    "operation": "replace_file",
    "reason": "candidate JSON is not parseable",
    "failed_checks": ["structured_content_parseable"],
    "applied": false
  },
  "verification": {
    "completed": false,
    "reason": "objective_apply_rejected_before_write",
    "repair_hint": "Read the exact target, form one complete replacement/patch candidate, and run the structured parse check."
  }
}
EOF

PHASE_LOOP_STATE_DIR="$multitarget_repair_state" \
PHASE_LOOP_PROMPT="$multitarget_repair_prompt" \
PHASE_LOOP_TODO="$multitarget_repair_todo" \
PHASE_LOOP_WORKSPACE_ROOT="$multitarget_repair_workspace" \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
PHASE_LOOP_TEST_ARGV_FILE="$multitarget_repair_argv" \
BROWNIE_BIN="$fake_brownie_repair_feedback" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

multitarget_repair_prompt_file="$(find "$multitarget_repair_state/runs" -name '*.prompt.md' -print | sort | tail -n 1)"
python3 - "$multitarget_repair_prompt_file" <<'PY'
import pathlib
import sys

prompt = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
assert "repair_selected_target_path: `package.json`" in prompt, prompt
assert "repair_mode: `structured_candidate_repair`" in prompt, prompt
assert 'objective_apply_failed_checks: ["structured_content_parseable"]' in prompt, prompt
assert "leaf_allowed_targets_policy" in prompt, prompt
assert "`scripts/release-artifact-runtime-journey.test.mjs`, `scripts/release-artifact-runtime-journey.mjs`, `package.json`, `.github/workflows/release.yml`" in prompt, prompt
assert "leaf_target_operations_policy: declared operations are `scripts/release-artifact-runtime-journey.test.mjs`=patch, `scripts/release-artifact-runtime-journey.mjs`=patch, `package.json`=patch, `.github/workflows/release.yml`=patch." in prompt, prompt
assert "test_leaf_execution_policy" not in prompt, prompt
assert "leaf_repair_target_policy: the previous Runtime feedback selected `package.json`" in prompt, prompt
assert "leaf_initial_read_policy: if the target contents are not already embedded in this prompt, the next tool may be exactly one `workspace.read` for `package.json`" in prompt, prompt
PY

# Feedback must never redirect the runtime to an arbitrary file outside the
# active TODO contract.  In that case prompt generation fails closed rather
# than falling back to the first listed test target.
python3 - "$multitarget_repair_state/todo-claims/repair-feedback.json" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
feedback = json.loads(path.read_text(encoding="utf-8"))
feedback["selected_target_path"] = "scripts/not-allowed.mjs"
path.write_text(json.dumps(feedback), encoding="utf-8")
PY
PHASE_LOOP_STATE_DIR="$multitarget_repair_state" \
PHASE_LOOP_PROMPT="$multitarget_repair_prompt" \
PHASE_LOOP_TODO="$multitarget_repair_todo" \
PHASE_LOOP_WORKSPACE_ROOT="$multitarget_repair_workspace" \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
PHASE_LOOP_TEST_ARGV_FILE="$multitarget_repair_argv" \
BROWNIE_BIN="$fake_brownie_repair_feedback" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

multitarget_out_of_scope_prompt_file="$(find "$multitarget_repair_state/runs" -name '*.prompt.md' -print | sort | tail -n 1)"
python3 - "$multitarget_out_of_scope_prompt_file" <<'PY'
import pathlib
import sys

prompt = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
assert "repair_selected_target_rejected_as_out_of_scope: `scripts/not-allowed.mjs`" in prompt, prompt
assert "leaf_scope_guard_policy" in prompt, prompt
assert "leaf_scope_guard_required_outcome" in prompt, prompt
assert "leaf_initial_read_policy" not in prompt, prompt
PY

# The operation must come from the selected repair target, rather than the
# first bounded clause. A later Patch-only target remains patchable even when
# the parent TODO starts by declaring a distinct Create-only target.
mixed_operation_state="$(mktemp -d)"
mixed_operation_prompt="$(mktemp)"
mixed_operation_todo="$(mktemp)"
mixed_operation_workspace="$(mktemp -d)"
mixed_operation_argv="$mixed_operation_state/fake-brownie.argv"
git -C "$mixed_operation_workspace" init -b main >/dev/null
git -C "$mixed_operation_workspace" config user.name Brownie
git -C "$mixed_operation_workspace" config user.email brownie@example.invalid
mkdir -p "$mixed_operation_workspace/scripts"
cat > "$mixed_operation_workspace/package.json" <<'EOF'
{"scripts":{"guard:todo-decomposition":"node scripts/guard-todo-decomposition.mjs"}}
EOF
printf 'export const existingRuntimeJourney = true;\n' > "$mixed_operation_workspace/scripts/existing-runtime-journey.mjs"
git -C "$mixed_operation_workspace" add package.json scripts
git -C "$mixed_operation_workspace" commit -m init >/dev/null
printf 'base prompt\n' > "$mixed_operation_prompt"
cat > "$mixed_operation_todo" <<'EOF'
- [ ] E-mixed-operation: Create only `scripts/new-runtime-journey.mjs` and Patch only `scripts/existing-runtime-journey.mjs`, then patch only `package.json` to invoke it:
  Route: implementation.
  Source TODO: E-mixed-operation-parent.
  Depends on: <none>.
  Completion condition: package invocation is patched while the new journey file remains a create target.
  Forbidden changes: do not access production credentials.
  Verification: run `node --test scripts/release-artifact-runtime-journey.test.mjs`.
EOF
mkdir -p "$mixed_operation_state/todo-claims"
cat > "$mixed_operation_state/progress-state.json" <<'EOF'
{"schema_version":1,"progress_projection":{"route":"{\"command\":\"resume\",\"arguments\":[]}"}}
EOF
cat > "$mixed_operation_state/todo-claims/current.json" <<'EOF'
{
  "claim_id": "todo-g1-mixed-operation",
  "queue_fingerprint": "mixed-operation",
  "queue_generation": 1,
  "run_stamp": "20260913T000003Z",
  "schema_version": 1,
  "selected_todo": "- [ ] E-mixed-operation: Create only `scripts/new-runtime-journey.mjs` and Patch only `scripts/existing-runtime-journey.mjs`, then patch only `package.json` to invoke it:\n  Route: implementation.\n  Source TODO: E-mixed-operation-parent.\n  Depends on: <none>.\n  Completion condition: package invocation is patched while the new journey file remains a create target.\n  Forbidden changes: do not access production credentials.\n  Verification: run `node --test scripts/release-artifact-runtime-journey.test.mjs`.",
  "status": "in_progress"
}
EOF
cat > "$mixed_operation_state/todo-claims/repair-feedback.json" <<'EOF'
{
  "claim_id": "todo-g1-mixed-operation",
  "kind": "phase_loop_objective_apply_rejected",
  "reason": "objective_apply_rejected_before_write",
  "repair_mode": "structured_candidate_repair",
  "run_stamp": "20260913T000003Z",
  "selected_todo_first_line": "- [ ] E-mixed-operation: Create only `scripts/new-runtime-journey.mjs` and Patch only `scripts/existing-runtime-journey.mjs`, then patch only `package.json` to invoke it:",
  "selected_target_path": "package.json",
  "objective_apply": {
    "operation": "replace_file",
    "reason": "candidate JSON is not parseable",
    "failed_checks": ["structured_content_parseable"],
    "applied": false
  },
  "verification": {
    "completed": false,
    "reason": "objective_apply_rejected_before_write",
    "repair_hint": "Read the exact target, form one complete replacement/patch candidate, and run the structured parse check."
  }
}
EOF
PHASE_LOOP_STATE_DIR="$mixed_operation_state" \
PHASE_LOOP_PROMPT="$mixed_operation_prompt" \
PHASE_LOOP_TODO="$mixed_operation_todo" \
PHASE_LOOP_WORKSPACE_ROOT="$mixed_operation_workspace" \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
PHASE_LOOP_TEST_ARGV_FILE="$mixed_operation_argv" \
BROWNIE_BIN="$fake_brownie_repair_feedback" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

mixed_operation_prompt_file="$(find "$mixed_operation_state/runs" -name '*.prompt.md' -print | sort | tail -n 1)"
python3 - "$mixed_operation_prompt_file" <<'PY'
import pathlib
import sys

prompt = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
assert "repair_selected_target_path: `package.json`" in prompt, prompt
assert "leaf_allowed_targets_policy: the only implementation targets allowed by this TODO are `scripts/new-runtime-journey.mjs`, `scripts/existing-runtime-journey.mjs`, `package.json`." in prompt, prompt
assert "leaf_target_operations_policy: declared operations are `scripts/new-runtime-journey.mjs`=create, `scripts/existing-runtime-journey.mjs`=patch, `package.json`=patch." in prompt, prompt
assert "leaf_repair_target_policy: the previous Runtime feedback selected `package.json`" in prompt, prompt
assert "leaf_initial_read_policy: if the target contents are not already embedded in this prompt, the next tool may be exactly one `workspace.read` for `package.json`" in prompt, prompt
assert "create_only_policy" not in prompt, prompt
assert "Create the named target file" not in prompt, prompt
PY

contract_replan_feedback_state="$(mktemp -d)"
contract_replan_feedback_prompt="$(mktemp)"
contract_replan_feedback_todo="$(mktemp)"
contract_replan_feedback_breakdown="$(mktemp)"
contract_replan_feedback_argv="$contract_replan_feedback_state/fake-brownie.argv"
mkdir -p "$contract_replan_feedback_state/todo-claims"
printf 'base prompt\n' > "$contract_replan_feedback_prompt"
printf '# Breakdown\n' > "$contract_replan_feedback_breakdown"
cat > "$contract_replan_feedback_todo" <<'EOF'
- [x] E-source: Patch only `scripts/release-local-artifact.mjs` to repair portable archive packaging.
  Route: implementation.
  Completion condition: source leaf was superseded after repeated failure.
  Verification: run `pnpm --workspace-root release:local-artifact:test`.

- [ ] E-replan: Patch only `scripts/release-runtime-operational-evidence.mjs` to replan the failed archive leaf.
  Route: todo-decomposition.
  Source TODO: E-source.
  Depends on: <none>.
  Completion condition: replace the failed leaf with implementable children.
  Forbidden changes: do not edit unrelated files.
  Verification: run `pnpm --workspace-root guard:todo-decomposition`.

- [x] E-completed-after-replan: Completed source must not extend the selected replan block.
  Route: implementation.
  Completion condition: this sentinel is not part of the selected replan TODO.
EOF
cat > "$contract_replan_feedback_state/progress-state.json" <<'EOF'
{"schema_version":1,"progress_projection":{"route":"{\"command\":\"resume\",\"arguments\":[]}"}}
EOF
cat > "$contract_replan_feedback_state/todo-claims/current.json" <<'EOF'
{
  "claim_id": "todo-g2-replan",
  "queue_fingerprint": "def",
  "queue_generation": 2,
  "run_stamp": "20260913T000001Z",
  "schema_version": 1,
  "selected_todo": "- [ ] E-replan: Patch only `scripts/release-runtime-operational-evidence.mjs` to replan the failed archive leaf.\n  Route: todo-decomposition.\n  Source TODO: E-source.\n  Completion condition: replace the failed leaf with implementable children.\n  Verification: run `pnpm --workspace-root guard:todo-decomposition`.",
  "status": "in_progress"
}
EOF
cat > "$contract_replan_feedback_state/todo-claims/repair-feedback.json" <<'EOF'
{
  "claim_id": "todo-g1-source",
  "kind": "phase_loop_todo_contract_replan_feedback",
  "reason": "supervisor_repeated_leaf_failure_requires_todo_contract_replan",
  "selected_todo_first_line": "- [ ] E-source: Patch only `scripts/release-local-artifact.mjs` to repair portable archive packaging.",
  "completed": false,
  "schema_version": 1
}
EOF

PHASE_LOOP_STATE_DIR="$contract_replan_feedback_state" \
PHASE_LOOP_PROMPT="$contract_replan_feedback_prompt" \
PHASE_LOOP_TODO="$contract_replan_feedback_todo" \
PHASE_LOOP_TODO_BREAKDOWN="$contract_replan_feedback_breakdown" \
PHASE_LOOP_WORKSPACE_ROOT="$repair_feedback_workspace" \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
PHASE_LOOP_TEST_ARGV_FILE="$contract_replan_feedback_argv" \
BROWNIE_BIN="$fake_brownie_repair_feedback" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

contract_replan_feedback_prompt_file="$(find "$contract_replan_feedback_state/runs" -name '*.prompt.md' -print | sort | tail -n 1)"
# A workspace-side ledger must not be accepted as a completion receipt for an
# externally configured controller state root.  Its claim id is tempting, but
# its run and task-spec bindings are intentionally forged.
mkdir -p "$repair_feedback_workspace/.brownie/private/phase-loop"
cat > "$repair_feedback_workspace/.brownie/private/phase-loop/task-ledger.jsonl" <<'EOF'
{"schema_version":1,"task_id":"E-source@todo-g1-source","from_state":"running","to_state":"completed","sequence":4,"run_id":"workspace-forgery","claim_id":"todo-g1-source","task_spec_sha256":"workspace-forgery"}
EOF

python3 - "$contract_replan_feedback_state/todo-claims/repair-feedback.json" "$contract_replan_feedback_state/todo-claims/repair-feedback-archive" "$contract_replan_feedback_prompt_file" "$contract_replan_feedback_state/status.json" "$contract_replan_feedback_state" "$repair_feedback_workspace" "$contract_replan_feedback_todo" "$contract_replan_feedback_breakdown" "$REPO_ROOT/scripts/guard-todo-decomposition.mjs" <<'PY'
import json
import hashlib
import pathlib
import re
import subprocess
import sys

feedback_path = pathlib.Path(sys.argv[1])
archive_dir = pathlib.Path(sys.argv[2])
prompt = pathlib.Path(sys.argv[3]).read_text(encoding="utf-8")
status_path = pathlib.Path(sys.argv[4])
state_dir = pathlib.Path(sys.argv[5])
workspace = pathlib.Path(sys.argv[6])
todo_path = pathlib.Path(sys.argv[7])
breakdown_path = pathlib.Path(sys.argv[8])
guard_script = pathlib.Path(sys.argv[9])
assert workspace.resolve() != state_dir.resolve(), (workspace, state_dir)
expected_claim_id = "todo-g1-source"
expected_kind = "phase_loop_todo_contract_replan_feedback"
expected_reason = "supervisor_repeated_leaf_failure_requires_todo_contract_replan"
if feedback_path.exists():
    feedback = json.loads(feedback_path.read_text(encoding="utf-8"))
    # The replan has not been verified in this invocation, so the live
    # failure feedback must remain available and incomplete.
    assert feedback["completed"] is False, feedback
    assert feedback["claim_id"] == expected_claim_id, feedback
    assert feedback["kind"] == expected_kind, feedback
    assert feedback["reason"] == expected_reason, feedback
else:
    # A repair-success path may consume the live record.  Missing is valid
    # only when the matching immutable audit archive proves that exact
    # feedback record was consumed; absence alone is never success.
    archives = []
    for candidate in sorted(archive_dir.glob("*.json")):
        try:
            archived = json.loads(candidate.read_text(encoding="utf-8"))
        except Exception:
            continue
        if (
            archived.get("claim_id") == expected_claim_id
            and archived.get("kind") == expected_kind
            and archived.get("reason") == expected_reason
        ):
            archives.append((candidate, archived))
    if archives:
        archive_path, archived = archives[-1]
        assert archived.get("completed") is False, archived
        assert archive_path.is_file(), archive_path
    else:
        # If an implementation consumes the live file without an archive,
        # require a matching successful claim/ledger transition and a clean
        # status. ENOENT by itself is never a success receipt.  Resolve every
        # audit input from the state directory that was passed to phase-loop;
        # the workspace ledger is deliberately not an alternative source.
        status = json.loads(status_path.read_text(encoding="utf-8"))
        assert status.get("status") == "last_run_succeeded", status
        expected_claim_path = (state_dir / "todo-claims/current.json").resolve()
        assert pathlib.Path(status["todo_claim"]).resolve() == expected_claim_path, status
        expected_queue_path = (state_dir / "todo-claims/todo-queue-state.json").resolve()
        assert pathlib.Path(status["todo_queue_state"]).resolve() == expected_queue_path, status
        queue = json.loads(expected_queue_path.read_text(encoding="utf-8"))
        assert pathlib.Path(queue["todo_path"]).resolve() == todo_path.resolve(), queue
        todo_text = todo_path.read_text(encoding="utf-8")
        assert hashlib.sha256(todo_text.encode("utf-8")).hexdigest() == queue["fingerprint"], queue
        source_match = re.search(
            r"(?ms)^- \[x\] E-source:.*?(?=^- \[[ xX]\] E-replan:|\Z)",
            todo_text,
        )
        assert source_match, todo_text
        source_todo = source_match.group(0).rstrip()
        source_todo_unchecked = re.sub(r"^(- )\[x\]", r"\1[ ]", source_todo, count=1)
        source_spec_hashes = {
            hashlib.sha256(value.encode("utf-8")).hexdigest()
            for value in (source_todo, source_todo_unchecked)
        }
        ledger_path = state_dir / "task-ledger.jsonl"
        matching_terminal = []
        if ledger_path.is_file():
            for line in ledger_path.read_text(encoding="utf-8").splitlines():
                if not line.strip():
                    continue
                record = json.loads(line)
                events = record.get("events", []) if record.get("kind") in {"replan_transaction", "terminal_failure_transaction", "terminal_replan_transaction"} else [record]
                for event in events:
                    task_id = str(event.get("task_id", ""))
                    if event.get("claim_id") != expected_claim_id:
                        continue
                    if event.get("run_id") != status.get("run_id"):
                        continue
                    if not (task_id == "E-source" or task_id.endswith(f"@{expected_claim_id}")):
                        continue
                    if event.get("task_spec_sha256") not in source_spec_hashes:
                        continue
                    if event.get("queue_generation") not in {None, queue["generation"]}:
                        continue
                    if event.get("queue_fingerprint") not in {None, queue["fingerprint"]}:
                        continue
                    if event.get("to_state") in {"completed", "replanned"}:
                        matching_terminal.append(event)
        guard = subprocess.run(
            ["node", str(guard_script), "--repo", str(workspace), "--todo", str(todo_path), "--breakdown", str(breakdown_path)],
            cwd=workspace,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        guard_success = guard.returncode == 0
        assert matching_terminal or guard_success, {
            "ledger_path": str(ledger_path),
            "ledger_exists": ledger_path.is_file(),
            "guard_stdout": guard.stdout[-2000:],
            "guard_stderr": guard.stderr[-2000:],
        }
assert "## Previous Repair Feedback" in prompt, prompt
assert "supervisor_repeated_leaf_failure_requires_todo_contract_replan" in prompt, prompt
assert "E-source" in prompt, prompt
selected = prompt.split("## Selected TODO", 1)[1].split("## TODO Queue Snapshot", 1)[0]
assert "E-completed-after-replan" not in selected, selected
PY

# The feedback was authored for the failed source claim.  Once that claim is
# archived, the controller must select its single matching decomposition TODO
# rather than retrying the earlier implementation leaf at the head of the queue.
rm -f "$contract_replan_feedback_state/todo-claims/current.json"
PHASE_LOOP_STATE_DIR="$contract_replan_feedback_state" \
PHASE_LOOP_PROMPT="$contract_replan_feedback_prompt" \
PHASE_LOOP_TODO="$contract_replan_feedback_todo" \
PHASE_LOOP_TODO_BREAKDOWN="$contract_replan_feedback_breakdown" \
PHASE_LOOP_WORKSPACE_ROOT="$repair_feedback_workspace" \
PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
PHASE_LOOP_TEST_ARGV_FILE="$contract_replan_feedback_argv" \
BROWNIE_BIN="$fake_brownie_repair_feedback" \
run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null

contract_replan_selection_prompt_file="$(find "$contract_replan_feedback_state/runs" -name '*.prompt.md' -print | sort | tail -n 1)"
python3 - "$contract_replan_selection_prompt_file" <<'PY'
import pathlib
import sys

prompt = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
selected = prompt.split("## Selected TODO", 1)[1].split("## TODO Queue Snapshot", 1)[0]
selected_first_line = next(line for line in selected.splitlines() if line.strip())
assert "E-replan" in selected_first_line, selected
assert "E-source" not in selected_first_line, selected
PY

python3 - "$PHASE_LOOP" <<'PY'
import pathlib
import sys

phase_loop = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
assert "todo_refinement_requires_todo_decomposition_route" in phase_loop, phase_loop
assert "only Route: todo-decomposition may replace a parent TODO with decomposition leaves" in phase_loop, phase_loop
assert "must_not_complete_by_todo_refinement_only" in phase_loop, phase_loop
assert "selected_target_implementation_required" in phase_loop, phase_loop
assert "try_terminal_multitarget_leaf_split_fallback" in phase_loop, phase_loop
assert "deterministic_no_eligible_multitarget_split" in phase_loop, phase_loop
assert "terminal_unproposed_workspace_write_multitarget_split" in phase_loop, phase_loop
assert "terminal_multitarget_leaf_split_pre_claim_exit" in phase_loop, phase_loop
# `skip` is the single formatter for structured fallback rejections; assert the
# branch rather than a whitespace-sensitive rendering of its JSON output.
assert 'skip("selected_todo_not_in_queue")' in phase_loop, phase_loop
assert '"reason":"claim_or_progress_state_missing"' in phase_loop, phase_loop
assert 'progress_projection.get("cli_status")' in phase_loop, phase_loop
assert '"non_progress_success"' in phase_loop, phase_loop
assert 'progress_not_terminal_non_progress_without_feedback' in phase_loop, phase_loop
assert 'prior_terminal_no_eligible_stdout' in phase_loop, phase_loop
assert 'prior_terminal_multitarget_split_evidence' in phase_loop, phase_loop
assert 'prior_terminal_unproposed_workspace_write_ledger' in phase_loop, phase_loop
assert 'evidence_source' in phase_loop, phase_loop
assert phase_loop.index("terminal_multitarget_leaf_split_pre_claim_exit") < phase_loop.index('if ! claim_first_pending_todo "$run_stamp"; then'), phase_loop
assert 'isolated_external_todo_state' in phase_loop, phase_loop
assert '"rolled_back": True' in phase_loop, phase_loop
assert "split_multitarget_or_force_bounded_workspace_write" in phase_loop, phase_loop
assert "TODO guard failure takes precedence over public-harness actionable-terminal feedback" in phase_loop, phase_loop
assert "harness_actionable_terminal_policy: suppressed because TODO queue repair is active" in phase_loop, phase_loop
assert "Live TODO decomposition guard preflight failed" in phase_loop, phase_loop
assert "stale selected-target repair feedback must not override this" in phase_loop, phase_loop
assert "parent_dependencies = split_dependency_ids(line_value(selected_block, \"Depends on:\"))" in phase_loop, phase_loop
assert "concrete_replacements" not in phase_loop, phase_loop
assert "not selected_decomposition_active" in phase_loop, phase_loop
assert "^\\s*Route:\\s*todo-decomposition\\.?\\s*$" in phase_loop, phase_loop
PY

# A controller-only ledger failure must terminalize the run.  In particular,
# the task-ledger path is made a directory so the first append fails after the
# claim has been created; this exercises the same downstream failure surface
# that previously left status.json at `running`.
ledger_failure_workspace="$(mktemp -d)"
git -C "$ledger_failure_workspace" init -b main >/dev/null
git -C "$ledger_failure_workspace" -c user.name=Brownie -c user.email=brownie@example.invalid commit --allow-empty -m init >/dev/null
mkdir -p "$ledger_failure_workspace/.brownie/private/phase-loop/task-ledger.jsonl"
ledger_failure_state="$(mktemp -d)"
ledger_failure_prompt="$(mktemp)"
ledger_failure_todo="$(mktemp)"
printf 'base prompt\n' > "$ledger_failure_prompt"
printf -- '- [ ] L-01: task-ledger failure terminalization\n' > "$ledger_failure_todo"

if PHASE_LOOP_STATE_DIR="$ledger_failure_state" \
  PHASE_LOOP_PROMPT="$ledger_failure_prompt" \
  PHASE_LOOP_TODO="$ledger_failure_todo" \
  PHASE_LOOP_WORKSPACE_ROOT="$ledger_failure_workspace" \
  BROWNIE_BIN="$fake_brownie_json" \
  run_with_timeout "$PHASE_LOOP_COMMAND_TIMEOUT_SECONDS" "$PHASE_LOOP" run-once >/dev/null 2>/dev/null; then
  echo "expected task-ledger append failure to fail run-once" >&2
  exit 1
fi
python3 - "$ledger_failure_state/status.json" <<'PY'
import json
import sys

status = json.load(open(sys.argv[1], encoding="utf-8"))
assert status["status"] != "running", status
assert status["status"] == "blocked", status
assert status["exit_code"] == "78", status
assert status["consecutive_failures"] >= 1, status
assert "Task ledger failed" in status["detail"], status
assert "stdout=" in status["detail"], status
assert "stderr=" in status["detail"], status
PY

run_status_write_signal_regression() {
  local signal_name="$1"
  local expected_exit_code="$2"
  local signal_state signal_prompt signal_todo signal_marker signal_run_pid signal_exit_code
  signal_state="$(mktemp -d)"
  signal_prompt="$(mktemp)"
  signal_todo="$(mktemp)"
  signal_marker="$signal_state/status-write.started"
  printf 'base prompt\n' > "$signal_prompt"
  printf -- '- [ ] S-01: signal during status write\n' > "$signal_todo"
  PHASE_LOOP_STATE_DIR="$signal_state" \
  PHASE_LOOP_PROMPT="$signal_prompt" \
  PHASE_LOOP_TODO="$signal_todo" \
  PHASE_LOOP_WORKSPACE_ROOT="$test_workspace" \
  PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK=1 \
  PHASE_LOOP_TEST_STATUS_WRITE_MARKER="$signal_marker" \
  PHASE_LOOP_TEST_STATUS_WRITE_DELAY_SECONDS=2 \
  BROWNIE_BIN="$fake_brownie_json" \
  python3 -c 'import os,signal,sys; signal.signal(signal.SIGINT, signal.SIG_DFL); signal.signal(signal.SIGTERM, signal.SIG_DFL); os.execv(sys.argv[1], sys.argv[1:])' "$PHASE_LOOP" run-once >/dev/null 2>/dev/null &
  signal_run_pid="$!"
  for _ in $(seq 1 40); do
    if [ -f "$signal_marker" ]; then
      break
    fi
    sleep 0.1
  done
  if [ ! -f "$signal_marker" ]; then
    echo "status write test window was not reached for SIG$signal_name" >&2
    kill -KILL "$signal_run_pid" 2>/dev/null || true
    wait "$signal_run_pid" 2>/dev/null || true
    exit 1
  fi
  kill -"$signal_name" "$signal_run_pid"
  set +e
  wait "$signal_run_pid"
  signal_exit_code="$?"
  set -e
  if kill -0 "$signal_run_pid" 2>/dev/null; then
    echo "physical process remained after deferred SIG$signal_name" >&2
    exit 1
  fi
  if [ "$signal_exit_code" -ne "$expected_exit_code" ]; then
    echo "expected deferred SIG$signal_name to exit $expected_exit_code, got $signal_exit_code" >&2
    exit 1
  fi
  python3 - "$signal_state/status.json" "$expected_exit_code" <<'PY'
import json
import sys

status = json.load(open(sys.argv[1], encoding="utf-8"))
assert status["status"] == "blocked", status
assert status["exit_code"] == sys.argv[2], status
assert status["consecutive_failures"] >= 1, status
assert "terminalized status before process exit" in status["detail"], status
PY
}

# Signals delivered during the atomic status-write window must be deferred
# until the replacement is visible, then terminalize the run instead of
# leaving status.json at `running`.
run_status_write_signal_regression TERM 143
run_status_write_signal_regression INT 130
fi

assert_repository_state_unchanged
echo "phase-loop claim smoke passed"
