import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
    env: { ...process.env, PHASE_LOOP_STATE_DIR: state, PHASE_LOOP_TODO: todo, PHASE_LOOP_TODO_BREAKDOWN: breakdown }
  });

  assert.match(selected, /E-23a-replan-stalled-leaf-abc123-leaf-01/);
  assert.match(selected, /REPLACED=1/);
  assert.ok(fs.existsSync(path.join(claims, 'stale-test-run.json')));
  assert.ok(fs.existsSync(path.join(claims, 'stale-test-run-1.json')));
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
