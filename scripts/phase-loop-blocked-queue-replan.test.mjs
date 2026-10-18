import test from 'node:test';
import assert from 'node:assert/strict';
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
