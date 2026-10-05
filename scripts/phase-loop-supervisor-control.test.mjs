import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { controlPhaseLoop } from './phase-loop-supervisor-control.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const runtimeEvidenceTodo = `- [ ] E-21c-runtime-operational-evidence-impl-2-target-02: Patch only \`scripts/guard-runtime-operational-evidence.test.mjs\` to require runtime operational evidence to model release operation as executable fail-closed evidence:
  Route: implementation.
  Source TODO: E-21c-runtime-operational-evidence.
  Depends on: <none>.
  Completion condition: the runtime operational evidence guard test rejects non-executable evidence and accepts valid executable evidence without weakening the release evidence contract.
  Forbidden changes: do not remove assertions or weaken the guard/test contract.
  Verification: run \`pnpm --workspace-root release:runtime-operational-evidence:test\`.`;

const ownerBlockerTodo = `- [ ] E-20i-runtime-release-ops-blocker: Blocker: Owner-controlled Runtime Release Ops authority is required for clean CI build, artifact upload/provenance, and GitHub Release publication.
  Route: blocker.
  Source TODO: E-20i-runtime-release-ops-blockers.
  Depends on: <none>.
  Completion condition: release engineering owner provides or documents the Runtime Release Ops authority needed for clean CI builds, artifact upload/provenance binding, and GitHub Release publication. Customer or Enterprise production deployment credentials are explicitly out of Runtime Product Ready scope and must not block the OSS Runtime release.
  Forbidden changes: do not attempt to configure external CI/CD, create credentials, publish a GitHub Release, or request customer/Enterprise production deployment credentials.
  Verification: inspect/blocker/fail-closed.`;

function makeRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-supervisor-control-'));
  fs.mkdirSync(path.join(repo, '.brownie/private/phase-loop/todo-claims'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({
    scripts: {
      'release:runtime-operational-evidence:test': 'node --test scripts/guard-runtime-operational-evidence.test.mjs',
      'guard:todo-decomposition': 'node scripts/guard-todo-decomposition.mjs',
      'phase-loop:todo-queue-integrity': 'node scripts/phase-loop-todo-queue-integrity.mjs'
    }
  }, null, 2));
  fs.writeFileSync(path.join(repo, 'scripts/guard-runtime-operational-evidence.test.mjs'), 'export const ok = true;\n');
  fs.copyFileSync(
    path.join(__dirname, 'phase-loop-todo-queue-integrity.mjs'),
    path.join(repo, 'scripts/phase-loop-todo-queue-integrity.mjs')
  );
  fs.copyFileSync(
    path.join(__dirname, 'guard-todo-decomposition.mjs'),
    path.join(repo, 'scripts/guard-todo-decomposition.mjs')
  );
  execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo });
  execFileSync('git', ['add', 'package.json', 'scripts/guard-runtime-operational-evidence.test.mjs', 'scripts/phase-loop-todo-queue-integrity.mjs', 'scripts/guard-todo-decomposition.mjs'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: repo, stdio: 'ignore' });
  return repo;
}

function writeJson(repo, relativePath, value) {
  const file = path.join(repo, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeTodo(repo) {
  fs.mkdirSync(path.join(repo, '.brownie'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.brownie/todo.md'), `${runtimeEvidenceTodo}\n`);
  fs.writeFileSync(path.join(repo, '.brownie/todo-breakdown.md'), `# breakdown

Dependency graph:
- E-21c-runtime-operational-evidence-impl-2-target-02: <none>

Verification ledger:
- E-21c-runtime-operational-evidence-impl-2-target-02: pnpm --workspace-root release:runtime-operational-evidence:test

Quality rubric:
- E-21c-runtime-operational-evidence-impl-2-target-02: bounded leaf
`);
  execFileSync('git', ['add', '.brownie/todo.md', '.brownie/todo-breakdown.md'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'todo fixture'], { cwd: repo, stdio: 'ignore' });
}

test('escalates repeated no-progress on the same bounded leaf to TODO contract replan feedback', () => {
  const repo = makeRepo();
  writeTodo(repo);
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'no_progress',
    run_id: 'run-no-progress',
    consecutive_failures: 2,
    detail: 'Brownie run exited successfully but repeated the same non-progress fingerprint'
  });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress',
    same_progress_count: 3,
    run_stamp: '20261003T170000Z',
    progress_projection: {
      cli_status: 'no_eligible_task',
      closure: 'no_eligible_task',
      claim_id: 'claim-repeated-no-progress',
      selected_todo: runtimeEvidenceTodo
    }
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/current.json', {
    claim_id: 'claim-repeated-no-progress',
    status: 'claimed',
    selected_todo: runtimeEvidenceTodo
  });

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });
  const feedback = JSON.parse(fs.readFileSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/repair-feedback.json'), 'utf8'));
  const ledger = fs.readFileSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/failure-ledger.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const blocked = fs.readFileSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/blocked.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const todo = fs.readFileSync(path.join(repo, '.brownie/todo.md'), 'utf8');

  assert.equal(result.repair.todo_contract_replan.attempted, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.todo_contract_replan.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.stalled_todo_blocked.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.stalled_todo_decomposition.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.post_repair_validation.ok, true, JSON.stringify(result, null, 2));
  assert.deepEqual(result.repair.post_repair_validation.failed_steps, []);
  assert.match(todo, /E-21c-replan-stalled-leaf-/u);
  assert.match(todo, /Route: todo-decomposition/u);
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].todo_id, 'E-21c-runtime-operational-evidence-impl-2-target-02');
  assert.equal(feedback.kind, 'phase_loop_todo_contract_replan_feedback');
  assert.equal(feedback.semantic_repair_policy.mode, 'stalled_leaf_contract_replan');
  assert.equal(feedback.failure_ledger_summary.should_replan, true);
  assert.equal(feedback.failure_ledger_summary.replan_reason, 'same_todo_no_progress_threshold');
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].kind, 'no_progress');
  assert.equal(ledger[0].todo_id, 'E-21c-runtime-operational-evidence-impl-2-target-02');
});

test('ensures stalled TODO decomposition request even when blocked record already exists', () => {
  const repo = makeRepo();
  writeTodo(repo);
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'no_progress',
    run_id: 'run-no-progress-existing-blocked',
    consecutive_failures: 1,
    detail: 'Brownie run exited successfully but repeated the same non-progress fingerprint'
  });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress',
    same_progress_count: 1,
    run_stamp: '20261003T171000Z',
    progress_projection: {
      cli_status: 'no_eligible_task',
      closure: 'no_eligible_task',
      claim_id: 'claim-existing-blocked',
      selected_todo: runtimeEvidenceTodo
    }
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/current.json', {
    claim_id: 'claim-existing-blocked',
    status: 'claimed',
    selected_todo: runtimeEvidenceTodo
  });
  fs.writeFileSync(
    path.join(repo, '.brownie/private/phase-loop/todo-claims/blocked.jsonl'),
    `${JSON.stringify({
      schema_version: 1,
      record_type: 'todo_blocked',
      todo_id: 'E-21c-runtime-operational-evidence-impl-2-target-02',
      selected_todo_first_line: runtimeEvidenceTodo.split('\n')[0],
      reason: 'previous_replan_feedback'
    })}\n`
  );
  fs.writeFileSync(
    path.join(repo, '.brownie/private/phase-loop/todo-claims/failure-ledger.jsonl'),
    `${JSON.stringify({
      schema_version: 1,
      record_type: 'phase_loop_failure_event',
      event_id: 'event-invalid-before-existing-blocked',
      observed_at: '2026-10-03T17:00:00Z',
      todo_id: 'E-21c-runtime-operational-evidence-impl-2-target-02',
      selected_todo_first_line: runtimeEvidenceTodo.split('\n')[0],
      kind: 'invalid_patch',
      status: 'no_progress',
      progress_run_stamp: '20261003T170000Z',
      same_progress_count: 2
    })}\n`
  );

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });
  const todo = fs.readFileSync(path.join(repo, '.brownie/todo.md'), 'utf8');

  assert.equal(result.repair.todo_contract_replan.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.stalled_todo_blocked.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.stalled_todo_blocked.changed, false, JSON.stringify(result, null, 2));
  assert.equal(result.repair.stalled_todo_decomposition.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.stalled_todo_decomposition.changed, true, JSON.stringify(result, null, 2));
  assert.match(todo, /E-21c-replan-stalled-leaf-/u);
  assert.match(todo, /Route: todo-decomposition/u);
});

test('does not treat stale same-id blocked record as current stalled TODO incarnation', () => {
  const repo = makeRepo();
  writeTodo(repo);
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'no_progress',
    run_id: 'run-no-progress-stale-blocked',
    consecutive_failures: 1,
    detail: 'Brownie run exited successfully but repeated the same non-progress fingerprint'
  });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress',
    same_progress_count: 1,
    run_stamp: '20261003T171500Z',
    progress_projection: {
      cli_status: 'no_eligible_task',
      closure: 'no_eligible_task',
      claim_id: 'claim-stale-blocked',
      selected_todo: runtimeEvidenceTodo
    }
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/current.json', {
    claim_id: 'claim-stale-blocked',
    status: 'claimed',
    selected_todo: runtimeEvidenceTodo
  });
  fs.writeFileSync(
    path.join(repo, '.brownie/private/phase-loop/todo-claims/blocked.jsonl'),
    `${JSON.stringify({
      schema_version: 1,
      record_type: 'todo_blocked',
      todo_id: 'E-21c-runtime-operational-evidence-impl-2-target-02',
      selected_todo_first_line: '- [ ] E-21c-runtime-operational-evidence-impl-2-target-02: Patch only `old-target.mjs` from a stale incarnation:',
      selected_todo_sha256: 'stale-sha',
      reason: 'previous_replan_feedback'
    })}\n`
  );
  fs.writeFileSync(
    path.join(repo, '.brownie/private/phase-loop/todo-claims/failure-ledger.jsonl'),
    `${JSON.stringify({
      schema_version: 1,
      record_type: 'phase_loop_failure_event',
      event_id: 'event-invalid-before-stale-blocked',
      observed_at: '2026-10-03T17:05:00Z',
      todo_id: 'E-21c-runtime-operational-evidence-impl-2-target-02',
      selected_todo_first_line: runtimeEvidenceTodo.split('\n')[0],
      kind: 'invalid_patch',
      status: 'no_progress',
      progress_run_stamp: '20261003T170500Z',
      same_progress_count: 2
    })}\n`
  );

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });
  const blocked = fs.readFileSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/blocked.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));

  assert.equal(result.repair.todo_contract_replan.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.stalled_todo_blocked.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.stalled_todo_blocked.changed, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.stalled_todo_decomposition.ok, true, JSON.stringify(result, null, 2));
  assert.equal(blocked.length, 2);
  assert.equal(blocked[1].selected_todo_first_line, runtimeEvidenceTodo.split('\n')[0]);
});

test('removes completed TODO residue and stale stalled-leaf replan before restart', () => {
  const repo = makeRepo();
  writeTodo(repo);
  const replanTodo = `- [ ] E-21c-replan-stalled-leaf-${'a'.repeat(12)}: Patch only \`.brownie/todo.md\` and \`.brownie/todo-breakdown.md\` to replan stalled Brownie TODO leaf into implementable child TODOs:
  Route: todo-decomposition.
  Source TODO: E-21c-runtime-operational-evidence-impl-2-target-02.
  Depends on: <none>.
  Completion condition: Patch \`.brownie/todo.md\` and \`.brownie/todo-breakdown.md\` so stalled TODO is replaced by implementable child leaves.
  Forbidden changes: do not weaken guards/tests.
  Verification: run \`pnpm --workspace-root guard:todo-decomposition\` and \`pnpm --workspace-root phase-loop:todo-queue-integrity\`.`;
  const dependentTodo = `- [ ] E-21c-runtime-operational-evidence-impl-2-target-03: Patch only \`scripts/guard-runtime-operational-evidence.test.mjs\` to complete the dependent slice:
  Route: implementation.
  Source TODO: E-21c-runtime-operational-evidence.
  Depends on: E-21c-runtime-operational-evidence-impl-2-target-02.
  Completion condition: dependent slice remains live after completed prerequisite is pruned.
  Forbidden changes: do not weaken guards/tests.
  Verification: run \`pnpm --workspace-root release:runtime-operational-evidence:test\`.`;
  fs.writeFileSync(path.join(repo, '.brownie/todo.md'), `${replanTodo}\n\n${runtimeEvidenceTodo}\n\n${dependentTodo}\n`);
  fs.writeFileSync(path.join(repo, '.brownie/todo-breakdown.md'), `# breakdown

Parent TODO: E-21c-runtime-operational-evidence-impl-2

Dependency graph:
- E-21c-runtime-operational-evidence-impl-2-target-03: E-21c-runtime-operational-evidence-impl-2-target-02

Verification ledger:
- E-21c-runtime-operational-evidence-impl-2-target-03: run \`pnpm --workspace-root release:runtime-operational-evidence:test\`

Quality rubric:
- E-21c-runtime-operational-evidence-impl-2-target-03: bounded dependent leaf remains valid after completed prerequisite pruning.

## TODO-repair-E-21c-replan-stalled-leaf-${'a'.repeat(12)}

Parent TODO: E-21c-runtime-operational-evidence-impl-2-target-02
`);
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  fs.mkdirSync(path.join(repo, '.brownie/private/phase-loop/todo-completions'), { recursive: true });
  writeJson(repo, '.brownie/private/phase-loop/todo-completions/completed-target.json', {
    selected_todo_id: 'E-21c-runtime-operational-evidence-impl-2-target-02',
    selected_todo_first_line: runtimeEvidenceTodo.split('\n')[0]
  });
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'blocked_todo_recorded',
    run_id: 'stable-blocked-run',
    consecutive_failures: 0,
    detail: 'Selected generated/blocker TODO id was already recorded as blocked in a previous queue generation; removed it from the live queue and will continue with the next unblocked TODO.'
  });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'progress',
    same_progress_count: 0,
    progress_projection: {
      cli_status: 'blocked_todo_recorded',
      selected_todo: runtimeEvidenceTodo
    }
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/current.json', {
    claim_id: 'claim-completed-residue',
    status: 'claimed',
    selected_todo: runtimeEvidenceTodo
  });

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });
  const todo = fs.readFileSync(path.join(repo, '.brownie/todo.md'), 'utf8');
  const breakdown = fs.readFileSync(path.join(repo, '.brownie/todo-breakdown.md'), 'utf8');

  assert.equal(result.repair.non_live_todo_residue.attempted, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.non_live_todo_residue.ok, true, JSON.stringify(result, null, 2));
  assert.deepEqual(
    result.repair.non_live_todo_residue.removed_todo_ids.sort(),
    [`E-21c-replan-stalled-leaf-${'a'.repeat(12)}`, 'E-21c-runtime-operational-evidence-impl-2-target-02'].sort()
  );
  assert.doesNotMatch(todo, /E-21c-replan-stalled-leaf-/u);
  assert.doesNotMatch(todo, /E-21c-runtime-operational-evidence-impl-2-target-02: Patch only/u);
  assert.match(todo, /Depends on: <none>/u);
  assert.match(todo, /E-21c-runtime-operational-evidence-impl-2-target-03/u);
  assert.doesNotMatch(breakdown, /TODO-repair-E-21c-replan-stalled-leaf-/u);
  assert.equal(result.repair.post_repair_validation.ok, true, JSON.stringify(result, null, 2));
});

test('preserves todo preamble and checked items when pruning generated TODO residue', () => {
  const repo = makeRepo();
  writeTodo(repo);
  const removableTodo = `- [ ] E-21c-replan-stalled-leaf-${'b'.repeat(12)}: Patch only \`.brownie/todo.md\` to remove stale generated residue:
  Route: todo-decomposition.
  Source TODO: E-21c-runtime-operational-evidence-impl-2-target-02.
  Depends on: <none>.
  Completion condition: stale generated residue is removed.
  Forbidden changes: do not weaken guards/tests.
  Verification: run \`pnpm --workspace-root guard:todo-decomposition\`.`;
  const checkedTodo = `- [x] E-21c-completed-context: Completed context must remain in the file:
  Route: implementation.
  Source TODO: E-21c.
  Depends on: <none>.
  Completion condition: already completed.
  Forbidden changes: do not remove this historical record.
  Verification: already complete.`;
  fs.writeFileSync(path.join(repo, '.brownie/todo.md'), `# Brownie TODO Queue

Operator note that must be preserved.

${checkedTodo}

${removableTodo}

${ownerBlockerTodo}
`);
  fs.writeFileSync(path.join(repo, '.brownie/todo-breakdown.md'), `# breakdown

Dependency graph:
- E-20i-runtime-release-ops-blocker: <none>

Verification ledger:
- E-20i-runtime-release-ops-blocker: inspect/blocker/fail-closed

Quality rubric:
- E-20i-runtime-release-ops-blocker: explicit owner blocker
`);
  execFileSync('git', ['add', '.brownie/todo.md', '.brownie/todo-breakdown.md'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'todo preamble fixture'], { cwd: repo, stdio: 'ignore' });
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'blocked',
    run_id: 'claim-failed',
    consecutive_failures: 5,
    detail: 'Failed to claim first pending TODO from queue: .brownie/todo.md'
  });

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });
  const todo = fs.readFileSync(path.join(repo, '.brownie/todo.md'), 'utf8');

  assert.equal(result.repair.non_live_todo_residue.attempted, true, JSON.stringify(result, null, 2));
  assert.doesNotMatch(todo, /E-21c-replan-stalled-leaf-/u);
  assert.match(todo, /# Brownie TODO Queue/u);
  assert.match(todo, /Operator note that must be preserved/u);
  assert.match(todo, /E-21c-completed-context/u);
  assert.match(todo, /E-20i-runtime-release-ops-blocker/u);
});

test('removes live child TODOs whose source parent is already checked complete', () => {
  const repo = makeRepo();
  writeTodo(repo);
  const parentTodo = `- [x] E-21c-owner-governance-reproducibility-impl-7: Patch only \`scripts/release-owner-governance-evidence.mjs\` and \`scripts/guard-owner-governance-evidence.test.mjs\`:
  Route: implementation.
  Source TODO: TODO-refine-brownie-owned-blockers.
  Depends on: <none>.
  Completion condition: parent is complete.
  Forbidden changes: do not weaken guards/tests.
  Verification: run \`pnpm --workspace-root release:runtime-operational-evidence:test\`.`;
  const childOne = `- [ ] E-21c-owner-governance-reproducibility-impl-7-target-01: Patch only \`scripts/release-owner-governance-evidence.mjs\` to complete one bounded slice:
  Route: implementation.
  Source TODO: E-21c-owner-governance-reproducibility-impl-7.
  Depends on: <none>.
  Completion condition: child should not remain live after parent completion.
  Forbidden changes: do not weaken guards/tests.
  Verification: run \`pnpm --workspace-root release:runtime-operational-evidence:test\`.`;
  const childTwo = `- [ ] E-21c-owner-governance-reproducibility-impl-7-target-02: Patch only \`scripts/guard-owner-governance-evidence.test.mjs\` to complete one bounded slice:
  Route: implementation.
  Source TODO: E-21c-owner-governance-reproducibility-impl-7.
  Depends on: E-21c-owner-governance-reproducibility-impl-7-target-01.
  Completion condition: dependent child should not remain live after parent completion.
  Forbidden changes: do not weaken guards/tests.
  Verification: run \`pnpm --workspace-root release:runtime-operational-evidence:test\`.`;
  const ownerBlocker = `- [ ] E-20i-runtime-release-ops-blocker: Blocker: External release engineering ownership required.
  Route: blocker.
  Source TODO: E-20i-runtime-release-ops-blockers.
  Depends on: <none>.
  Completion condition: owner provides evidence.
  Forbidden changes: do not invent credentials.
  Verification: inspect/blocker/fail-closed.`;
  fs.writeFileSync(path.join(repo, '.brownie/todo.md'), `${ownerBlocker}\n\n${parentTodo}\n\n${childOne}\n\n${childTwo}\n`);
  fs.writeFileSync(path.join(repo, '.brownie/todo-breakdown.md'), `# breakdown

Parent TODO: E-21c-owner-governance-reproducibility-impl-7

Dependency graph:
- E-20i-runtime-release-ops-blocker: <none>
- E-21c-owner-governance-reproducibility-impl-7-target-01: <none>
- E-21c-owner-governance-reproducibility-impl-7-target-02: E-21c-owner-governance-reproducibility-impl-7-target-01

Verification ledger:
- E-20i-runtime-release-ops-blocker: inspect/blocker/fail-closed
- E-21c-owner-governance-reproducibility-impl-7-target-01: run \`pnpm --workspace-root release:runtime-operational-evidence:test\`
- E-21c-owner-governance-reproducibility-impl-7-target-02: run \`pnpm --workspace-root release:runtime-operational-evidence:test\`

Quality rubric:
- E-20i-runtime-release-ops-blocker: explicit owner blocker
- E-21c-owner-governance-reproducibility-impl-7-target-01: bounded child
- E-21c-owner-governance-reproducibility-impl-7-target-02: bounded child
`);
  execFileSync('git', ['add', '.brownie/todo.md', '.brownie/todo-breakdown.md'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'parent-child todo fixture'], { cwd: repo, stdio: 'ignore' });
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'blocked',
    run_id: 'claim-failed',
    consecutive_failures: 5,
    detail: 'Failed to claim first pending TODO from queue: .brownie/todo.md'
  });

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });
  const todo = fs.readFileSync(path.join(repo, '.brownie/todo.md'), 'utf8');

  assert.equal(result.repair.non_live_todo_residue.attempted, true, JSON.stringify(result, null, 2));
  assert.deepEqual(
    result.repair.non_live_todo_residue.removed_todo_ids.sort(),
    [
      'E-21c-owner-governance-reproducibility-impl-7-target-01',
      'E-21c-owner-governance-reproducibility-impl-7-target-02'
    ].sort()
  );
  assert.doesNotMatch(todo, /E-21c-owner-governance-reproducibility-impl-7-target-01/u);
  assert.doesNotMatch(todo, /E-21c-owner-governance-reproducibility-impl-7-target-02/u);
  assert.match(todo, /E-20i-runtime-release-ops-blocker/u);
  assert.equal(result.repair.post_repair_validation.ok, true, JSON.stringify(result, null, 2));
});

test('does not restart phase-loop when only owner blockers remain but dirty delivery is required', () => {
  const repo = makeRepo();
  fs.mkdirSync(path.join(repo, '.brownie'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.brownie/todo.md'), `${ownerBlockerTodo}\n`);
  fs.writeFileSync(path.join(repo, '.brownie/todo-breakdown.md'), `# breakdown

Parent TODO: E-20i-runtime-release-ops-blocker

Dependency graph:
- E-20i-runtime-release-ops-blocker: <none>

Verification ledger:
- E-20i-runtime-release-ops-blocker: inspect/blocker/fail-closed

Quality rubric:
- E-20i-runtime-release-ops-blocker: explicit owner blocker
`);
  execFileSync('git', ['add', '.brownie/todo.md', '.brownie/todo-breakdown.md'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'owner blocker fixture'], { cwd: repo, stdio: 'ignore' });
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'blocked',
    run_id: 'owner-blockers-only-test',
    consecutive_failures: 0,
    detail: 'No implementable TODO remains; pending queue contains only explicit owner-controlled blocker TODOs. Phase-loop is stopped until owner/review evidence changes.'
  });
  fs.writeFileSync(path.join(repo, 'README.md'), 'dirty delivery work\n');

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: true });

  assert.equal(result.initial_summary.next_action, 'prepare_delivery_commit_pr', JSON.stringify(result, null, 2));
  assert.equal(result.start.attempted, false, JSON.stringify(result, null, 2));
  assert.equal(result.start.reason, 'delivery_required_not_starting', JSON.stringify(result, null, 2));
  assert(result.final_issues.some((issue) => issue.code === 'delivery_required'), JSON.stringify(result, null, 2));
});

test('escalates invalid patch with repeated no-progress to TODO contract replan feedback without historical ledger', () => {
  const repo = makeRepo();
  writeTodo(repo);
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'no_progress',
    run_id: 'run-invalid-patch',
    consecutive_failures: 1,
    detail: 'Brownie run exited successfully but repeated the same non-progress fingerprint'
  });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress',
    same_progress_count: 2,
    run_stamp: '20261003T171000Z',
    progress_projection: {
      cli_status: 'no_eligible_task',
      closure: 'no_eligible_task',
      claim_id: 'claim-invalid-patch',
      selected_todo: runtimeEvidenceTodo
    }
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/current.json', {
    claim_id: 'claim-invalid-patch',
    status: 'claimed',
    selected_todo: runtimeEvidenceTodo
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/repair-feedback.json', {
    schema_version: 1,
    kind: 'phase_loop_invalid_patch_repair_feedback',
    reason: 'supervisor_invalid_workspace_write_patch',
    invalid_patch: {
      detected: true,
      claim_id: 'claim-invalid-patch',
      reason: 'runtime_terminal_failure',
      selected_todo: {
        first_line: runtimeEvidenceTodo.split('\n')[0],
        route: 'implementation',
        patch_targets: ['scripts/guard-runtime-operational-evidence.test.mjs'],
        verification_commands: ['pnpm --workspace-root release:runtime-operational-evidence:test']
      },
      invalid_patch_proposals: [
        {
          path: 'scripts/guard-runtime-operational-evidence.test.mjs',
          operation: 'patch_file',
          validation_reason: 'Patch old_text was not found in the current target.',
          content_preview: '[patch_file single_hunk old_chars=478 new_chars=1406]',
          hunk_count: 1
        }
      ]
    }
  });

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });
  const feedback = JSON.parse(fs.readFileSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/repair-feedback.json'), 'utf8'));
  const todo = fs.readFileSync(path.join(repo, '.brownie/todo.md'), 'utf8');

  assert.equal(result.repair.todo_contract_replan.attempted, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.todo_contract_replan.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.stalled_todo_blocked.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.stalled_todo_decomposition.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.post_repair_validation.ok, true, JSON.stringify(result, null, 2));
  assert.deepEqual(result.repair.post_repair_validation.failed_steps, []);
  assert.match(todo, /E-21c-replan-stalled-leaf-/u);
  assert.equal(feedback.kind, 'phase_loop_todo_contract_replan_feedback');
  assert.equal(feedback.failure_ledger_summary.replan_reason, 'invalid_patch_with_repeated_no_progress');
  assert.equal(result.repair.invalid_patch.reason, 'todo_contract_replan_feedback_takes_precedence');
});

test('escalates invalid patch followed by no-progress on the same leaf to TODO contract replan feedback', () => {
  const repo = makeRepo();
  writeTodo(repo);
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'no_progress',
    run_id: 'run-after-invalid-patch',
    consecutive_failures: 1,
    detail: 'Brownie run exited successfully but repeated the same non-progress fingerprint'
  });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress',
    same_progress_count: 1,
    run_stamp: '20261003T171500Z',
    progress_projection: {
      cli_status: 'no_eligible_task',
      closure: 'no_eligible_task',
      claim_id: 'claim-after-invalid-patch',
      selected_todo: runtimeEvidenceTodo
    }
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/current.json', {
    claim_id: 'claim-after-invalid-patch',
    status: 'claimed',
    selected_todo: runtimeEvidenceTodo
  });
  fs.writeFileSync(
    path.join(repo, '.brownie/private/phase-loop/todo-claims/failure-ledger.jsonl'),
    `${JSON.stringify({
      schema_version: 1,
      record_type: 'phase_loop_failure_event',
      event_id: 'event-invalid-patch-prior',
      observed_at: '2026-10-03T17:10:00Z',
      todo_id: 'E-21c-runtime-operational-evidence-impl-2-target-02',
      selected_todo_first_line: runtimeEvidenceTodo.split('\n')[0],
      kind: 'invalid_patch',
      status: 'no_progress',
      progress_run_stamp: '20261003T171000Z',
      same_progress_count: 2
    })}\n`
  );

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });
  const feedback = JSON.parse(fs.readFileSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/repair-feedback.json'), 'utf8'));
  const todo = fs.readFileSync(path.join(repo, '.brownie/todo.md'), 'utf8');

  assert.equal(result.repair.todo_contract_replan.attempted, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.todo_contract_replan.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.stalled_todo_blocked.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.stalled_todo_decomposition.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.post_repair_validation.ok, true, JSON.stringify(result, null, 2));
  assert.deepEqual(result.repair.post_repair_validation.failed_steps, []);
  assert.match(todo, /E-21c-replan-stalled-leaf-/u);
  assert.equal(feedback.kind, 'phase_loop_todo_contract_replan_feedback');
  assert.equal(feedback.failure_ledger_summary.replan_reason, 'invalid_patch_followed_by_no_progress');
});

test('runs TODO guard after repair when diagnostic reports an existing TODO contract violation', () => {
  const repo = makeRepo();
  writeTodo(repo);
  fs.appendFileSync(path.join(repo, '.brownie/todo.md'), `

- [ ] E-21c-replan-stalled-leaf-001: Patch \`.brownie/todo.md\` to replan a stalled leaf:
  Route: todo-decomposition.
  Source TODO: E-21c-replan-stalled-leaf-parent.
  Depends on: <none>.
  Completion condition: Patch \`.brownie/todo.md\` only.
  Forbidden changes: do not implement release evidence.
  Verification: run \`pnpm --workspace-root guard:todo-decomposition\`.
`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'no_progress',
    run_id: 'run-contract-invalid',
    consecutive_failures: 3,
    detail: 'Brownie run exited successfully but repeated the same non-progress fingerprint'
  });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress',
    same_progress_count: 2,
    run_stamp: '20261003T204237Z',
    progress_projection: {
      cli_status: 'no_eligible_task',
      closure: 'no_eligible_task',
      claim_id: 'claim-contract-invalid',
      selected_todo: runtimeEvidenceTodo
    }
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/current.json', {
    claim_id: 'claim-contract-invalid',
    status: 'claimed',
    selected_todo: runtimeEvidenceTodo
  });

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: true });

  assert.equal(result.repair.post_repair_validation.attempted, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.post_repair_validation.ok, false, JSON.stringify(result, null, 2));
  assert.match(result.repair.post_repair_validation.failed_steps.join(','), /guard-todo-decomposition/u);
  assert.equal(result.start.attempted, false, JSON.stringify(result, null, 2));
  assert.equal(result.start.reason, 'post_repair_validation_failed');
});

test('repairs generated TODO leaf prefix and breakdown ledger after decomposition guard rejection', () => {
  const repo = makeRepo();
  writeTodo(repo);
  fs.writeFileSync(path.join(repo, '.brownie/todo.md'), `# Brownie TODO Queue

## Product Ready Blocking Queue

### P0/P1: Release engineering and evidence

- [ ] E-15e-todo-decomp-leaf-001: Patch only \`.brownie/todo.md\` to add release-evidence TODO for runtime-release-readiness-audit.json:
  Route: todo-decomposition.
  Source TODO: E-21c-replan-stalled-leaf-c0830caaef87.
  Depends on: <none>.
  Completion condition: Add unchecked TODO item for creating or updating \`docs/architecture/runtime-release-readiness-audit.json\` with concrete evidence entries.
  Forbidden changes: do not invent evidence values, do not declare Runtime Product Ready.
  Verification: run \`pnpm --workspace-root guard:todo-decomposition\`.
- [ ] E-15e-todo-decomp-leaf-002: Patch only \`.brownie/todo.md\` to add release-evidence TODO for release-gate.mjs verification:
  Route: todo-decomposition.
  Source TODO: E-21c-replan-stalled-leaf-c0830caaef87.
  Depends on: E-15e-todo-decomp-leaf-001.
  Completion condition: Add unchecked TODO item for updating \`scripts/release-gate.mjs\` to validate runtime-release-readiness-audit.json.
  Forbidden changes: do not weaken guards/tests, do not invent evidence values.
  Verification: run \`pnpm --workspace-root phase-loop:todo-queue-integrity\`.
`);
  fs.writeFileSync(path.join(repo, '.brownie/todo-breakdown.md'), '# Breakdown\n');
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'no_progress',
    run_id: 'run-prefix-repair',
    consecutive_failures: 3,
    detail: 'TODO decomposition guard failed after TODO apply'
  });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'progress',
    same_progress_count: 1,
    run_stamp: '20261003T210259Z',
    progress_projection: {
      cli_status: 'objective_proposal_applied',
      closure: 'routed_explicit_action',
      claim_id: 'claim-prefix-repair',
      selected_todo: runtimeEvidenceTodo
    }
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/current.json', {
    claim_id: 'claim-prefix-repair',
    status: 'claimed',
    selected_todo: runtimeEvidenceTodo
  });

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });
  const todo = fs.readFileSync(path.join(repo, '.brownie/todo.md'), 'utf8');
  const breakdown = fs.readFileSync(path.join(repo, '.brownie/todo-breakdown.md'), 'utf8');

  assert.equal(result.repair.derived_todo_prefix_ledger.ok, true, JSON.stringify(result, null, 2));
  assert.match(todo, /E-21c-todo-decomp-leaf-001/u);
  assert.match(todo, /Depends on: E-21c-todo-decomp-leaf-001/u);
  assert.doesNotMatch(todo, /E-15e-todo-decomp-leaf/u);
  assert.match(breakdown, /E-21c-todo-decomp-leaf-001/u);
  assert.match(result.repair.post_repair_validation.failed_steps.join(','), /phase-loop-todo-queue-integrity/u);
});
