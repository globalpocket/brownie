import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { evaluateTodoQueue } from './phase-loop-todo-evaluator.mjs';
import { loadTodoState } from './phase-loop-todo-state.mjs';

const controllerRoot = path.resolve('.');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function setup({ invalidProof = false, unsafeChild = false } = {}) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-superseded-resolution-'));
  const parentId = 'E-resolution-parent';
  const childIds = [`${parentId}-target-01`, `${parentId}-target-02`];
  const parent = `- [ ] ${parentId}: Patch only \`scripts/soak.mjs\`:
  Route: implementation.
  Depends on: <none>.
  Completion condition: reviewed merged delivery is reverified before resolution.
  Forbidden changes: do not treat historical child failure as completion.
  Verification: run \`node --check scripts/soak.mjs\`.`;
  const next = `- [ ] E-resolution-next: Patch only \`scripts/next.mjs\`:
  Route: implementation.
  Depends on: ${parentId}.
  Completion condition: next work is schedulable only after the parent resolves.
  Forbidden changes: do not edit unrelated files.
  Verification: run \`node --check scripts/next.mjs\`.`;
  const child = `- [ ] ${childIds[0]}: Patch only \`scripts/soak.mjs\`:
  Route: implementation.
  Source TODO: ${parentId}.
  Depends on: <none>.
  Completion condition: historical child failure is provenance only.
  Forbidden changes: do not edit unrelated files.
  Verification: run \`node --check scripts/soak.mjs\`.`;
  const todo = unsafeChild ? `${parent}\n\n${child}\n\n${next}\n` : `${parent}\n\n${next}\n`;
  const todoPath = path.join(repo, '.brownie/todo.md');
  const claimDir = path.join(repo, '.brownie/private/phase-loop/todo-claims');
  fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
  fs.mkdirSync(path.dirname(todoPath), { recursive: true });
  fs.mkdirSync(path.join(repo, '.brownie/private/phase-loop/todo-replans'), { recursive: true });
  fs.mkdirSync(path.join(claimDir, 'contract-rebaselines'), { recursive: true });
  fs.writeFileSync(todoPath, todo);
  fs.writeFileSync(path.join(repo, '.brownie/todo-breakdown.md'), '# Stable breakdown\n');
  fs.writeFileSync(path.join(repo, 'scripts/soak.mjs'), 'export const soak = "before";\n');
  fs.writeFileSync(path.join(repo, 'scripts/next.mjs'), 'export const next = true;\n');
  execFileSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'fixture'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'fixture@example.invalid'], { cwd: repo });
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '--quiet', '-m', 'baseline'], { cwd: repo });
  const parentHash = sha256(parent);
  execFileSync('git', ['switch', '--quiet', '-c', 'implementation'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'scripts/soak.mjs'), 'export const soak = "merged";\n');
  execFileSync('git', ['add', 'scripts/soak.mjs'], { cwd: repo });
  execFileSync('git', ['commit', '--quiet', '-m', `implementation\n\nBrownie-Task-Todo: ${parentId}\nBrownie-Task-Spec-SHA256: ${parentHash}`], { cwd: repo });
  execFileSync('git', ['switch', '--quiet', 'main'], { cwd: repo });
  execFileSync('git', ['merge', '--no-ff', '--quiet', '--no-edit', 'implementation'], { cwd: repo });
  const merge = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  const firstParent = execFileSync('git', ['rev-parse', 'HEAD^1'], { cwd: repo, encoding: 'utf8' }).trim();
  const head = execFileSync('git', ['rev-parse', 'HEAD^2'], { cwd: repo, encoding: 'utf8' }).trim();
  // This fixture models a split before the later delivery, as required by
  // the existing recovery gate. Missing chronology cannot authorize recovery.
  const mergeTime = Number(execFileSync('git', ['show', '-s', '--format=%ct', merge], { cwd: repo, encoding: 'utf8' }).trim());
  const splitWrittenAt = new Date((mergeTime - 1) * 1000).toISOString();
  const claimId = 'claim-resolution-parent';
  const proof = {
    schema_version: 1,
    kind: 'phase_loop_merged_delivery_reverification',
    claim_id: claimId,
    root_claim_id: claimId,
    selected_todo_id: parentId,
    selected_todo_sha256: parentHash,
    completion_condition_sha256: sha256('reviewed merged delivery is reverified before resolution.'),
    queue_fingerprint: sha256(todo),
    queue_generation: 23,
    runtime: { claim_id: claimId, status: invalidProof ? 'failed' : 'task_executed', executed_count: 1 },
    git: { merge_commit_oid: merge, first_parent_oid: firstParent, head_oid: head, targets: [{ path: 'scripts/soak.mjs', sha256: sha256('export const soak = "merged";\n') }] },
    task_spec_binding: { kind: 'commit_trailer', todo_id: parentId, selected_todo_sha256: parentHash, head_oid: head },
    review: { state: 'MERGED', pr_url: 'https://example.invalid/pull/23', merge_commit_oid: merge, head_oid: head, author: 'implementation', reviewer: 'review', merge_actor: 'review', merged_at: '2026-11-05T00:00:00Z', observed_at: '2026-11-05T00:01:00Z', approved: true, ci_passed: true, latest_reviewer_review_state: 'APPROVED', latest_reviewer_review_commit_oid: head },
    verification_results: [{ command: 'node --check scripts/soak.mjs', exit_code: 0 }]
  };
  const claim = {
    schema_version: 1, claim_id: claimId, root_claim_id: claimId, status: 'completed',
    selected_todo: parent, selected_todo_id: parentId, selected_todo_sha256: parentHash,
    queue_fingerprint: proof.queue_fingerprint, queue_generation: proof.queue_generation,
    baseline_todo_text: todo, baseline_diff_files: [],
    merged_delivery_reverification: proof,
    delivery_review: { merged: true, approved: true, ci_passed: true, author: 'implementation', reviewer: 'review', merge_actor: 'review', merged_delivery_reverification: proof }
  };
  fs.writeFileSync(path.join(claimDir, 'current.json'), `${JSON.stringify(claim)}\n`);
  fs.writeFileSync(path.join(claimDir, 'stale-parent.json'), `${JSON.stringify({ claim_id: 'stale-parent', selected_todo: parent, status: 'failed', archive_reason: 'terminal_failure' })}\n`);
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/todo-replans/split.json'), `${JSON.stringify({ schema_version: 1, record_type: 'todo_replan', operation: 'split_parent_into_children', parent_status: 'superseded_by_children', parent_todo_id: parentId, generated_child_ids: childIds, written_at: splitWrittenAt })}\n`);
  const childHash = sha256(child);
  const archivedChild = { claim_id: 'stale-child', selected_todo: child, selected_todo_id: childIds[0], selected_todo_sha256: childHash, status: 'failed', archive_reason: 'terminal_failure', claim_admission: { claim_id: 'stale-child', selected_todo_id: childIds[0], selected_todo_sha256: childHash }, failure_history: [{ status: 'failed', selected_todo_sha256: childHash }], status_history: [{ status: 'claimed' }, { status: 'in_progress' }, { status: 'failed' }] };
  fs.writeFileSync(path.join(claimDir, 'stale-child.json'), `${JSON.stringify(archivedChild)}\n`);
  fs.writeFileSync(path.join(claimDir, 'blocked.jsonl'), `${JSON.stringify({ selected_todo: child, selected_todo_id: childIds[0], selected_todo_sha256: childHash, terminal_failure: true, block_reason: 'terminal_failure' })}\n`);
  fs.writeFileSync(path.join(claimDir, 'contract-rebaselines', 'split.json'), `${JSON.stringify({ schema_version: 1, record_type: 'todo_contract_rebaseline', status: 'approved', parent_todo_ids: [parentId], target_todo_ids: [parentId], contract_changes: [{ todo_id: parentId }] })}\n`);
  return { repo, todoPath, claimDir, todo, parentId, next };
}

test('writes an audited supersession resolution only after exact verified parent completion, then schedules its dependent without rewriting TODO text', () => {
  const fixture = setup();
  const before = fs.readFileSync(fixture.todoPath, 'utf8');
  const output = execFileSync(process.execPath, [
    path.join(controllerRoot, 'scripts/phase-loop-progress-integrity.mjs'),
    '--repo', fixture.repo, '--claim', '.brownie/private/phase-loop/todo-claims/current.json',
    '--claim-dir', '.brownie/private/phase-loop/todo-claims', '--todo', '.brownie/todo.md',
    '--run-stamp', 'resolution-run', '--write-record'
  ], { cwd: controllerRoot, encoding: 'utf8' });
  const result = JSON.parse(output);
  assert.equal(result.supersession_resolution_record.parent_todo_id, fixture.parentId);
  assert.equal(fs.readFileSync(fixture.todoPath, 'utf8'), before);
  const state = loadTodoState(fixture.repo, before);
  assert(state.resolvedIds.has(fixture.parentId));
  const queue = evaluateTodoQueue(before, { repoRoot: fixture.repo, claimDir: fixture.claimDir, breakdownPath: path.join(fixture.repo, '.brownie/todo-breakdown.md') });
  assert.equal(queue.selected_todo_id, 'E-resolution-next');
});

test('cleanup retry preserves the completion receipt already bound to a supersession resolution', () => {
  const fixture = setup();
  const args = [
    path.join(controllerRoot, 'scripts/phase-loop-progress-integrity.mjs'),
    '--repo', fixture.repo, '--claim', '.brownie/private/phase-loop/todo-claims/current.json',
    '--claim-dir', '.brownie/private/phase-loop/todo-claims', '--todo', '.brownie/todo.md',
    '--write-record'
  ];
  execFileSync(process.execPath, [...args, '--run-stamp', 'resolution-first'], { cwd: controllerRoot });
  const completionPath = path.join(fixture.repo, '.brownie/private/phase-loop/todo-completions/claim-resolution-parent.json');
  const resolutionPath = path.join(fixture.repo, '.brownie/private/phase-loop/todo-supersession-resolutions/claim-resolution-parent.json');
  const firstCompletion = fs.readFileSync(completionPath, 'utf8');
  const firstResolution = fs.readFileSync(resolutionPath, 'utf8');

  const retry = execFileSync(process.execPath, [...args, '--run-stamp', 'resolution-cleanup-retry'], {
    cwd: controllerRoot,
    encoding: 'utf8'
  });
  const result = JSON.parse(retry);
  assert.equal(result.completion_record.run_stamp, 'resolution-first');
  assert.equal(fs.readFileSync(completionPath, 'utf8'), firstCompletion);
  assert.equal(fs.readFileSync(resolutionPath, 'utf8'), firstResolution);
  const state = loadTodoState(fixture.repo, fixture.todo);
  assert(state.resolvedIds.has(fixture.parentId));
  const queue = evaluateTodoQueue(fixture.todo, {
    repoRoot: fixture.repo,
    claimDir: fixture.claimDir,
    breakdownPath: path.join(fixture.repo, '.brownie/todo-breakdown.md')
  });
  assert.equal(queue.selected_todo_id, 'E-resolution-next');
});

test('does not resolve or schedule the dependent when parent proof fails or a child is live', () => {
  for (const options of [{ invalidProof: true }, { unsafeChild: true }]) {
    const fixture = setup(options);
    const result = spawnSync(process.execPath, [
      path.join(controllerRoot, 'scripts/phase-loop-progress-integrity.mjs'),
      '--repo', fixture.repo, '--claim', '.brownie/private/phase-loop/todo-claims/current.json',
      '--claim-dir', '.brownie/private/phase-loop/todo-claims', '--todo', '.brownie/todo.md',
      '--run-stamp', 'resolution-negative', '--write-record'
    ], { cwd: controllerRoot, encoding: 'utf8' });
    const payload = JSON.parse(result.status === 0 ? result.stdout : result.stderr);
    assert.equal(payload.supersession_resolution_record, undefined);
    const queue = evaluateTodoQueue(fixture.todo, { repoRoot: fixture.repo, claimDir: fixture.claimDir, breakdownPath: path.join(fixture.repo, '.brownie/todo-breakdown.md') });
    assert.notEqual(queue.selected_todo_id, 'E-resolution-next');
  }
});
