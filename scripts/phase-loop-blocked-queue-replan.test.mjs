import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyMergedDeliveryReverification } from './phase-loop-delivery-integrity.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const phaseLoop = path.join(repoRoot, 'phase-loop.sh');

test('creates one local blocked-queue replan for a stalled leaf even when unrelated blockers remain', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-blocked-queue-replan-'));
  const todo = path.join(dir, 'todo.md');
  const breakdown = path.join(dir, 'todo-breakdown.md');
  const state = path.join(dir, 'state');
  const blocked = path.join(state, 'todo-claims', 'blocked.jsonl');
  const stalledFirstLine = '- [ ] E-23a-portable-archive: Patch only `scripts/release.mjs`:';
  fs.mkdirSync(path.dirname(blocked), { recursive: true });
  fs.writeFileSync(todo, `${stalledFirstLine}\n  Route: implementation.\n  Source TODO: E-23a.\n  Depends on: <none>.\n  Completion condition: portable archive verification is implemented.\n  Forbidden changes: do not declare Product Ready.\n  Verification: run \`pnpm check\`.\n- [ ] E-23b-after-archive: Patch only \`scripts/consumer.mjs\`:\n  Route: implementation.\n  Source TODO: E-23b.\n  Depends on: E-23a-portable-archive.\n  Completion condition: dependent evidence is collected.\n  Forbidden changes: do not bypass archive verification.\n  Verification: run \`pnpm check\`.\n- [ ] E-20i-external: Blocker: owner must supply external release credentials.\n  Route: blocker.\n  Source TODO: E-20i.\n  Depends on: <none>.\n  Completion condition: owner provides credentials.\n  Forbidden changes: do not fabricate credentials.\n  Verification: owner acknowledgement.\n`);
  fs.writeFileSync(blocked, `${JSON.stringify({
    block_reason: 'stalled_leaf_contract_replan',
    selected_todo_first_line: stalledFirstLine
  })}\n`);

  const output = execFileSync('bash', [
    '-c',
    'script=$1; set --; source "$script" >/dev/null; ensure_blocked_todo_decomposition_request',
    '_',
    phaseLoop
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PHASE_LOOP_STATE_DIR: state,
      PHASE_LOOP_TODO: todo,
      PHASE_LOOP_TODO_BREAKDOWN: breakdown
    }
  }).trim();

  const updated = fs.readFileSync(todo, 'utf8');
  assert.match(output, /^TODO-decompose-blocked-queue-stalled-[a-f0-9]{12}$/);
  assert.match(updated, new RegExp(`- \\[ \\] ${output}:`));
  assert.match(updated, /Source TODO `E-23a-portable-archive` was recorded with `stalled_leaf_contract_replan`/);
  assert.match(updated, /Do not mark the stalled source TODO complete/);
  assert.doesNotMatch(updated, /TODO-decompose-blocked-queue-[a-f0-9]{12}: Decompose/);
});

test('archives a blocked active claim and selects its unblocked replan leaf', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-blocked-claim-reselect-'));
  const todo = path.join(dir, 'todo.md');
  const breakdown = path.join(dir, 'todo-breakdown.md');
  const state = path.join(dir, 'state');
  const claims = path.join(state, 'todo-claims');
  const blocked = path.join(claims, 'blocked.jsonl');
  const original = '- [ ] E-23a-portable-archive-target-01: Patch only `scripts/release.mjs`:\n  Route: implementation.\n  Source TODO: E-23a-portable-archive.\n  Depends on: <none>.\n  Completion condition: portable archive verification is implemented.\n  Forbidden changes: do not declare Product Ready.\n  Verification: run `pnpm check`.';
  const replan = '- [ ] E-23a-replan-stalled-leaf-abc123-leaf-01: Patch only `scripts/release.mjs`:\n  Route: implementation.\n  Source TODO: E-23a-replan-stalled-leaf-abc123.\n  Depends on: <none>.\n  Completion condition: portable archive verification is implemented.\n  Forbidden changes: do not declare Product Ready.\n  Verification: run `pnpm check`.';
  fs.mkdirSync(claims, { recursive: true });
  fs.writeFileSync(todo, `${original}\n${replan}\n`);
  fs.writeFileSync(blocked, `${JSON.stringify({
    selected_todo_first_line: original.split('\n')[0],
    block_reason: 'stalled_leaf_contract_replan',
    controller_fingerprint: execFileSync('bash', ['-c', 'script=$1; set --; source "$script" >/dev/null; phase_loop_controller_fingerprint', '_', phaseLoop], { cwd: repoRoot, encoding: 'utf8' }).trim()
  })}\n`);
  fs.writeFileSync(path.join(claims, 'current.json'), JSON.stringify({
    claim_id: 'blocked-claim',
    selected_todo: original,
    queue_fingerprint: 'old',
    queue_generation: 1,
    status: 'in_progress'
  }));

  const selected = execFileSync('bash', [
    '-c',
    'script=$1; set --; source "$script" >/dev/null; claim_first_pending_todo test-run >/dev/null; python3 - "$TODO_CLAIM_FILE" <<\'PY\'\nimport json, sys\nprint(json.load(open(sys.argv[1]))["selected_todo"])\nPY\nprintf "REPLACED=%s\\n" "$CLAIM_REPLACED_BLOCKED"; archive_stale_todo_claim test-run; ls "$TODO_CLAIM_DIR"',
    '_',
    phaseLoop
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    // This shell-level controller test invokes functions directly rather than
    // loading an operational deployment. Pin its target workspace explicitly
    // so a CI environment variable such as the literal string "null" cannot
    // turn the fixture into a configuration-dependent test.
    env: {
      ...process.env,
      PHASE_LOOP_WORKSPACE_ROOT: repoRoot,
      PHASE_LOOP_STATE_DIR: state,
      PHASE_LOOP_TODO: todo,
      PHASE_LOOP_TODO_BREAKDOWN: breakdown
    }
  });

  assert.match(selected, /E-23a-replan-stalled-leaf-abc123-leaf-01/);
  assert.match(selected, /REPLACED=1/);
  assert.ok(fs.existsSync(path.join(claims, 'stale-test-run.json')));
  assert.ok(fs.existsSync(path.join(claims, 'stale-test-run-1.json')));
});

test('archives only a closed unmerged review handoff with the single observed head mismatch', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-closed-handoff-recovery-'));
  const state = path.join(dir, 'state');
  const claims = path.join(state, 'todo-claims');
  const review = path.join(dir, 'review.json');
  const reconciliation = path.join(dir, 'reconciliation.json');
  fs.mkdirSync(claims, { recursive: true });
  fs.writeFileSync(path.join(claims, 'current.json'), JSON.stringify({
    claim_id: 'closed-handoff-claim',
    status: 'pr_pending_review',
    delivery_review: { head_oid: 'a'.repeat(40) },
    status_history: []
  }));
  fs.writeFileSync(review, JSON.stringify({
    number: 874,
    state: 'CLOSED',
    mergedAt: null,
    headRefOid: 'b'.repeat(40)
  }));
  fs.writeFileSync(reconciliation, JSON.stringify({
    reconciliation: { errors: ['implementation_head_mismatch'] }
  }));

  const output = execFileSync('bash', [
    '-c', 'script=$1; review=$2; reconciliation=$3; set --; source "$script" >/dev/null; phase_loop_archive_closed_head_mismatch_review_handoff test-run "$review" "$(cat "$reconciliation")"; printf "archive=%s\\n" "$PHASE_LOOP_LAST_CLAIM_ARCHIVE"',
    '_', phaseLoop, review, reconciliation
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, PHASE_LOOP_STATE_DIR: state }
  });

  assert.match(output, /closed-review-handoff-test-run\.json/);
  assert.equal(fs.existsSync(path.join(claims, 'current.json')), false);
  const archived = JSON.parse(fs.readFileSync(path.join(claims, 'closed-review-handoff-test-run.json'), 'utf8'));
  assert.equal(archived.status, 'review_handoff_invalidated');
  assert.equal(archived.archive_reason, 'closed_unmerged_review_handoff_head_mismatch');
  assert.deepEqual(archived.review_handoff_invalidation.reconciliation_errors, ['implementation_head_mismatch']);

  const retryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-closed-handoff-retry-id-'));
  const retryState = path.join(retryDir, 'state');
  const retryClaims = path.join(retryState, 'todo-claims');
  const retryTodo = path.join(retryDir, 'todo.md');
  const retryBreakdown = path.join(retryDir, 'todo-breakdown.md');
  const selectedTodo = '- [ ] E-closed-handoff-retry: Patch only `scripts/target.mjs`:\n  Route: implementation.\n  Source TODO: review-handoff-recovery.\n  Depends on: <none>.\n  Completion condition: a replacement claim uses an isolated Runtime store.\n  Forbidden changes: do not reuse a rejected Runtime session.\n  Verification: run `node --test scripts/target.test.mjs`.';
  fs.writeFileSync(retryTodo, `${selectedTodo}\n`);
  fs.writeFileSync(retryBreakdown, '# Breakdown\n');
  const retryEnv = {
    ...process.env,
    PHASE_LOOP_STATE_DIR: retryState,
    PHASE_LOOP_TODO: retryTodo,
    PHASE_LOOP_TODO_BREAKDOWN: retryBreakdown,
    PHASE_LOOP_WORKSPACE_ROOT: repoRoot
  };
  const firstClaimId = execFileSync('bash', [
    '-c', 'script=$1; set --; source "$script" >/dev/null; claim_first_pending_todo first >/dev/null; python3 - "$TODO_CLAIM_FILE" <<\'PY\'\nimport json, sys\nprint(json.load(open(sys.argv[1]))["claim_id"])\nPY',
    '_', phaseLoop
  ], { cwd: repoRoot, encoding: 'utf8', env: retryEnv }).trim();
  const retryCurrent = JSON.parse(fs.readFileSync(path.join(retryClaims, 'current.json'), 'utf8'));
  retryCurrent.delivery_review = { head_oid: 'c'.repeat(40) };
  fs.writeFileSync(path.join(retryClaims, 'current.json'), JSON.stringify(retryCurrent));
  const retryReview = path.join(retryDir, 'review.json');
  fs.writeFileSync(retryReview, JSON.stringify({ number: 875, state: 'CLOSED', mergedAt: null, headRefOid: 'd'.repeat(40) }));
  execFileSync('bash', [
    '-c', 'script=$1; review=$2; set --; source "$script" >/dev/null; phase_loop_archive_closed_head_mismatch_review_handoff retry "$review" \'{"reconciliation":{"errors":["implementation_head_mismatch"]}}\' ',
    '_', phaseLoop, retryReview
  ], { cwd: repoRoot, encoding: 'utf8', env: retryEnv });
  const replacementClaimId = execFileSync('bash', [
    '-c', 'script=$1; set --; source "$script" >/dev/null; claim_first_pending_todo replacement >/dev/null; python3 - "$TODO_CLAIM_FILE" <<\'PY\'\nimport json, sys\nprint(json.load(open(sys.argv[1]))["claim_id"])\nPY',
    '_', phaseLoop
  ], { cwd: repoRoot, encoding: 'utf8', env: retryEnv }).trim();
  assert.equal(replacementClaimId, `${firstClaimId}-r1`);

  fs.writeFileSync(path.join(claims, 'current.json'), JSON.stringify({
    claim_id: 'open-handoff-claim',
    delivery_review: { head_oid: 'a'.repeat(40) },
    status_history: []
  }));
  fs.writeFileSync(review, JSON.stringify({ number: 874, state: 'OPEN', mergedAt: null, headRefOid: 'b'.repeat(40) }));
  assert.throws(() => execFileSync('bash', [
    '-c', 'script=$1; review=$2; reconciliation=$3; set --; source "$script" >/dev/null; phase_loop_archive_closed_head_mismatch_review_handoff test-open "$review" "$(cat "$reconciliation")"',
    '_', phaseLoop, review, reconciliation
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, PHASE_LOOP_STATE_DIR: state }
  }));
  assert.equal(fs.existsSync(path.join(claims, 'current.json')), true);
});

test('preempts a stale continuation when its durable stalled replan is already queued', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-durable-replan-handoff-'));
  const workspace = path.join(dir, 'workspace');
  const todo = path.join(dir, 'todo.md');
  const breakdown = path.join(dir, 'todo-breakdown.md');
  const state = path.join(dir, 'state');
  const claims = path.join(state, 'todo-claims');
  const ledger = path.join(workspace, '.brownie/private/phase-loop/task-ledger.jsonl');
  const original = '- [ ] E-23c-release-artifact-runtime-journey-target-02: Patch only `scripts/release-artifact-runtime-journey.mjs`:\n  Route: implementation.\n  Source TODO: E-23c-release-artifact-runtime-journey.\n  Depends on: <none>.\n  Completion condition: the extracted package records an applied workspace mutation and stale replay rejection.\n  Forbidden changes: do not claim completion from a continuation alone.\n  Verification: run `node --test scripts/release-artifact-runtime-journey.test.mjs`.';
  const replan = '- [ ] E-23c-replan-stalled-leaf-2428108ecd17: Replan the stalled target-02 into bounded children:\n  Route: todo-decomposition.\n  Source TODO: E-23c-release-artifact-runtime-journey-target-02.\n  Depends on: <none>.\n  Completion condition: the stalled source is superseded without being marked complete.\n  Forbidden changes: do not retry the source continuation or mark it complete.\n  Verification: run `pnpm --workspace-root guard:todo-decomposition`.';
  const claim = {
    claim_id: 'e23c-stale-claim',
    selected_todo: original,
    queue_fingerprint: 'old',
    queue_generation: 1,
    status: 'in_progress'
  };
  fs.mkdirSync(claims, { recursive: true });
  fs.mkdirSync(path.dirname(ledger), { recursive: true });
  fs.writeFileSync(todo, `${original}\n${replan}\n`);
  fs.writeFileSync(breakdown, '# Breakdown\n');
  fs.writeFileSync(path.join(claims, 'current.json'), JSON.stringify(claim));
  fs.writeFileSync(ledger, `${JSON.stringify({
    schema_version: 1,
    kind: 'replan_transaction',
    events: [{
      task_id: 'E-23c-release-artifact-runtime-journey-target-02@e23c-stale-claim',
      claim_id: claim.claim_id,
      task_spec_sha256: crypto.createHash('sha256').update(original).digest('hex'),
      to_state: 'replanned',
      replaces: ['E-23c-replan-stalled-leaf-2428108ecd17']
    }]
  })}\n`);

  const output = execFileSync('bash', [
    '-c',
    'script=$1; set --; source "$script" >/dev/null; claim_first_pending_todo test-run >/dev/null; python3 - "$TODO_CLAIM_FILE" <<\'PY\'\nimport json, sys\nprint(json.load(open(sys.argv[1]))["selected_todo"])\nPY\nprintf "REPLACED=%s\\n" "$CLAIM_REPLACED_STALLED_REPLAN"',
    '_',
    phaseLoop
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PHASE_LOOP_STATE_DIR: state,
      PHASE_LOOP_TODO: todo,
      PHASE_LOOP_TODO_BREAKDOWN: breakdown,
      PHASE_LOOP_WORKSPACE_ROOT: workspace
    }
  });

  assert.match(output, /E-23c-replan-stalled-leaf-2428108ecd17/);
  assert.match(output, /REPLACED=1/);
  const archived = JSON.parse(fs.readFileSync(path.join(claims, 'stale-test-run.json'), 'utf8'));
  assert.equal(archived.claim_id, claim.claim_id);
  assert.equal(archived.status, 'stale_snapshot_rejected');
  assert.equal(archived.selected_todo, original);
});

test('archives a claim whose mutable snapshot no longer matches its ledger attempt', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-immutable-claim-refresh-'));
  const state = path.join(workspace, '.brownie/private/phase-loop-state');
  const todo = path.join(workspace, '.brownie/todo.md');
  const breakdown = path.join(workspace, '.brownie/todo-breakdown.md');
  const claims = path.join(state, 'todo-claims');
  const original = '- [ ] E-claim-snapshot: Patch only `scripts/release.mjs`:\n  Route: implementation.\n  Source TODO: E-parent.\n  Depends on: E-prerequisite.\n  Completion condition: original contract.\n  Forbidden changes: do not weaken validation.\n  Verification: run `pnpm check`.';
  const changed = original.replace('Depends on: E-prerequisite.', 'Depends on: <none>.');
  fs.mkdirSync(path.dirname(todo), { recursive: true });
  fs.mkdirSync(claims, { recursive: true });
  fs.writeFileSync(todo, `${changed}\n`);
  fs.writeFileSync(breakdown, '# Breakdown\n');
  fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ private: true, scripts: { 'phase-loop:todo-queue-integrity': 'node scripts/phase-loop-todo-queue-integrity.mjs' } }));
  fs.mkdirSync(path.join(workspace, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'scripts/phase-loop-todo-queue-integrity.mjs'), 'process.exit(0);\n');
  execFileSync('git', ['init', '-b', 'main'], { cwd: workspace, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: workspace });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: workspace });
  execFileSync('git', ['add', '.'], { cwd: workspace, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: workspace, stdio: 'ignore' });
  fs.writeFileSync(path.join(claims, 'current.json'), JSON.stringify({ claim_id: 'immutable-claim', selected_todo: changed, queue_fingerprint: 'old', queue_generation: 1, status: 'in_progress' }));
  fs.writeFileSync(path.join(state, 'task-ledger.jsonl'), `${JSON.stringify({
    task_id: 'E-claim-snapshot@immutable-claim', to_state: 'running', sequence: 3,
    task_spec_sha256: crypto.createHash('sha256').update(original).digest('hex')
  })}\n`);

  execFileSync('bash', ['-c', 'script=$1; set --; source "$script" >/dev/null; claim_first_pending_todo test-run', '_', phaseLoop], {
    cwd: repoRoot,
    env: { ...process.env, PHASE_LOOP_STATE_DIR: state, PHASE_LOOP_TODO: todo, PHASE_LOOP_TODO_BREAKDOWN: breakdown, PHASE_LOOP_WORKSPACE_ROOT: workspace },
    stdio: 'pipe'
  });

  const archived = JSON.parse(fs.readFileSync(path.join(claims, 'stale-test-run.json'), 'utf8'));
  const current = JSON.parse(fs.readFileSync(path.join(claims, 'current.json'), 'utf8'));
  assert.equal(archived.selected_todo, changed);
  assert.equal(archived.status, 'stale_snapshot_rejected');
  assert.equal(archived.status_history.at(-2).note, 'immutable_selected_todo_ledger_spec_mismatch');
  assert.equal(current.selected_todo, changed);
  assert.notEqual(current.claim_id, archived.claim_id);
});

test('keeps a valid claim through review-rework after supported same-head queue growth', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-claim-refresh-identity-'));
  const state = path.join(workspace, '.brownie/private/phase-loop-state');
  const todo = path.join(workspace, '.brownie/todo.md');
  const breakdown = path.join(workspace, '.brownie/todo-breakdown.md');
  const claims = path.join(state, 'todo-claims');
  const selected = '- [ ] E-claim-refresh: Patch only `scripts/release.mjs`:\n  Route: implementation.\n  Source TODO: E-parent.\n  Depends on: <none>.\n  Completion condition: preserve the claimed contract.\n  Forbidden changes: do not weaken validation.\n  Verification: run `pnpm check`.';
  const next = '- [ ] E-claim-refresh-next: Patch only `scripts/consumer.mjs`:\n  Route: implementation.\n  Source TODO: E-next.\n  Depends on: <none>.\n  Completion condition: queue growth is preserved.\n  Forbidden changes: do not retarget the active claim.\n  Verification: run `pnpm check`.';
  const originalTodo = `${selected}\n`;
  const grownTodo = `${selected}\n${next}\n`;
  fs.mkdirSync(path.dirname(todo), { recursive: true });
  fs.mkdirSync(claims, { recursive: true });
  fs.writeFileSync(todo, originalTodo);
  fs.writeFileSync(breakdown, '# Breakdown\n');
  fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ private: true }));
  execFileSync('git', ['init', '-b', 'main'], { cwd: workspace, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: workspace });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: workspace });
  execFileSync('git', ['add', '.'], { cwd: workspace, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'initial queue'], { cwd: workspace, stdio: 'ignore' });

  const initialFingerprint = crypto.createHash('sha256').update(originalTodo).digest('hex');
  const refreshedFingerprint = crypto.createHash('sha256').update(grownTodo).digest('hex');
  const output = execFileSync('bash', [
    '-c',
    'script=$1; selected=$2; next=$3; initial=$4; refreshed=$5; set --; source "$script" >/dev/null; write_todo_claim todo-g631-abcdef123456 in_progress "$selected" "$initial" 1 20261104T000000Z; printf "%s\\n%s\\n" "$selected" "$next" > "$PHASE_LOOP_TODO"; python3 - "$TODO_QUEUE_STATE_FILE" "$refreshed" <<\'PY\'\nimport json, sys\nfrom pathlib import Path\nPath(sys.argv[1]).parent.mkdir(parents=True, exist_ok=True)\nPath(sys.argv[1]).write_text(json.dumps({"generation": 2, "fingerprint": sys.argv[2]}) + "\\n", encoding="utf-8")\nPY\nrefresh_active_todo_claim_from_live_queue review-rework; quarantine_incomplete_active_todo_claim review-rework; python3 - "$TODO_CLAIM_FILE" <<\'PY\'\nimport json, sys\nprint(json.dumps(json.load(open(sys.argv[1])), sort_keys=True))\nPY',
    '_',
    phaseLoop,
    selected,
    next,
    initialFingerprint,
    refreshedFingerprint
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PHASE_LOOP_STATE_DIR: state,
      PHASE_LOOP_TODO: todo,
      PHASE_LOOP_TODO_BREAKDOWN: breakdown,
      PHASE_LOOP_WORKSPACE_ROOT: workspace
    }
  });

  const claim = JSON.parse(output.trim().split('\n').at(-1));
  assert.equal(claim.claim_id, 'todo-g631-abcdef123456');
  assert.equal(claim.run_stamp, 'review-rework');
  assert.equal(claim.selected_todo, selected);
  assert.equal(claim.selected_todo_id, 'E-claim-refresh');
  assert.equal(claim.selected_todo_sha256, crypto.createHash('sha256').update(selected).digest('hex'));
  assert.equal(claim.queue_fingerprint, refreshedFingerprint);
  assert.equal(claim.queue_generation, 2);
  assert.equal(claim.claim_admission.kind, 'phase_loop_fresh_claim_admission');
  assert.equal(claim.claim_admission.claim_id, claim.claim_id);
  assert.equal(claim.claim_admission.queue_fingerprint, initialFingerprint);
  assert.equal(claim.claim_admission.queue_generation, 1);
  assert.equal(claim.claim_refresh_context.kind, 'phase_loop_supported_refresh_context');
  assert.equal(claim.claim_refresh_context.queue_fingerprint, refreshedFingerprint);
  assert.equal(claim.claim_refresh_context.queue_generation, 2);
  assert.ok(!fs.existsSync(path.join(claims, 'incomplete-claim-quarantine')));
});

test('liveness claims a clean merged delivery after an archived terminal attempt without mutating the queue', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-legacy-terminal-merged-claim-'));
  const state = path.join(workspace, '.brownie/private/phase-loop-state');
  const todo = path.join(workspace, '.brownie/todo.md');
  const breakdown = path.join(workspace, '.brownie/todo-breakdown.md');
  const claims = path.join(state, 'todo-claims');
  const target = path.join(workspace, 'scripts/soak.mjs');
  const selected = '- [ ] E-legacy-terminal-merged-soak: Patch only `scripts/soak.mjs`:\n  Route: implementation.\n  Depends on: <none>.\n  Completion condition: a reviewed merged soak is reverified before queue consumption.\n  Forbidden changes: do not treat a terminal history record as completion.\n  Verification: run `node --check scripts/soak.mjs`.';
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.mkdirSync(path.dirname(todo), { recursive: true });
  fs.mkdirSync(claims, { recursive: true });
  fs.mkdirSync(path.join(state, 'logs'), { recursive: true });
  fs.writeFileSync(target, 'export const soak = "before";\n');
  fs.writeFileSync(todo, `${selected}\n`);
  fs.writeFileSync(breakdown, '# Existing breakdown remains byte-for-byte stable.\n');
  fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ private: true }));
  execFileSync('git', ['init', '-b', 'main'], { cwd: workspace, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'fixture@example.invalid'], { cwd: workspace });
  execFileSync('git', ['config', 'user.name', 'fixture'], { cwd: workspace });
  execFileSync('git', ['add', '.'], { cwd: workspace, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'baseline'], { cwd: workspace, stdio: 'ignore' });
  execFileSync('git', ['switch', '-c', 'implementation'], { cwd: workspace, stdio: 'ignore' });
  fs.writeFileSync(target, 'export const soak = "merged";\n');
  execFileSync('git', ['add', 'scripts/soak.mjs'], { cwd: workspace, stdio: 'ignore' });
  const selectedHash = crypto.createHash('sha256').update(selected).digest('hex');
  execFileSync('git', ['commit', '-m', `implement soak\n\nBrownie-Task-Todo: E-legacy-terminal-merged-soak\nBrownie-Task-Spec-SHA256: ${selectedHash}`], { cwd: workspace, stdio: 'ignore' });
  execFileSync('git', ['switch', 'main'], { cwd: workspace, stdio: 'ignore' });
  execFileSync('git', ['merge', '--no-ff', '--no-edit', 'implementation'], { cwd: workspace, stdio: 'ignore' });

  const controller = execFileSync('bash', ['-c', 'script=$1; set --; source "$script" >/dev/null; phase_loop_controller_fingerprint', '_', phaseLoop], { cwd: repoRoot, encoding: 'utf8' }).trim();
  const archivedPath = path.join(claims, 'stale-legacy-terminal.json');
  const archived = {
    claim_id: 'todo-g630-legacy', selected_todo: selected, status: 'failed',
    archive_reason: 'terminal_failure_blocked_evidence_failed', retry_eligible: false
  };
  fs.writeFileSync(archivedPath, `${JSON.stringify(archived)}\n`);
  fs.writeFileSync(path.join(claims, 'blocked.jsonl'), `${JSON.stringify({
    block_reason: 'terminal_runtime_failure', controller_fingerprint: controller,
    selected_todo_sha256: selectedHash, retry_cap: 0
  })}\n`);
  const todoBefore = fs.readFileSync(todo, 'utf8');
  const breakdownBefore = fs.readFileSync(breakdown, 'utf8');
  const archiveBefore = fs.readFileSync(archivedPath, 'utf8');

  const output = execFileSync('bash', [
    '-c',
    'script=$1; set --; source "$script" >/dev/null; claim_first_pending_todo legacy-terminal-liveness; python3 - "$TODO_CLAIM_FILE" <<\'PY\'\nimport json, sys\nprint(json.dumps(json.load(open(sys.argv[1])), sort_keys=True))\nPY',
    '_', phaseLoop
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PHASE_LOOP_STATE_DIR: state,
      PHASE_LOOP_TODO: todo,
      PHASE_LOOP_TODO_BREAKDOWN: breakdown,
      PHASE_LOOP_WORKSPACE_ROOT: workspace
    }
  });
  const claim = JSON.parse(output.trim().split('\n').at(-1));
  assert.equal(claim.status, 'in_progress');
  assert.equal(claim.selected_todo_id, 'E-legacy-terminal-merged-soak');
  assert.equal(claim.selected_todo_sha256, selectedHash);
  assert.match(claim.claim_id, /^todo-g\d+-[a-f0-9]{12}(?:-r\d+)?$/);
  assert.equal(fs.readFileSync(todo, 'utf8'), todoBefore);
  assert.equal(fs.readFileSync(breakdown, 'utf8'), breakdownBefore);
  assert.equal(fs.readFileSync(archivedPath, 'utf8'), archiveBefore);
  assert.equal(execFileSync('git', ['diff', '--name-only', 'HEAD', '--', 'scripts/soak.mjs'], { cwd: workspace, encoding: 'utf8' }), '');
  assert.equal(execFileSync('git', ['ls-files', '--others', '--exclude-standard', '--', 'scripts/soak.mjs'], { cwd: workspace, encoding: 'utf8' }), '');
  assert.match(fs.readFileSync(path.join(state, 'logs', 'supervisor.log'), 'utf8'), /terminal_failure_retry_suppression_bypassed_for_clean_merged_delivery=true/);
  const dispatchGate = execFileSync('bash', [
    '-c', 'script=$1; set --; source "$script" >/dev/null; CLAIM_CREATED_THIS_RUN=1; active_fresh_claim_has_clean_merged_delivery_candidate; printf "dispatch_gate=%s\\n" "$?"',
    '_', phaseLoop
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PHASE_LOOP_STATE_DIR: state,
      PHASE_LOOP_TODO: todo,
      PHASE_LOOP_TODO_BREAKDOWN: breakdown,
      PHASE_LOOP_WORKSPACE_ROOT: workspace
    }
  });
  assert.match(dispatchGate, /dispatch_gate=0/);
  assert.match(fs.readFileSync(path.join(state, 'logs', 'supervisor.log'), 'utf8'), /active_fresh_claim_stable_block_bypassed_for_clean_merged_delivery=true/);
  const controllerSource = fs.readFileSync(phaseLoop, 'utf8');
  assert.match(
    controllerSource,
    /if active_fresh_claim_has_clean_merged_delivery_candidate; then\n\s+phase_loop_reverify_and_consume_merged_delivery "\$run_stamp" "\$stdout_log" "\$run_id"\n\s+return \$\?\n\s+fi\n\s+local objective_handoff_status\n\s+if phase_loop_handoff_verified_completion/u,
    'a fresh claim with an exact clean merge must reverify and consume it before publishing another PR'
  );
  // The same archived-terminal/current-claim-absent fixture must cross the
  // pre-dispatch gate and bind fake Runtime execution to re-verification; a
  // fresh claim alone is not liveness success.
  const mergeOid = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8' }).trim();
  const headOid = execFileSync('git', ['rev-parse', 'HEAD^2'], { cwd: workspace, encoding: 'utf8' }).trim();
  const reverified = verifyMergedDeliveryReverification({
    repoRoot: workspace,
    claim,
    stdoutPayload: { run: { runtime_claim_id: claim.claim_id, payload_status: 'task_executed', reported_executed_count: 1 } },
    review: {
      pr_url: 'https://example.invalid/pull/1', pr_number: 1, state: 'MERGED', merge_commit_oid: mergeOid, head_oid: headOid,
      author: 'implementation', reviewer: 'review', merge_actor: 'review', merged_at: '2026-11-04T09:38:12Z', observed_at: '2026-11-04T11:39:21Z', approved: true, ci_passed: true,
      latest_reviewer_review_state: 'APPROVED', latest_reviewer_review_commit_oid: headOid
    },
    reviewer: 'review', implementation: 'implementation'
  });
  assert.equal(reverified.valid, true, JSON.stringify(reverified));
});

test('claims a generated blocked-queue decomposition from the same TODO snapshot and CAS', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-blocked-queue-generated-claim-'));
  const state = path.join(workspace, '.brownie/private/phase-loop-state');
  const todo = path.join(workspace, '.brownie/todo.md');
  const breakdown = path.join(workspace, '.brownie/todo-breakdown.md');
  const target = path.join(workspace, 'scripts/release-supply-chain-artifact-evidence.mjs');
  const source = '- [ ] E-23a-portable-archive: Patch only \`scripts/release-supply-chain-artifact-evidence.mjs\`:\n  Route: implementation.\n  Depends on: <none>.\n  Completion condition: portable archive verification is implemented.\n  Forbidden changes: do not declare Product Ready.\n  Verification: inspect/blocker/fail-closed.';
  fs.mkdirSync(path.dirname(todo), { recursive: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({
    private: true,
    scripts: {
      'guard:todo-decomposition': 'node scripts/guard-todo-decomposition.mjs',
      'phase-loop:todo-queue-integrity': 'node scripts/phase-loop-todo-queue-integrity.mjs'
    }
  }));
  fs.writeFileSync(target, 'export const evidence = {};\n');
  fs.writeFileSync(todo, source + '\n');
  fs.writeFileSync(breakdown, '# Breakdown\n');
  execFileSync('git', ['init', '-b', 'main'], { cwd: workspace, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: workspace });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: workspace });
  execFileSync('git', ['add', '.'], { cwd: workspace });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: workspace, stdio: 'ignore' });

  const claims = path.join(state, 'todo-claims');
  const blocked = path.join(claims, 'blocked.jsonl');
  fs.mkdirSync(claims, { recursive: true });
  fs.writeFileSync(blocked, JSON.stringify({
    block_reason: 'stalled_leaf_contract_replan',
    selected_todo_first_line: source.split('\n')[0]
  }) + '\n');
  const breakdownBefore = fs.readFileSync(breakdown, 'utf8');

  const result = execFileSync('bash', [
    '-c',
    'script=$1; set --; source "$script" >/dev/null; generated="$(ensure_blocked_todo_decomposition_request)"; claim_first_pending_todo test-run; printf "GENERATED=%s\n" "$generated"; python3 - "$TODO_CLAIM_FILE" "$TODO_QUEUE_STATE_FILE" <<\'PY\'\nimport json, sys\nclaim = json.load(open(sys.argv[1], encoding="utf-8"))\nqueue = json.load(open(sys.argv[2], encoding="utf-8"))\nprint(json.dumps({"claim": claim, "queue": queue}, sort_keys=True))\nPY',
    '_',
    phaseLoop
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PHASE_LOOP_STATE_DIR: state,
      PHASE_LOOP_TODO: todo,
      PHASE_LOOP_TODO_BREAKDOWN: breakdown,
      PHASE_LOOP_WORKSPACE_ROOT: workspace
    }
  });

  const generated = result.match(/^GENERATED=(TODO-decompose-blocked-queue-[a-f0-9]{12})$/mu)?.[1];
  assert.ok(generated, result);
  const payload = JSON.parse(result.trim().split('\n').at(-1));
  assert.equal(payload.claim.status, 'in_progress', payload);
  const generatedHeading = new RegExp('- \\[ \\] ' + generated + ':');
  assert.match(payload.claim.selected_todo, generatedHeading);
  assert.equal(payload.claim.queue_fingerprint, payload.queue.fingerprint, payload);
  assert.equal(fs.readFileSync(breakdown, 'utf8'), breakdownBefore);
  assert.match(fs.readFileSync(todo, 'utf8'), generatedHeading);
  assert.match(fs.readFileSync(todo, 'utf8'), /\.brownie\/todo-breakdown\.md/u);
});
